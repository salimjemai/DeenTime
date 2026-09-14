import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Response bodies matching the .NET API. The frontend reads
 * `error.error?.message ?? error.error?.title` and `api-error.ts` maps
 * ProblemDetails, so shapes and status codes must stay identical.
 */
export interface ProblemDetails {
  type?: string;
  title: string;
  status: number;
  detail?: string | null;
  errors?: Record<string, string[]>;
  [key: string]: unknown;
}

const STATUS_TYPES: Record<number, string> = {
  400: 'https://tools.ietf.org/html/rfc9110#section-15.5.1',
  401: 'https://tools.ietf.org/html/rfc9110#section-15.5.2',
  403: 'https://tools.ietf.org/html/rfc9110#section-15.5.4',
  404: 'https://tools.ietf.org/html/rfc9110#section-15.5.5',
  409: 'https://tools.ietf.org/html/rfc9110#section-15.5.10',
  500: 'https://tools.ietf.org/html/rfc9110#section-15.6.1',
  503: 'https://tools.ietf.org/html/rfc9110#section-15.6.4',
};

const STATUS_TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  500: 'An error occurred while processing your request.',
  503: 'Service Unavailable',
};

export class ProblemDetailsException extends HttpException {
  constructor(readonly problem: ProblemDetails) {
    super(problem, problem.status);
  }
}

/** ControllerBase.Problem(statusCode, title, detail). */
export function problem(status: number, title?: string, detail?: string): ProblemDetailsException {
  return new ProblemDetailsException({
    type: STATUS_TYPES[status] ?? `https://httpstatuses.com/${status}`,
    title: title ?? STATUS_TITLES[status] ?? 'An error occurred.',
    status,
    ...(detail === undefined ? {} : { detail }),
  });
}

/** ControllerBase.ValidationProblem(ModelState) → 400 ValidationProblemDetails (with type + traceId). */
export function validationProblem(errors: Record<string, string[]>): ProblemDetailsException {
  return new ProblemDetailsException({
    type: STATUS_TYPES[400],
    title: 'One or more validation errors occurred.',
    status: 400,
    errors,
  });
}

/** Automatic model validation (InvalidModelStateResponseFactory): title, status and errors only. */
export function modelValidationProblem(errors: Record<string, string[]>): ProblemDetailsException {
  return new ProblemDetailsException({
    title: 'One or more validation errors occurred.',
    status: 400,
    errors,
  });
}

/** BadRequest(new { code, message }) and friends: any JSON body with a status. */
export class JsonResponseException extends HttpException {
  constructor(status: number, readonly body: unknown) {
    super(body as string | Record<string, unknown>, status);
  }
}

export function badRequest(body: unknown): JsonResponseException {
  return new JsonResponseException(HttpStatus.BAD_REQUEST, body);
}

/** Unauthorized() without a body is mapped by [ApiController] to a 401 ProblemDetails. */
export function unauthorized(body?: unknown): HttpException {
  return body === undefined ? problem(401) : new JsonResponseException(HttpStatus.UNAUTHORIZED, body);
}

/** Forbid() and failed [Authorize] policies: 403 with an empty body (JWT bearer handler). */
export function forbidden(): JsonResponseException {
  return new JsonResponseException(HttpStatus.FORBIDDEN, '');
}

/** NotFound() without a body is mapped by [ApiController] to a 404 ProblemDetails. */
export function notFound(body?: unknown): HttpException {
  return body === undefined ? problem(404) : new JsonResponseException(HttpStatus.NOT_FOUND, body);
}

export function conflict(body: unknown): JsonResponseException {
  return new JsonResponseException(HttpStatus.CONFLICT, body);
}

export function serviceUnavailable(body: unknown): JsonResponseException {
  return new JsonResponseException(HttpStatus.SERVICE_UNAVAILABLE, body);
}

export function tooManyRequests(body?: unknown): JsonResponseException {
  return new JsonResponseException(HttpStatus.TOO_MANY_REQUESTS, body ?? '');
}

/** Plain-string 400s such as BadRequest("Invalid range"). */
export function badRequestText(message: string): JsonResponseException {
  return new JsonResponseException(HttpStatus.BAD_REQUEST, message);
}
