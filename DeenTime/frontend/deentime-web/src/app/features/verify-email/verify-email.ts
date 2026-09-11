import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../services/auth';
import { AppIconComponent } from '../../shared/app-icon';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatCardModule, MatProgressSpinnerModule, AppIconComponent],
  templateUrl: './verify-email.html',
  styleUrl: './verify-email.scss'
})
export class VerifyEmailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  readonly loading = signal(true);
  readonly verified = signal(false);
  readonly error = signal('');
  /** A session already exists (for example the link was reloaded after it succeeded). */
  readonly hasSession = signal(false);

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.loading.set(false);
      this.error.set('This verification link is incomplete.');
      return;
    }

    this.auth.verifyEmail(token).subscribe({
      next: () => {
        this.loading.set(false);
        this.verified.set(true);
      },
      error: response => {
        this.loading.set(false);
        // A verification link is single-use, so a reload or a second click lands here
        // even though the account was created. Keep the sign-in path visible.
        this.hasSession.set(this.auth.hasValidToken());
        this.error.set(response.error?.message ?? 'This verification link is invalid or has expired.');
      }
    });
  }

  continue(): void {
    this.router.navigate(['/org', this.auth.getOrgId(), 'timings']);
  }
}
