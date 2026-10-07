/**
 * The memory-skills bench runner (benchmark-design.md 6.1, 6.4, 6.5, 7;
 * TASK_2026_620 Batch 16). One run is one launcher session:
 *
 *   1. read the runner plan through the read-path guard, check every offline
 *      suite is registered, and refuse a ground truth that is uncommitted or
 *      changed after its first scored run (`ground-truth-freshness.ts`);
 *   2. create `<benchData>/runs/<runId>/`, write the runner plan and the host
 *      plan (`620.host-plan.v1`, validated here before the host sees it);
 *   3. `launchBenchHost` with the memory-skills host script; the plan path
 *      reaches the child through `PTAH_BENCH_MEMORY_SKILLS_PLAN` in the
 *      inherited environment;
 *   4. inside the launcher window: the offline suites run here, in plan order,
 *      reading only through the read-path guard (619 answer 6); in `--ci` the
 *      parent's net recorder wraps them. The host runs its suites meanwhile;
 *   5. poll `<runDir>/host-completion.json` (the launcher stops reading the
 *      host's stdout after the ready line), then stop the host, which runs
 *      the real-state guard;
 *   6. read every suite's files and build the scorecard (`run-scorecard.ts`),
 *      written with 619's writers into the run directory;
 *   7. in `--ci`: evaluate `known-failures.v1.json` and fail on any recorded
 *      outbound attempt (`failIfAny`), after every artefact is on disk.
 *
 * A host crash while it shuts down is `run.hostExit.kind:
 * 'crash-on-shutdown'`, a run fact (TASK_2026_622), never a suite error.
 *
 * The runner parent never imports the memory-curator barrel or a host-only
 * module (`host-only-imports.spec.ts`); seeded-session generation runs in the
 * bench host.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { z } from 'zod';

import {
  writeScorecardJson,
  writeScorecardMarkdown,
} from '../../scorecard/scorecard-writers';
import type { Scorecard } from '../../scorecard/scorecard.types';
import type {
  HostExit,
  HostLaunchOptions,
  HostStopReport,
} from '../../transport/host-launcher';
import {
  evaluateKnownFailures,
  type KnownFailureSuite,
  type KnownFailuresGateResult,
} from '../gate/known-failures';
import {
  knownFailureEntrySchema,
  type KnownFailureEntry,
} from '../ground-truth/label-schemas';
import {
  createMemorySkillsPlanSchema,
  MEMORY_SKILLS_PLAN_ENV,
  MEMORY_SKILLS_PLAN_SCHEMA_ID,
} from '../host/plan.schema';
import '../memory-skills-suite-kinds';
import { SAFETY_CAP_MS } from './case-runner';
import {
  assertGroundTruthNotNewer,
  firstScoredRunsPath,
  mergeGroundTruthRefs,
  readFirstScoredRuns,
  recordFirstScoredRuns,
  resolveGroundTruthCommits,
} from './ground-truth-freshness';
import {
  HOST_COMPLETION_FILE,
  HOST_COMPLETION_SCHEMA_ID,
  HOST_NET_RECORDER_LOG,
  waitForHostCompletion,
  type HostCompletionView,
  type RunnerHost,
} from './host-completion-reader';
import type {
  NetAttempt,
  NetRecorderHandle,
  NetRecorderOptions,
} from './net-recorder';
import {
  offlineRegistry,
  runOfflineSuites,
  type MemorySkillsOfflineSuite,
  type OfflineStatus,
} from './offline-suites';
import {
  createReadPathGuard,
  listCommittedFiles,
  type GitRunner,
  type ReadPathGuard,
} from './read-path-guard';
import {
  collectSuites,
  guardSummary,
  readCorpus,
  readProduct,
  runArtifact,
  scorecardOs,
  sha256File,
  summariseSuites,
  toScorecardSuite,
  type MissingSuite,
  type ScoredSuite,
  type SuiteSummary,
} from './run-scorecard';
import {
  COMMITTED_FIXTURES_DIR,
  KNOWN_FAILURES_FILE,
  MemorySkillsRunError,
  parseRunnerPlan,
  RUNNER_PLAN_SCHEMA_ID,
  type RunnerPlan,
} from './runner-plan';
import {
  SUITE_RESULT_SCHEMA_ID,
  suiteCasesFile,
  suiteResultFile,
} from './suite-result';

export const RUN_SUMMARY_SCHEMA_ID = '620.run-summary.v1';
export const GATE_SCHEMA_ID = '620.gate.v1';

const RUNNER_PLAN_FILE = 'runner-plan.json';
const HOST_PLAN_FILE = 'host-plan.json';
const RUN_SUMMARY_FILE = 'run-summary.json';
const GATE_FILE = 'gate.json';
const RUNNER_NET_DIR = 'runner-net-recorder';
const RUNNER_NET_LOG = 'runner-net-recorder.log';
const NET_LOG_SCHEMA_ID = '620.net-log.v1';

const DEFAULT_HOST_COMPLETION_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const DEFAULT_POLL_MS = 500;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface RunMemorySkillsOptions {
  /** Absolute plan path: a committed repo file or a file in the bench data folder. */
  readonly planPath: string;
  readonly ci: boolean;
  readonly runId?: string;
  /** Workspace the host serves. Default: an empty `<runDir>/workspace`. */
  readonly workspace?: string;
  /** Built `memory-skills-host.mjs`. */
  readonly hostScript: string;
  /** Git top level of the checkout. */
  readonly repoRoot: string;
  /** The parent's `resolveBenchDataDir()` result. */
  readonly benchDataDir: string;
  readonly realHome: string;
  readonly hostCompletionTimeoutMs?: number;
}

