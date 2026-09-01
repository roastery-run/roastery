/**
 * Domain errors carrying an HTTP status.
 *
 * Handlers throw these instead of returning a Response, so the RPC helper's
 * signature stays `(input) => Promise<Output>` and the success type is not
 * polluted by a union of error shapes.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export class NotFound extends HttpError {
  constructor(message = "Not found") {
    super(404, message, "not_found");
  }
}

export class Conflict extends HttpError {
  constructor(message = "Conflict") {
    super(409, message, "conflict");
  }
}

export class BadRequest extends HttpError {
  constructor(message = "Invalid request") {
    super(400, message, "bad_request");
  }
}

export class Forbidden extends HttpError {
  constructor(message = "Forbidden") {
    super(403, message, "permission_denied");
  }
}

export function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError;
}
