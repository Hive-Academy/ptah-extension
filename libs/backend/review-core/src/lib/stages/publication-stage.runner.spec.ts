import { MIGRATIONS, type SqliteDatabase } from '@ptah-extension/persistence-sqlite';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReviewFindingSchema, type CandidateFinding } from '@ptah-extension/review-contracts';
import { ReviewArtifactWriter, type ReviewArtifactFileSystem } from '../lanes/review-artifact.writer';
import { ReviewPolicyService } from '../review-policy.service';
import type { ReviewQueueClaim } from '../review-queue.service';
import type { ContextStageResult } from './context-stage.runner';
import type { LensStageResult } from './lens-stage.runner';
import { PublicationStageRunner } from './publication-stage.runner';
import { ReviewPublicationService } from '../publication/review-publication.service';
import { PublicationOutboxService } from '../publication/publication-outbox.service';
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
  it('does not read or publish a walkthrough from partial triage', async () => {
    const readFile = jest.fn(async () => 'unvalidated walkthrough');
    const writes = new Map<string, string>();
    const fs: ReviewArtifactFileSystem = { realpath: async (path) => path,
      readFile, writeFile: async (path, data) => { writes.set(path, data); } };
    const runner = new PublicationStageRunner(new ReviewArtifactWriter(fs), new ReviewPolicyService(), {
      resolve: async () => ({ repoRoot: '/repo', attemptsRoot: '/attempts' }), settings: async () => settings, baseConfig: async () => null,
    });
    const result = await runner.run(claim, context, [], [], undefined, false);
    expect(readFile).not.toHaveBeenCalled();
    expect(writes.get(result.artifactPath)).not.toContain('unvalidated walkthrough');
  });
  it('writes weaker evidence, unavailable checks, suppression and capped inline preview plus export', async () => {
    const writes = new Map<string, string>();
    const fs: ReviewArtifactFileSystem = { realpath: async (path) => path,
      writeFile: async (path, data) => { writes.set(path, data); }, readFile: async () => 'Observed behavior' };
    const runner = new PublicationStageRunner(new ReviewArtifactWriter(fs), new ReviewPolicyService(), {
      resolve: async () => ({ repoRoot: '/repo', attemptsRoot: '/attempts' }), settings: async () => settings, baseConfig: async () => null,
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

  it('persists each verified finding payload and links it to the attempt', async () => {
    const attemptRoot = await mkdtemp(join(tmpdir(), 'review-publication-'));
    await mkdir(join(attemptRoot, 'out'));
    const Database = require('better-sqlite3') as new (path: string) => SqliteDatabase;
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    const migration = MIGRATIONS.find((entry) => entry.version === 65);
    if (!migration?.sql?.includes('payload_json')) throw new Error('Review finding payload column missing');
    db.exec(migration.sql);
    const publicationMigration = MIGRATIONS.find((entry) => entry.version === 66);
    if (!publicationMigration?.sql) throw new Error('Review publication migration missing');
    db.exec(publicationMigration.sql);
    const repoId = 'hive-academy/ptahcode';
    db.prepare(`INSERT INTO review_repositories (repo_id, owner, name, created_at, updated_at) VALUES (?, ?, ?, 1, 1)`)
      .run(repoId, 'Hive-Academy', 'PtahCode');
    db.prepare(`INSERT INTO review_heads (repo_id, pr_number, head_sha, state, discovered_at) VALUES (?, 1, ?, 'active', 1)`)
      .run(repoId, sha);
    db.prepare(`INSERT INTO review_attempts (attempt_id, repo_id, pr_number, head_sha, attempt_number, trigger, state, queued_at)
      VALUES ('attempt-1', ?, 1, ?, 0, 'automatic', 'running', 1)`).run(repoId, sha);
    db.prepare(`INSERT INTO review_stages (attempt_id, stage, ordinal, state)
      VALUES ('attempt-1', 'publication', 4, 'running')`).run();
    const writes = new Map<string, string>();
    const fs: ReviewArtifactFileSystem = { realpath: async (path) => path,
      writeFile: async (path, data) => { writes.set(path, data); await writeFile(path, data); },
      readFile: async () => 'Observed behavior' };
    const runner = new PublicationStageRunner(new ReviewArtifactWriter(fs), new ReviewPolicyService(), {
      resolve: async () => ({ repoRoot: '/repo', attemptsRoot: '/attempts' }), settings: async () => settings, baseConfig: async () => null,
    }, { db });
    const stored = { ...finding };
    const accepted = { lens: stored.lens, finding: stored, verification: 'cross-family' as const, result: { status: 'completed' as const,
      family: 'codex', output: { schemaVersion: 1 as const, candidateId: 'a', headSha: sha, verdict: 'accepted' as const,
        checkedEvidence: [{ path: 'src/retry.ts', line: 12, observation: 'No release' }], reason: 'confirmed',
        confidence: 0.9, verifierFamily: 'codex' } } };
    const suppressed = { ...accepted, finding: { ...stored, title: 'Disproved' }, verification: 'unavailable' as const,
      result: { status: 'partial' as const, reason: 'deadline' } };
    const testContext = { ...context, attemptRoot };
    await runner.run(claim, testContext, [], [accepted, suppressed]);
    stored.confidence = 0.4;
    const livePublisher = new ReviewPublicationService({ db },
      new PublicationOutboxService({ db }, { publish: jest.fn() }), new ReviewPolicyService());
    const injectedRunner = new PublicationStageRunner(new ReviewArtifactWriter(fs), new ReviewPolicyService(), {
      resolve: async () => ({ repoRoot: '/repo', attemptsRoot: '/attempts' }), settings: async () => settings,
      baseConfig: async () => null,
    }, { db }, livePublisher);
    const publication = await injectedRunner.run(claim, testContext, [], [accepted, suppressed]);
    const exportBytes = await readFile(publication.exportPath);
    expect(db.prepare('SELECT content_hash, size_bytes FROM review_artifacts WHERE attempt_id = ?').get(claim.attemptId))
      .toEqual({ content_hash: createHash('sha256').update(exportBytes).digest('hex'), size_bytes: exportBytes.length });
    const rows = db.prepare(`SELECT f.payload_json, f.status, e.kind, e.attempt_id FROM review_findings f
      JOIN review_finding_events e ON e.finding_id = f.finding_id`).all() as { payload_json: string; status: string; kind: string; attempt_id: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('accepted');
    expect(rows[0]?.attempt_id).toBe(claim.attemptId);
    expect(rows[0]?.status).toBe('open');
    expect(ReviewFindingSchema.parse(JSON.parse(rows[0]?.payload_json ?? '{}'))).toMatchObject({
      title: 'Broken retry', verification: 'cross-family', confidence: 0.4, fixPrompt: 'Release pending request',
    });
    expect(rows[0]?.payload_json).not.toContain('Disproved');
    db.close();
    await rm(attemptRoot, { recursive: true, force: true });
  });

  it('does not write a preview when the attempt row is missing', async () => {
    const Database = require('better-sqlite3') as new (path: string) => SqliteDatabase;
    const db = new Database(':memory:');
    const migration = MIGRATIONS.find((entry) => entry.version === 65);
    if (!migration?.sql) throw new Error('Review migration missing');
    db.exec(migration.sql);
    const writes = new Map<string, string>();
    const fs: ReviewArtifactFileSystem = { realpath: async (path) => path,
      writeFile: async (path, data) => { writes.set(path, data); }, readFile: async () => 'Observed behavior' };
    const runner = new PublicationStageRunner(new ReviewArtifactWriter(fs), new ReviewPolicyService(), {
      resolve: async () => ({ repoRoot: '/repo', attemptsRoot: '/attempts' }), settings: async () => settings, baseConfig: async () => null,
    }, { db });
    const accepted = { lens: finding.lens, finding, verification: 'same-family-weaker' as const, result: {
      status: 'completed' as const, family: 'codex', output: { schemaVersion: 1 as const, candidateId: 'a', headSha: sha,
        verdict: 'accepted' as const, checkedEvidence: [{ path: 'src/retry.ts', line: 12, observation: 'No release' }],
        reason: 'confirmed', confidence: 0.9, verifierFamily: 'codex' } } };
    await expect(runner.run(claim, context, [], [accepted])).rejects.toThrow('Review attempt unavailable for finding persistence');
    expect(writes.size).toBe(0);
    db.close();
  });
});
