import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { HijriService } from '../../../services/hijri';
import { AuthService } from '../../../services/auth';
import { HijriMonthMap } from '../../../models';
import { apiErrorMessage } from '../../../services/api-error';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

@Component({
  selector: 'app-hijri',
  standalone: true,
  imports: [
    FormsModule, MatCardModule, MatTableModule, MatButtonModule,
    MatIconModule, MatInputModule, MatFormFieldModule, MatCheckboxModule,
    MatProgressSpinnerModule, MatSnackBarModule
  ],
  templateUrl: './hijri.html',
  styleUrl: './hijri.scss'
})
export class HijriComponent implements OnInit {
  private svc   = inject(HijriService);
  private auth  = inject(AuthService);
  private snack = inject(MatSnackBar);

  orgId   = this.auth.getOrgId() ?? '';
  year    = new Date().getFullYear();
  loading = signal(false);
  rows    = signal<HijriMonthMap[]>([]);
  error   = signal('');
  columns = ['month','hijriDateOnFirst','locked','actions'];

  monthName(row: HijriMonthMap) { return `${MONTHS[row.month - 1] ?? row.month} ${row.year}`; }

  ngOnInit() { this.load(); }

  load() {
    this.loading.set(true);
    this.error.set('');
    const from = `${this.year - 1}-12`;
    const to   = `${this.year + 1}-03`;
    this.svc.list(this.orgId, from, to).subscribe({
      next: r => { this.rows.set(r); this.loading.set(false); },
      error: error => { this.error.set(apiErrorMessage(error, 'Could not load the Hijri calendar.')); this.loading.set(false); }
    });
  }

  save(row: HijriMonthMap) {
    this.svc.update(row.id, row).subscribe({
      next: () => this.snack.open('Saved', '', { duration: 2000 }),
      error: () => this.snack.open('Save failed', 'Dismiss', { duration: 3000 })
    });
  }

  regenerate() {
    this.svc.regenerate(this.orgId, `${this.year - 1}-12`, `${this.year + 1}-03`).subscribe({
      next: () => { this.load(); this.snack.open('Regenerated', '', { duration: 2000 }); },
      error: () => this.snack.open('Failed', 'Dismiss', { duration: 3000 })
    });
  }

  hijriDate(row: HijriMonthMap) {
    return `${row.hijriDayOnFirst}-${row.hijriMonthOnFirst}-${row.hijriYearOnFirst}`;
  }

  setHijriDate(row: HijriMonthMap, value: string) {
    const parts = value.trim().split(/[/-]/).map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return;
    [row.hijriDayOnFirst, row.hijriMonthOnFirst, row.hijriYearOnFirst] = parts;
  }

  changeYear(delta: number) { this.year += delta; this.load(); }
}
