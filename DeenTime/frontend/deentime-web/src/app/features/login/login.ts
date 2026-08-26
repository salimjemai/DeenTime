import { isPlatformBrowser } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../../services/auth';
import { environment } from '../../../environments/environment';
import { AppIconComponent } from '../../shared/app-icon';
import { TurnstileComponent } from '../../shared/turnstile';
import { MasjidInvitationPrefill } from '../../models';
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, finalize, map, switchMap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatCardModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatProgressSpinnerModule, MatSnackBarModule,
    AppIconComponent, TurnstileComponent
  ],
  templateUrl: './login.html',
  styleUrl: './login.scss'
})
export class LoginComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly snack = inject(MatSnackBar);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly addressQueries = new Subject<string>();
  private readonly zipQueries = new Subject<string>();
  private addressSessionToken = '';

  readonly isRegister = signal(false);
  readonly loading = signal(false);
  readonly captchaEnabled = signal(false);
  readonly captchaSiteKey = signal('');
  readonly captchaToken = signal('');
  readonly registrationPending = signal(false);
  readonly developmentVerificationUrl = signal<string | null>(null);
  readonly invitation = signal<MasjidInvitationPrefill | null>(null);
  readonly invitationLoading = signal(false);
  readonly addressAutocompleteEnabled = signal(false);
  readonly addressSuggestions = signal<{ placeId: string; description: string }[]>([]);
  readonly addressSearching = signal(false);
  readonly addressResolving = signal(false);
  readonly addressVerified = signal(false);
  readonly addressLookupMessage = signal('');
  readonly zipResolving = signal(false);
  readonly zipLookupMessage = signal('');
  readonly passwordValue = signal('');
  readonly devSuperUser = environment.devSuperUser;
  readonly reason = this.route.snapshot.queryParamMap.get('reason');
  private readonly invitationToken = this.route.snapshot.queryParamMap.get('invite');

  readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email, Validators.pattern(emailPattern), Validators.maxLength(320)]],
    password: ['', [Validators.required, Validators.maxLength(128)]],
    confirmPassword: [''],
    organizationName: [''],
    websiteUrl: [''],
    addressLine: [''],
    city: [''],
    state: [''],
    zipCode: [''],
    addressPlaceId: ['']
  });

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.addressSessionToken = this.newAddressSessionToken();
    this.configureAddressLookup();
    this.configureZipLookup();
    this.auth.getPublicConfig().subscribe({
      next: config => {
        this.captchaEnabled.set(config.captchaEnabled);
        this.captchaSiteKey.set(config.captchaSiteKey ?? '');
        this.addressAutocompleteEnabled.set(config.addressAutocompleteEnabled);
        this.applyModeValidators();
      },
      error: () => this.snack.open('Security verification could not be loaded. Please refresh.', 'Dismiss', { duration: 5000 })
    });
    if (this.invitationToken) this.loadInvitation(this.invitationToken);
  }

  quickLogin(): void {
    if (!this.devSuperUser) return;
    this.form.patchValue({ email: this.devSuperUser.email, password: this.devSuperUser.password });
    this.submit();
  }

  toggle(): void {
    this.isRegister.update(value => !value);
    this.registrationPending.set(false);
    this.developmentVerificationUrl.set(null);
    this.captchaToken.set('');
    this.passwordValue.set('');
    this.addressSuggestions.set([]);
    this.addressVerified.set(false);
    this.addressLookupMessage.set('');
    this.zipLookupMessage.set('');
    this.addressSessionToken = this.newAddressSessionToken();
    this.form.reset();
    this.applyModeValidators();
    if (this.isRegister() && this.invitation()) this.prefillInvitation(this.invitation()!);
  }

  onCaptchaToken(token: string): void {
    this.captchaToken.set(token);
  }

  onPasswordInput(value: string): void {
    this.passwordValue.set(value);
  }

  onAddressInput(value: string): void {
    this.clearVerifiedAddress();
    this.addressLookupMessage.set('');
    this.addressQueries.next(value);
  }

  onZipInput(value: string): void {
    this.clearVerifiedAddress();
    this.zipLookupMessage.set('');
    this.zipQueries.next(value);
  }

  markAddressChanged(): void {
    this.clearVerifiedAddress();
  }

  selectAddress(placeId: string): void {
    if (this.addressResolving()) return;
    const sessionToken = this.addressSessionToken;
    this.addressResolving.set(true);
    this.addressLookupMessage.set('');
    this.auth.resolveAddress(placeId, sessionToken)
      .pipe(finalize(() => this.addressResolving.set(false)))
      .subscribe({
        next: address => {
          this.form.patchValue({
            addressLine: address.addressLine,
            city: address.city,
            state: address.state,
            zipCode: address.postalCode,
            addressPlaceId: address.placeId
          }, { emitEvent: false });
          this.addressSuggestions.set([]);
          this.addressVerified.set(true);
          this.addressLookupMessage.set('Verified complete U.S. street address');
          this.zipLookupMessage.set(`${address.city}, ${address.state}`);
          this.addressSessionToken = this.newAddressSessionToken();
          this.form.controls.addressPlaceId.updateValueAndValidity({ emitEvent: false });
        },
        error: () => {
          this.clearVerifiedAddress();
          this.addressLookupMessage.set('That address could not be verified. Choose another suggestion.');
        }
      });
  }

  passwordChecks() {
    const password = this.passwordValue();
    return {
      length: password.length >= 12,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /\d/.test(password),
      symbol: /[^A-Za-z0-9\s]/.test(password),
      noSpaces: !/\s/.test(password)
    };
  }

  submit(): void {
    this.form.markAllAsTouched();
    const registering = this.isRegister();
    if (registering && this.form.controls.password.value !== this.form.controls.confirmPassword.value) {
      this.form.controls.confirmPassword.setErrors({ passwordMismatch: true });
    }
    if (this.form.invalid) return;
    if (this.captchaEnabled() && !this.captchaToken()) {
      this.snack.open('Please complete the “not a robot” verification.', 'Dismiss', { duration: 4000 });
      return;
    }

    this.loading.set(true);
    const value = this.form.getRawValue();
    if (registering) {
      this.auth.register({
        email: this.invitation()?.email ?? value.email!,
        password: value.password!,
        confirmPassword: value.confirmPassword!,
        organizationName: value.organizationName!,
        websiteUrl: value.websiteUrl!,
        addressLine: value.addressLine!,
        city: value.city!,
        state: value.state!.trim().toUpperCase(),
        zipCode: value.zipCode!,
        addressPlaceId: value.addressPlaceId || undefined,
        captchaToken: this.captchaToken() || undefined,
        invitationToken: this.invitationToken || undefined
      }).subscribe({
        next: response => {
          this.loading.set(false);
          this.registrationPending.set(true);
          this.developmentVerificationUrl.set(response.developmentVerificationUrl ?? null);
        },
        error: error => this.handleError(error)
      });
      return;
    }

    this.auth.login({
      email: value.email!,
      password: value.password!,
      captchaToken: this.captchaToken() || undefined
    }).subscribe({
      next: () => this.router.navigate(this.auth.hasSuperUserRole()
        ? ['/admin']
        : ['/org', this.auth.getOrgId(), 'timings']),
      error: error => this.handleError(error)
    });
  }

  private applyModeValidators(): void {
    const registrationControls = [
      this.form.controls.confirmPassword,
      this.form.controls.organizationName,
      this.form.controls.websiteUrl,
      this.form.controls.addressLine,
      this.form.controls.city,
      this.form.controls.state,
      this.form.controls.zipCode,
      this.form.controls.addressPlaceId
    ];
    registrationControls.forEach(control => control.clearValidators());
    this.form.controls.password.setValidators([Validators.required, Validators.maxLength(128)]);

    if (this.isRegister()) {
      this.form.controls.password.addValidators([
        Validators.minLength(12),
        Validators.pattern(/[a-z]/),
        Validators.pattern(/[A-Z]/),
        Validators.pattern(/[0-9]/),
        Validators.pattern(/[^A-Za-z0-9]/),
        Validators.pattern(/^\S+$/)
      ]);
      this.form.controls.confirmPassword.setValidators([Validators.required, Validators.maxLength(128)]);
      this.form.controls.organizationName.setValidators([Validators.required, Validators.maxLength(160)]);
      this.form.controls.websiteUrl.setValidators([Validators.required, Validators.maxLength(2048)]);
      this.form.controls.addressLine.setValidators([Validators.required, Validators.maxLength(240)]);
      this.form.controls.city.setValidators([Validators.required, Validators.maxLength(120)]);
      this.form.controls.state.setValidators([Validators.required, Validators.pattern(/^[A-Za-z]{2}$/)]);
      this.form.controls.zipCode.setValidators([Validators.required, Validators.pattern(/^\d{5}(?:-\d{4})?$/)]);
      if (this.addressAutocompleteEnabled()) this.form.controls.addressPlaceId.setValidators(Validators.required);
    }
    Object.values(this.form.controls).forEach(control => control.updateValueAndValidity({ emitEvent: false }));
  }

  private loadInvitation(token: string): void {
    this.invitationLoading.set(true);
    this.auth.getInvitation(token).subscribe({
      next: invitation => {
        this.invitationLoading.set(false);
        this.invitation.set(invitation);
        this.isRegister.set(true);
        this.applyModeValidators();
        this.prefillInvitation(invitation);
      },
      error: error => {
        this.invitationLoading.set(false);
        this.handleError(error);
      }
    });
  }

  private prefillInvitation(invitation: MasjidInvitationPrefill): void {
    this.form.patchValue({
      email: invitation.email,
      organizationName: invitation.organizationName,
      websiteUrl: invitation.websiteUrl ?? '',
      addressLine: invitation.addressLine ?? '',
      city: invitation.city ?? '',
      state: invitation.state ?? '',
      zipCode: invitation.zipCode ?? ''
    });
  }

  private configureAddressLookup(): void {
    this.addressQueries.pipe(
      map(input => input.trim()),
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(input => {
        if (!this.addressAutocompleteEnabled() || input.length < 4) {
          this.addressSuggestions.set([]);
          return of([]);
        }
        this.addressSearching.set(true);
        return this.auth.searchAddresses(input, this.addressSessionToken).pipe(
          catchError(() => {
            this.addressLookupMessage.set('Address suggestions are temporarily unavailable.');
            return of([]);
          }),
          finalize(() => this.addressSearching.set(false))
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(suggestions => this.addressSuggestions.set(suggestions));
  }

  private configureZipLookup(): void {
    this.zipQueries.pipe(
      map(input => /^\d{5}/.exec(input.trim())?.[0] ?? ''),
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(zipCode => {
        if (!zipCode) return of(null);
        this.zipResolving.set(true);
        return this.auth.resolveUsPostalCode(zipCode).pipe(
          catchError(error => {
            this.zipLookupMessage.set(error.status === 404
              ? 'ZIP code not found'
              : 'ZIP lookup is temporarily unavailable');
            return of(null);
          }),
          finalize(() => this.zipResolving.set(false))
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(location => {
      if (!location) return;
      this.form.patchValue({
        city: location.city,
        state: location.stateAbbreviation
      }, { emitEvent: false });
      this.zipLookupMessage.set(`${location.city}, ${location.stateAbbreviation} found`);
    });
  }

  private clearVerifiedAddress(): void {
    if (!this.form.controls.addressPlaceId.value && !this.addressVerified()) return;
    this.form.controls.addressPlaceId.setValue('', { emitEvent: false });
    this.form.controls.addressPlaceId.updateValueAndValidity({ emitEvent: false });
    this.addressVerified.set(false);
  }

  private newAddressSessionToken(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private handleError(error: { status?: number; error?: { message?: string; title?: string } }): void {
    this.loading.set(false);
    this.captchaToken.set('');
    const message = error.error?.message ?? error.error?.title ??
      (error.status === 401 ? 'Invalid email or password.' :
       error.status === 409 ? 'This email or masjid is already registered.' :
       error.status === 429 ? 'Too many attempts. Please wait and try again.' :
       'Something went wrong—please try again.');
    this.snack.open(message, 'Dismiss', { duration: 5000 });
  }
}
