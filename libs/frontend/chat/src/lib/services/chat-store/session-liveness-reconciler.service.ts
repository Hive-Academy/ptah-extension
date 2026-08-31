import { Injectable, inject } from '@angular/core';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import {
  TabManagerService,
  SessionLivenessRegistry,
} from '@ptah-extension/chat-state';
import { TurnStateApplier } from '@ptah-extension/chat-streaming';
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

  private async probe(
    tabId: string,
    sessionId: string,
    workspacePath: string | undefined,
  ): Promise<void> {
    try {
      const result = await this.rpc.call('session:status', { sessionId });
      if (!result.success || !result.data) return;

      const { isActive, turnState } = result.data;
      if (turnState) {
        this.turnStateApplier.apply(
          toTurnStateEvent(sessionId, turnState),
          tabId,
        );
      } else if (isActive) {
        // Known to the backend but no turn recorded yet: live and idle.
        this.liveness.markIdle(sessionId, workspacePath);
      }
    } catch (error: unknown) {
      console.warn(
        '[SessionLivenessReconciler] probe failed; leaving tab as restored',
        { sessionId, error },
      );
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
