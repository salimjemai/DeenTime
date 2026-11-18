import type { Context, Hono, MiddlewareHandler } from 'hono';
import { AppConfig } from './config.js';
import { Db } from './db.js';
import { JwtService, type SessionUser } from './jwt.js';

/** Worker bindings. Settings arrive as extra string-valued entries (Auth__SigningKey, ...). */
export interface Env {
  DB: D1Database;
  UPLOADS: KVNamespace;
  ASSETS: Fetcher;
}

/** Per-isolate services derived from `env`; built once and reused by every request. */
export interface Services {
  config: AppConfig;
  db: Db;
  /** Lowercased Cors:AllowedOrigins. */
  allowedOrigins: Set<string>;
  /** Throws when Auth:SigningKey is missing or too short (backend-node refuses to start). */
  jwt(): JwtService;
}

export interface Variables {
  services: Services;
  correlationId: string;
  user: SessionUser | null;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
export type App = Hono<AppEnv>;
export type Ctx = Context<AppEnv>;
export type Middleware = MiddlewareHandler<AppEnv>;

const cache = new WeakMap<object, Services>();

export function servicesFor(env: Env): Services {
  let services = cache.get(env);
  if (!services) {
    const config = AppConfig.fromEnv(env);
    let jwt: JwtService | null = null;
    services = {
      config,
      db: new Db(env.DB),
      allowedOrigins: new Set(
        config
          .getArray('Cors:AllowedOrigins')
          .map((origin) => origin.trim().toLowerCase())
          .filter(Boolean),
      ),
      jwt: () => (jwt ??= new JwtService(config)),
    };
    cache.set(env, services);
  }
  return services;
}

/** Settings ("Section:Key" lookups). */
export function config(c: Ctx): AppConfig {
  return c.get('services').config;
}

/** The D1 helper. */
export function db(c: Ctx): Db {
  return c.get('services').db;
}

export function jwt(c: Ctx): JwtService {
  return c.get('services').jwt();
}

/** The authenticated session user, or null on anonymous requests. */
export function currentUser(c: Ctx): SessionUser | null {
  return c.get('user') ?? null;
}

export function correlationId(c: Ctx): string {
  return c.get('correlationId');
}
