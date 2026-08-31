/**
 * TurnStateApplier — the ONE consumer of the backend `turn_state` stream event
 * (TASK_2026_360).
 *
 * The backend derives a per-session turn phase (`generating |
 * awaiting-background | sleeping | idle | failed`) and emits it IN the chunk
 * stream, so it can neither overtake nor trail the deltas it describes. This
 * service turns that event into every frontend "is the agent busy" signal:
 *
 *   1. finalization of the in-flight assistant message (terminal phases only —
 *      the event is ordered after the last chunk, so the tree is complete),
 *   2. the tab's `status` / spinner / Stop-hook snapshot via
 *      `TabManagerService.applyTurnState`,
 *   3. the workspace sidebar dot via `SessionLivenessRegistry`.
 *
 * Nothing else writes those signals from stream, turn-end or stats events any
 * more. The only sibling writer is the optimistic `markStreaming` +
 * `markTabStreaming` on send, which the next `generating` event confirms.
 *
 * Every resolved tab passes ONE acceptance check
 * (`TabManagerService.canApplyTurnState`: session ownership + session-scoped
 * revision) BEFORE any side effect. A stale broadcaster that captured a tab id
 * the tab has since re-used, or a delayed `session:status` probe carrying an
 * older revision, is dropped without finalizing, idling or re-lighting
 * anything (review F1). Sessions that resolve no tab (surface-owned) get the
 * same revision guard from a small per-session map here.
 */

import { Injectable, inject } from '@angular/core';
import {
  SessionId,
  UNKNOWN_AGENT_TOOL_CALL_ID,
  type SessionTurnPhase,
  type TurnStateEvent,
} from '@ptah-extension/shared';
import {
  SessionLivenessRegistry,
  TabManagerService,
} from '@ptah-extension/chat-state';
import type { TabState } from '@ptah-extension/chat-types';
import { MessageFinalizationService } from './message-finalization.service';
import { PermissionHandlerService } from './permission-handler.service';

const TERMINAL_PHASES: ReadonlySet<SessionTurnPhase> = new Set([
  'awaiting-background',
  'sleeping',
  'idle',
  'failed',
]);

interface ResolvedTab {
  readonly tab: TabState;
  /** The workspace that owns the tab; `undefined` only when unknown. */
  readonly workspacePath: string | undefined;
}

/** Upper bound for the surface-session revision map (oldest entry evicted). */
const SURFACE_REVISION_MAP_LIMIT = 256;

@Injectable({ providedIn: 'root' })
export class TurnStateApplier {
  private readonly tabManager = inject(TabManagerService);
  private readonly finalization = inject(MessageFinalizationService);
  private readonly liveness = inject(SessionLivenessRegistry);
  private readonly permissionHandler = inject(PermissionHandlerService);
  /**
   * Last accepted revision per session for events that resolve no tab. Keyed
   * by session id; bounded by `SURFACE_REVISION_MAP_LIMIT`.
   */
  private readonly surfaceRevisions = new Map<string, number>();

  /**
   * Apply one `turn_state` event.
   *
   * @param event - The event, straight off the chunk stream or synthesized
   *   from `session:status` by the reconciler.
   * @param tabId - Direct routing hint from the chunk payload (preferred).
   */
  apply(event: TurnStateEvent, tabId?: string): void {
    const resolved = this.resolveTabs(event, tabId);
    const targets = resolved.filter(({ tab }) => {
      const accepted = this.tabManager.canApplyTurnState(
        tab.id,
        event.sessionId,
        event.revision,
      );
      if (!accepted) {
        console.debug('[TurnStateApplier] dropped stale/foreign turn_state', {
          tabId: tab.id,
          tabSessionId: tab.claudeSessionId,
          eventSessionId: event.sessionId,
          phase: event.phase,
          revision: event.revision,
          lastRevision: tab.lastTurnStateRevision,
        });
      }
      return accepted;
    });

    if (TERMINAL_PHASES.has(event.phase)) {
      // Finalize FIRST: `applyFinalizedTurn` flips `loaded` only while the tab
      // is still `streaming`, so the backend phase written next is what the
      // tab keeps.
      const isAborted =
        event.phase === 'failed' ||
        (event.terminalReason !== null && event.terminalReason !== 'completed');
      // Hard-deny ids are bucketed per session; a bucket is drained once per
      // event even when the session fans out to several tabs.
      const consumed = new Map<string, ReadonlySet<string>>();
      for (const { tab } of targets) {
        this.finalization.finalizeCurrentMessage(tab.id, isAborted);
        const bucket = event.sessionId ?? tab.claudeSessionId ?? tab.id;
        let ids = consumed.get(bucket);
        if (!ids) {
          ids = this.permissionHandler.consumeHardDenyToolUseIds(bucket);
          consumed.set(bucket, ids);
        }
        this.markHardDeniedAgents(tab.id, ids);
      }
    }

    for (const { tab } of targets) {
      this.tabManager.applyTurnState(tab.id, event, event.sessionId);
    }

    if (!event.sessionId) return;

    if (targets.length > 0) {
      const workspacePath = targets.find(
        (t) => t.workspacePath !== undefined,
      )?.workspacePath;
      this.markLiveness(event.sessionId, event.phase, workspacePath);
      return;
    }

    // A tab that resolved for THIS session but rejected the revision is the
    // authority for it — a stale replay must not flip the sidebar dot either.
    const rejectedOwnTab = resolved.some(
      ({ tab }) => tab.claudeSessionId === event.sessionId,
    );
    if (rejectedOwnTab) return;

    // Surface-owned sessions (harness builder, wizard, tribunal conductor)
    // resolve no tab and are still live sessions — the sidebar dot must follow
    // them too. The same is true for a session whose tab now belongs to a
    // replacement session: the write is for the OLD session id only and never
    // touches the tab. Both get the per-session revision guard.
    if (!this.acceptSurfaceRevision(event.sessionId, event.revision)) {
      console.debug('[TurnStateApplier] dropped stale surface turn_state', {
        sessionId: event.sessionId,
        phase: event.phase,
        revision: event.revision,
      });
      return;
    }
    this.markLiveness(event.sessionId, event.phase, undefined);
  }

