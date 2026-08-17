import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { PrayerTimesDto, PublicDisplay } from '../../models';
import { PublicDisplayService } from '../../services/public-display';

type PrayerKey = 'fajr' | 'sunrise' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';

@Component({
  selector: 'app-tv',
  standalone: true,
  imports: [MatProgressSpinnerModule],
  templateUrl: './tv.html',
  styleUrl: './tv.scss'
})
export class TvComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private displayService = inject(PublicDisplayService);

  slug = this.route.snapshot.params['slug'];
  display = signal<PublicDisplay | null>(null);
  timings = signal<PrayerTimesDto | null>(null);
  clockTime = signal('');
  clockPeriod = signal('');
  clockSeconds = signal('');
  loading = signal(true);

  prayers: { key: PrayerKey; salah?: string; label: string; detail: string }[] = [
    { key: 'fajr', salah: 'Fajr', label: 'Fajr', detail: 'Dawn' },
    { key: 'sunrise', label: 'Sunrise', detail: 'Shuruq' },
    { key: 'dhuhr', salah: 'Dhuhr', label: 'Dhuhr', detail: 'Noon' },
    { key: 'asr', salah: 'Asr', label: 'Asr', detail: 'Afternoon' },
    { key: 'maghrib', salah: 'Maghrib', label: 'Maghrib', detail: 'Sunset' },
    { key: 'isha', salah: 'Isha', label: 'Isha', detail: 'Night' }
  ];

  private clockInterval?: ReturnType<typeof setInterval>;
  private refreshInterval?: ReturnType<typeof setInterval>;

  ngOnInit() {
    this.loadTimings();
    this.clockInterval = setInterval(() => this.updateClock(), 1000);
    this.updateClock();
  }

  ngOnDestroy() {
    clearInterval(this.clockInterval);
    clearInterval(this.refreshInterval);
  }

  private loadTimings() {
    this.displayService.get(this.slug).subscribe({
      next: display => {
        this.display.set(display);
        this.timings.set(display.timings);
        this.configureRefresh(display.tvConfig?.autoRefreshSeconds ?? 60);
        this.updateClock();
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  private updateClock() {
    const showSeconds = this.display()?.tvConfig?.showSeconds ?? true;
    const parts = new Intl.DateTimeFormat([], {
      timeZone: this.display()?.timezoneId || undefined,
      hour: 'numeric',
      minute: '2-digit',
      second: showSeconds ? '2-digit' : undefined,
      hour12: true
    }).formatToParts(new Date());
    const value = Object.fromEntries(parts.map(part => [part.type, part.value])) as Record<string, string>;
    this.clockTime.set(`${value['hour'] ?? ''}:${value['minute'] ?? ''}`);
    this.clockSeconds.set(showSeconds ? value['second'] ?? '' : '');
    this.clockPeriod.set(value['dayPeriod'] ?? '');
  }

  private configureRefresh(seconds: number) {
    clearInterval(this.refreshInterval);
    this.refreshInterval = setInterval(() => this.loadTimings(), Math.max(15, seconds) * 1000);
  }

  timeFor(key: PrayerKey): string {
    const timings = this.timings();
    return timings ? this.formatTime(timings[key]) : '—';
  }

  iqamaFor(salah: string | undefined): string {
    if (!salah) return '—';
    const entry = this.display()?.iqama.find(item => item.salah === salah);
    return entry ? this.formatTime(entry.time) : 'Not set';
  }

  hasIqama(salah: string | undefined): boolean {
    return !!salah && !!this.display()?.iqama.some(item => item.salah === salah);
  }

  jumuahEntries() {
    const order = ['Jumuah', 'Jumuah2nd', 'Jumuah3rd', 'Jumuah4th'];
    return (this.display()?.iqama ?? [])
      .filter(item => order.includes(item.salah))
      .sort((a, b) => order.indexOf(a.salah) - order.indexOf(b.salah));
  }

  jumuahLabel(salah: string) {
    return ({ Jumuah: '1st Friday', Jumuah2nd: '2nd Friday', Jumuah3rd: '3rd Friday', Jumuah4th: '4th Friday' } as Record<string, string>)[salah] ?? salah;
  }

  accentColor() { return this.display()?.tvConfig?.accentColor || '#42c6d9'; }

  showHijri() { return (this.display()?.tvConfig?.showHijri ?? true) && !!this.display()?.hijri; }

  dateLabel() {
    const value = this.display()?.date;
    return value ? new Date(`${value}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';
  }

  locationLabel() {
    const organization = this.display()?.organization;
    return organization ? [organization.city, organization.state].filter(Boolean).join(', ') : '';
  }

  heroBackground() {
    const image = this.display()?.design?.backgroundImageUrl ?? this.display()?.design?.headerImageUrl;
    return image ? `url("${image}")` : '';
  }

  formatTime(value: string | undefined): string {
    if (!value) return '—';
    const [hours, minutes] = value.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return value;
    return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')}`;
  }
}
