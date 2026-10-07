/**
 * Launches the `cli-headless` bench host with its state isolated from the
 * user's, and proves afterwards that the user's real database was untouched.
 *
 * Isolation: the child runs with `HOME`, `USERPROFILE` (what `os.homedir()`
 * reads on POSIX and Windows), `APPDATA`, `LOCALAPPDATA` and the XDG dirs
 * pointed into a fresh temp directory, plus an explicit Ptah data directory
 * (`PTAH_CONFIG_PATH`, which `withEngine` uses as `userDataPath`) and database
 * (`PTAH_DB_PATH`, which `resolvePtahDbPath` honours before anything else).
 * The host reports the home it actually sees on its ready line, and the
 * launcher rejects the run when that is not the temp home.
 *
 * Guard: `real-state-guard.ts` picks `hash` (no concurrent writer of the real
 * database: hash it before and after) or `process-watch` (a desktop Ptah is
 * writing it: watch the host's process tree for handles under the real
 * `~/.ptah` instead) before the spawn, and gives its verdict once the child is
 * gone. The chosen mode is on {@link LaunchedHost.guardMode} and in the stop
 * report. The isolation above applies unchanged in both modes.
 *
 * Exit: every stop is classified ({@link HostExit}, the `run.hostExit` kinds of
 * the scorecard): `clean`, `crash-on-shutdown` (a non-zero code, a Windows
 * fail-fast status or a fatal signal after the graceful stop began), `killed`
 * (the tree kill fired) or `exited-early` (the host ended before the stop, a
 * failed boot or spawn included). A crash on shutdown is reported on the stop
 * report; it never makes `stop()` reject and is never a tool error.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { killProcessTree } from '@ptah-extension/platform-core';

import { isSamePath } from '../bench-data';
import { McpHttpClient, workspaceBaseUrl } from './mcp-client';
import { removeTempDir } from './temp-cleanup';
import {
  armRealStateGuard,
  type GuardMode,
  type GuardReport,
  type RealStateGuardOptions,
} from './real-state-guard';

/** What the host printed on its ready line. */
export interface HostReadyLine {
  readonly port: number;
  readonly workspaceRoot: string;
  readonly homedir: string;
  readonly userDataPath: string;
  readonly dbPath: string;
}

export interface HostLaunchOptions {
  /** Absolute workspace (corpus) root the host serves. */
  readonly workspaceRoot: string;
  /** Built host script. Default: `<repo>/dist/tools/mcp-bench/bench-host.mjs`. */
  readonly hostScript?: string;
  /** Node executable that runs the host script. Default `process.execPath`. */
  readonly nodePath?: string;
  /** Home whose `.ptah` the guard watches. Default `os.homedir()`. */
  readonly realHome?: string;
  /** Guard tuning (CI, pre-sample, sample interval, probe); see `real-state-guard.ts`. */
  readonly guard?: Omit<RealStateGuardOptions, 'realHome'>;
  /** Spawn to ready line and first `tools/list`. Default 180 s. */
  readonly bootTimeoutMs?: number;
  /** Graceful stop before the tree is killed. Default 15 s. */
  readonly stopTimeoutMs?: number;
  /** Client connection reuse (transport scenario 8). Default `true`. */
  readonly keepAlive?: boolean;
  /** Per-call deadline of the client. */
  readonly requestTimeoutMs?: number;
  /**
   * Extra child environment, merged after the isolation. A key that the
   * isolation sets ({@link refusedEnvKeys}) is refused: the launch rejects
   * with {@link HostEnvRefusedError} before anything is spawned or created.
   */
  readonly env?: Readonly<Record<string, string>>;
}

/** How a host process ended; the scorecard's `run.hostExit`. */
export type HostExitKind =
  'clean' | 'crash-on-shutdown' | 'killed' | 'exited-early';

export interface HostExit {
  readonly kind: HostExitKind;
  /** Exit code (win32 statuses unsigned, e.g. 3221226505); `null` for a signal or no process. */
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly detail?: string;
}

