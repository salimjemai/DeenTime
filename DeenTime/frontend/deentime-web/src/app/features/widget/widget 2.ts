import { Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { PrayerTimesDto, PublicDisplay } from '../../models';
import { PublicDisplayService } from '../../services/public-display';

@Component({
  selector: 'app-widget',
  standalone: true,
  imports: [MatProgressSpinnerModule, MatCardModule, MatIconModule],
  templateUrl: './widget.html',
  styleUrl: './widget.scss'
})
export class WidgetComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private displayService = inject(PublicDisplayService);

  slug    = this.route.snapshot.params['slug'];
  variant = this.route.snapshot.data['variant'] ?? 'full';
  display = signal<PublicDisplay | null>(null);
  timings = signal<PrayerTimesDto | null>(null);
  loading = signal(true);
  error   = signal(false);

  prayers = [
    { key: 'fajr',    salah: 'Fajr',    label: 'Fajr'    },
    { key: 'dhuhr',   salah: 'Dhuhr',   label: 'Dhuhr'   },
    { key: 'asr',     salah: 'Asr',     label: 'Asr'     },
    { key: 'maghrib', salah: 'Maghrib', label: 'Maghrib' },
    { key: 'isha',    salah: 'Isha',    label: 'Isha'    },
  ];

  ngOnInit() {
    this.displayService.get(this.slug).subscribe({
      next: display => {
        this.display.set(display);
        this.timings.set(display.timings);
        this.loading.set(false);
      },
      error: () => { this.error.set(true); this.loading.set(false); }
    });
  }

  timeFor(key: string): string {
    const t = this.timings();
    return t ? this.formatTime(t[key as keyof PrayerTimesDto]) : '—';
  }

  formatTime(value: string | undefined): string {
    if (!value) return '—';
    const [hours, minutes] = value.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return value;
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  iqamaFor(salah: string): string {
    const entry = this.display()?.iqama.find(i => i.salah === salah);
    return entry ? this.formatTime(entry.time) : '—';
  }

  jumuahEntries() {
    return (this.display()?.iqama ?? []).filter(i => i.salah.toLowerCase().startsWith('jumuah'));
  }

  accentColor() { return this.display()?.tvConfig?.accentColor || '#3d8b63'; }

  dateLabel() {
    const value = this.display()?.date;
    return value ? new Date(`${value}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) : '';
  }
}
