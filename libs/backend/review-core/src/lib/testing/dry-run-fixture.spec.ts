import 'reflect-metadata';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS, SqliteConnectionService, type SqliteDatabase } from '@ptah-extension/persistence-sqlite';
import { Logger } from '@ptah-extension/vscode-core';
import type { CandidateFinding, IGitHubReviewPort } from '@ptah-extension/review-contracts';
import { SqliteReviewRepository } from '../persistence/sqlite-review.repository';
import { ReviewQueueService } from '../review-queue.service';
import { ReviewPolicyService } from '../review-policy.service';
import { ReviewOrchestratorService } from '../review-orchestrator.service';
import type { IReviewSettingsStore } from '../persistence/review-settings.store';
import { ReviewArtifactWriter } from '../lanes/review-artifact.writer';
import { DiscoveryStageRunner } from '../stages/discovery-stage.runner';
import { ContextStageRunner, type ContextStageResult } from '../stages/context-stage.runner';
import { TriageStageRunner } from '../stages/triage-stage.runner';
import { LensStageRunner, type LensStageResult } from '../stages/lens-stage.runner';
import { VerificationStageRunner, type VerificationResult } from '../stages/verification-stage.runner';
import { PublicationStageRunner } from '../stages/publication-stage.runner';
const REVIEW_REPO = { owner: 'Hive-Academy', name: 'PtahCode' } as const;

const sha = 'a'.repeat(40);
const canary = 'ptah-review-canary-873';
const settings = { repositories: [{ owner: 'Hive-Academy', name: 'PtahCode', enabled: true, dryRun: true, publicationPaused: false }],
  maintainerLogins: ['maintainer'], pollMinutes: 10, globalPublicationPaused: false, fallbackFamilies: [] };
const finding: CandidateFinding = { schemaVersion: 1, lens: 'correctness-lifecycle', title: 'Missing release',
  failureMode: 'Request hangs', affectedBehavior: 'Retry blocked', scenario: 'Timeout', path: 'src/retry.ts', line: 1,
  evidence: [{ path: 'src/retry.ts', line: 1, excerpt: 'await pending' }], affectedCaller: null,
  severity: 'Minor', category: 'stability', confidence: 0.9, suggestedDiff: null, fixPrompt: 'Release pending request' };

