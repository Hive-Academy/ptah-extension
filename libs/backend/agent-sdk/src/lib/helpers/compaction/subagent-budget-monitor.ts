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
 * Near-budget warning, at most one per subagent: at {@link NEAR_BUDGET_RATIO}
 * of `compaction.subagentHandoffTokens` the subagent is asked to write its
 * progress notes to its handoff notes file. The notice rides on the
 * subagent's own next tool result (`SubagentNoticeQueue`, keyed by the SDK
 * agent id of its registry record), never the main thread's.
 *
 * Stops, at most one per subagent:
 *
 * - Handoff: `contextTokens` at or above `compaction.subagentHandoffTokens`.
 * - Safety: `weightedUsed` at or above `compaction.subagentStopWeightedTokens`.
 *
 * Either one stops the subagent through `SubagentMessageDispatcher.stopSubagent`,
 * marks it not resumable in the registry when it has a record there, and
 * hands the parent one message with a ready handoff, exactly once:
 *
 * - Foreground subagent (its spawning `Agent`/`Task` tool result has not come
 *   back): the handoff is posted to the main-thread notice queue and rides on
 *   that tool result, drained by the PostToolUse hook. When the tool result
 *   then reaches the stream with the notice still pending (no PostToolUse
 *   drained it), the notice is withdrawn and sent as a user turn instead;
 *   so is a notice the queue drops undelivered (past its bound, or cleared).
 * - Background subagent (its tool result came back at spawn, "Async agent
 *   launched"): no later main-thread tool result is due, and the session
 *   budget clears pending notices at turn end, so the handoff is streamed to
 *   the parent as a host-authored user turn (`pushParentMessage`).
 *
 * Both routes go through {@link SubagentHandoffDelivery}: a failed user turn
 * is retried, then kept pending in the notice queue.
 *
 * The handoff names Ptah's subagent budget monitor as the one that stopped
 * the subagent: the SDK's own task notification calls it "stopped by user".
 * It restates the subagent's task, read from the `Agent`/`Task` `tool_use`
 * input of the message that spawned it, and gives what a fresh subagent of
 * the same type and name needs ({@link SubagentHandoffFiles}): the full task
 * prompt saved to a file at the stop, the progress notes file (or that it is
 * missing or unavailable), and the stopped task's output file (named by a
 * background spawn's tool result, else the task id whose task notification
 * names it). File preparation is time-bounded. Starting the
 * fresh subagent is left to the parent model: the SDK gives the host no API
 * to spawn a Task subagent itself.
 *
 * Task id: `stopSubagent` needs the SDK task id. It comes from the SDK's
 * `task_started` message ({@link SubagentBudgetMonitor.recordTaskStarted}),
 * else from the registry record of the subagent. With neither, the stop is
 * deferred to the next subagent message (one log line per subagent).
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
import type { SubagentPromptCacheTtl } from '@ptah-extension/shared';
import type { CompactionConfigProvider } from '../compaction-config-provider';
import type { SubagentMessageDispatcher } from '../subagent-message-dispatcher';
import {
  prepareHandoffFiles,
  type SubagentHandoffFiles,
  type SubagentHandoffPaths,
} from './subagent-handoff-files';
import {
  handoffMessage,
  nearBudgetWarning,
  type StopReason,
} from './subagent-handoff-message';
import {
  SubagentHandoffDelivery,
  type HandoffDeliveryPort,
} from './subagent-handoff-delivery';

/** The handoff file operations the monitor uses. */
export type SubagentHandoffFilesPort = Pick<
  SubagentHandoffFiles,
  'paths' | 'saveTask' | 'notesExist'
>;

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
/** Share of `compaction.subagentHandoffTokens` at which a subagent is asked to write its notes. */
export const NEAR_BUDGET_RATIO = 0.85;
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
  /** A stop could not start (no task id from `task_started` or the registry yet); logged once. */
  stopDeferredLogged: boolean;
  /** The handoff waiting in the notice queue for the spawning tool result. */
  pendingNotice?: { readonly sessionId: string; readonly text: string };
  /** SDK agent id the near-budget warning was posted for; set at most once. */
  warnedAgentId?: string;
  /** Handoff paths the warning named; the stop names the same ones. */
  handoffPaths?: SubagentHandoffPaths;
}

