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
import { SessionChildRegistry } from '../session-children/session-child.registry';

/*
 * ---------------------------------------------------------------------------
 * Inbox-guard limits — MEASURED, not chosen (TASK_2026_402, Batch 5).
 *
 * Batch 4 landed these as reasoned guesses and said so, because the Claude
 * CLI's own inbox guard lives in a bun-compiled native binary and the
 * `@anthropic-ai/claude-agent-sdk` package carries no `crossSessionInbound`
 * literal at all. It is readable anyway: the bundle is embedded as plain text
 * in the executable. Read off claude-code **2.1.268**
 * (`~/.local/share/claude/versions/2.1.268`), the cross-session inbox guard's
 * defaults are exactly:
 *
 *   { bucketCapacity: 30, refillPerSecond: 0.5, dedupWindowMs: 30000,
 *     maxSelfHops: 10, maxChainLength: 28, maxTrackedSenders: 256 }
 *
 * and its size check is `if (framedLength > 1048576) throw messageTooLarge`.
 * The user-facing strings that go with them are
 * `sender exceeded the peer message rate limit`,
 * `identical to the previous message from this sender` and
 * `cross-session message exceeds the line cap`.
 *
 * Re-measure by grepping the version binary for `bucketCapacity:` — the values
 * are on one line. Do not re-derive them from the SDK package; it has none.
 * ---------------------------------------------------------------------------
 */

/**
 * Body cap, in characters. The Claude channel's own cap, confirmed as the
 * literal `1048576` in its size check (see the measurement note above), so an
 * agent that learns the limit on one vendor has learned it everywhere
 * (Req 6.5). Batch 5's `ptah_agent_report` Zod schema pins the same number at
 * the tool boundary; this is the enforcing copy, because the router is also
 * reachable from the stdio surface.
 */
export const MAX_AGENT_REPORT_LENGTH = 1_048_576;

/**
 * Burst limit: at most this many DELIVERED reports from one agent inside
 * {@link AGENT_REPORT_BURST_WINDOW_MS}. A report loop between a parent and a
 * child would otherwise drive the parent's session as fast as the child can
 * call a tool.
 *
 * 30 per 60 s is the Claude channel's own sustained rate expressed in the
 * shape this router implements. Its guard is a token bucket — capacity 30,
 * refilling at 0.5 tokens per second — so a fresh sender may burst 30 and then
 * earns one every two seconds. A 30-per-60 s sliding window has the identical
 * sustained rate and the identical burst ceiling; the two differ only in the
 * recovery curve, where the bucket drips and the window releases in a block.
 * That difference is deliberate and is the whole delta: adopting a second rate
 * limiter shape here would be a bigger change than the accuracy is worth.
 *
 * Only deliveries count. A refused call consumes no budget, so an agent cannot
 * lock itself out by retrying into a refusal.
 */
export const AGENT_REPORT_BURST_LIMIT = 30;

/** Sliding window the burst limit is measured over. */
export const AGENT_REPORT_BURST_WINDOW_MS = 60_000;

/**
 * How many recent report bodies are remembered per agent for identical-repeat
 * suppression. Bounded so a long-running agent cannot grow this without limit;
 * the window doubles as the burst window's backing store.
 *
 * This one is deliberately STRICTER than the measured channel and stays as it
 * is. Claude's guard compares against the single immediately-previous body
 * inside `dedupWindowMs` (30 s) — its refusal string says "identical to the
 * PREVIOUS message from this sender". An 8-entry ring also catches an A-B-A
 * alternation, which is the shape a stuck agent actually produces. Loosening
 * it to one entry to match would trade a real protection for a symmetry
 * nothing needs, so the divergence is recorded rather than removed.
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

/**
 * One report. The reporter is either a spawned CLI agent (`agentId`, from the
 * `/agent/{id}` MCP URL) or a child chat session started with
 * `ptah_session_start` (`childSessionId`, from the `/session/{id}` MCP URL).
 * Both come from the transport — NEVER from the tool arguments.
 */
export type AgentReportInput =
  | {
      readonly agentId: string;
      readonly message: string;
      readonly summary?: string;
    }
  | {
      readonly childSessionId: string;
      readonly message: string;
      readonly summary?: string;
    };

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

/**
 * The envelope body. The summary is emitted only when it ADDS information.
 * Callers that have no separate summary pass the message itself (the report
 * RPC allows `summary === message`), and a byte-identical repeat renders the
 * same text twice inside the envelope — the parent's model reads it twice and
 * the parent chat shows it twice (TASK_2026_466 defect 3). Any other
 * difference, however small, is kept: only an exact repeat is provably
 * redundant.
 */
