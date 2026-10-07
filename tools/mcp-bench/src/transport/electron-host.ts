/**
 * The `electron` bench host: the built Ptah desktop app, measured over its own
 * code-execution HTTP MCP.
 *
 * Launch mode starts the built app (`dist/apps/ptah-electron/main.mjs`) under
 * the Electron binary with everything it could share with the user's own
 * desktop Ptah moved aside:
 *
 * - `--user-data-dir` points at a fresh temp dir. Electron keys its
 *   single-instance lock (`app.requestSingleInstanceLock()`, `main.ts`) on the
 *   user-data dir, so the bench app never contends with the user's running
 *   app for it. If the app still quits before its MCP comes up, the run is
 *   refused with that diagnosis.
 * - HOME/USERPROFILE/APPDATA/LOCALAPPDATA/XDG and `PTAH_DB_PATH` point into the
 *   same temp home (`isolatedEnv`), so `~/.ptah` and the database resolve
 *   there.
 * - `<userData>/config.json` carries `ptah.mcpPort = 0` (read by
 *   `ElectronWorkspaceProvider`, honoured by `getConfiguredPort`), so the
 *   server takes an OS-assigned port, never the desktop app's 51820 or its two
 *   fallbacks. A launch that lands on one of those anyway is refused: it means
 *   the isolated config was not read.
 * - `NODE_ENV=production`, because `main.ts` re-points userData at
 *   `<appData>/Ptah Dev` in development, overriding `--user-data-dir`.
 *
 * The port is discovered from outside the process by the line the server logs
 * once it listens (`CodeExecutionMCP server started on http://localhost:N`,
 * `http-server.handler.ts`). The production logger does not echo to the
 * console, so the launcher reads the app's log files (`ElectronOutputChannel`
 * writes them under `app.getPath('logs')`, which lies inside the temp home)
 * and the child's stdout/stderr, whichever shows it first.
 *
 * The real-state guard runs as for `cli-headless` (`real-state-guard.ts`):
 * `hash`, or `process-watch` over the Electron process tree when a desktop
 * Ptah is writing the real database.
 *
 * Attach mode targets an app the user already runs (`PTAH_BENCH_ELECTRON_URL`,
 * loopback only). That app writes the user's real database by definition, so
 * no guard is applied, and every suite that writes state (memory seeding,
 * lifecycle) is refused as `na` instead: {@link suiteNaReason}.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { killProcessTree } from '@ptah-extension/platform-core';

import { removeTempDir } from './temp-cleanup';
import { classifyHostExit, isolatedEnv, type HostExit } from './host-launcher';
import { McpHttpClient, workspaceBaseUrl } from './mcp-client';
import {
  armRealStateGuard,
  type GuardMode,
  type GuardReport,
  type RealStateGuardOptions,
} from './real-state-guard';

export const ELECTRON_URL_ENV = 'PTAH_BENCH_ELECTRON_URL';
export const ATTACH_MODE_NA_REASON = 'attach mode never writes to a user DB';

/** The desktop app's default MCP port and its two fallbacks (`getMcpPortCandidates`). */
export const DESKTOP_MCP_PORTS: readonly number[] = [51820, 51821, 51822];

export type ElectronHostMode = 'launch' | 'attach';

export type PortSource = 'log-file' | 'output' | 'attach-url';

/** Suites by what they do to state; memory seeds a DB, lifecycle edits and reindexes. */
export type BenchSuiteKind = 'retrieval' | 'memory' | 'lifecycle';

const STATE_WRITING_SUITES: ReadonlySet<BenchSuiteKind> = new Set([
  'memory',
  'lifecycle',
]);

/** Why a suite must be scored `na` on this host mode, or `null` when it may run. */
export function suiteNaReason(
  mode: ElectronHostMode,
  suite: BenchSuiteKind,
): string | null {
  return mode === 'attach' && STATE_WRITING_SUITES.has(suite)
    ? ATTACH_MODE_NA_REASON
    : null;
}

export interface ElectronLaunchOptions {
  /** Absolute workspace (corpus) root the app opens and the MCP serves. */
  readonly workspaceRoot: string;
  /** Built main entry. Default `<cwd>/dist/apps/ptah-electron/main.mjs`. */
  readonly appEntry?: string;
  /** Electron binary. Default: what the `electron` package resolves to. */
  readonly electronBinary?: string;
  /** Home whose `.ptah` the guard watches. Default `os.homedir()`. */
  readonly realHome?: string;
  readonly guard?: Omit<RealStateGuardOptions, 'realHome'>;
  /** Spawn to the MCP log line and first `tools/list`. Default 180 s. */
  readonly bootTimeoutMs?: number;
  /** Graceful quit before the tree is force-killed. Default 15 s. */
  readonly stopTimeoutMs?: number;
  readonly keepAlive?: boolean;
  readonly requestTimeoutMs?: number;
}

