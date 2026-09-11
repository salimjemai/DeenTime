import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { validationProblem } from './errors.js';

/**
 * Validates a request body with a zod schema and reports failures as ASP.NET
 * ValidationProblemDetails (errors keyed by the PascalCase property path).
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value ?? {});
    if (result.success) return result.data;
    const errors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = modelStateKey(issue.path);
      (errors[key] ??= []).push(issue.message);
    }
    throw validationProblem(errors);
  }
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

export const validated = <T>(schema: ZodType<T>) => new ZodValidationPipe(schema);
