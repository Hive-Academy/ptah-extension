/**
 * ModelNotAvailableError — thrown when the requested model is not in the
 * provider's available model list at pre-flight validation time.
 *
 * Raised by `SdkQueryOptionsBuilder.build()` after resolving the model ID
 * and checking it against `SdkModelService.getSupportedModels()` (cache-only;
 * never triggers a fresh fetch on the query hot path).
 *
 * Callers (RPC handlers, UI) should `instanceof`-check this to show a
 * targeted "model unavailable" message instead of a generic failure.
 */
import { SdkError } from './sdk.error';

export class ModelNotAvailableError extends SdkError {
  /** The provider-resolved model ID that was rejected. */
  readonly requestedModel: string;
  /** Available model IDs from the cached list (non-empty when set). */
  readonly availableModels: string[];

  constructor(
    requestedModel: string,
    availableModels: string[],
    options?: ErrorOptions,
  ) {
    const available =
      availableModels.length > 0
        ? ` Available: ${availableModels.slice(0, 10).join(', ')}${availableModels.length > 10 ? ' …' : ''}`
        : '';
    super(
      `Model '${requestedModel}' is not available for the configured provider.${available}`,
      options,
    );
    this.name = 'ModelNotAvailableError';
    this.requestedModel = requestedModel;
    this.availableModels = availableModels;
  }
}
