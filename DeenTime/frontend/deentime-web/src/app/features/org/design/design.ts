import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { NgStyle } from '@angular/common';
import { ReactiveFormsModule, FormBuilder } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { DesignService } from '../../../services/design';
import { AuthService } from '../../../services/auth';
import { OrgsService } from '../../../services/orgs';
import { PublicDisplayService } from '../../../services/public-display';
import { IqamaService } from '../../../services/iqama';
import { TimingsService } from '../../../services/timings';
import { FontFamily, IqamaEntry, Organization, PrayerTimesDto, PublicDisplay } from '../../../models';
import { catchError, forkJoin, map, of } from 'rxjs';
import {
  PRAYER_WALLPAPERS,
  PRAYER_WALLPAPER_CATEGORIES,
  PrayerWallpaper,
  PrayerWallpaperFilter
} from './prayer-wallpapers';
import { prayerDisplayThemeCssVars, resolvePrayerDisplayTheme } from '../../../shared/prayer-display-theme';

@Component({
  selector: 'app-design',
  standalone: true,
  imports: [
    NgStyle, ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatSelectModule, MatIconModule, MatProgressSpinnerModule, MatSnackBarModule
  ],
  templateUrl: './design.html',
  styleUrl: './design.scss'
})
export class DesignComponent implements OnInit {
  private svc   = inject(DesignService);
  private auth  = inject(AuthService);
  private orgs  = inject(OrgsService);
  private publicDisplay = inject(PublicDisplayService);
  private iqama = inject(IqamaService);
  private timings = inject(TimingsService);
  private snack = inject(MatSnackBar);
  private fb    = inject(FormBuilder);

  orgId   = this.auth.getOrgId() ?? '';
  loading = signal(false);
  saving  = signal(false);
  uploading = signal(false);
  applyingWallpaper = signal<string | null>(null);
  galleryExpanded = signal(false);
  previewLoading = signal(true);
  previewError = signal(false);
  display = signal<PublicDisplay | null>(null);
  organization = signal<Organization | null>(null);
  orgSlug = signal('');
  selectedFile: File | null = null;
  wallpapers = PRAYER_WALLPAPERS;
  wallpaperCategories = PRAYER_WALLPAPER_CATEGORIES;
  wallpaperFilter = signal<PrayerWallpaperFilter>('All');
  visibleWallpapers = computed(() => {
    const filter = this.wallpaperFilter();
    return filter === 'All' ? this.wallpapers : this.wallpapers.filter(item => item.category === filter);
  });

  prayers = [
    { key: 'fajr', label: 'Fajr', salah: 'Fajr' },
    { key: 'sunrise', label: 'Sunrise', salah: '' },
    { key: 'dhuhr', label: 'Dhuhr', salah: 'Dhuhr' },
    { key: 'asr', label: 'Asr', salah: 'Asr' },
    { key: 'maghrib', label: 'Maghrib', salah: 'Maghrib' },
    { key: 'isha', label: 'Isha', salah: 'Isha' }
  ];

  form = this.fb.group({
    headerImageUrl: [''],
    iqamaHeadings:  ['Fajr, IQM*, Sunrise, IQM*, Dhuhr, IQM*, Asr, IQM*, Sunset, IQM*, Isha, IQM*'],
    footerHtml:     [''],
    theme:          ['default'],
    tvFontScale: [100],
    widgetFontScale: [100],
    compactFontScale: [100],
    tvFontFamily: ['system' as FontFamily],
    widgetFontFamily: ['system' as FontFamily],
    compactFontFamily: ['system' as FontFamily]
  });

