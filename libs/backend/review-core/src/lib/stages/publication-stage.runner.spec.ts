import type { CandidateFinding } from '@ptah-extension/review-contracts';
import { ReviewArtifactWriter, type ReviewArtifactFileSystem } from '../lanes/review-artifact.writer';
import { ReviewPolicyService } from '../review-policy.service';
import type { ReviewQueueClaim } from '../review-queue.service';
import type { ContextStageResult } from './context-stage.runner';
import type { LensStageResult } from './lens-stage.runner';
import { PublicationStageRunner } from './publication-stage.runner';
import type { VerificationResult } from './verification-stage.runner';

const sha = 'a'.repeat(40);
const finding: CandidateFinding = { schemaVersion: 1, lens: 'correctness-lifecycle', title: 'Broken retry',
  failureMode: 'Retry never starts', affectedBehavior: 'Request remains pending', scenario: 'Timeout then retry',
  path: 'src/retry.ts', line: 12, evidence: [{ path: 'src/retry.ts', line: 12, excerpt: 'await pending' }],
  affectedCaller: null, severity: 'Minor', category: 'stability', confidence: 0.9, suggestedDiff: null,
  fixPrompt: 'Release pending request', };
const claim: ReviewQueueClaim = { repo: { owner: 'Hive-Academy', name: 'PtahCode' }, prNumber: 1,
  headSha: sha, attemptId: 'attempt-1', trigger: 'poll', queuedAt: '', lease: { owner: 'worker', expiresAt: '' } };
const context: ContextStageResult = { attemptRoot: '/attempt', coverage: ['checks:unavailable'], promptInput: {
  headSha: sha, title: '', body: '', diff: '', comments: '', fileContent: '', deterministicEvidence: '', repositoryRules: '',
} };
const settings = { repositories: [{ owner: 'Hive-Academy', name: 'PtahCode', enabled: true, dryRun: true, publicationPaused: false }],
  maintainerLogins: ['maintainer'], pollMinutes: 10, globalPublicationPaused: false, fallbackFamilies: [],
  maxNewInline: 2 };

describe('PublicationStageRunner', () => {
  it('writes weaker evidence, unavailable checks, suppression and capped inline preview plus export', async () => {
    const writes = new Map<string, string>();
    const fs: ReviewArtifactFileSystem = { realpath: async (path) => path,
      writeFile: async (path, data) => { writes.set(path, data); }, readFile: async () => 'Observed behavior' };
    const runner = new PublicationStageRunner(new ReviewArtifactWriter(fs), new ReviewPolicyService(), {
      repoRoot: '/repo', attemptsRoot: '/attempts', settings: async () => settings, baseConfig: async () => null,
    });
    const lenses: LensStageResult = [{ lens: 'correctness-lifecycle', result: { status: 'partial', reason: 'no-confirmed-room' } }];
    const verdicts: VerificationResult[] = [
      { lens: finding.lens, finding, verification: 'same-family-weaker', result: { status: 'completed', family: 'codex',
        evidenceStrength: 'weaker', output: { schemaVersion: 1, candidateId: 'a', headSha: sha, verdict: 'accepted',
          checkedEvidence: [{ path: 'src/retry.ts', line: 12, observation: 'No release' }], reason: 'confirmed',
          confidence: 0.9, verifierFamily: 'codex' } } },
      { lens: finding.lens, finding: { ...finding, title: 'Disproved' }, verification: 'cross-family',
        result: { status: 'partial', reason: 'deadline' } },
    ];
    for (let index = 0; index < 3; index++) verdicts.push({ ...verdicts[0], finding: { ...finding, title: `Extra ${index}` } });
    verdicts.push({ ...verdicts[0], finding: { ...finding, title: 'Nitpick', severity: 'Nitpick' } });
    const result = await runner.run(claim, context, lenses, verdicts);
    expect(result.acceptedCount).toBe(5);
    expect(result.suppressedCount).toBe(1);
    const preview = writes.get(result.artifactPath) ?? '';
    expect(preview).toContain('weaker evidence (same-family verifier)');
    expect(preview).toContain('checks:unavailable');
    expect(preview).toContain('Verification unavailable: deadline');
    expect(preview).toContain('Inline-comment candidates (2/2)');
    expect(preview).toContain('Below minimum severity Minor');
    expect(writes.get(result.exportPath)).toContain('same-family-weaker');
  });
});
