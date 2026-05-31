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
