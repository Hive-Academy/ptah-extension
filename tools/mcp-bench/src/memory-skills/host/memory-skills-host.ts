/**
 * The memory-skills bench host run (benchmark-design.md 6.1, R-X2 steps 1-7),
 * with every process-level collaborator injected so specs never boot an
 * engine. `memory-skills-host.entry.ts` wires the real ones.
 *
 * Order:
 *   1. `assertIsolated()` before anything else, then the workspace argument;
 *   2. the plan from `PTAH_BENCH_MEMORY_SKILLS_PLAN`, and every plan suite
 *      must be a registered host suite (refused before boot otherwise);
 *   3. `beforeEngineBoot`: create the run directory and copy the fixtures into
 *      the isolated home (`fixture-seeder.ts`);
 *   4. `afterContainerReady`: replace `CURATOR_LLM` and `LANE_RUNNER_SERVICE`
 *      with the record/replay doubles (`doubles-override.ts`), nothing else;
 *   5. the boot helper starts the HTTP MCP; the host prints the ready line the
 *      launcher waits for;
 *   6. the plan suites run one at a time, in plan order, in this process (in
 *      CI under the net recorder). A suite that throws is recorded as `error`
 *      and the next suite still runs; a shutdown request stops the run after
 *      the current suite and marks the rest `skipped`;
 *   7. the completion record is written to `<runDir>/host-completion.json`
 *      and announced on stdout, BEFORE the host waits for stdin EOF and stops
 *      the engine. A crash while the engine closes (win32 SQLite close after
 *      vec0 writes, TASK_2026_622) therefore loses no result; the parent
 *      reports it as `hostExit.kind: 'crash-on-shutdown'`, never as a suite
 *      error.
 *
 * Suites run strictly sequentially, so a suite may install process-wide state
 * for its own duration (for example a fake scheduler) and must restore it in
 * its own `finally`.
 */

import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  BenchHostContainer,
  BenchHostHandle,
  BootCodeExecutionHostOptions,
  IsolatedPaths,
} from '../../transport/bench-host-boot';
import type {
  NetAttempt,
  NetRecorderHandle,
  NetRecorderOptions,
} from '../runner/net-recorder';
import {
  installRecordReplayDoubles,
  type InstalledDoubles,
} from './doubles-override';
import { seedFixtures, type SeededFixture } from './fixture-seeder';
import { suitePlacementProblems, type SuitePlacement } from './suite-placement';
import {
  loadMemorySkillsPlan,
  MemorySkillsPlanError,
  type MemorySkillsPlan,
} from './plan.schema';

export const HOST_COMPLETION_FILE = 'host-completion.json';
export const HOST_COMPLETION_SCHEMA_ID = '620.host-completion.v1';
export const HOST_NET_RECORDER_LOG = 'net-recorder.log';

/** What a host suite receives. */
export interface MemorySkillsHostSuiteContext {
  readonly runId: string;
  /** Per-run artefact directory in the bench data folder. */
  readonly runDir: string;
  /** The plan entry's `options`; the suite validates them. */
  readonly options: unknown;
  readonly workspaceRoot: string;
  readonly isolation: IsolatedPaths;
  readonly container: BenchHostContainer;
  readonly doubles: InstalledDoubles;
  readonly ci: boolean;
}

/** A suite the host can run in-process. Registered in the host entry. */
export interface MemorySkillsHostSuite {
  readonly id: string;
  /**
   * Plan-order constraint on the shared database (`suite-placement.ts`);
   * default `any`. The host refuses a plan that breaks it before boot.
   */
  readonly placement?: SuitePlacement;
  /** Writes its own per-case artefacts under `runDir`; throws on a suite error. */
  run(context: MemorySkillsHostSuiteContext): Promise<void>;
}

export type HostSuiteRecord =
  | {
      readonly id: string;
      readonly status: 'completed';
      readonly durationMs: number;
    }
  | {
      readonly id: string;
      readonly status: 'error';
      readonly durationMs: number;
      readonly error: string;
    }
  | {
      readonly id: string;
      readonly status: 'skipped';
      readonly reason: 'shutdown-requested';
    };

