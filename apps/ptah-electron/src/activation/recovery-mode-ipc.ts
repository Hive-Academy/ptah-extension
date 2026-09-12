import { ipcMain } from 'electron';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

/**
 * The renderer channels that MUST have a main-process listener once a window
 * exists, whatever else has failed.
 *
 * `get-state` is the dangerous one: `preload.ts:28` exposes it as
 * `ipcRenderer.sendSync('get-state')`, and Electron never replies to a sync
 * channel with no listener — the renderer blocks inside the call forever. That
 * is the same wedge `startup-config-ipc.ts` was created to close for
 * `get-startup-config` (TASK_2026_411). `rpc` and `set-state` are async and
 * merely silent, which is worse in a different way: every caller waits out its
 * own timeout and learns nothing about why.
 */
export const RECOVERY_MODE_CHANNELS = ['rpc', 'get-state', 'set-state'] as const;

/**
 * The one place these three channels are served when the app could NOT boot.
 *
 * ### Why this has to exist
 *
 * `bootstrap.ts` awaits `WORKSPACE_STATE_STORAGE.whenReady()` (line ~306)
 * BEFORE it constructs the `IpcBridge` (line ~318) that registers `rpc`,
 * `get-state` and `set-state`. That ordering is deliberate and pinned by
 * `state-storage-readiness-gate.spec.ts` — no RPC may be served against a store
 * that has not finished migrating. But it means a storage failure throws PAST
 * the registration: `main.ts` catches, paints the recovery shell and `return`s,
 * and the app is left with a window whose three renderer channels have no
 * listener at all.
 *
 * So the recovery screen was not a recovery screen. It was a window that hung
 * the first time anything asked it for state, and answered nothing at all to
 * every RPC — a 10 s timeout per call with no error text, which is exactly how
 * this reads from a test harness or a user bug report.
 *
 * ### What it deliberately does NOT do
 *
 * It serves no data and performs no work. `get-state` answers an empty object
 * because there IS no readable store; `set-state` drops the write rather than
 * persisting into a store under recovery; `rpc` answers a structured failure so
 * the caller fails immediately with a reason instead of timing out. This is the
 * error path of a state the app already renders, not a degraded second
 * implementation of the bridge.
 *
 * @param reason The recovery code already computed for the shell query — one of
 *   our own `StateStorageRecoveryReason` values or `'startup-failed'`. It is a
 *   closed vocabulary we author, never a raw error message, so it is safe to
 *   hand across the process boundary.
 */
export function registerRecoveryModeIpc(reason: string): void {
  // Claim ONLY unserved channels. A failure raised after `IpcBridge.initialize()`
  // succeeded (the WEBVIEW_MANAGER and session-notifier throws further down
  // `bootstrapElectron`) leaves a working bridge in place, and replacing it with
  // this stub would turn a partial boot into a total one.
  for (const channel of RECOVERY_MODE_CHANNELS) {
    if (ipcMain.listenerCount(channel) > 0) continue;
    if (channel === 'get-state') {
      ipcMain.on('get-state', (event: Electron.IpcMainEvent) => {
        // Assigned unconditionally: an unset `returnValue` is the block itself.
        event.returnValue = {};
      });
      continue;
    }
    if (channel === 'set-state') {
      ipcMain.on('set-state', () => undefined);
      continue;
    }
    ipcMain.on('rpc', (event: Electron.IpcMainEvent, message: unknown) => {
      answerRpcInRecoveryMode(event, message, reason);
    });
  }
}

/**
 * Answer one `rpc` envelope with the failure the caller is entitled to.
 *
 * A message with no correlation id is fire-and-forget (`ipc-bridge.ts` routes
 * those by `type`); there is nothing to answer and nothing to log about it.
 */
export function answerRpcInRecoveryMode(
  event: Pick<Electron.IpcMainEvent, 'sender'>,
  message: unknown,
  reason: string,
): void {
  const correlationId = correlationIdOf(message);
  if (!correlationId) return;
  const sender = event.sender as
    | { send?: (channel: string, payload: unknown) => void; isDestroyed?: () => boolean }
    | undefined;
  if (!sender?.send) return;
  if (sender.isDestroyed?.() === true) return;
  sender.send('to-renderer', {
    type: MESSAGE_TYPES.RPC_RESPONSE,
    correlationId,
    success: false,
    error: `Ptah is in recovery mode and cannot serve requests (${reason}).`,
    errorCode: 'state-storage-recovery-required',
  });
}

/** The correlation id an `rpc:call` envelope carries, in either accepted shape. */
function correlationIdOf(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const envelope = message as Record<string, unknown>;
  const body = (envelope['payload'] ?? envelope) as Record<string, unknown>;
  const correlationId = body['correlationId'] ?? body['requestId'];
  return typeof correlationId === 'string' && correlationId.length > 0
    ? correlationId
    : null;
}
