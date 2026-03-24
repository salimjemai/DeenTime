import { Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCardModule } from '@angular/material/card';
import { environment } from '../../../environments/environment';
import { PrayerTimesDto } from '../../models';

@Component({
  selector: 'app-widget',
  standalone: true,
  imports: [MatProgressSpinnerModule, MatCardModule],
  templateUrl: './widget.html',
  styleUrl: './widget.scss'
})
export class WidgetComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private http  = inject(HttpClient);

  slug    = this.route.snapshot.params['slug'];
  timings = signal<PrayerTimesDto | null>(null);
  loading = signal(true);

  prayers = [
    { key: 'fajr',    label: 'Fajr'    },
    { key: 'dhuhr',   label: 'Dhuhr'   },
    { key: 'asr',     label: 'Asr'     },
    { key: 'maghrib', label: 'Maghrib' },
    { key: 'isha',    label: 'Isha'    },
  ];

  ngOnInit() {
    const today = new Date().toISOString().split('T')[0];
    this.http.get<PrayerTimesDto>(`${environment.apiUrl}/api/v1/timings`, { params: { orgId: this.slug, date: today } }).subscribe({
      next: t => { this.timings.set(t); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  timeFor(key: string): string {
    const t = this.timings();
    return t ? (t as any)[key] : '—';
  }
}
