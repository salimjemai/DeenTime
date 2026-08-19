import { Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatNativeDateModule } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { TimingsService } from '../../../services/timings';
import { AuthService } from '../../../services/auth';
import { PrayerTimesDto } from '../../../models';
import { describeApiError } from '../../../services/api-error';

@Component({
  selector: 'app-timings',
  standalone: true,
  imports: [
    FormsModule,
    MatCardModule, MatTableModule, MatDatepickerModule,
    MatFormFieldModule, MatInputModule, MatNativeDateModule,
    MatProgressSpinnerModule, MatIconModule, MatButtonModule, RouterLink
  ],
  templateUrl: './timings.html',
  styleUrl: './timings.scss'
})
export class TimingsComponent implements OnInit {
  private svc   = inject(TimingsService);
  private auth  = inject(AuthService);
  private route = inject(ActivatedRoute);

  orgId   = this.auth.getOrgId() ?? this.route.snapshot.params['orgId'];
  loading = signal(false);
  timings = signal<PrayerTimesDto | null>(null);
  error   = signal('');
  needsCriteria = signal(false);
  selectedDate = new Date();

  prayers = [
    { key: 'fajr',    label: 'Fajr',    icon: 'wb_twilight' },
    { key: 'sunrise', label: 'Sunrise', icon: 'wb_sunny' },
    { key: 'dhuhr',   label: 'Dhuhr',   icon: 'wb_sunny' },
    { key: 'asr',     label: 'Asr',     icon: 'light_mode' },
    { key: 'maghrib', label: 'Maghrib', icon: 'wb_twilight' },
    { key: 'sunset',  label: 'Sunset',  icon: 'wb_twilight' },
    { key: 'isha',    label: 'Isha',    icon: 'nights_stay' },
  ];

  ngOnInit() { this.load(); }

  load() {
    this.loading.set(true);
    this.error.set('');
    this.needsCriteria.set(false);
    const date = this.toIso(this.selectedDate);
    this.svc.getForDate(this.orgId, date).subscribe({
      next: t => { this.timings.set(t); this.loading.set(false); },
      error: error => {
        const state = describeApiError(error, 'Could not load prayer times.');
        this.timings.set(null);
        this.needsCriteria.set(state.kind === 'not-found');
        if (state.kind !== 'not-found') this.error.set(state.message);
        this.loading.set(false);
      }
    });
  }

  onDateChange(d: Date | null) {
    if (d) { this.selectedDate = d; this.load(); }
  }

  toIso(d: Date) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  timeFor(key: string): string {
    const t = this.timings();
    return t ? this.formatTime(this.valueFor(t, key)) : '—';
  }

  private valueFor(t: PrayerTimesDto, key: string): string {
    return t[key as keyof PrayerTimesDto];
  }

  formatTime(value: string | undefined): string {
    if (!value) return '—';
    const [hours, minutes] = value.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return value;
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  nextPrayer(): { label: string; time: string } {
    const t = this.timings();
    if (!t) return { label: 'Next prayer', time: '—' };

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const upcoming = this.prayers
      .filter(p => !['sunrise', 'sunset'].includes(p.key))
      .map(p => {
        const raw = this.valueFor(t, p.key);
        const [hours, minutes] = raw.split(':').map(Number);
        return { label: p.label, raw, total: hours * 60 + minutes };
      })
      .find(p => p.total > nowMinutes);

    return upcoming
      ? { label: upcoming.label, time: this.formatTime(upcoming.raw) }
      : { label: 'Fajr tomorrow', time: this.formatTime(t.fajr) };
  }

  isToday() {
    return this.toIso(this.selectedDate) === this.toIso(new Date());
  }
}