/** What the SDK's `task_started` message reported for one spawning tool_use. */
interface StartedTask {
  readonly taskId: string;
  readonly subagentType?: string;
}

/** What a spawning `Agent`/`Task` tool_use input says about its subagent. */
interface SpawnTask {
  /** Description and prompt excerpt ({@link readSubagentTaskText}). */
  readonly text?: string;
  /** The full prompt, saved to the task file at a stop. */
  readonly prompt?: string;
  /** The `name` input: the teammate name a fresh subagent reuses. */
  readonly name?: string;
  /** The `output_file:` its spawning tool result named (background subagent). */
  readonly outputFile?: string;
}

interface SessionState {
  /** Current id of the session; moves on {@link SubagentBudgetMonitor.rekey}. */
  sessionId: string;
  readonly subagents: Map<string, SubagentState>;
  /** Task per spawning `Agent`/`Task` tool_use id. */
  readonly tasks: Map<string, SpawnTask>;
  /** SDK task per spawning tool_use id, from `task_started`. */
  readonly startedTasks: Map<string, StartedTask>;
  /**
   * Per spawning tool_use id (an `Agent`/`Task` tool_use or a `task_started`):
   * whether its tool result has reached the main thread.
   */
  readonly spawnReturned: Map<string, boolean>;
  noUsageLogged: boolean;
  stopDisabledLogged: boolean;
  /** Set when a rekey merged this record into another; a stop in flight follows it. */
  mergedInto?: SessionState;
}

/**
 * The dispatcher and main-thread notice queue operations the monitor uses.
 * `pushParentMessage` streams a user turn; the two main-thread notice
 * operations bind to `MainThreadNoticeQueue.post` and `.withdraw`.
 */
