/**
 * LaneRunnerService — the ONE place a background LLM call is allowed to happen.
 *
 * `LaneResolverService` answers "where do I run"; this answers "run it, and tell
 * me exactly how it went". It owns, for every stage in this library:
 *
 *  - the `AbortController` and the per-lane `cfg.timeoutMs` timer,
 *  - the `maxInputChars` slice and its truncation marker,
 *  - the call into `IInternalQuery` with the lane's `auth` snapshot and, when
 *    the lane supports it, `outputFormat`,
 *  - draining the stream and the structured-output → manual-parse ladder,
 *  - recording usage into `SkillBudgetStore`,
 *  - mapping every outcome onto a `SkillLaneFailure` the drain can act on.
 *
 * **No stage builds its own timeout again.** `JUDGE_TIMEOUT_MS`,
 * `SYNTHESIS_TIMEOUT_MS` and the hardcoded `8000` / `3000` prompt slices all
 * become lane configuration read here (B1.6 removes them from their services).
 *
 * ## R1 — a lane MUST NOT mutate global auth state
 *
 * Nothing in this file writes `process.env` or an `AuthEnv`. The lane's
 * credentials arrive as a snapshot on `ResolvedSkillLane.auth` and are handed
 * to `IInternalQuery.execute` as `input.auth`, which the consumer READS
 * (`input.auth?.env ?? this.authEnv`). The hazard this avoids is
 * `ProviderModelsService.applyPersistedTiers`, which writes `this.authEnv[k]`
 * AND `process.env[k]` unconditionally with no scope guard — calling it from a
 * background lane would repoint the user's live chat session mid-conversation.
 * Pinned byte-for-byte by `lane-runner.env-immutability.spec.ts`, and banned
 * mechanically by this library's own `eslint.config.mjs`.
 *
 * ## R2 — the auth snapshot travels BY REFERENCE
 *
 * `lane.auth` is forwarded to `execute` untouched: no spread, no
 * `structuredClone`, no Zod parse, no serialization, no truthiness filter. The
 * resolver blanks the chat provider's keys by ASSIGNING `undefined` rather than
 * deleting them, and every one of those operations drops an
 * `undefined`-valued key — which silently restores the user's foreground
 * credentials into background work with no type error and no visible failure.
 * If you ever find yourself needing to "clean up" the env here, the answer is
 * no.
 *
 * ## The five failure modes (plan §3.4, plus the quota gate)
 *
 * | kind                            | how it is produced here                                              |
 * | ------------------------------- | -------------------------------------------------------------------- |
 * | `auth-unresolvable`             | forwarded verbatim from the resolver; the run never starts (Q2)      |
 * | `quota-exhausted`               | likewise: the resolved provider is rate-limited, so nothing is sent  |
 * | `structured-output-unsupported` | the ladder below exhausted BOTH attempts without parseable JSON      |
 * | `tool-use-unsupported`          | reported as a DEGRADATION on a successful run, never as a failure    |
 * | `timeout`                       | our own timer fired; `abort()` + `close()`, backoff by attempt count |
 *
 * ## At most TWO executions per `run()`, always
 *
 * That bound is the whole of R6's mitigation. The structured-output ladder may
 * re-run once without `outputFormat`; nothing else re-runs, and there is no
 * loop anywhere in this file that calls the LLM. A lane pointed at a model that
 * cannot drive tools therefore degrades once and returns — it cannot burn the
 * timeout discovering the same thing repeatedly.
 *
 * ## The queue write, and the two kinds that earn one
 *
 * `SkillLaneFailure` is DATA — every caller gets it back and may act on it. On
 * top of that, a caller that hands over its `queueItemId` gets the TRANSPORT
 * failures written straight through to `SkillQueueStore.requeue`: `timeout`,
 * `auth-unresolvable` and `quota-exhausted` all mean "nothing ran, try later",
 * and all need the row back at `queued` behind a backoff before the next tick
 * can see it. Membership is `isTransportLaneFailure`, shared with the drain so
 * the two seams cannot disagree about which kinds those are.
 *
 * `requeue`, never `markUnscored`: `unscored` is the JUDGE's verdict ("we ran and
 * we do not know"), and spending it on an endpoint that never answered would make
 * the status mean two unrelated things. `structured-output-unsupported` is
 * deliberately NOT written here — it IS an `unscored` outcome and it lands on the
 * candidate as well as the row, which is B1.6/B1.7's mapping, not the runner's.
 *
 * `queueItemId` is optional because not every lane run has a row: the judge also
 * runs at the foreground promotion gate, and a runner that required a queue id
 * would force that caller to invent one.
 *
 * ## What this deliberately does NOT do
 *
 *  - It does not mark a row terminal. `markFailed` at `attempt_count >=
 *    maxAttempts`, and the Activity event that goes with it, live with the drain
 *    (B1.7) which owns both the attempt ladder and the Activity surface.
 *  - It does not catch non-abort errors from `execute`. A transport failure is
 *    exactly what the drain's existing attempt/backoff ladder is for, and
 *    burying it in a queue row's user-facing `reason` would hide a real defect.
 */
