import { ReviewLaneRunner, type IReviewLaneFiles, type IReviewLaneGateway, type ReviewLaneRequest } from './review-lane.runner';
import { ReviewLaneAdmissionService, type IReviewLaneClock } from './review-lane-admission.service';

const sha = 'a'.repeat(40);
const repo = { owner: 'Hive-Academy', name: 'PtahCode' } as const;
const request: ReviewLaneRequest = { repo, prKey: 'repo#1', attemptId: 'attempt-1', attemptRoot: '/attempt', headSha: sha, kind: 'triage', prompt: 'review', runDeadlineMs: 1000 };

describe('ReviewLaneRunner', () => {
  let now: number;
  let clock: IReviewLaneClock;
  let gateway: IReviewLaneGateway;
  let files: IReviewLaneFiles;
  let runner: ReviewLaneRunner;
  const logger = { error: jest.fn() };

  beforeEach(() => {
    now = 0;
    clock = { now: () => now, setTimeout, clearTimeout };
    gateway = {
      list: async () => ({ lanes: [{ id: 'lane', family: 'family-a', limitState: 'confirmed-room' }], maxConcurrentAgents: 4 }),
      spawn: async () => undefined,
    };
    files = { prepare: jest.fn().mockResolvedValue(undefined), sourceChecksum: jest.fn().mockResolvedValue('same'),
      readOutput: jest.fn().mockImplementation(async (_root: string, name: string) => name === 'walkthrough.md'
        ? '# Observed behavior\n\n# Inferred risks\n\n# Risk map\n'
        : JSON.stringify({ schemaVersion: 1, headSha: sha, findings: [], coverage: [] })) };
    runner = new ReviewLaneRunner(gateway, files, clock, new ReviewLaneAdmissionService(clock), logger,
      { resolve: async () => ({ repoRoot: '/repo', attemptsRoot: '/attempts' }),
        settings: async () => ({ repositories: [{ owner: 'Hive-Academy', name: 'PtahCode', enabled: true, dryRun: true, publicationPaused: false }],
          maintainerLogins: ['maintainer'], pollMinutes: 10, globalPublicationPaused: false, laneCapPerPr: 6, fallbackFamilies: [] }),
        baseConfig: async () => null });
    logger.error.mockClear();
  });

  it('runs in the attempt root and accepts a validated payload', async () => {
    const spawn = jest.spyOn(gateway, 'spawn');
    expect(await runner.run(request)).toMatchObject({ status: 'completed', family: 'family-a' });
    expect(files.prepare).toHaveBeenCalledWith(repo, '/attempt', sha, expect.any(AbortSignal));
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/attempt' }));
    expect(files.readOutput).toHaveBeenCalledWith('/attempt', 'lane-output.json');
  });

  it('reads the file after spawn instead of treating stdout as the payload', async () => {
    gateway.spawn = async () => undefined;
    expect(await runner.run(request)).toMatchObject({ status: 'completed' });
  });

  it('fails triage when the walkthrough lacks required headings', async () => {
    files.readOutput = jest.fn().mockImplementation(async (_root: string, name: string) => name === 'walkthrough.md'
      ? '# Observed behavior\n' : JSON.stringify({ schemaVersion: 1, headSha: sha, findings: [], coverage: [] }));
    expect(await runner.run(request)).toEqual({ status: 'partial', reason: 'lane-failed' });
  });

  it('returns partial immediately when capacity is unknown', async () => {
    gateway.list = async () => ({ lanes: [{ id: 'lane', family: 'family-a', limitState: 'unknown' }], maxConcurrentAgents: 4 });
    const spawn = jest.spyOn(gateway, 'spawn');
    expect(await runner.run(request)).toEqual({ status: 'partial', reason: 'no-confirmed-room' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('rejects a lane that changed the exact-SHA source', async () => {
    const checksum = jest.fn().mockResolvedValueOnce('before').mockResolvedValueOnce('after');
    files.sourceChecksum = checksum;
    expect(await runner.run(request)).toEqual({ status: 'partial', reason: 'source-mutated' });
    expect(checksum).toHaveBeenCalledTimes(2);
  });

  it('does not start after the deadline', async () => {
    now = 1000;
    const spawn = jest.spyOn(gateway, 'spawn');
    expect(await runner.run(request)).toEqual({ status: 'partial', reason: 'deadline' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('marks a lane that finishes after its deadline partial', async () => {
    gateway.spawn = async () => {
      now = 1000;
    };
    expect(await runner.run(request)).toEqual({ status: 'partial', reason: 'deadline' });
    expect(files.sourceChecksum).toHaveBeenCalledTimes(2);
  });

  it('labels same-family verification weaker', async () => {
    files.readOutput = jest.fn().mockResolvedValue(JSON.stringify({ schemaVersion: 1, candidateId: 'candidate', headSha: sha, verdict: 'inconclusive', checkedEvidence: [{ path: 'a.ts', line: 1, observation: 'checked' }], reason: 'no disproof', confidence: 0.5, verifierFamily: 'family-a' }));
    expect(await runner.run({ ...request, kind: 'verifier', lensAuthorFamily: 'family-a' }))
      .toMatchObject({ status: 'completed', evidenceStrength: 'weaker' });
  });
});
