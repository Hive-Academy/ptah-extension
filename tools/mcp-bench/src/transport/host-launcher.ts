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
 * Guard: before the spawn and after the child is gone, the real
 * `<os.homedir()>/.ptah/state/ptah.sqlite` and its `-wal` are stat-ed and
 * SHA-256 hashed (opened read-only). Any change fails the run. The guard
 * cannot tell writers apart: a desktop Ptah running at the same time also
 * changes these files, and the run then fails closed rather than certify an
 * isolation it cannot prove.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { killProcessTree } from '@ptah-extension/platform-core';

import { McpHttpClient, workspaceBaseUrl } from './mcp-client';

/** One guarded file, as seen at one moment. */
export interface GuardedFileState {
  readonly path: string;
  readonly exists: boolean;
  readonly size: number | null;
  readonly mtimeMs: number | null;
  readonly sha256: string | null;
}

export interface RealStateSnapshot {
  readonly takenAt: string;
  readonly files: readonly GuardedFileState[];
}

/** Thrown when the user's real database changed across a bench run. */
export class RealStateChangedError extends Error {
  constructor(
    readonly before: RealStateSnapshot,
    readonly after: RealStateSnapshot,
    readonly changed: readonly string[],
  ) {
    super(
      `The real Ptah database changed during the bench run (${changed.join(', ')}). ` +
        'Isolation is not proven: if a desktop Ptah or VS Code host was running, close it and re-run.',
    );
    this.name = 'RealStateChangedError';
  }
}

/** The files the guard watches under a home directory. */
export function guardedStatePaths(home: string): string[] {
  const db = join(home, '.ptah', 'state', 'ptah.sqlite');
  return [db, `${db}-wal`];
}

/** Stat and hash each guarded file. Read-only; a missing file is a state too. */
export async function snapshotRealState(
  home: string = homedir(),
): Promise<RealStateSnapshot> {
  const files = await Promise.all(
    guardedStatePaths(home).map(async (path): Promise<GuardedFileState> => {
      try {
        const info = await stat(path);
        return {
          path,
          exists: true,
          size: info.size,
          mtimeMs: info.mtimeMs,
          sha256: await hashFile(path),
        };
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return { path, exists: false, size: null, mtimeMs: null, sha256: null };
      }
    }),
  );
  return { takenAt: new Date().toISOString(), files };
}

/** Throws {@link RealStateChangedError} when any guarded file differs. */
export function assertRealStateUnchanged(
  before: RealStateSnapshot,
  after: RealStateSnapshot,
): void {
  const changed = before.files.flatMap((was, index) => {
    const now = after.files[index];
    return now === undefined ||
      now.path !== was.path ||
      now.exists !== was.exists ||
      now.size !== was.size ||
      now.mtimeMs !== was.mtimeMs ||
      now.sha256 !== was.sha256
      ? [was.path]
      : [];
  });
  if (changed.length > 0)
    throw new RealStateChangedError(before, after, changed);
}

function hashFile(path: string): Promise<string> {
  return new Promise((done, reject) => {
    const hash = createHash('sha256');
    createReadStream(path, { flags: 'r' })
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => done(hash.digest('hex')));
  });
}

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
  /** Home whose `.ptah/state` the guard watches. Default `os.homedir()`. */
  readonly realHome?: string;
  /** Spawn to ready line and first `tools/list`. Default 180 s. */
  readonly bootTimeoutMs?: number;
  /** Graceful stop before the tree is killed. Default 15 s. */
  readonly stopTimeoutMs?: number;
  /** Client connection reuse (transport scenario 8). Default `true`. */
  readonly keepAlive?: boolean;
  /** Per-call deadline of the client. */
  readonly requestTimeoutMs?: number;
}

