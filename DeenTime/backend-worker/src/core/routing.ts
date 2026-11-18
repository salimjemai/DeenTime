import { getPath } from 'hono/utils/url';

/**
 * Express (backend-node) matches routes case-insensitively and ignores one trailing
 * slash; Hono does neither. This `getPath` keeps Hono's fast exact matching and, only
 * for paths that contain an upper-case letter, rewrites the static segments to the
 * registered (lower-case) spelling of the first route they match, in registration
 * order like Express. Parameter and wildcard segments keep the caller's spelling, so
 * `c.req.param()` returns what was sent.
 *
 * Requirement on modules: static route segments are lower-case (test/routes.spec.ts enforces it).
 */
export function createPathResolver(routePaths: () => string[]): (request: Request) => string {
  let patterns: string[][] | null = null;
  return (request) => {
    let path = getPath(request);
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    if (!/[A-Z]/.test(path)) return path;
    patterns ??= [...new Set(routePaths())].filter((route) => route !== '*' && route !== '/*').map((route) => route.split('/'));
    const segments = path.split('/');
    for (const pattern of patterns) {
      const wildcard = pattern[pattern.length - 1] === '*';
      if (wildcard ? segments.length < pattern.length - 1 : segments.length !== pattern.length) continue;
      let matches = true;
      for (let i = 0; i < pattern.length && matches; i++) {
        const expected = pattern[i];
        if (expected === '*') break;
        if (!isParameter(expected) && expected !== (segments[i] ?? '').toLowerCase()) matches = false;
      }
      if (matches) {
        return segments.map((segment, i) => (i < pattern.length && pattern[i] !== '*' && !isParameter(pattern[i]) ? pattern[i] : segment)).join('/');
      }
    }
    return path;
  };
}

function isParameter(segment: string): boolean {
  return segment.startsWith(':');
}
