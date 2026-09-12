/**
 * Child → parent reporting (TASK_2026_402, Component 7).
 *
 * A spawned agent calls `ptah_agent_report({ message })`. This router turns
 * that call into a turn in the session that spawned it, plus a line on that
 * agent's own tile — or into an honest refusal carrying a reason.
 *
 * Three properties hold the design together:
 *
 *  - **The caller does not name itself.** The agent id arrives on the MCP URL
 *    (`/agent/{id}`, built by `ptahMcpServerUrl` at spawn time and parsed onto
 *    `MCPRequest._callerAgentId` by `http-server.handler.ts`). The tool takes
 *    no `agentId` argument, so one child cannot report as another.
 *  - **The parent is the one recorded at spawn.** `info.parentSessionId` is
 *    written when the agent is tracked. It is never derived from the MCP
 *    caller session — a spawned CLI carries no `_callerSessionId`, so
 *    caller-derived attribution would land the report in whichever session
 *    resolved first (the defect TASK_2026_295 fixed for spawn attribution).
 *  - **It never reports a delivery it did not make.** Every branch either
 *    performed a `sendMessageToSession` or returns `delivered: false` with a
 *    reason, and the tile note is written ONLY after a delivery succeeded.
 *
 * No new port and no new lib: `IAgentAdapter` already carries both
 * `isSessionActive` and `sendMessageToSession` (it extends `IAIProvider`), and
 * `gateway-chat-bridge` is the precedent for a backend lib driving a chat
 * session through it.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import { SessionId } from '@ptah-extension/shared';
import type { AgentProcessInfo, IAgentAdapter } from '@ptah-extension/shared';
import { AgentProcessManager } from './agent-process-manager.service';

/**
 * Body cap, in characters. Copied from the Claude channel's own cross-session
 * message cap rather than invented, so an agent that learns the limit on one
 * vendor has learned it everywhere (Req 6.5). Batch 5's `ptah_agent_report`
 * Zod schema pins the same number at the tool boundary; this is the enforcing
 * copy, because the router is also reachable from the stdio surface.
 */
export const MAX_AGENT_REPORT_LENGTH = 1_048_576;

/**
 * Burst limit: at most this many DELIVERED reports from one agent inside
 * {@link AGENT_REPORT_BURST_WINDOW_MS}. A report loop between a parent and a
 * child would otherwise drive the parent's session as fast as the child can
 * call a tool.
 *
 * Only deliveries count. A refused call consumes no budget, so an agent cannot
 * lock itself out by retrying into a refusal.
 */
export const AGENT_REPORT_BURST_LIMIT = 5;

/** Sliding window the burst limit is measured over. */
export const AGENT_REPORT_BURST_WINDOW_MS = 60_000;

/**
 * How many recent report bodies are remembered per agent for identical-repeat
 * suppression. Bounded so a long-running agent cannot grow this without limit;
 * the window doubles as the burst window's backing store.
 */
export const AGENT_REPORT_HISTORY_SIZE = 8;

/** Characters of the report echoed onto the tile when no summary was given. */
const TILE_NOTE_PREVIEW_LENGTH = 160;

/**
 * Why a report was not delivered. Every value is a state the caller can act
 * on; none of them is "something went wrong".
 */
export type AgentReportRefusalReason =
  /** No `_callerAgentId` on the request, or no tracked record under it. */
  | 'unattributed-caller'
  /** The agent exists but was spawned with no parent session recorded. */
  | 'no-parent-recorded'
  /** The parent session is recorded but is no longer live in memory. */
  | 'parent-session-not-active'
  /** Body exceeds {@link MAX_AGENT_REPORT_LENGTH}. */
  | 'report-too-large'
  /** Burst limit exceeded for this agent. */
  | 'rate-limited'
  /** Byte-identical to a report this agent already delivered recently. */
  | 'duplicate-report'
  /** No chat runtime is registered in this host, so nothing can be delivered. */
  | 'chat-runtime-unavailable'
  /** The chat runtime rejected the injected turn. */
  | 'delivery-failed';