export interface ElectronAttachOptions {
  /** Workspace root the attached app has open (the `/workspace/{root}` segment). */
  readonly workspaceRoot: string;
  /** Server URL. Default `process.env.PTAH_BENCH_ELECTRON_URL`. */
  readonly url?: string;
  readonly keepAlive?: boolean;
  readonly requestTimeoutMs?: number;
}

export type ElectronStopReport =
  | { readonly mode: 'attach' }
  | {
      readonly mode: 'launch';
      /**
       * How the app ended. On win32 it is always `killed`: there is no
       * graceful quit signal, the tree is ended with `taskkill /T /F`, and
       * `detail` says so; that is not a crash.
       */
      readonly exit: HostExit;
      readonly isolatedDbCreated: boolean;
      /** `temp folder left: <path>: <error>` when the temp home could not be removed. */
      readonly tempLeft: string | null;
      readonly guard: GuardReport;
    };

export interface ElectronHost {
  readonly host: 'electron';
  readonly mode: ElectronHostMode;
  /** Server URL carrying the `/workspace/{root}` attribution segment. */
  readonly baseUrl: string;
  readonly port: number;
  /** Where the port came from: the app's log file, its stdout/stderr, or the attach URL. */
  readonly portSource: PortSource;
  /** The launched app's main process; `null` when attached. */
  readonly pid: number | null;
  /** Spawn to the first successful `tools/list`; `null` when attached (already warm). */
  readonly coldStartMs: number | null;
  /**
   * The launched app's isolated SQLite file (`PTAH_DB_PATH` inside the temp
   * home), which the lifecycle scenario 6 backdates. `null` when attached: the
   * bench never touches a user's database.
   */
  readonly dbPath: string | null;
  readonly client: McpHttpClient;
  /** `not-applied` in attach mode, which refuses state-writing suites instead. */
  readonly guardMode: GuardMode | 'not-applied';
  suiteNaReason(suite: BenchSuiteKind): string | null;
  /** Launch: quit the app, remove its temp home, run the guard. Attach: close the client only. */
  stop(): Promise<ElectronStopReport>;
}

const DEFAULT_BOOT_TIMEOUT_MS = 180_000;
const DEFAULT_STOP_TIMEOUT_MS = 15_000;
const KILL_SETTLE_MS = 5_000;
const LOG_POLL_MS = 250;
const OUTPUT_TAIL_CHARS = 4_000;
const MCP_STARTED_LINE =
  /CodeExecutionMCP server started on http:\/\/localhost:(\d+)/;

/** `dist/apps/ptah-electron/main.mjs` under the current (workspace-root) directory. */
export function defaultElectronEntry(): string {
  return resolve('dist', 'apps', 'ptah-electron', 'main.mjs');
}

/** The binary the `electron` package points at, resolved from the current directory. */
export function resolveElectronBinary(): string {
  const resolved: unknown = createRequire(resolve('package.json'))('electron');
  if (typeof resolved !== 'string') {
    throw new Error(
      'the electron package did not resolve to a binary path; pass electronBinary',
    );
  }
  return resolved;
}

