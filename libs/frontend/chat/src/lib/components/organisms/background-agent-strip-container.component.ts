import {
  Component,
  ChangeDetectionStrategy,
  inject,
  computed,
  output,
} from '@angular/core';
import {
  BackgroundAgentStripComponent,
  type BackgroundAgentStripEntry,
} from '@ptah-extension/chat-ui';
import {
  AgentMonitorStore,
  BackgroundAgentStore,
  type SubagentRecord,
  type BackgroundAgentEntry,
} from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';

/**
 * Per-entry action context. Carried alongside each chip view-model so the
 * output handlers can dispatch to the right store method without re-deriving
 * anything from the dumb component's echoed id.
 */
interface StripContext {
  readonly entry: BackgroundAgentStripEntry;
  /** SDK `task_id`, when known — required to stop the agent. */
  readonly taskId?: string;
  /** Parent session that owns the agent — required to send it to background. */
  readonly sessionId?: string;
}

/**
 * BackgroundAgentStripContainerComponent — thin smart wrapper around the
 * presentational {@link BackgroundAgentStripComponent}.
 *
 * Composes the entry list from all running subagents plus all background
 * agents (deduped by `toolCallId`, background records winning since they are
 * the authoritative state once an agent is backgrounded) and wires the chip
 * actions:
 *   - focus / steer → bubbled up via {@link focusRequested} so the host opens
 *     the monitor panel (which hosts the steer input).
 *   - stop → {@link AgentMonitorStore.stopAgent} (by task id).
 *   - sendToBackground → {@link AgentMonitorStore.backgroundAgent}.
 *
 * State is never mutated optimistically — the stores update only from pushed
 * stream events, so this component just reads their signals and fires RPCs.
 */
@Component({
  selector: 'ptah-background-agent-strip-container',
  standalone: true,
  imports: [BackgroundAgentStripComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-background-agent-strip
      [entries]="entries()"
      (focusAgent)="focusRequested.emit($event)"
      (steer)="focusRequested.emit($event)"
      (stop)="onStop($event)"
      (sendToBackground)="onSendToBackground($event)"
    />
  `,
})
export class BackgroundAgentStripContainerComponent {
  private readonly agentMonitor = inject(AgentMonitorStore);
  private readonly backgroundStore = inject(BackgroundAgentStore);
  private readonly tabManager = inject(TabManagerService);

  /**
   * Emits the entry id when a chip's focus or steer action fires. The host
   * (chat view) opens the agents monitor panel in response — the panel hosts
   * the per-agent steer input (Task 3).
   */
  readonly focusRequested = output<string>();

  /**
   * Per-entry action context, keyed by `toolCallId`. Subagents are inserted
   * first; background records override them so a backgrounded agent renders as
   * its authoritative background state while still carrying the subagent's
   * `taskId` (needed for stop).
   */
  private readonly context = computed<ReadonlyMap<string, StripContext>>(() => {
    const map = new Map<string, StripContext>();
    const subagents = this.agentMonitor.subagents();

    for (const rec of subagents.values()) {
      if (!this.isActiveSubagent(rec.status)) continue;
      map.set(rec.parentToolUseId, this.fromSubagent(rec));
    }

    for (const bg of this.backgroundStore.agents()) {
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
      },
      taskId: rec.taskId,
      sessionId: this.tabManager.activeTabSessionId() ?? undefined,
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
      },
      taskId,
      sessionId: bg.sessionId as unknown as string,
    };
  }

  protected onStop(id: string): void {
    const ctx = this.context().get(id);
    if (ctx?.taskId) {
      void this.agentMonitor.stopAgent(ctx.taskId);
    }
  }

  protected onSendToBackground(id: string): void {
    const ctx = this.context().get(id);
    const sessionId = ctx?.sessionId;
    if (!sessionId) return;
    void this.agentMonitor.backgroundAgent(sessionId, id);
  }
}
