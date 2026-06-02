/**
 * UpdateBannerService
 *
 * Tracks the Electron auto-update lifecycle state for the in-app banner UX.
 *
 * Implements the `MessageHandler` contract: receives `update:statusChanged`
 * push events from the Electron main process via the
 * `MessageRouterService` → `MESSAGE_HANDLERS` multi-provider pipeline, and
 * exposes the current `UpdateLifecycleState` as a readonly signal that the
 * banner component subscribes to.
 *
 * Dismissed-state suppression (critical UX):
 * When the user clicks "Later", the service transitions to
 * `{ state: 'dismissed' }`. Background re-checks emit `idle` and `checking`
 * states which MUST NOT re-show the banner. Only the actionable states
 * (`available`, `error`) can exit dismissed.
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
export class UpdateBannerService implements MessageHandler {
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
      // Non-fatal: push events still drive the banner once subscribed.
    }
  }

  /**
   * Process an inbound `update:statusChanged` push event.
   *
   * Dismissed suppression: once dismissed, do not re-show on background
   * idle/checking events. Only actionable states exit dismissed.
   */
  handleMessage(message: { type: string; payload?: unknown }): void {
    const payload = message.payload as UpdateStatusChangedPayload | undefined;
    if (!payload || typeof payload !== 'object' || !('state' in payload)) {
      return;
    }

    const current = this._state();
    if (current.state === 'dismissed') {
      if (payload.state === 'idle' || payload.state === 'checking') {
        return;
      }
    }

    this._state.set(payload);
  }

  /**
   * User clicked "Later" — hide the banner until the next actionable state
   * arrives.
   */
  dismiss(): void {
    this._state.set({ state: 'dismissed' });
  }
}
