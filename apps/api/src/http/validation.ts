import type { z } from 'zod';
import { ValidationError } from '../core/errors.js';

/**
 * The trust boundary. Every request payload is parsed here before a service sees it, so
 * services can take their inputs as already-valid domain types.
 */
export function parse<Schema extends z.ZodType>(schema: Schema, data: unknown): z.infer<Schema> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const issue = result.error.issues[0];
  const path = issue?.path.join('.');
  throw new ValidationError(
    path ? `${path}: ${issue?.message}` : (issue?.message ?? 'Invalid request'),
    result.error.issues.map((problem) => ({ path: problem.path.join('.'), message: problem.message })),
  );
}
