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

  orgForm = this.fb.nonNullable.group({
    name:        ['', Validators.required],
    addressLine: [''], city: [''], state: [''], zipCode: [''],
    phone: [''], websiteUrl: [''], email: [''], socialUrl: ['']
  });

  criteriaForm = this.fb.nonNullable.group({
    zipCode:             [''],
    method:             ['ISNA'],
    juristicMethodAsr:  ['Other'],
    latitude:           [0, Validators.required],
    longitude:          [0, Validators.required],
    timezoneId:         ['America/Chicago'],
    dstObserved:        [true],
    dstBegins:          [''],
    dstEnds:            [''],
    minutesAfterZawal:  [1],
    minutesAfterMaghrib:[2],
    khutbahTimeMinutes: [30]
  });

  methods = ['ISNA','MWL','Egyptian','Karachi','UmmAlQura','Gulf','Kuwait','Qatar','Tehran','Jafari'];
  juristicMethods = ['Other','Hanafi'];
  timezones = [
    { value: 'America/New_York', label: 'Eastern' },
    { value: 'America/Chicago', label: 'Central' },
    { value: 'America/Denver', label: 'Mountain' },
    { value: 'America/Los_Angeles', label: 'Pacific' },
    { value: 'America/Anchorage', label: 'Alaska' }
  ];

  ngOnInit() {
    this.loading.set(true);
    this.orgs.get(this.orgId).subscribe(org => {
      this.orgForm.patchValue({
        name: org.name,
        addressLine: org.addressLine ?? '',
        city: org.city ?? '',
        state: org.state ?? '',
        zipCode: org.zipCode ?? '',
        phone: org.phone ?? '',
        websiteUrl: org.websiteUrl ?? '',
        email: org.email ?? '',
        socialUrl: org.socialUrl ?? ''
      });
      if (org.criteria) {
        this.criteriaForm.patchValue({
          zipCode: org.criteria.zipCode,
          method: org.criteria.method,
          juristicMethodAsr: org.criteria.juristicMethodAsr,
          latitude: org.criteria.latitude,
          longitude: org.criteria.longitude,
          timezoneId: org.criteria.timezoneId,
          dstObserved: org.criteria.dstObserved,
          dstBegins: org.criteria.dstBegins ?? '',
          dstEnds: org.criteria.dstEnds ?? '',
          minutesAfterZawal: org.criteria.minutesAfterZawal,
          minutesAfterMaghrib: org.criteria.minutesAfterMaghrib,
          khutbahTimeMinutes: org.criteria.khutbahTimeMinutes
        });
      }
      this.loading.set(false);
    });
  }

  saveOrg() {
    if (this.orgForm.invalid) return;
    this.saving.set(true);
    this.orgs.update(this.orgId, this.orgForm.getRawValue()).subscribe({
      next: () => { this.saving.set(false); this.snack.open('Saved', '', { duration: 2000 }); },
      error: () => { this.saving.set(false); this.snack.open('Save failed', 'Dismiss', { duration: 3000 }); }
    });
  }

  saveCriteria() {
    this.saving.set(true);
    const raw = this.criteriaForm.getRawValue();
    this.orgs.putCriteria(this.orgId, {
      organizationId: this.orgId,
      ...raw,
      dstBegins: raw.dstBegins || undefined,
      dstEnds: raw.dstEnds || undefined
    }).subscribe({
      next: () => { this.saving.set(false); this.snack.open('Criteria saved', '', { duration: 2000 }); },
      error: () => { this.saving.set(false); this.snack.open('Save failed', 'Dismiss', { duration: 3000 }); }
    });
  }

  resetCriteria() {
    if (!window.confirm('Remove the prayer timing criteria? Public timings will be unavailable until new criteria are saved.')) return;
    this.saving.set(true);
    this.orgs.deleteCriteria(this.orgId).subscribe({
      next: () => {
        this.saving.set(false);
        this.criteriaForm.reset({
          zipCode: '', method: 'ISNA', juristicMethodAsr: 'Other', latitude: 0, longitude: 0,
          timezoneId: 'America/Chicago', dstObserved: true, dstBegins: '', dstEnds: '',
          minutesAfterZawal: 1, minutesAfterMaghrib: 2, khutbahTimeMinutes: 30
        });
        this.snack.open('Prayer criteria removed', '', { duration: 2500 });
      },
      error: () => { this.saving.set(false); this.snack.open('Could not remove criteria', 'Dismiss', { duration: 3000 }); }
    });
  }
}
