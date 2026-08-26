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
import { AdminMasjidsService } from '../../services/admin-masjids';
import { MasjidAdminRow } from '../../models';

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
  private adminMasjids = inject(AdminMasjidsService);
  private destroyRef = inject(DestroyRef);
  private platformId = inject(PLATFORM_ID);
  readonly tips = inject(HelpTipsService);
  private readonly themeStorageKey = 'iqamatime-theme';
  private readonly navStorageKey = 'iqamatime-navigation-collapsed';
  private systemThemeQuery?: MediaQueryList;

  selectedOrgId = signal<string | null>(this.organizationIdFromUrl(this.router.url));
  orgId   = computed(() => this.isSuperUser()
    ? (this.selectedOrgId() ?? '')
    : (this.auth.getOrgId() ?? ''));
  email   = computed(() => this.auth.getEmail() ?? '');
  isSuperUser = computed(() => this.auth.hasSuperUserRole());
  registeredMasjids = signal<MasjidAdminRow[]>([]);
  hasOrganizationContext = computed(() => !this.isSuperUser() || !!this.selectedOrgId());
  orgName = signal(this.auth.hasSuperUserRole() ? 'IqamaTime Administration' : 'Your organization');
  contentKicker = computed(() => this.hasOrganizationContext()
    ? `MOSQUE OPERATIONS · ${this.todayLabel}`
    : `IQAMATIME ADMINISTRATION · ${this.todayLabel}`);
  headerDescription = computed(() => this.hasOrganizationContext()
    ? 'Keep your prayer schedule accurate, consistent, and ready to publish.'
    : 'Choose a registered masjid to review and manage its setup.');
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
  showWelcome = computed(() => this.hasOrganizationContext() && !this.tips.welcomeSeen());
  currentTip = computed(() => {
    if (!this.hasOrganizationContext() || !this.tips.tipsEnabled() || !this.tips.welcomeSeen()) return undefined;
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
      .subscribe(event => {
        this.activePath.set(this.pathFromUrl(event.urlAfterRedirects));
        this.syncOrganizationContext(event.urlAfterRedirects);
      });

    this.syncOrganizationContext(this.router.url);
    if (this.isSuperUser()) this.loadRegisteredMasjids();

    if (this.router.url === '/') {
      if (this.isSuperUser()) this.router.navigate(['/admin']);
      else if (this.auth.getOrgId()) this.router.navigate(['/org', this.auth.getOrgId(), 'timings']);
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
    if (!this.orgId()) return;
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

  selectMasjid(organizationId: string) {
    if (!organizationId) {
      this.router.navigate(['/admin']);
      return;
    }

    const operationPath = this.navItems.some(item => item.path === this.activePath())
      ? this.activePath()
      : 'timings';
    this.router.navigate(['/org', organizationId, operationPath]);
  }

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

  private syncOrganizationContext(url: string) {
    const routeOrganizationId = this.organizationIdFromUrl(url);
    if (this.isSuperUser()) {
      const demoOrganizationId = this.auth.getOrgId();
      if (!routeOrganizationId || routeOrganizationId === demoOrganizationId) {
        this.selectedOrgId.set(null);
        this.orgName.set('IqamaTime Administration');
        if (routeOrganizationId === demoOrganizationId) this.router.navigate(['/admin']);
        return;
      }
      if (this.selectedOrgId() !== routeOrganizationId) this.selectedOrgId.set(routeOrganizationId);
      this.loadOrganizationName(routeOrganizationId, 'Selected masjid');
      return;
    }

    const ownOrganizationId = this.auth.getOrgId();
    if (ownOrganizationId) this.loadOrganizationName(ownOrganizationId, 'Your organization');
  }

  private loadRegisteredMasjids() {
    this.adminMasjids.getDashboard().subscribe({
      next: dashboard => this.registeredMasjids.set(dashboard.items.filter(item =>
        item.status === 'Registered' && !!item.organizationId)),
      error: () => this.registeredMasjids.set([])
    });
  }

  private loadOrganizationName(organizationId: string, fallback: string) {
    this.orgs.get(organizationId).subscribe({
      next: org => this.orgName.set(org.name),
      error: () => this.orgName.set(fallback)
    });
  }

  private organizationIdFromUrl(url: string): string | null {
    return /\/org\/([^/?#]+)/.exec(url)?.[1] ?? null;
  }

  private pathFromUrl(url: string): string {
    return url.split('?')[0].split('#')[0].split('/').filter(Boolean).at(-1) ?? '';
  }
}
