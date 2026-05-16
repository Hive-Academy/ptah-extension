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
 * (`available`, `downloading`, `downloaded`, `error`) can exit dismissed.
 */

import { Injectable, signal } from '@angular/core';
import { type MessageHandler } from '@ptah-extension/core';
import {
  MESSAGE_TYPES,
  type UpdateLifecycleState,
  type UpdateStatusChangedPayload,
} from '@ptah-extension/shared';

@Injectable({ providedIn: 'root' })
export class UpdateBannerService implements MessageHandler {
  readonly handledMessageTypes = [MESSAGE_TYPES.UPDATE_STATUS_CHANGED] as const;

  private readonly _state = signal<UpdateLifecycleState>({ state: 'idle' });
  readonly state = this._state.asReadonly();

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
      // Stay dismissed for non-actionable background states.
      if (payload.state === 'idle' || payload.state === 'checking') {
        return;
      }
      // Otherwise (available/downloading/downloaded/error) fall through and
      // exit dismissed.
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
