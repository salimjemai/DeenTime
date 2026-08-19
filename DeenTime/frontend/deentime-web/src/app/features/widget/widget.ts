import { Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { PrayerTimesDto, PublicDisplay } from '../../models';
import { PublicDisplayService } from '../../services/public-display';

@Component({
  selector: 'app-widget',
  standalone: true,
  imports: [MatProgressSpinnerModule, MatIconModule],
  templateUrl: './widget.html',
  styleUrl: './widget.scss'
})
export class WidgetComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private displayService = inject(PublicDisplayService);

  slug = this.route.snapshot.params['slug'];
  variant = this.route.snapshot.data['variant'] ?? 'full';
  display = signal<PublicDisplay | null>(null);
  timings = signal<PrayerTimesDto | null>(null);
  loading = signal(true);
  error = signal(false);

  prayers = [
    { key: 'fajr', salah: 'Fajr', label: 'Fajr', detail: 'Dawn' },
    { key: 'sunrise', salah: '', label: 'Sunrise', detail: 'Shuruq' },
    { key: 'dhuhr', salah: 'Dhuhr', label: 'Dhuhr', detail: 'Noon' },
    { key: 'asr', salah: 'Asr', label: 'Asr', detail: 'Afternoon' },
    { key: 'maghrib', salah: 'Maghrib', label: 'Maghrib', detail: 'Sunset' },
    { key: 'isha', salah: 'Isha', label: 'Isha', detail: 'Night' }
  ];

  ngOnInit() {
    this.displayService.get(this.slug, this.variant === 'compact' ? 'compact' : 'widget').subscribe({
      next: display => {
        this.display.set(display);
        this.timings.set(display.timings);
        this.loading.set(false);
      },
      error: () => { this.error.set(true); this.loading.set(false); }
    });
  }

  timeFor(key: string): string {
    const timings = this.timings();
    return timings ? this.formatTime(timings[key as keyof PrayerTimesDto]) : '—';
  }

  iqamaFor(salah: string): string {
    if (!salah) return '—';
    const entry = this.display()?.iqama.find(item => item.salah === salah);
    return entry ? this.formatTime(entry.time) : '—';
  }

  jumuahEntries() {
    const order = ['Jumuah', 'Jumuah2nd', 'Jumuah3rd', 'Jumuah4th'];
    return (this.display()?.iqama ?? [])
      .filter(item => order.includes(item.salah))
      .sort((a, b) => order.indexOf(a.salah) - order.indexOf(b.salah));
  }

  jumuahLabel(salah: string) {
    return ({ Jumuah: 'First', Jumuah2nd: 'Second', Jumuah3rd: 'Third', Jumuah4th: 'Fourth' } as Record<string, string>)[salah] ?? salah;
  }

  accentColor() { return this.display()?.tvConfig?.accentColor || '#3d8b63'; }

  fontScale() {
    const design = this.display()?.design;
    return this.variant === 'compact' ? design?.compactFontScale ?? 100 : design?.widgetFontScale ?? 100;
  }

  fontFamily() {
    const design = this.display()?.design;
    return this.variant === 'compact' ? design?.compactFontFamily ?? 'system' : design?.widgetFontFamily ?? 'system';
  }

  backgroundImage() {
    const image = this.display()?.design?.backgroundImageUrl ?? this.display()?.design?.headerImageUrl;
    return image ? `url("${image}")` : '';
  }

  dateLabel() {
    const value = this.display()?.date;
    return value ? new Date(`${value}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';
  }

  locationLabel() {
    const organization = this.display()?.organization;
    return organization ? [organization.city, organization.state].filter(Boolean).join(', ') : '';
  }

  formatTime(value: string | undefined): string {
    if (!value) return '—';
    const [hours, minutes] = value.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return value;
    return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')}`;
  }
}
