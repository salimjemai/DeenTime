import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { adminGuard } from './core/admin.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./features/login/login').then(m => m.LoginComponent) },
  { path: 'org/:slug/profile', canActivate: [authGuard], loadComponent: () => import('./features/org/profile/profile').then(m => m.ProfileComponent) },
  { path: 'org/:slug/iqama', canActivate: [authGuard], loadComponent: () => import('./features/org/iqama/iqama').then(m => m.IqamaComponent) },
  { path: 'org/:slug/design', canActivate: [authGuard], loadComponent: () => import('./features/org/design/design').then(m => m.DesignComponent) },
  { path: 'org/:slug/publish', canActivate: [authGuard], loadComponent: () => import('./features/org/publish/publish').then(m => m.PublishComponent) },
  { path: 'org/:slug/hijri', canActivate: [authGuard], loadComponent: () => import('./features/org/hijri/hijri').then(m => m.HijriComponent) },
  { path: 'org/:slug/timings', canActivate: [authGuard], loadComponent: () => import('./features/org/timings/timings').then(m => m.TimingsComponent) },
  { path: 'admin', canActivate: [adminGuard], loadComponent: () => import('./features/admin/home/home').then(m => m.HomeComponent) },
  { path: 'tv/:slug', loadComponent: () => import('./features/tv/tv').then(m => m.TvComponent) },
  { path: 'w/:slug', loadComponent: () => import('./features/widget/widget').then(m => m.WidgetComponent) },
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: '**', redirectTo: 'login' }
];

