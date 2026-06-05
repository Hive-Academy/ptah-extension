export class CuratorAuthError extends Error {
  readonly providerId: string;

  constructor(providerId: string, message: string) {
    super(message);
    this.name = 'CuratorAuthError';
    this.providerId = providerId;
    Object.setPrototypeOf(this, CuratorAuthError.prototype);
  }
}
