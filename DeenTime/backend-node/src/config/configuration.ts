import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Configuration model compatible with the .NET API: values come from
 * appsettings.json, appsettings.{Environment}.json and environment variables
 * whose names use "__" as the section separator (Auth__SigningKey,
 * ConnectionStrings__Default, Cors__AllowedOrigins__0, ...). Keys are
 * case-insensitive, exactly like Microsoft.Extensions.Configuration.
 */
export type ConfigValue = string | number | boolean | null | ConfigObject | ConfigValue[];
export interface ConfigObject {
  [key: string]: ConfigValue;
}

const NODE_ENV_ALIASES: Record<string, string> = {
  development: 'Development',
  dev: 'Development',
  production: 'Production',
  prod: 'Production',
  staging: 'Staging',
  test: 'Testing',
  testing: 'Testing',
};

export function resolveEnvironmentName(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.ASPNETCORE_ENVIRONMENT || env.DOTNET_ENVIRONMENT || env.DEENTIME_ENVIRONMENT;
  if (explicit && explicit.trim()) return explicit.trim();
  const node = (env.NODE_ENV ?? '').trim().toLowerCase();
  return NODE_ENV_ALIASES[node] ?? 'Production';
}

export interface AppConfigOptions {
  /** Directory holding appsettings*.json (defaults to the process working directory). */
  contentRoot?: string;
  env?: NodeJS.ProcessEnv;
  /** Highest-precedence values, used by tests (like WebApplicationFactory.UseSetting). */
  overrides?: Record<string, string | undefined>;
  environmentName?: string;
}

export class AppConfig {
  private constructor(
    readonly environment: string,
    readonly contentRoot: string,
    private readonly root: ConfigObject,
  ) {}

  static load(options: AppConfigOptions = {}): AppConfig {
    const env = options.env ?? process.env;
    const contentRoot = resolve(options.contentRoot ?? process.cwd());
    const environment = options.environmentName ?? resolveEnvironmentName(env);
    const root: ConfigObject = {};
    for (const file of ['appsettings.json', `appsettings.${environment}.json`]) {
      const path = resolve(contentRoot, file);
      if (!existsSync(path)) continue;
      mergeInto(root, JSON.parse(readFileSync(path, 'utf8')) as ConfigObject);
    }
    for (const [name, value] of Object.entries(env)) {
      if (value === undefined || !name.includes('__')) continue;
      setPath(root, name.split('__'), value);
    }
    for (const [name, value] of Object.entries(options.overrides ?? {})) {
      if (value === undefined) continue;
      setPath(root, name.split(/[:_]{1,2}|:/).filter(Boolean), value);
    }
    return new AppConfig(environment, contentRoot, root);
  }

  isDevelopment(): boolean {
    return this.environment.toLowerCase() === 'development';
  }

  /** Scalar lookup with "Section:Key" (or "Section__Key") syntax; undefined when missing. */
  get(path: string): string | undefined {
    const value = this.lookup(path);
    if (value === undefined || value === null || typeof value === 'object') return undefined;
    return String(value);
  }

  getOrDefault(path: string, fallback: string): string {
    const value = this.get(path);
    return value === undefined || value === '' ? fallback : value;
  }

  getBoolean(path: string, fallback = false): boolean {
    const value = this.get(path);
    if (value === undefined || value === '') return fallback;
    return /^(true|1|yes|on)$/i.test(value.trim());
  }

  getInt(path: string, fallback: number): number {
    const value = this.get(path);
    if (value === undefined || value === '') return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  getNumber(path: string, fallback: number): number {
    const value = this.get(path);
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  /** Arrays stored either as JSON arrays or as indexed keys (Key__0, Key__1). */
  getArray(path: string): string[] {
    const value = this.lookup(path);
    if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined).map(String);
    if (value && typeof value === 'object') {
      return Object.keys(value)
        .filter((key) => /^\d+$/.test(key))
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => String((value as ConfigObject)[key]));
    }
    return value === undefined || value === null ? [] : [String(value)];
  }

  getSection(path: string): ConfigObject {
    const value = this.lookup(path);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as ConfigObject) : {};
  }

  private lookup(path: string): ConfigValue | undefined {
    const segments = path.split(/__|:/).filter(Boolean);
    let current: ConfigValue | undefined = this.root;
    for (const segment of segments) {
      if (current === null || current === undefined) return undefined;
      if (Array.isArray(current)) {
        const index = Number(segment);
        current = Number.isInteger(index) ? current[index] : undefined;
        continue;
      }
      if (typeof current !== 'object') return undefined;
      current = findKey(current, segment);
    }
    return current;
  }
}

