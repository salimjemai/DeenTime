import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  { path: 'login',   renderMode: RenderMode.Prerender },
  { path: 'tv/:slug', renderMode: RenderMode.Client },
  { path: 'w/:slug',  renderMode: RenderMode.Client },
  { path: '**',       renderMode: RenderMode.Client }
];
