import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../services/auth';
import { AppIconComponent } from '../../shared/app-icon';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [
    ReactiveFormsModule, RouterLink,
    MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule,
    AppIconComponent
  ],
  templateUrl: './reset-password.html',
  styleUrl: './reset-password.scss'
})
export class ResetPasswordComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly token = this.route.snapshot.queryParamMap.get('token') ?? '';
  readonly loading = signal(false);
  readonly error = signal('');
  readonly passwordValue = signal('');

  readonly form = this.fb.nonNullable.group({
    newPassword: ['', [
      Validators.required,
      Validators.minLength(12),
      Validators.maxLength(128),
      Validators.pattern(/[a-z]/),
      Validators.pattern(/[A-Z]/),
      Validators.pattern(/[0-9]/),
      Validators.pattern(/[^A-Za-z0-9]/),
      Validators.pattern(/^\S+$/)
    ]],
    confirmPassword: ['', [Validators.required, Validators.maxLength(128)]]
  });

  onPasswordInput(value: string): void {
    this.passwordValue.set(value);
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
    const { newPassword, confirmPassword } = this.form.getRawValue();
    if (newPassword !== confirmPassword) this.form.controls.confirmPassword.setErrors({ passwordMismatch: true });
    if (this.form.invalid || this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    this.auth.resetPassword(this.token, newPassword).subscribe({
      next: () => this.router.navigate(['/login'], { queryParams: { reason: 'password-reset' } }),
      error: response => {
        this.loading.set(false);
        this.error.set(response.error?.message ?? response.error?.title ??
          (response.status === 429 ? 'Too many attempts. Please wait and try again.' : 'Something went wrong. Please try again.'));
      }
    });
  }
}
