import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { environment } from '../../../environments/environment';
import { PrayerTimesDto } from '../../models';

@Component({
  selector: 'app-tv',
  standalone: true,
  imports: [MatProgressSpinnerModule],
  templateUrl: './tv.html',
  styleUrl: './tv.scss'
})
export class TvComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private http  = inject(HttpClient);

  slug     = this.route.snapshot.params['slug'];
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
    this.refreshInterval = setInterval(() => this.loadTimings(), 60_000);
    this.updateClock();
  }

  ngOnDestroy() {
    clearInterval(this.clockInterval);
    clearInterval(this.refreshInterval);
  }

  private loadTimings() {
    const today = new Date().toISOString().split('T')[0];
    this.http.get<PrayerTimesDto>(`${environment.apiUrl}/api/v1/timings`, { params: { orgId: this.slug, date: today } }).subscribe({
      next: t => { this.timings.set(t); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  private updateClock() {
    const now = new Date();
    this.clock.set(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  }

  timeFor(key: string): string {
    const t = this.timings();
    return t ? (t as any)[key] : '—';
  }
}