/** `PTAH_BENCH_ELECTRON_URL` → port. Loopback http only: the bench never calls out. */
export function parseAttachUrl(raw: string): number {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${ELECTRON_URL_ENV} is not a URL: ${raw}`);
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'];
  if (url.protocol !== 'http:' || !loopback.includes(url.hostname)) {
    throw new Error(
      `${ELECTRON_URL_ENV} must be a loopback http URL (http://localhost:<port>), got ${raw}`,
    );
  }
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${ELECTRON_URL_ENV} carries no port: ${raw}`);
  }
  return port;
}

/** Attach to a running desktop app. Writes nothing and stops nothing. */
export async function attachElectronHost(
  options: ElectronAttachOptions,
): Promise<ElectronHost> {
  const raw = options.url ?? process.env[ELECTRON_URL_ENV];
  if (raw === undefined || raw === '') {
    throw new Error(
      `attach mode needs ${ELECTRON_URL_ENV} (e.g. http://localhost:51820)`,
    );
  }
  const port = parseAttachUrl(raw);
  const baseUrl = workspaceBaseUrl(port, options.workspaceRoot);
  const client = new McpHttpClient({
    baseUrl,
    keepAlive: options.keepAlive,
    requestTimeoutMs: options.requestTimeoutMs,
  });
  try {
    await client.listTools();
  } catch (error: unknown) {
    client.close();
    throw new Error(
      `no Ptah MCP answers at ${raw}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return {
    host: 'electron',
    mode: 'attach',
    baseUrl,
    port,
    portSource: 'attach-url',
    pid: null,
    coldStartMs: null,
    dbPath: null,
    client,
    guardMode: 'not-applied',
    suiteNaReason: (suite) => suiteNaReason('attach', suite),
    stop: async () => {
      client.close();
      return { mode: 'attach' };
    },
  };
}

/** Launch the built app isolated, discover its MCP port, probe `tools/list`. */
export async function launchElectronHost(
  options: ElectronLaunchOptions,
): Promise<ElectronHost> {
  const appEntry = options.appEntry ?? defaultElectronEntry();
  if (!existsSync(appEntry)) {
    throw new Error(
      `Electron entry not found at ${appEntry}; run \`npx nx build-dev ptah-electron\` first`,
    );
  }
  const electronBinary = options.electronBinary ?? resolveElectronBinary();
  const bootTimeoutMs = options.bootTimeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS;
  const stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;

  const guard = await armRealStateGuard({
    ...options.guard,
    realHome: options.realHome,
  });
  const tempHome = await mkdtemp(join(tmpdir(), 'ptah-mcp-bench-electron-'));
  const userDataDir = join(tempHome, 'electron-user-data');
  await mkdir(join(tempHome, '.ptah', 'state'), { recursive: true });
  await mkdir(userDataDir, { recursive: true });
  await writeFile(
    join(userDataDir, 'config.json'),
    JSON.stringify({ ptah: { mcpPort: 0 } }),
  );
  const env: NodeJS.ProcessEnv = {
    ...isolatedEnv(tempHome),
    NODE_ENV: 'production',
  };
  delete env['ELECTRON_RUN_AS_NODE'];
  const isolatedDb = env['PTAH_DB_PATH'] ?? '';

  const spawnedAt = performance.now();
  const child = spawn(
    electronBinary,
    [appEntry, `--user-data-dir=${userDataDir}`, options.workspaceRoot],
    {
      env,
      cwd: tempHome,
      stdio: ['ignore', 'pipe', 'pipe'],
      // POSIX: its own process group, so the tree kill reaches the helpers.
      detached: process.platform !== 'win32',
    },
  );
  let outputTail = '';
  let portFromOutput: number | null = null;
  const onOutput = (chunk: string): void => {
    outputTail = (outputTail + chunk).slice(-OUTPUT_TAIL_CHARS);
    const match = MCP_STARTED_LINE.exec(outputTail);
    if (match && portFromOutput === null) portFromOutput = Number(match[1]);
  };
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', onOutput);
  child.stderr?.on('data', onOutput);
  let ended: { code: number | null; signal: string | null } | undefined;
  let spawnError: string | undefined;
  const exited = new Promise<number | null>((done) => {
    child.once('exit', (code, signal) => {
      ended ??= { code, signal };
      done(code);
    });
    // A binary that cannot be spawned never exits; report it as an exit.
    // Kept on: a later error (a failed kill) must not go unhandled either.
    child.on('error', (error) => {
      outputTail += `\nchild error: ${error.message}`;
      if (child.pid !== undefined) return;
      spawnError ??= `${electronBinary}: ${error.message}`;
      ended ??= { code: null, signal: null };
      done(null);
    });
  });
  const exitCode = (): number | null | undefined => ended?.code;
  if (child.pid !== undefined) guard.watch(child.pid);

  const teardown = async (): Promise<HostExit> => {
    const endedBeforeStop = ended !== undefined;
    await guard.sampleBeforeStop();
    const quit = await quitApp(child.pid, exited, exitCode, stopTimeoutMs);
    return classifyHostExit({
      exitCode: ended?.code ?? null,
      signal: ended?.signal ?? null,
      endedBeforeStop,
      forceKilled: quit === 'forced' || quit === 'taskkill',
      killReason: quit === 'taskkill' ? WIN32_TASKKILL_REASON : undefined,
      gracefulSignal: 'SIGTERM',
      spawnError,
    });
  };
  const discard = async (bootError: unknown): Promise<never> => {
    await teardown();
    const left = await removeDir(tempHome);
    if (left !== null)
      process.stderr.write(`[host] ${left}
`);
    await guard.finish();
    throw bootError;
  };

  let port: number;
  let portSource: PortSource;
  try {
    ({ port, source: portSource } = await discoverPort({
      tempHome,
      timeoutMs: bootTimeoutMs,
      fromOutput: () => portFromOutput,
      exitCode,
      outputTail: () => outputTail,
    }));
    if (DESKTOP_MCP_PORTS.includes(port)) {
      throw new Error(
        `refusing the run: the launched app bound the desktop MCP port ${port}, ` +
          'so its isolated config (ptah.mcpPort = 0) was not read',
      );
    }
  } catch (error: unknown) {
    return discard(error);
  }

  const baseUrl = workspaceBaseUrl(port, options.workspaceRoot);
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

  let stopped: Promise<ElectronStopReport> | undefined;
  return {
    host: 'electron',
    mode: 'launch',
    baseUrl,
    port,
    portSource,
    pid: child.pid ?? null,
    coldStartMs,
    dbPath: isolatedDb === '' ? null : isolatedDb,
    client,
    guardMode: guard.mode,
    suiteNaReason: (suite) => suiteNaReason('launch', suite),
    stop: () => {
      stopped ??= (async (): Promise<ElectronStopReport> => {
        client.close();
        const exit = await teardown();
        const isolatedDbCreated = await fileExists(isolatedDb);
        const tempLeft = await removeDir(tempHome);
        return {
          mode: 'launch',
          exit,
          isolatedDbCreated,
          tempLeft,
          guard: await guard.finish(),
        };
      })();
      return stopped;
    },
  };
}

