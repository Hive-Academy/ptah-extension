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
    files = { prepare: jest.fn().mockResolvedValue('same'), sourceChecksum: jest.fn().mockResolvedValue('same'),
      clearOutput: jest.fn().mockResolvedValue(undefined),
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
    expect(files.clearOutput).toHaveBeenCalledWith('/attempt', expect.any(Boolean));
  });

  it('does not reuse lane one findings when lane two writes nothing', async () => {
    let output: string | undefined;
    files.clearOutput = jest.fn().mockImplementation(async () => { output = undefined; });
    gateway.spawn = jest.fn().mockImplementation(async () => {
      if (output === undefined && (gateway.spawn as jest.Mock).mock.calls.length === 1) {
        output = JSON.stringify({ schemaVersion: 1, headSha: sha, findings: [{
          schemaVersion: 1, lens: 'correctness-lifecycle', title: 'Prior finding', failureMode: 'A prior lane found a defect',
          affectedBehavior: 'Review result', scenario: 'The next lane writes no output', path: 'src/file.ts', line: 1,
          evidence: [{ path: 'src/file.ts', line: 1, excerpt: 'example' }], affectedCaller: null,
          severity: 'Major', category: 'functional', confidence: 0.9, suggestedDiff: null, fixPrompt: 'Fix the defect',
        }], coverage: ['finding'] });
      }
    });
    files.readOutput = jest.fn().mockImplementation(async (_root: string, name: string) => {
      if (name === 'walkthrough.md') return '# Observed behavior\n# Inferred risks\n# Risk map\n';
      if (output === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return output;
    });
    expect(await runner.run(request)).toMatchObject({ status: 'completed' });
    expect(await runner.run(request)).toMatchObject({ status: 'partial', reason: 'output-missing' });
    expect(files.clearOutput).toHaveBeenCalledTimes(3);
  });

  it('reads the file after spawn instead of treating stdout as the payload', async () => {
    gateway.spawn = async () => undefined;
    expect(await runner.run(request)).toMatchObject({ status: 'completed' });
  });

  it('accepts a UTF-8 BOM on JSON and the triage walkthrough', async () => {
    files.readOutput = jest.fn().mockImplementation(async (_root: string, name: string) => name === 'walkthrough.md'
      ? '\uFEFF# Observed behavior\n# Inferred risks\n# Risk map\n'
      : `\uFEFF${JSON.stringify({ schemaVersion: 1, headSha: sha, findings: [], coverage: [] }, null, 2)}`);
    expect(await runner.run(request)).toMatchObject({ status: 'completed', output: { findings: [] } });
  });

  it('reports missing output after a completed lane', async () => {
    files.readOutput = jest.fn().mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    expect(await runner.run(request)).toMatchObject({ status: 'partial', reason: 'output-missing' });
  });

  it('reports the schema path for invalid output', async () => {
    files.readOutput = jest.fn().mockResolvedValue(JSON.stringify({ schemaVersion: 1, headSha: sha, findings: [], coverage: 7 }));
    expect(await runner.run(request)).toMatchObject({ status: 'partial', reason: 'output-invalid: coverage' });
  });

  it('preserves precise status and timeout failures', async () => {
    gateway.spawn = async () => { throw new Error('status-failed: quota'); };
    expect(await runner.run(request)).toMatchObject({ status: 'partial', reason: 'status-failed: quota' });
    gateway.spawn = async () => { throw new Error('timeout'); };
    expect(await runner.run(request)).toMatchObject({ status: 'partial', reason: 'timeout' });
  });

  it('fails triage when the walkthrough lacks required headings', async () => {
    files.readOutput = jest.fn().mockImplementation(async (_root: string, name: string) => name === 'walkthrough.md'
      ? '# Observed behavior\n' : JSON.stringify({ schemaVersion: 1, headSha: sha, findings: [], coverage: [] }));
    expect(await runner.run(request)).toMatchObject({ status: 'partial', reason: expect.stringContaining('lane-failed: lane; Error; Triage walkthrough') });
    expect(files.clearOutput).toHaveBeenLastCalledWith('/attempt', true);
    expect(files.clearOutput).toHaveBeenCalledTimes(2);
  });

  it('removes a partial walkthrough when triage is aborted after spawn', async () => {
    gateway.spawn = async () => { now = 1000; };
    expect(await runner.run(request)).toMatchObject({ status: 'partial', reason: 'deadline' });
    expect(files.clearOutput).toHaveBeenLastCalledWith('/attempt', true);
  });

  it('runs when capacity is unknown and records the missing check', async () => {
    gateway.list = async () => ({ lanes: [{ id: 'lane', family: 'family-a', limitState: 'unknown' }], maxConcurrentAgents: 4 });
    const spawn = jest.spyOn(gateway, 'spawn');
    expect(await runner.run(request)).toMatchObject({ status: 'completed', limitCheck: 'unavailable' });
    expect(spawn).toHaveBeenCalled();
  });

  it('stores a sanitized lane failure reason', async () => {
    const secret = 'ghp_123456789012345678901234567890';
    gateway.spawn = async () => { throw new Error(`codex exit 1; ${secret}`); };
    const result = await runner.run(request);
    expect(result).toMatchObject({ status: 'partial', reason: expect.stringContaining('codex exit 1') });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('rejects a lane that changed the exact-SHA source', async () => {
    files.prepare = jest.fn().mockResolvedValue('before');
    const checksum = jest.fn().mockResolvedValue('after');
    files.sourceChecksum = checksum;
    expect(await runner.run(request)).toEqual({ status: 'partial', reason: 'source-mutated' });
    expect(checksum).toHaveBeenCalledTimes(1);
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
    expect(files.sourceChecksum).toHaveBeenCalledTimes(1);
  });

  it('reports deadline when the after-spawn snapshot aborts', async () => {
    gateway.spawn = async () => { now = 1000; };
    files.sourceChecksum = jest.fn().mockRejectedValue(new Error('Review snapshot aborted'));
    expect(await runner.run(request)).toEqual({ status: 'partial', reason: 'deadline' });
  });

  it('reports caller abort when the after-spawn snapshot aborts', async () => {
    const caller = new AbortController();
    gateway.spawn = async () => { caller.abort(); };
    files.sourceChecksum = jest.fn().mockRejectedValue(new Error('Review snapshot aborted'));
    expect(await runner.run({ ...request, signal: caller.signal })).toEqual({ status: 'partial', reason: 'aborted' });
  });

  it('allows the verifier the same 480 second lane window as lenses', async () => {
    const setTimer = jest.spyOn(clock, 'setTimeout');
    files.readOutput = jest.fn().mockResolvedValue(JSON.stringify({ schemaVersion: 1, candidateId: 'candidate', headSha: sha,
      verdict: 'inconclusive', checkedEvidence: [{ path: 'a.ts', line: 1, observation: 'checked' }], reason: 'no disproof',
      confidence: 0.5, verifierFamily: 'family-a' }));
    expect(await runner.run({ ...request, kind: 'verifier', runDeadlineMs: 600_000 })).toMatchObject({ status: 'completed' });
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 480_000);
  });

  it('allows triage a 480 second lane window', async () => {
    const setTimer = jest.spyOn(clock, 'setTimeout');
    expect(await runner.run({ ...request, runDeadlineMs: 600_000 })).toMatchObject({ status: 'completed' });
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 480_000);
  });

  it('labels same-family verification weaker', async () => {
    files.readOutput = jest.fn().mockResolvedValue(JSON.stringify({ schemaVersion: 1, candidateId: 'candidate', headSha: sha, verdict: 'inconclusive', checkedEvidence: [{ path: 'a.ts', line: 1, observation: 'checked' }], reason: 'no disproof', confidence: 0.5, verifierFamily: 'family-a' }));
    expect(await runner.run({ ...request, kind: 'verifier', lensAuthorFamily: 'family-a' }))
      .toMatchObject({ status: 'completed', evidenceStrength: 'weaker' });
  });
});
