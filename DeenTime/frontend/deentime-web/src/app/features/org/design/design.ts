import { Component, inject, signal, OnInit } from '@angular/core';
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
import { PrayerTimesDto, PublicDisplay } from '../../../models';

@Component({
  selector: 'app-design',
  standalone: true,
  imports: [
    ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule,
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
  private snack = inject(MatSnackBar);
  private fb    = inject(FormBuilder);

  orgId   = this.auth.getOrgId() ?? '';
  loading = signal(false);
  saving  = signal(false);
  uploading = signal(false);
  previewLoading = signal(true);
  previewError = signal(false);
  display = signal<PublicDisplay | null>(null);
  orgSlug = signal('');
  selectedFile: File | null = null;

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
    theme:          ['default']
  });

  themes = ['default','dark','classic'];

  ngOnInit() {
    this.loading.set(true);
    this.svc.get(this.orgId).subscribe({
      next: d => {
        this.form.patchValue({
          headerImageUrl: d.headerImageUrl ?? '',
          iqamaHeadings: d.iqamaHeadings.join(', '),
          footerHtml: d.footerHtml ?? '',
          theme: d.theme ?? 'default'
        });
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });

    this.orgs.get(this.orgId).subscribe({
      next: organization => {
        this.orgSlug.set(organization.slug);
        this.publicDisplay.get(organization.slug).subscribe({
          next: display => {
            this.display.set(display);
            this.previewLoading.set(false);
          },
          error: () => {
            this.previewError.set(true);
            this.previewLoading.set(false);
          }
        });
      },
      error: () => {
        this.previewError.set(true);
        this.previewLoading.set(false);
      }
    });
  }

  timeFor(key: string): string {
    const timings = this.display()?.timings;
    return timings ? this.formatTime(timings[key as keyof PrayerTimesDto]) : '—';
  }

  iqamaFor(salah: string): string {
    if (!salah) return 'No Iqama';
    const entry = this.display()?.iqama.find(item => item.salah === salah);
    return entry ? this.formatTime(entry.time) : 'Not set';
  }

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

  formatTime(value: string | undefined): string {
    if (!value) return '—';
    const [hours, minutes] = value.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return value;
    const period = hours >= 12 ? 'PM' : 'AM';
    return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${period}`;
  }

  save() {
    this.saving.set(true);
    const value = this.form.getRawValue();
    this.svc.put(this.orgId, {
      headerImageUrl: value.headerImageUrl || undefined,
      footerHtml: value.footerHtml || undefined,
      theme: value.theme || 'default',
      iqamaHeadings: (value.iqamaHeadings || '').split(',').map(item => item.trim()).filter(Boolean)
    }).subscribe({
      next: () => {
        this.updatePreviewDesign(value.headerImageUrl || undefined);
        this.saving.set(false);
        this.snack.open('Design updated across every published view', '', { duration: 2600 });
      },
      error: () => { this.saving.set(false); this.snack.open('Save failed', 'Dismiss', { duration: 3000 }); }
    });
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
        this.updatePreviewDesign(result.publicUrl);
        this.uploading.set(false);
        this.snack.open('Background applied to TV and website widgets', '', { duration: 3200 });
      },
      error: () => {
        this.uploading.set(false);
        this.snack.open('Image upload failed', 'Dismiss', { duration: 3000 });
      }
    });
  }

  private updatePreviewDesign(imageUrl?: string) {
    const headings = (this.form.controls.iqamaHeadings.value || '')
      .split(',').map(item => item.trim()).filter(Boolean);
    this.display.update(current => current ? {
      ...current,
      design: {
        headerImageUrl: imageUrl,
        backgroundImageUrl: imageUrl,
        iqamaHeadings: headings,
        footerHtml: this.form.controls.footerHtml.value || undefined,
        theme: this.form.controls.theme.value || 'default'
      }
    } : current);
  }
}
