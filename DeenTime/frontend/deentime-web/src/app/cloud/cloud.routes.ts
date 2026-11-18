import { Routes } from '@angular/router';
import { cloudAuthGuard } from './cloud.guard';

/** Routes for the Cloudflare build, served at https://jemaiinnovations.com/masjid/. */
export const cloudRoutes: Routes = [
  { path: 'login', loadComponent: () => import('./account').then(m => m.CloudAccountComponent) },
  { path: 'setup', canActivate: [cloudAuthGuard], loadComponent: () => import('./setup').then(m => m.CloudSetupComponent) },
  { path: 'manage/:id', canActivate: [cloudAuthGuard], loadComponent: () => import('./manage').then(m => m.CloudManageComponent) },
  { path: 'm/:slug', loadComponent: () => import('./public-masjid').then(m => m.PublicMasjidComponent) },
  { path: '', pathMatch: 'full', loadComponent: () => import('./home').then(m => m.CloudHomeComponent) },
  { path: '**', redirectTo: '' }
];
