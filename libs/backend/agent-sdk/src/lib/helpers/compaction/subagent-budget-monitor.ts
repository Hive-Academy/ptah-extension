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
 * Before the stop, the handoff text is built and written once to a handoff
 * record ({@link SubagentHandoffRecords}): `.ptah/subagent-handoffs/` in the
 * session workspace, `status: pending` until the parent resolves it. A
 * handoff stop runs only after its record is on disk; a failed write leaves
 * the subagent running and is retried on its next request, at most
 * {@link MAX_RECORD_ATTEMPTS} writes, after which only the safety stop
 * applies. A safety stop does not wait for its record (see the class
 * comment).
 *
 * Then the subagent is stopped through `SubagentMessageDispatcher.stopSubagent`.
 * Once that call was made with a record, the record is never deleted (a
 * rejected stop may still have ended the subagent) and the record index
 * ({@link SubagentHandoffIndex}) names it on every main-thread prompt until
 * it is resolved ({@link SubagentBudgetMonitor.handoffPointer}). A stop that
 * will not run (the session was released, or another stop of the subagent
 * finished first) withdraws its record. After a successful stop the subagent
 * is marked not resumable in the registry when it has a record there, and the
 * parent gets the handoff message once, best effort:
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
 * is retried, then posted once to the notice queue. The durable copy is the
 * record; a best-effort stub in the task folder the spawning prompt names
 * points to it.
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
 * for it (one log line per session). A failed record write (handoff stop) or
 * a rejected stop is retried on the next subagent request (a new API message
 * id; the content-block messages of the request that failed do not retry).
 * Stops are given up after {@link MAX_STOP_ATTEMPTS} attempts with one log
 * line; the record is kept and no handoff message is sent. A stop retry
 * reuses the prepared handoff and its record. A stop still in flight when the
 * session is released is neither retried nor handed off.
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
import type { SubagentBudgetStopCallbackRegistry } from '../subagent-budget-stop-callback-registry';
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
  stopNotice,
  type HandoffSubject,
  type HandoffUsage,
  type StopReason,
} from './subagent-handoff-message';
import {
  SubagentHandoffDelivery,
  type Handoff,
  type HandoffDeliveryPort,
} from './subagent-handoff-delivery';
import {
  ownerHash,
  type SubagentHandoffRecords,
} from './subagent-handoff-record';
import type { SubagentHandoffIndex } from './subagent-handoff-index';
import { SubagentStopNotices } from './subagent-stop-notices';

/** The handoff file operations the monitor uses. */
export type SubagentHandoffFilesPort = Pick<
  SubagentHandoffFiles,
  'paths' | 'saveTask' | 'notesExist'
>;

/** The handoff record operations the monitor uses. */
export type SubagentHandoffRecordsPort = Pick<
  SubagentHandoffRecords,
  | 'workspaceOf'
  | 'writeOnce'
  | 'markInvoked'
  | 'withdraw'
  | 'forget'
  | 'writeStub'
>;

/** The handoff record index operations the monitor uses. */
export type SubagentHandoffIndexPort = Pick<
  SubagentHandoffIndex,
  'publish' | 'forgetCursor' | 'pointerFor'
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
/** Handoff record writes per subagent before the handoff stop is given up. */
export const MAX_RECORD_ATTEMPTS = 3;
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
  /** API message id of the request whose stop or record write last failed; its other blocks do not retry. */
  failedAttemptMessageId?: string;
  /** Handoff records that could not be saved for a handoff stop. */
  recordFailures: number;
  /** {@link MAX_RECORD_ATTEMPTS} record writes failed: no handoff stop, only the safety stop. */
  recordGaveUp: boolean;
  /** The handoff built for a stop that was invoked; a stop retry reuses it (no second write). */
  prepared?: PreparedHandoff;
  stopped: boolean;
  /** A stop could not start (no task id from `task_started` or the registry yet); logged once. */
  stopDeferredLogged: boolean;
  /** The handoff waiting in the notice queue for the spawning tool result. */
  pendingNotice?: { readonly sessionId: string; readonly handoff: Handoff };
  /** SDK agent id the near-budget warning was posted for; set at most once. */
  warnedAgentId?: string;
  /** Handoff paths the warning named; the stop names the same ones. */
  handoffPaths?: SubagentHandoffPaths;
}

/** A handoff record on disk. */
interface SavedRecord {
  readonly path: string;
  readonly workspace: string;
  readonly name: string;
}