function findKey(object: ConfigObject, segment: string): ConfigValue | undefined {
  if (segment in object) return object[segment];
  const lowered = segment.toLowerCase();
  const match = Object.keys(object).find((key) => key.toLowerCase() === lowered);
  return match === undefined ? undefined : object[match];
}

function mergeInto(target: ConfigObject, source: ConfigObject): void {
  for (const [key, value] of Object.entries(source)) {
    const existingKey = Object.keys(target).find((candidate) => candidate.toLowerCase() === key.toLowerCase()) ?? key;
    const existing = target[existingKey];
    if (isPlainObject(value) && isPlainObject(existing)) {
      mergeInto(existing, value);
    } else {
      target[existingKey] = value;
    }
  }
}

function setPath(target: ConfigObject, segments: string[], value: string): void {
  let current: ConfigObject = target;
  segments.forEach((segment, index) => {
    const key = Object.keys(current).find((candidate) => candidate.toLowerCase() === segment.toLowerCase()) ?? segment;
    if (index === segments.length - 1) {
      current[key] = value;
      return;
    }
    let next = current[key];
    if (Array.isArray(next)) {
      // Indexed environment overrides (Cors__AllowedOrigins__0) replace JSON arrays element-wise.
      const asObject: ConfigObject = {};
      next.forEach((item, position) => {
        asObject[String(position)] = item;
      });
      next = asObject;
      current[key] = next;
    }
    if (!isPlainObject(next)) {
      next = {};
      current[key] = next;
    }
    current = next;
  });
}

function isPlainObject(value: ConfigValue | undefined): value is ConfigObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parses ASPNETCORE_URLS / Urls ("http://127.0.0.1:8080;http://[::1]:8080") into a listen address. */
export function resolveListenAddress(config: AppConfig, env: NodeJS.ProcessEnv = process.env): { host: string; port: number } {
  const urls = env.ASPNETCORE_URLS || config.get('Urls') || env.URLS;
  if (urls) {
    const first = urls.split(';').map((item) => item.trim()).find(Boolean);
    if (first) {
      try {
        const url = new URL(first.replace('*', '0.0.0.0').replace('+', '0.0.0.0'));
        const host = url.hostname.replace(/^\[|\]$/g, '');
        const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
        return { host: host === 'localhost' ? '127.0.0.1' : host, port };
      } catch {
        // fall through to PORT
      }
    }
  }
  const port = Number(env.PORT ?? 8080);
  return { host: '127.0.0.1', port: Number.isFinite(port) ? port : 8080 };
}

/**
 * Converts an ADO.NET style PostgreSQL connection string
 * ("Host=localhost;Port=5432;Database=deentime;Username=postgres;Password=postgres")
 * into node-postgres pool settings. Plain postgresql:// URLs are accepted too.
 */
export interface PostgresSettings {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
  connectionString?: string;
}

export function parsePostgresConnectionString(value: string): PostgresSettings {
  const trimmed = value.trim();
  if (/^postgres(ql)?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    return {
      connectionString: trimmed,
      host: url.hostname,
      port: url.port ? Number(url.port) : 5432,
      database: decodeURIComponent(url.pathname.replace(/^\//, '')),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };
  }
  const pairs = new Map<string, string>();
  for (const part of trimmed.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    pairs.set(part.slice(0, separator).trim().toLowerCase(), part.slice(separator + 1).trim());
  }
  const pick = (...names: string[]) => names.map((name) => pairs.get(name)).find((item) => item !== undefined);
  const sslMode = (pick('ssl mode', 'sslmode') ?? 'disable').toLowerCase();
  return {
    host: pick('host', 'server', 'data source') ?? 'localhost',
    port: Number(pick('port') ?? 5432),
    database: pick('database', 'initial catalog') ?? 'postgres',
    user: pick('username', 'user id', 'userid', 'uid', 'user') ?? 'postgres',
    password: pick('password', 'pwd') ?? '',
    ssl: sslMode !== 'disable' && sslMode !== 'allow' && sslMode !== 'prefer' ? true : undefined,
  };
}
