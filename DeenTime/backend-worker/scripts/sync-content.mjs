// Fills the content tables of the D1 database: the Qur'an edition catalogue, catalogue
// metadata and per-ayah payloads (AlQuran Cloud), and the Hadith library (hadithapi.com).
//
// backend-node did this in a background worker inside the API process. A Worker on the
// free plan cannot (10 ms CPU, 50 subrequests per request, no background process), so the
// same download and mapping code (src/modules/islamic-content/offline-sync.ts, bundled
// here with esbuild) runs on this computer. It writes the rows as .sql files and applies
// them with `npx wrangler d1 execute <database> --file <file>`, a few thousand
// statements per file. Progress is stored in IslamicContentSyncStates, so the dashboard's
// content page shows it exactly as it did with backend-node.
//
// Usage (from backend-worker):
//   node scripts/sync-content.mjs [options]
//
//   --provider quran|hadith|all   What to synchronize (default: all; Hadith is skipped
//                                 with a notice when no API key is set).
//   --scope catalog|text|all      Qur'an scope (default: all).
//                                   catalog  editions + catalogue metadata
//                                   text     catalog + the ayahs of the selected text editions
//                                   all      catalog + the ayahs of the selected text and audio editions
//   --editions a,b,c|all          Editions whose ayahs are stored (default: quran-uthmani,
//                                 en.sahih,ar.alafasy, which the showcase needs). `all` is the
//                                 whole catalogue: about 6,236 rows per edition.
//   --books slug,slug             Hadith books to import (default: every book). Use it to
//                                 continue after a failure or to spread a first import
//                                 over several days.
//   --database <name>             D1 database name (default: masjidhub; masjidhub-local with --local).
//   --local                       Write to the local D1 that `npm run dev` uses instead of
//                                 the remote database.
//   --config <file>               Wrangler config that declares the database (default:
//                                 ../frontend/deentime-web/wrangler.toml; wrangler.local-dev.jsonc with --local).
//   --persist-to <dir>            With --local: the wrangler state directory.
//   --out <dir>                   Where the .sql files go (default: .wrangler/sync-content).
//   --keep                        Keep the .sql files after they were applied.
//   --dry-run                     Download and write the .sql files, do not run wrangler.
//   --help
//
// The Hadith API key is read from the environment variable IslamicContent__HadithApiKey,
// or from the same line in .dev.vars. It is only sent to hadithapi.com: never written to
// a file, never put on a command line. The Worker itself does not need it.
//
// Free-plan limits to keep in mind: D1 allows 100,000 row writes per day (an index entry
// counts as a write) and 500 MB per database. The three showcase editions are about
// 19,000 rows; the complete Hadith library is about 40,000 records with four indexes,
// which is more than one day's allowance: import it in parts with --books.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_FILE_BYTES = 4_000_000;
const MAX_FILE_STATEMENTS = 5_000;

function fail(message) {
  console.error(`sync-content: ${message}`);
  process.exit(1);
}

function usage() {
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const start = source.indexOf('// Usage');
  const end = source.indexOf('import ');
  console.log(
    source
      .slice(start, end)
      .split('\n')
      .map((line) => line.replace(/^\/\/ ?/, ''))
      .join('\n')
      .trimEnd(),
  );
}

