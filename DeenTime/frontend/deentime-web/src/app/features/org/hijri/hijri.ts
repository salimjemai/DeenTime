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

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

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
  columns = ['month','hijriDayOnFirst','locked','actions'];

  monthName(m: number) { return MONTHS[m - 1] ?? m; }

  ngOnInit() { this.load(); }

  load() {
    this.loading.set(true);
    const from = `${this.year}-01`;
    const to   = `${this.year}-12`;
    this.svc.list(this.orgId, from, to).subscribe({
      next: r => { this.rows.set(r); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  save(row: HijriMonthMap) {
    this.svc.update(row.id, row).subscribe({
      next: () => this.snack.open('Saved', '', { duration: 2000 }),
      error: () => this.snack.open('Save failed', 'Dismiss', { duration: 3000 })
    });
  }

  regenerate() {
    this.svc.regenerate(this.orgId, `${this.year}-01`, `${this.year}-12`).subscribe({
      next: () => { this.load(); this.snack.open('Regenerated', '', { duration: 2000 }); },
      error: () => this.snack.open('Failed', 'Dismiss', { duration: 3000 })
    });
  }

  changeYear(delta: number) { this.year += delta; this.load(); }
}
