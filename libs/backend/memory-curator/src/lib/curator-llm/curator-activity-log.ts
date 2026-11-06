/**
 * The curator's activity record — what ran, what stalled, and why.
 *
 * Extracted from {@link MemoryCuratorService} under the facade rule
 * (TASK_2026_437 C14 f, FU-16b-b): the service keeps its name, its DI token and
 * every public signature (`pushEvent`, `onEvent`, `recentEvents`,
 * `lastRunInfo`) and delegates them here. This file owns
 * the one concern those methods and the pass-outcome recorders share: the
 * event ring buffer the Activity surface reads and the last-run cache the
 * diagnostics panel reads.
 *
 * Constructed by the service rather than injected, for the same reason as
 * `CuratorWindowRunner`: no lifecycle, no alternative implementation, no other
 * consumer. Its being a field of the SINGLETON service is what makes the ring
 * buffer host-wide.
 */
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  CuratorExtraction,
  CuratorStallReason,
} from './curator-llm.interface';
import type { MemoryCuratorEvent } from '../diagnostics.types';

/**
 * Whether the pass reached the model at all — TASK_2026_306 Batch 10 (F1).
 *
 * `'ran'` covers every pass that dialled the curator LLM, including one that
 * found nothing and one whose call failed: in both cases the input was consumed
 * and the caller may advance its state. `'stalled'` means a gate stopped the
 * pass before it could dispatch, so the input is untouched and the caller must
 * leave it exactly where it found it.
 *
 * Several gates produce `'stalled'`, and the caller treats them identically
 * because the fact it acts on is the same one: nothing was curated and nothing
 * was consumed. The provider quota gate stops a pass that would dial a
 * rate-limited provider (TASK_2026_306). The internal-query concurrency gate
 * stops a pass that could not win a slot within
 * `ptah.internalQuery.queueTimeoutMs` (TASK_2026_376 F4) — that one used to be
 * reported as `'ran'` with `extracted: 0`, which is how two sessions had their
 * observation rows marked processed for a curation that never happened. R1 adds
 * three more with the same property: a pass that waited past
 * `CURATOR_QUEUE_WAIT_CEILING_MS` for its turn in `CuratorJobQueue`, a pass
 * whose caller had already aborted, and a pass whose model spent its turns and
 * returned no JSON (`recordNoOutput`). TASK_2026_437 C14 f adds a pass whose
 * provider was unreachable and a background pass held by the network back-off
 * or cancelled at host shutdown while it waited for the governor.
 *
 * Note what is NOT on this list: a pass that dispatched and whose call FAILED
 * with a non-network error reports `'failed'` (`recordError`). Every
 * `'stalled'` member is a pass whose input was demonstrably never read; a
 * `'failed'` pass may have read it but curated nothing, so its input is not
 * consumed either — `MemoryTriggerService` keeps the observation rows for a
 * bounded number of retries (TASK_2026_621) instead of marking them processed.
 *
 * Required, not optional, so every construction site has to answer. The zero
 * counts on the arms are identical, which is precisely why the counts cannot
 * carry this distinction themselves.
 */
export type CuratorRunOutcome = 'ran' | 'stalled' | 'failed';

export interface CuratorRunStats {
  readonly outcome: CuratorRunOutcome;
  readonly extracted: number;
  readonly merged: number;
  readonly created: number;
  readonly skipped: number;
  /**
   * Set only on a pass a gate deferred before dispatch
   * ({@link CuratorActivityLog.recordDeferral}). `MemoryTriggerService` reads
   * `network-backoff` to refund the hourly curate slot it spent on a pass that
   * made no upstream call (TASK_2026_437 C14 f).
   */
  readonly deferral?: CuratorDeferralReason;
  /**
   * Why the pass did not run cleanly: a stall, a deferral, a run without
   * output, or a failure. Absent on a pass that ran (TASK_2026_878).
   */
  readonly reason?: CuratorRunReason;
  /**
   * The fixed sentence for {@link reason} from {@link curatorRunMessage}.
   * Never provider text, an error cause, a URL or a credential: this value
   * crosses to the renderer through diagnostics and `memory:runNow`.
   */
  readonly error?: string;
}

export type MemoryCuratorEventListener = (event: MemoryCuratorEvent) => void;

/**
 * Which mechanism deferred a pass, as the diagnostics event reports it.
 *
 * The `reason` already names the event; `source` names the thing that produced
 * it, which is what an operator needs to know where to look. They are
 * different subsystems: the internal-query concurrency gate, the service's own
 * pass queue, the caller itself, the network back-off, and the background-work
 * governor.
 */
const DEFERRAL_SOURCES = {
  'concurrency-slot-timeout': 'internal-query-gate',
  'curator-queue-wait-timeout': 'curator-job-queue',
  'caller-aborted': 'caller',
  'network-backoff': 'network-backoff',
  'host-shutdown': 'background-work-governor',
} as const;

