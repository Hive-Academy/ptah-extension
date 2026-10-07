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

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { ProviderHealth } from '@ptah-extension/shared';

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
import {
  DispatchProvenanceCollector,
  MODEL_DISPATCH_PROVENANCE_TAP,
  RecordingRejectedError,
  commitProvenanceSidecars,
  discardStagedCassettes,
  expectedRouteFor,
  provenanceProblems,
  readStagedCassetteEntries,
  type ModelDispatchProvenance,
} from '../recorder/provider-provenance';
import {
  bootstrapIsolatedCodexAuth,
  CODEX_AUTH_SOURCE_ENV,
  RECORDING_DEADLINE_ENV,
  seedRecordModeOAuthEndpoint,
  sha256File,
  UNREACHABLE_OAUTH_TOKEN_ENDPOINT,
  type IsolatedCodexAuth,
} from './recording-bootstrap';
import { redactSecrets } from './redact-secrets';
import {
  canonicalProductSettingsSha256,
  OAUTH_TOKEN_ENDPOINT_SETTING,
  type ProductSettings,
} from '../runner/runner-plan';

export const HOST_COMPLETION_FILE = 'host-completion.json';
export const HOST_COMPLETION_SCHEMA_ID = '620.host-completion.v1';
export const HOST_NET_RECORDER_LOG = 'net-recorder.log';
/** Redacted copy of the CLI Logger output, retained after temp-home cleanup. */
export const HOST_LOG_FILE = 'host.log';
/** Redacted fatal error retained when boot or readiness prevents completion. */
export const HOST_ERROR_FILE = 'host-error.txt';
export const SDK_READINESS_TIMEOUT_MS = 60_000;
export const SDK_READINESS_POLL_MS = 50;

