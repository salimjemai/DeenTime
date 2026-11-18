#!/usr/bin/env node
// Turns the production Angular build into a Cloudflare Pages upload:
//   npm run build -- --configuration production && npm run pages:prepare
// It checks the bundle, then adds the proxy worker, its route list and the header
// rules to dist/deentime-web/browser. Those three files live here rather than in
// public/ so the Angular service worker never lists (and tries to precache) them.
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, '..', 'dist', 'deentime-web', 'browser');
const PAGES_FILE_LIMIT = 25 * 1024 * 1024;
const failures = [];

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const indexPath = join(output, 'index.html');
if (!existsSync(indexPath)) {
  console.error(`No production build at ${output}. Run: npm run build -- --configuration production`);
  process.exit(1);
}

const index = readFileSync(indexPath, 'utf8');
if (!/<title>MasjidHub\b/.test(index)) failures.push('index.html does not carry the MasjidHub title');
if (!index.includes('<base href="/">')) failures.push('index.html must be built for the domain root (<base href="/">)');
// Pages only falls back to index.html for unknown paths (history routes) when there is no top-level 404.html.
if (existsSync(join(output, '404.html'))) failures.push('a top-level 404.html would disable the single-page-application fallback');

for (const file of walk(output)) {
  const name = relative(output, file);
  if (statSync(file).size > PAGES_FILE_LIMIT) failures.push(`${name} is larger than the 25 MiB Pages file limit`);
  // The browser must call its own origin; a baked-in development API URL would bypass the proxy.
  if (/\.(?:js|html)$/.test(file) && readFileSync(file, 'utf8').includes('localhost:8080')) {
    failures.push(`${name} contains a localhost API URL`);
  }
}

const serviceWorker = join(output, 'ngsw.json');
if (existsSync(serviceWorker)) {
  const manifest = JSON.parse(readFileSync(serviceWorker, 'utf8'));
  const rules = (manifest.navigationUrls ?? []).map((rule) => ({ positive: rule.positive, regex: new RegExp(rule.regex) }));
  // The service worker answers a navigation from the cached app shell when a positive rule matches and no negative one does.
  const servedFromShell = (path) => rules.some((rule) => rule.positive && rule.regex.test(path)) && !rules.some((rule) => !rule.positive && rule.regex.test(path));
  // API paths must reach the proxy; the public displays must reach Pages so they get the embeddable headers.
  for (const path of ['/api/version', '/public/tv/al-noor', '/uploads/logo', '/health/live', '/jobs', '/clock', '/tv/al-noor', '/w/al-noor', '/w/al-noor/daily', '/w2/al-noor']) {
    if (servedFromShell(path)) failures.push(`the service worker would answer ${path} from the cached app shell (see ngsw-config.json navigationUrls)`);
  }
  for (const path of ['/login', '/org/1/timings', '/admin']) {
    if (!servedFromShell(path)) failures.push(`the service worker no longer serves ${path} from the app shell (see ngsw-config.json navigationUrls)`);
  }
  if ((manifest.dataGroups ?? []).length > 0) failures.push('ngsw.json caches API data (dataGroups); the proxy expects API calls to reach the network');
} else {
  failures.push('ngsw.json is missing: the production configuration should build the service worker');
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}

// The worker is the Workers + D1 API built in ../../backend-worker (npm run build there
// first). `--api=tunnel` uploads the older proxy worker instead, which forwards the API
// paths to an origin machine through the Cloudflare Tunnel.
const useTunnel = process.argv.includes('--api=tunnel');
const worker = useTunnel ? join(here, '_worker.js') : resolve(here, '..', '..', '..', 'backend-worker', 'dist', '_worker.js');
if (!existsSync(worker)) {
  console.error(`No API worker at ${worker}. Run: npm ci && npm run build in backend-worker`);
  process.exit(1);
}
copyFileSync(worker, join(output, '_worker.js'));
for (const file of ['_routes.json', '_headers']) copyFileSync(join(here, file), join(output, file));
console.log(`Cloudflare Pages upload ready (${useTunnel ? 'tunnel proxy' : 'Workers + D1 API'}): ${output}`);
