/** Thrown when a Smithery operation needs an API key but none is configured. */
export class SmitheryKeyMissingError extends Error {
  constructor(message = 'Smithery API key is not configured') {
    super(message);
    this.name = 'SmitheryKeyMissingError';
  }
}

/** Thrown when collected config fails validation against a connection schema. */
export class SmitheryConfigInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmitheryConfigInvalidError';
  }
}

/**
 * Thrown when the Smithery Platform API answers a non-2xx status.
 *
 * `status` is the HTTP status so callers can branch (404 = absent, 401 = the
 * key was revoked) without matching on the message, which is user-facing copy.
 */
export class SmitheryApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SmitheryApiError';
  }
}
