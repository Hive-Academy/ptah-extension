/**
 * ICuratorLLM — minimal contract for the small/fast LLM invocations used by
 * the curator. Implemented in this lib by `SdkInternalQueryCuratorLlm`, which
 * wraps `SdkInternalQueryService`. Tests can supply an in-memory fake.
 */
import type { MemoryKind } from '../memory.types';

export interface ExtractedMemoryDraft {
  readonly kind: MemoryKind;
  readonly subject: string | null;
  readonly content: string;
  /** Curator-provided salience hint in [0, 1]. */
  readonly salienceHint: number;
}

export interface ResolvedMemoryDraft extends ExtractedMemoryDraft {
  /** Optional id of an existing memory this draft should merge into. */
  readonly mergeTargetId: string | null;
}

export interface ICuratorLLM {
  /**
   * Extract candidate memories from a transcript window. Returns an empty
   * array when nothing notable is present.
   */
  extract(
    transcript: string,
    signal?: AbortSignal,
  ): Promise<readonly ExtractedMemoryDraft[]>;

  /**
   * Resolve duplicates by comparing drafts against existing memory subjects
   * known to be related. Returns the (possibly merged) drafts.
   */
  resolve(
    drafts: readonly ExtractedMemoryDraft[],
    related: readonly { id: string; subject: string | null; content: string }[],
    signal?: AbortSignal,
  ): Promise<readonly ResolvedMemoryDraft[]>;
}
