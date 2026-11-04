import { inject, injectable } from 'tsyringe';
import {
  PERSISTENCE_TOKENS,
  type SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';
import type {
  IGitHubReviewPublicationPort,
  PublicationInlineComment,
  PublicationTarget,
} from '@ptah-extension/review-github';
import { REVIEW_GITHUB_TOKENS } from '@ptah-extension/review-github';
import { PublicationOutboxRepository } from './publication-outbox.repository';

export interface PublicationRequest {
  attemptId: string;
  target: PublicationTarget;
  walkthrough: string;
  overview: string;
  candidates: PublicationInlineComment[];
  publishedFindingIds?: string[];
  followUps?: { findingId: string; body: string }[];
  validRightAnchors: ReadonlySet<string>;
}

/** A PR remains serialized through the whole async mutation, including reconciliation. */
@injectable()
export class PublicationOutboxService {
  private readonly active = new Set<string>();
  constructor(
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly sqlite: { readonly db: SqliteDatabase },
    @inject(REVIEW_GITHUB_TOKENS.PUBLICATION_PORT)
    private readonly publisher: IGitHubReviewPublicationPort,
  ) {}

  async publish(
    input: PublicationRequest,
    signal?: AbortSignal,
  ): Promise<void> {
    const key = `${input.target.repo.owner.toLowerCase()}/${input.target.repo.name.toLowerCase()}#${input.target.number}`;
    if (this.active.has(key))
      throw new Error('Publication already in flight for this PR');
    this.active.add(key);
    try {
      if (signal?.aborted) throw new Error('Review publication aborted');
      const outbox = new PublicationOutboxRepository(this.sqlite.db);
      const walkthrough = outbox.plan({
        attemptId: input.attemptId,
        kind: 'walkthrough',
        key: 'walkthrough',
        marker: '<!-- ptah-review:walkthrough -->',
        body: input.walkthrough,
      });
      const review = outbox.plan({
        attemptId: input.attemptId,
        kind: 'review',
        key: input.target.headSha,
        marker: `<!-- ptah-review:head:${input.target.headSha} -->`,
        body: input.overview,
      });
      const followUps = (input.followUps ?? []).map((item) =>
        outbox.plan({
          attemptId: input.attemptId,
          kind: 'follow_up',
          key: item.findingId,
          findingId: item.findingId,
          marker: `<!-- ptah-review:${item.body.includes(`ptah-review:reopened:${item.findingId}`) ? 'reopened' : 'addressed'}:${item.findingId} -->`,
          body: item.body,
        }),
      );
      // Inflight or unknown records are reconciled by the adapter's bot-owned marker reads.
      if (
        walkthrough.state === 'confirmed' &&
        review.state === 'confirmed' &&
        input.candidates.length === 0 &&
        followUps.every((item) => item.state === 'confirmed')
      )
        return;
      if (signal?.aborted) throw new Error('Review publication aborted');
      outbox.state(walkthrough.id, 'inflight');
      outbox.state(review.id, 'inflight');
      for (const item of followUps) outbox.state(item.id, 'inflight');
      try {
        const result = await this.publisher.publish(
          input.target,
          input.walkthrough,
          input.overview,
          input.candidates,
          input.validRightAnchors,
        );
        outbox.state(
          walkthrough.id,
          'confirmed',
          String(result.walkthrough.id),
        );
        if (result.review) {
          outbox.state(review.id, 'confirmed', String(result.review.id));
          outbox.confirmFindingMarkers(
            review.id,
            input.publishedFindingIds ??
              input.candidates
                .map((item) => item.findingId)
                .filter((id) => !!id),
          );
        } else outbox.state(review.id, 'confirmed');
        for (const item of followUps)
          outbox.state(
            item.id,
            'confirmed',
            result.review ? String(result.review.id) : undefined,
          );
      } catch (error: unknown) {
        outbox.state(walkthrough.id, 'unknown');
        outbox.state(review.id, 'unknown');
        for (const item of followUps) outbox.state(item.id, 'unknown');
        throw error;
      }
    } finally {
      this.active.delete(key);
    }
  }
}