import * as os from 'node:os';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  INTERNAL_QUERY_SERVICE_TOKEN,
  SKILL_SYNTHESIS_TOKENS,
} from '../di/tokens';
import type { IInternalQuery } from '../internal-query.interface';
import type {
  SkillBudgetStore,
  SkillBudgetUsage,
} from '../queue/skill-budget.store';
import type { SkillQueueStore } from '../queue/skill-queue.store';
import type { LaneResolverService } from './lane-resolver.service';
import { extractJsonObject } from './lane-json';
import {
  isTransportLaneFailure,
  type ResolvedSkillLane,
  type SkillLaneFailure,
  type SkillLaneFailureKind,
  type SkillLaneId,
} from './lane.types';

/**
 * Appended when `maxInputChars` clipped the prompt, so the model can tell a
 * deliberate excerpt from a corrupt one and the caller can set
 * `payload.truncated` on the queue row.
 */
export const LANE_TRUNCATION_MARKER = '\n…(truncated)…';

/** Backoff for a lane that ran but produced nothing parseable. */
export const LANE_DEGRADED_RETRY_MS = 30 * 60_000;

/** Timeout backoff base — `2^attempt × 60s`. */
export const LANE_RETRY_BACKOFF_BASE_MS = 60_000;

/** Timeout backoff ceiling. */
export const LANE_MAX_RETRY_BACKOFF_MS = 6 * 60 * 60_000;

/**
 * The hard bound on LLM calls per `run()`: the first attempt, plus at most one
 * re-run without `outputFormat`. Exported so the specs assert the number rather
 * than a behaviour that happens to imply it.
 */
export const LANE_MAX_EXECUTIONS_PER_RUN = 2;

/**
 * A capability the endpoint turned out not to have. Both members are also
 * `SkillLaneFailureKind`s: the same condition is a DEGRADATION when the run
 * still produced something usable and a FAILURE when it did not.
 */
export type LaneDegradedReason = Extract<
  SkillLaneFailureKind,
  'structured-output-unsupported' | 'tool-use-unsupported'
>;

export interface LaneRunRequest {
  readonly laneId: SkillLaneId;
  /** Clipped to the lane's `maxInputChars` before it is sent. */
  readonly prompt: string;
  readonly systemPromptAppend?: string;
  /** Defaults to the home directory, matching today's one-shot callers. */
  readonly cwd?: string;
  /** Ignored (forced to 1) on a lane declaring `toolUse: 'none'`. */
  readonly maxTurns?: number;
  /**
   * Requesting JSON at all. Presence — not the lane's `structuredOutput` — is
   * what decides whether an unparseable answer is a failure: a lane run purely
   * for prose has nothing to fail to parse.
   */
  readonly outputSchema?: Record<string, unknown>;
  /** The drain's tick signal. An abort here is a cancellation, not a timeout. */
  readonly signal?: AbortSignal;
  /**
   * The queue row's `attempt_count`, which the CAS claim already incremented.
   * Drives the timeout backoff only.
   */
  readonly attempt?: number;
  readonly mcpServerRunning?: boolean;
  /**
   * The `skill_synthesis_queue` row this run belongs to, when there is one.
   * Supplying it opts the run into the `requeue` write on the two transport
   * failures; omitting it (the foreground promotion gate) leaves the failure as
   * data the caller handles itself.
   */
  readonly queueItemId?: string;
}

