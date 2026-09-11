import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const CORRELATION_HEADER = 'X-Correlation-Id';

/** Correlation id echo (CorrelationIdMiddleware): incoming header when sane, else a new id. */
export function correlationId() {
  return (request: Request & { correlationId?: string; id?: string }, response: Response, next: NextFunction): void => {
    const incoming = request.header(CORRELATION_HEADER);
    const id = incoming && incoming.trim() && incoming.length <= 128 ? incoming.trim() : randomUUID().replace(/-/g, '');
    request.correlationId = id;
    request.id = id;
    response.setHeader(CORRELATION_HEADER, id);
    next();
  };
}

/** Security headers from Program.cs, including the embeddable public display routes. */
export function securityHeaders() {
  return (request: Request, response: Response, next: NextFunction): void => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (/^\/(?:tv|w|w2)(?:\/|$)/.test(request.path)) {
      response.removeHeader('X-Frame-Options');
      response.setHeader('Content-Security-Policy', 'frame-ancestors *');
    } else {
      response.setHeader('X-Frame-Options', 'DENY');
    }
    next();
  };
}

export const PUBLIC_CONTENT_CORS = {
  origin: '*',
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Accept', 'Authorization', 'Content-Type', 'X-IqamaTime-Client-Key', 'X-DeenTime-Client-Key'],
  exposedHeaders: ['X-IqamaTime-Source', 'X-IqamaTime-Retrieved', 'Warning'],
  credentials: false,
  optionsSuccessStatus: 204,
};

export function dashboardCors(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins.map((origin) => origin.trim().toLowerCase()).filter(Boolean));
  return {
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
      callback(null, !!origin && allowed.has(origin.toLowerCase()));
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    optionsSuccessStatus: 204,
  };
}
