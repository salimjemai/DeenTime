import { Component, DestroyRef, HostListener, PLATFORM_ID, inject, computed, OnInit, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../services/auth';
import { OrgsService } from '../../services/orgs';
import { HelpTipsService } from '../../services/help-tips';
import { AppIconComponent, AppIconName } from '../../shared/app-icon';

type ThemePreference = 'system' | 'light' | 'dark';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    RouterOutlet, RouterLink, RouterLinkActive,
    MatToolbarModule, MatSidenavModule,
    MatIconModule, MatButtonModule, MatTooltipModule, AppIconComponent
  ],
  templateUrl: './shell.html',
  styleUrl: './shell.scss'
})
export class ShellComponent implements OnInit {
  private auth   = inject(AuthService);
  private router = inject(Router);
  private orgs   = inject(OrgsService);
  private destroyRef = inject(DestroyRef);
  private platformId = inject(PLATFORM_ID);
  readonly tips = inject(HelpTipsService);
  private readonly themeStorageKey = 'iqamatime-theme';
  private readonly navStorageKey = 'iqamatime-navigation-collapsed';
  private systemThemeQuery?: MediaQueryList;

  orgId   = computed(() => this.auth.getOrgId() ?? '');
  email   = computed(() => this.auth.getEmail() ?? '');
  orgName = signal('Your organization');
  isMobileNavigation = signal(false);
  sidenavOpened = signal(true);
  navCollapsed = signal(false);
  themePreference = signal<ThemePreference>('system');
  systemPrefersDark = signal(false);
  resolvedTheme = computed<'light' | 'dark'>(() => {
    const preference = this.themePreference();
    return preference === 'system' ? (this.systemPrefersDark() ? 'dark' : 'light') : preference;
  });
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
  themeOptions: { value: ThemePreference; label: string; icon: string }[] = [
    { value: 'system', label: 'System', icon: 'brightness_auto' },
    { value: 'light', label: 'Light', icon: 'light_mode' },
    { value: 'dark', label: 'Dark', icon: 'dark_mode' }
  ];

  ngOnInit() {
    this.initializeDisplayPreferences();

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

  navItems: { label: string; icon: AppIconName; path: string }[] = [
    { label: 'Prayer Times', icon: 'timings', path: 'timings' },
    { label: 'Iqama', icon: 'iqama', path: 'iqama' },
    { label: 'Design', icon: 'design', path: 'design' },
    { label: 'Hijri', icon: 'hijri', path: 'hijri' },
    { label: 'Publish', icon: 'publish', path: 'publish' },
    { label: 'Content', icon: 'content', path: 'content' },
    { label: 'Profile', icon: 'profile', path: 'profile' },
    { label: 'Help & Tips', icon: 'help', path: 'help' },
  ];

  @HostListener('window:resize')
  onWindowResize() {
    if (isPlatformBrowser(this.platformId)) this.syncNavigationForWidth(window.innerWidth);
  }

  toggleNavigation() {
    if (this.isMobileNavigation()) {
      this.sidenavOpened.update(opened => !opened);
      return;
    }

    this.navCollapsed.update(collapsed => !collapsed);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem(this.navStorageKey, String(this.navCollapsed()));
    }
  }

  closeMobileNavigation() {
    if (this.isMobileNavigation()) this.sidenavOpened.set(false);
  }

  setTheme(preference: ThemePreference) {
    this.themePreference.set(preference);
    if (isPlatformBrowser(this.platformId)) localStorage.setItem(this.themeStorageKey, preference);
    this.applyThemeToDocument();
  }

  navigationLabel(): string {
    if (this.isMobileNavigation()) return this.sidenavOpened() ? 'Close navigation' : 'Open navigation';
    return this.navCollapsed() ? 'Expand navigation' : 'Collapse navigation';
  }

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

  private initializeDisplayPreferences() {
    if (!isPlatformBrowser(this.platformId)) return;

    const storedTheme = localStorage.getItem(this.themeStorageKey);
    if (storedTheme === 'system' || storedTheme === 'light' || storedTheme === 'dark') {
      this.themePreference.set(storedTheme);
    }
    this.navCollapsed.set(localStorage.getItem(this.navStorageKey) === 'true');
    this.syncNavigationForWidth(window.innerWidth);

    this.systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.systemPrefersDark.set(this.systemThemeQuery.matches);
    const onSystemThemeChange = (event: MediaQueryListEvent) => {
      this.systemPrefersDark.set(event.matches);
      if (this.themePreference() === 'system') this.applyThemeToDocument();
    };
    this.systemThemeQuery.addEventListener('change', onSystemThemeChange);
    this.applyThemeToDocument();

    this.destroyRef.onDestroy(() => {
      this.systemThemeQuery?.removeEventListener('change', onSystemThemeChange);
      delete document.documentElement.dataset['appTheme'];
    });
  }

  private syncNavigationForWidth(width: number) {
    const mobile = width <= 1024;
    if (mobile === this.isMobileNavigation()) return;
    this.isMobileNavigation.set(mobile);
    this.sidenavOpened.set(!mobile);
  }

  private applyThemeToDocument() {
    if (!isPlatformBrowser(this.platformId)) return;
    document.documentElement.dataset['appTheme'] = this.resolvedTheme();
  }

  private pathFromUrl(url: string): string {
    return url.split('?')[0].split('#')[0].split('/').filter(Boolean).at(-1) ?? '';
  }
}