export type CuratorDeferralReason = keyof typeof DEFERRAL_SOURCES;

/**
 * Every reason a curator pass can end without a clean run (TASK_2026_878).
 *
 * The renderer shows the matching {@link curatorRunMessage} sentence. Raw
 * provider text stays in the backend logs.
 */
export type CuratorRunReason =
  | CuratorStallReason
  | CuratorDeferralReason
  | 'no-output'
  | 'curator-error'
  | 'auth-required';

const KEPT = 'Observations are kept for the next pass.';

/**
 * One fixed sentence per reason. A `Record` so a new reason fails to compile
 * until it has a sentence.
 */
const CURATOR_RUN_MESSAGES: Readonly<Record<CuratorRunReason, string>> = {
  'provider-unsupported':
    'The memory curator cannot run on OpenAI Codex. Choose another provider for Memory curator in Settings > Background model roles.',
  'auth-required':
    "The memory curator's provider is not signed in or its sign-in expired. Check it in Settings > Background model roles, then run again.",
  'curator-error': 'The curator run failed. See the logs for details.',
  'provider-cooling-down': `The curator's provider is rate-limited, so this pass did not run. ${KEPT}`,
  'provider-unreachable': `The curator's provider could not be reached. ${KEPT}`,
  'no-output': `The curator finished without returning a result. ${KEPT}`,
  'concurrency-slot-timeout': `The curator waited too long for a free model slot. ${KEPT}`,
  'curator-queue-wait-timeout': `The curator pass waited too long in the queue. ${KEPT}`,
  'caller-aborted': `The curator pass was cancelled before it started. ${KEPT}`,
  'network-backoff': `The curator is pausing after recent network failures. ${KEPT}`,
  'host-shutdown': `The curator pass was cancelled because the app is shutting down. ${KEPT}`,
};

/** The fixed, user-facing sentence for a curator run reason. */
export function curatorRunMessage(reason: CuratorRunReason): string {
  return CURATOR_RUN_MESSAGES[reason];
}

/** How many `cause` levels {@link CuratorActivityLog.recordError} inspects. */
const CAUSE_DEPTH = 3;

/**
 * The error and up to {@link CAUSE_DEPTH} levels of `cause` beneath it, in
 * order. Stops at the first non-object cause.
 */
function causeChain(error: unknown): readonly unknown[] {
  const chain: unknown[] = [error];
  let current: unknown = error;
  for (let depth = 0; depth < CAUSE_DEPTH; depth++) {
    if (typeof current !== 'object' || current === null) break;
    const next: unknown = (current as { cause?: unknown }).cause;
    if (next === undefined) break;
    chain.push(next);
    current = next;
  }
  return chain;
}

function errorName(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const name: unknown = (value as { name?: unknown }).name;
  return typeof name === 'string' ? name : undefined;
}

