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
import type { VerificationResult } from './verification-stage.runner';

export interface PublicationResult { artifactPath: string; exportPath: string; acceptedCount: number; suppressedCount: number }

/** Dry run only. This stage has no GitHub port and cannot mutate a PR. */
@injectable()
export class PublicationStageRunner {
  constructor(
    @inject(REVIEW_CORE_TOKENS.ARTIFACT_WRITER) private readonly writer: ReviewArtifactWriter,
    private readonly policy: ReviewPolicyService,
    @inject(REVIEW_CORE_TOKENS.ENVIRONMENT) private readonly environment: ReviewStageEnvironment,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION) private readonly sqlite: { readonly db: SqliteDatabase } | null = null,
  ) {}

  async run(claim: ReviewQueueClaim, context: ContextStageResult, lenses: LensStageResult,
    verdicts: VerificationResult[]): Promise<PublicationResult> {
    const settings = this.policy.effectiveSettings(await this.environment.settings(), await this.environment.baseConfig());
    if (!settings) throw new Error('Review settings unavailable for dry-run preview');
    const out = resolve(context.attemptRoot, 'out');
    const accepted: ReviewPreviewInput['accepted'] = [];
    const suppressed: ReviewPreviewInput['suppressed'] = [];
    for (const item of verdicts) {
      if (item.result.status === 'completed' && 'verdict' in item.result.output && item.result.output.verdict === 'accepted') {
        accepted.push(item.finding);
      } else {
        const reason = item.result.status === 'partial' ? `Verification unavailable: ${item.result.reason}`
          : 'verdict' in item.result.output ? `${item.result.output.verdict}: ${item.result.output.reason}` : 'Verification unavailable';
        suppressed.push({ finding: item.finding, reason });
      }
    }
    const verified = verifiedReviewFindings(verdicts);
    if (this.sqlite) persistVerifiedFindings(this.sqlite.db, claim.attemptId, verified);
    const walkthrough = await this.writer.readWalkthrough(out);
    const preview: ReviewPreviewInput = {
      headSha: claim.headSha, walkthrough, accepted, suppressed,
      verification: verdicts.map(({ finding, verification }) => ({ finding, label: verification })),
      selectedLenses: [{ lens: 'triage', family: 'coordinator', scope: context.coverage.join('; '), outcome: 'completed' },
        ...lenses.map(({ lens, result }) => ({ lens, family: result.status === 'completed' ? result.family : 'unavailable',
          scope: context.coverage.join('; '), outcome: result.status === 'completed' ? 'completed' : `unavailable: ${result.reason}` }))],
      secrets: [],
    };
    const artifactPath = await this.writer.writePreview(out, preview, settings);
    const exportPath = await this.writer.writeExport(out, preview, settings);
    if (this.sqlite) await persistExportArtifact(this.sqlite.db, claim.attemptId, exportPath);
    return { artifactPath, exportPath, acceptedCount: accepted.length, suppressedCount: suppressed.length };
  }
}
