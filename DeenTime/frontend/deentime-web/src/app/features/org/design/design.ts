import { Component, inject, signal, OnInit } from '@angular/core';
import { ReactiveFormsModule, FormBuilder } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { DesignService } from '../../../services/design';
import { AuthService } from '../../../services/auth';

@Component({
  selector: 'app-design',
  standalone: true,
  imports: [
    ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatSelectModule, MatProgressSpinnerModule, MatSnackBarModule
  ],
  templateUrl: './design.html',
  styleUrl: './design.scss'
})
export class DesignComponent implements OnInit {
  private svc   = inject(DesignService);
  private auth  = inject(AuthService);
  private snack = inject(MatSnackBar);
  private fb    = inject(FormBuilder);

  orgId   = this.auth.getOrgId() ?? '';
  loading = signal(false);
  saving  = signal(false);

  form = this.fb.group({
    headerImageUrl: [''],
    footerHtml:     [''],
    theme:          ['default']
  });

  themes = ['default','dark','classic'];

  ngOnInit() {
    this.loading.set(true);
    this.svc.get(this.orgId).subscribe({
      next: d => { this.form.patchValue(d as any); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  save() {
    this.saving.set(true);
    this.svc.put(this.orgId, { ...this.form.value, iqamaHeadings: [] } as any).subscribe({
      next: () => { this.saving.set(false); this.snack.open('Saved', '', { duration: 2000 }); },
      error: () => { this.saving.set(false); this.snack.open('Save failed', 'Dismiss', { duration: 3000 }); }
    });
  }
}
