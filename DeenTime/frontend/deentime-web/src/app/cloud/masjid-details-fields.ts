import { Component, Input, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { CALCULATION_METHODS, Masjid, MasjidApiService, MasjidInput } from './masjid-api.service';
import { errorMessage } from './shared-auth.contract';

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago';
  } catch {
    return 'America/Chicago';
  }
}

export function timeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  return intl.supportedValuesOf?.('timeZone') ?? [browserTimeZone()];
}

export function buildDetailsForm(fb: FormBuilder, masjid?: Masjid | null): FormGroup {
  return fb.nonNullable.group({
    name: [masjid?.name ?? '', [Validators.required, Validators.maxLength(160)]],
    addressLine: [masjid?.addressLine ?? '', Validators.maxLength(240)],
    city: [masjid?.city ?? '', Validators.maxLength(120)],
    region: [masjid?.region ?? '', Validators.maxLength(120)],
    postalCode: [masjid?.postalCode ?? '', Validators.maxLength(20)],
    country: [masjid?.country ?? 'US', [Validators.required, Validators.pattern(/^[A-Za-z]{2}$/)]],
    latitude: [masjid?.latitude ?? (null as number | null), [Validators.min(-90), Validators.max(90)]],
    longitude: [masjid?.longitude ?? (null as number | null), [Validators.min(-180), Validators.max(180)]],
    timezone: [masjid?.timezone ?? browserTimeZone(), Validators.required],
    calculationMethod: [masjid?.calculationMethod ?? 'ISNA', Validators.required],
    asrMethod: [masjid?.asrMethod ?? 'Standard', Validators.required],
    websiteUrl: [masjid?.websiteUrl ?? '', Validators.maxLength(2048)],
    phone: [masjid?.phone ?? '', Validators.maxLength(40)],
    email: [masjid?.email ?? '', [Validators.email, Validators.maxLength(320)]],
    about: [masjid?.about ?? '', Validators.maxLength(4000)]
  });
}

export function detailsInput(form: FormGroup): MasjidInput {
  const value = form.getRawValue();
  const number = (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v));
  return { ...value, country: String(value.country).toUpperCase(), latitude: number(value.latitude), longitude: number(value.longitude) };
}

/** Masjid name, address, location and calculation fields, shared by setup and the details tab. */
@Component({
  selector: 'app-masjid-details-fields',
  standalone: true,
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  templateUrl: './masjid-details-fields.html',
  styleUrl: './cloud-pages.scss'
})
export class MasjidDetailsFieldsComponent {
  @Input({ required: true }) form!: FormGroup;
  private readonly api = inject(MasjidApiService);

  readonly methods = CALCULATION_METHODS;
  readonly zones = timeZones();
  readonly locating = signal(false);
  readonly locateMessage = signal('');

  lookupPostalCode(): void {
    const { country, postalCode } = this.form.getRawValue();
    if (!postalCode) {
      this.locateMessage.set('Enter the postal code first.');
      return;
    }
    this.locating.set(true);
    this.api.lookupPostalCode(String(country).toUpperCase(), postalCode).subscribe({
      next: place => {
        this.locating.set(false);
        this.form.patchValue({ city: this.form.value.city || place.city, region: this.form.value.region || place.region, latitude: place.latitude, longitude: place.longitude });
        this.locateMessage.set(`Found ${place.city}, ${place.region}. Prayer times use the center of that postal code.`);
      },
      error: err => {
        this.locating.set(false);
        this.locateMessage.set(errorMessage(err, 'That postal code could not be looked up.'));
      }
    });
  }

  useThisDevice(): void {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this.locateMessage.set('This browser cannot share its location.');
      return;
    }
    this.locating.set(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        this.locating.set(false);
        this.form.patchValue({ latitude: Math.round(pos.coords.latitude * 1e5) / 1e5, longitude: Math.round(pos.coords.longitude * 1e5) / 1e5, timezone: browserTimeZone() });
        this.locateMessage.set('Location set from this device. Do this while at the masjid for the most accurate times.');
      },
      () => {
        this.locating.set(false);
        this.locateMessage.set('Location permission was not given. Use the postal code instead.');
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }
}
