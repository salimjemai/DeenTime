import { Component, OnInit, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { of, switchMap } from 'rxjs';
import { CloudAuthService } from './cloud-auth.service';
import { MasjidApiService } from './masjid-api.service';

/** /masjid/ itself: sends a signed-in admin to their masjid, everyone else to sign in. */
@Component({
  selector: 'app-cloud-home',
  standalone: true,
  imports: [MatProgressSpinnerModule],
  template: `<div style="display:grid;place-items:center;min-height:60vh"><mat-spinner diameter="32" /></div>`
})
export class CloudHomeComponent implements OnInit {
  private readonly auth = inject(CloudAuthService);
  private readonly api = inject(MasjidApiService);
  private readonly router = inject(Router);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  ngOnInit(): void {
    if (!this.browser) return;
    this.auth.current().pipe(switchMap(user => (user ? this.api.myMasjids() : of(null)))).subscribe({
      next: list => {
        if (list === null) this.router.navigate(['/login']);
        else this.router.navigate(list.length ? ['/manage', list[0].id] : ['/setup']);
      },
      error: () => this.router.navigate(['/login'])
    });
  }
}
