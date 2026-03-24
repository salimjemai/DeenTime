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
import { IqamaService } from '../../../services/iqama';
import { AuthService } from '../../../services/auth';
import { IqamaEntry, IqamaUpsertRequest, SalahType } from '../../../models';

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
  entries   = signal<IqamaEntry[]>([]);
  editingId = signal<string | null>(null);
  editBuf: Partial<IqamaUpsertRequest> = {};

  salahs: SalahType[] = ['Fajr','Dhuhr','Asr','Maghrib','Isha','Jumuah'];
  columns = ['date','salah','time','note','actions'];

  ngOnInit() { this.load(); }

  load() {
    this.loading.set(true);
    this.svc.list(this.orgId, this.year).subscribe({
      next: e => { this.entries.set(e); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  startEdit(e: IqamaEntry) {
    this.editingId.set(e.id);
    this.editBuf = { date: e.date, salah: e.salah, time: e.time, note: e.note };
  }

  cancelEdit() { this.editingId.set(null); this.editBuf = {}; }

  saveEdit(e: IqamaEntry) {
    const body: IqamaUpsertRequest = {
      organizationId: this.orgId,
      date: this.editBuf.date ?? e.date,
      salah: this.editBuf.salah ?? e.salah,
      time: this.editBuf.time ?? e.time,
      note: this.editBuf.note
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
    const today = new Date().toISOString().split('T')[0];
    const body: IqamaUpsertRequest = { organizationId: this.orgId, date: today, salah: 'Fajr', time: '05:30' };
    this.svc.create(body).subscribe({
      next: () => { this.load(); this.snack.open('Row added', '', { duration: 2000 }); },
      error: () => this.snack.open('Could not add row', 'Dismiss', { duration: 3000 })
    });
  }

  changeYear(delta: number) { this.year += delta; this.load(); }
}
