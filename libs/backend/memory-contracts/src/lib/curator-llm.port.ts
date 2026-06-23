/**
 * Memory type taxonomy carried at the curator port boundary.
 *
 * Mirrors the claude-mem categorisation so downstream consumers (Thoth
 * timeline, knowledge agents, search filters) can reason about the
 * memory's classification without re-parsing free-form content.
 */
export type MemoryType =
  | 'bugfix'
  | 'feature'
  | 'decision'
  | 'discovery'
  | 'refactor'
  | 'change';

export interface ExtractedMemoryDraft {
  readonly kind: 'fact' | 'preference' | 'event' | 'entity';
  readonly subject: string | null;
  readonly content: string;
  readonly salienceHint: number;
  readonly request?: string;
  readonly investigated?: string;
  readonly learned?: string;
  readonly completed?: string;
  readonly nextSteps?: string;
  readonly type?: MemoryType;
  readonly concepts?: readonly string[];
  readonly files?: readonly string[];
}

export interface ResolvedMemoryDraft extends ExtractedMemoryDraft {
  readonly mergeTargetId: string | null;
}

export interface ICuratorLLM {
  extract(
    transcript: string,
    signal?: AbortSignal,
  ): Promise<readonly ExtractedMemoryDraft[]>;

  resolve(
    drafts: readonly ExtractedMemoryDraft[],
    related: readonly { id: string; subject: string | null; content: string }[],
    signal?: AbortSignal,
  ): Promise<readonly ResolvedMemoryDraft[]>;
}
