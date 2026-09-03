/**
 * The window-and-extract half of the curation pipeline, extracted from
 * {@link MemoryCuratorService} under the facade rule: the service keeps its
 * name, its DI token and every public signature, and hands this collaborator
 * the one concern that grew — deciding how many prompts a transcript costs and
 * spending them one at a time.
 *
 * It is constructed by the service rather than injected. It has no lifecycle,
 * no alternative implementation and no other consumer, so a DI token would be
 * a registration to maintain in three composition roots for nothing.
 */
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  ICuratorLLM,
  CuratorExtraction,
  ExtractedMemoryDraft,
} from './curator-llm.interface';
import {
  planCuratorWindows,
  CURATOR_MAX_WINDOWS,
  CURATOR_WINDOW_MAX_CHARS,
  type CuratorWindow,
} from './transcript-windows';
import { isQueueSlotTimeout, QueueSlotRetryBudget } from './queue-slot-timeout';

/**
 * The outcome of a whole window set.
 *
 * The two arms of {@link CuratorExtraction} are carried through unchanged, so
 * the service's existing handling of `extracted` and `stalled` is the same code
 * it always was. The three remaining arms are the failures a LOOP can have that
 * a single call cannot: a call that threw partway through, an abort noticed
 * between windows, and a window that never reached the model because the host
 * was congested.
 */
export type WindowedExtraction =
  | CuratorExtraction
  | { readonly status: 'failed'; readonly error: unknown }
  | { readonly status: 'aborted'; readonly completedWindows: number }
  | {
      readonly status: 'deferred';
      readonly reason: 'concurrency-slot-timeout';
      readonly completedWindows: number;
      readonly retriesSpent: number;
    };

/**
 * Force a requested window budget into `[1, CURATOR_MAX_WINDOWS]`.
 *
 * A caller may only LOWER the ceiling, never raise it. `windowForModel` is
 * documented as THE one place a transcript is bounded before it reaches the
 * model, and that stays true only while the bound is a clamp rather than a
 * number the call site supplies — a parameter a caller can widen is not a
 * bound, it is a suggestion, and the fault TASK_2026_352 closed was precisely a
 * call site that got the bounding wrong.
 *
 * `undefined`, a non-finite value and anything at or above the ceiling all
 * resolve to {@link CURATOR_MAX_WINDOWS}, so every entry point that does not
 * deliberately narrow keeps the full eight-window budget.
 */
export function clampWindowBudget(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return CURATOR_MAX_WINDOWS;
  }
  return Math.min(CURATOR_MAX_WINDOWS, Math.max(1, Math.floor(requested)));
}

export class CuratorWindowRunner {
  constructor(
    private readonly logger: Logger,
    private readonly llm: ICuratorLLM,
  ) {}

  /**
   * Plan the prompts one transcript costs.
   *
   * `maxWindows` narrows the budget for this pass only and is clamped by
   * {@link clampWindowBudget}, so a call site cannot widen it. The one caller
   * that narrows is a MANUAL PreCompact (TASK_2026_374): the user asked for a
   * compaction to happen now, and eight sequential background extract calls on
   * the same account and quota — roughly four minutes of `claude.EXE` measured
   * on a 372-event session — are a cost they did not ask for. Automatic
   * threshold compaction keeps the full budget, because nobody is waiting on it.
   *
   * The clamp report is logged at two DIFFERENT levels, and that is the point.
   * At the full budget it means "this session defeated even the chunked
   * budget", which is rare and worth a warn. Under a narrowed budget the clamp
   * is the expected consequence of the narrowing — every long session trips it,
   * on every manual `/compact` — so warning there would turn the line that
   * still carries the rare signal into noise people learn to scroll past.
   */
  planWindows(
    transcript: string,
    sessionId: string,
    maxWindows?: number,
  ): readonly CuratorWindow[] {
    const budgetWindows = clampWindowBudget(maxWindows);
    const plan = planCuratorWindows(transcript, { maxWindows: budgetWindows });
    const clamped = plan.clamped;
    if (clamped) {
      const detail = {
        sessionId,
        budgetWindows,
        cap: CURATOR_WINDOW_MAX_CHARS * budgetWindows,
        originalChars: clamped.originalChars,
        keptChars: clamped.keptChars,
        droppedChars: clamped.droppedChars,
        droppedRecords: clamped.droppedRecords,
      };
      if (budgetWindows < CURATOR_MAX_WINDOWS) {
        this.logger.info(
          '[memory-curator] transcript clamped to the narrowed curation budget; head and tail kept',
          detail,
        );
      } else {
        this.logger.warn(
          '[memory-curator] transcript exceeded the chunked curation budget; head and tail kept',
          detail,
        );
      }
    }
    if (plan.windows.length > 1) {
      this.logger.info(
        '[memory-curator] transcript split into curation windows',
        {
          sessionId,
          windows: plan.windows.length,
          originalChars: plan.originalChars,
          compressedChars: plan.compressedChars,
        },
      );
    }
    return plan.windows;
  }

