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
  agentVisibleInSession,
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

/** Teammate names this short (e.g. `r`) identify nothing on their own. */
const MIN_MEANINGFUL_NAME_LENGTH = 3;

/**
 * Pick the row label. The agent type leads when known; the teammate name is a
 * secondary hint only when it is long enough to mean something and differs from
 * the type. Without a type, a meaningful teammate name leads, then the task
 * description, then `fallback`.
 */
function agentLabel(
  agentType: string | undefined,
  teammateName: string | undefined,
  description: string | undefined,
  fallback: string,
): { name: string; hint?: string } {
  const type = agentType?.trim();
  const teammate = teammateName?.trim();
  const meaningfulTeammate =
    teammate && teammate.length >= MIN_MEANINGFUL_NAME_LENGTH
      ? teammate
      : undefined;
  if (type) {
    const hint =
      meaningfulTeammate &&
      meaningfulTeammate.toLowerCase() !== type.toLowerCase()
        ? meaningfulTeammate
        : undefined;
    return { name: type, hint };
  }
  return { name: meaningfulTeammate || description?.trim() || fallback };
}

/**
 * Tidy one-line status summary: the rolling/final summary, else the last tool,
 * else the task description — skipping a candidate that only repeats the name.
 */
function agentSummary(
  name: string,
  ...candidates: (string | undefined)[]
): string | undefined {
  for (const raw of candidates) {
    const tidy = raw ? tidyAgentSummary(raw) : '';
    if (tidy && tidy !== name) return tidy;
  }
  return undefined;
}

/** Path-like token: absolute (drive, `/`, `~`, `./`) or ending in a file name. */
const PATH_TOKEN =
  /^(?:[A-Za-z]:[\\/]|[\\/]|~[\\/]|\.{1,2}[\\/])\S*$|^(?:[^\s\\/]+[\\/])+[^\s\\/]*\.[^\s\\/]+$/;

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

/**
 * First line of an agent summary with directories stripped from paths, and the
 * SDK's `WROTE: <path>` completion reply rendered as `Wrote <basename>`.
 */
function tidyAgentSummary(raw: string): string {
  const firstLine = raw.trim().split(/\r?\n/, 1)[0].trim();
  const wrote = /^wrote:\s*(.+)$/i.exec(firstLine);
  if (wrote) return `Wrote ${basename(wrote[1].trim())}`;
  return firstLine
    .split(/(\s+)/)
    .map((token) =>
      !token.includes('://') && PATH_TOKEN.test(token)
        ? basename(token)
        : token,
    )
    .join('');
}

/**
 * Effective strip status for a background entry. A terminal subagent record
 * overrides a background entry still marked `running` — see `fromBackground`.
 */
function backgroundStatus(
  bgStatus: BackgroundAgentEntry['status'],
  recStatus: SubagentRecord['status'] | undefined,
): BackgroundAgentStripEntry['status'] {
  if (bgStatus === 'running') {
    switch (recStatus) {
      case 'completed':
        return 'completed';
      case 'failed':
        return 'error';
      case 'killed':
      case 'stopped':
        return 'stopped';
      default:
        return 'background';
    }
  }
  return bgStatus === 'completed'
    ? 'completed'
    : bgStatus === 'error'
      ? 'error'
      : 'stopped';
}

/**
 * BackgroundAgentTrayComponent — thin smart wrapper around the presentational
 * {@link BackgroundAgentStripComponent}.
 *
 * Composes the entry list from all running subagents plus all background
 * agents (deduped by `toolCallId`, background records winning since they are
 * the authoritative state once an agent is backgrounded) and wires the chip
 * actions to the stores. Each entry carries its `origin` so the strip labels
 * the two populations explicitly; neither is the session AGENTS chip, which
 * is the backend's lifetime count of unique subagents. Every action resolves the agent's OWNING session
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
   * Owning-session filter. When set (canvas-tile mode), only agents visible
   * from that session are shown so each tile's tray is scoped to its own
   * subagents. When null (main panel), every agent is shown across all
   * sessions. An empty string is a tile whose session has not resolved yet:
   * still a scope, so it shows only agents with no owner — never everyone's.
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
      if (scope !== null && !agentVisibleInSession(rec.parentSessionId, scope))
        continue;
      map.set(rec.parentToolUseId, this.fromSubagent(rec));
    }

    for (const bg of this.backgroundStore.agents()) {
      if (scope !== null && !agentVisibleInSession(bg.sessionId, scope))
        continue;
      map.set(
        bg.toolCallId,
        this.fromBackground(bg, subagents.get(bg.toolCallId)),
      );
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
    const label = agentLabel(
      rec.agentType,
      rec.teammateName,
      rec.description,
      'Subagent',
    );
    return {
      entry: {
        id: rec.parentToolUseId,
        name: label.name,
        hint: label.hint,
        agentType: rec.agentType,
        origin: 'foreground',
        description: agentSummary(
          label.name,
          rec.latestSummary,
          rec.lastToolName,
          rec.description,
        ),
        durationMs: rec.durationMs,
        totalTokens: rec.totalTokens,
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

  /**
   * Background records win over the subagent record for identity, but they
   * carry no progress of their own. The live rolling summary arrives on
   * `agent_progress` (SDK `task_progress`), which keeps firing after an agent is
   * backgrounded and lands on the subagent record. Reading it here is what
   * makes a background row show whether the agent is working or stuck.
   *
   * Status reads the subagent record too. A background entry only leaves
   * `running` on `background_agent_completed` / `_stopped` (or the SubagentStop
   * reconciliation), while the SDK's `agent_completed` (`task_notification`)
   * lands on the subagent record — often first, and sometimes alone. Reading
   * `bg.status` only left a row showing the agent's final "WROTE: …" reply
   * beside a live background dot.
   */
  private fromBackground(
    bg: BackgroundAgentEntry,
    rec: SubagentRecord | undefined,
  ): StripContext {
    const taskId = rec?.taskId;
    const status = backgroundStatus(bg.status, rec?.status);
    const isRunning = status === 'background';
    const agentType =
      bg.agentType && bg.agentType !== 'unknown'
        ? bg.agentType
        : rec?.agentType;
    const label = agentLabel(
      agentType,
      bg.teammateName ?? rec?.teammateName,
      bg.agentDescription ?? rec?.description,
      'Agent',
    );
    return {
      entry: {
        id: bg.toolCallId,
        name: label.name,
        hint: label.hint,
        agentType,
        origin: 'background',
        description: agentSummary(
          label.name,
          rec?.latestSummary,
          rec?.lastToolName,
          bg.agentDescription,
        ),
        durationMs: rec?.durationMs ?? bg.duration,
        totalTokens: rec?.totalTokens,
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