export interface SubagentBudgetDispatcherPort
  extends Pick<SubagentMessageDispatcher, 'stopSubagent'>, HandoffDeliveryPort {
  /** Take back a queued notice; `true` when it was still pending. */
  withdrawMainThreadNotice(sessionId: string, text: string): boolean;
  /** Queue a notice for the subagent's own next tool result (`SubagentNoticeQueue`). */
  postSubagentNotice(agentId: string, text: string): void;
  /** Drop the subagent's pending notice. */
  withdrawSubagentNotice(agentId: string): void;
}

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
  private readonly delivery: SubagentHandoffDelivery;

  constructor(
    private readonly logger: Logger,
    private readonly config: CompactionConfigProvider,
    private readonly dispatcher: SubagentBudgetDispatcherPort,
    private readonly registry: SubagentRegistryService,
    private readonly handoffFiles: SubagentHandoffFilesPort,
  ) {
    this.delivery = new SubagentHandoffDelivery(logger, dispatcher, (id) => {
      const current = this.currentSessionId(id);
      return this.sessions.has(current) ? current : undefined;
    });
  }

  /**
   * Observe one forwarded stream message of `sessionId`. An assistant message
   * that spawns a subagent (an `Agent`/`Task` `tool_use`) records the task
   * text for the handoff. A main-thread user message with `tool_result`
   * blocks marks the spawning calls it answers as returned, and delivers a
   * handoff still waiting in the notice queue for such a result. Only
   * subagent assistant messages (a string `parent_tool_use_id`) are counted.
   * Resolves once any stop or delivery it triggered has finished; never
   * rejects.
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
    if (
      msg?.['type'] === 'user' &&
      typeof msg['parent_tool_use_id'] !== 'string'
    ) {
      await this.recordToolResults(sessionId, msg);
      return;
    }
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
      if (enabled) {
        this.warnNearBudget(session, toolCallId, state, subagentHandoffTokens);
      }
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

  /**
   * At {@link NEAR_BUDGET_RATIO} of the handoff size, ask the subagent once to
   * write its progress notes to its handoff notes file. The notice goes to
   * the subagent's own next tool result, keyed by its SDK agent id from the
   * registry record (`SubagentStart` hook). Without that id or a workspace it
   * is retried on the next subagent message.
   */
  private warnNearBudget(
    session: SessionState,
    toolCallId: string,
    state: SubagentState,
    handoffTokens: number,
  ): void {
    if (
      state.warnedAgentId !== undefined ||
      state.contextTokens < handoffTokens * NEAR_BUDGET_RATIO
    ) {
      return;
    }
    const agentId = this.registry.get(toolCallId)?.agentId;
    const paths = this.handoffFiles.paths(session.sessionId, toolCallId);
    if (!agentId || !paths) {
      return;
    }
    state.warnedAgentId = agentId;
    state.handoffPaths = paths;
    this.dispatcher.postSubagentNotice(
      agentId,
      nearBudgetWarning(state.contextTokens, handoffTokens, paths.notes),
    );
    this.logger.info('[SubagentBudgetMonitor] Near-budget warning queued', {
      sessionId: session.sessionId,
      toolCallId,
      contextTokens: state.contextTokens,
    });
  }

  /**
   * Remember the SDK task id the `task_started` message reports for the
   * subagent spawned by `toolUseId`, so a stop does not wait for the registry.
   * Tasks that spawn no subagent (bash, workflow) are recorded too; their
   * tool_use id never parents a subagent message, so they never stop anything.
   * A blank id is ignored.
   */
  recordTaskStarted(
    sessionId: string,
    toolUseId: string,
    taskId: string,
    subagentType?: string,
  ): void {
    if (!sessionId || !toolUseId || !taskId) {
      return;
    }
    const session = this.sessionState(sessionId);
    session.startedTasks.set(toolUseId, {
      taskId,
      subagentType: subagentType || undefined,
    });
    trackSpawn(session, toolUseId);
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
      for (const [toolUseId, task] of existing.tasks) {
        if (!session.tasks.has(toolUseId)) {
          session.tasks.set(toolUseId, task);
        }
      }
      for (const [toolUseId, started] of existing.startedTasks) {
        if (!session.startedTasks.has(toolUseId)) {
          session.startedTasks.set(toolUseId, started);
        }
      }
      for (const [toolUseId, returned] of existing.spawnReturned) {
        if (returned || !session.spawnReturned.has(toolUseId)) {
          session.spawnReturned.set(toolUseId, returned);
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
    // A near-budget warning no tool result drained ends with the session.
    for (const state of this.sessions.get(sessionId)?.subagents.values() ??
      []) {
      if (state.warnedAgentId) {
        this.dispatcher.withdrawSubagentNotice(state.warnedAgentId);
      }
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
        tasks: new Map(),
        startedTasks: new Map(),
        spawnReturned: new Map(),
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
      const session = this.sessionState(sessionId);
      trackSpawn(session, id);
      const input = asObject(block['input']);
      const prompt = input?.['prompt'];
      const teammate = input?.['name'];
      session.tasks.set(id, {
        text: readSubagentTaskText(input),
        prompt:
          typeof prompt === 'string' && prompt.trim() ? prompt : undefined,
        name:
          typeof teammate === 'string' && teammate.trim()
            ? teammate.trim()
            : undefined,
      });
    }
  }

  /**
   * Mark each spawning call this main-thread user message answers with a
   * `tool_result` as returned. A handoff still pending in the notice queue
   * for one of them was not drained by its PostToolUse, so it is withdrawn
   * and streamed as a user turn instead (never both).
   */
  private async recordToolResults(
    sessionId: string,
    msg: JsonObject,
  ): Promise<void> {
    const content = asObject(msg['message'])?.['content'];
    if (!Array.isArray(content)) {
      return;
    }
    const session = this.sessions.get(this.currentSessionId(sessionId));
    if (!session) {
      return;
    }
    for (const item of content) {
      const block = asObject(item);
      const id = block?.['tool_use_id'];
      if (
        block?.['type'] !== 'tool_result' ||
        typeof id !== 'string' ||
        !session.spawnReturned.has(id)
      ) {
        continue;
      }
      session.spawnReturned.set(id, true);
      const outputFile = readOutputFile(block['content']);
      if (outputFile) {
        session.tasks.set(id, { ...session.tasks.get(id), outputFile });
      }
      const state = session.subagents.get(id);
      const pending = state?.pendingNotice;
      if (!state || !pending) {
        continue;
      }
      state.pendingNotice = undefined;
      if (
        this.dispatcher.withdrawMainThreadNotice(
          pending.sessionId,
          pending.text,
        )
      ) {
        await this.delivery.send(session.sessionId, id, pending.text);
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
    const started = session.startedTasks.get(toolCallId);
    const taskId = started?.taskId ?? record?.taskId;
    if (!taskId) {
      // Neither task_started nor the registry has the task id yet; the next
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
      await this.dispatcher.stopSubagent(session.sessionId, taskId);
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
    if (record) {
      this.registry.update(toolCallId, {
        status: 'completed',
        completedAt: Date.now(),
      });
    }
    this.logger.info('[SubagentBudgetMonitor] Subagent stopped', {
      sessionId,
      toolCallId,
      reason,
      contextTokens: state.contextTokens,
      weightedUsed: Math.round(state.weightedUsed),
    });

    if (liveState.warnedAgentId) {
      // A warning the stopped subagent never received is moot now.
      this.dispatcher.withdrawSubagentNotice(liveState.warnedAgentId);
    }
    const files = await prepareHandoffFiles(
      this.handoffFiles,
      liveState.handoffPaths ?? this.handoffFiles.paths(sessionId, toolCallId),
      live.tasks.get(toolCallId)?.prompt,
    );
    if (files.unavailable) {
      this.logger.warn(
        '[SubagentBudgetMonitor] Handoff files not ready in time; handing off without them',
        { sessionId, toolCallId },
      );
    }
    // Released while the files were written: the session is over.
    const current = this.liveSession(live);
    if (!current) {
      return;
    }
    // Read after the wait: a background tool result may have named the output file.
    const task = current.tasks.get(toolCallId);
    const text = handoffMessage(
      {
        agentType: record?.agentType ?? started?.subagentType ?? 'subagent',
        teammateName: record?.teammateName ?? task?.name,
        taskId,
        outputFile: task?.outputFile,
      },
      {
        reason,
        contextTokens: state.contextTokens,
        weightedUsed: state.weightedUsed,
        handoffTokens: limits.handoffTokens,
        stopWeightedTokens: limits.stopWeightedTokens,
      },
      task?.text,
      files,
    );
    await this.deliverHandoff(current, toolCallId, liveState, text);
  }

  /**
   * Hand the parent the handoff once: as a user turn when the spawning tool
   * result already returned, else through the notice queue.
   */
  private async deliverHandoff(
    live: SessionState,
    toolCallId: string,
    stoppedState: SubagentState,
    text: string,
  ): Promise<void> {
    const sessionId = live.sessionId;
    if (live.spawnReturned.get(toolCallId) === true) {
      // Background subagent: its tool result already came back, so no
      // main-thread tool result is due to carry a queued notice.
      await this.delivery.send(sessionId, toolCallId, text);
      return;
    }
    // Foreground subagent: the handoff rides on its own tool result.
    const liveState = live.subagents.get(toolCallId) ?? stoppedState;
    liveState.pendingNotice = { sessionId, text };
    this.delivery.post(sessionId, toolCallId, text);
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

/** The `output_file:` line of a spawning tool result (string or text blocks), if any. */
function readOutputFile(content: unknown): string | undefined {
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((block) => asObject(block)?.['text'] ?? '').join('\n')
        : '';
  return text.match(/output_file:[ \t]*(\S[^\n]*?)[ \t]*(?:\n|$)/i)?.[1];
}

/** Track `toolUseId` as a call that may spawn a subagent; a known result stays known. */
function trackSpawn(session: SessionState, toolUseId: string): void {
  if (!session.spawnReturned.has(toolUseId)) {
    session.spawnReturned.set(toolUseId, false);
  }
}

/** A stop of this subagent is running or has finished. */
function hasStopStarted(state: SubagentState): boolean {
  return state.stopInFlight || state.stopFired;
}
