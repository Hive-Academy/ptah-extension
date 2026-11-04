import { resolve } from 'node:path';
import { inject, injectable } from 'tsyringe';
import { PERSISTENCE_TOKENS, type SqliteDatabase } from '@ptah-extension/persistence-sqlite';
import { REVIEW_CORE_TOKENS } from '../../di/tokens';
import { ReviewArtifactWriter, type ReviewPreviewInput } from '../lanes/review-artifact.writer';
import { ReviewPolicyService } from '../review-policy.service';
import type { ReviewQueueClaim } from '../review-queue.service';
import type { ReviewStageEnvironment, ContextStageResult } from './context-stage.runner';
import type { LensStageResult } from './lens-stage.runner';
import { persistVerifiedFindings, verifiedReviewFindings } from './publication-finding.persistence';
import { persistExportArtifact } from './publication-artifact.persistence';
import { ReviewPublicationService } from '../publication/review-publication.service';
import { PublicationOutboxRepository } from '../publication/publication-outbox.repository';
import type { VerificationResult } from './verification-stage.runner';

export interface PublicationResult { artifactPath: string; exportPath: string; acceptedCount: number; suppressedCount: number }

/** Writes the local artifact, then publishes when live policy permits. */
@injectable()
export class PublicationStageRunner {
  constructor(
    @inject(REVIEW_CORE_TOKENS.ARTIFACT_WRITER) private readonly writer: ReviewArtifactWriter,
    @inject(ReviewPolicyService) private readonly policy: ReviewPolicyService,
    @inject(REVIEW_CORE_TOKENS.ENVIRONMENT) private readonly environment: ReviewStageEnvironment,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION) private readonly sqlite: { readonly db: SqliteDatabase } | null = null,
    @inject(ReviewPublicationService) private readonly publication: ReviewPublicationService | null = null,
  ) {}

  async run(claim: ReviewQueueClaim, context: ContextStageResult, lenses: LensStageResult,
    verdicts: VerificationResult[], signal?: AbortSignal): Promise<PublicationResult> {
    if (signal?.aborted) throw new Error('Review publication aborted');
    const operatorSettings = await this.environment.settings();
    const baseConfig = await this.environment.baseConfig(claim.repo, context.baseSha);
    const settings = this.policy.effectiveSettings(operatorSettings, baseConfig);
    if (signal?.aborted) throw new Error('Review publication aborted');
    if (!settings) throw new Error('Review settings unavailable for dry-run preview');
    const secrets = await this.environment.redactionSecrets?.() ?? [];
    if (signal?.aborted) throw new Error('Review publication aborted');
    const out = resolve(context.attemptRoot, 'out');
    const accepted: ReviewPreviewInput['accepted'] = [];
    const suppressed: ReviewPreviewInput['suppressed'] = [];
    for (const item of verdicts) {
      if (item.result.status === 'completed' && 'verdict' in item.result.output && item.result.output.verdict === 'accepted') {
        const identity = this.sqlite && this.publication
          ? new PublicationOutboxRepository(this.sqlite.db).proposeIdentity(claim.attemptId,
            item.result.output.candidateId, { ...item.finding, verification: item.verification === 'unavailable' ? 'same-family-weaker' : item.verification }, item.identity) : null;
        if (identity?.relation === 'uncertain') suppressed.push({ finding: item.finding, reason: 'identity-uncertain' });
        else accepted.push(item.finding);
      } else {
        const reason = item.result.status === 'partial' ? `Verification unavailable: ${item.result.reason}`
          : 'verdict' in item.result.output ? `${item.result.output.verdict}: ${item.result.output.reason}` : 'Verification unavailable';
        suppressed.push({ finding: item.finding, reason });
      }
    }
    const verified = verifiedReviewFindings(verdicts);
    if (secrets.some((secret) => secret.length >= 4 && JSON.stringify(verified).includes(secret)))
      throw new Error('Review finding contains redaction secret');
    if (this.sqlite && (!this.publication || !this.policy.publication(operatorSettings, baseConfig).allowed) && !signal?.aborted)
      persistVerifiedFindings(this.sqlite.db, claim.attemptId, verified);
    const walkthrough = await this.writer.readWalkthrough(out);
    if (signal?.aborted) throw new Error('Review publication aborted');
    const preview: ReviewPreviewInput = {
      headSha: claim.headSha, walkthrough, accepted, suppressed,
      verification: verdicts.map(({ finding, verification }) => ({ finding, label: verification })),
      selectedLenses: [{ lens: 'triage', family: 'coordinator', scope: context.coverage.join('; '), outcome: 'completed' },
        ...lenses.map(({ lens, result }) => ({ lens, family: result.status === 'completed' ? result.family : 'unavailable',
          scope: context.coverage.join('; '), outcome: result.status === 'completed' ? 'completed' : `unavailable: ${result.reason}` }))],
      secrets,
    };
    const artifactPath = await this.writer.writePreview(out, preview, settings);
    if (signal?.aborted) throw new Error('Review publication aborted');
    const exportPath = await this.writer.writeExport(out, preview, settings);
    if (signal?.aborted) throw new Error('Review publication aborted');
    if (this.sqlite) await persistExportArtifact(this.sqlite.db, claim.attemptId, exportPath);
    if (this.publication) await this.publication.publish(claim, walkthrough, context.promptInput.diff,
      verdicts, operatorSettings, baseConfig, secrets, context.incrementalScope, signal);
    return { artifactPath, exportPath, acceptedCount: accepted.length, suppressedCount: suppressed.length };
  }
}
