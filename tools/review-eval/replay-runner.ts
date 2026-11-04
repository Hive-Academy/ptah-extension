import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { IProcessSpawner } from '@ptah-extension/platform-core';
import type { IGitHubReviewPort } from '@ptah-extension/review-contracts';
import type { ReviewOrchestratorService } from '@ptah-extension/review-core';
import { requireReadyFixture, type FixturePr } from './fixture-manifest.schema';
import { buildSnapshot, type SnapshotFs, type SnapshotGit } from './snapshot-builder';
import { ubuntuReplaySpawner, type ReplayIsolationConfig } from './ubuntu-bwrap-launcher';
import { attestationSchema } from './isolation-attestation';
import { assertReferenceOutsideLane } from './fixture-builder';
import { matchFindings, type ProducedFinding } from './match-findings';
import { createQualityReport, type QualityReport, type ReplaySummary } from './report';
import { CandidateFindingSchema } from '@ptah-extension/review-contracts';
import { createModelApiBroker, type BrokerEvent } from './model-api-broker';

const exportSchema = z.object({ accepted: z.array(CandidateFindingSchema),
  suppressed: z.array(z.object({ finding: CandidateFindingSchema, reason: z.string() })) }).passthrough();
export interface ReplayPorts {
  sourceRepo: string; destination(pr: FixturePr): string; git: SnapshotGit; fs: SnapshotFs;
  isolation(pr: FixturePr): ReplayIsolationConfig; spawner: IProcessSpawner;
  /** Builds review-core with this fake port, fixed clock, and sealed lane spawner. */
  pipeline(pr: FixturePr, github: IGitHubReviewPort, clock: { now(): Date }, spawner: IProcessSpawner):
    Promise<{ orchestrator: ReviewOrchestratorService; exportPath: string }>;
  attestation(pr: FixturePr): Promise<unknown>;
  diff(pr: FixturePr): Promise<string>;
  now: string; modelCredential: string;
}
function fakeGitHub(pr: FixturePr, patch: string): IGitHubReviewPort {
  if (pr.head.status !== 'ready' || pr.base.status !== 'ready') throw new Error('Fixture pending');
  const pull = { number: pr.number, headSha: pr.head.value, baseSha: pr.base.value, state: 'open' as const,
    draft: false, authorLogin: 'fixture-maintainer', headRepoId: 1, baseRepoId: 1, headIsFork: false };
  const page = <T>(items: T[]) => ({ items, nextPage: null, etag: null, notModified: false });
  const denied = async (): Promise<never> => { throw new Error('Replay GitHub mutation denied'); };
  return { listOpenPulls: async () => page([pull]), getPull: async () => pull,
    getDiff: async () => ({ headSha: pull.headSha, baseSha: pull.baseSha, patch, truncated: false }),
    listOwnIssueComments: async () => page([]), listOwnReviewsAndThreads: async () => page([]),
    upsertWalkthrough: denied, createCommentReview: denied, replyToFinding: denied };
}
/** All reference material remains outside the lane. Ready fixtures are mandatory before any snapshot or spawn. */
export async function runReplay(manifestInput: unknown, adjudication: unknown, referencePath: string, ports: ReplayPorts): Promise<QualityReport> {
  const manifest = requireReadyFixture(manifestInput);
  const fixed = z.string().datetime().parse(ports.now);
  const produced: ProducedFinding[] = []; const summaries: ReplaySummary[] = [];
  for (const pr of manifest.prs) {
    const config = ports.isolation(pr);
    assertReferenceOutsideLane(referencePath, [config.snapshot, config.out]);
    const snapshot = await buildSnapshot(pr, ports.sourceRepo, ports.destination(pr), ports.git, ports.fs);
    if (snapshot.snapshotSha256 !== config.snapshotHash || snapshot.reachableCommitsSha256 !== config.reachableCommitsHash)
      throw new Error('Snapshot hash differs from isolation policy');
    const events: BrokerEvent[] = [];
    const broker = createModelApiBroker({ endpoint: 'https://api.openai.com/', credential: ports.modelCredential,
      socketPath: config.brokerSocket }, event => events.push(event));
    await new Promise<void>((resolve, reject) => { broker.once('error', reject); broker.listen(config.brokerSocket, resolve); });
    try {
      const sealed = ubuntuReplaySpawner(ports.spawner, config);
      const { orchestrator, exportPath } = await ports.pipeline(pr, fakeGitHub(pr, await ports.diff(pr)),
        { now: () => new Date(fixed) }, sealed);
      await orchestrator.discoveryHandler();
      await orchestrator.drain(`replay-${pr.number}`, Date.now() + 60_000);
      const payload = exportSchema.parse(JSON.parse(await readFile(exportPath, 'utf8')));
      produced.push(...payload.accepted.map(finding => ({ prNumber: pr.number, finding })));
      const rawAttestation = await ports.attestation(pr);
      const parsed = attestationSchema.safeParse(rawAttestation);
      const bound = parsed.success && parsed.data.snapshotHash === snapshot.snapshotSha256 &&
        parsed.data.reachableCommitsHash === snapshot.reachableCommitsSha256 &&
        parsed.data.brokerPolicyHash === config.brokerPolicyHash;
      summaries.push({ prNumber: pr.number, acceptedCount: payload.accepted.length,
        suppressedCount: payload.suppressed.length, attestation: bound ? parsed.data : null });
      if (events.some(event => !event.allowed)) summaries[summaries.length - 1].attestation = null;
    } finally { await new Promise<void>((resolve, reject) => broker.close(error => error ? reject(error) : resolve())); }
  }
  return createQualityReport(manifest, matchFindings(manifest, adjudication, produced), summaries);
}
