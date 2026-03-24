import { Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatNativeDateModule } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { TimingsService } from '../../../services/timings';
import { AuthService } from '../../../services/auth';
import { PrayerTimesDto } from '../../../models';

@Component({
  selector: 'app-timings',
  standalone: true,
  imports: [
    FormsModule,
    MatCardModule, MatTableModule, MatDatepickerModule,
    MatFormFieldModule, MatInputModule, MatNativeDateModule,
    MatProgressSpinnerModule, MatIconModule
  ],
  templateUrl: './timings.html',
  styleUrl: './timings.scss'
})
export class TimingsComponent implements OnInit {
  private svc   = inject(TimingsService);
  private auth  = inject(AuthService);
  private route = inject(ActivatedRoute);

  orgId   = this.auth.getOrgId() ?? this.route.snapshot.params['slug'];
  loading = signal(false);
  timings = signal<PrayerTimesDto | null>(null);
  error   = signal('');
  selectedDate = new Date();

  prayers = [
    { key: 'fajr',    label: 'Fajr',    icon: 'wb_twilight' },
    { key: 'sunrise', label: 'Sunrise', icon: 'wb_sunny' },
    { key: 'dhuhr',   label: 'Dhuhr',   icon: 'wb_sunny' },
    { key: 'asr',     label: 'Asr',     icon: 'light_mode' },
    { key: 'maghrib', label: 'Maghrib', icon: 'wb_twighlight' },
    { key: 'sunset',  label: 'Sunset',  icon: 'wb_twilight' },
    { key: 'isha',    label: 'Isha',    icon: 'nights_stay' },
  ];

  ngOnInit() { this.load(); }

  load() {
    this.loading.set(true);
    this.error.set('');
    const date = this.toIso(this.selectedDate);
    this.svc.getForDate(this.orgId, date).subscribe({
      next: t => { this.timings.set(t); this.loading.set(false); },
      error: () => { this.error.set('Could not load prayer times. Check criteria are set.'); this.loading.set(false); }
    });
  }

  onDateChange(d: Date | null) {
    if (d) { this.selectedDate = d; this.load(); }
  }

  toIso(d: Date) {
    return d.toISOString().split('T')[0];
  }

  timeFor(key: string): string {
    const t = this.timings();
    return t ? (t as any)[key] : '—';
  }

  isToday() {
    return this.toIso(this.selectedDate) === this.toIso(new Date());
  }
}
