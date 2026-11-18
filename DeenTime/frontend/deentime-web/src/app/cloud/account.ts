import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { switchMap } from 'rxjs';
import { BRAND } from '../brand';
import { CloudAuthService } from './cloud-auth.service';
import { MasjidApiService } from './masjid-api.service';
import { DISPLAY_NAME_MAX, SHARED_AUTH_FEATURES, errorMessage } from './shared-auth.contract';

type Mode = 'signin' | 'signup' | 'forgot';

/** One page for signing in, creating an account and asking for a password reset. */
@Component({
  selector: 'app-cloud-account',
  standalone: true,
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule],
  templateUrl: './account.html',
  styleUrl: './cloud-pages.scss'
})
export class CloudAccountComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(CloudAuthService);
  private readonly masjids = inject(MasjidApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly brand = BRAND;
  readonly passwordReset = SHARED_AUTH_FEATURES.passwordReset;
  readonly nameMax = DISPLAY_NAME_MAX;
  readonly mode = signal<Mode>(this.route.snapshot.queryParamMap.get('mode') === 'signup' ? 'signup' : 'signin');
  readonly loading = signal(false);
  readonly error = signal('');
  readonly notice = signal('');

  readonly form = this.fb.nonNullable.group({
    displayName: ['', [Validators.maxLength(DISPLAY_NAME_MAX)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(320)]],
    password: ['', [Validators.required, Validators.maxLength(128)]],
    confirmPassword: ['']
  });

  constructor() {
    this.setMode(this.mode());
  }

  setMode(mode: Mode): void {
    this.mode.set(mode);
    this.error.set('');
    this.notice.set('');
    const password = this.form.controls.password;
    password.setValidators(mode === 'forgot' ? [] : mode === 'signup'
      ? [Validators.required, Validators.minLength(8), Validators.maxLength(128)]
      : [Validators.required, Validators.maxLength(128)]);
    password.updateValueAndValidity();
    const name = this.form.controls.displayName;
    name.setValidators(mode === 'signup' ? [Validators.required, Validators.maxLength(DISPLAY_NAME_MAX)] : []);
    name.updateValueAndValidity();
  }

  submit(): void {
    this.form.markAllAsTouched();
    this.error.set('');
    const { email, password, confirmPassword, displayName } = this.form.getRawValue();
    const mode = this.mode();
    if (mode === 'signup' && password !== confirmPassword) {
      this.error.set('The two passwords do not match.');
      return;
    }
    if (this.form.invalid) return;

    this.loading.set(true);
    if (mode === 'forgot') {
      this.auth.forgotPassword(email).subscribe({
        next: () => {
          this.loading.set(false);
          this.notice.set('If that email has an account, a reset link is on its way.');
        },
        error: err => this.fail(err)
      });
      return;
    }

    const request = mode === 'signup' ? this.auth.signUp(email, password, displayName) : this.auth.signIn(email, password);
    request.pipe(switchMap(() => this.masjids.myMasjids())).subscribe({
      next: list => {
        this.loading.set(false);
        const next = this.route.snapshot.queryParamMap.get('next');
        if (next && next.startsWith('/') && !next.startsWith('//')) this.router.navigateByUrl(next);
        else this.router.navigate(list.length ? ['/manage', list[0].id] : ['/setup']);
      },
      error: err => this.fail(err)
    });
  }

  private fail(err: unknown): void {
    this.loading.set(false);
    this.error.set(errorMessage(err));
  }
}
