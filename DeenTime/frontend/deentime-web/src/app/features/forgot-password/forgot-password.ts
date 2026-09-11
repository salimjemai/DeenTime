import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../services/auth';
import { AppIconComponent } from '../../shared/app-icon';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [
    ReactiveFormsModule, RouterLink,
    MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule,
    AppIconComponent
  ],
  templateUrl: './forgot-password.html',
  styleUrl: './forgot-password.scss'
})
export class ForgotPasswordComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);

  readonly loading = signal(false);
  readonly sent = signal(false);
  readonly error = signal('');
  readonly developmentResetUrl = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email, Validators.pattern(emailPattern), Validators.maxLength(320)]]
  });

  submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    this.auth.forgotPassword(this.form.getRawValue().email).subscribe({
      next: response => {
        this.loading.set(false);
        this.sent.set(true);
        this.developmentResetUrl.set(response.developmentResetUrl ?? null);
      },
      error: response => {
        this.loading.set(false);
        this.error.set(response.error?.message ?? response.error?.title ??
          (response.status === 429 ? 'Too many attempts. Please wait and try again.' : 'Something went wrong. Please try again.'));
      }
    });
  }
}