describe('dry-run fixture without UI or GitHub mutation', () => {
  it('traverses queue to preview and reopens persisted stages and export', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ptah-review-fixture-'));
    const dbPath = join(root, 'review.sqlite');
    const attemptRoot = join(root, 'attempt');
    const out = join(attemptRoot, 'out');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'walkthrough.md'), `Observed behavior: retry path changed. ${canary}`);
    const Database = require('better-sqlite3') as new (path: string) => SqliteDatabase;
    const logger = Object.create(Logger.prototype) as Logger;
    logger.info = jest.fn(); logger.error = jest.fn();
    const open = () => {
      const db = new Database(dbPath);
      db.pragma('foreign_keys = ON');
      const connection = new SqliteConnectionService(dbPath, logger);
      Object.defineProperty(connection, 'db', { value: db });
      return { db, repository: new SqliteReviewRepository(connection, logger) };
    };
    const first = open();
    try {
      const migration = MIGRATIONS.find((entry) => entry.version === 65);
      if (!migration?.sql) throw new Error('Review migration missing');
      first.db.exec(migration.sql);
      for (const version of [67, 68, 69]) {
        const addition = MIGRATIONS.find((entry) => entry.version === version);
        if (!addition?.sql) throw new Error('Review migration missing: ' + version);
        first.db.exec(addition.sql);
      }
      const clock = { now: () => new Date() };
      const queue = new ReviewQueueService(first.repository, clock, logger);
      const policy = new ReviewPolicyService();
      const environment = { resolve: async () => ({ repoRoot: root, attemptsRoot: root }), settings: async () => settings,
        baseConfig: async () => null, redactionSecrets: async () => [canary] };
      const mutations = { upsertWalkthrough: jest.fn(), createCommentReview: jest.fn(), replyToFinding: jest.fn() };
      const github: IGitHubReviewPort = { listOpenPulls: jest.fn().mockResolvedValue({ items: [{ number: 1, headSha: sha,
        baseSha: 'b'.repeat(40), state: 'open', draft: false, authorLogin: 'maintainer', headRepoId: 1,
        baseRepoId: 1, headIsFork: false }], nextPage: null, etag: null, notModified: false }),
        getPull: jest.fn().mockResolvedValue({ number: 1, headSha: sha, baseSha: 'b'.repeat(40), state: 'open',
          draft: false, authorLogin: 'maintainer', headRepoId: 1, baseRepoId: 1, headIsFork: false }),
        getDiff: jest.fn(), listOwnIssueComments: jest.fn(), listOwnReviewsAndThreads: jest.fn(), ...mutations };
      const contextValue: ContextStageResult = { attemptRoot, coverage: ['lint:unavailable'], promptInput: {
        headSha: sha, title: 'Fixture', body: '', diff: '', comments: '', fileContent: '',
        deterministicEvidence: '', repositoryRules: '' } };
      const context = Object.create(ContextStageRunner.prototype) as ContextStageRunner;
      jest.spyOn(context, 'run').mockResolvedValue(contextValue);
      const triage = Object.create(TriageStageRunner.prototype) as TriageStageRunner;
      jest.spyOn(triage, 'run').mockResolvedValue({ status: 'completed', family: 'codex',
        output: { schemaVersion: 1, headSha: sha, findings: [], coverage: [] } });
      const lens = Object.create(LensStageRunner.prototype) as LensStageRunner;
      const lensResults: LensStageResult = [{ lens: 'correctness-lifecycle', result: { status: 'completed', family: 'codex',
        output: { schemaVersion: 1, headSha: sha, findings: [finding], coverage: [] } } }];
      jest.spyOn(lens, 'run').mockResolvedValue(lensResults);
      const verification = Object.create(VerificationStageRunner.prototype) as VerificationStageRunner;
      const verdicts: VerificationResult[] = [{ lens: finding.lens, finding, verification: 'same-family-weaker',
        result: { status: 'completed', family: 'codex', evidenceStrength: 'weaker', output: { schemaVersion: 1,
          candidateId: 'correctness-lifecycle-0', headSha: sha, verdict: 'accepted',
          checkedEvidence: [{ path: 'src/retry.ts', line: 1, observation: 'No release' }],
          reason: 'confirmed', confidence: 0.9, verifierFamily: 'codex' } } }];
      jest.spyOn(verification, 'run').mockResolvedValue(verdicts);
      const writer = new ReviewArtifactWriter({ realpath: async (path) => realpathSync(path),
        readFile: async (path) => readFileSync(path, 'utf8'),
        writeFile: async (path, data) => { writeFileSync(path, data, 'utf8'); } });
      const publication = new PublicationStageRunner(writer, policy, environment);
      const coordinator = new ReviewOrchestratorService(new DiscoveryStageRunner(github, queue, policy, environment),
        context, triage, lens, verification, publication, queue, policy, first.repository, github, environment, logger,
        { getSettings: jest.fn().mockResolvedValue(settings), updateSettings: jest.fn(), listRepositories: jest.fn(),
          setPublicationPause: jest.fn(), getLiveGate: jest.fn(), setLiveGate: jest.fn() } as IReviewSettingsStore);
      const discoverySummary = (await coordinator.discoveryHandler()).summary;
      expect(logger.error).not.toHaveBeenCalled();
      expect(discoverySummary).toContain('Enqueued 1');
      const discovered = await first.repository.enqueueDiscovered({ repo: REVIEW_REPO, prNumber: 1, headSha: sha }, new Date().toISOString());
      expect(await coordinator.drain('worker', Date.now() + 60_000)).toBe(1);
      expect(mutations.upsertWalkthrough).not.toHaveBeenCalled();
      expect(mutations.createCommentReview).not.toHaveBeenCalled();
      expect(mutations.replyToFinding).not.toHaveBeenCalled();
      first.db.close();
      const reopened = open();
      try {
        const stages = await reopened.repository.getStages(discovered.attemptId);
        expect(stages.map((stage) => stage.stage)).toEqual(expect.arrayContaining(['context', 'triage', 'verification', 'publication']));
        expect(stages.find((stage) => stage.stage === 'publication')?.artifactPath).toBe(join(out, 'review-preview.md'));
        expect(readFileSync(join(out, 'review-preview.md'), 'utf8')).toContain('weaker evidence');
        expect(readFileSync(join(out, 'review-preview.md'), 'utf8')).toContain('lint:unavailable');
        expect(readFileSync(join(out, 'review-export.json'), 'utf8')).toContain('same-family-weaker');
        expect(readFileSync(join(out, 'review-preview.md'), 'utf8')).not.toContain(canary);
        expect(readFileSync(join(out, 'review-export.json'), 'utf8')).not.toContain(canary);
      } finally { reopened.db.close(); }
    } finally { if (first.db.open) first.db.close(); rmSync(root, { recursive: true, force: true }); }
  });
});

