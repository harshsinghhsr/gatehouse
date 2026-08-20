/**
 * Domain errors. Services throw these; only the HTTP layer knows they map to status codes,
 * so business logic never imports anything from Fastify.
 */
export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;

  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  readonly status = 400;
  readonly code = 'invalid_request';
}

export class UnauthorizedError extends AppError {
  readonly status = 401;
  readonly code = 'unauthenticated';

  constructor(message = 'Authentication required') {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  readonly status = 403;
  readonly code = 'forbidden';
}

/**
 * Also used when a resource exists but belongs to another organization: telling a caller
 * "forbidden" would confirm the resource exists.
 */
export class NotFoundError extends AppError {
  readonly status = 404;
  readonly code = 'not_found';

  constructor(resource: string) {
    super(`${resource} not found`);
  }
}

/** A mutation arrived from an origin that is not the configured web client. */
export class CrossOriginError extends AppError {
  readonly status = 403;
  readonly code = 'cross_origin';

  constructor() {
    super('Cross-origin request rejected');
  }
}

export class ConflictError extends AppError {
  readonly status = 409;
  readonly code = 'conflict';
}

export class RateLimitError extends AppError {
  readonly status = 429;
  readonly code = 'rate_limited';
}

/** An upstream (provider or gateway) failed. Its response body never travels with this. */
export class UpstreamError extends AppError {
  readonly status = 502;
  readonly code: string;

  constructor(message: string, code = 'upstream_error') {
    super(message);
    this.code = code;
  }
}

export class UnavailableError extends AppError {
  readonly status = 503;
  readonly code = 'unavailable';
}