export interface HostStopReport {
  readonly exitCode: number | null;
  /** The process tree was force-killed after the graceful window. */
  readonly killed: boolean;
  /** The isolated database file existed when the host stopped. */
  readonly isolatedDbCreated: boolean;
  readonly guardBefore: RealStateSnapshot;
  readonly guardAfter: RealStateSnapshot;
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
  /** Exit code once the host ended on its own; `undefined` while it runs. */
  readonly exitedEarly: () => number | null | undefined;
  /**
   * Stop the host (stdin EOF, then a tree kill after `stopTimeoutMs`), remove
   * the temp home, and run the guard. Rejects with
   * {@link RealStateChangedError} when the real database changed.
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

function samePath(left: string, right: string): boolean {
  const fold = (value: string): string =>
    process.platform === 'win32'
      ? resolve(value).toLowerCase()
      : resolve(value);
  return fold(left) === fold(right);
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

/** Spawn, wait for the ready line, prove isolation, probe `tools/list`. */
export async function launchBenchHost(
  options: HostLaunchOptions,
): Promise<LaunchedHost> {
  const realHome = options.realHome ?? homedir();
  const bootTimeoutMs = options.bootTimeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS;
  const stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;

  const guardBefore = await snapshotRealState(realHome);
  const tempHome = await mkdtemp(join(tmpdir(), 'ptah-mcp-bench-home-'));
  await mkdir(join(tempHome, '.ptah', 'state'), { recursive: true });
  const env = isolatedEnv(tempHome);

  const spawnedAt = performance.now();
  const child = spawn(
    process.execPath,
    [
      options.hostScript ?? defaultHostScript(),
      '--workspace',
      options.workspaceRoot,
    ],
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
  let exitCode: number | null | undefined;
  const exited = new Promise<number | null>((done) => {
    child.once('exit', (code) => {
      exitCode = code;
      done(code);
    });
  });

  const teardown = async (): Promise<{ killed: boolean }> => {
    const killed = await stopChild(
      child,
      exited,
      () => exitCode,
      stopTimeoutMs,
    );
    return { killed };
  };
  // A failed boot is still a run: the guard runs, and a changed real
  // database outranks the boot error.
  const discard = async (bootError: unknown): Promise<never> => {
    await teardown();
    await removeTempHome(tempHome);
    assertRealStateUnchanged(guardBefore, await snapshotRealState(realHome));
    throw bootError;
  };

  let ready: HostReadyLine;
  try {
    ready = await waitForReady(child, exited, bootTimeoutMs, () => stderrTail);
    if (!samePath(ready.homedir, tempHome)) {
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
      const { killed } = await teardown();
      const isolatedDbCreated = await fileExists(ready.dbPath);
      await removeTempHome(tempHome);
      const guardAfter = await snapshotRealState(realHome);
      assertRealStateUnchanged(guardBefore, guardAfter);
      return {
        exitCode: exitCode ?? null,
        killed,
        isolatedDbCreated,
        guardBefore,
        guardAfter,
      };
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
    exitedEarly: () => exitCode,
    stop,
  };
}

function waitForReady(
  child: ChildProcess,
  exited: Promise<number | null>,
  timeoutMs: number,
  stderrTail: () => string,
): Promise<HostReadyLine> {
  return new Promise((done, reject) => {
    let buffered = '';
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
        if (parsed !== null) {
          finish(
            'error' in parsed
              ? new Error(`bench host fatal: ${parsed.error}`)
              : parsed,
          );
          return;
        }
        newline = buffered.indexOf('\n');
      }
    };
    const finish = (result: HostReadyLine | Error): void => {
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      if (result instanceof Error) reject(result);
      else done(result);
    };
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', onData);
    void exited.then((code) =>
      finish(
        new Error(
          `bench host exited (code ${code}) before ready; stderr: ${stderrTail()}`,
        ),
      ),
    );
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

async function removeTempHome(tempHome: string): Promise<void> {
  // Windows releases a dead process's file handles a moment after its exit.
  await rm(tempHome, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