export interface AgentReportInput {
  /**
   * The reporting agent, taken from the MCP URL — NEVER from the tool
   * arguments.
   */
  readonly agentId: string;
  readonly message: string;
  readonly summary?: string;
}

export interface AgentReportDelivery {
  readonly delivered: boolean;
  /** Present exactly when `delivered` is false. */
  readonly reason?: AgentReportRefusalReason;
  /** The session the report reached. Present only on a delivery. */
  readonly parentSessionId?: string;
}

/** Per-agent delivery bookkeeping. Bounded; discarded with the record. */
interface ReportHistoryEntry {
  readonly at: number;
  readonly message: string;
}

/** XML attribute values are model-facing text; a stray quote must not reshape the envelope. */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The label a person recognises this agent by, without naming a vendor in code. */
function agentLabel(info: AgentProcessInfo): string {
  return info.ptahCliName ?? info.displayName ?? info.cli;
}

function firstLine(message: string, limit: number): string {
  const line = message.split('\n', 1)[0] ?? '';
  const trimmed = line.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
}

@injectable()
export class AgentReportRouter {
  private readonly history = new Map<string, ReportHistoryEntry[]>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.AGENT_PROCESS_MANAGER)
    private readonly agents: AgentProcessManager,
    /**
     * Optional because a host may register `cli-agent-runtime` without a chat
     * runtime. Absence is reported as `chat-runtime-unavailable`, not silently
     * swallowed — the caller must never be told a report landed when this host
     * has nowhere to land it.
     */
    @inject(TOKENS.AGENT_ADAPTER, { isOptional: true })
    private readonly agentAdapter: IAgentAdapter | null = null,
  ) {}

  /**
   * Deliver one report, or refuse it with a reason.
   *
   * Check order is deliberate: identity, then size, then attribution, then the
   * volume limits. A caller with a forged-looking id learns that first, and an
   * over-size body is rejected before any session state is consulted.
   */
  async deliver(input: AgentReportInput): Promise<AgentReportDelivery> {
    const { agentId, message, summary } = input;

    if (!agentId) {
      return this.refuse('unattributed-caller', agentId, {
        detail:
          'the MCP request carried no /agent/{id} segment, so the report ' +
          'belongs to no known spawn',
      });
    }

    const info = this.agents.findAgentInfo(agentId);
    if (!info) {
      return this.refuse('unattributed-caller', agentId, {
        detail: 'this host holds no tracked record under that agent id',
      });
    }

    if (message.length > MAX_AGENT_REPORT_LENGTH) {
      return this.refuse('report-too-large', agentId, {
        length: message.length,
        cap: MAX_AGENT_REPORT_LENGTH,
      });
    }

    // `safeParse`, not `from`: an unresolved parent is a MODELLED state, not an
    // exception. `parentSessionId` holds the frontend tab id until the real SDK
    // uuid arrives and `resolveParentSessionId` backfills it, so a value that
    // is not a session id means the parent never resolved one — there is no
    // session to deliver into, and saying so is the honest answer.
    const parentSessionId = SessionId.safeParse(info.parentSessionId?.trim());
    if (!parentSessionId) {
      return this.refuse('no-parent-recorded', agentId, {
        detail: info.parentSessionId
          ? 'the parent session recorded at spawn never resolved to a real session id'
          : 'the agent was spawned without a parent session',
      });
    }

    if (!this.agentAdapter) {
      return this.refuse('chat-runtime-unavailable', agentId, {
        detail:
          'no agent adapter is registered in this host, so no chat session ' +
          'can be driven',
      });
    }

    if (!this.agentAdapter.isSessionActive(parentSessionId)) {
      return this.refuse('parent-session-not-active', agentId, {
        parentSessionId,
      });
    }

    const now = Date.now();
    const recent = this.recentEntries(agentId, now);
    if (recent.length >= AGENT_REPORT_BURST_LIMIT) {
      return this.refuse('rate-limited', agentId, {
        limit: AGENT_REPORT_BURST_LIMIT,
        windowMs: AGENT_REPORT_BURST_WINDOW_MS,
      });
    }
    if (recent.some((entry) => entry.message === message)) {
      return this.refuse('duplicate-report', agentId, {
        detail: 'an identical report from this agent was delivered recently',
      });
    }

    const envelope = AgentReportRouter.buildEnvelope(info, message, summary);
    try {
      await this.agentAdapter.sendMessageToSession(parentSessionId, envelope, {
        origin: {
          kind: 'peer',
          from: `ptah-agent:${agentId}`,
          name: `${info.cli} · ${agentLabel(info)}`,
        },
      });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      return this.refuse('delivery-failed', agentId, {
        parentSessionId,
        detail,
      });
    }

    this.remember(agentId, { at: now, message });

    // Written ONLY here, after the delivery succeeded, so the tile can never
    // show a report the parent did not receive (Req 6.4).
    this.agents.recordAgentNote(agentId, {
      type: 'info',
      content: `Reported to the spawning session: ${
        summary?.trim() || firstLine(message, TILE_NOTE_PREVIEW_LENGTH)
      }`,
    });

    this.logger.info('[AgentReportRouter] Report delivered', {
      agentId,
      parentSessionId,
      cli: info.cli,
      length: message.length,
    });

    return { delivered: true, parentSessionId };
  }

  /**
   * The envelope the parent's model reads. It mirrors the CLI's own inbound
   * cross-session wrapper so a model meets ONE mental model for "a message
   * from another agent" regardless of which vendor produced it.
   */
  private static buildEnvelope(
    info: AgentProcessInfo,
    message: string,
    summary?: string,
  ): string {
    const attrs = [
      `agent-id="${escapeAttribute(info.agentId)}"`,
      `agent="${escapeAttribute(agentLabel(info))}"`,
      `cli="${escapeAttribute(info.cli)}"`,
    ].join(' ');
    const trimmedSummary = summary?.trim();
    const body = trimmedSummary ? `${trimmedSummary}\n\n${message}` : message;
    return `<agent-report ${attrs}>\n${body}\n</agent-report>`;
  }

  /**
   * A refusal is logged at `warn` with its reason: on the parent side a
   * refused report is otherwise completely invisible — no chat turn, no tile
   * segment, nothing but a `delivered: false` the child alone can see.
   */
  private refuse(
    reason: AgentReportRefusalReason,
    agentId: string,
    context: Record<string, unknown> = {},
  ): AgentReportDelivery {
    this.logger.warn('[AgentReportRouter] Report refused', {
      reason,
      agentId,
      ...context,
    });
    return { delivered: false, reason };
  }

  /** Delivered entries still inside the burst window, oldest first. */
  private recentEntries(agentId: string, now: number): ReportHistoryEntry[] {
    const entries = this.history.get(agentId);
    if (!entries) return [];
    const cutoff = now - AGENT_REPORT_BURST_WINDOW_MS;
    const live = entries.filter((entry) => entry.at > cutoff);
    if (live.length === 0) {
      this.history.delete(agentId);
    } else if (live.length !== entries.length) {
      this.history.set(agentId, live);
    }
    return live;
  }

  private remember(agentId: string, entry: ReportHistoryEntry): void {
    const entries = this.history.get(agentId) ?? [];
    entries.push(entry);
    // Bounded ring: the oldest entries fall off, so one agent's history costs
    // at most AGENT_REPORT_HISTORY_SIZE bodies no matter how long it runs.
    this.history.set(
      agentId,
      entries.slice(Math.max(entries.length - AGENT_REPORT_HISTORY_SIZE, 0)),
    );
  }
}
