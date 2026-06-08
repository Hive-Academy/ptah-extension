import { SdkError } from '../errors/sdk.error';

export class CuratorLlmQueryError extends SdkError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CuratorLlmQueryError';
  }
}
