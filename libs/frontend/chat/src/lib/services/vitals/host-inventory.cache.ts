import { Injectable, inject, type Signal } from '@angular/core';
import { ClaudeRpcService, LoggingService } from '@ptah-extension/core';
import {
  VITALS_RPC_TIMEOUT_MS,
  VitalsLoadCache,
  settleVitalsRpc,
  vitalsReady,
  type VitalsLoad,
} from './vitals-load';

/**
 * Host-wide counts for the welcome stats: installed skills
 * (`skillsSh:listInstalled`) and detected CLI agents (`agent:detectClis`,
 * D18). Neither depends on a workspace, so each is one cache entry.
 *
 * The CLI count has its own loader: `ProvidersSettingsStateService.cliDetection`
 * is filled only by `redetectClis()`, which also rereads orchestration, CLI
 * agents and CLI models, so it has no read that does not force that work.
 */
@Injectable({ providedIn: 'root' })
export class HostInventoryCache {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly logger = inject(LoggingService);
  private readonly skills = new VitalsLoadCache<number>(() =>
    settleVitalsRpc(
      { logger: this.logger, context: 'HostInventoryCache', label: 'Installed skills' },
      () =>
        this.rpc.call(
          'skillsSh:listInstalled',
          {},
          { timeout: VITALS_RPC_TIMEOUT_MS },
        ),
      (data) =>
        Array.isArray(data.skills) ? vitalsReady(data.skills.length) : null,
    ),
  );
  private readonly clis = new VitalsLoadCache<number>(() =>
    settleVitalsRpc(
      { logger: this.logger, context: 'HostInventoryCache', label: 'CLI detection' },
      () =>
        this.rpc.call('agent:detectClis', undefined, {
          timeout: VITALS_RPC_TIMEOUT_MS,
        }),
      (data) =>
        Array.isArray(data.clis)
          ? vitalsReady(
              data.clis.filter((cli) => cli.installed && cli.disabled !== true)
                .length,
            )
          : null,
    ),
  );

  /** Installed skills. See {@link VitalsLoadCache.read}: safe in an effect. */
  skillCount(): Signal<VitalsLoad<number>> {
    return this.skills.read();
  }

  /** Installed, enabled CLI agents. See {@link VitalsLoadCache.read}. */
  cliCount(): Signal<VitalsLoad<number>> {
    return this.clis.read();
  }
}
