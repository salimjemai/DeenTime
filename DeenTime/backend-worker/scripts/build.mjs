// Bundles the worker into one ESM file, dist/_worker.js, for a Cloudflare Pages
// advanced-mode upload. Build metadata is injected with `define` (there is no fs at runtime).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(root, 'dist/_worker.js');

function commitSha() {
  if (process.env.BUILD_COMMIT_SHA) return process.env.BUILD_COMMIT_SHA;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'local';
  }
}

mkdirSync(dirname(outfile), { recursive: true });
await build({
  entryPoints: [resolve(root, 'src/index.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2023',
  mainFields: ['module', 'main'],
  conditions: ['workerd', 'worker', 'browser'],
  minify: true,
  legalComments: 'none',
  define: {
    __BUILD_COMMIT_SHA__: JSON.stringify(commitSha()),
    __BUILD_TIME_UTC__: JSON.stringify(process.env.BUILD_TIME_UTC ?? new Date().toISOString()),
  },
  logLevel: 'info',
});

const raw = statSync(outfile).size;
const gzip = gzipSync(readFileSync(outfile)).length;
console.log(`dist/_worker.js  ${(raw / 1024).toFixed(1)} KiB raw, ${(gzip / 1024).toFixed(1)} KiB gzip`);
