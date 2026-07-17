import {
  Component,
  ChangeDetectionStrategy,
  inject,
  computed,
  input,
  signal,
} from '@angular/core';
import {
  BackgroundAgentStripComponent,
  type BackgroundAgentStripEntry,
  type BackgroundAgentSteerRequest,
} from '@ptah-extension/chat-ui';
import {
  AgentMonitorStore,
  BackgroundAgentStore,
  type SubagentRecord,
  type BackgroundAgentEntry,
} from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import { SubagentTranscriptViewerService } from '../../services/subagent-transcript-viewer.service';

/**
 * Per-entry action context. Carried alongside each chip view-model so the
 * output handlers can dispatch to the right store method without re-deriving
 * anything from the dumb component's echoed id.
 */
interface StripContext {
  readonly entry: BackgroundAgentStripEntry;
  /** SDK `task_id`, when known — required to stop the agent. */
  readonly taskId?: string;
  /**
   * Owning session id (the session that spawned the agent) — sourced from the
   * subagent record's `parentSessionId` or the background entry's `sessionId`,
   * NOT the focused tab. Every steer / stop / background RPC targets this.
   */
  readonly sessionId?: string;
  /**
   * SDK short-hex agent id, when known. Required (with `sessionId`) to open the
   * on-demand transcript viewer via `subagent:transcript`.
   */
  readonly agentId?: string;
}

/**
 * BackgroundAgentTrayComponent — thin smart wrapper around the presentational
 * {@link BackgroundAgentStripComponent}.
 *
 * Composes the entry list from all running subagents plus all background
 * agents (deduped by `toolCallId`, background records winning since they are
 * the authoritative state once an agent is backgrounded) and wires the chip
 * actions to the stores. Every action resolves the agent's OWNING session
 * (from the pushed events, via `SubagentRecord.parentSessionId` /
 * `BackgroundAgentEntry.sessionId`) so it targets the correct Query even when
 * several canvas tiles are live — never the focused tab.
 *
 *   - focus  → switch to the owning session's tab (lands on the agent's bubble).
 *   - steer  → {@link AgentMonitorStore.sendMessageToAgent} (owning session).
 *   - stop   → {@link AgentMonitorStore.stopAgent} by task id (owning session).
 *   - background → {@link AgentMonitorStore.backgroundAgent} (owning session).
 *
 * State is never mutated optimistically — the stores update only from pushed
 * stream events, so this component just reads their signals and fires RPCs.
 */
