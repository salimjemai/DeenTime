#!/usr/bin/env node
// Sets the password of one MasjidHub account directly in D1.
//
//   node scripts/set-password.mjs                      remote database "masjidhub"
//   node scripts/set-password.mjs --database <name>    another remote database
//   node scripts/set-password.mjs --local              the local dev database (wrangler.local-dev.jsonc)
//   node scripts/set-password.mjs --config <file>      wrangler config to use (optional)
//
// Use it for accounts whose stored hash the Worker cannot verify (backend-node wrote
// 600,000 PBKDF2 iterations; the Worker computes at most 100,000) when the reset email is
// not an option. The email and the new password are asked for on the terminal. The password
// is typed twice without echo; it is never taken from the command line, an environment
// variable or a pipe, and neither it nor its hash is printed. The SQL reaches wrangler in a
// temporary file (`wrangler d1 execute --file`) that is deleted afterwards, so the hash is
// not on a command line either. A remote database needs `wrangler login` (or
// CLOUDFLARE_API_TOKEN) first.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { buildUpdateSql, hashPassword, passwordProblem, sqlText } from './password-hash.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DATABASE = 'masjidhub';
const LOCAL_CONFIG = 'wrangler.local-dev.jsonc';
const LOCAL_DATABASE = 'masjidhub-local';
const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const DATABASE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;

const USAGE = `Usage: node scripts/set-password.mjs [--database <name>] [--local] [--config <wrangler config>]

Sets the password of one account in the D1 database (default: remote "${DEFAULT_DATABASE}").
With --local and neither --database nor --config: database "${LOCAL_DATABASE}" from ${LOCAL_CONFIG}.
The email and the new password are asked for interactively; they cannot be passed as arguments.`;

class UsageError extends Error {}

function parseArgs(argv) {
  const options = { database: null, local: false, config: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const valueOf = (name) => {
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
      const value = argv[++index];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${name} needs a value.`);
      return value;
    };
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--local') options.local = true;
    else if (arg === '--remote') options.local = false;
    else if (arg === '--database' || arg.startsWith('--database=')) options.database = valueOf('--database');
    else if (arg === '--config' || arg.startsWith('--config=')) options.config = valueOf('--config');
    // Anything else is refused (and not repeated), so a password can never be given this way.
    else throw new UsageError('Unknown argument. The email and password are asked for interactively and cannot be passed as arguments.');
  }
  if (options.local && options.database === null && options.config === null && existsSync(join(projectRoot, LOCAL_CONFIG))) {
    options.database = LOCAL_DATABASE;
    options.config = LOCAL_CONFIG;
  }
  options.database ??= DEFAULT_DATABASE;
  if (!DATABASE_PATTERN.test(options.database)) throw new UsageError('The database name may contain letters, digits, "-" and "_" only.');
  if (options.config !== null && !existsSync(resolve(projectRoot, options.config))) throw new UsageError('The --config file does not exist.');
  return options;
}

/** Reads one line from the terminal in raw mode: nothing typed is echoed. */
function promptHidden(question) {
  return new Promise((resolvePrompt, rejectPrompt) => {
    const { stdin, stdout } = process;
    let value = '';
    const finish = (error) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      if (error) rejectPrompt(error);
      else resolvePrompt(value);
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n' || char === '\u0004') return finish();
        if (char === '\u0003') return finish(new Error('Cancelled. Nothing was changed.'));
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    stdout.write(question);
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

/** Runs wrangler (`npx wrangler` when it is not installed here) and returns its exit code and output, which is never printed as is. */
function wrangler(args) {
  const installed = join(projectRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  // The installed entry point is what `npx wrangler` runs; starting it with node needs no shell, so no argument is re-parsed.
  const [command, prefix, shell] = existsSync(installed) ? [process.execPath, [installed], false] : ['npx', ['wrangler'], process.platform === 'win32'];
  const result = spawnSync(command, [...prefix, ...args], { cwd: projectRoot, encoding: 'utf8', shell, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  if (result.error) throw new Error(`wrangler could not be started: ${result.error.message}`);
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function d1Args(options, extra) {
  const args = ['d1', 'execute', options.database, options.local ? '--local' : '--remote', '--yes', ...extra];
  if (options.config !== null) args.push('--config', options.config);
  return args;
}

/** wrangler's message with anything secret removed. */
function describeFailure(result, secrets) {
  let text = `${result.stderr}\n${result.stdout}`.trim();
  for (const secret of secrets) text = text.split(secret).join('[redacted]');
  return text.length > 2000 ? `${text.slice(0, 2000)}...` : text;
}

function rowsOf(stdout) {
  const start = stdout.indexOf('[');
  if (start < 0) throw new Error('wrangler did not return JSON.');
  const parsed = JSON.parse(stdout.slice(start));
  return (Array.isArray(parsed) ? parsed : [parsed]).flatMap((entry) => entry?.results ?? []);
}

function countAccounts(options, email) {
  // The email is restricted to EMAIL_PATTERN (no quotes or spaces) before it gets here.
  const result = wrangler(d1Args(options, ['--json', '--command', `SELECT COUNT(*) AS Accounts FROM AppUsers WHERE Email = ${sqlText(email)}`]));
  if (result.status !== 0) throw new Error(`The account lookup failed:\n${describeFailure(result, [])}`);
  return Number(rowsOf(result.stdout)[0]?.Accounts ?? 0);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new UsageError('Run this in an interactive terminal: the password is typed, never piped or passed as an argument.');
  }
  const target = `${options.local ? 'local' : 'REMOTE'} database "${options.database}"`;
  console.log(`Set an account password in the ${target}.`);

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const email = (await readline.question('Account email: ')).trim().toLowerCase();
  readline.close();
  if (!EMAIL_PATTERN.test(email)) throw new UsageError('That is not a valid email address.');
  if (countAccounts(options, email) !== 1) throw new Error(`No account with the email ${email} exists in the ${target}. Nothing was changed.`);

  const password = await promptHidden('New password (not shown): ');
  const problem = passwordProblem(password);
  if (problem !== null) throw new Error(`${problem} Nothing was changed.`);
  if ((await promptHidden('Repeat the new password: ')) !== password) throw new Error('The two passwords do not match. Nothing was changed.');

  const hashed = await hashPassword(password);
  const directory = mkdtempSync(join(tmpdir(), 'masjidhub-set-password-'));
  try {
    const file = join(directory, 'set-password.sql');
    writeFileSync(file, await buildUpdateSql(email, hashed), { mode: 0o600 });
    const update = wrangler(d1Args(options, ['--file', file]));
    if (update.status !== 0) throw new Error(`The update failed; check whether the password changed before retrying:\n${describeFailure(update, [hashed.hash, hashed.salt, password])}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }

  console.log(`The password of ${email} was updated in the ${target}.`);
  console.log('Any outstanding password-reset link and failed sign-in lockout of that account were cleared.');
  console.log('The schema stores no refresh tokens or sessions: session tokens already issued stay valid until they expire.');
}

main().catch((error) => {
  console.error(error instanceof UsageError ? `${error.message}\n\n${USAGE}` : (error?.message ?? 'Failed.'));
  process.exitCode = 1;
});
