import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { forkJoin } from 'rxjs';
import { IqamaService } from '../../../services/iqama';
import { AuthService } from '../../../services/auth';
import { IqamaEntry, IqamaScheduleUpsertRequest, IqamaUpsertRequest, SalahType } from '../../../models';

interface QuickIqamaRow {
  salah: SalahType;
  label: string;
  detail: string;
  time: string;
  mode: 'fixed' | 'offset';
  offsetMinutes: number;
  note: string;
}

@Component({
  selector: 'app-iqama',
  standalone: true,
  imports: [
    FormsModule, MatCardModule, MatTableModule, MatButtonModule,
    MatIconModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatProgressSpinnerModule, MatSnackBarModule
  ],
  templateUrl: './iqama.html',
  styleUrl: './iqama.scss'
})
export class IqamaComponent implements OnInit {
  private svc   = inject(IqamaService);
  private auth  = inject(AuthService);
  private snack = inject(MatSnackBar);

  orgId     = this.auth.getOrgId() ?? '';
  year      = new Date().getFullYear();
  loading   = signal(false);
  error     = signal('');
  entries   = signal<IqamaEntry[]>([]);
  editingId = signal<string | null>(null);
  showPatternForm = signal(false);
  showOneOffForm = signal(false);
  addingPattern = signal(false);
  addingOneOff = signal(false);
  currentLoading = signal(false);
  quickSaving = signal(false);
  editBuf: Partial<IqamaUpsertRequest> = {};
  effectiveDate = this.localDateString(new Date());

  quickRows: QuickIqamaRow[] = [
    { salah: 'Fajr', label: 'Fajr', detail: 'Dawn prayer', time: '06:00', mode: 'fixed', offsetMinutes: 15, note: '' },
    { salah: 'Dhuhr', label: 'Dhuhr', detail: 'Noon prayer', time: '13:30', mode: 'fixed', offsetMinutes: 15, note: '' },
    { salah: 'Asr', label: 'Asr', detail: 'Afternoon prayer', time: '17:00', mode: 'fixed', offsetMinutes: 15, note: '' },
    { salah: 'Maghrib', label: 'Maghrib', detail: 'Sunset prayer', time: '18:30', mode: 'offset', offsetMinutes: 10, note: '' },
    { salah: 'Isha', label: 'Isha', detail: 'Night prayer', time: '20:30', mode: 'fixed', offsetMinutes: 15, note: '' }
  ];