export interface LaneRun {
  readonly lane: ResolvedSkillLane;
  /** Concatenated assistant text across the run. */
  readonly text: string;
  /**
   * The JSON answer when a schema was requested and one was obtained, else
   * `null`. A `null` here is ambiguous ON PURPOSE ONLY at the boundary: a run
   * that resolved nothing never reaches `status: 'ok'`, so on an `ok` run a
   * `null` means the endpoint answered `null` under the schema.
   */
  readonly json: unknown | null;
  /** Whether the SDK honoured `outputFormat` on the accepted execution. */
  readonly structuredOutputHonoured: boolean;
  readonly usage: SkillBudgetUsage;
  /** `true` when `maxInputChars` clipped the prompt. Drives `payload.truncated`. */
  readonly truncated: boolean;
  /** Set ONCE when the endpoint lacked a declared capability. */
  readonly degradedReason: LaneDegradedReason | null;
  /** How many times `IInternalQuery.execute` was called. Never above 2. */
  readonly executions: number;
  /**
   * Retrieval passes the CALLER may run. `1` on a `toolUse: 'none'` lane and
   * on a lane whose first pass hit `error_max_turns` — the archaeologist's
   * collapse-to-a-single-tail-window guard (R6).
   */
  readonly passesAllowed: number;
}

/**
 * Three outcomes, not two. `unavailable` is not a failure: a host with no LLM
 * has nothing wrong with it, and turning that into a `SkillLaneFailure` would
 * put a retry backoff on a queue row that will never succeed in this host.
 *
 * "No LLM" has TWO shapes and the second one is the one that bit us. A host may
 * register no `InternalQueryService` at all (an e2e host), or it may register
 * one that was never initialized — which is every `ptah` command booting
 * `withEngine({ mode: 'full', requireSdk: false })`. Both are `unavailable`;
 * see `IInternalQuery.isInitialized`.
 */
export type LaneRunResult =
  | { readonly status: 'ok'; readonly run: LaneRun }
  | { readonly status: 'failed'; readonly failure: SkillLaneFailure }
  | { readonly status: 'unavailable'; readonly reason: string };

/** What one `execute` call produced, before the ladder interprets it. */
type CallOutcome =
  | {
      readonly kind: 'ok';
      readonly text: string;
      readonly resultText: string | null;
      readonly structured: unknown;
      readonly hasStructured: boolean;
      readonly subtype: string | null;
      readonly usage: SkillBudgetUsage;
    }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'cancelled' };

interface CallOptions {
  readonly prompt: string;
  readonly systemPromptAppend?: string;
  readonly cwd: string;
  readonly maxTurns: number;
  readonly mcpServerRunning: boolean;
  readonly outputFormat?: {
    readonly type: 'json_schema';
    readonly schema: Record<string, unknown>;
  };
  readonly signal?: AbortSignal;
}

