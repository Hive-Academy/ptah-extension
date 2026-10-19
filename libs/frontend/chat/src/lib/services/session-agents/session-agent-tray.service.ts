import { Injectable, inject } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  AgentMonitorStore,
  BackgroundAgentStore,
} from '@ptah-extension/chat-streaming';
import { parseLaneKey } from '../../components/molecules/compact-session/compact-lane-rows';
import type { SessionAgent } from './session-agent-roster';
import {
  agentModelsByKey,
  buildTrayContexts,
  type AgentRowExtras,
  type TrayAgentContext,
} from './session-agent-tray';

const NO_CONTEXTS: ReadonlyMap<string, TrayAgentContext> = new Map();

/**
 * The background-agent tray's data and actions, shared by the tray strip and
 * the inspector AGENTS section. Plain signal-reading methods: callers wrap
 * them in their own `computed`, so there is no cache and nothing to release.
 *
 * Every action targets the agent's OWNING session (`ctx.sessionId`), never
 * the focused tab. State is never mutated optimistically: the stores update
 * only from pushed stream events, so an action only fires the RPC. An action
 * whose context lacks the id it needs is a no-op (today's tray guards).
 */
@Injectable({ providedIn: 'root' })
export class SessionAgentTrayService {
  private readonly monitor = inject(AgentMonitorStore);
  private readonly background = inject(BackgroundAgentStore);
  private readonly tabManager = inject(TabManagerService);

  /** Tray contexts of the agents visible from `sessionId`, keyed by `toolCallId`; `null` -> empty. */
  contextsFor(sessionId: string | null): ReadonlyMap<string, TrayAgentContext> {
    if (sessionId === null) return NO_CONTEXTS;
    return buildTrayContexts(
      this.monitor.subagents(),
      this.background.agents(),
      sessionId,
    );
  }

  /**
   * One entry per roster row, keyed by `row.key`. Tray contexts join only
   * `sub:` / `bg:` rows by their tool-call id; the model comes from every
   * roster agent's own record, so finished agents keep it.
   */
  extrasFor(
    sessionId: string | null,
    rows: readonly SessionAgent[],
  ): ReadonlyMap<string, AgentRowExtras> {
    const contexts = this.contextsFor(sessionId);
    const models = agentModelsByKey(
      this.monitor.subagents().values(),
      this.monitor.agents(),
    );
    const extras = new Map<string, AgentRowExtras>();
    for (const row of rows) {
      const toolCallId =
        row.kind === 'subagent' || row.kind === 'background'
          ? parseLaneKey(row.key)?.id
          : undefined;
      const tray = toolCallId ? (contexts.get(toolCallId) ?? null) : null;
      extras.set(row.key, {
        tray,
        model: models.get(row.key) ?? null,
        tokens: tray?.entry.totalTokens ?? null,
      });
    }
    return extras;
  }

  /** Switch to the tab that owns the agent's session, landing on its bubble. */
  focus(ctx: TrayAgentContext): void {
    if (!ctx.sessionId) return;
    const tab = this.tabManager.findTabBySessionId(ctx.sessionId);
    if (tab) this.tabManager.switchTab(tab.id);
  }

  async steer(ctx: TrayAgentContext, text: string): Promise<boolean> {
    try {
      return await this.monitor.sendMessageToAgent(
        ctx.entry.id,
        text,
        ctx.sessionId,
      );
    } catch {
      return false;
    }
  }

  stop(ctx: TrayAgentContext): void {
    if (ctx.taskId) void this.monitor.stopAgent(ctx.taskId, ctx.sessionId);
  }

  sendToBackground(ctx: TrayAgentContext): void {
    if (!ctx.sessionId) return;
    void this.monitor.backgroundAgent(ctx.sessionId, ctx.entry.id);
  }
}