interface PortDiscovery {
  readonly tempHome: string;
  readonly timeoutMs: number;
  readonly fromOutput: () => number | null;
  readonly exitCode: () => number | null | undefined;
  readonly outputTail: () => string;
}

/** Poll the app's output and log files for the MCP start line. */
async function discoverPort(
  discovery: PortDiscovery,
): Promise<{ port: number; source: PortSource }> {
  const deadline = performance.now() + discovery.timeoutMs;
  for (;;) {
    const fromOutput = discovery.fromOutput();
    if (fromOutput !== null) return { port: fromOutput, source: 'output' };
    const fromLogs = await portFromLogs(discovery.tempHome);
    if (fromLogs !== null) return { port: fromLogs, source: 'log-file' };
    const code = discovery.exitCode();
    if (code !== undefined) {
      throw new Error(
        `the Electron app exited (code ${code}) before its MCP came up. ` +
          'An exit 0 this early is what its single-instance lock does when another ' +
          'instance owns the same user-data dir; launch mode refuses to share one. ' +
          `Output: ${discovery.outputTail()}`,
      );
    }
    if (performance.now() > deadline) {
      throw new Error(
        `the Electron app logged no MCP start within ${discovery.timeoutMs} ms; ` +
          `output: ${discovery.outputTail()}`,
      );
    }
    await new Promise((done) => setTimeout(done, LOG_POLL_MS));
  }
}

/** The MCP port from any `*.log` under the temp home, or `null`. */
async function portFromLogs(root: string): Promise<number | null> {
  for (const file of await logFiles(root, 6)) {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      continue; // rolled over or still being created
    }
    const match = MCP_STARTED_LINE.exec(text);
    if (match) return Number(match[1]);
  }
  return null;
}

async function logFiles(dir: string, depth: number): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.log')) found.push(path);
    else if (entry.isDirectory() && depth > 0) {
      found.push(...(await logFiles(path, depth - 1)));
    }
  }
  return found;
}

const WIN32_TASKKILL_REASON =
  "win32 has no graceful quit signal for Electron: the launcher always ends the app tree with taskkill /T /F, so the exit code is not the app's own; this is the normal stop on win32, not a crash";

/**
 * How {@link quitApp} ended the app: `none` (it was already gone), `graceful`
 * (POSIX: it quit on SIGTERM), `taskkill` (win32's only stop), `forced`
 * (SIGKILL after the graceful window).
 */
type QuitOutcome = 'none' | 'graceful' | 'taskkill' | 'forced';

/**
 * SIGTERM to the tree (POSIX: Electron quits on it; win32: `taskkill /T /F`,
 * there is no graceful signal), then SIGKILL after `timeoutMs`.
 */
async function quitApp(
  pid: number | undefined,
  exited: Promise<number | null>,
  exitCode: () => number | null | undefined,
  timeoutMs: number,
): Promise<QuitOutcome> {
  if (pid === undefined || exitCode() !== undefined) return 'none';
  await killProcessTree(pid, 'SIGTERM');
  let timer: NodeJS.Timeout | undefined;
  const timedOut = await Promise.race([
    exited.then(() => false),
    new Promise<boolean>((done) => {
      timer = setTimeout(() => done(true), timeoutMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
  if (timedOut) {
    await killProcessTree(pid, 'SIGKILL');
    await Promise.race([
      exited,
      new Promise<void>((done) => setTimeout(done, KILL_SETTLE_MS).unref()),
    ]);
    return 'forced';
  }
  return process.platform === 'win32' ? 'taskkill' : 'graceful';
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
function removeDir(dir: string): Promise<string | null> {
  return removeTempDir(dir);
}
