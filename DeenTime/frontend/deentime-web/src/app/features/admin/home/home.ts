import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { finalize } from 'rxjs';
import { MasjidAdminDashboard, MasjidAdminRow, MasjidAdminStatus } from '../../../models';
import { AdminMasjidsService } from '../../../services/admin-masjids';
import { Router } from '@angular/router';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    DatePipe, ReactiveFormsModule, MatButtonModule, MatCardModule, MatFormFieldModule,
    MatIconModule, MatInputModule, MatProgressSpinnerModule, MatSnackBarModule
  ],
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class HomeComponent {
  private readonly fb = inject(FormBuilder);
  private readonly service = inject(AdminMasjidsService);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);

  readonly dashboard = signal<MasjidAdminDashboard | null>(null);
  readonly loading = signal(true);
  readonly sending = signal(false);
  readonly workingId = signal<string | null>(null);
  readonly search = signal('');
  readonly statusFilter = signal('All');
  readonly developmentInvitationUrl = signal<string | null>(null);

  readonly inviteForm = this.fb.group({
    email: ['', [Validators.required, Validators.email, Validators.maxLength(320)]],
    organizationName: ['', [Validators.required, Validators.maxLength(160)]],
    websiteUrl: ['', Validators.maxLength(2048)],
    addressLine: ['', Validators.maxLength(240)],
    city: ['', Validators.maxLength(120)],
    state: ['', Validators.pattern(/^[A-Za-z]{2}$/)],
    zipCode: ['', Validators.pattern(/^\d{5}(?:-\d{4})?$/)]
  });

  readonly filteredItems = computed(() => {
    const query = this.search().trim().toLowerCase();
    const status = this.statusFilter();
    return (this.dashboard()?.items ?? []).filter(item =>
      (status === 'All' || item.status === status) &&
      (!query || `${item.organizationName} ${item.email} ${item.city ?? ''} ${item.state ?? ''}`.toLowerCase().includes(query)));
  });

  constructor() { this.load(); }

  load(): void {
    this.loading.set(true);
    this.service.getDashboard().pipe(finalize(() => this.loading.set(false))).subscribe({
      next: dashboard => this.dashboard.set(dashboard),
      error: error => this.showError(error, 'The masjid dashboard could not be loaded.')
    });
  }

  sendInvitation(): void {
    this.inviteForm.markAllAsTouched();
    if (this.inviteForm.invalid) return;
    const value = this.inviteForm.getRawValue();
    this.sending.set(true);
    this.developmentInvitationUrl.set(null);
    this.service.invite({
      email: value.email!.trim(),
      organizationName: value.organizationName!.trim(),
      websiteUrl: this.optional(value.websiteUrl),
      addressLine: this.optional(value.addressLine),
      city: this.optional(value.city),
      state: this.optional(value.state)?.toUpperCase(),
      zipCode: this.optional(value.zipCode)
    }).pipe(finalize(() => this.sending.set(false))).subscribe({
      next: response => {
        this.developmentInvitationUrl.set(response.developmentInvitationUrl ?? null);
        this.inviteForm.reset();
        this.snack.open(`Invitation sent to ${response.email}.`, 'Dismiss', { duration: 4000 });
        this.load();
      },
      error: error => this.showError(error, 'The invitation could not be sent.')
    });
  }

  resend(item: MasjidAdminRow): void {
    this.workingId.set(item.id);
    this.service.resend(item.id).pipe(finalize(() => this.workingId.set(null))).subscribe({
      next: response => {
        this.developmentInvitationUrl.set(response.developmentInvitationUrl ?? null);
        this.snack.open(`Invitation resent to ${item.email}.`, 'Dismiss', { duration: 4000 });
        this.load();
      },
      error: error => this.showError(error, 'The invitation could not be resent.')
    });
  }

  revoke(item: MasjidAdminRow): void {
    if (!confirm(`Revoke the invitation for ${item.organizationName}?`)) return;
    this.workingId.set(item.id);
    this.service.revoke(item.id).pipe(finalize(() => this.workingId.set(null))).subscribe({
      next: () => {
        this.snack.open('Invitation revoked.', 'Dismiss', { duration: 3500 });
        this.load();
      },
      error: error => this.showError(error, 'The invitation could not be revoked.')
    });
  }

  manage(item: MasjidAdminRow): void {
    if (item.organizationId) this.router.navigate(['/org', item.organizationId, 'timings']);
  }

  statusLabel(status: MasjidAdminStatus): string {
    return ({
      Registered: 'Registered',
      InvitationSent: 'Invitation sent',
      AwaitingEmailVerification: 'Awaiting email verification',
      EmailVerificationExpired: 'Email verification expired',
      Expired: 'Invitation expired',
      Revoked: 'Revoked'
    })[status];
  }

  statusClass(status: MasjidAdminStatus): string {
    return status.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  }

  private optional(value: string | null | undefined): string | undefined {
    return value?.trim() || undefined;
  }

  private showError(error: { error?: { message?: string; title?: string } }, fallback: string): void {
    this.snack.open(error.error?.message ?? error.error?.title ?? fallback, 'Dismiss', { duration: 5000 });
  }
}