function reportBody(message: string, summary?: string): string {
  const trimmedSummary = summary?.trim();
  const summaryAddsInformation =
    !!trimmedSummary && trimmedSummary !== message.trim();
  return summaryAddsInformation ? `${trimmedSummary}\n\n${message}` : message;
}

type SessionChildReportInput = Extract<
  AgentReportInput,
  { readonly childSessionId: string }
>;

function isSessionChildInput(
  input: AgentReportInput,
): input is SessionChildReportInput {
  const candidate = (input as { childSessionId?: unknown }).childSessionId;
  return typeof candidate === 'string' && candidate.trim().length > 0;
}

@injectable()
export class AgentReportRouter {
  /**
   * Delivery timestamps per agent, for the burst limit. SEPARATE from
   * {@link recentBodies} on purpose: these two were one list until the burst
   * limit was corrected to the measured 30, at which point the bug became
   * visible — the counter read a list the ring had already truncated to 8, so
   * no limit above 8 could ever fire. Two structures, two bounds, and neither
   * silently caps the other.
   *
   * Bounded by the window AND by the limit: a 31st entry is never reached
   * because the 31st delivery inside the window is refused.
   */
  private readonly burstTimestamps = new Map<string, number[]>();

  /**
   * The last {@link AGENT_REPORT_HISTORY_SIZE} delivered bodies per agent, for
   * identical-repeat suppression. Bodies are capped at
   * {@link MAX_AGENT_REPORT_LENGTH}, so this ring — not the burst list — is
   * what bounds the memory an agent's history can cost.
   */
  private readonly recentBodies = new Map<string, ReportHistoryEntry[]>();

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
    /**
     * The parent → child session link (TASK_2026_584). Registered as a
     * singleton in every host that registers this lib; absent only in tests
     * that exercise the agent branch, where every child report is
     * `unattributed-caller`.
     */
    @inject(SessionChildRegistry, { isOptional: true })
    private readonly sessionChildren: SessionChildRegistry | null = null,
  ) {}

  /**
   * Deliver one report, or refuse it with a reason.
   *
   * Check order is deliberate: identity, then size, then attribution, then the
   * volume limits. A caller with a forged-looking id learns that first, and an
   * over-size body is rejected before any session state is consulted.
   */
  async deliver(input: AgentReportInput): Promise<AgentReportDelivery> {
    // A non-empty string, not mere key presence: an input built as
    // `{ agentId, childSessionId: undefined }` belongs on the agent path.
    if (isSessionChildInput(input)) {
      return this.deliverFromSessionChild(input);
    }
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
    if (this.recentDeliveryCount(agentId, now) >= AGENT_REPORT_BURST_LIMIT) {
      return this.refuse('rate-limited', agentId, {
        limit: AGENT_REPORT_BURST_LIMIT,
        windowMs: AGENT_REPORT_BURST_WINDOW_MS,
      });
    }
    if (
      this.recentBodyEntries(agentId, now).some((e) => e.message === message)
    ) {
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

    // Counted only on a DELIVERED report, so the completion signal's
    // `reportsDelivered` means "the spawning session heard from this lane",
    // never "the lane tried" (TASK_2026_515).
    this.agents.markReportDelivered(agentId);

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
    return `<agent-report ${attrs}>\n${reportBody(
      message,
      summary,
    )}\n</agent-report>`;
  }

  /**
   * Child chat session → parent session (TASK_2026_584).
   *
   * The same checks as the agent branch, in the same order, against the link
   * `SessionChildRegistry` recorded at `ptah_session_start`. The parent is the
   * recorded parent TAB id while that tab is live, else the recorded parent
   * SDK id — a parent reopened from the sidebar runs under a new tab id but
   * the same SDK session. Rate and duplicate history is keyed
   * `session:{childSessionId}` so it can never collide with an agent id.
   *
   * A refusal because the parent is not live is counted on the child record
   * (for `ptah_session_status`) and returned to the child; it is NOT queued —
   * a report is a point-in-time message and replaying a backlog into a resumed
   * conversation would present stale progress as current.
   */
  private async deliverFromSessionChild(
    input: SessionChildReportInput,
  ): Promise<AgentReportDelivery> {
    const { message, summary } = input;
    const reportedId = input.childSessionId.trim();

    const child = this.sessionChildren?.get(reportedId);
    if (!child) {
      return this.refuseSessionChild('unattributed-caller', reportedId, {
        detail: 'this session was not started with ptah_session_start',
      });
    }
    const childSessionId = child.childSessionId;

    if (message.length > MAX_AGENT_REPORT_LENGTH) {
      return this.refuseSessionChild('report-too-large', childSessionId, {
        length: message.length,
        cap: MAX_AGENT_REPORT_LENGTH,
      });
    }

    const candidates = [child.parentSessionId, child.parentSdkSessionId]
      .map((id) => SessionId.safeParse(id?.trim()))
      .filter((id): id is SessionId => !!id);
    if (candidates.length === 0) {
      return this.refuseSessionChild('no-parent-recorded', childSessionId, {
        detail: 'the parent recorded at ptah_session_start is not a session id',
      });
    }

    if (!this.agentAdapter) {
      return this.refuseSessionChild(
        'chat-runtime-unavailable',
        childSessionId,
        {
          detail:
            'no agent adapter is registered in this host, so no chat session ' +
            'can be driven',
        },
      );
    }

    const adapter = this.agentAdapter;
    const parentSessionId = candidates.find((id) =>
      adapter.isSessionActive(id),
    );
    if (!parentSessionId) {
      this.sessionChildren?.markReportRefused(
        childSessionId,
        summary?.trim() || firstLine(message, TILE_NOTE_PREVIEW_LENGTH),
      );
      return this.refuseSessionChild(
        'parent-session-not-active',
        childSessionId,
        { parentSessionIds: candidates },
      );
    }

    const rateKey = `session:${childSessionId}`;
    const now = Date.now();
    if (this.recentDeliveryCount(rateKey, now) >= AGENT_REPORT_BURST_LIMIT) {
      return this.refuseSessionChild('rate-limited', childSessionId, {
        limit: AGENT_REPORT_BURST_LIMIT,
        windowMs: AGENT_REPORT_BURST_WINDOW_MS,
      });
    }
    if (
      this.recentBodyEntries(rateKey, now).some((e) => e.message === message)
    ) {
      return this.refuseSessionChild('duplicate-report', childSessionId, {
        detail: 'an identical report from this session was delivered recently',
      });
    }

    const attrs = [
      `agent-id="${escapeAttribute(childSessionId)}"`,
      `agent="${escapeAttribute(child.label)}"`,
      `cli="ptah-session"`,
    ].join(' ');
    const envelope = `<agent-report ${attrs}>\n${reportBody(
      message,
      summary,
    )}\n</agent-report>`;
    try {
      await adapter.sendMessageToSession(parentSessionId, envelope, {
        origin: {
          kind: 'peer',
          from: `ptah-session:${childSessionId}`,
          name: `session · ${child.label}`,
        },
      });
    } catch (error: unknown) {
      return this.refuseSessionChild('delivery-failed', childSessionId, {
        parentSessionId,
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    this.remember(rateKey, { at: now, message });
    this.sessionChildren?.markReportDelivered(childSessionId);

    this.logger.info('[AgentReportRouter] Session child report delivered', {
      childSessionId,
      parentSessionId,
      length: message.length,
    });

    return { delivered: true, parentSessionId };
  }

  private refuseSessionChild(
    reason: AgentReportRefusalReason,
    childSessionId: string,
    context: Record<string, unknown> = {},
  ): AgentReportDelivery {
    this.logger.warn('[AgentReportRouter] Session child report refused', {
      reason,
      childSessionId,
      ...context,
    });
    return { delivered: false, reason };
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

  /** How many deliveries from this agent are still inside the burst window. */
  private recentDeliveryCount(agentId: string, now: number): number {
    const stamps = this.burstTimestamps.get(agentId);
    if (!stamps) return 0;
    const cutoff = now - AGENT_REPORT_BURST_WINDOW_MS;
    const live = stamps.filter((at) => at > cutoff);
    if (live.length === 0) {
      this.burstTimestamps.delete(agentId);
    } else if (live.length !== stamps.length) {
      this.burstTimestamps.set(agentId, live);
    }
    return live.length;
  }

  /** Recently delivered bodies from this agent, still inside the window. */
  private recentBodyEntries(
    agentId: string,
    now: number,
  ): readonly ReportHistoryEntry[] {
    const entries = this.recentBodies.get(agentId);
    if (!entries) return [];
    const cutoff = now - AGENT_REPORT_BURST_WINDOW_MS;
    const live = entries.filter((entry) => entry.at > cutoff);
    if (live.length === 0) {
      this.recentBodies.delete(agentId);
    } else if (live.length !== entries.length) {
      this.recentBodies.set(agentId, live);
    }
    return live;
  }

  private remember(agentId: string, entry: ReportHistoryEntry): void {
    const stamps = this.burstTimestamps.get(agentId) ?? [];
    stamps.push(entry.at);
    this.burstTimestamps.set(agentId, stamps);

    const entries = [...(this.recentBodies.get(agentId) ?? []), entry];
    // Bounded ring: the oldest bodies fall off, so one agent's history costs
    // at most AGENT_REPORT_HISTORY_SIZE bodies no matter how long it runs.
    this.recentBodies.set(
      agentId,
      entries.slice(Math.max(entries.length - AGENT_REPORT_HISTORY_SIZE, 0)),
    );
  }
}
