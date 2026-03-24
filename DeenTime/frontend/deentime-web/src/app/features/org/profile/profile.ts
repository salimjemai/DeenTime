import { Component, inject, signal, OnInit } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { OrgsService } from '../../../services/orgs';
import { AuthService } from '../../../services/auth';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatSelectModule, MatCheckboxModule,
    MatProgressSpinnerModule, MatSnackBarModule, MatDividerModule
  ],
  templateUrl: './profile.html',
  styleUrl: './profile.scss'
})
export class ProfileComponent implements OnInit {
  private orgs  = inject(OrgsService);
  private auth  = inject(AuthService);
  private snack = inject(MatSnackBar);
  private fb    = inject(FormBuilder);

  orgId   = this.auth.getOrgId() ?? '';
  loading = signal(false);
  saving  = signal(false);

  orgForm = this.fb.group({
    name:        ['', Validators.required],
    addressLine: [''], city: [''], state: [''], zipCode: [''],
    phone: [''], websiteUrl: [''], email: [''], socialUrl: ['']
  });

  criteriaForm = this.fb.group({
    method:             ['ISNA'],
    juristicMethodAsr:  ['Other'],
    latitude:           [0, Validators.required],
    longitude:          [0, Validators.required],
    timezoneId:         ['America/Chicago'],
    minutesAfterZawal:  [1],
    minutesAfterMaghrib:[2],
    khutbahTimeMinutes: [30]
  });

  methods = ['ISNA','MWL','Egyptian','Karachi','UmmAlQura','Gulf','Kuwait','Qatar','Tehran','Jafari'];
  juristicMethods = ['Other','Hanafi'];

  ngOnInit() {
    this.loading.set(true);
    this.orgs.get(this.orgId).subscribe(org => {
      this.orgForm.patchValue(org as any);
      if (org.criteria) this.criteriaForm.patchValue(org.criteria as any);
      this.loading.set(false);
    });
  }

  saveOrg() {
    if (this.orgForm.invalid) return;
    this.saving.set(true);
    this.orgs.update(this.orgId, this.orgForm.value as any).subscribe({
      next: () => { this.saving.set(false); this.snack.open('Saved', '', { duration: 2000 }); },
      error: () => { this.saving.set(false); this.snack.open('Save failed', 'Dismiss', { duration: 3000 }); }
    });
  }

  saveCriteria() {
    this.saving.set(true);
    this.orgs.putCriteria(this.orgId, { organizationId: this.orgId, ...this.criteriaForm.value } as any).subscribe({
      next: () => { this.saving.set(false); this.snack.open('Criteria saved', '', { duration: 2000 }); },
      error: () => { this.saving.set(false); this.snack.open('Save failed', 'Dismiss', { duration: 3000 }); }
    });
  }
}
