import { ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { JsonResponseException, ProblemDetailsException } from './errors.js';

/** Paths that never fall back to the SPA (Program.cs MapFallback). */
export const API_PREFIXES = ['/api', '/health', '/public', '/uploads', '/jobs', '/swagger'];

export function isApiPath(path: string): boolean {
  return API_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Renders every error the way the .NET API did:
 *  - ProblemDetails (application/problem+json) for Problem()/ValidationProblem();
 *  - JSON or plain-string bodies for BadRequest(new {...}) / BadRequest("text");
 *  - unmatched routes: 404 without a body under API prefixes, otherwise the SPA's
 *    index.html (Cache-Control: no-store);
 *  - anything else: 500 application/problem+json with the correlation id.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  constructor(private readonly webRoot: string) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request & { correlationId?: string; id?: string }>();

    if (exception instanceof ProblemDetailsException) {
      response.status(exception.problem.status).type('application/problem+json').send(JSON.stringify(exception.problem));
      return;
    }
    if (exception instanceof JsonResponseException) {
      const body = exception.body;
      if (body === undefined || body === null || body === '') {
        response.status(exception.getStatus()).send();
      } else if (typeof body === 'string') {
        response.status(exception.getStatus()).type('text/plain; charset=utf-8').send(body);
      } else {
        response.status(exception.getStatus()).json(body);
      }
      return;
    }
    if (exception instanceof NotFoundException && !(request as { routeMatched?: boolean }).routeMatched) {
      this.spaFallback(request, response);
      return;
    }
    if (exception instanceof PayloadTooLargeException) {
      response.status(413).send();
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (status === 404) {
        this.spaFallback(request, response);
        return;
      }
      if (status === 400 && typeof payload === 'object' && payload && 'message' in payload) {
        // Body parser / framework validation failures: mirror ASP.NET's empty-body 400.
        response.status(400).type('application/problem+json').send(
          JSON.stringify({ type: 'https://tools.ietf.org/html/rfc9110#section-15.5.1', title: 'One or more validation errors occurred.', status: 400, errors: { '': [String((payload as { message: unknown }).message)] } }),
        );
        return;
      }
      if (typeof payload === 'string') response.status(status).type('text/plain; charset=utf-8').send(payload);
      else response.status(status).json(payload);
      return;
    }

    const correlationId = request.correlationId ?? request.id ?? '';
    this.logger.error(`Unhandled exception for ${request.method} ${request.originalUrl} (correlation ${correlationId})`, exception instanceof Error ? exception.stack : String(exception));
    if (response.headersSent) return;
    response.status(500).type('application/problem+json').send(
      JSON.stringify({
        type: 'https://httpstatuses.com/500',
        title: 'The request could not be completed.',
        status: 500,
        detail: 'Try again or provide the correlation id to support.',
        correlationId,
      }),
    );
  }

  private spaFallback(request: Request, response: Response): void {
    const path = request.path;
    if (isApiPath(path) || request.method !== 'GET') {
      response.status(404).send();
      return;
    }
    const index = join(this.webRoot, 'index.html');
    if (!existsSync(index)) {
      response.status(404).send();
      return;
    }
    response.status(200).setHeader('Cache-Control', 'no-store');
    response.type('text/html; charset=utf-8');
    response.sendFile(index);
  }
}
