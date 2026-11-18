import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { isApiPath } from '../src/index.js';

/** Conventions every module's routes must follow (see README.md). */
describe('route conventions', () => {
  const routes = createApp().routes.filter((route) => route.path !== '/*' && route.path !== '*');

  it('static segments are lower-case, so case-insensitive matching works', () => {
    for (const route of routes) {
      const staticSegments = route.path.split('/').filter((segment) => !segment.startsWith(':') && segment !== '*');
      expect(staticSegments.join('/'), `${route.method} ${route.path}`).toBe(staticSegments.join('/').toLowerCase());
    }
  });

  it('every route is under a prefix the worker entry sends to the app', () => {
    for (const route of routes) {
      const concrete = route.path.replace(/:[^/]+/g, 'x').replace(/\*/g, 'x');
      expect(isApiPath(concrete), `${route.method} ${route.path}`).toBe(true);
    }
  });

  it('routes the same prefixes as the Pages proxy worker did', () => {
    for (const path of ['/api/version', '/API/v1/orgs', '/public/display/x', '/uploads/a.png', '/health/live', '/jobs', '/jobs/', '/clock', '/Clock', '/iqama-widget.php', '/IQAMA-WIDGET2.PHP']) {
      expect(isApiPath(path), path).toBe(true);
    }
    for (const path of ['/', '/api', '/public', '/health', '/uploads', '/login', '/tv/slug', '/w/slug', '/jobsx', '/clock/x', '/iqama-widget.php/x', '/index.html']) {
      expect(isApiPath(path), path).toBe(false);
    }
  });
});