  salahs: SalahType[] = ['Fajr','Dhuhr','Asr','Maghrib','Isha','Jumuah','Jumuah2nd','Jumuah3rd','Jumuah4th'];
  months = [{ value: 0, label: 'Every month' }, ...Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: new Date(2000, i).toLocaleString('default', { month: 'long' }) }))];
  frequencies = ['First', 'Second', 'Third', 'Fourth', 'Last'] as const;
  weekdays = [
    { value: 0, label: 'Sunday' }, { value: 1, label: 'Monday' }, { value: 2, label: 'Tuesday' },
    { value: 3, label: 'Wednesday' }, { value: 4, label: 'Thursday' }, { value: 5, label: 'Friday' }, { value: 6, label: 'Saturday' }
  ];
  patternMonth = new Date().getMonth() + 1;
  patternFrequency: 'First' | 'Second' | 'Third' | 'Fourth' | 'Last' = 'First';
  patternWeekday = 5;
  patternSalah: SalahType = 'Jumuah';
  patternTime = '12:00';
  patternOffsetMinutes: number | null = null;
  patternNote = '';
  oneOffDate = this.effectiveDate;
  oneOffSalah: SalahType = 'Jumuah';
  oneOffTime = '12:30';
  oneOffOffsetMinutes: number | null = null;
  oneOffNote = '';
  columns = ['date','salah','time','note','actions'];

  ngOnInit() {
    this.load();
    this.loadCurrentSchedule();
  }

  loadCurrentSchedule() {
    this.currentLoading.set(true);
    this.svc.current(this.orgId, this.effectiveDate).subscribe({
      next: entries => {
        const current = new Map(entries.map(entry => [entry.salah, entry]));
        this.quickRows = this.quickRows.map(row => {
          const entry = current.get(row.salah);
          if (!entry) return row;
          return {
            ...row,
            time: this.normalizeTime(entry.time),
            mode: entry.offsetMinutes === null || entry.offsetMinutes === undefined ? 'fixed' : 'offset',
            offsetMinutes: entry.offsetMinutes ?? row.offsetMinutes,
            note: entry.note ?? ''
          };
        });
        this.currentLoading.set(false);
      },
      error: () => {
        this.currentLoading.set(false);
        this.snack.open('Could not load the active Iqama times', 'Dismiss', { duration: 3000 });
      }
    });
  }

  saveCurrentSchedule() {
    const request: IqamaScheduleUpsertRequest = {
      organizationId: this.orgId,
      effectiveDate: this.effectiveDate,
      entries: this.quickRows.map(row => ({
        salah: row.salah,
        time: row.time,
        note: row.note || undefined,
        offsetMinutes: row.mode === 'offset' ? Number(row.offsetMinutes) : null
      }))
    };

    this.quickSaving.set(true);
    this.svc.saveSchedule(request).subscribe({
      next: () => {
        this.quickSaving.set(false);
        this.year = Number(this.effectiveDate.slice(0, 4));
        this.load();
        this.loadCurrentSchedule();
        this.snack.open('This masjid’s Iqama times are now live', '', { duration: 3000 });
      },
      error: () => {
        this.quickSaving.set(false);
        this.snack.open('Could not save the Iqama schedule', 'Dismiss', { duration: 3200 });
      }
    });
  }

  load() {
    this.loading.set(true);
    this.error.set('');
    this.svc.list(this.orgId, this.year).subscribe({
      next: e => { this.entries.set(e); this.loading.set(false); },
      error: () => {
        this.error.set('Could not load the Iqama schedule.');
        this.loading.set(false);
      }
    });
  }

  startEdit(e: IqamaEntry) {
    this.editingId.set(e.id);
    this.editBuf = { date: e.date, salah: e.salah, time: e.time, note: e.note, offsetMinutes: e.offsetMinutes };
  }

  cancelEdit() { this.editingId.set(null); this.editBuf = {}; }

  saveEdit(e: IqamaEntry) {
    const body: IqamaUpsertRequest = {
      organizationId: this.orgId,
      date: this.editBuf.date ?? e.date,
      salah: this.editBuf.salah ?? e.salah,
      time: this.editBuf.time ?? e.time,
      note: this.editBuf.note,
      offsetMinutes: this.editBuf.offsetMinutes ?? undefined
    };
    this.svc.update(e.id, body).subscribe({
      next: () => { this.cancelEdit(); this.load(); this.snack.open('Saved', '', { duration: 2000 }); },
      error: () => this.snack.open('Save failed', 'Dismiss', { duration: 3000 })
    });
  }

  delete(id: string) {
    this.svc.delete(id).subscribe({
      next: () => { this.load(); this.snack.open('Deleted', '', { duration: 2000 }); },
      error: () => this.snack.open('Delete failed', 'Dismiss', { duration: 3000 })
    });
  }

  addRow() {
    const body: IqamaUpsertRequest = {
      organizationId: this.orgId,
      date: this.oneOffDate,
      salah: this.oneOffSalah,
      time: this.oneOffTime,
      note: this.oneOffNote || undefined,
      offsetMinutes: this.oneOffOffsetMinutes ?? undefined
    };
    this.addingOneOff.set(true);
    this.svc.create(body).subscribe({
      next: () => {
        this.addingOneOff.set(false);
        this.showOneOffForm.set(false);
        this.year = Number(this.oneOffDate.slice(0, 4));
        this.load();
        this.loadCurrentSchedule();
        this.snack.open('One-off Iqama change scheduled', '', { duration: 2400 });
      },
      error: () => {
        this.addingOneOff.set(false);
        this.snack.open('That prayer already has an entry on this date', 'Dismiss', { duration: 3200 });
      }
    });
  }

  addPattern() {
    this.addingPattern.set(true);
    const months = this.patternMonth === 0 ? Array.from({ length: 12 }, (_, i) => i + 1) : [this.patternMonth];
    const existing = new Set(this.entries().map(entry => `${entry.date}|${entry.salah}`));
    const requests = months
      .map(month => this.patternDate(this.year, month, this.patternFrequency, this.patternWeekday))
      .filter((date): date is string => !!date)
      .filter(date => !existing.has(`${date}|${this.patternSalah}`))
      .map(date => this.svc.create({
        organizationId: this.orgId,
        date,
        salah: this.patternSalah,
        time: this.patternTime,
        note: this.patternNote || undefined,
        offsetMinutes: this.patternOffsetMinutes ?? undefined
      }));

    if (requests.length === 0) {
      this.addingPattern.set(false);
      this.snack.open('That pattern is already scheduled for this year.', 'Dismiss', { duration: 3000 });
      return;
    }

    forkJoin(requests).subscribe({
      next: () => {
        this.addingPattern.set(false);
        this.showPatternForm.set(false);
        this.load();
        this.snack.open(`${requests.length} recurring date${requests.length === 1 ? '' : 's'} added`, '', { duration: 3000 });
      },
      error: () => {
        this.addingPattern.set(false);
        this.snack.open('Could not add the recurring pattern', 'Dismiss', { duration: 3000 });
      }
    });
  }

  private patternDate(year: number, month: number, frequency: 'First' | 'Second' | 'Third' | 'Fourth' | 'Last', weekday: number): string | null {
    if (frequency === 'Last') {
      const last = new Date(year, month, 0);
      const offset = (last.getDay() - weekday + 7) % 7;
      last.setDate(last.getDate() - offset);
      return this.localDateString(last);
    }

    const occurrence = this.frequencies.indexOf(frequency) + 1;
    const first = new Date(year, month - 1, 1);
    const offset = (weekday - first.getDay() + 7) % 7;
    const date = 1 + offset + (occurrence - 1) * 7;
    const result = new Date(year, month - 1, date);
    return result.getMonth() === month - 1 ? this.localDateString(result) : null;
  }

  private localDateString(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }

  private normalizeTime(value: string): string {
    return value?.slice(0, 5) || '00:00';
  }

  displayEntryTime(entry: IqamaEntry): string {
    return entry.offsetMinutes !== null && entry.offsetMinutes !== undefined
      ? `+${entry.offsetMinutes} min after start`
      : this.normalizeTime(entry.time);
  }

  changeYear(delta: number) { this.year += delta; this.load(); }
}
