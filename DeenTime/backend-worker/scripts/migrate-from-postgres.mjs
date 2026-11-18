// Copies the data of the backend-node PostgreSQL database into the Worker's D1 database.
//
//   node scripts/migrate-from-postgres.mjs --out data.sql            write the SQL only
//   node scripts/migrate-from-postgres.mjs --apply --remote          write it and load it into D1
//   node scripts/migrate-from-postgres.mjs --apply --local           load it into the local dev D1
//
// Reads PostgreSQL through psql (PSQL env var or psql on PATH) using the standard
// PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE variables (database default: deentime).
// Values are converted to the D1 column formats described in README.md. Every table is
// emptied first, so the script can be repeated; RateLimitWindows is left alone.
// The SQL file contains password hashes and tokens: it is written to the system temp
// folder unless --out is given, and deleted after --apply.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

// Parents before children, so foreign keys hold while rows are inserted.
const TABLES = [
  'Organizations', 'AppUsers', 'OrgUsers', 'ApiClients', 'ApiClientUsage', 'DesignSettings',
  'HijriMonthMaps', 'IqamaEntries', 'PrayerTimingCriteria', 'PublishArtifacts', 'TvDisplayConfigs',
  'MasjidInvitations', 'PendingRegistrations', 'QuranEditions', 'HadithBooks', 'HadithChapters',
  'HadithRecords', 'IslamicContentCacheEntries', 'IslamicContentSyncStates',
];

const psqlBin = process.env.PSQL ?? 'psql';
const database = process.env.PGDATABASE ?? 'deentime';
function psql(sql) {
  return execFileSync(psqlBin, ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', database, '-c', sql], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
    env: { ...process.env, PGCLIENTENCODING: 'UTF8' },
  });
}

const quote = (text) => `'${String(text).replaceAll("'", "''")}'`;

export function toInstant(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Not a timestamp: ${value}`);
  return date.toISOString();
}

/** One PostgreSQL value (as row_to_json renders it) -> a SQLite literal. */
export function literal(value, type) {
  if (value === null || value === undefined) return 'NULL';
  switch (type) {
    case 'uuid': return quote(String(value).toLowerCase());
    case 'timestamptz': case 'timestamp': return quote(toInstant(value));
    case 'date': return quote(String(value).slice(0, 10));
    case 'time': return quote(String(value).slice(0, 8));
    case 'bool': return value ? '1' : '0';
    case 'int2': case 'int4': case 'int8': case 'numeric': case 'float4': case 'float8': {
      const number = Number(value);
      if (!Number.isFinite(number)) throw new Error(`Not a number: ${value}`);
      return String(number);
    }
    case 'json': case 'jsonb': case '_text': case '_varchar': case '_uuid': return quote(JSON.stringify(value));
    default: return quote(value);
  }
}

function columnsOf(table) {
  return psql(
    `select column_name || '|' || udt_name from information_schema.columns ` +
      `where table_schema = 'public' and table_name = ${quote(table)} order by ordinal_position`,
  ).split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, type] = line.split('|');
    return { name, type };
  });
}

function main() {
  const statements = ['PRAGMA defer_foreign_keys = true;'];
  for (const table of [...TABLES].reverse()) statements.push(`DELETE FROM "${table}";`);
  const counts = [];
  for (const table of TABLES) {
    const columns = columnsOf(table);
    if (columns.length === 0) throw new Error(`Table ${table} not found in PostgreSQL`);
    const rows = psql(`select row_to_json(t) from "${table}" t`).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    counts.push(`${table}: ${rows.length}`);
    const names = columns.map((column) => `"${column.name}"`).join(', ');
    for (const row of rows) {
      const values = columns.map((column) => literal(row[column.name], column.type)).join(', ');
      statements.push(`INSERT INTO "${table}" (${names}) VALUES (${values});`);
    }
  }

  const folder = option('--out') ? null : mkdtempSync(join(tmpdir(), 'masjidhub-d1-'));
  const file = option('--out') ? resolve(option('--out')) : join(folder, 'data.sql');
  writeFileSync(file, statements.join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
  console.log(`Rows read from PostgreSQL -> ${counts.join(', ')}`);

  try {
    if (flag('--apply')) {
      const target = flag('--remote') ? '--remote' : '--local';
      const d1 = option('--database', target === '--remote' ? 'masjidhub' : 'masjidhub-local');
      const config = option('--config', target === '--remote' ? null : 'wrangler.local-dev.jsonc');
      const command = ['wrangler', 'd1', 'execute', d1, target, '--yes', '--file', file, ...(config ? ['--config', config] : [])];
      execFileSync('npx', command, { cwd: option('--cwd', root), stdio: 'inherit', shell: process.platform === 'win32' });
      console.log(`Loaded into D1 database ${d1} (${target.slice(2)}).`);
    } else {
      console.log(`SQL written to ${file} (contains password hashes; delete it when done).`);
    }
  } finally {
    if (folder && flag('--apply')) rmSync(folder, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