  /**
   * Extract from every window in order, and union what comes back.
   *
   * Sequential on purpose. The windows share one provider and one quota gate,
   * so eight parallel calls would race each other into the rate limit the
   * `stalled` arm exists to respect — and a stall on window 1 makes windows 2
   * to 8 pointless anyway.
   *
   * The failure rules, each stated as a decision rather than an accident:
   *
   *  - a throw ABANDONS the run. A partial extraction that looks complete is
   *    worse than a recorded failure, because the caller advances its state on
   *    it and the transcript is never curated again.
   *  - a `stalled` window stops the loop. A stall is a cooldown, so every
   *    remaining window would stall too.
   *  - `signal.aborted` is checked BETWEEN windows, not only inside the
   *    adapter, so an abort during a long chunked run stops promptly instead of
   *    after the current provider round trip times out.
   *  - a QUEUE-SLOT TIMEOUT is retried on the same window, up to the pass's
   *    shared {@link QueueSlotRetryBudget} (TASK_2026_376 F4). That failure
   *    means the query never dispatched, so retrying costs no upstream request,
   *    and treating it as a throw is what dropped two sessions' curation: the
   *    caller recorded `extracted: 0` and marked the input consumed. When the
   *    budget runs out the run returns `deferred` rather than `failed`, which
   *    is how the caller learns to leave its input alone.
   *
   * Duplicate `(subject, content)` pairs are dropped. Adjacent windows describe
   * one session, so the same durable fact is expected to surface more than
   * once, and sending the resolver eight copies of it costs prompt budget to
   * produce a merge decision the union has already made.
   */
  async extractAcrossWindows(
    windows: readonly CuratorWindow[],
    signal?: AbortSignal,
    budget: QueueSlotRetryBudget = new QueueSlotRetryBudget(),
  ): Promise<WindowedExtraction> {
    const drafts: ExtractedMemoryDraft[] = [];
    const seen = new Set<string>();
    let completedWindows = 0;

    for (const chunk of windows) {
      if (signal?.aborted) return { status: 'aborted', completedWindows };
      let extraction: CuratorExtraction;
      try {
        extraction = await this.extractOneWindow(chunk, budget, signal);
      } catch (error: unknown) {
        // An aborted pass keeps its existing `failed` reporting. `deferred`
        // promises the caller that the pass is worth retrying, and a caller
        // that has withdrawn is not asking for that promise.
        if (isQueueSlotTimeout(error) && !signal?.aborted) {
          this.logger.info(
            '[memory-curator] curation window kept losing its concurrency slot; deferring the pass',
            {
              completedWindows,
              windows: windows.length,
              retriesSpent: budget.spent,
            },
          );
          return {
            status: 'deferred',
            reason: 'concurrency-slot-timeout',
            completedWindows,
            retriesSpent: budget.spent,
          };
        }
        return { status: 'failed', error };
      }
      if (extraction.status === 'stalled') return extraction;
      completedWindows++;
      for (const draft of extraction.drafts) {
        const key = `${draft.subject ?? ''}\u0000${draft.content}`;
        if (seen.has(key)) continue;
        seen.add(key);
        drafts.push(draft);
      }
    }

    return { status: 'extracted', drafts };
  }

  /**
   * One window, re-submitted while the pass can still afford it.
   *
   * The retry has no delay on purpose. The gate is FIFO within a lane, so a
   * re-submitted query joins the back of the queue and is woken by the release
   * of whatever is ahead of it — the wait IS the backoff, and a timer here would
   * only add latency to a pass that is already late.
   *
   * An aborted pass never retries: the caller has withdrawn, and re-queuing a
   * query whose signal is already fired spends a slot to produce nothing.
   */
  private async extractOneWindow(
    chunk: CuratorWindow,
    budget: QueueSlotRetryBudget,
    signal?: AbortSignal,
  ): Promise<CuratorExtraction> {
    for (;;) {
      try {
        return await this.llm.extract(chunk.text, signal);
      } catch (error: unknown) {
        if (!isQueueSlotTimeout(error)) throw error;
        if (signal?.aborted) throw error;
        if (!budget.tryConsume()) throw error;
        this.logger.info(
          '[memory-curator] curation window lost its concurrency slot; re-queuing it',
          { retriesSpent: budget.spent },
        );
      }
    }
  }
}
