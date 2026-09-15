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
import {
  TOKENS,
  NoopTracer,
  type BackgroundWorkAdmission,
  type Logger,
} from '@ptah-extension/vscode-core';
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
  CuratorCallOptions,
  ExtractedMemoryDraft,
  ResolvedMemoryDraft,
} from './curator-llm/curator-llm.interface';
import { CuratorWindowRunner } from './curator-llm/curator-window-runner';
import {
  CuratorActivityLog,
  type CuratorRunStats,
  type MemoryCuratorEventListener,
} from './curator-llm/curator-activity-log';
import { CuratorPassAdmission } from './curator-llm/curator-pass-admission';
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

export type {
  CuratorRunOutcome,
  CuratorRunStats,
  MemoryCuratorEventListener,
} from './curator-llm/curator-activity-log';

/** Everything one curation pass is asked to do. */
type CurateInput = CuratorCallOptions & {
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
};

/** The deferral detail of a pass stopped before its first window. */
const NOT_DISPATCHED = {
  stage: 'extract',
  completedWindows: 0,
  windows: 0,
  retriesSpent: 0,
} as const;

/** A pass that ran and stored nothing. */
const EMPTY_RUN: CuratorRunStats = {
  outcome: 'ran',
  extracted: 0,
  merged: 0,
  created: 0,
  skipped: 0,
};

