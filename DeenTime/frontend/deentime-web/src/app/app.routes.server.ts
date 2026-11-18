import { RenderMode, ServerRoute } from '@angular/ssr';
import { environment } from '../environments/environment';

const legacyServerRoutes: ServerRoute[] = [
  { path: 'login',   renderMode: RenderMode.Prerender },
  { path: 'verify-email', renderMode: RenderMode.Client },
  { path: 'forgot-password', renderMode: RenderMode.Client },
  { path: 'reset-password', renderMode: RenderMode.Client },
  { path: 'tv/:slug', renderMode: RenderMode.Client },
  { path: 'w/:slug',  renderMode: RenderMode.Client },
  { path: 'w2/:slug', renderMode: RenderMode.Client },
  { path: '**',       renderMode: RenderMode.Client }
];

const cloudServerRoutes: ServerRoute[] = [
  { path: 'login', renderMode: RenderMode.Prerender },
  { path: '**', renderMode: RenderMode.Client }
];

export const serverRoutes: ServerRoute[] = environment.backend === 'cloudflare' ? cloudServerRoutes : legacyServerRoutes;
