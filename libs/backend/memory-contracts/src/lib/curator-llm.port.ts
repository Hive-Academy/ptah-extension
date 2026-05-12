export interface ExtractedMemoryDraft {
  readonly kind: 'fact' | 'preference' | 'event' | 'entity';
  readonly subject: string | null;
  readonly content: string;
  readonly salienceHint: number;
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
