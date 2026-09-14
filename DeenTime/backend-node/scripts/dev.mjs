#!/usr/bin/env node
// Local development launcher for the Node.js API: `npm run dev`, also used by the
// "DeenTime Node API" VS Code launch configuration.
//
// Mirrors scripts/start-local.sh and start-local.ps1 without the PostgreSQL
// provisioning:
//   1. loads DeenTime/.env (see DeenTime/.env.example); variables already set in the
//      shell win, so the VS Code launch configuration can pin PORT etc.,
//   2. maps the DEENTIME_* names onto the API's configuration keys,
//   3. generates an ephemeral JWT signing key and super-user password when unset,
//   4. regenerates the Prisma client, then runs `nest start --watch`.
//
// PostgreSQL must already be running with the `deentime` database; the API applies
// its own migrations at startup and reports readiness at /health/ready.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(backendDir, '..', '.env');
const env = process.env;

function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line
      .slice(0, separator)
      .trim()
      .replace(/^export\s+/, '');
    let value = line.slice(separator + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    if (env[key] === undefined) env[key] = value;
  }
  console.log(`Loaded ${file}`);
}

loadDotEnv(envFile);

// Same names scripts/start-local.sh passes to the API.
const aliases = {
  DEENTIME_AUTH_SIGNING_KEY: 'Auth__SigningKey',
  DEENTIME_SUPERUSER_EMAIL: 'SuperUser__Email',
  DEENTIME_SUPERUSER_PASSWORD: 'SuperUser__Password',
  DEENTIME_SUPPORT_EMAIL: 'Support__Email',
  DEENTIME_HADITH_API_KEY: 'IslamicContent__HadithApiKey',
  DEENTIME_PUBLIC_BASE_URL: 'Frontend__PublicBaseUrl',
};
for (const [alias, key] of Object.entries(aliases)) {
  if (env[alias] && !env[key]) env[key] = env[alias];
}

env.ASPNETCORE_ENVIRONMENT ||= 'Development';
if (!env.ASPNETCORE_URLS && !env.PORT && env.DEENTIME_API_PORT)
  env.PORT = env.DEENTIME_API_PORT;

if (!env.Auth__SigningKey) {
  env.Auth__SigningKey = randomBytes(32).toString('hex');
  console.warn(
    'Generated an ephemeral local JWT signing key for this run ' +
      '(set DEENTIME_AUTH_SIGNING_KEY in DeenTime/.env to keep sessions valid across restarts).',
  );
}
if (!env.SuperUser__Password) {
  env.SuperUser__Password = `LocalOnly-${randomBytes(8).toString('hex')}`;
  const who =
    env.SuperUser__Email ??
    'the SuperUser:Email from appsettings.Development.json';
  console.warn(
    `Generated local super-user credentials: ${who} / ${env.SuperUser__Password}`,
  );
}

const prismaCli = resolve(backendDir, 'node_modules/prisma/build/index.js');
const nestCli = resolve(backendDir, 'node_modules/@nestjs/cli/bin/nest.js');
if (!existsSync(prismaCli) || !existsSync(nestCli)) {
  console.error(
    `Dependencies are missing. Run "npm ci" in ${backendDir} first.`,
  );
  process.exit(1);
}

// process.execPath avoids the npm/.cmd shims, so this works the same on Windows.
const generate = spawnSync(process.execPath, [prismaCli, 'generate'], {
  cwd: backendDir,
  stdio: 'inherit',
  env,
});
if (generate.status !== 0) {
  console.error(
    `prisma generate failed (${generate.status ?? generate.signal}).`,
  );
  process.exit(generate.status ?? 1);
}

const api = spawn(process.execPath, [nestCli, 'start', '--watch'], {
  cwd: backendDir,
  stdio: 'inherit',
  env,
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => api.kill(signal));
}
api.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