  themes = ['default','dark','classic'];
  fontScales = Array.from({ length: 18 }, (_, index) => 75 + index * 5);
  fontFamilies: { value: FontFamily; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'modern-sans', label: 'Modern sans' },
    { value: 'classic-serif', label: 'Classic serif' }
  ];
  layouts = [
    { label: 'TV display', scale: 'tvFontScale', family: 'tvFontFamily' },
    { label: 'Full widget', scale: 'widgetFontScale', family: 'widgetFontFamily' },
    { label: 'Compact widget', scale: 'compactFontScale', family: 'compactFontFamily' }
  ];

  ngOnInit() {
    this.loading.set(true);
    this.svc.get(this.orgId).subscribe({
      next: d => {
        this.form.patchValue({
          headerImageUrl: d.headerImageUrl ?? '',
          iqamaHeadings: d.iqamaHeadings.join(', '),
          footerHtml: d.footerHtml ?? '',
          theme: d.theme === 'light' ? 'default' : d.theme ?? 'default',
          tvFontScale: d.tvFontScale ?? 100,
          widgetFontScale: d.widgetFontScale ?? 100,
          compactFontScale: d.compactFontScale ?? 100,
          tvFontFamily: d.tvFontFamily ?? 'system',
          widgetFontFamily: d.widgetFontFamily ?? 'system',
          compactFontFamily: d.compactFontFamily ?? 'system'
        });
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });

    this.orgs.get(this.orgId).subscribe({
      next: organization => {
        this.organization.set(organization);
        this.orgSlug.set(organization.slug);
        this.loadPreview(organization);
      },
      error: () => {
        this.previewError.set(true);
        this.previewLoading.set(false);
      }
    });
  }

  private loadPreview(organization: Organization) {
    this.previewLoading.set(true);
    this.previewError.set(false);
    this.previewFor(organization).subscribe({
      next: display => {
        this.display.set(display);
        this.previewLoading.set(false);
      },
      error: () => {
        this.previewError.set(true);
        this.previewLoading.set(false);
      }
    });
  }

  private previewFor(organization: Organization) {
    const date = this.todayForTimezone(organization.criteria?.timezoneId);
    return forkJoin({
      published: this.publicDisplay.get(organization.slug).pipe(catchError(() => of<PublicDisplay | null>(null))),
      timings: this.timings.getForDate(this.orgId, date).pipe(catchError(() => of<PrayerTimesDto | null>(null))),
      iqama: this.iqama.current(this.orgId, date).pipe(catchError(() => of<IqamaEntry[]>([])))
    }).pipe(map(result => result.published ?? this.fallbackDisplay(organization, date, result.timings, result.iqama)));
  }

  private fallbackDisplay(organization: Organization, date: string, timings: PrayerTimesDto | null, iqama: IqamaEntry[]): PublicDisplay {
    const khutbahMinutes = organization.criteria?.khutbahTimeMinutes ?? 30;
    return {
      organization: {
        name: organization.name,
        slug: organization.slug,
        addressLine: organization.addressLine,
        city: organization.city,
        state: organization.state
      },
      date,
      timezoneId: organization.criteria?.timezoneId ?? 'UTC',
      timings: timings ?? undefined,
      iqama: iqama.map(entry => ({
        salah: entry.salah,
        time: entry.offsetMinutes == null ? entry.time : undefined,
        salahTime: entry.salah.startsWith('Jumuah') && entry.offsetMinutes == null
          ? this.addMinutes(entry.time, khutbahMinutes)
          : undefined,
        offsetMinutes: entry.offsetMinutes,
        note: entry.note,
        effectiveDate: entry.date
      }))
    };
  }

  private todayForTimezone(timezoneId?: string): string {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezoneId,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(new Date());
      const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
      return `${values['year']}-${values['month']}-${values['day']}`;
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  }

  private addMinutes(value: string, minutes: number): string {
    const [hours, mins] = value.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(mins)) return value;
    const total = (hours * 60 + mins + minutes) % (24 * 60);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  timeFor(key: string): string {
    const timings = this.display()?.timings;
    return timings ? this.formatTime(timings[key as keyof PrayerTimesDto]) : '—';
  }

  iqamaFor(salah: string): string {
    if (!salah) return 'No Iqama';
    const entry = this.display()?.iqama.find(item => item.salah === salah);
    if (!entry) return 'Not set';
    if (entry.time) return this.formatTime(entry.time);
    return entry.offsetMinutes !== undefined ? `+${entry.offsetMinutes} min` : 'Not set';
  }

  hasAdhanTimings() { return !!this.display()?.timings; }

  jumuahEntries() {
    const order = ['Jumuah', 'Jumuah2nd', 'Jumuah3rd', 'Jumuah4th'];
    return (this.display()?.iqama ?? [])
      .filter(item => order.includes(item.salah))
      .sort((a, b) => order.indexOf(a.salah) - order.indexOf(b.salah));
  }

  jumuahLabel(salah: string): string {
    return ({ Jumuah: '1st', Jumuah2nd: '2nd', Jumuah3rd: '3rd', Jumuah4th: '4th' } as Record<string, string>)[salah] ?? salah;
  }

  dateLabel(): string {
    const value = this.display()?.date;
    return value
      ? new Date(`${value}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : '';
  }

  criteriaSource(): string {
    const criteria = this.organization()?.criteria;
    if (!criteria) return '';
    const postalCode = criteria.zipCode ? `ZIP ${criteria.zipCode}` : `${criteria.latitude}, ${criteria.longitude}`;
    return `${criteria.method} · ${postalCode} · ${criteria.timezoneId}`;
  }

  previewDisplayTheme() {
    return resolvePrayerDisplayTheme(
      this.form.controls.headerImageUrl.value ?? '',
      this.form.controls.theme.value ?? 'default',
      'light'
    );
  }

  previewThemeStyles() {
    return prayerDisplayThemeCssVars(this.previewDisplayTheme(), this.display()?.tvConfig?.accentColor);
  }

  formatTime(value: string | undefined): string {
    if (!value) return '—';
    const [hours, minutes] = value.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return value;
    const period = hours >= 12 ? 'PM' : 'AM';
    return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${period}`;
  }

  save(successMessage = 'Design updated across every published view') {
    this.saving.set(true);
    const value = this.form.getRawValue();
    this.svc.put(this.orgId, {
      headerImageUrl: value.headerImageUrl || undefined,
      footerHtml: value.footerHtml || undefined,
      theme: value.theme || 'default',
      iqamaHeadings: (value.iqamaHeadings || '').split(',').map(item => item.trim()).filter(Boolean),
      tvFontScale: Number(value.tvFontScale) || 100,
      widgetFontScale: Number(value.widgetFontScale) || 100,
      compactFontScale: Number(value.compactFontScale) || 100,
      tvFontFamily: value.tvFontFamily as FontFamily,
      widgetFontFamily: value.widgetFontFamily as FontFamily,
      compactFontFamily: value.compactFontFamily as FontFamily
    }).subscribe({
      next: () => {
        this.reloadSavedState(successMessage);
      },
      error: () => {
        this.applyingWallpaper.set(null);
        this.saving.set(false);
        this.snack.open('Save failed', 'Dismiss', { duration: 3000 });
      }
    });
  }

  setWallpaperFilter(filter: PrayerWallpaperFilter) {
    this.wallpaperFilter.set(filter);
  }

  toggleWallpaperGallery() {
    this.galleryExpanded.update(expanded => !expanded);
  }

  applyWallpaper(wallpaper: PrayerWallpaper) {
    if (this.saving() || this.uploading() || this.isWallpaperSelected(wallpaper)) return;
    const publicUrl = new URL(wallpaper.src, window.location.origin).toString();
    this.form.controls.headerImageUrl.setValue(publicUrl);
    this.applyingWallpaper.set(wallpaper.id);
    this.save(`${wallpaper.name} applied to TV and website widgets`);
  }

  isWallpaperSelected(wallpaper: PrayerWallpaper): boolean {
    const current = this.form.controls.headerImageUrl.value;
    if (!current) return false;
    try {
      return new URL(current, window.location.origin).pathname === wallpaper.src;
    } catch {
      return false;
    }
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
    if (this.selectedFile) this.uploadHeaderImage();
  }

  uploadHeaderImage() {
    if (!this.selectedFile) return;
    this.uploading.set(true);
    this.svc.uploadHeaderImage(this.orgId, this.selectedFile).subscribe({
      next: result => {
        this.form.controls.headerImageUrl.setValue(result.publicUrl);
        this.reloadSavedState('Background applied to TV and website widgets');
      },
      error: () => {
        this.uploading.set(false);
        this.snack.open('Image upload failed', 'Dismiss', { duration: 3000 });
      }
    });
  }

  private reloadSavedState(message: string) {
    const slug = this.orgSlug();
    const organization = this.organization();
    if (!slug || !organization) {
      this.uploading.set(false);
      this.saving.set(false);
      return;
    }
    forkJoin({ design: this.svc.get(this.orgId), display: this.previewFor(organization) }).subscribe({
      next: ({ design, display }) => {
        this.form.patchValue({
          headerImageUrl: design.headerImageUrl ?? '',
          iqamaHeadings: design.iqamaHeadings.join(', '),
          footerHtml: design.footerHtml ?? '',
          theme: design.theme === 'light' ? 'default' : design.theme ?? 'default',
          tvFontScale: design.tvFontScale ?? 100,
          widgetFontScale: design.widgetFontScale ?? 100,
          compactFontScale: design.compactFontScale ?? 100,
          tvFontFamily: design.tvFontFamily ?? 'system',
          widgetFontFamily: design.widgetFontFamily ?? 'system',
          compactFontFamily: design.compactFontFamily ?? 'system'
        });
        this.display.set(display);
        this.applyingWallpaper.set(null);
        this.uploading.set(false);
        this.saving.set(false);
        this.snack.open(message, '', { duration: 2600 });
      },
      error: () => {
        this.applyingWallpaper.set(null);
        this.uploading.set(false);
        this.saving.set(false);
        this.snack.open('Saved, but the public preview could not be refreshed.', 'Retry', { duration: 4000 });
      }
    });
  }
}