function errorText(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

export interface CuratorDeferralDetail {
  /**
   * Which gate stopped the pass. All share one recorder because the caller's
   * decision is identical — the input was never read — and they are named
   * apart because an operator diagnosing a quiet curator needs to know whether
   * the host is congested, the queue is backed up, the provider is
   * unreachable, or the caller simply withdrew.
   */
  readonly reason: CuratorDeferralReason;
  readonly stage: 'extract' | 'resolve';
  readonly completedWindows: number;
  readonly windows: number;
  readonly retriesSpent: number;
}

/** Zero counts for a pass that consumed nothing. */
const STALLED_STATS: CuratorRunStats = {
  outcome: 'stalled',
  extracted: 0,
  merged: 0,
  created: 0,
  skipped: 0,
};

export class CuratorActivityLog {
  static readonly RING_CAPACITY = 200;
  private readonly events: MemoryCuratorEvent[] = [];
  private readonly listeners = new Set<MemoryCuratorEventListener>();
  private lastRunAtMs: number | null = null;
  private lastRunStats: CuratorRunStats | null = null;

  constructor(private readonly logger: Logger) {}

  push(ev: MemoryCuratorEvent): void {
    this.events.push(ev);
    if (this.events.length > CuratorActivityLog.RING_CAPACITY) {
      this.events.shift();
    }
    for (const listener of this.listeners) {
      try {
        listener(ev);
      } catch (err: unknown) {
        this.logger.warn('[memory-curator] event listener threw', {
          kind: ev.kind,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  onEvent(listener: MemoryCuratorEventListener): { dispose: () => void } {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  recent(limit = 10): readonly MemoryCuratorEvent[] {
    const safe = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;
    return this.events.slice(-safe);
  }

  lastRunInfo(): {
    readonly at: number | null;
    readonly stats: CuratorRunStats | null;
  } {
    return { at: this.lastRunAtMs, stats: this.lastRunStats };
  }

  /**
   * A pass that ran to the end. Updates the last-run cache and pushes
   * `curator-run` (or `curator-skipped-no-data` when `noData` — the transcript
   * was the placeholder and the model was never called).
   */
  recordRun(
    sessionId: string,
    workspaceRoot: string | null,
    stats: CuratorRunStats,
    noData = false,
  ): CuratorRunStats {
    this.lastRunAtMs = Date.now();
    this.lastRunStats = stats;
    if (noData) {
      this.push({
        kind: 'curator-skipped-no-data',
        timestamp: this.lastRunAtMs,
        sessionId,
        workspaceRoot,
      });
      return stats;
    }
    this.push({
      kind: 'curator-run',
      timestamp: this.lastRunAtMs,
      sessionId,
      workspaceRoot,
      stats: {
        extracted: stats.extracted,
        merged: stats.merged,
        created: stats.created,
        skipped: stats.skipped,
      },
    });
    return stats;
  }

  /**
   * A gate stopped this pass before it reached the model, or the provider
   * never answered it.
   *
   * Three things this deliberately does NOT do, each of which would re-open F1
   * through a different route:
   *
   *  - it does not touch the last-run cache. "Last run" means the last pass
   *    that ran; a stall would otherwise overwrite a real run's stats with
   *    zeroes and make the diagnostics panel report a clean empty pass while
   *    nothing had happened.
   *  - it does not push `curator-run`. That event is the Activity surface's
   *    record of work performed. `rate-limited` already exists in the event
   *    union, already renders as a warning, and already means exactly this.
   *  - it does not persist anything, so the auto-rebuild hook never fires.
   *
   * The returned `outcome: 'stalled'` is the whole product of this method. Its
   * only consumer that matters is `MemoryTriggerService.invokeCurate`, which
   * uses it to keep the drained `observation_queue` rows unprocessed.
   *
   * `provider-unsupported` is the exception (TASK_2026_878). The configured
   * provider can never run the curator, so every pass would stall the same
   * way until the user changes the setting. That pass updates the last-run
   * cache and pushes `curator-error` with the fixed sentence, so the
   * diagnostics panel says what to change instead of looking idle. The input
   * is still kept: the outcome stays `'stalled'`.
   */
  recordStall(
    sessionId: string,
    extraction: Extract<CuratorExtraction, { status: 'stalled' }>,
  ): CuratorRunStats {
    const sentence = curatorRunMessage(extraction.reason);
    const stats: CuratorRunStats = {
      ...STALLED_STATS,
      reason: extraction.reason,
      error: sentence,
    };
    if (extraction.reason === 'provider-unsupported') {
      this.lastRunAtMs = Date.now();
      this.lastRunStats = stats;
      this.push({
        kind: 'curator-error',
        timestamp: this.lastRunAtMs,
        sessionId,
        error: sentence,
        stats: {
          reason: extraction.reason,
          providerId: extraction.providerId,
        },
      });
      this.logger.warn(
        '[memory-curator] curator provider cannot run background curation; input left untouched',
        { sessionId, providerId: extraction.providerId },
      );
      return stats;
    }
    this.push({
      kind: 'rate-limited',
      timestamp: Date.now(),
      sessionId,
      stats: {
        source: 'curator-llm',
        reason: extraction.reason,
        providerId: extraction.providerId,
      },
    });
    this.logger.info(
      '[memory-curator] curation pass stalled before dispatch; input left untouched',
      {
        sessionId,
        reason: extraction.reason,
        providerId: extraction.providerId,
      },
    );
    return stats;
  }

  /**
   * The curator ran and never wrote its answer — TASK_2026_376 R1.
   *
   * The curator reached the model, spent turns, and got no JSON back: it filled
   * its budget with tool calls, or it said nothing at all. The pass therefore
   * extracted nothing from a transcript it never reported on, which is NOT the
   * same event as a pass that read the transcript and honestly found nothing
   * durable in it — and the caller acts on the difference.
   * `MemoryTriggerService.invokeCurate` marks the drained `observation_queue`
   * rows processed for a run, so reporting `'ran'` here consumed the very
   * observations that were never curated, and the session could never be
   * curated again. Six turns (F8) made this the ordinary shape of a tool-using
   * run rather than a theoretical one.
   *
   * `'stalled'` is therefore the honest outcome, for the same reason it is the
   * honest outcome of a quota stop: nothing usable came back, so leave the input
   * where it is. Same shape as {@link recordStall} — no last-run update, no
   * `curator-run`, nothing persisted.
   *
   * The cost of being wrong is bounded and asymmetric. A model that answers this
   * way on every pass re-curates the same session each drain, which spends
   * prompts; consuming the input instead loses the session's memories for good.
   */
  recordNoOutput(
    sessionId: string,
    extraction: Extract<CuratorExtraction, { status: 'no-output' }>,
  ): CuratorRunStats {
    this.push({
      kind: 'rate-limited',
      timestamp: Date.now(),
      sessionId,
      stats: {
        source: 'curator-llm',
        reason: 'no-output',
        usedTools: extraction.usedTools,
        toolNames: extraction.toolNames.join(','),
      },
    });
    this.logger.warn(
      '[memory-curator] curation pass returned no JSON; input left untouched for the next pass',
      {
        sessionId,
        usedTools: extraction.usedTools,
        toolNames: extraction.toolNames,
      },
    );
    return {
      ...STALLED_STATS,
      reason: 'no-output',
      error: curatorRunMessage('no-output'),
    };
  }

  /**
   * A gate stopped this pass before it could dispatch — TASK_2026_376 F4, two
   * more gates in R1, and the network back-off and governor shutdown in
   * TASK_2026_437 C14 f.
   *
   * Deliberately the same shape as {@link recordStall}, because the caller's
   * decision is the same one: the input was not consumed, so leave it where it
   * is and curate it on the next drain.
   *
   * The event is `rate-limited` rather than a new kind. `MemoryCuratorEventKind`
   * is consumed by the Activity surface, which already renders that kind as a
   * warning meaning "a gate stopped this"; the `reason` in `stats` is what tells
   * the gates apart, and `stats` is a free-form record. A new kind would be a
   * frontend change for a distinction the frontend does not draw.
   *
   * A `network-backoff` deferral logs at `debug`, not `warn`: the back-off
   * writes ONE line per level change, and a warn per deferred pass would be the
   * per-attempt noise that rule exists to prevent.
   */
  recordDeferral(
    sessionId: string,
    detail: CuratorDeferralDetail,
  ): CuratorRunStats {
    this.push({
      kind: 'rate-limited',
      timestamp: Date.now(),
      sessionId,
      stats: {
        source: DEFERRAL_SOURCES[detail.reason],
        reason: detail.reason,
        stage: detail.stage,
        completedWindows: detail.completedWindows,
        windows: detail.windows,
        retriesSpent: detail.retriesSpent,
      },
    });
    const message =
      '[memory-curator] curation pass never dispatched; input left untouched for the next pass';
    if (detail.reason === 'network-backoff') {
      this.logger.debug(message, { sessionId, ...detail });
    } else {
      this.logger.warn(message, { sessionId, ...detail });
    }
    return {
      ...STALLED_STATS,
      deferral: detail.reason,
      reason: detail.reason,
      error: curatorRunMessage(detail.reason),
    };
  }

  recordError(
    sessionId: string,
    error: unknown,
    stage: 'extract' | 'resolve',
    extractedCount = 0,
  ): CuratorRunStats {
    const chain = causeChain(error);
    const detail = errorText(error);
    // The cause chain is what tells a sign-in failure apart from any other:
    // the adapter wraps the provider's `AuthRequiredError` in a
    // `CuratorLlmQueryError`. Matched by name so this library does not import
    // the SDK's error classes.
    const reason: CuratorRunReason = chain.some(
      (link) => errorName(link) === 'AuthRequiredError',
    )
      ? 'auth-required'
      : 'curator-error';
    const sentence = curatorRunMessage(reason);
    // `'failed'`, not `'ran'`: the call was dispatched and failed, so nothing
    // was curated. Reporting `'ran'` let the trigger mark the drained
    // observations processed and lose them (TASK_2026_621). Not `'stalled'`
    // either: the input may have been read, and a pass that fails the same way
    // every time must not be retried forever — the trigger bounds the retries.
    // The failures that never reach this method are the concurrency-slot
    // timeout (TASK_2026_376 F4) and an unreachable provider (TASK_2026_437
    // C14 f), both reported as stalls.
    const zeroedStats: CuratorRunStats = {
      outcome: 'failed',
      extracted: 0,
      merged: 0,
      created: 0,
      skipped: 0,
      reason,
      error: sentence,
    };
    this.lastRunAtMs = Date.now();
    this.lastRunStats = zeroedStats;
    // The event carries the fixed sentence only. The raw message and its
    // causes can hold provider text, URLs or key fragments; they go to the
    // log below and nowhere else.
    this.push({
      kind: 'curator-error',
      timestamp: this.lastRunAtMs,
      sessionId,
      error: sentence,
      stats: { reason, stage, extracted: extractedCount },
    });
    this.logger.warn('[memory-curator] curator LLM run failed', {
      sessionId,
      stage,
      extracted: extractedCount,
      reason,
      error: detail,
      causes: chain.slice(1).map(errorText),
    });
    return zeroedStats;
  }
}
