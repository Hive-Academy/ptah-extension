/**
 * CliRunner — spawns the BUILT dist binary `dist/apps/ptah-cli/main.mjs`
 * via `process.execPath` (current node) and exposes a typed JSON-RPC 2.0
 * NDJSON stdio interface for tests.
 *
 * Two surface modes:
 *
 *   - Persistent `interact` session via {@link CliRunner.spawn} — yields
 *     `{ child, rpc, ... }` and waits for `session.ready` before resolving.
 *     Used by spec files that need the bidirectional JSON-RPC channel.
 *
 *   - One-shot subcommand via {@link CliRunner.spawnOneshot} — for
 *     command-mode commands (e.g. `ptah session start --once`,
 *     `ptah license set --key`, `ptah config autopilot set true`).
 *     Captures stdout NDJSON lines + stderr buffer + exit code.
 *
 * Spawn details (verified against `apps/ptah-cli/src/cli/commands/interact.ts`
 * and `apps/ptah-cli/src/cli/io/{stdin-reader,stdout-writer}.ts`):
 *
 *   - We invoke `process.execPath <absolute-main.mjs> <args>` directly. No
 *     shell, no `.cmd` resolution, no PATH lookup — `needsShellExecution`
 *     does NOT apply here (only relevant when spawning npm-installed
 *     `.cmd` shims).
 *   - `stdio: ['pipe', 'pipe', 'pipe']`, `windowsHide: true`,
 *     `cwd: tmpHome.path` so the CLI's `process.cwd()` inherits a clean
 *     workspace rooted under the tmp home.
 *   - Streams set to UTF-8 explicitly (matches the production CLI memory note
 *     about Windows pipe encoding).
 *   - JSON-RPC framing is newline-delimited NDJSON — no Content-Length
 *     headers (verified `stdin-reader.ts` uses `readline` with
 *     `crlfDelay: Infinity`; `stdout-writer.ts` writes `JSON.stringify(...) + '\n'`).
 *
 * Env handling:
 *
 *   - Strip `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `COPILOT_TOKEN` so e2e
 *     never accidentally calls upstream.
 *   - Set `HOME` AND `USERPROFILE` (Windows reads USERPROFILE; POSIX reads
 *     HOME) — set both unconditionally regardless of platform.
 *   - Force `FORCE_COLOR=0`, `NO_COLOR=1`, `PTAH_NO_TTY=1`, `NX_TUI=false`.
 *   - The caller may inject additional env (e.g. fake `ANTHROPIC_API_KEY`
 *     for SDK init or `PTAH_AUTO_APPROVE=1` for permission-gate tests) via
 *     `opts.env` — applied AFTER stripping, so a caller-supplied key wins.
 *
 * Shutdown:
 *
 *   - `shutdown()` sends `session.shutdown` and races the child's `exit`
 *     event against a 6s deadline. On timeout, escalates to `kill()`.
 *   - `kill()` uses the `tree-kill` package (already in workspace
 *     `package-lock.json`) so child + descendants are reaped on POSIX
 *     and Windows alike.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';

import { withTimeout } from './wait-for.js';
import type { TmpHome } from './tmp-home.js';

// `tree-kill` ships only a CommonJS export. Import via require so the spec
// works under ts-jest without an `esModuleInterop` flag drift.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const treeKill: (
  pid: number,
  signal: string,
  cb: (err?: Error) => void,
) => void = require('tree-kill');

export interface CliRunnerOptions {
  /** Tmp home (provides HOME / USERPROFILE / .ptah). REQUIRED. */
  home: TmpHome;
  /** Args after `interact` (e.g. ['--auto-approve']). Default: []. */
  args?: string[];
  /** Env additions merged on top of cleaned process.env. */
  env?: NodeJS.ProcessEnv;
  /** Default 30_000ms (cold DI bootstrap headroom). */
  spawnReadyTimeoutMs?: number;
  /**
   * When true, do NOT wait for `session.ready`. Used by tests that drive
   * non-interact commands or that intentionally observe init failure.
   * Default: false (wait for session.ready before resolving).
   */
  skipReady?: boolean;
}

