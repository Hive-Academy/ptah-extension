/**
 * `SurfaceUpdateInbox` — the single eager intake for `surface:updated` pushes
 * (TASK_2026_494, plan D3 / Component 3).
 *
 * It is a GENERIC routing-id dispatcher, not an Apps-only one: any consumer
 * that owns a routing id (a `TabId.create()` correlation id) claims it here
 * and receives every push carrying that id. The Apps page's
 * `AppsSessionService` is the first consumer; TASK_2026_539's chat-tab
 * surfaces are the next. Both already depend on `chat-routing`, which is why
 * this lives here and not in a lazy lib (an Apps-lib inbox would cycle
 * `chat` → Apps lib → `chat`) and not in `@ptah-extension/core` (routing of
 * streaming surfaces is this lib's responsibility; the claim precedent is
 * `WorkflowSessionClaimService`).
 *
 * Zod-free on purpose: this service is in the initial bundle of every host,
 * so it must not pull in the contract validators. It therefore validates only
 * the ROUTING KEY and nothing else:
 *
 *   - the payload is not a non-null object: drop;
 *   - `routingId` is missing, not a string, or empty: drop;
 *   - the routing id is unclaimed: drop.
 *
 * A claimed id calls exactly its listener with the RAW payload. The listener
 * receives `unknown` — typing the value as `SurfaceUpdatedPayload` would
 * claim a check nobody made. Each consumer runs its own structural guard in
 * lazy code. Unclaimed pushes are deliberately NOT buffered: the claim runs
 * synchronously before `chat:start`, and a consumer that needs catch-up calls
 * `surface:read`, which returns the complete state.
 *
 * A throwing listener propagates to `MessageRouterService.dispatchGuarded`,
 * which reports it to `ErrorHandler` and continues the drain. A duplicate
 * `claim` throws synchronously — that is a programming error, because both
 * ids come from `TabId.create()`.
 */

import { Injectable } from '@angular/core';
import type { MessageHandler } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

/**
 * A consumer's callback for one `surface:updated` push. Receives the raw
 * payload as `unknown`; validating beyond the routing key is the consumer's
 * job (see the file header).
 */
export type SurfaceUpdateListener = (payload: unknown) => void;

@Injectable({ providedIn: 'root' })
export class SurfaceUpdateInbox implements MessageHandler {
  readonly handledMessageTypes = [MESSAGE_TYPES.SURFACE_UPDATED] as const;

  /**
   * Routing id → listener. A plain `Map`: nothing renders from the inbox, so
   * a signal would buy nothing, and there are no timers to clean up.
   */
  private readonly claims = new Map<string, SurfaceUpdateListener>();

  /**
   * Register `listener` as the sole receiver of pushes for `routingId`.
   * Throws synchronously when the id is already claimed.
   */
  claim(routingId: string, listener: SurfaceUpdateListener): void {
    if (this.claims.has(routingId)) {
      throw new Error(
        `SurfaceUpdateInbox: routing id is already claimed: ${routingId}`,
      );
    }
    this.claims.set(routingId, listener);
  }

  /** Remove the claim for `routingId`. A no-op when the id is unclaimed. */
  release(routingId: string): void {
    this.claims.delete(routingId);
  }

  isClaimed(routingId: string): boolean {
    return this.claims.has(routingId);
  }

  handleMessage(message: { type: string; payload?: unknown }): void {
    const payload = message.payload;
    if (typeof payload !== 'object' || payload === null) return;
    if (!('routingId' in payload)) return;
    const routingId = payload.routingId;
    if (typeof routingId !== 'string' || routingId.length === 0) return;
    this.claims.get(routingId)?.(payload);
  }
}
