import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  { path: 'login',   renderMode: RenderMode.Prerender },
  { path: 'verify-email', renderMode: RenderMode.Client },
  { path: 'tv/:slug', renderMode: RenderMode.Client },
  { path: 'w/:slug',  renderMode: RenderMode.Client },
  { path: 'w2/:slug', renderMode: RenderMode.Client },
  { path: '**',       renderMode: RenderMode.Client }
];
