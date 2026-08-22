import { ConflictError } from '../../core/errors.js';

/**
 * Postgres decides uniqueness, not a prior SELECT, so a duplicate can only be caught here — a
 * pre-check in a service always loses the race. Prisma's P2002 is translated into a domain error
 * inside this layer, which is the only place that may know Prisma exists.
 *
 * `labels` maps a colliding column to the message the caller should see.
 */
export async function onUniqueConflict<T>(
  labels: Record<string, string>,
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const columns = uniqueViolation(error);
    if (!columns) throw error;

    const named = columns.map((column) => labels[column]).find(Boolean);
    throw new ConflictError(named ?? 'That value is already in use');
  }
}

/**
 * The columns a P2002 names, or null when the error is something else entirely.
 *
 * Two shapes, because Prisma reports the violation differently depending on how it reached the
 * database: through the pg driver adapter the columns arrive under `driverAdapterError`, while
 * `meta.target` is the classic form. Two more wrinkles, both observed against Postgres: a
 * mixed-case column comes back quoted ("\"litellmModelName\"") because that is how the identifier
 * is spelled in SQL, and the violation is sometimes reported as an index name rather than a
 * column. Quotes are stripped and index names split, so either still matches a column label.
 */
function uniqueViolation(error: unknown): string[] | null {
  const candidate = error as
    | { code?: unknown; meta?: { target?: unknown; driverAdapterError?: { cause?: { constraint?: unknown } } } }
    | null;
  if (candidate?.code !== 'P2002') return null;

  const constraint = candidate.meta?.driverAdapterError?.cause?.constraint as
    | { fields?: unknown; index?: unknown }
    | undefined;

  const named = [candidate.meta?.target, constraint?.fields, constraint?.index]
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter(Boolean)
    .map(String);

  return named
    .map((entry) => entry.replaceAll('"', ''))
    .flatMap((entry) => [entry, ...entry.split('_')]);
}
