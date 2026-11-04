import { MIGRATIONS, type SqliteDatabase } from '@ptah-extension/persistence-sqlite';
import { ReviewFindingSchema, type IdentityVerdict } from '@ptah-extension/review-contracts';
import type { IGitHubReviewPublicationPort } from '@ptah-extension/review-github';
import { ReviewPolicyService } from '../review-policy.service';
import type { ReviewQueueClaim } from '../review-queue.service';
import type { VerificationResult } from '../stages/verification-stage.runner';
import type { IncrementalScope } from '../context/incremental-scope.service';
import { PublicationOutboxRepository } from './publication-outbox.repository';
import { PublicationOutboxService } from './publication-outbox.service';
import { ReviewPublicationService } from './review-publication.service';

const sha = 'a'.repeat(40);
const priorId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const claim: ReviewQueueClaim = { repo: { owner: 'Hive-Academy', name: 'PtahCode' }, prNumber: 1,
  headSha: sha, attemptId: 'attempt', trigger: 'poll', queuedAt: '', lease: { owner: 'worker', expiresAt: '' } };
const settings = { repositories: [{ owner: 'Hive-Academy', name: 'PtahCode', enabled: true, dryRun: false, publicationPaused: false }],
  maintainerLogins: ['maintainer'], pollMinutes: 10, globalPublicationPaused: false, fallbackFamilies: [], maxNewInline: 10 };
const finding = ReviewFindingSchema.parse({ schemaVersion: 1, lens: 'correctness-lifecycle', title: 'Broken retry',
  failureMode: 'Retry remains stuck', affectedBehavior: 'Request remains pending', scenario: 'Timeout then retry',
  path: 'src/retry.ts', line: 12, evidence: [{ path: 'src/retry.ts', line: 12, excerpt: 'await pending' }],
  affectedCaller: 'retryCall', severity: 'Major', category: 'stability', confidence: 0.9, suggestedDiff: null,
  fixPrompt: 'Release pending request', verification: 'cross-family' });
const diff = '+++ b/src/retry.ts\n@@ -1,0 +12,1 @@\n+await pending';
const scope: IncrementalScope = { headSha: sha, previousReviewedHeadSha: 'b'.repeat(40),
  changedPaths: ['src/retry.ts'], dependentPaths: [], recheckFailureIds: [priorId],
  reviewPaths: ['src/retry.ts'], publishNewVerifiedRootsOnly: true };
function verdict(candidateId: string, kind: 'accepted' | 'disproved', reason = 'Evidence confirms result'): VerificationResult {
  return { lens: finding.lens, finding, verification: 'cross-family', result: { status: 'completed', family: 'codex',
    evidenceStrength: 'strong', output: { schemaVersion: 1, candidateId, headSha: sha, verdict: kind,
      checkedEvidence: [{ path: finding.path, line: 12, observation: 'Observed current behavior' }],
      reason, confidence: 0.9, verifierFamily: 'codex' } } };
}
const identityVerdict: IdentityVerdict = { candidateId: 'candidate', priorFindingId: priorId, relation: 'same',
  evidence: { path: finding.path, symbol: 'retryCall', behavior: finding.affectedBehavior, reason: 'Matched prior' } };

