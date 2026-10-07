import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readScorecard } from '../../scorecard/scorecard-writers';
import type {
  HostLaunchOptions,
  HostStopReport,
} from '../../transport/host-launcher';
import {
  MEMORY_SKILLS_PLAN_ENV,
  createMemorySkillsPlanSchema,
} from '../host/plan.schema';
import { SAFETY_CAP_ERROR } from './case-runner';
import {
  firstScoredRunsDir,
  readFirstScoredRuns,
  recordFirstScoredRuns,
} from './ground-truth-freshness';
import type { RunnerHost } from './host-completion-reader';
import type { NetAttempt, NetRecorderHandle } from './net-recorder';
import type { MemorySkillsOfflineSuite } from './offline-suites';
import type { GitRunner } from './read-path-guard';
import { runMemorySkills, type RunMemorySkillsDeps } from './run-memory-skills';
import { PRODUCT_PACKAGE_JSON } from './run-scorecard';
import {
  COMMITTED_FIXTURES_DIR,
  KNOWN_FAILURES_FILE,
  RUNNER_PLAN_SCHEMA_ID,
} from './runner-plan';
import {
  writeSuiteResult,
  type CaseRecord,
  type SuiteResultInput,
} from './suite-result';

const HEAD = 'c'.repeat(40);
const GT_COMMIT = 'd'.repeat(40);
const GT_FILE = `${COMMITTED_FIXTURES_DIR}/memory-facts.v1.jsonl`;
const GT = { id: 'gt-memory@v1', paths: [GT_FILE] };

function suiteResult(
  suiteId: string,
  overrides: Partial<SuiteResultInput> = {},
): SuiteResultInput {
  return {
    suiteId,
    kind: 'liveness',
    details: {
      source: 'fault-injection',
      rescan: null,
      snapshotSha256: null,
      unprocessedAgeP95Ms: null,
      sessionsWithObservationsNoMemories: null,
      ranPassesWithError: null,
      faults: [],
    },
    claim: { source: 'ledger', ref: 'feature-ledger.md:12' },
    groundTruth: { id: 'gt-memory', version: 'v1', method: 'seeded' },
    baselines: [],
    deltas: {},
    cost: {
      calls: 2,
      latency_ms: { p50: 1, p95: 2 },
      error_rate: 0,
      tokens: {},
    },
    modelCalls: 0,
    verdict: 'pass',
    metrics: { 'fault.pass-rate': 1 },
    cassetteVersion: null,
    ...overrides,
  };
}

function caseRecord(
  caseId: string,
  extra: Partial<CaseRecord> = {},
): CaseRecord {
  return {
    caseId,
    inputSha256: 'e'.repeat(64),
    expected: 'x',
    observed: 'x',
    outcome: 'pass',
    latencyMs: 5,
    ...extra,
  };
}

interface HostScript {
  /** Suite files the fake host writes before its completion record. */
  readonly results?: Array<{ result: SuiteResultInput; cases: CaseRecord[] }>;
  readonly suiteStatus?: Record<string, 'completed' | 'error' | 'skipped'>;
  readonly writeCompletion?: boolean;
  readonly net?: NetAttempt[];
  readonly exitedEarly?: boolean;
  /** How the stop reports the host's end (default `clean`). */
  readonly exit?: HostStopReport['exit'];
  /** stop() rejects with this (a real-state guard trip). */
  readonly stopError?: Error;
}