export interface HostCompletion {
  readonly schemaId: typeof HOST_COMPLETION_SCHEMA_ID;
  readonly runId: string;
  readonly cassetteMode: MemorySkillsPlan['cassetteMode'];
  readonly ci: boolean;
  /** `net-violation`: CI suite execution recorded an outbound attempt. */
  readonly status: 'complete' | 'net-violation';
  readonly seeded: readonly SeededFixture[];
  readonly suites: readonly HostSuiteRecord[];
  /** `null` outside CI (no recorder installed). */
  readonly net: {
    readonly logFile: string;
    readonly attempts: readonly NetAttempt[];
  } | null;
}

export interface MemorySkillsHostDeps {
  /** 619's isolation check; must throw when the launcher did not isolate. */
  readonly assertIsolated: () => IsolatedPaths;
  /** The absolute workspace from `--workspace`; read after the isolation check. */
  readonly readWorkspace: () => string;
  readonly env: NodeJS.ProcessEnv;
  readonly boot: (
    options: BootCodeExecutionHostOptions,
  ) => Promise<BenchHostHandle>;
  readonly suites: readonly MemorySkillsHostSuite[];
  /** Resolves once on stdin EOF, SIGTERM or SIGINT. */
  readonly shutdownRequested: Promise<string>;
  readonly startNetRecorder: (options: NetRecorderOptions) => NetRecorderHandle;
  /** One JSON wire line on stdout. */
  readonly writeWire: (message: Record<string, unknown>) => void;
  /** The home this process resolves, for the ready line. */
  readonly homedir: () => string;
  readonly now?: () => number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function suiteRegistry(
  suites: readonly MemorySkillsHostSuite[],
): Map<string, MemorySkillsHostSuite> {
  const registry = new Map<string, MemorySkillsHostSuite>();
  for (const suite of suites) {
    if (registry.has(suite.id)) {
      throw new MemorySkillsPlanError(
        `host suite ${suite.id} is registered twice`,
      );
    }
    registry.set(suite.id, suite);
  }
  return registry;
}

/** Atomic write: a reader never sees a half-written completion record. */
function writeJsonAtomic(path: string, value: unknown): void {
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  renameSync(temp, path);
}

export interface MemorySkillsHostResult {
  readonly completion: HostCompletion;
  readonly shutdownReason: string;
}

/** Steps 1-7 of the module header. Rejects on a refusal or boot failure. */
export async function runMemorySkillsHost(
  deps: MemorySkillsHostDeps,
): Promise<MemorySkillsHostResult> {
  const now = deps.now ?? (() => performance.now());
  deps.assertIsolated();
  const workspace = deps.readWorkspace();
  const plan = loadMemorySkillsPlan({ env: deps.env });
  const registry = suiteRegistry(deps.suites);
  const unknown = plan.suites
    .map((suite) => suite.id)
    .filter((id) => !registry.has(id));
  if (unknown.length > 0) {
    throw new MemorySkillsPlanError(
      `the plan names suites this host does not have: ${unknown.join(', ')}`,
    );
  }
  const misplaced = suitePlacementProblems(
    plan.suites.map((suite) => suite.id),
    (id) => registry.get(id)?.placement ?? 'any',
  );
  if (misplaced.length > 0) {
    throw new MemorySkillsPlanError(
      `the plan orders host suites unsafely: ${misplaced.map((problem) => problem.message).join('; ')}`,
    );
  }

  let shutdownReason: string | null = null;
  void deps.shutdownRequested.then((reason) => {
    shutdownReason = reason;
  });

  let seeded: SeededFixture[] = [];
  let doubles: InstalledDoubles | undefined;
  const allowedRoots = [plan.benchDataDir];
  if (plan.committedFixturesDir !== undefined) {
    allowedRoots.push(plan.committedFixturesDir);
  }

  const host = await deps.boot({
    workspace,
    beforeEngineBoot: ({ isolation }) => {
      mkdirSync(plan.runDir, { recursive: true });
      if (existsSync(join(plan.runDir, HOST_COMPLETION_FILE))) {
        throw new MemorySkillsPlanError(
          `run directory ${plan.runDir} already holds a completed run; use a new runId`,
        );
      }
      seeded = seedFixtures({
        fixtures: plan.fixtures,
        isolation,
        realHome: plan.realHome,
        allowedRoots,
      });
    },
    afterContainerReady: (container) => {
      doubles = installRecordReplayDoubles(container, plan);
    },
  });

  try {
    if (doubles === undefined) {
      // The boot helper resolved without running afterContainerReady.
      throw new Error(
        'the record/replay doubles were not installed before MCP started',
      );
    }
    deps.writeWire({
      benchHost: 'ready',
      port: host.port,
      workspaceRoot: host.workspaceRoot,
      homedir: deps.homedir(),
      userDataPath: host.isolation.userDataPath,
      dbPath: host.isolation.dbPath,
    });

    const context = {
      runId: plan.runId,
      runDir: plan.runDir,
      workspaceRoot: host.workspaceRoot,
      isolation: host.isolation,
      container: host.container,
      doubles,
      ci: plan.ci,
    };
    const { suites, net } = await runSuites(
      plan,
      registry,
      context,
      deps,
      now,
      () => shutdownReason !== null,
    );

    const completion: HostCompletion = {
      schemaId: HOST_COMPLETION_SCHEMA_ID,
      runId: plan.runId,
      cassetteMode: plan.cassetteMode,
      ci: plan.ci,
      status:
        net !== null && net.attempts.length > 0 ? 'net-violation' : 'complete',
      seeded,
      suites,
      net,
    };
    const completionFile = join(plan.runDir, HOST_COMPLETION_FILE);
    writeJsonAtomic(completionFile, completion);
    deps.writeWire({
      benchHost: 'complete',
      runId: plan.runId,
      status: completion.status,
      completionFile,
    });

    const reason = await deps.shutdownRequested;
    return { completion, shutdownReason: reason };
  } finally {
    await host.stop();
  }
}

async function runSuites(
  plan: MemorySkillsPlan,
  registry: ReadonlyMap<string, MemorySkillsHostSuite>,
  context: Omit<MemorySkillsHostSuiteContext, 'options'>,
  deps: MemorySkillsHostDeps,
  now: () => number,
  stopRequested: () => boolean,
): Promise<{
  suites: HostSuiteRecord[];
  net: HostCompletion['net'];
}> {
  let recorder: NetRecorderHandle | null = null;
  if (plan.ci) {
    // The recorder writes its worker guard module into `dir` but creates only
    // the log file's directory itself.
    const dir = join(plan.runDir, 'net-recorder');
    mkdirSync(dir, { recursive: true });
    recorder = deps.startNetRecorder({
      dir,
      logFile: join(plan.runDir, HOST_NET_RECORDER_LOG),
      mainTag: 'memory-skills-host',
    });
  }
  const records: HostSuiteRecord[] = [];
  let attempts: NetAttempt[] = [];
  try {
    for (const entry of plan.suites) {
      if (stopRequested()) {
        records.push({
          id: entry.id,
          status: 'skipped',
          reason: 'shutdown-requested',
        });
        continue;
      }
      const started = now();
      try {
        const suite = registry.get(entry.id);
        // Unreachable: the plan was checked against the registry before boot.
        if (suite === undefined) throw new Error(`unknown suite ${entry.id}`);
        await suite.run({ ...context, options: entry.options });
        records.push({
          id: entry.id,
          status: 'completed',
          durationMs: now() - started,
        });
      } catch (error: unknown) {
        records.push({
          id: entry.id,
          status: 'error',
          durationMs: now() - started,
          error: messageOf(error),
        });
      }
    }
  } finally {
    // Restores the patches even when a suite left the loop by throwing.
    if (recorder !== null) attempts = recorder.stop();
  }
  return {
    suites: records,
    net: recorder === null ? null : { logFile: recorder.logFile, attempts },
  };
}
