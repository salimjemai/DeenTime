import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { adminGuard } from './core/admin.guard';
import { superUserGuard } from './core/super-user.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./features/login/login').then(m => m.LoginComponent) },
  { path: 'verify-email', loadComponent: () => import('./features/verify-email/verify-email').then(m => m.VerifyEmailComponent) },
  { path: 'tv/:slug',  loadComponent: () => import('./features/tv/tv').then(m => m.TvComponent) },
  { path: 'w/:slug/daily', data: { content: 'daily' }, loadComponent: () => import('./features/widget/widget').then(m => m.WidgetComponent) },
  { path: 'w/:slug/jumuah', data: { content: 'jumuah' }, loadComponent: () => import('./features/widget/widget').then(m => m.WidgetComponent) },
  { path: 'w/:slug', data: { content: 'combined' }, loadComponent: () => import('./features/widget/widget').then(m => m.WidgetComponent) },
  { path: 'w2/:slug', data: { variant: 'compact', content: 'combined' }, loadComponent: () => import('./features/widget/widget').then(m => m.WidgetComponent) },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./features/shell/shell').then(m => m.ShellComponent),
    children: [
      { path: 'org/:orgId/timings', loadComponent: () => import('./features/org/timings/timings').then(m => m.TimingsComponent) },
      { path: 'org/:orgId/iqama',   loadComponent: () => import('./features/org/iqama/iqama').then(m => m.IqamaComponent) },
      { path: 'org/:orgId/design',  loadComponent: () => import('./features/org/design/design').then(m => m.DesignComponent) },
      { path: 'org/:orgId/hijri',   loadComponent: () => import('./features/org/hijri/hijri').then(m => m.HijriComponent) },
      { path: 'org/:orgId/publish', loadComponent: () => import('./features/org/publish/publish').then(m => m.PublishComponent) },
      { path: 'org/:orgId/content', canActivate: [adminGuard], loadComponent: () => import('./features/org/content/content').then(m => m.ContentComponent) },
      { path: 'org/:orgId/profile', loadComponent: () => import('./features/org/profile/profile').then(m => m.ProfileComponent) },
      { path: 'org/:orgId/help', loadComponent: () => import('./features/org/help/help').then(m => m.HelpComponent) },
      { path: 'admin', canActivate: [superUserGuard], loadComponent: () => import('./features/admin/home/home').then(m => m.HomeComponent) },
    ]
  },
  { path: '**', redirectTo: 'login' }
];
