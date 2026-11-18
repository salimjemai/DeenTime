import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { BRAND } from '../brand';
import { CloudAuthService } from './cloud-auth.service';
import { MasjidApiService } from './masjid-api.service';
import { MasjidDetailsFieldsComponent, buildDetailsForm, detailsInput } from './masjid-details-fields';
import { errorMessage, fieldErrors } from './shared-auth.contract';

/** First step after creating an account: describe the masjid. */
@Component({
  selector: 'app-cloud-setup',
  standalone: true,
  imports: [ReactiveFormsModule, MatButtonModule, MatProgressSpinnerModule, MasjidDetailsFieldsComponent],
  template: `
    <div class="page">
      <div class="wrap">
        <div class="brand"><strong>{{ brand.name }}</strong><span>Set up your masjid</span></div>
        <div class="card">
          <h1>Tell us about your masjid</h1>
          <p class="lead">You can change any of this later. Iqama times, messages and widgets come next.</p>
          @if (error()) { <p class="notice error" role="alert">{{ error() }}</p> }
          <form [formGroup]="form" (ngSubmit)="save()" novalidate>
            <app-masjid-details-fields [form]="form" />
            <div class="actions">
              <button mat-flat-button color="primary" type="submit" [disabled]="saving()">
                @if (saving()) { <mat-spinner diameter="20" /> } @else { Create masjid }
              </button>
              <button mat-button type="button" (click)="signOut()">Sign out</button>
            </div>
          </form>
        </div>
      </div>
    </div>`,
  styleUrl: './cloud-pages.scss'
})
export class CloudSetupComponent {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(MasjidApiService);
  private readonly auth = inject(CloudAuthService);
  private readonly router = inject(Router);
  readonly brand = BRAND;
  readonly form = buildDetailsForm(this.fb);
  readonly saving = signal(false);
  readonly error = signal('');

  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.error.set('Check the highlighted fields.');
      return;
    }
    this.saving.set(true);
    this.error.set('');
    this.api.create(detailsInput(this.form)).subscribe({
      next: masjid => this.router.navigate(['/manage', masjid.id], { queryParams: { welcome: 1 } }),
      error: err => {
        this.saving.set(false);
        const fields = Object.values(fieldErrors(err));
        this.error.set(fields.length ? fields.join(' ') : errorMessage(err));
      }
    });
  }

  signOut(): void {
    this.auth.signOut();
    this.router.navigate(['/login']);
  }
}