export interface RunMemorySkillsDeps {
  readonly launch: (options: HostLaunchOptions) => Promise<RunnerHost>;
  readonly startNetRecorder: (options: NetRecorderOptions) => NetRecorderHandle;
  readonly git: GitRunner;
  readonly offlineSuites: readonly MemorySkillsOfflineSuite[];
  /** The environment the launcher spreads into the child: `process.env`. */
  readonly env: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly pollMs?: number;
}

export interface MemorySkillsRunResult {
  readonly runId: string;
  readonly runDir: string;
  readonly scorecardPath: string;
  readonly scorecardMarkdownPath: string;
  readonly summaryPath: string;
  readonly hostExit: HostExit;
  readonly suites: readonly SuiteSummary[];
  /** `null` outside `--ci`. */
  readonly gate: KnownFailuresGateResult | null;
  /** 1: CI gate failed, host completion missing, or the host exited early or was killed. */
  readonly exitCode: 0 | 1;
  readonly problems: readonly string[];
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
}

export function defaultRunId(at: Date): string {
  const stamp = at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  return `ms-${stamp}-${randomBytes(3).toString('hex')}`;
}

function createRunDir(benchDataDir: string, runId: string): string {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new MemorySkillsRunError(
      `run id ${runId}: letters, digits, ".", "_" and "-" only`,
    );
  }
  const runsDir = join(benchDataDir, 'runs');
  const runDir = join(runsDir, runId);
  mkdirSync(runsDir, { recursive: true });
  try {
    mkdirSync(runDir);
  } catch (error: unknown) {
    throw new MemorySkillsRunError(
      `cannot create run directory ${runDir} (use a new run id): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return runDir;
}

/** Step 2: the host plan, validated by the host's own schema before it is written. */
function writeHostPlan(
  plan: RunnerPlan,
  options: RunMemorySkillsOptions,
  runId: string,
  runDir: string,
  platform: NodeJS.Platform,
): string {
  const committedFixturesDir = join(options.repoRoot, COMMITTED_FIXTURES_DIR);
  const parsed = createMemorySkillsPlanSchema(platform).safeParse({
    schemaId: MEMORY_SKILLS_PLAN_SCHEMA_ID,
    runId,
    benchDataDir: options.benchDataDir,
    runDir,
    realHome: options.realHome,
    ...(existsSync(committedFixturesDir) ? { committedFixturesDir } : {}),
    cassetteMode: plan.cassetteMode,
    ci: options.ci,
    cassettes: plan.cassettes ?? {
      curator: {
        path: join(runDir, 'cassettes', 'curator.jsonl'),
        model: 'none',
      },
      laneRunner: {
        path: join(runDir, 'cassettes', 'lane-runner.jsonl'),
        model: 'none',
      },
    },
    fixtures: plan.fixtures,
    suites: plan.hostSuites.map(({ id, options: suiteOptions }) =>
      suiteOptions === undefined ? { id } : { id, options: suiteOptions },
    ),
  });
  if (!parsed.success) {
    throw new MemorySkillsRunError(
      `the plan does not make a valid host plan:\n${z.prettifyError(parsed.error)}`,
    );
  }
  const path = join(runDir, HOST_PLAN_FILE);
  writeJson(path, parsed.data);
  return path;
}

/** Set the plan env var for the spawn only; the child copies the env when it starts. */
async function launchWithPlan(
  deps: RunMemorySkillsDeps,
  hostPlanPath: string,
  options: HostLaunchOptions,
): Promise<RunnerHost> {
  const previous = deps.env[MEMORY_SKILLS_PLAN_ENV];
  deps.env[MEMORY_SKILLS_PLAN_ENV] = hostPlanPath;
  try {
    return await deps.launch(options);
  } finally {
    if (previous === undefined) delete deps.env[MEMORY_SKILLS_PLAN_ENV];
    else deps.env[MEMORY_SKILLS_PLAN_ENV] = previous;
  }
}

interface LauncherWindow {
  readonly offline: Map<string, OfflineStatus>;
  readonly completion: HostCompletionView | null;
  readonly recorder: NetRecorderHandle | null;
  readonly parentAttempts: NetAttempt[];
  readonly stopReport: HostStopReport;
}

/** Steps 4-5. The host is always stopped, whatever happens in the window. */
async function runLauncherWindow(
  host: RunnerHost,
  plan: RunnerPlan,
  registry: ReadonlyMap<string, MemorySkillsOfflineSuite>,
  context: {
    runId: string;
    runDir: string;
    ci: boolean;
    guard: ReadPathGuard;
    timeoutMs: number;
  },
  deps: RunMemorySkillsDeps,
): Promise<LauncherWindow> {
  try {
    let recorder: NetRecorderHandle | null = null;
    if (context.ci) {
      const dir = join(context.runDir, RUNNER_NET_DIR);
      mkdirSync(dir);
      recorder = deps.startNetRecorder({
        dir,
        logFile: join(context.runDir, RUNNER_NET_LOG),
        mainTag: 'memory-skills-runner',
      });
    }
    const active = recorder;
    let offline: Map<string, OfflineStatus>;
    let parentAttempts: NetAttempt[] = [];
    try {
      offline = await runOfflineSuites(plan, registry, {
        runId: context.runId,
        runDir: context.runDir,
        ci: context.ci,
        read: context.guard,
        guardWorkerEntry: (entry) =>
          active === null
            ? entry
            : active.guardedWorkerEntry(entry, 'offline-worker'),
      });
    } finally {
      if (active !== null) parentAttempts = active.stop();
    }
    const completion = await waitForHostCompletion({
      runDir: context.runDir,
      runId: context.runId,
      host,
      timeoutMs: context.timeoutMs,
      pollMs: deps.pollMs ?? DEFAULT_POLL_MS,
      sleep:
        deps.sleep ??
        ((ms: number) => new Promise<void>((done) => setTimeout(done, ms))),
    });
    const stopReport = await host.stop();
    return { offline, completion, recorder, parentAttempts, stopReport };
  } catch (error: unknown) {
    // stop() is idempotent; a guard failure here outranks the window error.
    await host.stop();
    throw error;
  }
}

function runArtifacts(
  runDir: string,
  scored: readonly ScoredSuite[],
): Scorecard['artifacts'] {
  return [
    runArtifact(runDir, RUNNER_PLAN_FILE, 'runner-plan', RUNNER_PLAN_SCHEMA_ID),
    runArtifact(
      runDir,
      HOST_PLAN_FILE,
      'host-plan',
      MEMORY_SKILLS_PLAN_SCHEMA_ID,
    ),
    runArtifact(
      runDir,
      HOST_COMPLETION_FILE,
      'host-completion',
      HOST_COMPLETION_SCHEMA_ID,
    ),
    ...scored.flatMap((entry) => [
      runArtifact(
        runDir,
        suiteResultFile(entry.result.suiteId),
        'suite-result',
        SUITE_RESULT_SCHEMA_ID,
      ),
      runArtifact(
        runDir,
        suiteCasesFile(entry.result.suiteId),
        'cases',
        `620.case.${entry.result.kind}.v1`,
      ),
    ]),
    runArtifact(runDir, HOST_NET_RECORDER_LOG, 'net-log', NET_LOG_SCHEMA_ID),
    runArtifact(runDir, RUNNER_NET_LOG, 'net-log', NET_LOG_SCHEMA_ID),
  ].filter((artifact) => artifact !== null);
}

function readKnownFailures(
  guard: ReadPathGuard,
  repoRoot: string,
): KnownFailureEntry[] {
  const path = join(repoRoot, KNOWN_FAILURES_FILE);
  // No file: no recorded failure, so any `fail` fails the gate. A file that
  // exists but is not committed is refused by the guard.
  if (!existsSync(path)) return [];
  return z
    .array(knownFailureEntrySchema)
    .parse(JSON.parse(guard.readText(path)));
}

/** Step 7: the recorded-failure ratchet over every plan suite. */
function evaluateGate(
  guard: ReadPathGuard,
  repoRoot: string,
  scored: readonly ScoredSuite[],
  verdicts: readonly KnownFailureSuite['verdict'][],
  missing: readonly MissingSuite[],
  netAttempts: readonly NetAttempt[],
): KnownFailuresGateResult {
  return evaluateKnownFailures({
    entries: readKnownFailures(guard, repoRoot),
    suites: [
      ...scored.map((entry, index) => ({
        id: entry.result.suiteId,
        verdict: verdicts[index],
        metrics: entry.result.metrics,
        executedCases: entry.cases.length,
      })),
      ...missing.map((entry) => ({
        id: entry.id,
        verdict: 'na' as const,
        metrics: {},
        executedCases: 0,
      })),
    ],
    signals: {
      cassetteMisses: scored.flatMap((entry) =>
        entry.cases
          .filter((c) => c.error?.startsWith('cassette-miss') === true)
          .map((c) => `${entry.result.suiteId}/${c.caseId}`),
      ),
      // A guard trip rejects stop() and aborts the run before the gate.
      guardTrips: [],
      networkHits: netAttempts.map(
        (attempt) => `${attempt.kind} ${attempt.tag} ${attempt.detail}`,
      ),
    },
  });
}

/** Steps 1-7 of the module header. */
export async function runMemorySkills(
  options: RunMemorySkillsOptions,
  deps: RunMemorySkillsDeps,
): Promise<MemorySkillsRunResult> {
  const now = deps.now ?? (() => new Date());
  const platform = deps.platform ?? process.platform;
  const os = scorecardOs(platform);

  // Step 1.
  const committedFiles = listCommittedFiles(deps.git);
  const guard = createReadPathGuard({
    repoRoot: options.repoRoot,
    benchDataDir: options.benchDataDir,
    realHome: options.realHome,
    committedFiles,
    platform,
  });
  const plan = parseRunnerPlan(
    guard.readText(options.planPath),
    options.planPath,
  );
  const registry = offlineRegistry(deps.offlineSuites, plan);
  const allSuites = [...plan.hostSuites, ...plan.offlineSuites];
  const groundTruths = resolveGroundTruthCommits(
    mergeGroundTruthRefs(allSuites.map((suite) => suite.groundTruth)),
    deps.git,
  );
  const ledgerPath = firstScoredRunsPath(options.benchDataDir);
  assertGroundTruthNotNewer(groundTruths, readFirstScoredRuns(ledgerPath));
  const { product, head } = readProduct(guard, deps.git, options.repoRoot);
  const corpus = readCorpus(guard, options.repoRoot, head, committedFiles);

  // Step 2.
  const startedAt = now().toISOString();
  const runId = options.runId ?? defaultRunId(now());
  const runDir = createRunDir(options.benchDataDir, runId);
  writeJson(join(runDir, RUNNER_PLAN_FILE), plan);
  const hostPlanPath = writeHostPlan(plan, options, runId, runDir, platform);
  let workspace = options.workspace;
  if (workspace === undefined) {
    workspace = join(runDir, 'workspace');
    mkdirSync(workspace);
  }

  // Steps 3-5.
  const host = await launchWithPlan(deps, hostPlanPath, {
    workspaceRoot: workspace,
    hostScript: options.hostScript,
    realHome: options.realHome,
    guard: { ci: options.ci },
  });
  const window = await runLauncherWindow(
    host,
    plan,
    registry,
    {
      runId,
      runDir,
      ci: options.ci,
      guard,
      timeoutMs:
        options.hostCompletionTimeoutMs ?? DEFAULT_HOST_COMPLETION_TIMEOUT_MS,
    },
    deps,
  );
  const { completion, stopReport } = window;

  // Step 6.
  const { scored, missing } = collectSuites(
    plan,
    runDir,
    completion,
    window.offline,
  );
  const suites = scored.map((entry) =>
    toScorecardSuite(entry, plan.cassetteMode, { runId, startedAt, host }),
  );
  const scorecard: Scorecard = {
    schemaVersion: 1,
    run: {
      id: runId,
      startedAt,
      host: 'cli-headless',
      os,
      node: process.version,
      guardMode: host.guardMode,
      guard: guardSummary(stopReport.guard),
      hostExit: { ...stopReport.exit },
    },
    product,
    corpus,
    artifacts: runArtifacts(runDir, scored),
    suites,
    lifecycle: [],
    eagerSelection: {
      eager: [],
      deferred: [],
      rule: 'not applicable: the memory-skills bench selects no MCP tools',
    },
  };
  const scorecardPath = await writeScorecardJson(scorecard, runDir);
  const scorecardMarkdownPath = await writeScorecardMarkdown(scorecard, runDir);
  const summaries = summariseSuites(scored, suites, missing);

  // Ground truths a suite actually scored against are now first-scored.
  const scoredIds = new Set(scored.map((entry) => entry.result.suiteId));
  const scoredGroundTruths = new Set(
    allSuites
      .filter((suite) => scoredIds.has(suite.id))
      .map((suite) => suite.groundTruth.id),
  );
  recordFirstScoredRuns(
    ledgerPath,
    groundTruths.filter((gt) => scoredGroundTruths.has(gt.id)),
    { runId, startedAt },
  );

  // Step 7.
  let gate: KnownFailuresGateResult | null = null;
  if (options.ci) {
    gate = evaluateGate(
      guard,
      options.repoRoot,
      scored,
      suites.map((suite) => suite.verdict),
      missing,
      [...(completion?.net?.attempts ?? []), ...window.parentAttempts],
    );
    writeJson(join(runDir, GATE_FILE), {
      schemaId: GATE_SCHEMA_ID,
      runId,
      ...gate,
    });
  }

  const problems: string[] = [];
  if (completion === null) {
    problems.push('the host wrote no completion record');
  }
  if (
    stopReport.exit.kind === 'exited-early' ||
    stopReport.exit.kind === 'killed'
  ) {
    problems.push(
      `host exit ${stopReport.exit.kind}${stopReport.exit.detail ? `: ${stopReport.exit.detail}` : ''}`,
    );
  }
  if (gate !== null && !gate.passed) {
    problems.push(
      `known-failures gate failed (${gate.findings.length} finding(s))`,
    );
  }

  const summaryPath = join(runDir, RUN_SUMMARY_FILE);
  writeJson(summaryPath, {
    schemaId: RUN_SUMMARY_SCHEMA_ID,
    runId,
    startedAt,
    ci: options.ci,
    cassetteMode: plan.cassetteMode,
    product,
    groundTruths,
    safetyCapMs: SAFETY_CAP_MS,
    hostCompletion: completion === null ? null : completion.status,
    hostExit: stopReport.exit,
    suites: summaries,
    parentNetAttempts: window.parentAttempts,
    scorecard: {
      path: relative(runDir, scorecardPath).split(sep).join('/'),
      sha256: sha256File(scorecardPath),
    },
    problems,
  });

  // The 563 net-guard rule: any outbound attempt in the parent fails the run,
  // after every artefact above is on disk.
  window.recorder?.failIfAny('memory-skills runner parent (offline suites)');

  return {
    runId,
    runDir,
    scorecardPath,
    scorecardMarkdownPath,
    summaryPath,
    hostExit: stopReport.exit,
    suites: summaries,
    gate,
    exitCode: problems.length > 0 ? 1 : 0,
    problems,
  };
}