describe('ReviewPublicationService regression', () => {
  let db: SqliteDatabase;
  let outbox: PublicationOutboxService;
  let publish: jest.SpyInstance;
  beforeEach(() => {
    const Database = require('better-sqlite3') as new (path: string) => SqliteDatabase;
    db = new Database(':memory:');
    for (const version of [65, 66]) {
      const migration = MIGRATIONS.find(entry => entry.version === version);
      if (!migration?.sql) throw new Error(`Review migration ${version} missing`);
      db.exec(migration.sql);
    }
    const publisher: IGitHubReviewPublicationPort = { publish: jest.fn() };
    outbox = new PublicationOutboxService({ db }, publisher);
    publish = jest.spyOn(outbox, 'publish').mockResolvedValue();
    jest.spyOn(PublicationOutboxRepository.prototype, 'proposeIdentity').mockReturnValue(identityVerdict);
    jest.spyOn(PublicationOutboxRepository.prototype, 'identity').mockReturnValue({ findingId: priorId, outcome: 'still_open' });
    jest.spyOn(PublicationOutboxRepository.prototype, 'suppress').mockImplementation();
  });
  afterEach(() => { jest.restoreAllMocks(); db.close(); });
  const service = () => new ReviewPublicationService({ db }, outbox, new ReviewPolicyService());

  it('sends a still-open root for marker reconciliation', async () => {
    await service().publish(claim, 'Walkthrough', diff, [verdict('candidate', 'accepted')], settings, null, [], scope);
    expect(publish.mock.calls[0][0].candidates).toHaveLength(1);
  });
  it('omits confirmed prior roots before selecting incremental inline comments', async () => {
    jest.spyOn(PublicationOutboxRepository.prototype, 'hasConfirmedFinding').mockReturnValue(true);
    await service().publish(claim, 'Walkthrough', diff, [verdict('candidate', 'accepted')], settings, null, [], scope);
    expect(publish.mock.calls[0][0].candidates).toHaveLength(0);
    expect(publish.mock.calls[0][0].overview).not.toContain('Additional verified findings');
  });
  it('replays a pending reopened follow-up after identity status has changed', async () => {
    jest.spyOn(PublicationOutboxRepository.prototype, 'pendingFollowUp').mockReturnValue('reopened');
    await service().publish(claim, 'Walkthrough', diff, [verdict('candidate', 'accepted')], settings, null, [], scope);
    expect(publish.mock.calls[0][0].followUps).toHaveLength(1);
    expect(publish.mock.calls[0][0].candidates).toHaveLength(0);
  });
  it('replays a pending addressed follow-up after a timeout', async () => {
    jest.spyOn(PublicationOutboxRepository.prototype, 'pendingFollowUp').mockReturnValue('addressed');
    await service().publish(claim, 'Walkthrough', diff, [verdict('candidate', 'disproved')], settings, null, [], scope);
    expect(publish.mock.calls[0][0].followUps).toHaveLength(1);
    expect(publish.mock.calls[0][0].followUps[0].body).toContain('ptah-review:addressed:');
  });
  it('passes a reopened prior status into the fixed recheck', async () => {
    const status = jest.spyOn(PublicationOutboxRepository.prototype, 'findingStatus').mockReturnValue('reopened');
    jest.spyOn(PublicationOutboxRepository.prototype, 'identity').mockReturnValue({ findingId: priorId, outcome: 'addressed' });
    await service().publish(claim, 'Walkthrough', diff, [verdict('candidate', 'disproved')], settings, null, [], scope);
    expect(status).toHaveBeenCalledWith(priorId);
    expect(jest.mocked(PublicationOutboxRepository.prototype.identity).mock.calls[0][4]).toMatchObject({ status: 'reopened' });
  });
  it('publishes reopened evidence as a follow-up on incremental heads', async () => {
    jest.spyOn(PublicationOutboxRepository.prototype, 'identity').mockReturnValue({ findingId: priorId, outcome: 'reopened' });
    await service().publish(claim, 'Walkthrough', diff, [verdict('candidate', 'accepted')], settings, null, [], scope);
    expect(publish.mock.calls[0][0].candidates).toHaveLength(0);
    expect(publish.mock.calls[0][0].followUps[0].body).toContain('Reopened finding ' + priorId);
  });
  it('summarizes verified overflow while capping inline comments at ten', async () => {
    await service().publish(claim, 'Walkthrough', diff, Array.from({ length: 12 }, (_, i) =>
      verdict('candidate-' + i, 'accepted')), settings, null, []);
    expect(publish.mock.calls[0][0].candidates).toHaveLength(10);
    expect(publish.mock.calls[0][0].overview).toContain('Additional verified findings (2)');
  });
  it('accepts a disproved recheck without a reason prefix', async () => {
    jest.spyOn(PublicationOutboxRepository.prototype, 'identity').mockReturnValue({ findingId: priorId, outcome: 'addressed' });
    await service().publish(claim, 'Walkthrough', diff, [verdict('candidate', 'disproved', 'Evidence no longer reproduces')],
      settings, null, [], scope);
    expect(publish.mock.calls[0][0].followUps[0].body).toContain('Evidence no longer reproduces');
  });
  it('keeps an uncertain identity off GitHub', async () => {
    jest.spyOn(PublicationOutboxRepository.prototype, 'identity').mockReturnValue({ findingId: null, outcome: 'uncertain' });
    await service().publish(claim, 'Walkthrough', diff, [verdict('candidate', 'accepted')], settings, null, []);
    expect(publish.mock.calls[0][0].candidates).toHaveLength(0);
    expect(publish.mock.calls[0][0].overview).toContain('held locally');
  });
});
