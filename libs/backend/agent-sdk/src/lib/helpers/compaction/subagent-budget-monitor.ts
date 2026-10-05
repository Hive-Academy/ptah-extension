/**
 * SubagentBudgetMonitor — hands a Task subagent off before it grows too large
 * (TASK_2026_597 A5, component 19; addendum component 10 parts 10.1 and 10.2).
 *
 * Fed with the subagent assistant messages the parent stream forwards (each
 * carries the spawning Task `parent_tool_use_id` and the request `usage`,
 * AS10), it keeps per subagent:
 *
 * - `contextTokens`: the last request's input + cache read + cache write.
 * - `weightedUsed`: the running cost-weighted total (input 1, cache read 0.1,
 *   output 5, cache write 1.25 for the 5-minute TTL and 2 for the 1-hour TTL).
 *   The TTL split comes from `usage.cache_creation` when the message carries
 *   it, else from the session's effective subagent prompt-cache TTL
 *   (`resolveSubagentPromptCacheTtl`, Batch 37).
 *
 * Stops, at most one per subagent:
 *
 * - Handoff: `contextTokens` at or above `compaction.subagentHandoffTokens`.
 * - Safety: `weightedUsed` at or above `compaction.subagentStopWeightedTokens`.
 *
 * Either one stops the subagent through `SubagentMessageDispatcher.stopSubagent`,
 * marks it not resumable in the registry, and pushes one parent message with
 * a ready handoff through `SubagentMessageDispatcher.pushParentMessage` (the
 * same per-session ordering lock and `origin` as a user steer). The handoff
 * restates the subagent's task, read from the `Agent`/`Task` `tool_use` input
 * of the message that spawned it. Starting the fresh subagent is left to the
 * parent model: the SDK gives the host no API to spawn a Task subagent itself.
 *
 * Off switch: with `compaction.enabled` false the monitor keeps counting (the
 * snapshot and the resume advice still work) but never stops a subagent.
 *
 * Failure: a subagent message without usage leaves the monitor observe-only
 * for it (one log line per session). A stop that fails is retried on the next
 * subagent request (a new API message id; the content-block messages of the
 * request that failed do not retry), at most {@link MAX_STOP_ATTEMPTS}
 * attempts in all, then given up with one log line; no handoff message is
 * sent for it. A stop still in flight when the session is released is neither
 * retried nor handed off.
 *
 * Rekey: after a PostCompact rekey the old id stays an alias of the new one
 * until either is released, so subagent messages still queued under the old
 * id add to the same state.
 */
