import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SKILL_SYNTHESIS_TOKENS } from './di/tokens';
import { SkillCandidateStore } from './skill-candidate.store';

const DEDUP_BUCKET_MS = 2000;
const DEDUP_CAP = 500;

export interface RecordSkillEventInput {
  readonly slug: string;
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly contextId: string | null;
  readonly succeeded: boolean;
  readonly invokedAt: number;
  readonly source: 'tool-use' | 'prompt-expansion';
}

@injectable()
export class SkillInvocationRecorder {
  private readonly seen = new Map<string, number>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE)
    private readonly store: SkillCandidateStore,
  ) {}

  recordSkillEvent(input: RecordSkillEventInput): void {
    if (!input.slug || input.slug.length === 0) return;
    if (!input.sessionId || input.sessionId.length === 0) return;

    const key = `${input.slug}|${input.sessionId}|${Math.floor(
      input.invokedAt / DEDUP_BUCKET_MS,
    )}`;
    if (this.seen.has(key)) return;
    this.remember(key);

    try {
      this.store.recordSkillEvent({
        skillSlug: input.slug,
        sessionId: input.sessionId,
        contextId: input.contextId,
        source: input.source,
        succeeded: input.succeeded,
        isError: !input.succeeded,
        invokedAt: input.invokedAt,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('[skill-synthesis] recordSkillEvent failed', {
        slug: input.slug,
        source: input.source,
        error: message,
      });
    }
  }

  private remember(key: string): void {
    this.seen.set(key, Date.now());
    if (this.seen.size <= DEDUP_CAP) return;
    const oldest = this.seen.keys().next();
    if (!oldest.done) this.seen.delete(oldest.value);
  }
}