@injectable()
export class LaneRunnerService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SKILL_SYNTHESIS_TOKENS.LANE_RESOLVER_SERVICE)
    private readonly resolver: LaneResolverService,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_BUDGET_STORE)
    private readonly budget: SkillBudgetStore,
    /**
     * Optional for the same reason every other consumer's is: a host without
     * the SDK still resolves this service, and answers `unavailable`.
     */
    @inject(INTERNAL_QUERY_SERVICE_TOKEN, { isOptional: true })
    private readonly internalQuery: IInternalQuery | null = null,
    /**
     * Optional so the three sibling specs — and any caller that never passes a
     * `queueItemId` — can build a runner without a database behind it. A host
     * that registers this library always has it.
     */
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_QUEUE_STORE, { isOptional: true })
    private readonly queue: SkillQueueStore | null = null,
  ) {}

  async run(req: LaneRunRequest): Promise<LaneRunResult> {
    // A non-auth error here is a defect and is deliberately NOT caught — see
    // the resolver's own header.
    const resolution = await this.resolver.resolve(req.laneId);
    if (!resolution.ok) {
      return this.fail(req, resolution.failure);
    }

    const lane = resolution.lane;
    if (!this.internalQuery) {
      return {
        status: 'unavailable',
        reason: `Lane ${req.laneId}: no internal query service in this host`,
      };
    }
    // Registered is not usable. The CLI registers `agent-sdk` on every
    // `mode: 'full'` boot and then skips `initialize()` via `requireSdk: false`,
    // so the token above resolves on a host whose `execute` can only ever
    // throw. Asking is the difference between `unavailable` (this host has no
    // LLM — nothing is wrong, do not back off) and a `SkillLaneFailure` the
    // caller must treat as a transport fault. `?.() === false` and not
    // `!isInitialized?.()`: an implementation that does not answer is not an
    // implementation that answered "no".
    if (this.internalQuery.isInitialized?.() === false) {
      return {
        status: 'unavailable',
        reason: `Lane ${req.laneId}: the SDK was never initialized in this host`,
      };
    }

    const cfg = lane.config;
    const { prompt, truncated } = clip(req.prompt, cfg.maxInputChars);
    const wantsJson = req.outputSchema !== undefined;

    // The capability guard, applied BEFORE the call rather than discovered by
    // it: a lane that declares no tool use never gets a multi-turn budget.
    const toolUseAllowed = cfg.toolUse !== 'none';
    const maxTurns = toolUseAllowed
      ? Math.max(1, Math.floor(req.maxTurns ?? 1))
      : 1;
    let passesAllowed = toolUseAllowed
      ? Math.max(1, Math.floor(cfg.maxPasses))
      : 1;
    /**
     * A DECLARED `toolUse: 'none'` is configuration, not a degradation — the
     * default judge and synthesis lanes both declare it, and marking every one
     * of their runs `degraded` would make the field meaningless on the verdict
     * rows that actually are. Only a capability DISCOVERED to be missing below
     * sets this.
     */
    let degradedReason: LaneDegradedReason | null = null;

    const base: CallOptions = {
      prompt,
      systemPromptAppend: req.systemPromptAppend,
      cwd: req.cwd ?? os.homedir(),
      maxTurns,
      mcpServerRunning: req.mcpServerRunning ?? false,
      signal: req.signal,
    };

    // Attempt 1. `outputFormat` goes out only when the caller asked for JSON
    // AND the lane declares the endpoint honours it.
    const sendSchema = wantsJson && cfg.structuredOutput === 'sdk';
    let executions = 0;
    let usage: SkillBudgetUsage = {};
    let text = '';

    const first = await this.callOnce(lane, {
      ...base,
      outputFormat:
        sendSchema && req.outputSchema
          ? { type: 'json_schema', schema: req.outputSchema }
          : undefined,
    });
    executions++;
    if (first.kind !== 'ok') {
      return this.fail(req, this.abortFailure(req, first.kind));
    }
    usage = mergeUsage(usage, first.usage);
    text = first.text;
    this.recordUsage(first.usage);

    // R6: a first pass that ran out of turns means the endpoint could not drive
    // the retrieval loop. Collapse the CALLER's pass budget and say so — once.
    // We do not re-run here; re-running is what "loops to timeout" means.
    if (toolUseAllowed && first.subtype === 'error_max_turns') {
      passesAllowed = 1;
      degradedReason = 'tool-use-unsupported';
      this.logger.warn(
        '[skill-synthesis] lane exhausted its turns on pass 1; collapsing to a single pass',
        { lane: req.laneId, model: lane.model },
      );
    }

    let read = wantsJson ? readJson(first) : NO_JSON;
    let structuredOutputHonoured = first.hasStructured;

    // The ladder. Only a lane that ASKED for structured output and RESOLVED
    // nothing at all earns the second execution. `read.resolved` — not
    // `read.value === null` — is the gate: an endpoint that honoured the schema
    // and legitimately answered `null` has not failed at anything, and re-running
    // it would spend a second call to be told `null` again.
    if (wantsJson && !read.resolved && sendSchema) {
      this.logger.warn(
        '[skill-synthesis] lane ignored outputFormat; retrying once without it',
        { lane: req.laneId, model: lane.model },
      );
      const second = await this.callOnce(lane, {
        ...base,
        outputFormat: undefined,
      });
      executions++;
      if (second.kind !== 'ok') {
        return this.fail(req, this.abortFailure(req, second.kind));
      }
      usage = mergeUsage(usage, second.usage);
      text = second.text;
      this.recordUsage(second.usage);
      read = readJson(second);
      structuredOutputHonoured = second.hasStructured;
      degradedReason = 'structured-output-unsupported';
    }

    if (wantsJson && !read.resolved) {
      // Both rungs exhausted. The stage has no verdict; the drain marks the row
      // `unscored` and it stays re-eligible.
      return this.fail(req, {
        kind: 'structured-output-unsupported',
        reason: `Lane ${req.laneId}: no parseable JSON in the response`,
        retryAfterMs: LANE_DEGRADED_RETRY_MS,
      });
    }

    return {
      status: 'ok',
      run: {
        lane,
        text,
        json: read.value,
        structuredOutputHonoured,
        usage,
        truncated,
        degradedReason,
        executions,
        passesAllowed,
      },
    };
  }

  /**
   * One `execute` call, fully bounded. Returns rather than throws for the two
   * abort shapes; anything else propagates to the drain.
   */
  private async callOnce(
    lane: ResolvedSkillLane,
    opts: CallOptions,
  ): Promise<CallOutcome> {
    const query = this.internalQuery;
    if (!query) return { kind: 'cancelled' };
    if (opts.signal?.aborted) return { kind: 'cancelled' };

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, lane.config.timeoutMs);
    const onExternalAbort = (): void => controller.abort();
    opts.signal?.addEventListener('abort', onExternalAbort, { once: true });

    let handle: Awaited<ReturnType<IInternalQuery['execute']>> | null = null;
    try {
      handle = await query.execute({
        cwd: opts.cwd,
        model: lane.model,
        prompt: opts.prompt,
        systemPromptAppend: opts.systemPromptAppend,
        mcpServerRunning: opts.mcpServerRunning,
        maxTurns: opts.maxTurns,
        abortController: controller,
        // R2: BY REFERENCE. Do not spread, clone, parse or filter this.
        auth: lane.auth,
        outputFormat: opts.outputFormat,
      });

      let text = '';
      let resultText: string | null = null;
      let structured: unknown = undefined;
      let hasStructured = false;
      let subtype: string | null = null;
      let usage: SkillBudgetUsage = {};

      for await (const msg of handle.stream) {
        if (msg.type === 'assistant') {
          for (const block of msg.message?.content ?? []) {
            if (block.type === 'text' && typeof block.text === 'string') {
              text += block.text;
            }
          }
        }
        if (msg.type === 'result') {
          subtype = msg.subtype ?? null;
          resultText = typeof msg.result === 'string' ? msg.result : null;
          // Presence, not truthiness: a provider that honoured the schema and
          // legitimately returned `null` is not the same as one that ignored
          // the field, and only the second earns a re-run.
          hasStructured =
            Object.prototype.hasOwnProperty.call(msg, 'structured_output') &&
            msg.structured_output !== undefined;
          structured = msg.structured_output;
          usage = {
            inputTokens: msg.usage?.input_tokens,
            outputTokens: msg.usage?.output_tokens,
            costUsd: msg.total_cost_usd,
          };
          break;
        }
      }

      // A stream that ends quietly on abort would otherwise look like a short
      // but successful answer.
      if (timedOut) return { kind: 'timeout' };
      if (controller.signal.aborted) return { kind: 'cancelled' };

      return {
        kind: 'ok',
        text,
        resultText,
        structured,
        hasStructured,
        subtype,
        usage,
      };
    } catch (error: unknown) {
      if (timedOut) return { kind: 'timeout' };
      if (controller.signal.aborted) return { kind: 'cancelled' };
      throw error;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onExternalAbort);
      if (timedOut) handle?.abort();
      handle?.close();
    }
  }

  /**
   * The single exit for every failure, so the queue write cannot be forgotten at
   * one of the four return sites.
   *
   * Only the two TRANSPORT kinds write. `structured-output-unsupported` passes
   * through untouched: the row's `unscored` transition also has to set the
   * candidate's `judge_status`, and splitting that pair across two owners is how
   * a row and its candidate end up disagreeing.
   */
  private fail(req: LaneRunRequest, failure: SkillLaneFailure): LaneRunResult {
    const shouldRequeue = isTransportLaneFailure(failure.kind);
    if (req.queueItemId && this.queue && shouldRequeue) {
      // A row this worker no longer holds returns `false` — expected after a
      // reap, and not something to fail the run over.
      const applied = this.queue.requeue(
        req.queueItemId,
        Date.now() + failure.retryAfterMs,
        failure.reason,
      );
      if (!applied) {
        this.logger.debug(
          '[skill-synthesis] lane requeue skipped; the row is no longer claimed',
          { lane: req.laneId, item: req.queueItemId, kind: failure.kind },
        );
      }
    }
    return { status: 'failed', failure };
  }

  /**
   * A timed-out run backs off exponentially; a CANCELLED one does not back off
   * at all, because nothing was wrong with it — the tick simply ended.
   */
  private abortFailure(
    req: LaneRunRequest,
    kind: 'timeout' | 'cancelled',
  ): SkillLaneFailure {
    if (kind === 'cancelled') {
      return {
        kind: 'timeout',
        reason: `Lane ${req.laneId}: run cancelled before completion`,
        retryAfterMs: 0,
      };
    }
    return {
      kind: 'timeout',
      reason: `Lane ${req.laneId}: timed out`,
      retryAfterMs: timeoutBackoffMs(req.attempt ?? 0),
    };
  }

  /**
   * A ledger write must never lose an otherwise good run: the tokens are spent
   * either way, and failing the stage here would spend them again next tick.
   */
  private recordUsage(usage: SkillBudgetUsage): void {
    if (!hasUsage(usage)) return;
    try {
      this.budget.record(usage);
    } catch (error: unknown) {
      this.logger.warn('[skill-synthesis] failed to record lane usage', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** `2^attempt × 60s`, capped at 6 h. Mirrors the drain's own retry ladder. */
export function timeoutBackoffMs(attempt: number): number {
  const exponent = Math.max(0, Math.min(Math.floor(attempt), 30));
  return Math.min(
    2 ** exponent * LANE_RETRY_BACKOFF_BASE_MS,
    LANE_MAX_RETRY_BACKOFF_MS,
  );
}

function clip(
  prompt: string,
  maxInputChars: number,
): { prompt: string; truncated: boolean } {
  if (prompt.length <= maxInputChars) return { prompt, truncated: false };
  return {
    prompt: prompt.slice(0, maxInputChars) + LANE_TRUNCATION_MARKER,
    truncated: true,
  };
}

/**
 * "Did we get a JSON answer, and what was it?" — two questions, deliberately
 * NOT collapsed into one nullable value.
 *
 * `null` is a legal JSON answer. Using it as the "nothing parsed" sentinel is
 * what made a provider that honoured the schema and returned `null` look
 * identical to one that ignored `outputFormat` entirely, which fired the
 * fallback re-run and broke the at-most-one-re-run bound.
 */
interface JsonRead {
  /** `true` once a JSON value was obtained, whatever that value is. */
  readonly resolved: boolean;
  readonly value: unknown;
}

const NO_JSON: JsonRead = { resolved: false, value: null };

/**
 * The SDK's structured output when the field was PRESENT, otherwise the manual
 * extractor over the result text and then the assistant text. The two text
 * sources are both tried because a `'parse'` endpoint may answer in either.
 */
function readJson(call: Extract<CallOutcome, { kind: 'ok' }>): JsonRead {
  // Presence, matching `hasStructured`: the field was there, so the endpoint
  // honoured the schema — including when what it produced was `null`.
  if (call.hasStructured) return { resolved: true, value: call.structured };

  // `extractJsonObject` scans for a balanced `{...}`, so it can never return
  // JSON `null` — a `null` from it always means "found nothing".
  const fromResult = extractJsonObject(call.resultText ?? '');
  if (fromResult !== null) return { resolved: true, value: fromResult };

  const fromText = extractJsonObject(call.text);
  if (fromText !== null) return { resolved: true, value: fromText };

  return NO_JSON;
}

function mergeUsage(
  a: SkillBudgetUsage,
  b: SkillBudgetUsage,
): SkillBudgetUsage {
  return {
    inputTokens: (a.inputTokens ?? 0) + (b.inputTokens ?? 0),
    outputTokens: (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
    costUsd: (a.costUsd ?? 0) + (b.costUsd ?? 0),
  };
}

function hasUsage(usage: SkillBudgetUsage): boolean {
  return (
    (usage.inputTokens ?? 0) > 0 ||
    (usage.outputTokens ?? 0) > 0 ||
    (usage.costUsd ?? 0) > 0
  );
}