describe('runMemorySkills (Batch 16)', () => {
  let root: string;
  let repo: string;
  let bench: string;
  let home: string;
  let env: NodeJS.ProcessEnv;
  let committed: string[];
  let launches: Array<{
    options: HostLaunchOptions;
    planEnv: string | undefined;
  }>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ptah-620-runner-'));
    repo = join(root, 'repo');
    bench = join(root, 'bench');
    home = join(root, 'home');
    mkdirSync(join(repo, COMMITTED_FIXTURES_DIR), { recursive: true });
    mkdirSync(join(repo, 'apps', 'ptah-electron'), { recursive: true });
    mkdirSync(bench, { recursive: true });
    mkdirSync(join(home, '.ptah'), { recursive: true });
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({ devDependencies: { typescript: '~6.0.3' } }),
    );
    writeFileSync(
      join(repo, PRODUCT_PACKAGE_JSON),
      JSON.stringify({ version: '0.1.70' }),
    );
    writeFileSync(join(repo, GT_FILE), '{}\n');
    writeFileSync(join(home, '.ptah', 'secret.json'), '{}');
    committed = ['package.json', PRODUCT_PACKAGE_JSON, GT_FILE];
    env = { KEEP: '1' };
    launches = [];
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const git: GitRunner = (args) => {
    switch (args[0]) {
      case 'ls-tree':
        return `${committed.join('\0')}\0`;
      case 'status':
        return '';
      case 'rev-parse':
        return `${HEAD}\n`;
      case 'log':
        return `${GT_COMMIT}\u00002026-10-07T00:00:00Z\n`;
      default:
        throw new Error(`unexpected git ${args.join(' ')}`);
    }
  };

  function writePlan(plan: Record<string, unknown>): string {
    const path = join(
      bench,
      `plan-${Math.random().toString(16).slice(2)}.json`,
    );
    writeFileSync(
      path,
      JSON.stringify({ schemaId: RUNNER_PLAN_SCHEMA_ID, ...plan }),
    );
    return path;
  }

  function fakeLaunch(script: HostScript = {}): RunMemorySkillsDeps['launch'] {
    return async (options) => {
      const planPath = env[MEMORY_SKILLS_PLAN_ENV];
      launches.push({ options, planEnv: planPath });
      if (planPath === undefined) throw new Error('no plan env');
      const plan = createMemorySkillsPlanSchema().parse(
        JSON.parse(readFileSync(planPath, 'utf8')),
      );
      for (const { result, cases } of script.results ?? []) {
        writeSuiteResult(plan.runDir, result, cases);
      }
      if (script.writeCompletion !== false) {
        writeFileSync(
          join(plan.runDir, 'host-completion.json'),
          JSON.stringify({
            schemaId: '620.host-completion.v1',
            runId: plan.runId,
            cassetteMode: plan.cassetteMode,
            ci: plan.ci,
            status:
              (script.net ?? []).length > 0 ? 'net-violation' : 'complete',
            seeded: [],
            suites: plan.suites.map(({ id }) => {
              const status = script.suiteStatus?.[id] ?? 'completed';
              if (status === 'error') {
                return { id, status, durationMs: 1, error: 'boom' };
              }
              if (status === 'skipped') {
                return { id, status, reason: 'shutdown-requested' };
              }
              return { id, status, durationMs: 1 };
            }),
            net: plan.ci ? { logFile: 'x', attempts: script.net ?? [] } : null,
          }),
        );
      }
      const stopReport: HostStopReport = {
        exit: script.exitedEarly
          ? { kind: 'exited-early', exitCode: 1, signal: null, detail: 'died' }
          : (script.exit ?? { kind: 'clean', exitCode: 0, signal: null }),
        isolatedDbCreated: true,
        guard: {
          mode: 'hash',
          before: { takenAt: '2026-10-07T00:00:00.000Z', files: [] },
          after: { takenAt: '2026-10-07T00:00:01.000Z', files: [] },
        },
      };
      const host: RunnerHost = {
        pid: 4242,
        port: 5151,
        guardMode: 'hash',
        exitedEarly: () => (script.exitedEarly ? 1 : undefined),
        stop: async () => {
          if (script.stopError !== undefined) throw script.stopError;
          return stopReport;
        },
      };
      return host;
    };
  }

  function fakeRecorder(
    attempts: NetAttempt[],
  ): RunMemorySkillsDeps['startNetRecorder'] {
    return (options) => {
      const handle: NetRecorderHandle = {
        dir: options.dir ?? '',
        logFile: options.logFile ?? '',
        guardModulePath: 'guard.cjs',
        attempts: () => attempts,
        allEntries: () => attempts,
        installs: () => [],
        guardedWorkerEntry: (path, tag) => `${path}#${tag ?? 'worker'}`,
        failIfAny: (label) => {
          if (attempts.length > 0) throw new Error(`${label}: outbound`);
        },
        stop: () => attempts,
      };
      return handle;
    };
  }

  function deps(
    overrides: Partial<RunMemorySkillsDeps> = {},
  ): RunMemorySkillsDeps {
    return {
      launch: fakeLaunch(),
      startNetRecorder: fakeRecorder([]),
      git,
      offlineSuites: [],
      env,
      platform: process.platform === 'win32' ? 'win32' : 'linux',
      sleep: async () => undefined,
      pollMs: 1,
      ...overrides,
    };
  }

  const options = (planPath: string, extra: Record<string, unknown> = {}) => ({
    planPath,
    ci: false,
    runId: 'ms-test',
    hostScript: join(root, 'memory-skills-host.mjs'),
    repoRoot: repo,
    benchDataDir: bench,
    realHome: home,
    hostCompletionTimeoutMs: 1_000,
    ...extra,
  });

  it('runs an empty plan through one launcher session and writes a valid scorecard', async () => {
    const result = await runMemorySkills(options(writePlan({})), deps());

    expect(result.exitCode).toBe(0);
    expect(result.runDir).toBe(join(bench, 'runs', 'ms-test'));
    expect(launches).toHaveLength(1);
    expect(launches[0].planEnv).toBe(join(result.runDir, 'host-plan.json'));
    expect(launches[0].options.workspaceRoot).toBe(
      join(result.runDir, 'workspace'),
    );
    // The plan variable is set for the spawn only.
    expect(env).toEqual({ KEEP: '1' });

    const scorecard = await readScorecard(result.scorecardPath);
    expect(scorecard.suites).toEqual([]);
    expect(scorecard.run.hostExit.kind).toBe('clean');
    expect(scorecard.product).toEqual({ version: '0.1.70', commit: HEAD });
    expect(scorecard.artifacts.map((a) => a.kind)).toEqual([
      'runner-plan',
      'host-plan',
      'host-completion',
    ]);
    expect(existsSync(join(result.runDir, 'scorecard.md'))).toBe(true);
    // An empty plan scores nothing, so no ground truth becomes first-scored.
    expect(existsSync(firstScoredRunsDir(bench))).toBe(false);
  });

  describe('PTAH_BENCH_MEMORY_SKILLS_PLAN restore (review finding 9b)', () => {
    it('restores a previous value after a successful launch', async () => {
      env[MEMORY_SKILLS_PLAN_ENV] = 'previous';
      await runMemorySkills(options(writePlan({})), deps());
      expect(launches[0].planEnv).not.toBe('previous');
      expect(env[MEMORY_SKILLS_PLAN_ENV]).toBe('previous');
    });

    it('removes the variable when the launch throws', async () => {
      await expect(
        runMemorySkills(
          options(writePlan({})),
          deps({
            launch: async () => {
              expect(env[MEMORY_SKILLS_PLAN_ENV]).toBeDefined();
              throw new Error('spawn failed');
            },
          }),
        ),
      ).rejects.toThrow('spawn failed');
      expect(env).toEqual({ KEEP: '1' });
    });
  });

  it('keeps a crash-on-shutdown run at exit 0 with its suite results (review finding 9a)', async () => {
    const result = await runMemorySkills(
      options(writePlan({ hostSuites: [{ id: 'mem.ok', groundTruth: GT }] })),
      deps({
        launch: fakeLaunch({
          results: [
            { result: suiteResult('mem.ok'), cases: [caseRecord('c1')] },
          ],
          exit: {
            kind: 'crash-on-shutdown',
            exitCode: 3221226505,
            signal: null,
            detail: 'fail-fast after the graceful stop began',
          },
        }),
      }),
    );
    expect(result.exitCode).toBe(0);
    expect(result.problems).toEqual([]);
    expect(result.hostExit.kind).toBe('crash-on-shutdown');
    const scorecard = await readScorecard(result.scorecardPath);
    expect(scorecard.run.hostExit.kind).toBe('crash-on-shutdown');
    expect(scorecard.suites).toHaveLength(1);
    expect(scorecard.suites[0].verdict).toBe('pass');
  });

  it('fails a non-CI run whose offline suite was refused a read (review finding 3)', async () => {
    const offline: MemorySkillsOfflineSuite = {
      id: 'skill.reads-ptah',
      run: async (context) => {
        context.read.readText(join(home, '.ptah', 'secret.json'));
        throw new Error('unreachable');
      },
    };
    const result = await runMemorySkills(
      options(
        writePlan({
          offlineSuites: [{ id: 'skill.reads-ptah', groundTruth: GT }],
        }),
      ),
      deps({ offlineSuites: [offline] }),
    );
    expect(result.gate).toBeNull();
    expect(result.exitCode).toBe(1);
    expect(result.problems).toEqual([
      expect.stringMatching(
        /^suite skill\.reads-ptah has no result: suite-error: read refused: .*real Ptah state directory/,
      ),
    ]);
  });

  it('refuses a --workspace that is, lies in or holds the real ~/.ptah (review finding 8)', async () => {
    for (const workspace of [
      join(home, '.ptah'),
      join(home, '.ptah', 'sub'),
      home,
    ]) {
      await expect(
        runMemorySkills(options(writePlan({}), { workspace }), deps()),
      ).rejects.toThrow(/overlaps the real Ptah state directory/);
    }
    expect(launches).toHaveLength(0);
  });

  describe('stop() failures in the launcher window (review finding 10)', () => {
    it('keeps the window error and the stop error when the retry stop rejects', async () => {
      const guardTrip = new Error('RealStateChangedError: ptah.sqlite changed');
      const inner = fakeLaunch({
        writeCompletion: false,
        stopError: guardTrip,
      });
      const launch: RunMemorySkillsDeps['launch'] = async (launchOptions) => {
        const host = await inner(launchOptions);
        writeFileSync(
          join(bench, 'runs', 'ms-test', 'host-completion.json'),
          '{"schemaId":"620.host-completion.v1","runId":"other"}',
        );
        return host;
      };
      const failure = await runMemorySkills(
        options(writePlan({})),
        deps({ launch }),
      ).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(AggregateError);
      const errors = (failure as AggregateError).errors as Error[];
      expect(errors[0].message).toMatch(/invalid host completion/);
      expect(errors[1]).toBe(guardTrip);
    });

    it('reports a guard trip in the normal stop as itself, stopping once', async () => {
      const guardTrip = new Error('BenchHeldRealStateError: held');
      let stops = 0;
      const inner = fakeLaunch({ stopError: guardTrip });
      const launch: RunMemorySkillsDeps['launch'] = async (launchOptions) => {
        const host = await inner(launchOptions);
        return {
          ...host,
          stop: () => {
            stops += 1;
            return host.stop();
          },
        };
      };
      await expect(
        runMemorySkills(options(writePlan({})), deps({ launch })),
      ).rejects.toBe(guardTrip);
      expect(stops).toBe(1);
    });
  });

  it('scores host and offline suites, sets cost.source and records per-case runtime', async () => {
    const offline: MemorySkillsOfflineSuite = {
      id: 'skill.rubric.inter-rater',
      run: async (context) => {
        expect(context.read.readText(join(repo, GT_FILE))).toBe('{}\n');
        expect(() =>
          context.read.readText(join(home, '.ptah', 'secret.json')),
        ).toThrow(/real Ptah state directory/);
        expect(context.guardWorkerEntry('w.js')).toBe('w.js');
        return {
          result: suiteResult('skill.rubric.inter-rater'),
          cases: [caseRecord('r1', { latencyMs: 7 })],
        };
      },
    };
    const result = await runMemorySkills(
      options(
        writePlan({
          hostSuites: [{ id: 'mem.liveness.fault', groundTruth: GT }],
          offlineSuites: [{ id: 'skill.rubric.inter-rater', groundTruth: GT }],
        }),
      ),
      deps({
        offlineSuites: [offline],
        launch: fakeLaunch({
          results: [
            {
              result: suiteResult('mem.liveness.fault', { modelCalls: 2 }),
              cases: [
                caseRecord('c1', { latencyMs: 30 }),
                caseRecord('c2', { latencyMs: 90, attempts: 2 }),
                caseRecord('c3', {
                  latencyMs: 120_000,
                  attempts: 2,
                  outcome: 'fail',
                  error: SAFETY_CAP_ERROR,
                }),
              ],
            },
          ],
        }),
      }),
    );

    expect(result.exitCode).toBe(0);
    const scorecard = await readScorecard(result.scorecardPath);
    expect(scorecard.suites.map((s) => s.cost.source)).toEqual([
      'cassette',
      'none',
    ]);
    for (const suite of scorecard.suites) {
      expect(suite.projectionSha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(result.suites).toEqual([
      expect.objectContaining({
        id: 'mem.liveness.fault',
        placement: 'host',
        cases: 3,
        maxCaseLatencyMs: 120_000,
        retriedCases: 2,
        safetyCapCases: 1,
      }),
      expect.objectContaining({
        id: 'skill.rubric.inter-rater',
        placement: 'offline',
        maxCaseLatencyMs: 7,
      }),
    ]);
    expect(scorecard.artifacts.map((a) => a.schemaId)).toContain(
      '620.case.liveness.v1',
    );
    const ledger = readFirstScoredRuns(firstScoredRunsDir(bench));
    expect(ledger.groundTruths['gt-memory@v1']).toMatchObject({
      runId: 'ms-test',
      commit: GT_COMMIT,
    });
  });

  it('cost.source is live for a record-mode suite with model calls', async () => {
    const result = await runMemorySkills(
      options(
        writePlan({
          cassetteMode: 'record',
          hostSuites: [{ id: 'mem.extraction', groundTruth: GT }],
        }),
      ),
      deps({
        launch: fakeLaunch({
          results: [
            {
              result: suiteResult('mem.extraction', { modelCalls: 1 }),
              cases: [caseRecord('c1')],
            },
          ],
        }),
      }),
    );
    const scorecard = await readScorecard(result.scorecardPath);
    expect(scorecard.suites[0].cost.source).toBe('live');
  });

  it('turns a suite with zero executed cases into na: zero-cases', async () => {
    const result = await runMemorySkills(
      options(
        writePlan({ hostSuites: [{ id: 'mem.empty', groundTruth: GT }] }),
      ),
      deps({
        launch: fakeLaunch({
          results: [{ result: suiteResult('mem.empty'), cases: [] }],
        }),
      }),
    );
    const scorecard = await readScorecard(result.scorecardPath);
    expect(scorecard.suites[0]).toMatchObject({
      verdict: 'na',
      naReason: 'zero-cases',
    });
    // A forced zero-cases na scored nothing, so it starts no ratchet.
    expect(existsSync(firstScoredRunsDir(bench))).toBe(false);
  });

  it('does not mark a ground truth first-scored when every suite on it is na', async () => {
    const result = await runMemorySkills(
      options(
        writePlan({ hostSuites: [{ id: 'mem.unlabelled', groundTruth: GT }] }),
      ),
      deps({
        launch: fakeLaunch({
          results: [
            {
              result: suiteResult('mem.unlabelled', {
                verdict: 'na',
                naReason: 'ground-truth-untrusted',
              }),
              cases: [caseRecord('c1')],
            },
          ],
        }),
      }),
    );
    expect(result.exitCode).toBe(0);
    expect(existsSync(firstScoredRunsDir(bench))).toBe(false);
  });

  it('reports a host suite error as missing, writes the scorecard and exits 1 outside --ci (review finding 3)', async () => {
    const result = await runMemorySkills(
      options(
        writePlan({ hostSuites: [{ id: 'mem.broken', groundTruth: GT }] }),
      ),
      deps({ launch: fakeLaunch({ suiteStatus: { 'mem.broken': 'error' } }) }),
    );
    expect(result.gate).toBeNull();
    expect(result.exitCode).toBe(1);
    expect(result.problems).toEqual([
      'suite mem.broken has no result: suite-error: boom',
    ]);
    expect(result.suites).toEqual([
      expect.objectContaining({
        id: 'mem.broken',
        status: 'missing',
        reason: 'suite-error: boom',
      }),
    ]);
    expect((await readScorecard(result.scorecardPath)).suites).toEqual([]);
  });

  it('fails the run when the host exits early without a completion record', async () => {
    const result = await runMemorySkills(
      options(writePlan({ hostSuites: [{ id: 'mem.x', groundTruth: GT }] })),
      deps({
        launch: fakeLaunch({ writeCompletion: false, exitedEarly: true }),
      }),
    );
    expect(result.exitCode).toBe(1);
    expect(result.suites[0]).toMatchObject({ reason: 'host-incomplete' });
    expect(result.problems).toEqual([
      'the host wrote no completion record',
      'host exit exited-early: died',
      'suite mem.x has no result: host-incomplete',
    ]);
  });

  it('stops the host when the launcher window fails', async () => {
    let stops = 0;
    const inner = fakeLaunch({ writeCompletion: false });
    const launch: RunMemorySkillsDeps['launch'] = async (launchOptions) => {
      const host = await inner(launchOptions);
      const runDir = join(bench, 'runs', 'ms-test');
      writeFileSync(
        join(runDir, 'host-completion.json'),
        JSON.stringify({ schemaId: '620.host-completion.v1', runId: 'other' }),
      );
      return {
        ...host,
        stop: () => {
          stops += 1;
          return host.stop();
        },
      };
    };
    await expect(
      runMemorySkills(options(writePlan({})), deps({ launch })),
    ).rejects.toThrow(/invalid host completion/);
    expect(stops).toBe(1);
  });

  describe('--ci', () => {
    it('evaluates known failures and fails on an unlisted failing suite', async () => {
      const result = await runMemorySkills(
        options(
          writePlan({ hostSuites: [{ id: 'mem.update', groundTruth: GT }] }),
          {
            ci: true,
          },
        ),
        deps({
          launch: fakeLaunch({
            results: [
              {
                result: suiteResult('mem.update', {
                  verdict: 'fail',
                  metrics: { correct: 0.5 },
                }),
                cases: [caseRecord('c1', { outcome: 'fail' })],
              },
            ],
          }),
        }),
      );
      expect(result.exitCode).toBe(1);
      expect(result.gate?.findings.map((f) => f.kind)).toEqual(['new-failure']);
      const gate = JSON.parse(
        readFileSync(join(result.runDir, 'gate.json'), 'utf8'),
      );
      expect(gate).toMatchObject({ schemaId: '620.gate.v1', passed: false });
    });

    it('accepts a listed failure at its recorded value', async () => {
      writeFileSync(
        join(repo, KNOWN_FAILURES_FILE),
        JSON.stringify([
          {
            suiteId: 'mem.update',
            metric: 'correct',
            direction: 'higher-is-better',
            recordedValue: 0.5,
            ledgerRow: 'R-1',
            since: '2026-10-07',
          },
        ]),
      );
      committed.push(KNOWN_FAILURES_FILE);
      const result = await runMemorySkills(
        options(
          writePlan({ hostSuites: [{ id: 'mem.update', groundTruth: GT }] }),
          {
            ci: true,
          },
        ),
        deps({
          launch: fakeLaunch({
            results: [
              {
                result: suiteResult('mem.update', {
                  verdict: 'fail',
                  metrics: { correct: 0.5 },
                }),
                cases: [caseRecord('c1', { outcome: 'fail' })],
              },
            ],
          }),
        }),
      );
      expect(result.gate).toEqual({ passed: true, findings: [] });
      expect(result.exitCode).toBe(0);
    });

    it('fails on an outbound attempt in the parent after writing every artefact', async () => {
      const attempt: NetAttempt = {
        kind: 'dns-lookup',
        tag: 'memory-skills-runner',
        detail: 'example.com',
      };
      const offline: MemorySkillsOfflineSuite = {
        id: 'skill.offline',
        run: async (context) => {
          expect(context.guardWorkerEntry('w.js')).toBe('w.js#offline-worker');
          return {
            result: suiteResult('skill.offline'),
            cases: [caseRecord('c1')],
          };
        },
      };
      await expect(
        runMemorySkills(
          options(
            writePlan({
              offlineSuites: [{ id: 'skill.offline', groundTruth: GT }],
            }),
            { ci: true },
          ),
          deps({
            offlineSuites: [offline],
            startNetRecorder: fakeRecorder([attempt]),
          }),
        ),
      ).rejects.toThrow(
        'memory-skills runner parent (offline suites): outbound',
      );
      const runDir = join(bench, 'runs', 'ms-test');
      const gate = JSON.parse(readFileSync(join(runDir, 'gate.json'), 'utf8'));
      expect(gate.findings).toEqual([
        expect.objectContaining({
          kind: 'network-hit',
          message: 'network hit: dns-lookup memory-skills-runner example.com',
        }),
      ]);
      expect(existsSync(join(runDir, 'run-summary.json'))).toBe(true);
    });
  });

  describe('refusals before launch', () => {
    it('refuses a ground truth committed after its first scored run', async () => {
      recordFirstScoredRuns(
        firstScoredRunsDir(bench),
        [
          {
            id: 'gt-memory@v1',
            commit: 'f'.repeat(40),
            committedAt: '2026-10-05T00:00:00Z',
          },
        ],
        { runId: 'ms-earlier', startedAt: '2026-10-06T00:00:00.000Z' },
      );
      await expect(
        runMemorySkills(
          options(
            writePlan({ hostSuites: [{ id: 'mem.x', groundTruth: GT }] }),
          ),
          deps(),
        ),
      ).rejects.toThrow(/newer than its first scored run ms-earlier/);
      expect(launches).toHaveLength(0);
    });

    it('refuses an offline suite the runner does not have', async () => {
      await expect(
        runMemorySkills(
          options(
            writePlan({ offlineSuites: [{ id: 'nope', groundTruth: GT }] }),
          ),
          deps(),
        ),
      ).rejects.toThrow(/offline suites the runner does not have: nope/);
      expect(launches).toHaveLength(0);
    });

    it('refuses a plan outside the committed files and the bench data folder', async () => {
      const outside = join(root, 'plan.json');
      writeFileSync(
        outside,
        JSON.stringify({ schemaId: RUNNER_PLAN_SCHEMA_ID }),
      );
      await expect(runMemorySkills(options(outside), deps())).rejects.toThrow(
        /read refused/,
      );
    });

    it('refuses a plan suite without a ground truth and a CI record plan', async () => {
      await expect(
        runMemorySkills(
          options(writePlan({ hostSuites: [{ id: 'mem.x' }] })),
          deps(),
        ),
      ).rejects.toThrow(/invalid plan/);
      await expect(
        runMemorySkills(
          options(writePlan({ cassetteMode: 'record' }), { ci: true }),
          deps(),
        ),
      ).rejects.toThrow(/a CI plan must use cassetteMode "replay"/);
      expect(launches).toHaveLength(0);
    });

    it('refuses an existing run directory', async () => {
      mkdirSync(join(bench, 'runs', 'ms-test'), { recursive: true });
      await expect(
        runMemorySkills(options(writePlan({})), deps()),
      ).rejects.toThrow(/use a new run id/);
    });
  });
});
