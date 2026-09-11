#!/usr/bin/env node
/**
 * Parity check: sends the same requests to the .NET API and the Node API and
 * reports differences in status codes, JSON bodies and selected headers.
 *
 *   PARITY_DOTNET=http://127.0.0.1:8080 PARITY_NODE=http://127.0.0.1:8081 \
 *   DEENTIME_SUPERUSER_EMAIL=... DEENTIME_SUPERUSER_PASSWORD=... node test/parity/compare.mjs
 *
 * Volatile fields (timestamps, generated ids, cache metadata) are ignored.
 */
const dotnet = (process.env.PARITY_DOTNET ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const node = (process.env.PARITY_NODE ?? 'http://127.0.0.1:8081').replace(/\/$/, '');
const email = process.env.DEENTIME_SUPERUSER_EMAIL ?? 'salim_jemai@yahoo.com';
const password = process.env.DEENTIME_SUPERUSER_PASSWORD;

const IGNORED_KEYS = new Set(['updatedAtUtc', 'retrievedAtUtc', 'buildTimeUtc', 'createdAtUtc', 'lastSeenUtc', 'lastUsedAtUtc', 'syncedAtUtc', 'startedAtUtc', 'completedAtUtc', 'schemaVersion', 'commitSha']);
const COMPARED_HEADERS = ['content-type', 'cache-control', 'access-control-allow-origin', 'x-iqamatime-source'];

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => !IGNORED_KEYS.has(key))
        .sort()
        .map((key) => [key, normalize(value[key])]),
    );
  }
  if (typeof value === 'number') return Number(value.toFixed(6));
  return value;
}

function diff(a, b, path = '') {
  const differences = [];
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b)) {
    differences.push(`${path || '$'}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    return differences;
  }
  if (a && typeof a === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if (!(key in a)) differences.push(`${path}.${key}: missing in .NET`);
      else if (!(key in b)) differences.push(`${path}.${key}: missing in Node`);
      else differences.push(...diff(a[key], b[key], `${path}.${key}`));
    }
    return differences;
  }
  if (a !== b) differences.push(`${path || '$'}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  return differences;
}

async function call(base, method, path, { token, body, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, headers: Object.fromEntries(COMPARED_HEADERS.map((name) => [name, response.headers.get(name)])), json, text };
}

async function login(base) {
  if (!password) return null;
  const response = await call(base, 'POST', '/api/v1/auth/login', { body: { email, password } });
  return response.json?.token ?? null;
}

async function main() {
  const [dotnetToken, nodeToken] = await Promise.all([login(dotnet), login(node)]);
  if (password && (!dotnetToken || !nodeToken)) console.warn(`Super user login failed on ${!dotnetToken ? '.NET' : ''} ${!nodeToken ? 'Node' : ''}; protected endpoints are skipped.`);
  const orgs = dotnetToken ? await call(dotnet, 'GET', '/api/v1/orgs?search=&page=1', { token: dotnetToken }) : null;
  const org = orgs?.json?.items?.find((item) => item.slug !== 'admin') ?? orgs?.json?.items?.[0];
  const orgId = org?.id;
  const slug = org?.slug ?? 'admin';
  const today = new Date().toISOString().slice(0, 10);

  const cases = [
    ['GET', '/api/version'],
    ['GET', '/health/live'],
    ['GET', '/health/ready'],
    ['GET', '/api/v1/auth/config'],
    ['GET', `/api/v1/timings?orgId=${slug}&date=2026-08-19`],
    ['GET', `/api/v1/timings/range?orgId=${slug}&from=2026-08-01&to=2026-08-07`],
    ['GET', `/api/v1/timings/today?orgId=${slug}`],
    ['GET', `/public/display/${slug}`],
    ['GET', `/public/display/${slug}?layout=tv&theme=dark&fontScale=120`],
    ['GET', `/public/display/${slug}?layout=compact&locale=ar`],
    ['GET', `/public/display/${slug}?fontScale=74`],
    ['GET', `/public/organizations/${slug}/displays`],
    ['GET', '/public/content/capabilities'],
    ['GET', '/public/content/qibla/metadata'],
    ['GET', '/public/content/qibla/30.5052/-97.8203'],
    ['GET', '/public/content/hadith/books'],
    ['GET', '/public/content/hadith/hadiths?language=en&page=1&pageSize=3'],
    ['GET', '/api/v1/locations/postal-code/78613'],
    ['GET', '/api/v1/locations/postal-code/1'],
    ['GET', '/api/v1/nothing'],
  ];
  const protectedCases = orgId
    ? [
        ['GET', '/api/v1/auth/session'],
        ['GET', '/api/v1/orgs?search=&page=1'],
        ['GET', `/api/v1/orgs/${orgId}`],
        ['GET', `/api/v1/orgs/${slug}`],
        ['GET', `/api/v1/orgs/${orgId}/criteria`],
        ['GET', `/api/v1/orgs/${orgId}/readiness`],
        ['GET', `/api/v1/orgs/${orgId}/api-clients`],
        ['GET', `/api/v1/design/${orgId}`],
        ['GET', `/api/v1/iqama?orgId=${orgId}&year=${today.slice(0, 4)}`],
        ['GET', `/api/v1/iqama/current?orgId=${orgId}`],
        ['GET', `/api/v1/hijri/${orgId}?from=${today.slice(0, 7)}&to=${today.slice(0, 7)}`],
        ['GET', `/api/v1/publish/tv-config/${orgId}`],
        ['GET', `/api/v1/publish/embed-code/${orgId}`],
        ['GET', `/api/v1/publish/artifacts?orgId=${orgId}&year=${today.slice(0, 4)}`],
        ['GET', '/api/v1/admin/masjids'],
        ['GET', '/api/v1/islamic-content/summary'],
        ['GET', '/api/v1/islamic-content/status'],
      ]
    : [];

  let failures = 0;
  for (const [method, path, options = {}] of [...cases.map((c) => [...c, {}]), ...protectedCases.map((c) => [...c, { auth: true }])]) {
    const [left, right] = await Promise.all([
      call(dotnet, method, path, { token: options.auth ? dotnetToken : undefined }),
      call(node, method, path, { token: options.auth ? nodeToken : undefined }),
    ]);
    const problems = [];
    if (left.status !== right.status) problems.push(`status ${left.status} vs ${right.status}`);
    for (const name of COMPARED_HEADERS) {
      const a = left.headers[name]?.split(';')[0];
      const b = right.headers[name]?.split(';')[0];
      if ((a ?? null) !== (b ?? null)) problems.push(`header ${name}: ${a} vs ${b}`);
    }
    if (left.json !== null || right.json !== null) problems.push(...diff(normalize(left.json), normalize(right.json)));
    else if (left.text !== right.text) problems.push(`body: ${left.text.slice(0, 80)} vs ${right.text.slice(0, 80)}`);
    if (problems.length) {
      failures += 1;
      console.log(`✗ ${method} ${path}`);
      for (const problem of problems.slice(0, 12)) console.log(`    ${problem}`);
      if (problems.length > 12) console.log(`    … ${problems.length - 12} more`);
    } else {
      console.log(`✓ ${method} ${path}`);
    }
  }
  console.log(failures === 0 ? '\nParity: no differences.' : `\nParity: ${failures} endpoint(s) differ.`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
