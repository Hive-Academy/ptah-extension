import type { ProvidersEditContext, ProvidersSettingsCommit, ProvidersSettingsStateService } from '@ptah-extension/core';

/**
 * The outcome of one drawer write, shown only by the tab that started it. The runner publishes
 * `saving` first and copies `state.commit()` only after THAT write resolved, so an earlier save never
 * shows as this write's result (D15).
 */
export interface DrawerWriteOutcome {
  readonly status: ProvidersSettingsCommit['status'];
  readonly message: string | null;
}

export const DRAWER_WRITE_REFUSED = 'Another save is in progress. Retry when it finishes.';
export const DRAWER_WRITE_NO_CONTEXT = 'Settings are still loading. Retry in a moment.';
export const DRAWER_WRITE_BROKEN = 'The save could not be completed. Retry.';

/**
 * Runs one state-service write for a drawer tab.
 * - No edit context yet: `blocked`, nothing written.
 * - `write` resolves `false`: refused because another save runs.
 * - `write` rejects: `blocked` with a fixed message, never left at `saving`.
 */
export async function runDrawerWrite(
  state: Pick<ProvidersSettingsStateService, 'reviewContext' | 'commit'>,
  write: (context: ProvidersEditContext) => Promise<boolean>,
  publish: (outcome: DrawerWriteOutcome) => void,
): Promise<void> {
  const context = state.reviewContext();
  if (!context) {
    publish({ status: 'blocked', message: DRAWER_WRITE_NO_CONTEXT });
    return;
  }
  publish({ status: 'saving', message: null });
  let started: boolean;
  try {
    started = await write(context);
  } catch {
    // degradation-audit: reported - publishes the fixed DRAWER_WRITE_BROKEN alert to the drawer.
    // State commands settle their own failures into `commit()`; a throw means the command itself broke.
    publish({ status: 'blocked', message: DRAWER_WRITE_BROKEN });
    return;
  }
  const commit = state.commit();
  publish(started ? { status: commit.status, message: commit.message } : { status: 'blocked', message: DRAWER_WRITE_REFUSED });
}