/** What the launcher saw of the host's end; the input to {@link classifyHostExit}. */
export interface HostExitObservation {
  readonly exitCode: number | null;
  readonly signal: string | null;
  /** The host was gone before the launcher began to stop it. */
  readonly endedBeforeStop: boolean;
  /** The launcher force-killed the process tree. */
  readonly forceKilled: boolean;
  /** Why the tree was force-killed; default: the graceful window ran out. */
  readonly killReason?: string;
  /** A signal the launcher itself sent as the graceful stop (POSIX Electron: `SIGTERM`). */
  readonly gracefulSignal?: string;
  /** The process could not be started at all. */
  readonly spawnError?: string;
}

/** Windows NTSTATUS exit codes that mean the process died, not that it chose to exit. */
const WIN32_CRASH_STATUSES: ReadonlyMap<number, string> = new Map([
  [0xc0000409, 'fail-fast (STATUS_STACK_BUFFER_OVERRUN / __fastfail)'],
  [0xc0000005, 'access violation (STATUS_ACCESS_VIOLATION)'],
  [0xc0000374, 'heap corruption (STATUS_HEAP_CORRUPTION)'],
  [0xc00000fd, 'stack overflow (STATUS_STACK_OVERFLOW)'],
]);

const FATAL_SIGNALS: ReadonlySet<string> = new Set([
  'SIGSEGV',
  'SIGABRT',
  'SIGBUS',
  'SIGILL',
  'SIGFPE',
]);

function describeExitCode(code: number): string {
  const status = WIN32_CRASH_STATUSES.get(code);
  if (status !== undefined) {
    return `exit code 0x${code.toString(16).toUpperCase()} (${code}): ${status}`;
  }
  return code >= 0xc0000000
    ? `exit code 0x${code.toString(16).toUpperCase()} (${code})`
    : `exit code ${code}`;
}

/**
 * Classify one host end. `exited-early` wins over everything (the host ended
 * before the stop, so nothing the stop did caused it); then `killed`; then a
 * zero exit, or the launcher's own graceful signal, is `clean`; anything else
 * after the graceful stop began is `crash-on-shutdown`.
 */
export function classifyHostExit(observed: HostExitObservation): HostExit {
  const { exitCode, signal } = observed;
  const ended =
    signal !== null
      ? `signal ${signal}`
      : exitCode === null
        ? 'no exit code'
        : describeExitCode(exitCode);
  if (observed.spawnError !== undefined) {
    return {
      kind: 'exited-early',
      exitCode,
      signal,
      detail: `the host could not be spawned: ${observed.spawnError}`,
    };
  }
  if (observed.endedBeforeStop) {
    return {
      kind: 'exited-early',
      exitCode,
      signal,
      detail: `the host ended before stop() (${ended})`,
    };
  }
  if (observed.forceKilled) {
    return {
      kind: 'killed',
      exitCode,
      signal,
      detail:
        observed.killReason ??
        `the graceful stop timed out; the process tree was force-killed (${ended})`,
    };
  }
  if (
    (exitCode === 0 && signal === null) ||
    (signal !== null && signal === observed.gracefulSignal)
  ) {
    return { kind: 'clean', exitCode, signal };
  }
  const fatal =
    signal !== null
      ? FATAL_SIGNALS.has(signal)
        ? `fatal signal ${signal}`
        : `signal ${signal}`
      : exitCode === 2
        ? 'exit code 2: the host forced its exit after its teardown hung'
        : ended;
  return {
    kind: 'crash-on-shutdown',
    exitCode,
    signal,
    detail: `${fatal} after the graceful stop began; a run-level fact, not a tool error`,
  };
}

export interface HostStopReport {
  /** How the host ended; `crash-on-shutdown` is reported here, never thrown. */
  readonly exit: HostExit;
  /** The isolated database file existed when the host stopped. */
  readonly isolatedDbCreated: boolean;
  /** `temp folder left: <path>: <error>` when the temp home could not be removed. */
  readonly tempLeft: string | null;
  readonly guard: GuardReport;
}

/** A launch that failed before the host was ready; the guard passed. */
export class HostLaunchError extends Error {
  constructor(
    message: string,
    /** How the host ended (`exited-early` for a failed boot or spawn). */
    readonly exit: HostExit,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'HostLaunchError';
  }
}