export interface OneshotOptions {
  home: TmpHome;
  /** Full argv for the CLI (e.g. ['license','set','--key','abc','--json']). */
  args: string[];
  env?: NodeJS.ProcessEnv;
  /** Wall-clock deadline for the whole process. Default 30_000ms. */
  timeoutMs?: number;
  /** Optional NDJSON written to stdin then closed. */
  stdin?: string;
}

export interface OneshotResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  /** Decoded JSON-RPC notifications/responses observed on stdout. */
  stdoutLines: unknown[];
  /** Raw stdout text (for assertions on non-NDJSON output, e.g. --version). */
  stdoutRaw: string;
  /** Captured stderr buffer (capped at 1 MB). */
  stderr: string;
  /** True if any stdout line failed to parse as JSON. */
  hasMalformedStdout: boolean;
}

export interface SessionReady {
  session_id: string;
  version: string;
  capabilities: string[];
  protocol_version: string;
}

export interface JsonRpcResponseLike {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotificationLike {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface RunnerHandle {
  child: ChildProcessWithoutNullStreams;
  /** Resolves to the `session.ready` payload or rejects on init failure. */
  ready: SessionReady;
  /**
   * Send an inbound JSON-RPC request. Resolves with `result` or rejects with
   * the JSON-RPC error.
   */
  request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs?: number,
  ): Promise<T>;
  /** Fire-and-forget JSON-RPC notification (e.g. `permission.response`). */
  notify(method: string, params?: unknown): Promise<void>;
  /** Wait for the next notification with the given method. */
  awaitNotification<T = unknown>(
    method: string,
    timeoutMs?: number,
  ): Promise<T>;
  /** Filter-aware notification wait. */
  awaitNotificationWhere<T = unknown>(
    method: string,
    pred: (params: T) => boolean,
    timeoutMs?: number,
  ): Promise<T>;
  /** Read-only view of every notification observed so far (for diagnostics). */
  observed(): Array<{ method: string; params: unknown }>;
  /** Accumulated stderr (capped). */
  stderr(): string;
  /** Most recent exit code, or null if still running. */
  exitCode(): number | null;
  /** Graceful: send session.shutdown, await drain, resolve to exit code. */
  shutdown(): Promise<number | null>;
  /** Hard kill via `tree-kill` (POSIX SIGKILL / Windows taskkill). */
  kill(): Promise<void>;
}

const STDERR_CAP_BYTES = 1_048_576; // 1 MB

interface PendingRequest {
  resolve(value: unknown): void;
  reject(err: Error): void;
  timer: ReturnType<typeof setTimeout> | null;
}

interface NotificationWaiter {
  method: string;
  pred?: (params: unknown) => boolean;
  resolve(value: unknown): void;
  reject(err: Error): void;
  timer: ReturnType<typeof setTimeout> | null;
}

export class CliRunner {
  /**
   * Absolute path to the dist binary. Resolved by walking up from this file
   * until we find a directory containing `dist/apps/ptah-cli/main.mjs`.
   */
  static readonly DIST_BIN = resolveDistBin();

