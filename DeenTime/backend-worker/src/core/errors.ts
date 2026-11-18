/**
 * Response bodies matching backend-node (and the .NET API before it). The frontend reads
 * `error.error?.message ?? error.error?.title` and `api-error.ts` maps ProblemDetails,
 * so shapes and status codes must stay identical. Throw these from handlers; `renderError`
 * in ./http.ts turns them into responses.
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

/** Base class of every error that carries its own HTTP response. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message?: string,
  ) {
    super(message ?? `HTTP ${status}`);
  }

  getStatus(): number {
    return this.status;
  }
}

export class ProblemDetailsException extends HttpError {
  constructor(readonly problem: ProblemDetails) {
    super(problem.status, problem.title);
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

/**
 * BadRequest(new { code, message }) and friends: any body with a status. An object is sent
 * as JSON, a string as text/plain, and '' / null / undefined as an empty body.
 */
export class JsonResponseException extends HttpError {
  constructor(
    status: number,
    readonly body: unknown,
  ) {
    super(status);
  }
}

export function badRequest(body: unknown): JsonResponseException {
  return new JsonResponseException(400, body);
}

/** Unauthorized() without a body is a 401 ProblemDetails. */
export function unauthorized(body?: unknown): HttpError {
  return body === undefined ? problem(401) : new JsonResponseException(401, body);
}

/** Forbid() and failed authorization policies: 403 with an empty body. */
export function forbidden(): JsonResponseException {
  return new JsonResponseException(403, '');
}

/** NotFound() without a body is a 404 ProblemDetails. */
export function notFound(body?: unknown): HttpError {
  return body === undefined ? problem(404) : new JsonResponseException(404, body);
}

export function conflict(body: unknown): JsonResponseException {
  return new JsonResponseException(409, body);
}

export function serviceUnavailable(body: unknown): JsonResponseException {
  return new JsonResponseException(503, body);
}

export function tooManyRequests(body?: unknown): JsonResponseException {
  return new JsonResponseException(429, body ?? '');
}

/** Plain-string 400s such as BadRequest("Invalid range"). */
export function badRequestText(message: string): JsonResponseException {
  return new JsonResponseException(400, message);
}
