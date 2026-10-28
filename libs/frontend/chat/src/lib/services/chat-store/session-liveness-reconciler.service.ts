import { Injectable, inject, effect, untracked } from '@angular/core';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import {
  TabManagerService,
  SessionLivenessRegistry,
} from '@ptah-extension/chat-state';
import {
  AgentMonitorStore,
  TurnStateApplier,
} from '@ptah-extension/chat-streaming';
import type { SessionTurnState, TurnStateEvent } from '@ptah-extension/shared';

/**
 * Re-learns the real turn state of every restored tab from `session:status`.
 *
 * A restored tab has every in-flight status coerced to `loaded`
 * (`sanitizeRestoredTab`), and the backend's `turn_state` stream event only
 * reaches tabs whose stream is running. On boot and after a workspace switch
 * the backend is therefore asked directly; its answer is applied through the
 * SAME `TurnStateApplier` the stream uses, so a live-but-idle session shows no
 * stop button and a turn that ran on while the workspace was backgrounded
 * shows `streaming` / `sleeping` again (TASK_2026_360, Defect 4).
 *
 * `isStreaming` is deliberately not read: it is true for the whole life of a
 * streaming-input SDK session ("loop attached"), not "generates now".
 */
@Injectable({ providedIn: 'root' })
export class SessionLivenessReconcilerService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly tabManager = inject(TabManagerService);
  private readonly liveness = inject(SessionLivenessRegistry);
  private readonly turnStateApplier = inject(TurnStateApplier);

  private readonly agentMonitor = inject(AgentMonitorStore);

  constructor() {
    effect(() => {
      const candidates = this.agentMonitor.pendingHistoryCandidates();
      const tabs = this.tabManager.tabs();
      untracked(() => {
        for (const { sessionId, generation } of candidates) {
          if (this.probedGenerations.get(sessionId) === generation) continue;
          const tab = tabs.find((item) => item.claudeSessionId === sessionId);
          if (!tab) continue;
          this.probedGenerations.set(sessionId, generation);
          void this.reconcileTab(tab.id, sessionId);
        }
        for (const sessionId of this.probedGenerations.keys()) {
          if (
            !candidates.some((candidate) => candidate.sessionId === sessionId)
          )
            this.probedGenerations.delete(sessionId);
        }
      });
    });
  }

  private readonly probedGenerations = new Map<string, number>();

  async reconcileRestoredTabs(): Promise<void> {
    const workspacePath =
      this.tabManager.activeWorkspacePath ??
      this.vscodeService.config().workspaceRoot ??
      undefined;
    const targets = this.tabManager
      .tabs()
      .filter((tab) => tab.claudeSessionId != null)
      .map((tab) => ({
        tabId: tab.id,
        sessionId: tab.claudeSessionId as string,
      }));

    await Promise.allSettled(
      targets.map((t) => this.probe(t.tabId, t.sessionId, workspacePath)),
    );
  }

  /** Probe one restored tab using the revision-safe unordered status path. */
  async reconcileTab(tabId: string, sessionId: string): Promise<void> {
    const workspacePath =
      this.tabManager.activeWorkspacePath ??
      this.vscodeService.config().workspaceRoot ??
      undefined;
    await this.probe(tabId, sessionId, workspacePath);
  }

  private async probe(
    tabId: string,
    sessionId: string,
    workspacePath: string | undefined,
  ): Promise<void> {
    const generation = this.agentMonitor
      .pendingHistoryCandidates()
      .find((candidate) => candidate.sessionId === sessionId)?.generation;
    try {
      const result = await this.rpc.call('session:status', { sessionId });
      if (!result?.success || !result.data) return;

      const { isActive, turnState } = result.data;
      if (generation !== undefined) {
        const inactive =
          isActive === false ||
          (turnState &&
            ['idle', 'failed', 'sleeping'].includes(turnState.phase) &&
            turnState.backgroundTasks.length === 0);
        const live =
          turnState &&
          (turnState.phase === 'generating' ||
            turnState.phase === 'awaiting-background' ||
            turnState.backgroundTasks.length > 0);
        if (inactive || live)
          this.agentMonitor.applyHistoryEvidence(
            sessionId,
            generation,
            inactive ? 'inactive' : 'live',
          );
      }
      if (turnState) {
        // `ordered: false` — this event is synthesized from an RPC answer, not
        // pulled from the tab's chunk stream, so it carries whatever revision
        // the registry held when the call was ANSWERED. A turn starting while
        // the call was in flight lands it behind a live `generating`, and the
        // terminal heal would then finalize the in-flight message and idle the
        // tab mid-turn (TASK_2026_371). A stranded tab is healed by the next
        // real turn's terminal event, which IS ordered.
        this.turnStateApplier.apply(
          toTurnStateEvent(sessionId, turnState),
          tabId,
          { ordered: false },
        );
      } else if (isActive) {
        // Known to the backend but no turn recorded yet: live and idle.
        this.liveness.markIdle(sessionId, workspacePath);
      }
    } catch {
      // Failed probes provide no evidence; leave candidates for the next probe.
    }
  }
}

/** Wrap a `session:status` turn state as the stream event the applier takes. */
function toTurnStateEvent(
  sessionId: string,
  state: SessionTurnState,
): TurnStateEvent {
  return {
    ...state,
    id: `turn-state-probe-${sessionId}-${state.revision}`,
    eventType: 'turn_state',
    sessionId,
    messageId: `turn-state-${sessionId}`,
    source: 'complete',
  };
}