export interface LaunchedHost {
  /** Server URL carrying the `/workspace/{root}` attribution segment. */
  readonly baseUrl: string;
  readonly port: number;
  readonly pid: number;
  readonly ready: HostReadyLine;
  readonly tempHome: string;
  /** Spawn to the first successful `tools/list`. */
  readonly coldStartMs: number;
  readonly client: McpHttpClient;
  /** How the real state is guarded on this run; for the scorecard run metadata. */
  readonly guardMode: GuardMode;
  /** Exit code once the host ended on its own; `undefined` while it runs. */
  readonly exitedEarly: () => number | null | undefined;
  /**
   * Stop the host (stdin EOF, then a tree kill after `stopTimeoutMs`), remove
   * the temp home, and run the guard. Rejects with `RealStateChangedError`
   * (hash) or `BenchHeldRealStateError` (process-watch) only; how the host
   * ended (a crash on shutdown included) is `report.exit`.
   */
  stop(): Promise<HostStopReport>;
}

const DEFAULT_BOOT_TIMEOUT_MS = 180_000;
const DEFAULT_STOP_TIMEOUT_MS = 15_000;
const STDERR_TAIL_CHARS = 4_000;
const KILL_SETTLE_MS = 5_000;

/**
 * `dist/tools/mcp-bench/bench-host.mjs` under the current directory, which is
 * the workspace root when Nx runs a target (`nx run mcp-bench:build-host`).
 */
export function defaultHostScript(): string {
  return resolve('dist', 'tools', 'mcp-bench', 'bench-host.mjs');
}

