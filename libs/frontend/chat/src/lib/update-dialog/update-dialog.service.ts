/**
 * UpdateDialogService
 *
 * Tracks the Electron update lifecycle state for the in-app update dialog.
 *
 * Implements the `MessageHandler` contract: receives `update:statusChanged`
 * push events from the Electron main process via the
 * `MessageRouterService` → `MESSAGE_HANDLERS` multi-provider pipeline, and
 * exposes the current `UpdateLifecycleState` as a readonly signal that the
 * dialog component subscribes to.
 *
 * Dismissed-state suppression (critical UX):
 * When the user clicks "Later", the service transitions to
 * `{ state: 'dismissed' }`. Background re-checks emit `idle`, `checking` and
 * `error` states which MUST NOT re-open the dialog. Only `available` — the one
 * state the user can act on — exits dismissed.
 *
 * "Later" is deliberately a SESSION-LOCAL snooze, not an acknowledgement: the
 * next check still broadcasts `available`, so the prompt returns and an update
 * cannot be lost to a single stray click. "Download" is the acknowledgement.
 * It records the version in the main process (`update:mark-downloaded`), which
 * suppresses that one version for good — across restarts — while a later
 * release prompts again.
 */

import { Injectable, inject, signal } from '@angular/core';
import {
  ClaudeRpcService,
  VSCodeService,
  type MessageHandler,
} from '@ptah-extension/core';
import {
  MESSAGE_TYPES,
  type UpdateLifecycleState,
  type UpdateStatusChangedPayload,
} from '@ptah-extension/shared';

@Injectable({ providedIn: 'root' })
export class UpdateDialogService implements MessageHandler {
  readonly handledMessageTypes = [MESSAGE_TYPES.UPDATE_STATUS_CHANGED] as const;

  private readonly rpcService = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);

  private readonly _state = signal<UpdateLifecycleState>({ state: 'idle' });
  readonly state = this._state.asReadonly();

  constructor() {
    void this.hydrateFromBackend();
  }

  /**
   * Pull the current update state once at startup.
   *
   * Update lifecycle events are pushed via fire-and-forget `webContents.send`
   * during the Electron post-window phase — before the renderer's
   * `MessageRouterService` has subscribed to `window` message events. Any event
   * that fires in that gap is lost. This RPC recovers whatever state the main
   * process already reached, closing the startup race. Electron-only; the
   * `update:*` namespace is not registered in the VS Code host.
   */
  private async hydrateFromBackend(): Promise<void> {
    if (!this.vscodeService.isElectron) {
      return;
    }
    try {
      const result = await this.rpcService.call('update:get-state', {});
      if (result.isSuccess() && this._state().state === 'idle') {
        this._state.set(result.data.state);
      }
    } catch {
      // Non-fatal: push events still drive the dialog once subscribed.
    }
  }

  /**
   * Process an inbound `update:statusChanged` push event.
   *
   * Dismissed suppression: once dismissed, only an `available` state re-opens
   * the dialog.
   */
  handleMessage(message: { type: string; payload?: unknown }): void {
    const payload = message.payload as UpdateStatusChangedPayload | undefined;
    if (!payload || typeof payload !== 'object' || !('state' in payload)) {
      return;
    }

    if (this._state().state === 'dismissed' && payload.state !== 'available') {
      return;
    }

    this._state.set(payload);
  }

  /**
   * User clicked "Later" — close the dialog. The next check re-opens it.
   */
  dismiss(): void {
    this._state.set({ state: 'dismissed' });
  }

  /**
   * User clicked "Download" — record the version so no later check prompts for
   * it again, and close the dialog.
   *
   * The anchor's navigation is not blocked: this runs alongside the browser
   * opening the installer URL. A failed RPC only costs a repeat prompt on the
   * next check, so it is swallowed rather than surfaced.
   */
  async markDownloaded(version: string): Promise<void> {
    this.dismiss();
    try {
      await this.rpcService.call('update:mark-downloaded', { version });
    } catch {
      // Non-fatal: the worst case is one more prompt on the next check.
    }
  }
}