  /** Revision guard for sessions without an accepted tab (see `apply`). */
  private acceptSurfaceRevision(sessionId: string, revision: number): boolean {
    const last = this.surfaceRevisions.get(sessionId);
    if (last !== undefined && revision <= last) return false;
    if (
      last === undefined &&
      this.surfaceRevisions.size >= SURFACE_REVISION_MAP_LIMIT
    ) {
      const oldest = this.surfaceRevisions.keys().next().value;
      if (oldest !== undefined) this.surfaceRevisions.delete(oldest);
    }
    this.surfaceRevisions.set(sessionId, revision);
    return true;
  }

  /**
   * Same resolution order `StreamingHandlerService.processStreamEvent` uses:
   * the routed tab id first, then every active-workspace tab bound to the
   * session (canvas fan-out), then the background-partition owner.
   */
  private resolveTabs(event: TurnStateEvent, tabId?: string): ResolvedTab[] {
    if (tabId) {
      const byId = this.tabManager.findTabByIdAcrossWorkspaces(tabId);
      if (byId) {
        return [{ tab: byId.tab, workspacePath: byId.workspacePath }];
      }
    }
    // `SessionId.from` throws on a non-UUID and the event can carry no session
    // at all while the SDK session is still resolving — never `from` here.
    const session = SessionId.safeParse(event.sessionId);
    if (!session) return [];

    const bound = this.tabManager.findTabsBySessionId(session);
    if (bound.length > 0) {
      return bound.map((tab) => ({
        tab,
        workspacePath: this.tabManager.findTabByIdAcrossWorkspaces(tab.id)
          ?.workspacePath,
      }));
    }
    const lookup = this.tabManager.findTabBySessionIdAcrossWorkspaces(session);
    return lookup
      ? [{ tab: lookup.tab, workspacePath: lookup.workspacePath }]
      : [];
  }

  /**
   * Agents the user hard-denied mid-turn end as `interrupted`, not `complete`.
   * The session's bucket is drained once per terminal event (see `apply`).
   */
  private markHardDeniedAgents(
    tabId: string,
    hardDenyToolUseIds: ReadonlySet<string>,
  ): void {
    if (hardDenyToolUseIds.size === 0) return;
    if (hardDenyToolUseIds.has(UNKNOWN_AGENT_TOOL_CALL_ID)) {
      this.finalization.markLastAgentAsInterrupted(tabId);
    }
    const specificIds = new Set(
      [...hardDenyToolUseIds].filter((id) => id !== UNKNOWN_AGENT_TOOL_CALL_ID),
    );
    if (specificIds.size > 0) {
      this.finalization.markAgentsAsInterruptedByToolCallIds(
        tabId,
        specificIds,
      );
    }
  }

  private markLiveness(
    sessionId: string,
    phase: SessionTurnPhase,
    workspacePath: string | undefined,
  ): void {
    switch (phase) {
      case 'generating':
        this.liveness.markStreaming(sessionId, workspacePath);
        return;
      case 'awaiting-background':
      case 'sleeping':
        // A sleeping session is live: it will wake itself.
        this.liveness.markAwaitingBackground(sessionId, workspacePath);
        return;
      case 'idle':
        this.liveness.markIdle(sessionId, workspacePath);
        return;
      case 'failed':
        this.liveness.markFailed(sessionId, workspacePath);
        return;
    }
  }
}
