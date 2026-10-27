import { Injectable, inject, type Signal } from '@angular/core';
import {
  ClaudeRpcService,
  LoggingService,
  VSCodeService,
} from '@ptah-extension/core';
import {
  WorkspaceListRecentResultSchema,
  type RecentWorkspace,
} from '@ptah-extension/shared';
import {
  VITALS_EMPTY,
  VITALS_RPC_TIMEOUT_MS,
  VitalsLoadCache,
  settleVitalsRpc,
  vitalsReady,
  type VitalsLoad,
  type VitalsRpcSource,
} from './vitals-load';

/**
 * The host's most-recently-used workspaces (`workspace:listRecent`), newest
 * first. Only the Electron host remembers workspaces: elsewhere the store is
 * `empty` and never calls the RPC. The answer is re-validated against the
 * shared schema; an invalid one is an `error`. No rows is `empty`.
 */
@Injectable({ providedIn: 'root' })
export class RecentWorkspacesStore {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly vscode = inject(VSCodeService);
  private readonly source: VitalsRpcSource = {
    logger: inject(LoggingService),
    context: 'RecentWorkspacesStore',
    label: 'Recent workspaces',
  };
  private readonly cache = new VitalsLoadCache<readonly RecentWorkspace[]>(
    () => this.fetch(),
  );

  /** `loading` until the first {@link load} settles; then the last good answer. */
  readonly recents: Signal<VitalsLoad<readonly RecentWorkspace[]>> =
    this.cache.value;

  /**
   * Rereads the list. Opening a folder changes it, so every visit to a screen
   * reloads instead of waiting out the cache age; a read in flight is joined.
   */
  load(): Promise<void> {
    return this.cache.refresh();
  }

  private async fetch(): Promise<VitalsLoad<readonly RecentWorkspace[]>> {
    if (!this.vscode.isElectron) return VITALS_EMPTY;
    return settleVitalsRpc(
      this.source,
      () =>
        this.rpc.call(
          'workspace:listRecent',
          {},
          { timeout: VITALS_RPC_TIMEOUT_MS },
        ),
      (data) => {
        const parsed = WorkspaceListRecentResultSchema.safeParse(data);
        if (!parsed.success) return null;
        const { workspaces } = parsed.data;
        return workspaces.length > 0 ? vitalsReady(workspaces) : VITALS_EMPTY;
      },
    );
  }
}