@injectable()
export class MemoryCuratorService {
  private disposer: (() => void) | null = null;
  private running: Promise<unknown> | null = null;
  private readonly inFlight = new Map<string, Promise<CuratorRunStats>>();
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
  /** The event ring buffer, the last-run cache and the pass-outcome recorders. */
  private readonly activity: CuratorActivityLog;
  /** Governor clearance before the queue, and the network back-off (C14 f). */
  private readonly admission: CuratorPassAdmission;

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
    /**
     * Optional and LAST: specs construct this service positionally, and a host
     * without a governor admits every pass at once.
     */
    @inject(TOKENS.BACKGROUND_WORK_GOVERNOR, { isOptional: true })
    governor: BackgroundWorkAdmission | null = null,
  ) {
    this.windowRunner = new CuratorWindowRunner(this.logger, this.llm);
    this.activity = new CuratorActivityLog(this.logger);
    this.admission = new CuratorPassAdmission(this.logger, governor);
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
    this.activity.push(ev);
  }

  onEvent(listener: MemoryCuratorEventListener): { dispose: () => void } {
    return this.activity.onEvent(listener);
  }

  recentEvents(limit = 10): readonly MemoryCuratorEvent[] {
    return this.activity.recent(limit);
  }

  lastRunInfo(): {
    readonly at: number | null;
    readonly stats: CuratorRunStats | null;
  } {
    return this.activity.lastRunInfo();
  }

  /**
   * Milliseconds the network back-off still holds a BACKGROUND pass; `0` when
   * one may dispatch. Read by `MemoryTriggerService` before it spends an hourly
   * curate slot, so a pass that would only be deferred costs no budget
   * (TASK_2026_437 C14 f).
   */
  networkDeferralMs(): number {
    return this.admission.networkDeferralMs(false);
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
  async curate(input: CurateInput): Promise<CuratorRunStats> {
    const key = this.coalesceKey(input);
    const existing = key === null ? undefined : this.inFlight.get(key);
    if (existing) {
      if (input.userInitiated === true) this.joinAsUser(key, input.sessionId);
      return existing;
    }
    // A BACKGROUND pass waits for the governor before it claims a queue
    // position, so a pass held behind a generating turn never blocks
    // `memory:runNow` (FU-16b-a, see `CuratorPassAdmission`). `null` means no
    // wait, and keeps the submission synchronous.
    const clearance = this.admission.clearance(
      key,
      input.userInitiated === true,
      input.signal,
    );
    const admitted =
      clearance === null
        ? this.enqueue(input)
        : clearance.then((outcome) => {
            if (outcome === 'cancelled') {
              return this.activity.recordDeferral(input.sessionId, {
                reason: 'host-shutdown',
                ...NOT_DISPATCHED,
              });
            }
            return this.enqueue(
              outcome === 'promoted'
                ? { ...input, userInitiated: true }
                : input,
            );
          });
    const work = admitted.finally(() => {
      if (key !== null) this.inFlight.delete(key);
    });
    if (key !== null) this.inFlight.set(key, work);
    return work;
  }

  /**
   * A user-initiated call coalesced onto a pass for the same session. A pass
   * still waiting for governor clearance is promoted to the `user-action`
   * lane; one already past it keeps its lane — its queries are already
   * dispatched on it.
   */
  private joinAsUser(key: string | null, sessionId: string): void {
    if (this.admission.promote(key)) {
      this.logger.info(
        '[memory-curator] user-initiated curate promoted a pass waiting for background-work clearance; it runs on the user-action lane',
        { sessionId },
      );
      return;
    }
    this.logger.info(
      "[memory-curator] user-initiated curate joined an in-flight pass; it keeps that pass's lane",
      { sessionId },
    );
  }

  /**
   * Queued, not spawned. Coalescing is checked FIRST in {@link curate}, so a
   * second trigger for a session already in the queue joins that entry instead
   * of adding one — the queue holds distinct passes only. See `CuratorJobQueue`
   * for why serialising here is free: the `memory-curator` internal-query lane
   * admits one query at a time already, and this is where that wait becomes
   * ordered instead of a 60 s ceiling each of a pass's windows must win
   * separately.
   */
  private enqueue(input: CurateInput): Promise<CuratorRunStats> {
    return this.jobQueue
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
          return this.activity.recordDeferral(input.sessionId, {
            reason: 'curator-queue-wait-timeout',
            ...NOT_DISPATCHED,
          });
        }
        throw error;
      });
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
  private async doCurate(input: CurateInput): Promise<CuratorRunStats> {
    const callOptions: CuratorCallOptions = {
      userInitiated: input.userInitiated,
    };
    // A pass can sit in the job queue for minutes, and the caller that queued it
    // may have withdrawn in that time. Running the pipeline for it would spend a
    // provider call and a lane slot on a result nobody reads, and would consume
    // the session's observations to produce it (TASK_2026_376 R1). The abort is
    // checked again between windows by `CuratorWindowRunner`; this is the one
    // check that happens before any work at all.
    if (input.signal?.aborted) {
      return this.activity.recordDeferral(input.sessionId, {
        reason: 'caller-aborted',
        ...NOT_DISPATCHED,
      });
    }
    const transcript =
      (input.transcript ?? '').trim() || TRANSCRIPT_PLACEHOLDER;
    const tier: MemoryTier = input.tier ?? 'recall';

    if (transcript === TRANSCRIPT_PLACEHOLDER) {
      return this.activity.recordRun(
        input.sessionId,
        input.workspaceRoot ?? null,
        { ...EMPTY_RUN },
        true,
      );
    }
    // The provider was unreachable moments ago: a background pass waits out
    // the back-off window with its input untouched. Checked here, at dispatch,
    // so a pass queued behind the one that failed is held too (C14 f).
    if (this.admission.networkDeferralMs(input.userInitiated === true) > 0) {
      return this.activity.recordDeferral(input.sessionId, {
        reason: 'network-backoff',
        ...NOT_DISPATCHED,
      });
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
      callOptions,
    );
    this.admission.recordExtraction(extraction);
    if (extraction.status === 'deferred') {
      return this.activity.recordDeferral(input.sessionId, {
        reason: 'concurrency-slot-timeout',
        stage: 'extract',
        completedWindows: extraction.completedWindows,
        windows: windows.length,
        retriesSpent: extraction.retriesSpent,
      });
    }
    if (extraction.status === 'failed') {
      return this.activity.recordError(
        input.sessionId,
        extraction.error,
        'extract',
      );
    }
    if (extraction.status === 'aborted') {
      return this.activity.recordError(
        input.sessionId,
        new Error(
          `aborted after ${extraction.completedWindows} of ${windows.length} windows`,
        ),
        'extract',
      );
    }
    if (extraction.status === 'stalled') {
      return this.activity.recordStall(input.sessionId, extraction);
    }
    if (extraction.status === 'no-output') {
      return this.activity.recordNoOutput(input.sessionId, extraction);
    }
    const drafts = extraction.drafts;
    if (drafts.length === 0) {
      return this.activity.recordRun(
        input.sessionId,
        input.workspaceRoot ?? null,
        { ...EMPTY_RUN },
      );
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
        callOptions,
      );
    } catch (error: unknown) {
      // The resolve call queues for a slot exactly as the extract windows do,
      // so the same congestion can strike it — after the extracts have already
      // run. Deferring discards those drafts and re-curates the transcript next
      // pass, which costs the extracts again but loses nothing. Recording a run
      // here would mark the observation rows processed and lose the session.
      if (isQueueSlotTimeout(error) && !input.signal?.aborted) {
        return this.activity.recordDeferral(input.sessionId, {
          reason: 'concurrency-slot-timeout',
          stage: 'resolve',
          completedWindows: windows.length,
          windows: windows.length,
          retriesSpent: retryBudget.spent,
        });
      }
      return this.activity.recordError(
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

    const stats = this.activity.recordRun(
      input.sessionId,
      input.workspaceRoot ?? null,
      { outcome: 'ran', extracted: drafts.length, merged, created, skipped },
    );
    this.triggerCorpusAutoRebuild(stats.created, input.workspaceRoot ?? null);
    return stats;
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
    signal: AbortSignal | undefined,
    options: CuratorCallOptions,
  ): Promise<readonly ResolvedMemoryDraft[]> {
    for (;;) {
      try {
        return await this.llm.resolve(drafts, related, signal, options);
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
