import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { adminGuard } from './core/admin.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./features/login/login').then(m => m.LoginComponent) },
  { path: 'tv/:slug',  loadComponent: () => import('./features/tv/tv').then(m => m.TvComponent) },
  { path: 'w/:slug',   loadComponent: () => import('./features/widget/widget').then(m => m.WidgetComponent) },
  { path: 'w2/:slug',  data: { variant: 'compact' }, loadComponent: () => import('./features/widget/widget').then(m => m.WidgetComponent) },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./features/shell/shell').then(m => m.ShellComponent),
    children: [
      { path: 'org/:slug/timings', loadComponent: () => import('./features/org/timings/timings').then(m => m.TimingsComponent) },
      { path: 'org/:slug/iqama',   loadComponent: () => import('./features/org/iqama/iqama').then(m => m.IqamaComponent) },
      { path: 'org/:slug/design',  loadComponent: () => import('./features/org/design/design').then(m => m.DesignComponent) },
      { path: 'org/:slug/hijri',   loadComponent: () => import('./features/org/hijri/hijri').then(m => m.HijriComponent) },
      { path: 'org/:slug/publish', loadComponent: () => import('./features/org/publish/publish').then(m => m.PublishComponent) },
      { path: 'org/:slug/content', canActivate: [adminGuard], loadComponent: () => import('./features/org/content/content').then(m => m.ContentComponent) },
      { path: 'org/:slug/profile', loadComponent: () => import('./features/org/profile/profile').then(m => m.ProfileComponent) },
      { path: 'org/:slug/help', loadComponent: () => import('./features/org/help/help').then(m => m.HelpComponent) },
      { path: 'admin', canActivate: [adminGuard], loadComponent: () => import('./features/admin/home/home').then(m => m.HomeComponent) },
    ]
  },
  { path: '**', redirectTo: 'login' }
];
