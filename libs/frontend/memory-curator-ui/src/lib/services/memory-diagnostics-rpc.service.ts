import { Injectable, inject } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  MemoryDiagnosticsResult,
  MemoryGetTriggersResult,
  MemoryRunNowParams,
  MemoryRunNowResult,
  MemorySetTriggersParams,
  MemorySetTriggersResult,
  ProviderListModelsResult,
} from '@ptah-extension/shared';

const DIAGNOSTICS_RPC_TIMEOUTS = {
  READ_MS: 10_000,
  RUN_MS: 120_000,
  WRITE_MS: 8_000,
} as const;

/**
 * The host refused a manual run because the Memory switch is paused
 * (`RpcUserErrorCode` `'PAUSED'`). Thrown as its own type so callers can show a
 * paused notice instead of a failure.
 */
export class MemoryPausedError extends Error {
  public constructor(message = 'Memory is paused') {
    super(message);
    this.name = 'MemoryPausedError';
  }
}

@Injectable({ providedIn: 'root' })
export class MemoryDiagnosticsRpcService {
  private readonly rpc = inject(ClaudeRpcService);

  public async diagnostics(
    workspaceRoot?: string | null,
    eventLimit?: number,
  ): Promise<MemoryDiagnosticsResult> {
    const result = await this.rpc.call(
      'memory:diagnostics',
      {
        workspaceRoot: workspaceRoot ?? null,
        ...(eventLimit !== undefined ? { eventLimit } : {}),
      },
      { timeout: DIAGNOSTICS_RPC_TIMEOUTS.READ_MS },
    );

    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'memory:diagnostics failed');
  }

  public async runNow(params: MemoryRunNowParams): Promise<MemoryRunNowResult> {
    const result = await this.rpc.call('memory:runNow', params, {
      timeout: DIAGNOSTICS_RPC_TIMEOUTS.RUN_MS,
    });

    if (result.isSuccess() && result.data) {
      return result.data;
    }
    if (result.errorCode === 'PAUSED') {
      throw new MemoryPausedError(result.error || undefined);
    }
    throw new Error(result.error || 'memory:runNow failed');
  }

  public async setTriggers(
    params: MemorySetTriggersParams,
  ): Promise<MemorySetTriggersResult> {
    const result = await this.rpc.call('memory:setTriggers', params, {
      timeout: DIAGNOSTICS_RPC_TIMEOUTS.WRITE_MS,
    });

    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'memory:setTriggers failed');
  }

  public async getTriggers(): Promise<MemoryGetTriggersResult> {
    const result = await this.rpc.call(
      'memory:getTriggers',
      {},
      { timeout: DIAGNOSTICS_RPC_TIMEOUTS.READ_MS },
    );

    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'memory:getTriggers failed');
  }

  public async listModels(
    providerId?: string,
  ): Promise<ProviderListModelsResult> {
    const result = await this.rpc.call(
      'provider:listModels',
      {
        toolUseOnly: false,
        ...(providerId ? { providerId } : {}),
      },
      { timeout: DIAGNOSTICS_RPC_TIMEOUTS.READ_MS },
    );

    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'provider:listModels failed');
  }
}