/** The child environment: the parent's, with every home-like path in `tempHome`. */
export function isolatedEnv(
  tempHome: string,
  parent: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const ptahDir = join(tempHome, '.ptah');
  return {
    ...parent,
    HOME: tempHome,
    USERPROFILE: tempHome,
    APPDATA: join(tempHome, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(tempHome, 'AppData', 'Local'),
    XDG_CONFIG_HOME: join(tempHome, '.config'),
    XDG_DATA_HOME: join(tempHome, '.local', 'share'),
    XDG_STATE_HOME: join(tempHome, '.local', 'state'),
    XDG_CACHE_HOME: join(tempHome, '.cache'),
    PTAH_BENCH_ISOLATED_HOME: tempHome,
    PTAH_CONFIG_PATH: ptahDir,
    PTAH_DB_PATH: join(ptahDir, 'state', 'ptah.sqlite'),
  };
}

/** The keys {@link isolatedEnv} sets, read from its output (an empty parent). */
const ISOLATION_KEYS: readonly string[] = Object.keys(isolatedEnv('', {}));

/**
 * The keys of `env` that would override the isolation, in `env`'s order.
 * Environment names are case-insensitive on win32, so there a case variant
 * (`home`, `Home`) is refused too.
 */
export function refusedEnvKeys(
  env: Readonly<Record<string, string>>,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const fold = (key: string): string =>
    platform === 'win32' ? key.toUpperCase() : key;
  const isolation = new Set(ISOLATION_KEYS.map(fold));
  return Object.keys(env).filter((key) => isolation.has(fold(key)));
}

/** `HostLaunchOptions.env` tried to override the isolation; nothing was started. */
export class HostEnvRefusedError extends Error {
  constructor(readonly refused: readonly string[]) {
    super(
      `launchBenchHost: env may not set isolation keys: ${refused.join(', ')}`,
    );
    this.name = 'HostEnvRefusedError';
  }
}

function parseReadyLine(
  line: string,
): HostReadyLine | { error: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const message = parsed as Record<string, unknown>;
  if (message['benchHost'] === 'fatal') {
    return { error: String(message['error']) };
  }
  if (
    message['benchHost'] !== 'ready' ||
    typeof message['port'] !== 'number' ||
    typeof message['workspaceRoot'] !== 'string' ||
    typeof message['homedir'] !== 'string' ||
    typeof message['userDataPath'] !== 'string' ||
    typeof message['dbPath'] !== 'string'
  ) {
    return null;
  }
  return {
    port: message['port'],
    workspaceRoot: message['workspaceRoot'],
    homedir: message['homedir'],
    userDataPath: message['userDataPath'],
    dbPath: message['dbPath'],
  };
}

/**
 * Spawn, wait for the ready line, prove isolation, probe `tools/list`. A
 * failure before the host is ready (spawn error, early exit, fatal line,
 * isolation, first `tools/list`) rejects with {@link HostLaunchError} carrying
 * the classified exit, once the guard has run; a guard failure outranks it.
 */
export async function launchBenchHost(
  options: HostLaunchOptions,
): Promise<LaunchedHost> {
  const bootTimeoutMs = options.bootTimeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS;
  const stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  // Checked first: a refused env leaves no guard, temp home or process behind.
  const refused = refusedEnvKeys(options.env ?? {});
  if (refused.length > 0) throw new HostEnvRefusedError(refused);

  const guard = await armRealStateGuard({
    ...options.guard,
    realHome: options.realHome,
  });
  const tempHome = await mkdtemp(join(tmpdir(), 'ptah-mcp-bench-home-'));
  await mkdir(join(tempHome, '.ptah', 'state'), { recursive: true });
  const env = { ...isolatedEnv(tempHome), ...options.env };

  const nodePath = options.nodePath ?? process.execPath;
  const hostScript = options.hostScript ?? defaultHostScript();
  const spawnedAt = performance.now();
  const child = spawn(
    nodePath,
    [hostScript, '--workspace', options.workspaceRoot],
    {
      env,
      cwd: tempHome,
      stdio: ['pipe', 'pipe', 'pipe'],
      // POSIX: its own process group, so the tree kill reaches grandchildren.
      detached: process.platform !== 'win32',
      windowsHide: true,
    },
  );

  let stderrTail = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_CHARS);
  });
  // The stdin EOF of the stop can meet a host that is already gone (EPIPE);
  // that end is reported through the exit, so the write error is dropped.
  child.stdin?.on('error', () => undefined);
  let ended: { code: number | null; signal: string | null } | undefined;
  let spawnError: string | undefined;
  const exited = new Promise<number | null>((done) => {
    child.once('exit', (code, signal) => {
      ended ??= { code, signal };
      done(code);
    });
    // A host that cannot be spawned never exits; report it as an end. Kept
    // on for the child's life: a later error (a failed kill) is not a spawn
    // failure, and must not go unhandled either.
    child.on('error', (error) => {
      if (child.pid !== undefined) return;
      spawnError = `${nodePath} ${hostScript}: ${error.message}`;
      ended ??= { code: null, signal: null };
      done(null);
    });
  });
  const exitCode = (): number | null | undefined => ended?.code;

  const teardown = async (): Promise<HostExit> => {
    const endedBeforeStop = ended !== undefined;
    // process-watch takes its last sample while the tree is still alive.
    await guard.sampleBeforeStop();
    const forceKilled = await stopChild(child, exited, exitCode, stopTimeoutMs);
    return classifyHostExit({
      exitCode: ended?.code ?? null,
      signal: ended?.signal ?? null,
      endedBeforeStop,
      forceKilled,
      spawnError,
    });
  };
  if (child.pid !== undefined) guard.watch(child.pid);
  // A failed boot is still a run: the guard runs, and a guard failure
  // outranks the boot error.
  const discard = async (bootError: unknown): Promise<never> => {
    const exit = await teardown();
    const left = await removeTempHome(tempHome);
    if (left !== null)
      process.stderr.write(`[host] ${left}
`);
    await guard.finish();
    throw new HostLaunchError(
      bootError instanceof Error ? bootError.message : String(bootError),
      exit,
      { cause: bootError },
    );
  };

  let ready: HostReadyLine;
  try {
    ready = await waitForReady(
      child,
      exited,
      bootTimeoutMs,
      () => stderrTail,
      () => spawnError,
    );
    if (!isSamePath(ready.homedir, tempHome)) {
      throw new Error(
        `isolation failed: the host sees home ${ready.homedir}, expected ${tempHome}`,
      );
    }
  } catch (error: unknown) {
    return discard(error);
  }

  const baseUrl = workspaceBaseUrl(ready.port, ready.workspaceRoot);
  const client = new McpHttpClient({
    baseUrl,
    keepAlive: options.keepAlive,
    requestTimeoutMs: options.requestTimeoutMs,
  });
  let coldStartMs: number;
  try {
    await client.listTools();
    coldStartMs = performance.now() - spawnedAt;
  } catch (error: unknown) {
    client.close();
    return discard(error);
  }

  let stopped: Promise<HostStopReport> | undefined;
  const stop = (): Promise<HostStopReport> => {
    stopped ??= (async () => {
      client.close();
      const exit = await teardown();
      const isolatedDbCreated = await fileExists(ready.dbPath);
      const tempLeft = await removeTempHome(tempHome);
      const guardReport = await guard.finish();
      return { exit, isolatedDbCreated, tempLeft, guard: guardReport };
    })();
    return stopped;
  };

  return {
    baseUrl,
    port: ready.port,
    pid: child.pid ?? -1,
    ready,
    tempHome,
    coldStartMs,
    client,
    guardMode: guard.mode,
    exitedEarly: exitCode,
    stop,
  };
}

