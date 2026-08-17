import { Component, DestroyRef, inject, computed, OnInit, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../services/auth';
import { OrgsService } from '../../services/orgs';
import { HelpTipsService } from '../../services/help-tips';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    RouterOutlet, RouterLink, RouterLinkActive,
    MatToolbarModule, MatSidenavModule, MatListModule,
    MatIconModule, MatButtonModule
  ],
  templateUrl: './shell.html',
  styleUrl: './shell.scss'
})
export class ShellComponent implements OnInit {
  private auth   = inject(AuthService);
  private router = inject(Router);
  private orgs   = inject(OrgsService);
  private destroyRef = inject(DestroyRef);
  readonly tips = inject(HelpTipsService);

  orgId   = computed(() => this.auth.getOrgId() ?? '');
  email   = computed(() => this.auth.getEmail() ?? '');
  orgName = signal('Your organization');
  activePath = signal(this.pathFromUrl(this.router.url));
  showWelcome = computed(() => !this.tips.welcomeSeen());
  currentTip = computed(() => {
    if (!this.tips.tipsEnabled() || !this.tips.welcomeSeen()) return undefined;
    const path = this.activePath();
    if (this.tips.dismissedTips().has(path)) return undefined;
    return this.tips.tab(path);
  });
  todayLabel = new Intl.DateTimeFormat(undefined, {
    weekday: 'long', month: 'short', day: 'numeric'
  }).format(new Date());

  ngOnInit() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(event => this.activePath.set(this.pathFromUrl(event.urlAfterRedirects)));

    const orgId = this.auth.getOrgId();
    if (orgId) {
      this.orgs.get(orgId).subscribe({
        next: org => this.orgName.set(org.name),
        error: () => this.orgName.set('Your organization')
      });
    }

    if (this.router.url === '/' && orgId) {
      this.router.navigate(['/org', orgId, 'timings']);
    }
  }

  navItems = [
    { label: 'Prayer Times', icon: 'schedule',    path: 'timings'  },
    { label: 'Iqama',        icon: 'mosque',       path: 'iqama'    },
    { label: 'Design',       icon: 'palette',      path: 'design'   },
    { label: 'Hijri',        icon: 'calendar_month', path: 'hijri'  },
    { label: 'Publish',      icon: 'picture_as_pdf', path: 'publish'},
    { label: 'Content',      icon: 'auto_stories',   path: 'content' },
    { label: 'Profile',      icon: 'settings',     path: 'profile'  },
    { label: 'Help & Tips',  icon: 'help_center',  path: 'help'     },
  ];

  openGuide() {
    this.tips.markWelcomeSeen();
    this.router.navigate(['/org', this.orgId(), 'help']);
  }

  dismissWelcome() {
    this.tips.markWelcomeSeen();
  }

  dismissCurrentTip() {
    this.tips.dismiss(this.activePath());
  }

  logout() { this.auth.logout(); }

  private pathFromUrl(url: string): string {
    return url.split('?')[0].split('#')[0].split('/').filter(Boolean).at(-1) ?? '';
  }
}
