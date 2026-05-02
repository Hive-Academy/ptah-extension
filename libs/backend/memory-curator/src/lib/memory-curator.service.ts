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
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { CompactionCallbackRegistry } from '@ptah-extension/agent-sdk';
import { MEMORY_TOKENS } from './di/tokens';
import { MemoryStore } from './memory.store';
import { SalienceScorer } from './salience-scorer';
import type { ICuratorLLM } from './curator-llm/curator-llm.interface';
import { memoryId, type MemoryTier } from './memory.types';

const TRANSCRIPT_PLACEHOLDER =
  '[Compaction transcript window unavailable; curator running on session metadata only.]';

export interface CuratorRunStats {
  readonly extracted: number;
  readonly merged: number;
  readonly created: number;
  readonly skipped: number;
}

@injectable()
export class MemoryCuratorService {
  private disposer: (() => void) | null = null;
  private running: Promise<unknown> | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_COMPACTION_CALLBACK_REGISTRY)
    private readonly registry: CompactionCallbackRegistry,
    @inject(MEMORY_TOKENS.MEMORY_STORE) private readonly store: MemoryStore,
    @inject(MEMORY_TOKENS.MEMORY_SALIENCE_SCORER)
    private readonly scorer: SalienceScorer,
    @inject(MEMORY_TOKENS.CURATOR_LLM) private readonly llm: ICuratorLLM,
  ) {}

  /** Begin listening for PreCompact events. Idempotent. */
  start(): void {
    if (this.disposer) return;
    this.disposer = this.registry.register((data) => {
      // Fire-and-forget — never block the SDK callback path.
      this.running = this.curate({ sessionId: data.sessionId }).catch((err) => {
        this.logger.error(
          '[memory-curator] curate() failed',
          err instanceof Error ? err : new Error(String(err)),
        );
      });
    });
    this.logger.info('[memory-curator] started — subscribed to PreCompact');
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
    signal?: AbortSignal;
  }): Promise<CuratorRunStats> {
    const transcript =
      (input.transcript ?? '').trim() || TRANSCRIPT_PLACEHOLDER;
    const tier: MemoryTier = input.tier ?? 'recall';
    const drafts = await this.llm.extract(transcript, input.signal);
    if (drafts.length === 0) {
      return { extracted: 0, merged: 0, created: 0, skipped: 0 };
    }

    // Build the related-memory list from existing rows that share a subject.
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

    const resolved = await this.llm.resolve(drafts, related, input.signal);

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
        const baseSalience = r.salienceHint;
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

    return { extracted: drafts.length, merged, created, skipped };
  }

  /**
   * Wait for the most recent in-flight curate() invocation to settle.
   * Used by tests and graceful-shutdown flows.
   */
  async drain(): Promise<void> {
    if (this.running) await this.running;
  }

  /** Coarse token estimate ~ 4 chars per token. */
  private estimateTokens(text: string): number {
    return Math.max(1, Math.ceil(text.length / 4));
  }
}