  /**
   * Spawn `interact` and (unless `skipReady`) await `session.ready`.
   */
  static async spawn(opts: CliRunnerOptions): Promise<RunnerHandle> {
    if (!fs.existsSync(CliRunner.DIST_BIN)) {
      throw new Error(
        `CliRunner: dist binary not found at ${CliRunner.DIST_BIN}. ` +
          `Run \`nx build ptah-cli\` before running e2e specs.`,
      );
    }

    const args = ['interact', ...(opts.args ?? [])];
    const env = buildEnv(opts.home.path, opts.env);

    const child = spawn(process.execPath, [CliRunner.DIST_BIN, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: opts.home.path,
      env,
      windowsHide: true,
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    return wireHandle(child, opts);
  }

  /**
   * Run a non-interact subcommand to completion. Captures stdout (decoded as
   * NDJSON when possible), stderr, and exit code.
   */
  static async spawnOneshot(opts: OneshotOptions): Promise<OneshotResult> {
    if (!fs.existsSync(CliRunner.DIST_BIN)) {
      throw new Error(
        `CliRunner.spawnOneshot: dist binary not found at ${CliRunner.DIST_BIN}. ` +
          `Run \`nx build ptah-cli\` before running e2e specs.`,
      );
    }

    const env = buildEnv(opts.home.path, opts.env);
    const child = spawn(process.execPath, [CliRunner.DIST_BIN, ...opts.args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: opts.home.path,
      env,
      windowsHide: true,
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    let stdoutRaw = '';
    let stderrBuf = '';
    let hasMalformedStdout = false;
    const stdoutLines: unknown[] = [];

    const rl = readline.createInterface({
      input: child.stdout,
      terminal: false,
    });
    rl.on('line', (line) => {
      stdoutRaw += line + '\n';
      const trimmed = line.trim();
      if (trimmed.length === 0) return;
      try {
        stdoutLines.push(JSON.parse(trimmed));
      } catch {
        // Non-JSON lines are tolerated (e.g. `--version` prints a bare semver).
        hasMalformedStdout = true;
      }
    });

    child.stderr.on('data', (chunk: string) => {
      if (stderrBuf.length < STDERR_CAP_BYTES) {
        stderrBuf += chunk;
        if (stderrBuf.length > STDERR_CAP_BYTES) {
          stderrBuf = stderrBuf.slice(0, STDERR_CAP_BYTES);
        }
      }
    });

    if (opts.stdin !== undefined) {
      child.stdin.write(opts.stdin);
    }
    child.stdin.end();

    const deadline = opts.timeoutMs ?? 30_000;
    let killed = false;
    const exitPromise = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });

    const result = await Promise.race([
      exitPromise,
      new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve) => {
          setTimeout(() => {
            killed = true;
            void killTree(child).then(() => {
              // Wait for the actual exit after the kill so we don't race teardown.
              child.once('exit', (code, signal) => resolve({ code, signal }));
            });
          }, deadline);
        },
      ),
    ]);

    rl.close();
    if (killed && result.code === null && result.signal === null) {
      // Already kill-tree'd above, but the inner exit handler will resolve.
    }

    return {
      exitCode: result.code,
      signal: result.signal,
      stdoutLines,
      stdoutRaw,
      stderr: stderrBuf,
      hasMalformedStdout,
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveDistBin(): string {
  // __dirname at runtime: <repoRoot>/apps/ptah-cli/tests/e2e/_harness
  // walk up to repo root (4 levels) then descend into dist.
  const here = __dirname;
  const repoRoot = path.resolve(here, '..', '..', '..', '..', '..');
  return path.join(repoRoot, 'dist', 'apps', 'ptah-cli', 'main.mjs');
}

function buildEnv(
  homePath: string,
  overrides: NodeJS.ProcessEnv | undefined,
): NodeJS.ProcessEnv {
  const cleaned: NodeJS.ProcessEnv = { ...process.env };
  // Strip upstream auth env vars so e2e never accidentally calls real APIs.
  delete cleaned['ANTHROPIC_API_KEY'];
  delete cleaned['ANTHROPIC_AUTH_TOKEN'];
  delete cleaned['OPENAI_API_KEY'];
  delete cleaned['COPILOT_TOKEN'];
  delete cleaned['GITHUB_TOKEN'];
  // Force headless / non-coloured output.
  cleaned['FORCE_COLOR'] = '0';
  cleaned['NO_COLOR'] = '1';
  cleaned['PTAH_NO_TTY'] = '1';
  cleaned['NX_TUI'] = 'false';
  // HOME + USERPROFILE: both, every test, every platform.
  cleaned['HOME'] = homePath;
  cleaned['USERPROFILE'] = homePath;
  cleaned['APPDATA'] = path.join(homePath, 'AppData', 'Roaming');
  cleaned['LOCALAPPDATA'] = path.join(homePath, 'AppData', 'Local');
  // Caller overrides win — e.g. fake ANTHROPIC_API_KEY or PTAH_AUTO_APPROVE.
  return { ...cleaned, ...(overrides ?? {}) };
}

async function wireHandle(
  child: ChildProcessWithoutNullStreams,
  opts: CliRunnerOptions,
): Promise<RunnerHandle> {
  const pending = new Map<string | number, PendingRequest>();
  const notifications: Array<{ method: string; params: unknown }> = [];
  const notifWaiters: NotificationWaiter[] = [];
  let stderrBuf = '';
  let resolvedExit: number | null = null;
  let nextId = 1;

  const rl = readline.createInterface({ input: child.stdout, terminal: false });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let msg: unknown;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return; // malformed line — ignore (mirrors stdin-reader.ts behaviour)
    }
    if (!isObj(msg) || msg['jsonrpc'] !== '2.0') return;

    if ('id' in msg && ('result' in msg || 'error' in msg)) {
      // Response.
      const resp = msg as unknown as JsonRpcResponseLike;
      const p = pending.get(resp.id);
      if (!p) return;
      pending.delete(resp.id);
      if (p.timer) clearTimeout(p.timer);
      if ('error' in resp && resp.error) {
        const err = new RpcError(
          resp.error.message,
          resp.error.code,
          resp.error.data,
        );
        p.reject(err);
      } else {
        p.resolve(resp.result);
      }
      return;
    }

    if (typeof (msg as { method?: unknown }).method === 'string') {
      const note = msg as unknown as JsonRpcNotificationLike;
      notifications.push({ method: note.method, params: note.params });
      // Drain matching waiters.
      for (let i = notifWaiters.length - 1; i >= 0; i--) {
        const w = notifWaiters[i];
        if (w.method !== note.method) continue;
        if (w.pred && !safePred(w.pred, note.params)) continue;
        if (w.timer) clearTimeout(w.timer);
        notifWaiters.splice(i, 1);
        w.resolve(note.params);
      }
    }
  });

