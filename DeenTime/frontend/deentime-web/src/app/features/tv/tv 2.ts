import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { PrayerTimesDto, PublicDisplay } from '../../models';
import { PublicDisplayService } from '../../services/public-display';

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

  slug     = this.route.snapshot.params['slug'];
  display  = signal<PublicDisplay | null>(null);
  timings  = signal<PrayerTimesDto | null>(null);
  clock    = signal('');
  loading  = signal(true);

  prayers  = ['fajr','dhuhr','asr','maghrib','isha'] as const;
  labels   = { fajr:'Fajr', dhuhr:'Dhuhr', asr:'Asr', maghrib:'Maghrib', isha:'Isha' };

  private clockInterval?: ReturnType<typeof setInterval>;
  private refreshInterval?: ReturnType<typeof setInterval>;

  ngOnInit() {
    this.loadTimings();
    this.clockInterval   = setInterval(() => this.updateClock(), 1000);
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
    const now = new Date();
    const showSeconds = this.display()?.tvConfig?.showSeconds ?? true;
    this.clock.set(now.toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit', ...(showSeconds ? { second: '2-digit' as const } : {})
    }));
  }

  private configureRefresh(seconds: number) {
    clearInterval(this.refreshInterval);
    this.refreshInterval = setInterval(() => this.loadTimings(), Math.max(15, seconds) * 1000);
  }

  timeFor(key: string): string {
    const t = this.timings();
    return t ? this.formatTime(t[key as keyof PrayerTimesDto]) : '—';
  }

  iqamaFor(salah: string): string {
    const entry = this.display()?.iqama.find(i => i.salah === salah);
    return entry ? this.formatTime(entry.time) : '—';
  }

  jumuahEntries() {
    return (this.display()?.iqama ?? []).filter(i => i.salah.toLowerCase().startsWith('jumuah'));
  }

  accentColor() { return this.display()?.tvConfig?.accentColor || '#55c978'; }

  showHijri() { return (this.display()?.tvConfig?.showHijri ?? true) && !!this.display()?.hijri; }

  dateLabel() {
    const value = this.display()?.date;
    return value ? new Date(`${value}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';
  }

  formatTime(value: string | undefined): string {
    if (!value) return '—';
    const [hours, minutes] = value.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return value;
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
}