let args;
try {
  args = parseArgs({
    options: {
      provider: { type: 'string', default: 'all' },
      scope: { type: 'string', default: 'all' },
      editions: { type: 'string' },
      books: { type: 'string' },
      database: { type: 'string' },
      local: { type: 'boolean', default: false },
      config: { type: 'string' },
      'persist-to': { type: 'string' },
      out: { type: 'string', default: '.wrangler/sync-content' },
      keep: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  }).values;
} catch (error) {
  fail(`${error.message}\nRun with --help for the options.`);
}
if (args.help) {
  usage();
  process.exit(0);
}

const provider = args.provider.trim().toLowerCase();
if (!['quran', 'hadith', 'all'].includes(provider)) fail('--provider must be quran, hadith or all.');
const scope = args.scope.trim().toLowerCase();
if (!['catalog', 'text', 'all'].includes(scope)) fail('--scope must be catalog, text or all.');
if (args['persist-to'] && !args.local) fail('--persist-to only applies with --local.');

const list = (value) =>
  value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
const editions = args.editions?.trim().toLowerCase() === 'all' ? 'all' : list(args.editions);
const books = list(args.books);

const database = args.database ?? (args.local ? 'masjidhub-local' : 'masjidhub');
const config = resolve(root, args.config ?? (args.local ? 'wrangler.local-dev.jsonc' : '../frontend/deentime-web/wrangler.toml'));
if (!args['dry-run'] && !existsSync(config)) fail(`Wrangler config not found: ${config} (use --config).`);
const outDir = resolve(root, args.out);

/** Settings: appsettings.json, overridden by .dev.vars, overridden by the environment (Section__Key). */
function readSettings() {
  const section = JSON.parse(readFileSync(resolve(root, 'appsettings.json'), 'utf8')).IslamicContent ?? {};
  const overrides = {};
  const devVars = resolve(root, '.dev.vars');
  if (existsSync(devVars)) {
    for (const line of readFileSync(devVars, 'utf8').split(/\r?\n/)) {
      const match = /^\s*IslamicContent__(\w+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match) overrides[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
    }
  }
  for (const [name, value] of Object.entries(process.env)) {
    const match = /^IslamicContent__(\w+)$/i.exec(name);
    if (match && value !== undefined) overrides[match[1]] = value;
  }
  const get = (key) => {
    const name = Object.keys(overrides).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    return name !== undefined ? overrides[name] : section[key];
  };
  const text = (key) => (get(key) === undefined || get(key) === null ? undefined : String(get(key)));
  const int = (key, fallback) => (Number.isInteger(Number(get(key))) && String(get(key) ?? '').trim() !== '' ? Number(get(key)) : fallback);
  return {
    quranBaseUrl: text('QuranBaseUrl'),
    alAdhanBaseUrl: text('AlAdhanBaseUrl'),
    hadithBaseUrl: text('HadithBaseUrl'),
    hadithApiKey: text('HadithApiKey'),
    quranCacheDays: int('QuranCacheDays', 30),
    qiblaCacheDays: int('QiblaCacheDays', 30),
  };
}

/** The sync code is TypeScript shared with the Worker: bundle it for Node. */
async function loadSync() {
  mkdirSync(outDir, { recursive: true });
  const outfile = resolve(outDir, 'offline-sync.bundle.mjs');
  await build({
    entryPoints: [resolve(root, 'src/modules/islamic-content/offline-sync.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'warning',
  });
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
}

function quote(value) {
  return /^[\w@%+=:,./\\-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`;
}

let fileNumber = 0;
const written = [];

function apply(file, count) {
  const command = ['npx', 'wrangler', 'd1', 'execute', database, args.local ? '--local' : '--remote', '--file', relative(root, file), '--yes', '--config', relative(root, config)];
  if (args['persist-to']) command.push('--persist-to', args['persist-to']);
  console.log(`  ${relative(root, file)}: ${count} statements`);
  if (args['dry-run']) return;
  // A shell is needed to start npx on Windows; every argument is quoted.
  const result = spawnSync(command.map(quote).join(' '), { cwd: root, shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) {
    throw new Error(`wrangler d1 execute failed for ${relative(root, file)} (exit ${result.status ?? result.signal}).\n${(result.stderr || result.stdout || '').trim()}`);
  }
  if (!args.keep) rmSync(file, { force: true });
}

/** Receives each group of statements, in order: writes it as one or more files and applies them. */
const sink = {
  async write(label, statements) {
    let chunk = [];
    let bytes = 0;
    const flush = () => {
      if (chunk.length === 0) return;
      const file = resolve(outDir, `${String(++fileNumber).padStart(4, '0')}-${label.replace(/[^\w.-]+/g, '_')}.sql`);
      writeFileSync(file, chunk.join('\n') + '\n', 'utf8');
      written.push(file);
      apply(file, chunk.length);
      chunk = [];
      bytes = 0;
    };
    for (const statement of statements) {
      const size = Buffer.byteLength(statement, 'utf8') + 1;
      if (chunk.length >= MAX_FILE_STATEMENTS || (chunk.length > 0 && bytes + size > MAX_FILE_BYTES)) flush();
      chunk.push(statement);
      bytes += size;
    }
    flush();
  },
};

const settings = readSettings();
const sync = await loadSync();
let options;
try {
  options = new sync.IslamicContentOptions(settings);
} catch (error) {
  fail(error.message);
}
const deps = { options, sink, log: (message) => console.log(message) };

console.log(
  args['dry-run']
    ? `Dry run: SQL files are written to ${relative(root, outDir) || '.'} and not applied.`
    : `Target: ${args.local ? 'local' : 'REMOTE'} D1 database "${database}" (${relative(root, config)}).`,
);

let failed = false;
try {
  if (provider === 'quran' || provider === 'all') {
    console.log(`\nQur'an (${scope})`);
    const result = await sync.syncQuranOffline({ scope, editions }, deps);
    console.log(`Qur'an: ${result.editions} editions, ${result.cataloguePayloads} catalogue payloads, ${result.ayahRows} ayah rows (${result.ayahEditions.join(', ') || 'no editions'}).`);
  }
  if (provider === 'hadith' || provider === 'all') {
    if (!options.isHadithConfigured && provider === 'all') {
      console.log('\nHadith: skipped, no API key. Set IslamicContent__HadithApiKey (environment or .dev.vars) and run with --provider hadith.');
    } else {
      console.log('\nHadith');
      const result = await sync.syncHadithOffline({ books }, deps);
      console.log(`Hadith: ${result.books} books, ${result.chapters} chapters, ${result.records} records.`);
    }
  }
} catch (error) {
  failed = true;
  // Provider URLs can carry the API key: print the message only, never a cause or a URL.
  console.error(`\nsync-content failed: ${error instanceof Error ? error.message : String(error)}`);
}

if (args['dry-run'] || args.keep) console.log(`\n${written.length} SQL files in ${relative(root, outDir) || '.'}.`);
process.exit(failed ? 1 : 0);
