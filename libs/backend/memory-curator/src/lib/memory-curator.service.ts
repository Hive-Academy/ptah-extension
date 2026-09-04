/**
 * MemoryCuratorService — orchestrates the PreCompact → extract → resolve →
 * score → store pipeline.
 *
 * Lifecycle:
 *   - `start()`: subscribes to the agent-sdk `CompactionCallbackRegistry`.
 *     The handler is fire-and-forget: PreCompact returns instantly, the
 *     curator runs asynchronously after.
 *   - `stop()`: unsubscribes; safe to call multiple times.
 *
 * The curator never throws into the SDK callback path — failures are
 * logged and swallowed.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, NoopTracer, type Logger } from '@ptah-extension/vscode-core';
import {
  MEMORY_CONTRACT_TOKENS,
  type ICompactionCallbackRegistry,
  type ITranscriptReader,
} from '@ptah-extension/memory-contracts';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
  type ITracer,
} from '@ptah-extension/platform-core';
import { blankToUndefined } from '@ptah-extension/shared';
import { MEMORY_TOKENS } from './di/tokens';
import { MemoryStore } from './memory.store';
import { SalienceScorer } from './salience-scorer';
import type {
  ICuratorLLM,
  CuratorExtraction,
  ExtractedMemoryDraft,
  ResolvedMemoryDraft,
} from './curator-llm/curator-llm.interface';
import { CuratorWindowRunner } from './curator-llm/curator-window-runner';
import {
  CuratorJobQueue,
  CuratorQueueWaitTimeoutError,
} from './curator-llm/curator-job-queue';
import {
  isQueueSlotTimeout,
  QueueSlotRetryBudget,
} from './curator-llm/queue-slot-timeout';
import type { CuratorWindow } from './curator-llm/transcript-windows';
import { memoryId, type MemoryTier } from './memory.types';
import type { MemoryCuratorEvent, MemoryDecayStats } from './diagnostics.types';
import type { CorpusStore } from './knowledge-agents/corpus.store';
import type { KnowledgeAgentService } from './knowledge-agents/knowledge-agent.service';

const AUTO_REBUILD_SECTION = 'ptah';
const AUTO_REBUILD_KEY = 'memory.corpus.autoRebuildOnExtraction';
const AUTO_REBUILD_THROTTLE_MS = 30_000;

const TRANSCRIPT_PLACEHOLDER =
  '[Compaction transcript window unavailable; curator running on session metadata only.]';

/**
 * Windows planned for a curation triggered by a MANUAL PreCompact.
 *
 * A manual `/compact` is the user asking for something to happen NOW. The
 * curator answers it with a background extract per window, spent strictly
 * sequentially (`CuratorWindowRunner.extractAcrossWindows`, and the
 * `memory-curator` internal-query lane has a per-lane concurrency of 1), on the
 * same provider account and quota as the compaction the user is waiting for. A
 * 372-event / 333 538-token session measured eight windows at 24-37 s each —
 * about four minutes of `claude.EXE` behind a command the user expected to be
 * cheap (TASK_2026_374).
 *
 * One window caps that pass at 2 LLM calls (1 extract + 1 resolve), the same as
 * an ordinary short session. The transcript is head-and-tail clamped instead of
 * chunked, which is a real loss of coverage — accepted deliberately here and
 * ONLY here. Automatic threshold compaction keeps the full
 * {@link CURATOR_MAX_WINDOWS} budget, because nobody is waiting on it.
 */
const MANUAL_COMPACTION_MAX_WINDOWS = 1;

/**
 * The synthetic session id `SdkQueryRunner` gives an internal one-shot query.
 *
 * A one-shot query has no Ptah session, so the runner mints
 * `internal-query-${Date.now()}` and passes it down so the subagents that query
 * spawns are registered against something (TASK_2026_295). The id names no
 * session, and there is no transcript on disk under it.
 *
 * It reaches this service through the PreCompact fan-out. That was unreachable
 * while `maxTurns` was 1 — a single round trip cannot cross a 100 000-token
 * compaction threshold — and TASK_2026_376 F8 raised the curator's own budget
 * to 6, which puts the curator's query on exactly that path. A PreCompact
 * inside a curator run would hand this service the synthetic id, the transcript
 * read would fail on it, and the fallback would `curate()` a placeholder: a
 * curation job queued behind the real pass, a false curation event in the log,
 * and the curator triggering itself. The producer side is guarded too; this is
 * the consumer-side guard, and both are wanted (TASK_2026_376 R1).
 */