function waitForReady(
  child: ChildProcess,
  exited: Promise<number | null>,
  timeoutMs: number,
  stderrTail: () => string,
  spawnError: () => string | undefined,
): Promise<HostReadyLine> {
  return new Promise((done, reject) => {
    let buffered = '';
    let settled = false;
    /** The host's fatal line, held until its exit (bounded) is observed. */
    let fatal: Error | null = null;
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            `bench host not ready within ${timeoutMs} ms; stderr: ${stderrTail()}`,
          ),
        ),
      timeoutMs,
    );
    const onData = (chunk: string): void => {
      buffered += chunk;
      let newline = buffered.indexOf('\n');
      while (newline >= 0) {
        const parsed = parseReadyLine(buffered.slice(0, newline).trim());
        buffered = buffered.slice(newline + 1);
        if (parsed !== null && 'error' in parsed) {
          // The host exits right after its fatal line. Wait (bounded) for
          // that exit, so the failure is classified as the host's own end.
          child.stdout?.off('data', onData);
          const failure = new Error(`bench host fatal: ${parsed.error}`);
          fatal = failure;
          setTimeout(() => finish(failure), KILL_SETTLE_MS).unref();
          return;
        }
        if (parsed !== null) {
          finish(parsed);
          return;
        }
        newline = buffered.indexOf('\n');
      }
    };
    const finish = (result: HostReadyLine | Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      if (result instanceof Error) reject(result);
      else done(result);
    };
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', onData);
    void exited.then((code) => {
      const failed = spawnError();
      finish(
        fatal ??
          new Error(
            failed !== undefined
              ? `could not spawn the bench host (${failed})`
              : `bench host exited (code ${code}) before ready; stderr: ${stderrTail()}`,
          ),
      );
    });
  });
}

/** stdin EOF first (the host's graceful path on every platform), then the tree. */
async function stopChild(
  child: ChildProcess,
  exited: Promise<number | null>,
  exitCode: () => number | null | undefined,
  timeoutMs: number,
): Promise<boolean> {
  if (exitCode() !== undefined) return false;
  child.stdin?.end();
  let timer: NodeJS.Timeout | undefined;
  const timedOut = await Promise.race([
    exited.then(() => false),
    new Promise<boolean>((done) => {
      timer = setTimeout(() => done(true), timeoutMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
  if (!timedOut || child.pid === undefined) return false;
  await killProcessTree(child.pid, 'SIGKILL');
  // Bounded: a kill that failed (reported by nothing) must not hang the run.
  await Promise.race([
    exited,
    new Promise<void>((done) => setTimeout(done, KILL_SETTLE_MS).unref()),
  ]);
  return true;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Removes the temp home with retries; the reason it was left, or `null`. Never throws. */
function removeTempHome(tempHome: string): Promise<string | null> {
  return removeTempDir(tempHome);
}
