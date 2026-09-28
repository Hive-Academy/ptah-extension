import { Injectable, inject } from '@angular/core';
import {
  StreamRouter,
  StreamingSurfaceRegistry,
  SurfaceUpdateInbox,
  WorkflowSessionClaimService,
} from '@ptah-extension/chat-routing';
import {
  ConversationRegistry,
  TabSessionBinding,
  type ClaudeSessionId,
  type SurfaceId,
} from '@ptah-extension/chat-state';
import type { StreamingState } from '@ptah-extension/chat-types';
import { failureText } from './apps-session-rpc';
import type { AppsSurfaceSync } from './apps-surface-sync';
import type { AppsConversation } from './apps-workspace-slice';

const LOG_PREFIX = '[AppsConversationClaims]';

/** The streaming slot the interactive surface adapter reads and writes. */
export interface AppsStreamingSlot {
  read(): StreamingState;
  write(next: StreamingState): void;
}

/**
 * `AppsConversationClaims` — claims and releases the chat-routing resources
 * of ONE Apps conversation for `AppsSessionService` (implementation-plan.md
 * D3 :174-214). It holds no state of its own.
 *
 * Claim order is fixed by the plan: the `SurfaceUpdateInbox` claim FIRST, so
 * no push can arrive unclaimed, then the workflow claim, the interactive
 * streaming surface and its conversation binding. Release runs the reverse
 * set in order: the inbox claim, the workflow claim, the streaming surface
 * (`StreamRouter.onSurfaceClosed`, which unregisters the adapter) and the
 * conversation's `AppsSurfaceSync` (timers and the read in flight).
 */
@Injectable({ providedIn: 'root' })
export class AppsConversationClaims {
  private readonly inbox = inject(SurfaceUpdateInbox);
  private readonly workflowClaims = inject(WorkflowSessionClaimService);
  private readonly surfaceRegistry = inject(StreamingSurfaceRegistry);
  private readonly streamRouter = inject(StreamRouter);
  private readonly tabSessionBinding = inject(TabSessionBinding);
  private readonly conversationRegistry = inject(ConversationRegistry);

  /**
   * The head session of the conversation `surfaceId` is bound to, or null
   * until the host's session binding for that surface has arrived.
   */
  public sessionFor(surfaceId: SurfaceId): ClaudeSessionId | null {
    const convId = this.tabSessionBinding.conversationForSurface(surfaceId);
    if (!convId) return null;
    const record = this.conversationRegistry.getRecord(convId);
    if (!record || record.sessions.length === 0) return null;
    return record.sessions[record.sessions.length - 1];
  }

  /**
   * Claim everything `conversation` needs. A failing step undoes the partial
   * claim (so no half-started conversation stays held) and rethrows.
   */
  public claim(
    conversation: AppsConversation,
    sync: AppsSurfaceSync,
    streaming: AppsStreamingSlot,
  ): void {
    try {
      this.inbox.claim(conversation.routingId, (raw) => sync.onPush(raw));
      this.workflowClaims.claim(conversation.routingId, conversation.surfaceId);
      this.surfaceRegistry.register(
        conversation.surfaceId,
        () => streaming.read(),
        (next) => streaming.write(next),
        { interactive: true },
      );
      this.streamRouter.onSurfaceCreated(conversation.surfaceId);
    } catch (error: unknown) {
      this.release(conversation, sync);
      throw error;
    }
  }

  /** Release everything `claim` took. Idempotent; never throws. */
  public release(
    conversation: AppsConversation,
    sync: AppsSurfaceSync | null,
  ): void {
    const steps: readonly (() => void)[] = [
      () => this.inbox.release(conversation.routingId),
      () => this.workflowClaims.release(conversation.routingId),
      () => this.streamRouter.onSurfaceClosed(conversation.surfaceId),
      () => sync?.dispose(),
    ];
    for (const step of steps) {
      try {
        step();
      } catch (error: unknown) {
        // One failing release must not keep the others from running.
        console.warn(
          `${LOG_PREFIX} release step failed: ${failureText(error, 'unknown error')}`,
        );
      }
    }
  }
}