const INTERNAL_QUERY_SESSION_PREFIX = 'internal-query-';

/**
 * Which mechanism deferred a pass, as the diagnostics event reports it.
 *
 * The `reason` already names the event; `source` names the thing that produced
 * it, which is what an operator needs to know where to look. The three are
 * different subsystems: the internal-query concurrency gate, this service's own
 * pass queue, and the caller itself.
 */
const DEFERRAL_SOURCES = {
  'concurrency-slot-timeout': 'internal-query-gate',
  'curator-queue-wait-timeout': 'curator-job-queue',
  'caller-aborted': 'caller',
} as const;

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
 * returned no JSON (`recordCuratorNoOutput`).
 *
 * Note what is NOT on this list: a pass that dispatched and whose call FAILED
 * still reports `'ran'` (`recordCuratorError`). Every `'stalled'` member is a
 * pass whose input was demonstrably never read.
 *
 * Required, not optional, so every construction site has to answer. The zero
 * counts on the two arms are identical, which is precisely why the counts
 * cannot carry this distinction themselves.
 */
export type CuratorRunOutcome = 'ran' | 'stalled';

export interface CuratorRunStats {
  readonly outcome: CuratorRunOutcome;
  readonly extracted: number;
  readonly merged: number;
  readonly created: number;
  readonly skipped: number;
}

export type MemoryCuratorEventListener = (event: MemoryCuratorEvent) => void;

