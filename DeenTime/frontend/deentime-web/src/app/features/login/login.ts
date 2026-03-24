import { Component, inject, signal } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../../services/auth';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatCardModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatProgressSpinnerModule, MatSnackBarModule
  ],
  templateUrl: './login.html',
  styleUrl: './login.scss'
})
export class LoginComponent {
  private fb      = inject(FormBuilder);
  private auth    = inject(AuthService);
  private router  = inject(Router);
  private snack   = inject(MatSnackBar);

  isRegister  = signal(false);
  loading     = signal(false);
  devSuperUser = environment.devSuperUser;

  form = this.fb.group({
    email:            ['', [Validators.required, Validators.email]],
    password:         ['', [Validators.required, Validators.minLength(6)]],
    organizationName: ['']
  });

  quickLogin() {
    if (!this.devSuperUser) return;
    this.form.setValue({ email: this.devSuperUser.email, password: this.devSuperUser.password, organizationName: '' });
    this.submit();
  }

  toggle() {
    this.isRegister.update(v => !v);
    this.form.reset();
  }

  submit() {
    if (this.form.invalid) return;
    this.loading.set(true);

    const { email, password, organizationName } = this.form.value;

    const call = this.isRegister()
      ? this.auth.register({ email: email!, password: password!, organizationName: organizationName || undefined })
      : this.auth.login({ email: email!, password: password! });

    call.subscribe({
      next: () => {
        const orgId = this.auth.getOrgId();
        this.router.navigate(['/org', orgId, 'timings']);
      },
      error: (err) => {
        this.loading.set(false);
        const msg = err.status === 401 ? 'Invalid email or password'
                  : err.status === 409 ? 'Email already registered'
                  : 'Something went wrong — please try again';
        this.snack.open(msg, 'Dismiss', { duration: 4000 });
      }
    });
  }
}
