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

/**
 * The outcome of a whole window set.
 *
 * The two arms of {@link CuratorExtraction} are carried through unchanged, so
 * the service's existing handling of `extracted` and `stalled` is the same code
 * it always was. The two new arms are the failures a LOOP can have that a
 * single call cannot: a call that threw partway through, and an abort noticed
 * between windows.
 */
export type WindowedExtraction =
  | CuratorExtraction
  | { readonly status: 'failed'; readonly error: unknown }
  | { readonly status: 'aborted'; readonly completedWindows: number };

export class CuratorWindowRunner {
  constructor(
    private readonly logger: Logger,
    private readonly llm: ICuratorLLM,
  ) {}

  /**
   * Plan the prompts one transcript costs.
   *
   * The warn is not decoration. It now fires only when a session exceeded even
   * the CHUNKED budget — eight windows of compressed text — which is a far
   * stronger signal than the old one: the transcript is genuinely enormous, and
   * the head-and-tail clamp is the last thing standing between it and the
   * model.
   */
  planWindows(transcript: string, sessionId: string): readonly CuratorWindow[] {
    const plan = planCuratorWindows(transcript);
    const clamped = plan.clamped;
    if (clamped) {
      this.logger.warn(
        '[memory-curator] transcript exceeded the chunked curation budget; head and tail kept',
        {
          sessionId,
          cap: CURATOR_WINDOW_MAX_CHARS * CURATOR_MAX_WINDOWS,
          originalChars: clamped.originalChars,
          keptChars: clamped.keptChars,
          droppedChars: clamped.droppedChars,
          droppedRecords: clamped.droppedRecords,
        },
      );
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
   *
   * Duplicate `(subject, content)` pairs are dropped. Adjacent windows describe
   * one session, so the same durable fact is expected to surface more than
   * once, and sending the resolver eight copies of it costs prompt budget to
   * produce a merge decision the union has already made.
   */
  async extractAcrossWindows(
    windows: readonly CuratorWindow[],
    signal?: AbortSignal,
  ): Promise<WindowedExtraction> {
    const drafts: ExtractedMemoryDraft[] = [];
    const seen = new Set<string>();
    let completedWindows = 0;

    for (const chunk of windows) {
      if (signal?.aborted) return { status: 'aborted', completedWindows };
      let extraction: CuratorExtraction;
      try {
        extraction = await this.llm.extract(chunk.text, signal);
      } catch (error: unknown) {
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
}