/** The handoff of a stop and its record (absent: a safety stop whose write failed). */
interface PreparedHandoff {
  readonly record?: SavedRecord;
  readonly handoff: Handoff;
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
 *
 * Safety-stop limit (user decision B2): A safety (cost) stop does not wait
 * for a durable record: when its record write fails, the handoff travels only
 * through the in-memory send, so it is lost only if both the disk write and
 * that send fail.
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
    private readonly records: SubagentHandoffRecordsPort,
    private readonly index: SubagentHandoffIndexPort,
    private readonly budgetStopCallbacks: SubagentBudgetStopCallbackRegistry,
    private readonly stopNotices: SubagentStopNotices,
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
      state.failedAttemptMessageId !== undefined &&
      state.failedAttemptMessageId === state.lastMessageId
    ) {
      // Another content block of the request whose stop or record write
      // failed: retry on the next request.
      return;
    }

    const { enabled, subagentHandoffTokens, subagentStopWeightedTokens } =
      this.config.getConfig();
    const reason: StopReason | undefined =
      state.contextTokens >= subagentHandoffTokens && !state.recordGaveUp
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
    this.records.forget(new Set([...stale, sessionId]));
    for (const id of [...stale, sessionId]) this.stopNotices.forgetSession(id);
    this.index.forgetCursor(ownerHash(sessionId));
  }

  /**
   * The pending-handoff pointer for a main-thread prompt of `sessionId`, or
   * `undefined` when none is pending. Records owned by the session (its id
   * or an alias that resolves to it) are listed plainly; records of another
   * live session of this process are hidden; any other owner's records (an
   * ended session, or another process) carry takeover text. The workspace is
   * the session's, else `hookCwd`. Never rejects.
   */
  async handoffPointer(
    sessionId: string,
    hookCwd: string | undefined,
  ): Promise<string | undefined> {
    const current = this.currentSessionId(sessionId);
    const workspace = this.records.workspaceOf(current) ?? hookCwd;
    if (!workspace) {
      return undefined;
    }
    const hidden = new Set<string>();
    for (const id of this.sessions.keys()) {
      if (id !== current) {
        for (const alias of this.idsOf(id)) {
          hidden.add(ownerHash(alias));
        }
      }
    }
    return this.index.pointerFor(workspace, {
      own: new Set(this.idsOf(current).map(ownerHash)),
      hidden,
      cursorKey: ownerHash(current),
    });
  }

  /** `sessionId` and every old id that resolves to it. */
  private idsOf(sessionId: string): string[] {
    return [
      sessionId,
      ...[...this.aliases.keys()].filter(
        (from) => this.currentSessionId(from) === sessionId,
      ),
    ];
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
        recordFailures: 0,
        recordGaveUp: false,
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
          pending.handoff.text,
        )
      ) {
        await this.delivery.send(session.sessionId, id, pending.handoff);
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

  /**
   * Stop one subagent: prepare its handoff and record, stop it, then hand
   * the parent the handoff. Steps, in order: progress files and the full
   * prompt ({@link prepareHandoffFiles}), the handoff text, the record write
   * (a handoff stop without a record stops nothing and waits for the next
   * request), `stopSubagent`, publishing the record to the index, delivery,
   * and the task-folder stub. A stop retry reuses the prepared handoff.
   */
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
    const registryRecord = this.registry.get(toolCallId);
    const started = session.startedTasks.get(toolCallId);
    const taskId = started?.taskId ?? registryRecord?.taskId;
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

    // Set over the preparation too: an overlapping message starts no other stop.
    state.stopInFlight = true;
    const attemptMessageId = state.lastMessageId;
    let prepared: PreparedHandoff | undefined;
    try {
      prepared =
        state.prepared ??
        (await this.prepareHandoff(
          session,
          toolCallId,
          state,
          reason,
          limits,
          {
            agentType:
              registryRecord?.agentType ?? started?.subagentType ?? 'subagent',
            teammateName: registryRecord?.teammateName,
            taskId,
          },
          attemptMessageId,
        ));
    } finally {
      if (!prepared) {
        state.stopInFlight = false;
      }
    }
    if (!prepared) {
      return;
    }

    // Released while the handoff was prepared, or another stop of this
    // subagent finished first: this stop does not run.
    const live = this.liveSession(session);
    const preparedState = live?.subagents.get(toolCallId) ?? state;
    if (!live || preparedState.stopFired) {
      state.stopInFlight = false;
      if (prepared.record) {
        await this.records.withdraw(toolCallId, prepared.record.path);
      }
      return;
    }
    preparedState.prepared = prepared;
    if (prepared.record) {
      this.records.markInvoked(toolCallId);
    }

    let stopFailure: { readonly errorType: string } | undefined;
    this.stopNotices.record(
      live.sessionId,
      taskId,
      stopNotice(prepared.handoff.subject, {
        reason,
        contextTokens: preparedState.contextTokens,
        weightedUsed: preparedState.weightedUsed,
        handoffTokens: limits.handoffTokens,
        stopWeightedTokens: limits.stopWeightedTokens,
      }),
    );
    try {
      await this.dispatcher.stopSubagent(live.sessionId, taskId);
    } catch (error: unknown) {
      stopFailure = {
        errorType: error instanceof Error ? error.name : typeof error,
      };
    } finally {
      state.stopInFlight = false;
    }
    // The stop may have ended the subagent even when it rejected: from here
    // on the record is kept and named on main-thread prompts.
    if (prepared.record) {
      this.index.publish(prepared.record.workspace, prepared.record.name);
    }

    // Released while the stop ran: the session is over, so no retry and no handoff.
    const current = this.liveSession(session);
    if (!current) {
      return;
    }
    // A rekey merge may have replaced this subagent's state; finish on the kept one.
    const liveState = current.subagents.get(toolCallId) ?? state;
    if (liveState.stopFired) {
      // Another stop of this subagent already finished its bookkeeping.
      return;
    }
    const sessionId = current.sessionId;
    if (stopFailure) {
      this.onStopFailed(
        sessionId,
        toolCallId,
        liveState,
        reason,
        stopFailure,
        attemptMessageId,
        prepared.record !== undefined,
      );
      return;
    }
    liveState.stopFired = true;
    liveState.stopped = true;
    // The signal means Ptah stopped this subagent. A safety stop whose record
    // was not saved still publishes; only a missing agent id cannot.
    if (registryRecord?.agentId) {
      this.budgetStopCallbacks?.notifyAll({
        agentId: registryRecord.agentId,
        parentSessionId: sessionId,
        timestamp: Date.now(),
      });
    } else {
      this.logger.warn(
        '[SubagentBudgetMonitor] Budget stop succeeded without an agent id; signal not published',
        { sessionId, toolCallId },
      );
    }
    // A completed record is dropped from the registry, so it is never offered for resume.
    if (registryRecord) {
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
    await this.deliverHandoff(current, toolCallId, liveState, prepared.handoff);
    const prompt = current.tasks.get(toolCallId)?.prompt;
    if (prepared.record && prompt) {
      await this.records.writeStub(
        prompt,
        prepared.handoff.subject.agentType,
        prepared.record.path,
      );
    }
  }

  /**
   * Build the handoff of a stop and write its record. `undefined` when the
   * stop does not run now: the session was released, or a handoff stop's
   * record was not saved (counted; the next request retries). A safety stop
   * whose record was not saved goes on without one.
   */
  private async prepareHandoff(
    session: SessionState,
    toolCallId: string,
    state: SubagentState,
    reason: StopReason,
    limits: {
      readonly handoffTokens: number;
      readonly stopWeightedTokens: number;
    },
    who: Omit<HandoffSubject, 'outputFile'>,
    attemptMessageId: string | undefined,
  ): Promise<PreparedHandoff | undefined> {
    const files = await prepareHandoffFiles(
      this.handoffFiles,
      state.handoffPaths ??
        this.handoffFiles.paths(session.sessionId, toolCallId),
      session.tasks.get(toolCallId)?.prompt,
    );
    if (files.unavailable) {
      this.logger.warn(
        '[SubagentBudgetMonitor] Handoff files not ready in time; handing off without them',
        { sessionId: session.sessionId, toolCallId },
      );
    }
    // Released while the files were written: the session is over.
    const live = this.liveSession(session);
    if (!live) {
      return undefined;
    }
    // Read after the wait: a background tool result may have named the output file.
    const task = live.tasks.get(toolCallId);
    const subject: HandoffSubject = {
      ...who,
      teammateName: who.teammateName ?? task?.name,
      outputFile: task?.outputFile,
    };
    const usage: HandoffUsage = {
      reason,
      contextTokens: state.contextTokens,
      weightedUsed: state.weightedUsed,
      handoffTokens: limits.handoffTokens,
      stopWeightedTokens: limits.stopWeightedTokens,
    };
    const recordText = handoffMessage(subject, usage, task?.text, files);
    const write = await this.records.writeOnce(
      live.sessionId,
      toolCallId,
      recordText,
    );
    if (write.ok) {
      return {
        record: {
          path: write.path,
          workspace: write.workspace,
          name: write.name,
        },
        handoff: {
          text: handoffMessage(subject, usage, task?.text, files, write.path),
          subject,
          recordPath: write.path,
        },
      };
    }
    const current = this.liveSession(live);
    if (reason === 'handoff') {
      if (current) {
        this.onRecordFailed(
          current.sessionId,
          toolCallId,
          current.subagents.get(toolCallId) ?? state,
          write,
          attemptMessageId,
        );
      }
      return undefined;
    }
    this.logger.warn(
      '[SubagentBudgetMonitor] Safety stop without a durable record',
      {
        sessionId: current?.sessionId ?? live.sessionId,
        toolCallId,
        errorType: write.errorType,
        errorCode: write.errorCode,
      },
    );
    return { handoff: { text: recordText, subject } };
  }

  /**
   * A handoff stop's record was not saved: the subagent keeps running and
   * the next request retries, until {@link MAX_RECORD_ATTEMPTS} writes failed;
   * then only the safety stop applies.
   */
  private onRecordFailed(
    sessionId: string,
    toolCallId: string,
    state: SubagentState,
    failure: { readonly errorType: string; readonly errorCode?: string },
    attemptMessageId: string | undefined,
  ): void {
    state.recordFailures += 1;
    state.failedAttemptMessageId = attemptMessageId;
    if (state.recordFailures < MAX_RECORD_ATTEMPTS) {
      this.logger.debug(
        '[SubagentBudgetMonitor] Handoff record not saved; the handoff stop waits for the next subagent request',
        { sessionId, toolCallId, attempt: state.recordFailures },
      );
      return;
    }
    state.recordGaveUp = true;
    this.logger.warn(
      '[SubagentBudgetMonitor] Handoff record not saved after 3 attempts; subagent left running, no handoff',
      {
        sessionId,
        toolCallId,
        attempts: state.recordFailures,
        errorType: failure.errorType,
        errorCode: failure.errorCode,
      },
    );
  }

  /**
   * Hand the parent the handoff once: as a user turn when the spawning tool
   * result already returned, else through the notice queue.
   */
  private async deliverHandoff(
    live: SessionState,
    toolCallId: string,
    stoppedState: SubagentState,
    handoff: Handoff,
  ): Promise<void> {
    const sessionId = live.sessionId;
    if (live.spawnReturned.get(toolCallId) === true) {
      // Background subagent: its tool result already came back, so no
      // main-thread tool result is due to carry a queued notice.
      await this.delivery.send(sessionId, toolCallId, handoff);
      return;
    }
    // Foreground subagent: the handoff rides on its own tool result.
    const liveState = live.subagents.get(toolCallId) ?? stoppedState;
    liveState.pendingNotice = { sessionId, handoff };
    this.delivery.post(sessionId, toolCallId, handoff);
  }

  /**
   * Count a rejected stop; the next subagent request retries until the
   * attempts run out. Not counted while another stop of the same subagent is
   * in flight on `state` (two records merged by a rekey): that stop decides,
   * so a failure here cannot give up on a stop that then succeeds. A record
   * the stop was invoked with is kept either way.
   */
  private onStopFailed(
    sessionId: string,
    toolCallId: string,
    state: SubagentState,
    reason: StopReason,
    failure: { readonly errorType: string },
    attemptMessageId: string | undefined,
    recordKept: boolean,
  ): void {
    if (state.stopInFlight) {
      return;
    }
    state.stopFailures += 1;
    state.failedAttemptMessageId = attemptMessageId;
    if (state.stopFailures < MAX_STOP_ATTEMPTS) {
      this.logger.debug(
        '[SubagentBudgetMonitor] Stopping the subagent failed; retrying on its next message',
        { sessionId, toolCallId, reason, attempt: state.stopFailures },
      );
      return;
    }
    state.stopFired = true;
    this.logger.warn(
      recordKept
        ? '[SubagentBudgetMonitor] Stopping the subagent failed; giving up, record kept'
        : '[SubagentBudgetMonitor] Stopping the subagent failed; giving up, no handoff sent',
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