import type {
  Logger,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import type {
  SubagentPromptCacheTtl,
  SubagentRecord,
} from '@ptah-extension/shared';
import type { CompactionConfigProvider } from '../compaction-config-provider';
import type { SubagentMessageDispatcher } from '../subagent-message-dispatcher';

/** Token usage of one model request, as the subagent message reports it. */
export interface SubagentRequestUsage {
  readonly inputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly outputTokens: number;
  /** TTL split of `cacheWriteTokens`; absent when the message has no `cache_creation`. */
  readonly cacheWriteByTtl?: Readonly<Record<SubagentPromptCacheTtl, number>>;
}

/** What the monitor knows about one subagent. */
export interface SubagentBudgetSnapshot {
  readonly contextTokens: number;
  readonly weightedUsed: number;
  /** The monitor stopped this subagent (handoff or safety stop). */
  readonly stopped: boolean;
  /** `weightedUsed` reached `compaction.subagentStopWeightedTokens`. */
  readonly budgetReached: boolean;
}

export type SubagentResumeAdvice = 'fresh' | 'resume';

export interface SubagentResumeAdviceInput {
  readonly stopped: boolean;
  readonly cacheState: 'warm' | 'cold';
  /** Last known context size; `undefined` when the monitor saw no usage. */
  readonly contextTokens: number | undefined;
  /** `compaction.subagentHandoffTokens`. */
  readonly handoffTokens: number;
  readonly budgetReached: boolean;
}

/**
 * Whether to resume a subagent or start a fresh one: `fresh` when it was
 * stopped, its prompt cache is cold, its context reached the handoff size, or
 * it reached its weighted budget; otherwise `resume`.
 */
export function adviseSubagentResume(
  input: SubagentResumeAdviceInput,
): SubagentResumeAdvice {
  if (input.stopped || input.budgetReached || input.cacheState === 'cold') {
    return 'fresh';
  }
  if (
    input.contextTokens !== undefined &&
    input.contextTokens >= input.handoffTokens
  ) {
    return 'fresh';
  }
  return 'resume';
}

const INPUT_WEIGHT = 1;
const CACHE_READ_WEIGHT = 0.1;
const OUTPUT_WEIGHT = 5;
const CACHE_WRITE_WEIGHT: Readonly<Record<SubagentPromptCacheTtl, number>> = {
  '5m': 1.25,
  '1h': 2,
};
/** TTL the SDK uses when nothing sets one (as `subagent-prompt-cache-ttl.ts`). */
const SDK_DEFAULT_TTL: SubagentPromptCacheTtl = '5m';
/** `stopSubagent` calls per subagent: the first one and two retries. */
export const MAX_STOP_ATTEMPTS = 3;
/** Tools that spawn a subagent (`Task` is the SDK's earlier name for `Agent`). */
const SUBAGENT_TOOL_NAMES: ReadonlySet<string> = new Set(['Agent', 'Task']);
/** Prompt characters the handoff restates; the full prompt is in the transcript. */
const TASK_PROMPT_EXCERPT_CHARS = 300;

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Read the request usage from a subagent assistant message (the SDK stream
 * message or a persisted transcript line: both carry `message.usage`).
 * Returns `undefined` when the message has no usable usage block.
 */
export function readSubagentRequestUsage(
  raw: unknown,
): SubagentRequestUsage | undefined {
  const usage = asObject(asObject(asObject(raw)?.['message'])?.['usage']);
  if (!usage) {
    return undefined;
  }
  const inputTokens = tokenCount(usage['input_tokens']);
  const outputTokens = tokenCount(usage['output_tokens']);
  if (inputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }
  const cacheReadTokens = tokenCount(usage['cache_read_input_tokens']) ?? 0;
  const cacheWriteTokens =
    tokenCount(usage['cache_creation_input_tokens']) ?? 0;
  const creation = asObject(usage['cache_creation']);
  const write5m = tokenCount(creation?.['ephemeral_5m_input_tokens']);
  const write1h = tokenCount(creation?.['ephemeral_1h_input_tokens']);
  return {
    inputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    ...(write5m !== undefined || write1h !== undefined
      ? { cacheWriteByTtl: { '5m': write5m ?? 0, '1h': write1h ?? 0 } }
      : {}),
  };
}

/** Context size of one request: input + cache read + cache write. */
export function requestContextTokens(usage: SubagentRequestUsage): number {
  return usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}

/** Cost-weighted size of one request; `fallbackTtl` prices cache writes without a TTL split. */
export function weightedRequestTokens(
  usage: SubagentRequestUsage,
  fallbackTtl: SubagentPromptCacheTtl,
): number {
  const cacheWrite = usage.cacheWriteByTtl
    ? usage.cacheWriteByTtl['5m'] * CACHE_WRITE_WEIGHT['5m'] +
      usage.cacheWriteByTtl['1h'] * CACHE_WRITE_WEIGHT['1h']
    : usage.cacheWriteTokens * CACHE_WRITE_WEIGHT[fallbackTtl];
  return (
    usage.inputTokens * INPUT_WEIGHT +
    usage.cacheReadTokens * CACHE_READ_WEIGHT +
    usage.outputTokens * OUTPUT_WEIGHT +
    cacheWrite
  );
}

/**
 * The task a spawning `Agent`/`Task` `tool_use` input describes: its
 * `description`, then the first {@link TASK_PROMPT_EXCERPT_CHARS} characters
 * of its `prompt`. `undefined` when the input carries neither.
 */
export function readSubagentTaskText(input: unknown): string | undefined {
  const fields = asObject(input);
  const rawDescription = fields?.['description'];
  const rawPrompt = fields?.['prompt'];
  const description =
    typeof rawDescription === 'string' ? rawDescription.trim() : '';
  const prompt = typeof rawPrompt === 'string' ? rawPrompt.trim() : '';
  const excerpt =
    prompt.length > TASK_PROMPT_EXCERPT_CHARS
      ? `${prompt.slice(0, TASK_PROMPT_EXCERPT_CHARS)}...`
      : prompt;
  if (description && excerpt) {
    return `${description}: ${excerpt}`;
  }
  return description || excerpt || undefined;
}

type StopReason = 'handoff' | 'safety';

interface SubagentState {
  contextTokens: number;
  weightedUsed: number;
  /** API message id of the last request counted, and its weighted share. */
  lastMessageId?: string;
  lastWeighted: number;
  /** Set when the stop succeeded or its attempts ran out: no further stop. */
  stopFired: boolean;
  /** A `stopSubagent` call is running; an overlapping message starts no other. */
  stopInFlight: boolean;
  /** `stopSubagent` calls that rejected. */
  stopFailures: number;
  /** API message id of the request whose stop attempt last rejected; its other blocks do not retry. */
  failedStopMessageId?: string;
  stopped: boolean;
  /** A stop could not start (no record or task id yet); logged once. */
  stopDeferredLogged: boolean;
}

interface SessionState {
  /** Current id of the session; moves on {@link SubagentBudgetMonitor.rekey}. */
  sessionId: string;
  readonly subagents: Map<string, SubagentState>;
  /** Task text per spawning `Agent`/`Task` tool_use id. */
  readonly taskTexts: Map<string, string>;
  noUsageLogged: boolean;
  stopDisabledLogged: boolean;
  /** Set when a rekey merged this record into another; a stop in flight follows it. */
  mergedInto?: SessionState;
}

/** The dispatcher operations the monitor uses. */
export type SubagentBudgetDispatcherPort = Pick<
  SubagentMessageDispatcher,
  'stopSubagent' | 'pushParentMessage'
>;

/**
 * A plain class built by a factory in `registerSdkServices`, not `useClass`:
 * `SessionLifecycleManager` injects this monitor, and the dispatcher depends
 * back on `SessionLifecycleManager`. The factory hands in a narrow dispatcher
 * port resolved on first use, which breaks that construction cycle.
 */
export class SubagentBudgetMonitor {
  private readonly sessions = new Map<string, SessionState>();
  /** Old id → new id, one entry per PostCompact rekey; cleared on release. */
  private readonly aliases = new Map<string, string>();

  constructor(
    private readonly logger: Logger,
    private readonly config: CompactionConfigProvider,
    private readonly dispatcher: SubagentBudgetDispatcherPort,
    private readonly registry: SubagentRegistryService,
  ) {}

  /**
   * Observe one forwarded stream message of `sessionId`. An assistant message
   * that spawns a subagent (an `Agent`/`Task` `tool_use`) records the task
   * text for the handoff. Only subagent assistant messages (a string
   * `parent_tool_use_id`) are counted. Resolves once any stop it triggered
   * has finished; never rejects.
   *
   * @param cacheTtl - The session's effective subagent prompt-cache TTL, used
   *   to price cache writes whose TTL split the message does not report.
   */
  async observe(
    sessionId: string,
    message: unknown,
    cacheTtl: SubagentPromptCacheTtl = SDK_DEFAULT_TTL,
  ): Promise<void> {
    const msg = asObject(message);
    if (msg?.['type'] !== 'assistant') {
      return;
    }
    this.recordTaskTexts(sessionId, msg);
    const toolCallId = msg['parent_tool_use_id'];
    if (typeof toolCallId !== 'string') {
      return;
    }
    const session = this.sessionState(sessionId);
    const usage = readSubagentRequestUsage(msg);
    if (!usage) {
      if (!session.noUsageLogged) {
        session.noUsageLogged = true;
        this.logger.info(
          '[SubagentBudgetMonitor] Subagent message without usage; observe-only for this session',
          { sessionId },
        );
      }
      return;
    }

    const state = this.subagentState(session, toolCallId);
    this.count(state, msg, usage, cacheTtl);
    if (state.stopFired || state.stopInFlight) {
      return;
    }
    if (
      state.failedStopMessageId !== undefined &&
      state.failedStopMessageId === state.lastMessageId
    ) {
      // Another content block of the request whose stop rejected: retry on the next request.
      return;
    }

    const { enabled, subagentHandoffTokens, subagentStopWeightedTokens } =
      this.config.getConfig();
    const reason: StopReason | undefined =
      state.contextTokens >= subagentHandoffTokens
        ? 'handoff'
        : state.weightedUsed >= subagentStopWeightedTokens
          ? 'safety'
          : undefined;
    if (!reason) {
      return;
    }
    if (!enabled) {
      if (!session.stopDisabledLogged) {
        session.stopDisabledLogged = true;
        this.logger.info(
          '[SubagentBudgetMonitor] Subagent over budget; not stopped because compaction.enabled is false',
          { sessionId, toolCallId, reason },
        );
      }
      return;
    }
    await this.stop(session, toolCallId, state, reason, {
      handoffTokens: subagentHandoffTokens,
      stopWeightedTokens: subagentStopWeightedTokens,
    });
  }

  /** What the monitor knows about a subagent, or `undefined` when it saw none of its usage. */
  getSnapshot(
    sessionId: string,
    toolCallId: string,
  ): SubagentBudgetSnapshot | undefined {
    const state = this.sessions.get(sessionId)?.subagents.get(toolCallId);
    if (!state) {
      return undefined;
    }
    return {
      contextTokens: state.contextTokens,
      weightedUsed: state.weightedUsed,
      stopped: state.stopped,
      budgetReached:
        state.weightedUsed >=
        this.config.getConfig().subagentStopWeightedTokens,
    };
  }

  /**
   * Move what the monitor knows about `fromSessionId` to `toSessionId` (a
   * PostCompact that reports a new session id). Subagents already seen under
   * `toSessionId` are kept unless `fromSessionId` holds the same one; then the
   * state with a stop in flight or done is kept. A stop in flight on either
   * record finishes on the merged record and hands off to the new id.
   */
  rekey(fromSessionId: string, toSessionId: string): void {
    if (!toSessionId || fromSessionId === toSessionId) {
      return;
    }
    // Messages still queued under the old id resolve to the new one. The new
    // id is current again, so an alias it had is dropped (no alias cycle).
    this.aliases.delete(toSessionId);
    this.aliases.set(fromSessionId, toSessionId);
    const session = this.sessions.get(fromSessionId);
    if (!session) {
      return;
    }
    this.sessions.delete(fromSessionId);
    const existing = this.sessions.get(toSessionId);
    if (existing) {
      for (const [toolCallId, state] of existing.subagents) {
        const kept = session.subagents.get(toolCallId);
        if (!kept || (!hasStopStarted(kept) && hasStopStarted(state))) {
          session.subagents.set(toolCallId, state);
        }
      }
      for (const [toolUseId, text] of existing.taskTexts) {
        if (!session.taskTexts.has(toolUseId)) {
          session.taskTexts.set(toolUseId, text);
        }
      }
      existing.mergedInto = session;
    }
    session.sessionId = toSessionId;
    this.sessions.set(toSessionId, session);
  }

  /**
   * The id `sessionId` lives on as after the rekeys seen so far: itself when
   * no rekey moved it, else the id at the end of its alias chain.
   */
  currentSessionId(sessionId: string): string {
    const chain = this.aliasChain(sessionId);
    return chain[chain.length - 1];
  }

  /**
   * Forget everything about `sessionId` (session end), including every alias
   * that resolves through it, so a later message under an old id starts no
   * state on the released record.
   */
  release(sessionId: string): void {
    const stale = [...this.aliases.keys()].filter((from) =>
      this.aliasChain(from).includes(sessionId),
    );
    for (const from of stale) {
      this.aliases.delete(from);
    }
    this.sessions.delete(sessionId);
  }

  /** `sessionId` followed by each id a rekey moved it to, in order. */
  private aliasChain(sessionId: string): string[] {
    const chain = [sessionId];
    let next = this.aliases.get(sessionId);
    // rekey() never forms a cycle; the bound only guards against one.
    while (next !== undefined && chain.length <= this.aliases.size) {
      chain.push(next);
      next = this.aliases.get(next);
    }
    return chain;
  }

  private sessionState(rawSessionId: string): SessionState {
    const sessionId = this.currentSessionId(rawSessionId);
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        sessionId,
        subagents: new Map(),
        taskTexts: new Map(),
        noUsageLogged: false,
        stopDisabledLogged: false,
      };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  /**
   * The record `session` lives on as: itself, or the record a rekey merged it
   * into. `undefined` once that record was released.
   */
  private liveSession(session: SessionState): SessionState | undefined {
    let current = session;
    while (current.mergedInto) {
      current = current.mergedInto;
    }
    return this.sessions.get(current.sessionId) === current
      ? current
      : undefined;
  }

  private subagentState(
    session: SessionState,
    toolCallId: string,
  ): SubagentState {
    let state = session.subagents.get(toolCallId);
    if (!state) {
      state = {
        contextTokens: 0,
        weightedUsed: 0,
        lastWeighted: 0,
        stopFired: false,
        stopInFlight: false,
        stopFailures: 0,
        stopped: false,
        stopDeferredLogged: false,
      };
      session.subagents.set(toolCallId, state);
    }
    return state;
  }

  /** Remember the task of every subagent this assistant message spawns. */
  private recordTaskTexts(sessionId: string, msg: JsonObject): void {
    const content = asObject(msg['message'])?.['content'];
    if (!Array.isArray(content)) {
      return;
    }
    for (const item of content) {
      const block = asObject(item);
      const id = block?.['id'];
      const name = block?.['name'];
      if (
        block?.['type'] !== 'tool_use' ||
        typeof id !== 'string' ||
        typeof name !== 'string' ||
        !SUBAGENT_TOOL_NAMES.has(name)
      ) {
        continue;
      }
      const text = readSubagentTaskText(block['input']);
      if (text) {
        this.sessionState(sessionId).taskTexts.set(id, text);
      }
    }
  }

  /**
   * Count one request. The SDK streams one assistant message per content
   * block with the same API message id and the request's usage repeated, so
   * a repeated id replaces the previous share instead of adding to it.
   */
  private count(
    state: SubagentState,
    msg: JsonObject,
    usage: SubagentRequestUsage,
    cacheTtl: SubagentPromptCacheTtl,
  ): void {
    const messageId = asObject(msg['message'])?.['id'];
    const weighted = weightedRequestTokens(usage, cacheTtl);
    const sameRequest =
      typeof messageId === 'string' && messageId === state.lastMessageId;
    state.weightedUsed += weighted - (sameRequest ? state.lastWeighted : 0);
    state.lastWeighted = weighted;
    state.lastMessageId = typeof messageId === 'string' ? messageId : undefined;
    state.contextTokens = requestContextTokens(usage);
  }

  private async stop(
    session: SessionState,
    toolCallId: string,
    state: SubagentState,
    reason: StopReason,
    limits: {
      readonly handoffTokens: number;
      readonly stopWeightedTokens: number;
    },
  ): Promise<void> {
    const record = this.registry.get(toolCallId);
    if (!record?.taskId) {
      // The task id arrives with the SDK's task_started message; the next
      // subagent message retries.
      if (!state.stopDeferredLogged) {
        state.stopDeferredLogged = true;
        this.logger.warn(
          '[SubagentBudgetMonitor] Subagent over budget but no task id yet; stop deferred',
          { sessionId: session.sessionId, toolCallId, reason },
        );
      }
      return;
    }

    state.stopInFlight = true;
    const attemptMessageId = state.lastMessageId;
    let stopFailure: { readonly errorType: string } | undefined;
    try {
      await this.dispatcher.stopSubagent(session.sessionId, record.taskId);
    } catch (error: unknown) {
      stopFailure = {
        errorType: error instanceof Error ? error.name : typeof error,
      };
    } finally {
      state.stopInFlight = false;
    }
    // Released while the stop ran: the session is over, so no retry and no handoff.
    const live = this.liveSession(session);
    if (!live) {
      return;
    }
    // A rekey merge may have replaced this subagent's state; finish on the kept one.
    const liveState = live.subagents.get(toolCallId) ?? state;
    if (liveState.stopFired) {
      // Another stop of this subagent already finished its bookkeeping.
      return;
    }
    const sessionId = live.sessionId;
    if (stopFailure) {
      this.onStopFailed(
        sessionId,
        toolCallId,
        liveState,
        reason,
        stopFailure,
        attemptMessageId,
      );
      return;
    }
    liveState.stopFired = true;
    liveState.stopped = true;
    // A completed record is dropped from the registry, so it is never offered for resume.
    this.registry.update(toolCallId, {
      status: 'completed',
      completedAt: Date.now(),
    });
    this.logger.info('[SubagentBudgetMonitor] Subagent stopped', {
      sessionId,
      toolCallId,
      reason,
      contextTokens: state.contextTokens,
      weightedUsed: Math.round(state.weightedUsed),
    });

    try {
      await this.dispatcher.pushParentMessage(
        sessionId,
        handoffMessage(
          record,
          state,
          reason,
          limits,
          live.taskTexts.get(toolCallId),
        ),
      );
    } catch (error: unknown) {
      this.logger.warn(
        '[SubagentBudgetMonitor] Handoff message not delivered to the parent',
        {
          sessionId,
          toolCallId,
          errorType: error instanceof Error ? error.name : typeof error,
        },
      );
    }
  }

  /**
   * Count a rejected stop; the next subagent request retries until the
   * attempts run out. Not counted while another stop of the same subagent is
   * in flight on `state` (two records merged by a rekey): that stop decides,
   * so a failure here cannot give up on a stop that then succeeds.
   */
  private onStopFailed(
    sessionId: string,
    toolCallId: string,
    state: SubagentState,
    reason: StopReason,
    failure: { readonly errorType: string },
    attemptMessageId: string | undefined,
  ): void {
    if (state.stopInFlight) {
      return;
    }
    state.stopFailures += 1;
    state.failedStopMessageId = attemptMessageId;
    if (state.stopFailures < MAX_STOP_ATTEMPTS) {
      this.logger.debug(
        '[SubagentBudgetMonitor] Stopping the subagent failed; retrying on its next message',
        { sessionId, toolCallId, reason, attempt: state.stopFailures },
      );
      return;
    }
    state.stopFired = true;
    this.logger.warn(
      '[SubagentBudgetMonitor] Stopping the subagent failed; giving up, no handoff sent',
      {
        sessionId,
        toolCallId,
        reason,
        attempts: state.stopFailures,
        ...failure,
      },
    );
  }
}

/** A stop of this subagent is running or has finished. */
function hasStopStarted(state: SubagentState): boolean {
  return state.stopInFlight || state.stopFired;
}

function handoffMessage(
  record: SubagentRecord,
  state: SubagentState,
  reason: StopReason,
  limits: {
    readonly handoffTokens: number;
    readonly stopWeightedTokens: number;
  },
  taskText: string | undefined,
): string {
  const name = record.teammateName
    ? `\`${record.agentType}\` ('${record.teammateName}')`
    : `\`${record.agentType}\``;
  const why =
    reason === 'handoff'
      ? `at ${state.contextTokens} context tokens (handoff size ${limits.handoffTokens})`
      : `after ${Math.round(state.weightedUsed)} weighted tokens (safety limit ${limits.stopWeightedTokens})`;
  const task = taskText ? ` Its task was: ${taskText}` : '';
  return (
    `Subagent ${name} was stopped ${why}. It cannot be resumed.${task} ` +
    `If its task is not finished, start a fresh \`${record.agentType}\` subagent with a handoff: ` +
    `restate its task and what remains; its output so far is in the session transcript.`
  );
}
