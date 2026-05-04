import { Injectable, inject } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  CronCreateParams,
  CronCreateResult,
  CronDeleteParams,
  CronDeleteResult,
  CronGetParams,
  CronGetResult,
  CronListParams,
  CronListResult,
  CronNextFireParams,
  CronNextFireResult,
  CronRunNowParams,
  CronRunNowResult,
  CronRunsParams,
  CronRunsResult,
  CronToggleParams,
  CronToggleResult,
  CronUpdateParams,
  CronUpdateResult,
} from '@ptah-extension/shared';

/**
 * Per-method RPC timeout budget (ms) for cron handlers. List/get/runs/nextFire
 * are quick reads. Create/update/toggle/delete touch the persistence layer +
 * croner re-arm. runNow can take longer since the SDK may be invoked.
 */
const CRON_RPC_TIMEOUTS = {
  LIST_MS: 5_000,
  GET_MS: 5_000,
  CREATE_MS: 10_000,
  UPDATE_MS: 10_000,
  DELETE_MS: 5_000,
  TOGGLE_MS: 5_000,
  RUN_NOW_MS: 30_000,
  RUNS_MS: 5_000,
  NEXT_FIRE_MS: 5_000,
} as const;

/**
 * CronRpcService — thin facade over `ClaudeRpcService` for the nine cron
 * handlers exposed by `CronRpcHandlers` (cron-scheduler is Electron-only;
 * VS Code dispatcher returns "not-available" errors which propagate as
 * thrown errors here).
 */
@Injectable({ providedIn: 'root' })
export class CronRpcService {
  private readonly rpc = inject(ClaudeRpcService);

  public async list(params: CronListParams = {}): Promise<CronListResult> {
    const result = await this.rpc.call('cron:list', params, {
      timeout: CRON_RPC_TIMEOUTS.LIST_MS,
    });
    if (result.isSuccess()) return result.data;
    throw new Error(result.error || 'cron:list failed');
  }

  public async get(params: CronGetParams): Promise<CronGetResult> {
    const result = await this.rpc.call('cron:get', params, {
      timeout: CRON_RPC_TIMEOUTS.GET_MS,
    });
    if (result.isSuccess()) return result.data;
    throw new Error(result.error || 'cron:get failed');
  }

  public async create(params: CronCreateParams): Promise<CronCreateResult> {
    const result = await this.rpc.call('cron:create', params, {
      timeout: CRON_RPC_TIMEOUTS.CREATE_MS,
    });
    if (result.isSuccess()) return result.data;
    throw new Error(result.error || 'cron:create failed');
  }

  public async update(params: CronUpdateParams): Promise<CronUpdateResult> {
    const result = await this.rpc.call('cron:update', params, {
      timeout: CRON_RPC_TIMEOUTS.UPDATE_MS,
    });
    if (result.isSuccess()) return result.data;
    throw new Error(result.error || 'cron:update failed');
  }

  public async delete(params: CronDeleteParams): Promise<CronDeleteResult> {
    const result = await this.rpc.call('cron:delete', params, {
      timeout: CRON_RPC_TIMEOUTS.DELETE_MS,
    });
    if (result.isSuccess()) return result.data;
    throw new Error(result.error || 'cron:delete failed');
  }

  public async toggle(params: CronToggleParams): Promise<CronToggleResult> {
    const result = await this.rpc.call('cron:toggle', params, {
      timeout: CRON_RPC_TIMEOUTS.TOGGLE_MS,
    });
    if (result.isSuccess()) return result.data;
    throw new Error(result.error || 'cron:toggle failed');
  }

  public async runNow(params: CronRunNowParams): Promise<CronRunNowResult> {
    const result = await this.rpc.call('cron:runNow', params, {
      timeout: CRON_RPC_TIMEOUTS.RUN_NOW_MS,
    });
    if (result.isSuccess()) return result.data;
    throw new Error(result.error || 'cron:runNow failed');
  }

  public async runs(params: CronRunsParams): Promise<CronRunsResult> {
    const result = await this.rpc.call('cron:runs', params, {
      timeout: CRON_RPC_TIMEOUTS.RUNS_MS,
    });
    if (result.isSuccess()) return result.data;
    throw new Error(result.error || 'cron:runs failed');
  }

  public async nextFire(
    params: CronNextFireParams,
  ): Promise<CronNextFireResult> {
    const result = await this.rpc.call('cron:nextFire', params, {
      timeout: CRON_RPC_TIMEOUTS.NEXT_FIRE_MS,
    });
    if (result.isSuccess()) return result.data;
    throw new Error(result.error || 'cron:nextFire failed');
  }
}
