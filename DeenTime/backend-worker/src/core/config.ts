import appsettings from '../../appsettings.json';

/**
 * Configuration model compatible with backend-node (and the .NET API before it):
 * defaults come from appsettings.json, baked into the bundle at build time, and are
 * overridden by Worker variables/secrets whose names use "__" as the section separator
 * (Auth__SigningKey, Cors__AllowedOrigins__0, ...). Keys are case-insensitive.
 */
export type ConfigValue = string | number | boolean | null | ConfigObject | ConfigValue[];
export interface ConfigObject {
  [key: string]: ConfigValue;
}

const ENVIRONMENT_ALIASES: Record<string, string> = {
  development: 'Development',
  dev: 'Development',
  production: 'Production',
  prod: 'Production',
  staging: 'Staging',
  test: 'Testing',
  testing: 'Testing',
};

type EnvLike = Record<string, unknown>;

function envString(env: EnvLike, name: string): string | undefined {
  const value = env[name];
  return typeof value === 'string' ? value : undefined;
}

export function resolveEnvironmentName(env: EnvLike): string {
  const explicit = envString(env, 'ASPNETCORE_ENVIRONMENT') || envString(env, 'DOTNET_ENVIRONMENT') || envString(env, 'DEENTIME_ENVIRONMENT');
  if (explicit && explicit.trim()) return explicit.trim();
  const node = (envString(env, 'NODE_ENV') ?? '').trim().toLowerCase();
  return ENVIRONMENT_ALIASES[node] ?? 'Production';
}

export interface AppConfigOptions {
  /** Highest-precedence values keyed "Section:Key" (or "Section__Key"), used by tests. */
  overrides?: Record<string, string | undefined>;
  environmentName?: string;
}

export class AppConfig {
  private constructor(
    readonly environment: string,
    private readonly root: ConfigObject,
  ) {}

  /** Builds the configuration from the Worker `env` (string-valued entries only; bindings are ignored). */
  static fromEnv(env: object, options: AppConfigOptions = {}): AppConfig {
    const source = env as EnvLike;
    const environment = options.environmentName ?? resolveEnvironmentName(source);
    const root: ConfigObject = {};
    mergeInto(root, structuredClone(appsettings) as ConfigObject);
    for (const [name, value] of Object.entries(source)) {
      if (typeof value !== 'string' || !name.includes('__')) continue;
      setPath(root, name.split('__'), value);
    }
    for (const [name, value] of Object.entries(options.overrides ?? {})) {
      if (value === undefined) continue;
      setPath(root, name.split(/[:_]{1,2}|:/).filter(Boolean), value);
    }
    return new AppConfig(environment, root);
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
      // Indexed overrides (Cors__AllowedOrigins__0) replace JSON arrays element-wise.
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
