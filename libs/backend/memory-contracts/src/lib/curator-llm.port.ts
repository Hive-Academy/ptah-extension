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

/**
 * Why an extraction pass never reached the model.
 *
 * One member today. It is a union rather than a boolean because the caller's
 * decision ("keep the input, this pass consumed nothing") is the same for every
 * future member, while the diagnostics text is not.
 */
export type CuratorStallReason = 'provider-cooling-down';

/**
 * The outcome of one extraction pass — TASK_2026_306 Batch 10, finding F1.
 *
 * ## Why this is not `readonly ExtractedMemoryDraft[]`
 *
 * The provider quota gate (TASK_2026_306 Batch 2) stops the curator before it
 * dials a rate-limited provider. Under the previous signature "stop" could only
 * be expressed as `[]`, which is **byte-identical to a successful pass that
 * found nothing** — and the caller acts on that difference. `MemoryTriggerService`
 * marks its drained `observation_queue` rows processed on every resolve, so a
 * stall consumed and permanently discarded the very episodes it was gated from
 * curating. Observed 15 times in a few hundred log lines on one cold start
 * (`tmp/logs/coldstart-306.log:1232-1260`).
 *
 * `status` is the discriminator. A caller that ignores it cannot reach `drafts`
 * at all — the compiler refuses — so the ambiguity cannot be re-introduced by
 * omission the way it was introduced by `[]`.
 *
 * **A stalled pass still extracts nothing.** There is no `drafts` on that arm:
 * the fix carries a signal, it does not invent a result.
 */
export type CuratorExtraction =
  | {
      readonly status: 'extracted';
      readonly drafts: readonly ExtractedMemoryDraft[];
    }
  | {
      readonly status: 'stalled';
      readonly reason: CuratorStallReason;
      /** Resolved provider id, or `''` when the curator inherits the active one. */
      readonly providerId: string;
    };

export interface ICuratorLLM {
  extract(transcript: string, signal?: AbortSignal): Promise<CuratorExtraction>;

  /**
   * Merge-resolve the drafts `extract` produced.
   *
   * Deliberately has **no** stalled arm. A stall here can only happen when the
   * cooldown starts between the two calls, and its degradation is already
   * lossless: the drafts come back unmerged (`mergeTargetId: null`) and are
   * persisted. Nothing is discarded, so the caller has no decision to make and
   * a discriminator would be ceremony.
   */
  resolve(
    drafts: readonly ExtractedMemoryDraft[],
    related: readonly { id: string; subject: string | null; content: string }[],
    signal?: AbortSignal,
  ): Promise<readonly ResolvedMemoryDraft[]>;
}
