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
import { MEMORY_TOKENS } from './di/tokens';
import { MemoryStore } from './memory.store';
import { SalienceScorer } from './salience-scorer';
import type {
  ICuratorLLM,
  ExtractedMemoryDraft,
  ResolvedMemoryDraft,
} from './curator-llm/curator-llm.interface';
import { memoryId, type MemoryTier } from './memory.types';
import type { MemoryCuratorEvent } from './diagnostics.types';
import type { CorpusStore } from './knowledge-agents/corpus.store';
import type { KnowledgeAgentService } from './knowledge-agents/knowledge-agent.service';

const AUTO_REBUILD_SECTION = 'ptah';
const AUTO_REBUILD_KEY = 'memory.corpus.autoRebuildOnExtraction';
const AUTO_REBUILD_THROTTLE_MS = 30_000;

const TRANSCRIPT_PLACEHOLDER =
  '[Compaction transcript window unavailable; curator running on session metadata only.]';

export interface CuratorRunStats {
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
  ) {}

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
  recordDecayEvent(
    stats: Readonly<Record<string, number | string | boolean | null>>,
    timestamp = Date.now(),
  ): void {
    this.pushEvent({ kind: 'decay-run', timestamp, stats });
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
    const key = `${input.workspaceRoot ?? ''}::${input.sessionId ?? ''}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const work = this.tracer
      .startSpan(
        'memory.curate',
        { op: 'ai.curate', trigger: input.tier ?? 'recall' },
        () => this.doCurate(input),
      )
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, work);
    return work;
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

    let drafts: readonly ExtractedMemoryDraft[];
    try {
      drafts = await this.llm.extract(transcript, input.signal);
    } catch (error: unknown) {
      return this.recordCuratorError(input.sessionId, error, 'extract');
    }
    if (drafts.length === 0) {
      const emptyStats: CuratorRunStats = {
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
    const zeroedStats: CuratorRunStats = {
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
