import type { ZodType } from 'zod';
import type { Ctx } from './context.js';
import { JsonResponseException, modelValidationProblem, ProblemDetailsException } from './errors.js';

const BODY_LIMIT_BYTES = 1024 * 1024;

/**
 * Validates a value with a zod schema and reports failures as ASP.NET
 * ValidationProblemDetails: 400 { title, status, errors } keyed by the PascalCase
 * property path (the body backend-node's ZodValidationPipe produces).
 */
export function validate<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value ?? {});
  if (result.success) return result.data;
  const errors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = modelStateKey(issue.path);
    (errors[key] ??= []).push(issue.message);
  }
  throw modelValidationProblem(errors);
}

export function modelStateKey(path: ReadonlyArray<string | number | symbol>): string {
  if (path.length === 0) return '';
  return path
    .map((segment, index) => {
      if (typeof segment === 'number') return `[${segment}]`;
      const text = String(segment);
      const pascal = text.charAt(0).toUpperCase() + text.slice(1);
      return index === 0 ? pascal : `.${pascal}`;
    })
    .join('')
    .replace(/\.\[/g, '[');
}

/**
 * The request body as backend-node's body parsers deliver it:
 *  - application/json: the parsed document ({} when the body is empty). Malformed JSON,
 *    or a document that is not an object or array, is the 400 problem below;
 *  - application/x-www-form-urlencoded: an object of string values;
 *  - anything else: undefined.
 * Bodies over 1 MB are 413 with an empty body.
 */
export async function readBody(c: Ctx): Promise<unknown> {
  const contentType = (c.req.header('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  const isJson = contentType === 'application/json';
  if (!isJson && contentType !== 'application/x-www-form-urlencoded') return undefined;
  if (Number(c.req.header('Content-Length') ?? 0) > BODY_LIMIT_BYTES) throw new JsonResponseException(413, '');
  const buffer = await c.req.arrayBuffer();
  if (buffer.byteLength > BODY_LIMIT_BYTES) throw new JsonResponseException(413, '');
  const text = new TextDecoder().decode(buffer);
  if (!isJson) return Object.fromEntries(new URLSearchParams(text));
  if (text.length === 0) return {};
  try {
    const first = text.trimStart().charAt(0);
    if (first !== '{' && first !== '[') throw new SyntaxError(`Unexpected token '${first}', "${text.slice(0, 20)}" is not valid JSON`);
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ProblemDetailsException({
      type: 'https://tools.ietf.org/html/rfc9110#section-15.5.1',
      title: 'One or more validation errors occurred.',
      status: 400,
      errors: { '': [error instanceof Error ? error.message : String(error)] },
      // Present so renderError does not add one: backend-node sends this body without a traceId.
      traceId: undefined,
    });
  }
}

/** Reads the request body and validates it: `const input = await parseBody(c, loginSchema);`. */
export async function parseBody<T>(c: Ctx, schema: ZodType<T>): Promise<T> {
  return validate(schema, await readBody(c));
}
