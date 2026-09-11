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
  readonly organizationName = signal('');
  readonly error = signal('');
  /** A session already exists (for example the link was reloaded after it succeeded). */
  readonly hasSession = signal(false);
  readonly supportEmail = signal('');

  ngOnInit(): void {
    this.auth.getPublicConfig().subscribe({
      next: config => this.supportEmail.set(config.supportEmail ?? ''),
      error: () => undefined
    });

    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token) {
      this.loading.set(false);
      this.error.set('This verification link is incomplete. Open the link from your verification email again.');
      return;
    }

    // Verification activates the account only; any session left in this browser
    // (for example the IqamaTime administrator testing an invitation) is cleared so
    // the next sign-in is the new masjid administrator's own.
    this.auth.verifyEmail(token).subscribe({
      next: response => {
        this.loading.set(false);
        this.verified.set(true);
        this.organizationName.set(response.organizationName ?? '');
        this.auth.clearSession();
      },
      error: response => {
        this.loading.set(false);
        // A verification link is single-use, so a reload or a second click lands here
        // even though the account was created. Keep the sign-in path visible.
        this.hasSession.set(this.auth.hasValidToken());
        this.error.set(response.error?.message ?? 'This verification link is invalid or has expired. Ask the IqamaTime administrator to resend your invitation.');
      }
    });
  }

  signIn(): void {
    this.router.navigate(['/login'], { queryParams: { reason: 'verified' } });
  }

  /** The link was already used and this browser still holds a valid session. */
  continue(): void {
    this.router.navigate(['/org', this.auth.getOrgId(), 'timings']);
  }
}