@injectable()
export class MemoryCuratorService {
  private static readonly RING_CAPACITY = 200;
  private disposer: (() => void) | null = null;
  private running: Promise<unknown> | null = null;
  private readonly events: MemoryCuratorEvent[] = [];
  private lastRunAtMs: number | null = null;
  private lastRunStatsCache: CuratorRunStats | null = null;
  private readonly inFlight = new Map<string, Promise<CuratorRunStats>>();
  private readonly eventListeners = new Set<MemoryCuratorEventListener>();
  private readonly autoRebuildState = new Map<
    string,
    { lastRebuildAt: number }
  >();
  /** The window-and-extract collaborator. See its own file for why it is not injected. */
  private readonly windowRunner: CuratorWindowRunner;
  /**
   * One curation pass at a time (TASK_2026_376 F4). Constructed here rather
   * than injected for the same reason as {@link windowRunner}: no lifecycle, no
   * alternative implementation, no other consumer. Its being a field of this
   * SINGLETON service is what makes "one pass at a time" a host-wide property.
   */
  private readonly jobQueue = new CuratorJobQueue();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(MEMORY_CONTRACT_TOKENS.COMPACTION_CALLBACK_REGISTRY)
    private readonly registry: ICompactionCallbackRegistry,
    @inject(MEMORY_TOKENS.MEMORY_STORE) private readonly store: MemoryStore,
    @inject(MEMORY_TOKENS.MEMORY_SALIENCE_SCORER)
    private readonly scorer: SalienceScorer,
    @inject(MEMORY_CONTRACT_TOKENS.TRANSCRIPT_READER)
    private readonly transcriptReader: ITranscriptReader,
    @inject(MEMORY_TOKENS.CURATOR_LLM) private readonly llm: ICuratorLLM,
    @inject(MEMORY_TOKENS.CORPUS_STORE, { isOptional: true })
    private readonly corpusStore: CorpusStore | null = null,
    @inject(MEMORY_TOKENS.KNOWLEDGE_AGENT_SERVICE, { isOptional: true })
    private readonly knowledgeAgent: KnowledgeAgentService | null = null,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER, { isOptional: true })
    private readonly workspace: IWorkspaceProvider | null = null,
    @inject(PLATFORM_TOKENS.TRACER)
    private readonly tracer: ITracer = new NoopTracer(),
  ) {
    this.windowRunner = new CuratorWindowRunner(this.logger, this.llm);
  }

  /** Begin listening for PreCompact events. Idempotent. */
  start(): void {
    if (this.disposer) return;
    this.disposer = this.registry.register((data) => {
      if (data.sessionId.startsWith(INTERNAL_QUERY_SESSION_PREFIX)) {
        this.logger.debug(
          '[memory-curator] ignoring a PreCompact fan-out for an internal one-shot query; it names no session',
          { sessionId: data.sessionId, trigger: data.trigger },
        );
        return;
      }
      this.running = (async () => {
        const cwd =
          typeof data.cwd === 'string' && data.cwd.length > 0 ? data.cwd : null;
        let transcript = '';
        if (cwd) {
          try {
            transcript = await this.transcriptReader.read(data.sessionId, cwd);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn('[memory-curator] transcript read failed', {
              sessionId: data.sessionId,
              error: message,
            });
          }
        }
        if (!transcript) {
          this.logger.warn(
            '[memory-curator] PreCompact transcript unavailable — falling back to placeholder',
            { sessionId: data.sessionId, hasCwd: !!cwd },
          );
          return this.curate({ sessionId: data.sessionId });
        }
        return this.curate({
          sessionId: data.sessionId,
          workspaceRoot: cwd,
          transcript,
          // The ONLY narrowing call site. `trigger` is carried on the
          // PreCompact fan-out payload precisely so a subscriber can tell "the
          // user asked for this" from "a threshold tripped".
          maxWindows:
            data.trigger === 'manual'
              ? MANUAL_COMPACTION_MAX_WINDOWS
              : undefined,
        });
      })().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.pushEvent({
          kind: 'error',
          timestamp: Date.now(),
          error: message,
        });
        this.logger.error(
          '[memory-curator] curate() failed',
          err instanceof Error ? err : new Error(String(err)),
        );
      });
    });
    this.logger.info('[memory-curator] started — subscribed to PreCompact');
  }

  pushEvent(ev: MemoryCuratorEvent): void {
    this.events.push(ev);
    if (this.events.length > MemoryCuratorService.RING_CAPACITY) {
      this.events.shift();
    }
    for (const listener of this.eventListeners) {
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
    this.eventListeners.add(listener);
    return {
      dispose: () => {
        this.eventListeners.delete(listener);
      },
    };
  }

  recentEvents(limit = 10): readonly MemoryCuratorEvent[] {
    const safe = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;
    return this.events.slice(-safe);
  }

  lastRunInfo(): {
    readonly at: number | null;
    readonly stats: CuratorRunStats | null;
  } {
    return { at: this.lastRunAtMs, stats: this.lastRunStatsCache };
  }

  /**
   * Public hook for {@link MemoryDecayJob} to push a `decay-run` event into
   * this service's ring buffer. Kept narrow so callers cannot forge other
   * event kinds via the public surface.
   */
  recordDecayEvent(stats: MemoryDecayStats, timestamp = Date.now()): void {
    this.pushEvent({ kind: 'decay-run', timestamp, stats: { ...stats } });
  }

  /** Stop listening. Safe to call multiple times. */
  stop(): void {
    if (this.disposer) {
      this.disposer();
      this.disposer = null;
      this.logger.info('[memory-curator] stopped');
    }
  }

  /**
   * Run the curator pipeline against an arbitrary transcript. Exposed
   * publicly for the `memory:rebuildIndex` flow and for direct callers
   * that want to feed a transcript without waiting for compaction.
   */
  async curate(input: {
    sessionId: string;
    workspaceRoot?: string | null;
    transcript?: string;
    tier?: MemoryTier;
    salienceBoost?: number;
    signal?: AbortSignal;
    /**
     * Narrow this pass's window budget. Clamped into
     * `[1, CURATOR_MAX_WINDOWS]` downstream, so it can only LOWER the ceiling.
     * Omit it — every caller but the manual PreCompact path does — to keep the
     * full budget.
     */
    maxWindows?: number;
  }): Promise<CuratorRunStats> {
    const key = this.coalesceKey(input);
    const existing = key === null ? undefined : this.inFlight.get(key);
    if (existing) return existing;
    // Queued, not spawned. Coalescing is checked FIRST, so a second trigger for
    // a session already in the queue joins that entry instead of adding one —
    // the queue holds distinct passes only. See `CuratorJobQueue` for why
    // serialising here is free: the `memory-curator` internal-query lane admits
    // one query at a time already, and this is where that wait becomes ordered
    // instead of a 60 s ceiling each of a pass's windows must win separately.
    const work = this.jobQueue
      .run(() =>
        this.tracer.startSpan(
          'memory.curate',
          { op: 'ai.curate', trigger: input.tier ?? 'recall' },
          () => this.doCurate(input),
        ),
      )
      .catch((error: unknown) => {
        // A pass that never got its turn is a deferral, not a failure: no
        // prompt was sent and the input is exactly where it was. Reporting it
        // as a rejection would surface a stack trace on the `memory:runNow`
        // RPC and, worse, let the trigger service's error path decide what to
        // do with observations that were never read (TASK_2026_376 R1).
        if (error instanceof CuratorQueueWaitTimeoutError) {
          return this.recordCuratorDeferral(input.sessionId, {
            reason: 'curator-queue-wait-timeout',
            stage: 'extract',
            completedWindows: 0,
            windows: 0,
            retriesSpent: 0,
          });
        }
        throw error;
      })
      .finally(() => {
        if (key !== null) this.inFlight.delete(key);
      });
    if (key !== null) this.inFlight.set(key, work);
    return work;
  }

  /**
   * The in-flight coalescing key, or `null` when this run must NOT coalesce.
   *
   * Coalescing is keyed on identity, and an empty session id is not one. Two
   * unrelated sessions in the same workspace both arriving with `''` produced
   * the identical key `"/ws::"`, so the second caller was handed the FIRST
   * session's promise: session B's transcript was never curated, while its
   * caller received A's `CuratorRunStats` and reported success. Silent
   * cross-session curation loss, indistinguishable from a clean run.
   *
   * Returning `null` lets both runs proceed independently. It is deliberately
   * not a rejection — the transcript is still real work, and the memories it
   * produces are stored with a NULL session (see {@link MemoryStore}), which is
   * the honest record of "we do not know which session this came from".
   */
  private coalesceKey(input: {
    sessionId: string;
    workspaceRoot?: string | null;
  }): string | null {
    const sessionId = blankToUndefined(input.sessionId);
    if (sessionId === undefined) return null;
    return `${input.workspaceRoot ?? ''}::${sessionId}`;
  }

  /**
   * Re-point the in-flight coalescing keys of `fromId` onto `toId`.
   *
   * Called synchronously from `MemoryTriggerService.rekeySession` when the SDK
   * resolves a session's canonical UUID (TASK_2026_296 item 6, Part B). Without
   * it a curate started under the tabId keeps the suppression guard on the old
   * key, so a second curate triggered under the UUID would run concurrently —
   * a double-curate, which is exactly what {@link curate}'s coalescing exists
   * to prevent.
   *
   * ## The key is `${workspaceRoot ?? ''}::${sessionId}`, so this is a suffix
   * migration, not a lookup
   *
   * One session can hold entries under several workspace roots, so every key
   * whose trailing segment equals `fromId` moves. The split is on the LAST
   * `::` because a session id never contains one (a tabId and an SDK session
   * id are both UUID v4) while a Windows workspace root plausibly could.
   *
   * ## Refuse-overwrite
   *
   * Mirrors `SessionRegistry.bindRealSessionId`: when the destination key
   * already holds a promise, that promise WINS and the `fromId` entry is left
   * exactly where it is — it still owns a real run whose own `.finally` will
   * clear it. Never clobber; a missed merge is recoverable, a lost in-flight
   * handle is not.
   *
   * ## Why the cleanup is re-armed
   *
   * {@link curate} attaches `.finally(() => this.inFlight.delete(key))` with
   * the ORIGINAL key captured in the closure. After a move that delete is a
   * no-op, so the migrated entry would otherwise sit under `toId` forever and
   * every later curate for that session would be handed a long-settled
   * promise. The re-armed cleanup below is what keeps the map self-draining; it
   * is guarded on identity so it cannot delete a newer entry that replaced it.
   */
  rekeySession(fromId: string, toId: string): void {
    const from = blankToUndefined(fromId);
    const to = blankToUndefined(toId);
    if (from === undefined || to === undefined || from === to) return;

    for (const [key, work] of [...this.inFlight]) {
      const split = key.lastIndexOf('::');
      if (split < 0 || key.slice(split + 2) !== from) continue;
      const nextKey = key.slice(0, split).concat('::', to);
      if (this.inFlight.has(nextKey)) continue;

      this.inFlight.delete(key);
      this.inFlight.set(nextKey, work);
      const clear = (): void => {
        if (this.inFlight.get(nextKey) === work) this.inFlight.delete(nextKey);
      };
      void work.then(clear, clear);
    }
  }

  /**
   * The one place a transcript is bounded before it reaches the model.
   *
   * Deliberately here and not at any call site. The fault this closes
   * (TASK_2026_352) was a call site that forgot: the memory boot scan read a
   * whole session with no `tailBytes` and skipped `composeTranscript`, the only
   * clamp on the live path, producing a 170 655-character prompt
   * (`tmp/logs/log.log:1017`). Every entry — the PreCompact handler, the boot
   * scan, `memory:rebuildIndex`, `curateNow` — funnels through `doCurate`, so a
   * cap here cannot be bypassed by a caller that forgets a parameter.
   *
   * What changed in TASK_2026_367 is the SHAPE of the bound, not its place: a
   * transcript now becomes a bounded SET of windows rather than one clamped
   * string, so the middle of a long session reaches the model instead of being
   * elided. The cost stays bounded because the set is — see
   * {@link CURATOR_MAX_WINDOWS}.
   *
   * TASK_2026_374 lets a caller NARROW that set, and nothing else. `maxWindows`
   * is clamped into `[1, CURATOR_MAX_WINDOWS]` by `clampWindowBudget` inside
   * `CuratorWindowRunner.planWindows`, so a call site can spend less than the
   * ceiling but can never widen it — which is what keeps the sentence at the
   * top of this comment true. The clamp lives one level down because
   * `planWindows` is the single seam between this service and the pure
   * windowing module; putting it here would leave the runner's own contract
   * open.
   */
  private windowForModel(
    transcript: string,
    sessionId: string,
    maxWindows?: number,
  ): readonly CuratorWindow[] {
    return this.windowRunner.planWindows(transcript, sessionId, maxWindows);
  }

  /** Internal worker. Public callers must use {@link curate}, which dedupes. */
  private async doCurate(input: {
    sessionId: string;
    workspaceRoot?: string | null;
    transcript?: string;
    tier?: MemoryTier;
    salienceBoost?: number;
    signal?: AbortSignal;
    maxWindows?: number;
  }): Promise<CuratorRunStats> {
    // A pass can sit in the job queue for minutes, and the caller that queued it
    // may have withdrawn in that time. Running the pipeline for it would spend a
    // provider call and a lane slot on a result nobody reads, and would consume
    // the session's observations to produce it (TASK_2026_376 R1). The abort is
    // checked again between windows by `CuratorWindowRunner`; this is the one
    // check that happens before any work at all.
    if (input.signal?.aborted) {
      return this.recordCuratorDeferral(input.sessionId, {
        reason: 'caller-aborted',
        stage: 'extract',
        completedWindows: 0,
        windows: 0,
        retriesSpent: 0,
      });
    }
    const transcript =
      (input.transcript ?? '').trim() || TRANSCRIPT_PLACEHOLDER;
    const tier: MemoryTier = input.tier ?? 'recall';

    if (transcript === TRANSCRIPT_PLACEHOLDER) {
      const emptyStats: CuratorRunStats = {
        outcome: 'ran',
        extracted: 0,
        merged: 0,
        created: 0,
        skipped: 0,
      };
      this.lastRunAtMs = Date.now();
      this.lastRunStatsCache = emptyStats;
      this.pushEvent({
        kind: 'curator-skipped-no-data',
        timestamp: this.lastRunAtMs,
        sessionId: input.sessionId,
      });
      return emptyStats;
    }

    const windows = this.windowForModel(
      transcript,
      input.sessionId,
      input.maxWindows,
    );
    // ONE allowance for the whole pass — every extract window and the resolve
    // call spend the same budget. See `QueueSlotRetryBudget`.
    const retryBudget = new QueueSlotRetryBudget();
    const extraction = await this.windowRunner.extractAcrossWindows(
      windows,
      input.signal,
      retryBudget,
    );
    if (extraction.status === 'deferred') {
      return this.recordCuratorDeferral(input.sessionId, {
        reason: 'concurrency-slot-timeout',
        stage: 'extract',
        completedWindows: extraction.completedWindows,
        windows: windows.length,
        retriesSpent: extraction.retriesSpent,
      });
    }
    if (extraction.status === 'failed') {
      return this.recordCuratorError(
        input.sessionId,
        extraction.error,
        'extract',
      );
    }
    if (extraction.status === 'aborted') {
      return this.recordCuratorError(
        input.sessionId,
        new Error(
          `aborted after ${extraction.completedWindows} of ${windows.length} windows`,
        ),
        'extract',
      );
    }
    if (extraction.status === 'stalled') {
      return this.recordCuratorStall(input.sessionId, extraction);
    }
    if (extraction.status === 'no-output') {
      return this.recordCuratorNoOutput(input.sessionId, extraction);
    }
    const drafts = extraction.drafts;
    if (drafts.length === 0) {
      const emptyStats: CuratorRunStats = {
        outcome: 'ran',
        extracted: 0,
        merged: 0,
        created: 0,
        skipped: 0,
      };
      this.lastRunAtMs = Date.now();
      this.lastRunStatsCache = emptyStats;
      this.pushEvent({
        kind: 'curator-run',
        timestamp: this.lastRunAtMs,
        sessionId: input.sessionId,
        stats: { extracted: 0, merged: 0, created: 0, skipped: 0 },
      });
      return emptyStats;
    }
    const subjects = new Set(
      drafts.map((d) => d.subject).filter((s): s is string => !!s),
    );
    const related =
      subjects.size > 0
        ? this.store
            .list({ workspaceRoot: input.workspaceRoot ?? null, limit: 200 })
            .memories.filter((m) => m.subject && subjects.has(m.subject))
            .map((m) => ({ id: m.id, subject: m.subject, content: m.content }))
        : [];

    let resolved: readonly ResolvedMemoryDraft[];
    try {
      resolved = await this.resolveWithinBudget(
        drafts,
        related,
        retryBudget,
        input.signal,
      );
    } catch (error: unknown) {
      // The resolve call queues for a slot exactly as the extract windows do,
      // so the same congestion can strike it — after the extracts have already
      // run. Deferring discards those drafts and re-curates the transcript next
      // pass, which costs the extracts again but loses nothing. Recording a run
      // here would mark the observation rows processed and lose the session.
      if (isQueueSlotTimeout(error) && !input.signal?.aborted) {
        return this.recordCuratorDeferral(input.sessionId, {
          reason: 'concurrency-slot-timeout',
          stage: 'resolve',
          completedWindows: windows.length,
          windows: windows.length,
          retriesSpent: retryBudget.spent,
        });
      }
      return this.recordCuratorError(
        input.sessionId,
        error,
        'resolve',
        drafts.length,
      );
    }

    let merged = 0;
    let created = 0;
    let skipped = 0;
    const now = Date.now();

    for (const r of resolved) {
      try {
        if (r.mergeTargetId) {
          const target = this.store.getById(memoryId(r.mergeTargetId));
          if (target) {
            await this.store.appendChunks(target.id, [
              {
                ord: 0,
                text: r.content,
                tokenCount: this.estimateTokens(r.content),
              },
            ]);
            const newSalience = this.scorer.score({
              base: Math.max(target.salience, r.salienceHint),
              tier: target.tier,
              pinned: target.pinned,
              hits: target.hits,
              lastUsedAt: now,
              now,
            });
            this.store.updateSalience(target.id, newSalience);
            merged++;
            continue;
          }
        }
        const baseSalience = Math.min(
          1,
          r.salienceHint + (input.salienceBoost ?? 0),
        );
        const memorySalience = this.scorer.score({
          base: baseSalience,
          tier,
          pinned: false,
          hits: 0,
          lastUsedAt: now,
          now,
        });
        await this.store.insertMemoryWithChunks(
          {
            sessionId: input.sessionId,
            workspaceRoot: input.workspaceRoot ?? null,
            tier,
            kind: r.kind,
            subject: r.subject,
            content: r.content,
            salience: memorySalience,
            request: r.request ?? null,
            investigated: r.investigated ?? null,
            learned: r.learned ?? null,
            completed: r.completed ?? null,
            nextSteps: r.nextSteps ?? null,
            type: r.type,
            concepts: r.concepts,
            files: r.files,
          },
          [
            {
              ord: 0,
              text: r.content,
              tokenCount: this.estimateTokens(r.content),
            },
          ],
        );
        created++;
      } catch (err) {
        skipped++;
        this.logger.warn('[memory-curator] failed to persist resolved draft', {
          subject: r.subject,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const stats: CuratorRunStats = {
      outcome: 'ran',
      extracted: drafts.length,
      merged,
      created,
      skipped,
    };
    this.lastRunAtMs = Date.now();
    this.lastRunStatsCache = stats;
    this.pushEvent({
      kind: 'curator-run',
      timestamp: this.lastRunAtMs,
      sessionId: input.sessionId,
      stats: {
        extracted: stats.extracted,
        merged: stats.merged,
        created: stats.created,
        skipped: stats.skipped,
      },
    });
    this.triggerCorpusAutoRebuild(stats.created, input.workspaceRoot ?? null);
    return stats;
  }

  /**
   * The provider quota gate stopped this pass before it reached the model.
   *
   * Three things this deliberately does NOT do, each of which would re-open F1
   * through a different route:
   *
   *  - it does not touch `lastRunAtMs` / `lastRunStatsCache`. "Last run" means
   *    the last pass that ran; a stall would otherwise overwrite a real run's
   *    stats with zeroes and make the diagnostics panel report a clean empty
   *    pass while nothing had happened.
   *  - it does not push `curator-run`. That event is the Activity surface's
   *    record of work performed. `rate-limited` already exists in the event
   *    union, already renders as a warning, and already means exactly this.
   *  - it does not persist anything, so the auto-rebuild hook never fires.
   *
   * The returned `outcome: 'stalled'` is the whole product of this method. Its
   * only consumer that matters is `MemoryTriggerService.invokeCurate`, which
   * uses it to keep the drained `observation_queue` rows unprocessed.
   */
  private recordCuratorStall(
    sessionId: string,
    extraction: Extract<CuratorExtraction, { status: 'stalled' }>,
  ): CuratorRunStats {
    this.pushEvent({
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
    return {
      outcome: 'stalled',
      extracted: 0,
      merged: 0,
      created: 0,
      skipped: 0,
    };
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
   * where it is. Same shape as {@link recordCuratorStall} — no `lastRunAtMs`, no
   * `curator-run`, nothing persisted.
   *
   * The cost of being wrong is bounded and asymmetric. A model that answers this
   * way on every pass re-curates the same session each drain, which spends
   * prompts; consuming the input instead loses the session's memories for good.
   */
  private recordCuratorNoOutput(
    sessionId: string,
    extraction: Extract<CuratorExtraction, { status: 'no-output' }>,
  ): CuratorRunStats {
    this.pushEvent({
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
      outcome: 'stalled',
      extracted: 0,
      merged: 0,
      created: 0,
      skipped: 0,
    };
  }

  /**
   * Re-submit the resolve call while the pass can still afford it.
   *
   * The twin of `CuratorWindowRunner.extractOneWindow`, and deliberately not a
   * shared generic helper: two call sites do not make a pattern, and the two
   * differ in what they do when the budget runs out — the runner reports a
   * `deferred` arm to its caller, this one throws to the caller's own catch.
   */
  private async resolveWithinBudget(
    drafts: readonly ExtractedMemoryDraft[],
    related: readonly { id: string; subject: string | null; content: string }[],
    budget: QueueSlotRetryBudget,
    signal?: AbortSignal,
  ): Promise<readonly ResolvedMemoryDraft[]> {
    for (;;) {
      try {
        return await this.llm.resolve(drafts, related, signal);
      } catch (error: unknown) {
        if (!isQueueSlotTimeout(error)) throw error;
        if (signal?.aborted) throw error;
        if (!budget.tryConsume()) throw error;
        this.logger.info(
          '[memory-curator] resolve lost its concurrency slot; re-queuing it',
          { retriesSpent: budget.spent },
        );
      }
    }
  }

  /**
   * A gate stopped this pass before it could dispatch — TASK_2026_376 F4, and
   * two more gates in R1.
   *
   * Deliberately the same shape as {@link recordCuratorStall}, because the
   * caller's decision is the same one: the input was not consumed, so leave it
   * where it is and curate it on the next drain. It therefore touches neither
   * `lastRunAtMs` nor `lastRunStatsCache`, pushes no `curator-run`, and
   * persists nothing.
   *
   * The event is `rate-limited` rather than a new kind. `MemoryCuratorEventKind`
   * is consumed by the Activity surface, which already renders that kind as a
   * warning meaning "a gate stopped this"; the `reason` in `stats` is what tells
   * the gates apart, and `stats` is a free-form record. A new kind would be a
   * frontend change for a distinction the frontend does not draw.
   */
  private recordCuratorDeferral(
    sessionId: string,
    detail: {
      /**
       * Which gate stopped the pass. All three share this method because the
       * caller's decision is identical — the input was never read — and they
       * are named apart because an operator diagnosing a quiet curator needs
       * to know whether the host is congested, the queue is backed up, or the
       * caller simply withdrew.
       */
      readonly reason:
        | 'concurrency-slot-timeout'
        | 'curator-queue-wait-timeout'
        | 'caller-aborted';
      readonly stage: 'extract' | 'resolve';
      readonly completedWindows: number;
      readonly windows: number;
      readonly retriesSpent: number;
    },
  ): CuratorRunStats {
    this.pushEvent({
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
    this.logger.warn(
      '[memory-curator] curation pass never dispatched; input left untouched for the next pass',
      { sessionId, ...detail },
    );
    return {
      outcome: 'stalled',
      extracted: 0,
      merged: 0,
      created: 0,
      skipped: 0,
    };
  }

  private recordCuratorError(
    sessionId: string,
    error: unknown,
    stage: 'extract' | 'resolve',
    extractedCount = 0,
  ): CuratorRunStats {
    const detail = error instanceof Error ? error.message : String(error);
    const message =
      stage === 'extract'
        ? `memory extraction failed: ${detail}`
        : `memory resolution failed (${extractedCount} extracted): ${detail}`;
    // `'ran'`, not `'stalled'`: the call was dispatched and failed. Whether a
    // FAILED pass should also preserve its input is a separate question from
    // F1 (which is about a pass that never ran) and is deliberately left at its
    // pre-existing behaviour here. The one failure that no longer reaches this
    // method is the concurrency-slot timeout — it never dispatched either, so
    // it belongs with the stalls (`recordCuratorDeferral`, TASK_2026_376 F4).
    const zeroedStats: CuratorRunStats = {
      outcome: 'ran',
      extracted: 0,
      merged: 0,
      created: 0,
      skipped: 0,
    };
    this.lastRunAtMs = Date.now();
    this.lastRunStatsCache = zeroedStats;
    this.pushEvent({
      kind: 'curator-error',
      timestamp: this.lastRunAtMs,
      sessionId,
      error: message,
    });
    this.logger.warn('[memory-curator] curator LLM run failed', {
      sessionId,
      stage,
      extracted: extractedCount,
      error: detail,
    });
    return zeroedStats;
  }

  /**
   * Fire-and-forget post-curate hook: rebuilds every workspace-scoped corpus
   * so they re-include the freshly-created memories.
   *
   * Must NOT block `running` — failures are logged and swallowed.
   */
  private triggerCorpusAutoRebuild(
    created: number,
    workspaceRoot: string | null,
  ): void {
    if (created <= 0) return;
    if (!workspaceRoot) return;
    if (!this.knowledgeAgent || !this.corpusStore) return;
    const enabled =
      this.workspace?.getConfiguration<boolean>(
        AUTO_REBUILD_SECTION,
        AUTO_REBUILD_KEY,
        true,
      ) ?? true;
    if (!enabled) return;
    let corpora: readonly { readonly name: string }[];
    try {
      corpora = this.corpusStore.list({ workspaceRoot });
    } catch (err: unknown) {
      this.logger.warn('[memory-curator] auto-rebuild corpus listing failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const now = Date.now();
    for (const c of corpora) {
      const key = `${workspaceRoot}::${c.name}`;
      const state = this.autoRebuildState.get(key);
      if (state && now - state.lastRebuildAt < AUTO_REBUILD_THROTTLE_MS) {
        continue;
      }
      this.autoRebuildState.set(key, { lastRebuildAt: now });
      this.knowledgeAgent.rebuildCorpus(c.name).catch((err: unknown) => {
        this.logger.warn('[memory-curator] auto-rebuild failed for corpus', {
          name: c.name,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  /**
   * Wait for the most recent in-flight curate() invocation to settle.
   * Used by tests and graceful-shutdown flows.
   *
   * Does NOT re-throw: the fire-and-forget path in `start()` already catches
   * and logs errors via `.catch()`, so `this.running` always resolves.
   */
  async drain(): Promise<void> {
    if (this.running) await this.running;
  }

  /** Coarse token estimate ~ 4 chars per token. */
  private estimateTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }
}