@Component({
  selector: 'ptah-background-agent-tray',
  standalone: true,
  imports: [BackgroundAgentStripComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-background-agent-strip
      [entries]="entries()"
      [pendingSteerId]="pendingSteerId()"
      (focusAgent)="onFocus($event)"
      (steer)="onSteer($event)"
      (stop)="onStop($event)"
      (sendToBackground)="onSendToBackground($event)"
      (viewTranscript)="onViewTranscript($event)"
    />
  `,
})
export class BackgroundAgentTrayComponent {
  private readonly agentMonitor = inject(AgentMonitorStore);
  private readonly backgroundStore = inject(BackgroundAgentStore);
  private readonly tabManager = inject(TabManagerService);
  private readonly transcriptViewer = inject(SubagentTranscriptViewerService);

  /**
   * Owning-session filter. When set (canvas-tile mode), only agents spawned by
   * that session are shown so each tile's tray is scoped to its own subagents.
   * When null (main panel), every agent is shown across all sessions.
   */
  readonly sessionId = input<string | null>(null);

  /** Id of the chip whose steer RPC is in flight (disables its inline input). */
  protected readonly pendingSteerId = signal<string | null>(null);

  /**
   * Per-entry action context, keyed by `toolCallId`. Subagents are inserted
   * first; background records override them so a backgrounded agent renders as
   * its authoritative background state while still carrying the subagent's
   * `taskId` (which survives in the store — records are never evicted — so
   * Stop keeps working after an agent moves to the background).
   */
  private readonly context = computed<ReadonlyMap<string, StripContext>>(() => {
    const map = new Map<string, StripContext>();
    const subagents = this.agentMonitor.subagents();
    const scope = this.sessionId();

    for (const rec of subagents.values()) {
      if (!this.isActiveSubagent(rec.status)) continue;
      if (scope && rec.parentSessionId !== scope) continue;
      map.set(rec.parentToolUseId, this.fromSubagent(rec));
    }

    for (const bg of this.backgroundStore.agents()) {
      if (scope && bg.sessionId !== scope) continue;
      const taskId = subagents.get(bg.toolCallId)?.taskId;
      map.set(bg.toolCallId, this.fromBackground(bg, taskId));
    }

    return map;
  });

  /** Chip view-models handed to the dumb strip. */
  readonly entries = computed<readonly BackgroundAgentStripEntry[]>(() =>
    Array.from(this.context().values(), (ctx) => ctx.entry),
  );

  /** Whether the subagent is still active (running/queued), not finished. */
  private isActiveSubagent(status: SubagentRecord['status']): boolean {
    return status === 'running' || status === 'pending' || status === 'paused';
  }

  private fromSubagent(rec: SubagentRecord): StripContext {
    return {
      entry: {
        id: rec.parentToolUseId,
        name: rec.description || 'Subagent',
        description: rec.latestSummary || rec.lastToolName,
        status: 'running',
        steerable: true,
        stoppable: !!rec.taskId,
        canBackground: true,
        canViewTranscript: !!rec.agentId && !!rec.parentSessionId,
      },
      taskId: rec.taskId,
      sessionId: rec.parentSessionId,
      agentId: rec.agentId,
    };
  }

  private fromBackground(
    bg: BackgroundAgentEntry,
    taskId: string | undefined,
  ): StripContext {
    const status: BackgroundAgentStripEntry['status'] =
      bg.status === 'running'
        ? 'background'
        : bg.status === 'completed'
          ? 'completed'
          : bg.status === 'error'
            ? 'error'
            : 'stopped';
    const isRunning = bg.status === 'running';
    return {
      entry: {
        id: bg.toolCallId,
        name: bg.agentType || 'Agent',
        description: bg.agentDescription || bg.summary || undefined,
        status,
        steerable: isRunning,
        stoppable: isRunning && !!taskId,
        canBackground: false,
        canViewTranscript: bg.hasRealAgentId && !!bg.sessionId,
      },
      taskId,
      sessionId: bg.sessionId,
      agentId: bg.agentId,
    };
  }

  /** Switch to the tab that owns the agent's session, landing on its bubble. */
  protected onFocus(id: string): void {
    const sessionId = this.context().get(id)?.sessionId;
    if (!sessionId) return;
    const tab = this.tabManager.findTabBySessionId(sessionId);
    if (tab) this.tabManager.switchTab(tab.id);
  }

  protected async onSteer(request: BackgroundAgentSteerRequest): Promise<void> {
    const ctx = this.context().get(request.id);
    if (!ctx) return;
    this.pendingSteerId.set(request.id);
    try {
      await this.agentMonitor.sendMessageToAgent(
        request.id,
        request.text,
        ctx.sessionId,
      );
    } finally {
      this.pendingSteerId.set(null);
    }
  }

  protected onStop(id: string): void {
    const ctx = this.context().get(id);
    if (ctx?.taskId) {
      void this.agentMonitor.stopAgent(ctx.taskId, ctx.sessionId);
    }
  }

  protected onSendToBackground(id: string): void {
    const ctx = this.context().get(id);
    const sessionId = ctx?.sessionId;
    if (!sessionId) return;
    void this.agentMonitor.backgroundAgent(sessionId, id);
  }

  /** Open the on-demand transcript viewer for the chip's agent. */
  protected onViewTranscript(id: string): void {
    const ctx = this.context().get(id);
    if (!ctx?.agentId || !ctx.sessionId) return;
    void this.transcriptViewer.openFor(
      ctx.entry.name,
      ctx.sessionId,
      ctx.agentId,
    );
  }
}
