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
  ResolvedMemoryDraft,
} from './curator-llm/curator-llm.interface';
import { CuratorWindowRunner } from './curator-llm/curator-window-runner';
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
 * Whether the pass reached the model at all — TASK_2026_306 Batch 10 (F1).
 *
 * `'ran'` covers every pass that dialled the curator LLM, including one that
 * found nothing and one whose call failed: in both cases the input was consumed
 * and the caller may advance its state. `'stalled'` means the provider quota
 * gate stopped the pass BEFORE dispatch, so the input is untouched and the
 * caller must leave it exactly where it found it.
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
  }): Promise<CuratorRunStats> {
    const key = this.coalesceKey(input);
    const existing = key === null ? undefined : this.inFlight.get(key);
    if (existing) return existing;
    const work = this.tracer
      .startSpan(
        'memory.curate',
        { op: 'ai.curate', trigger: input.tier ?? 'recall' },
        () => this.doCurate(input),
      )
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
   */
  private windowForModel(
    transcript: string,
    sessionId: string,
  ): readonly CuratorWindow[] {
    return this.windowRunner.planWindows(transcript, sessionId);
  }

  /** Internal worker. Public callers must use {@link curate}, which dedupes. */
  private async doCurate(input: {
    sessionId: string;
    workspaceRoot?: string | null;
    transcript?: string;
    tier?: MemoryTier;
    salienceBoost?: number;
    signal?: AbortSignal;
  }): Promise<CuratorRunStats> {
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

    const windows = this.windowForModel(transcript, input.sessionId);
    const extraction = await this.windowRunner.extractAcrossWindows(
      windows,
      input.signal,
    );
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
      resolved = await this.llm.resolve(drafts, related, input.signal);
    } catch (error: unknown) {
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
    // pre-existing behaviour here.
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