  child.stderr.on('data', (chunk: string) => {
    if (stderrBuf.length < STDERR_CAP_BYTES) {
      stderrBuf += chunk;
      if (stderrBuf.length > STDERR_CAP_BYTES) {
        stderrBuf = stderrBuf.slice(0, STDERR_CAP_BYTES);
      }
    }
  });

  child.once('exit', (code) => {
    resolvedExit = code;
    // Reject any in-flight waiters / pending requests so tests fail cleanly.
    for (const p of pending.values()) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(
        new Error(
          `CliRunner: child exited (code=${code}) with pending request; ` +
            `last 200 stderr chars: ${stderrBuf.slice(-200)}`,
        ),
      );
    }
    pending.clear();
    for (const w of notifWaiters) {
      if (w.timer) clearTimeout(w.timer);
      w.reject(
        new Error(
          `CliRunner: child exited (code=${code}) before '${w.method}' arrived; ` +
            `observed methods: ${notifications
              .map((n) => n.method)
              .slice(-5)
              .join(', ')}`,
        ),
      );
    }
    notifWaiters.length = 0;
  });

  child.once('error', (err) => {
    for (const p of pending.values()) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(err);
    }
    pending.clear();
    for (const w of notifWaiters) {
      if (w.timer) clearTimeout(w.timer);
      w.reject(err);
    }
    notifWaiters.length = 0;
  });

  const sendLine = (obj: unknown): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const line = JSON.stringify(obj) + '\n';
      child.stdin.write(line, (err) => (err ? reject(err) : resolve()));
    });

  const request = <T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs = 15_000,
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = `e2e-${nextId++}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          new Error(
            `CliRunner.request('${method}') timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
      pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
        timer,
      });
      const envelope: Record<string, unknown> = {
        jsonrpc: '2.0',
        id,
        method,
      };
      if (params !== undefined) envelope['params'] = params;
      sendLine(envelope).catch((err) => {
        pending.delete(id);
        clearTimeout(timer);
        reject(err);
      });
    });

  const notify = (method: string, params?: unknown): Promise<void> => {
    const envelope: Record<string, unknown> = { jsonrpc: '2.0', method };
    if (params !== undefined) envelope['params'] = params;
    return sendLine(envelope);
  };

  const awaitNotification = <T = unknown>(
    method: string,
    timeoutMs = 15_000,
    pred?: (params: T) => boolean,
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      // Sweep already-buffered notifications first.
      for (const n of notifications) {
        if (n.method !== method) continue;
        if (pred && !safePred(pred as (p: unknown) => boolean, n.params))
          continue;
        resolve(n.params as T);
        return;
      }
      const timer = setTimeout(() => {
        const idx = notifWaiters.findIndex((w) => w === waiter);
        if (idx >= 0) notifWaiters.splice(idx, 1);
        reject(
          new Error(
            `CliRunner.awaitNotification('${method}') timed out after ${timeoutMs}ms; ` +
              `last 5 observed methods: ${notifications
                .slice(-5)
                .map((n) => n.method)
                .join(', ')}`,
          ),
        );
      }, timeoutMs);
      const waiter: NotificationWaiter = {
        method,
        pred: pred as ((p: unknown) => boolean) | undefined,
        resolve: (v) => resolve(v as T),
        reject,
        timer,
      };
      notifWaiters.push(waiter);
    });

  // Wait for session.ready (unless caller opted out).
  let ready: SessionReady = {
    session_id: '',
    version: '',
    capabilities: [],
    protocol_version: '',
  };
  if (opts.skipReady !== true) {
    try {
      ready = await withTimeout(
        awaitNotification<SessionReady>('session.ready'),
        opts.spawnReadyTimeoutMs ?? 30_000,
        'session.ready',
      );
    } catch (err) {
      // Surface stderr so test failures are diagnosable.
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `CliRunner.spawn: session.ready never arrived. ${reason}\n` +
          `--- stderr (last 1000 chars) ---\n${stderrBuf.slice(-1000)}`,
      );
    }
  }

  return {
    child,
    ready,
    request,
    notify,
    awaitNotification: (method, timeoutMs) =>
      awaitNotification(method, timeoutMs),
    awaitNotificationWhere: <T = unknown>(
      method: string,
      pred: (params: T) => boolean,
      timeoutMs?: number,
    ) => awaitNotification(method, timeoutMs, pred),
    observed: () => notifications.slice(),
    stderr: () => stderrBuf,
    exitCode: () => resolvedExit,
    async shutdown(): Promise<number | null> {
      if (resolvedExit !== null) return resolvedExit;
      try {
        await request('session.shutdown', {}, 2_000).catch(() => undefined);
      } catch {
        /* ignore — child may already be tearing down */
      }
      try {
        await withTimeout(
          new Promise<void>((resolve) => child.once('exit', () => resolve())),
          6_000,
          'child exit after session.shutdown',
        );
      } catch {
        await killTree(child);
      }
      return resolvedExit;
    },
    async kill(): Promise<void> {
      if (resolvedExit !== null) return;
      await killTree(child);
    },
  };
}

class RpcError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function safePred(pred: (p: unknown) => boolean, params: unknown): boolean {
  try {
    return pred(params);
  } catch {
    return false;
  }
}

function killTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise<void>((resolve) => {
    if (child.pid === undefined || child.exitCode !== null) {
      resolve();
      return;
    }
    treeKill(child.pid, 'SIGKILL', () => resolve());
  });
}

export { RpcError };