interface SdkReadinessAdapter {
  initialize(): Promise<boolean>;
  getHealth(): ProviderHealth;
}

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
  /**
   * Present only when product settings were written. Names and the canonical
   * map hash; never the values.
   */
  readonly settings?: {
    readonly names: readonly string[];
    readonly sha256: string;
  };
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
  /** Test seam for the record-mode SDK readiness gate. */
  readonly sdkReadiness?: {
    readonly timeoutMs?: number;
    readonly pollMs?: number;
    readonly sleep?: (milliseconds: number) => Promise<void>;
    readonly now?: () => number;
  };
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
  let settingsMeta: HostCompletion['settings'];
  let provenance: DispatchProvenanceCollector | undefined;
  let codexAuth: IsolatedCodexAuth | undefined;
  const allowedRoots = [plan.benchDataDir];
  if (plan.committedFixturesDir !== undefined) {
    allowedRoots.push(plan.committedFixturesDir);
  }

  try {
    const host = await deps.boot({
      workspace,
      beforeEngineBoot: ({ isolation }) => {
        mkdirSync(plan.runDir, { recursive: true });
        if (existsSync(join(plan.runDir, HOST_COMPLETION_FILE))) {
          throw new MemorySkillsPlanError(
            `run directory ${plan.runDir} already holds a completed run; use a new runId`,
          );
        }
        if (plan.cassetteMode === 'record') {
          seedRecordModeOAuthEndpoint(isolation.userDataPath);
        }
        const authSource = deps.env[CODEX_AUTH_SOURCE_ENV];
        if (authSource !== undefined) {
          const deadlineMs = Number(deps.env[RECORDING_DEADLINE_ENV]);
          codexAuth = bootstrapIsolatedCodexAuth({
            isolationHome: isolation.home,
            sourcePath: authSource,
            deadlineMs,
            env: deps.env,
          });
        }
        seeded = seedFixtures({
          fixtures: plan.fixtures,
          isolation,
          realHome: plan.realHome,
          allowedRoots,
        });
      },
      afterContainerReady: async (container) => {
        const applied = appliedProductSettings(plan);
        if (applied !== undefined) {
          settingsMeta = await writeProductSettings(container, applied);
        }
        if (plan.cassetteMode === 'record') {
          provenance = new DispatchProvenanceCollector();
          container.register(MODEL_DISPATCH_PROVENANCE_TAP, {
            useValue: provenance,
          });
        }
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
      if (plan.cassetteMode === 'record') {
        await waitForSdkReady(host.container, deps.sdkReadiness);
      }

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

      if (plan.cassetteMode === 'record') {
        acceptRecording({ plan, provenance, codexAuth });
      }

      const completion: HostCompletion = {
        schemaId: HOST_COMPLETION_SCHEMA_ID,
        runId: plan.runId,
        cassetteMode: plan.cassetteMode,
        ci: plan.ci,
        status:
          net !== null && net.attempts.length > 0
            ? 'net-violation'
            : 'complete',
        seeded,
        suites,
        net,
        ...(settingsMeta !== undefined ? { settings: settingsMeta } : {}),
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
      // Keep startup failures (including SDK readiness) diagnosable too.
      retainHostLog(host.isolation.userDataPath, plan.runDir);
      await host.stop();
    }
  } catch (error: unknown) {
    writeHostError(plan.runDir, error);
    throw error;
  }
}

/**
 * Record mode reaches the real curator through the SDK query runner. Engine
 * Boot intentionally leaves the adapter uninitialized. Start exactly one
 * initialization pass, then wait for its healthy terminal state.
 */
export async function waitForSdkReady(
  container: BenchHostContainer,
  options: MemorySkillsHostDeps['sdkReadiness'] = {},
): Promise<void> {
  if (!container.isRegistered(SDK_TOKENS.SDK_AGENT_ADAPTER, true)) {
    throw new Error(
      'record mode needs the SDK agent adapter; it is not registered in the bench host',
    );
  }
  const adapter = container.resolve<SdkReadinessAdapter>(
    SDK_TOKENS.SDK_AGENT_ADAPTER,
  );
  const timeoutMs = options.timeoutMs ?? SDK_READINESS_TIMEOUT_MS;
  const pollMs = options.pollMs ?? SDK_READINESS_POLL_MS;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const startedAt = now();
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'timeout'>((resolve) => {
    deadlineTimer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  let initialized: boolean | 'timeout';
  try {
    initialized = await Promise.race([adapter.initialize(), deadline]);
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
  }
  if (initialized === 'timeout') {
    const health = adapter.getHealth();
    throw new Error(
      `SDK adapter did not become ready within ${timeoutMs}ms (status: ${health.status})`,
    );
  }
  const initialHealth = adapter.getHealth();
  if (!initialized || initialHealth.status === 'error') {
    throw new Error(
      `SDK adapter initialization failed: ${redactSecrets(initialHealth.errorMessage ?? 'no error detail was provided')}`,
    );
  }

  for (;;) {
    const health = adapter.getHealth();
    if (health.status === 'available') return;
    if (health.status === 'error') {
      throw new Error(
        `SDK adapter initialization failed: ${redactSecrets(health.errorMessage ?? 'no error detail was provided')}`,
      );
    }
    if (now() - startedAt >= timeoutMs) {
      throw new Error(
        `SDK adapter did not become ready within ${timeoutMs}ms (status: ${health.status})`,
      );
    }
    await sleep(pollMs);
  }
}

function retainHostLog(userDataPath: string, runDir: string): void {
  try {
    const logsDir = join(userDataPath, 'logs');
    const output = join(runDir, HOST_LOG_FILE);
    writeFileSync(output, '', 'utf8');
    if (!existsSync(logsDir)) return;
    for (const entry of readdirSync(logsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.log')) continue;
      const source = join(logsDir, entry.name);
      try {
        const redacted = redactSecrets(readFileSync(source, 'utf8'));
        appendFileSync(output, `# ${entry.name}\n${redacted}`, 'utf8');
      } catch {
        // Keep collecting other log files when one diagnostic file is unreadable.
      }
    }
  } catch {
    process.stderr.write('Unable to retain redacted host log.\n');
  }
}

function writeHostError(runDir: string, error: unknown): void {
  try {
    mkdirSync(runDir, { recursive: true });
    const detail =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    writeFileSync(
      join(runDir, HOST_ERROR_FILE),
      `${redactSecrets(detail)}\n`,
      'utf8',
    );
  } catch {
    // Reporting a fatal error must never mask the original failure.
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

interface ProductConfigPort {
  getConfiguration<T>(
    section: string,
    key: string,
    defaultValue?: T,
  ): T | undefined;
  setConfiguration(section: string, key: string, value: unknown): Promise<void>;
}

/**
 * Settings the host writes under section `ptah`. Record mode always adds the
 * unreachable Codex token endpoint, overwriting a plan value of the same key.
 * Replay with no settings returns `undefined` (nothing is written).
 */
export function appliedProductSettings(
  plan: Pick<MemorySkillsPlan, 'cassetteMode' | 'settings'>,
): ProductSettings | undefined {
  const applied: ProductSettings = { ...(plan.settings ?? {}) };
  if (plan.cassetteMode === 'record') {
    applied[OAUTH_TOKEN_ENDPOINT_SETTING] = UNREACHABLE_OAUTH_TOKEN_ENDPOINT;
  }
  return Object.keys(applied).length === 0 ? undefined : applied;
}

async function writeProductSettings(
  container: BenchHostContainer,
  applied: ProductSettings,
): Promise<NonNullable<HostCompletion['settings']>> {
  if (!container.isRegistered(PLATFORM_TOKENS.WORKSPACE_PROVIDER, true)) {
    throw new MemorySkillsPlanError(
      'product settings need the workspace provider, and it is not registered',
    );
  }
  const workspace = container.resolve<ProductConfigPort>(
    PLATFORM_TOKENS.WORKSPACE_PROVIDER,
  );
  const names = Object.keys(applied).sort();
  for (const key of names) {
    const value = applied[key];
    await workspace.setConfiguration('ptah', key, value);
    if (!sameSetting(value, workspace.getConfiguration('ptah', key))) {
      throw new MemorySkillsPlanError(
        `product setting ${key} read back a different value`,
      );
    }
  }
  return { names, sha256: canonicalProductSettingsSha256(applied) };
}

function sameSetting(
  expected: string | number | boolean,
  actual: unknown,
): boolean {
  return actual === expected;
}

/**
 * In record mode, keep the cassettes only when every staged entry has an
 * exact provider/model dispatch and, when an auth file was copied, that file
 * is unchanged. Otherwise delete the cassette files and fail the run.
 */
function acceptRecording(input: {
  readonly plan: MemorySkillsPlan;
  readonly provenance: DispatchProvenanceCollector | undefined;
  readonly codexAuth: IsolatedCodexAuth | undefined;
}): void {
  if (input.provenance === undefined) {
    throw new RecordingRejectedError(
      'record mode did not register the provenance tap',
    );
  }
  const sides: readonly {
    readonly component: ModelDispatchProvenance['component'];
    readonly path: string;
    readonly model: string;
  }[] = [
    {
      component: 'memory-curator',
      path: input.plan.cassettes.curator.path,
      model: input.plan.cassettes.curator.model,
    },
    {
      component: 'skill-lane',
      path: input.plan.cassettes.laneRunner.path,
      model: input.plan.cassettes.laneRunner.model,
    },
  ];
  const paths = sides.map((side) => side.path);
  const problems: string[] = [];
  const staged: {
    component: ModelDispatchProvenance['component'];
    path: string;
    entries: ReturnType<typeof readStagedCassetteEntries>;
    dispatches: readonly ModelDispatchProvenance[];
  }[] = [];
  try {
    for (const side of sides) {
      const entries = readStagedCassetteEntries(side.path);
      const dispatches = input.provenance.forComponent(side.component);
      problems.push(
        ...provenanceProblems({
          component: side.component,
          entries,
          dispatches,
          expectedFor: (dispatch) =>
            expectedRouteFor(dispatch, input.plan.settings, side.model),
        }),
      );
      staged.push({
        component: side.component,
        path: side.path,
        entries,
        dispatches,
      });
    }
  } catch (error: unknown) {
    discardStagedCassettes(paths);
    throw error;
  }
  if (input.codexAuth !== undefined && authFileChanged(input.codexAuth)) {
    problems.push(
      'isolated auth.json changed during recording; the staged cassette was discarded',
    );
  }
  if (problems.length > 0) {
    discardStagedCassettes(paths);
    throw new RecordingRejectedError(problems.join('; '));
  }
  commitProvenanceSidecars(staged);
}

function authFileChanged(auth: IsolatedCodexAuth): boolean {
  try {
    return sha256File(auth.authFile) !== auth.sha256;
  } catch {
    return true;
  }
}
