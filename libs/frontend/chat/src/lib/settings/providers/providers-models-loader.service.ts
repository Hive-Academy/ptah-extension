import { Injectable, inject } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import type { ProviderModelsLoader } from '@ptah-extension/ui';
import type { ProviderListModelsResult } from '@ptah-extension/shared';

/** Page-scoped adapter for the shared picker's catalogue port. */
@Injectable()
export class ProvidersModelsLoader implements ProviderModelsLoader {
  private readonly rpc = inject(ClaudeRpcService);

  async listModels(providerId?: string): Promise<ProviderListModelsResult> {
    const result = await this.rpc.call('provider:listModels', { providerId });
    if (!result.isSuccess()) throw new Error('Could not load provider models. Retry.');
    return result.data;
  }
}
