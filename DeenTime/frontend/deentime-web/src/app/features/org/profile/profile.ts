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
import { MatIconModule } from '@angular/material/icon';
import { OrgsService } from '../../../services/orgs';
import { AuthService } from '../../../services/auth';
import { PostalCodeLocation } from '../../../models';

interface ApiFailure {
  error?: {
    errors?: Record<string, string[]>;
    detail?: string;
    title?: string;
    message?: string;
  };
}

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatSelectModule, MatCheckboxModule,
    MatProgressSpinnerModule, MatSnackBarModule, MatDividerModule, MatIconModule
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
  resolvingLocation = signal(false);
  resolvedLocation = signal<PostalCodeLocation | null>(null);
  locationError = signal('');

  orgForm = this.fb.nonNullable.group({
    name:        ['', Validators.required],
    addressLine: [''], city: [''], state: [''], zipCode: [''],
    phone: [''], websiteUrl: [''], email: [''], socialUrl: ['']
  });

  criteriaForm = this.fb.nonNullable.group({
    zipCode:             [''],
    method:             ['ISNA'],
    juristicMethodAsr:  ['Other'],
    latitude:           [0, [Validators.required, Validators.min(-90), Validators.max(90)]],
    longitude:          [0, [Validators.required, Validators.min(-180), Validators.max(180)]],
    timezoneId:         ['America/Chicago'],
    dstObserved:        [true],
    dstBegins:          [''],
    dstEnds:            [''],
    minutesAfterZawal:  [5, [Validators.required, Validators.min(0), Validators.max(120)]],
    minutesAfterMaghrib:[1, [Validators.required, Validators.min(0), Validators.max(120)]],
    khutbahTimeMinutes: [20, [Validators.required, Validators.min(0), Validators.max(180)]]
  });

  methods = ['ISNA','MWL','Egyptian','Karachi','UmmAlQura','Gulf','Kuwait','Qatar','Tehran','Jafari'];
  juristicMethods = [
    { value: 'Other', label: 'Standard (Shafi‘i / Maliki / Hanbali)' },
    { value: 'Hanafi', label: 'Hanafi' }
  ];
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
      } else if (org.zipCode) {
        this.criteriaForm.controls.zipCode.setValue(org.zipCode);
      }
      this.loading.set(false);
    });
  }

  saveOrg() {
    if (this.orgForm.invalid) return;
    this.saving.set(true);
    this.orgs.update(this.orgId, this.orgForm.getRawValue()).subscribe({
      next: () => { this.saving.set(false); this.snack.open('Saved', '', { duration: 2000 }); },
      error: error => {
        this.saving.set(false);
        this.snack.open(this.apiErrorMessage(error, 'Organization could not be saved.'), 'Dismiss', { duration: 4500 });
      }
    });
  }

  private apiErrorMessage(error: unknown, fallback: string): string {
    const response = error as ApiFailure;
    const validationErrors = response.error?.errors;
    const firstValidationError = validationErrors ? Object.values(validationErrors).flat()[0] : undefined;
    return firstValidationError ?? response.error?.detail ?? response.error?.title ?? fallback;
  }

  saveCriteria() {
    if (this.criteriaForm.invalid) {
      this.criteriaForm.markAllAsTouched();
      this.snack.open('Check the prayer criteria fields', 'Dismiss', { duration: 3000 });
      return;
    }

    const postalCode = this.criteriaForm.controls.zipCode.value.trim();
    if (/^\d{5}(?:-\d{4})?$/.test(postalCode)) {
      this.resolveLocation(true);
      return;
    }

    this.persistCriteria();
  }

  lookupPostalCode() {
    this.resolveLocation(false);
  }

  private resolveLocation(saveAfterResolution: boolean) {
    const postalCode = this.criteriaForm.controls.zipCode.value.trim();
    if (!/^\d{5}(?:-\d{4})?$/.test(postalCode)) {
      this.locationError.set('Enter a valid 5-digit U.S. ZIP code.');
      if (saveAfterResolution) this.snack.open(this.locationError(), 'Dismiss', { duration: 3000 });
      return;
    }

    this.resolvingLocation.set(true);
    this.locationError.set('');
    if (saveAfterResolution) this.saving.set(true);
    this.orgs.resolveUsPostalCode(postalCode).subscribe({
      next: location => {
        this.resolvedLocation.set(location);
        this.resolvingLocation.set(false);
        this.criteriaForm.patchValue({
          zipCode: location.postalCode,
          latitude: location.latitude,
          longitude: location.longitude
        });
        if (saveAfterResolution) this.persistCriteria();
      },
      error: error => {
        this.resolvingLocation.set(false);
        this.saving.set(false);
        const response = error as ApiFailure;
        const message = response.error?.message ?? response.error?.title ?? 'Could not verify that ZIP code.';
        this.locationError.set(message);
        this.snack.open(message, 'Dismiss', { duration: 4000 });
      }
    });
  }

  private persistCriteria() {
    this.saving.set(true);
    const raw = this.criteriaForm.getRawValue();
    this.orgs.putCriteria(this.orgId, {
      organizationId: this.orgId,
      ...raw,
      dstBegins: raw.dstBegins || undefined,
      dstEnds: raw.dstEnds || undefined
    }).subscribe({
      next: () => { this.saving.set(false); this.snack.open('Criteria saved', '', { duration: 2000 }); },
      error: error => {
        this.saving.set(false);
        this.snack.open(this.apiErrorMessage(error, 'Prayer criteria could not be saved.'), 'Dismiss', { duration: 4500 });
      }
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
          minutesAfterZawal: 5, minutesAfterMaghrib: 1, khutbahTimeMinutes: 20
        });
        this.resolvedLocation.set(null);
        this.locationError.set('');
        this.snack.open('Prayer criteria removed', '', { duration: 2500 });
      },
      error: () => { this.saving.set(false); this.snack.open('Could not remove criteria', 'Dismiss', { duration: 3000 }); }
    });
  }
}
