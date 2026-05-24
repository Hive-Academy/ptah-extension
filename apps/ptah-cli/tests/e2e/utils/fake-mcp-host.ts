/**
 * Fake MCP host — spawns the built `ptah mcp-serve` binary as a subprocess
 * and exposes a typed NDJSON JSON-RPC 2.0 driver so e2e specs can validate
 * the wire surface end-to-end.
 *
 * Why a new helper instead of reusing {@link CliRunner}:
 *   - `CliRunner.spawn` is hard-coded to `interact` and waits for a
 *     `session.ready` notification that `mcp-serve` does NOT emit (mcp-serve
 *     emits `notifications/initialized` + a debug-level
 *     `notifications/message`).
 *   - The mcp-serve wire surface uses MCP-spec method names (`initialize`,
 *     `tools/list`, `tools/call`, `notifications/cancelled`) that hosts may
 *     pipeline differently from the `interact` task.* dance — a dedicated
 *     driver makes those mechanics explicit.
 *
 * Implementation details:
 *   - Spawns `node dist/apps/ptah-cli/main.mjs mcp-serve [...args]` via
 *     `process.execPath`. The `nx run ptah-cli:e2e` target declares
 *     `dependsOn: ['build']` so the bundle is fresh when this helper runs.
 *   - NDJSON framing: outbound frames are `JSON.stringify(envelope) + '\n'`;
 *     inbound frames are read with `readline` (`crlfDelay: Infinity`).
 *   - Response correlation: each `send()` mints a unique numeric id and
 *     parks the resolve/reject pair in a map keyed by id; the inbound
 *     handler dispatches to the matching entry.
 *   - Notification subscribers fire on every match. `collect(method)`
 *     drains a FIFO buffer of past-and-future matches for that method,
 *     useful for assertions that need to know the full notification stream.
 *   - `close()` sends `stdin.end()` (EOF triggers graceful exit code 0)
 *     and waits up to 5s for `child.on('exit')`; on timeout SIGKILLs the
 *     tree via the `tree-kill` package already used by `CliRunner`.
 *   - License-tier injection: `licenseStatus` pre-seeds
 *     `~/.ptah/global-state.json` with a `ptah.licenseCache` envelope so
 *     the in-process `LicenseCache.loadPersistedCache()` hydrates the
 *     right tier on cold start. This is the SAME mechanism the existing
 *     `license-cli.e2e.spec.ts` Bug 9 case uses — no new source-side
 *     hooks were introduced. Pass `'pro'` for the Pro tier, `'community'`
 *     for the Free tier, or `null` to leave the cache empty (so the gate
 *     denies all premium tools).
 *
 * Env defaults: `FORCE_COLOR=0`, `NO_COLOR=1`, `PTAH_NO_TTY=1`,
 * `NX_TUI=false`, `PTAH_AUTO_APPROVE=true` (so the SDK permission gate
 * doesn't wait for a webview-supplied response). Sensitive provider keys
 * are stripped (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.) before the
 * caller's `env` override is applied.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as readline from 'node:readline';

import type { TmpHome } from '../_harness/tmp-home.js';

const treeKill: (
  pid: number,
  signal: string,
  cb: (err?: Error) => void,
) => void = require('tree-kill');

export type LicenseStatus = 'community' | 'pro' | null;

export interface FakeMcpHostOptions {
  /**
   * Tmp HOME directory. Pre-seeded with `.ptah/global-state.json` when
   * {@link licenseStatus} is non-null.
   */
  home: TmpHome;
  /** Extra CLI args after `mcp-serve` (e.g. `['--allow-tools', 'agent_list']`). */
  args?: readonly string[];
  /** Env additions merged on top of cleaned process.env. */
  env?: Record<string, string>;
  /**
   * License tier to inject. `'pro'` seeds a valid Pro license; `'community'`
   * seeds a valid Free license; `null` (default) leaves the cache empty so
   * the gate denies all premium tools.
   */
  licenseStatus?: LicenseStatus;
  /** Default 30_000ms (cold DI bootstrap headroom on slow CI). */
  spawnReadyTimeoutMs?: number;
  /**
   * When true, do NOT wait for `notifications/initialized` before resolving.
   * Default: false (wait so subsequent `send()` calls hit a hydrated DI graph).
   */
  skipInitialized?: boolean;
}

export interface MCPResponse<TResult = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: TResult;
  error?: { code: number; message: string; data?: unknown };
}

export interface FakeMcpHost {
  /** Send a JSON-RPC request and wait for the matching response. */
  send<TResult = unknown>(
    method: string,
    params?: unknown,
    timeoutMs?: number,
  ): Promise<MCPResponse<TResult>>;
  /** Send a JSON-RPC notification (no response expected). */
  notify(method: string, params?: unknown): Promise<void>;
  /** Subscribe to a notification method; returns an unsubscribe function. */
  onNotification(method: string, cb: (params: unknown) => void): () => void;
  /**
   * Wait for the next notification matching `method` (FIFO; consumes from
   * the buffered queue first, then waits if empty). Rejects on timeout or
   * child exit.
   */
  awaitNotification(method: string, timeoutMs?: number): Promise<unknown>;
  /**
   * Snapshot of every notification observed for `method` since spawn. Does
   * not consume the buffer.
   */
  observed(method?: string): Array<{ method: string; params: unknown }>;
  /** Captured stderr (capped at 1 MB). */
  stderr(): string;
  /** Most recent exit code, or null if still running. */
  exitCode(): number | null;
  /** Most recent exit signal, or null. */
  exitSignal(): NodeJS.Signals | null;
  /** Send `process.kill(signal)` to the child. */
  signal(sig: NodeJS.Signals): void;
  /**
   * Graceful close: send EOF (stdin.end()), wait up to 5s for exit, SIGKILL
   * the tree on timeout. Idempotent.
   */
  close(): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
  /** PID of the spawned process. */
  readonly pid: number;
}

const STDERR_CAP_BYTES = 1_048_576;
const DEFAULT_SEND_TIMEOUT_MS = 15_000;
const DEFAULT_INITIALIZED_TIMEOUT_MS = 30_000;
const DEFAULT_CLOSE_GRACE_MS = 5_000;

interface PendingRequest {
  resolve(value: MCPResponse): void;
  reject(err: Error): void;
  timer: ReturnType<typeof setTimeout> | null;
}

interface NotificationWaiter {
  method: string;
  resolve(params: unknown): void;
  reject(err: Error): void;
  timer: ReturnType<typeof setTimeout> | null;
}

function resolveDistBin(): string {
  const here = __dirname;
  const repoRoot = path.resolve(here, '..', '..', '..', '..', '..');
  return path.join(repoRoot, 'dist', 'apps', 'ptah-cli', 'main.mjs');
}

function buildEnv(
  homePath: string,
  overrides: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
  const cleaned: NodeJS.ProcessEnv = { ...process.env };
  // Strip any real provider credentials so the e2e spawn cannot
  // accidentally call upstream. The fake `ANTHROPIC_API_KEY` is RE-ADDED
  // below after the strip so SDK init has *something* to bind to.
  delete cleaned['ANTHROPIC_API_KEY'];
  delete cleaned['ANTHROPIC_AUTH_TOKEN'];
  delete cleaned['OPENAI_API_KEY'];
  delete cleaned['COPILOT_TOKEN'];
  delete cleaned['GITHUB_TOKEN'];
  cleaned['FORCE_COLOR'] = '0';
  cleaned['NO_COLOR'] = '1';
  cleaned['PTAH_NO_TTY'] = '1';
  cleaned['NX_TUI'] = 'false';
  cleaned['PTAH_AUTO_APPROVE'] = 'true';
  // SDK init checks for *any* configured auth, not key validity. Supply a
  // fake key so `withEngine({ requireSdk: true })` does not reject the
  // bootstrap with `sdk_init_failed`. The same pattern is used by every
  // ptah-cli e2e spec that hits a `requireSdk: true` code path
  // (`headless-task.e2e.spec.ts`, `permission-gates.e2e.spec.ts`, etc.).
  cleaned['ANTHROPIC_API_KEY'] =
    'sk-ant-e2e-fake-key-not-real-do-not-call-upstream';
  cleaned['HOME'] = homePath;
  cleaned['USERPROFILE'] = homePath;
  cleaned['APPDATA'] = path.join(homePath, 'AppData', 'Roaming');
  cleaned['LOCALAPPDATA'] = path.join(homePath, 'AppData', 'Local');
  return { ...cleaned, ...(overrides ?? {}) };
}

/**
 * Pre-seed `~/.ptah/global-state.json` so the LicenseCache hydrates the
 * requested tier on cold start. Matches the persisted envelope shape from
 * `libs/backend/vscode-core/src/services/license/license-types.ts` exactly.
 * The community variant carries `valid:true,tier:'community'` (same shape
 * `LicenseService.seedCommunityStatus()` writes); the pro variant carries
 * `valid:true,tier:'pro'` + a plan + a far-future `expiresAt`.
 */
async function seedLicenseCache(
  home: TmpHome,
  status: Exclude<LicenseStatus, null>,
): Promise<void> {
  const stateFile = path.join(home.ptahDir, 'global-state.json');
  const now = Date.now();
  const persisted =
    status === 'pro'
      ? {
          'ptah.licenseCache': {
            status: {
              valid: true,
              tier: 'pro',
              plan: { name: 'Pro' },
              expiresAt: new Date(now + 365 * 86_400_000).toISOString(),
            },
            persistedAt: now,
            lastValidatedAt: now,
          },
        }
      : {
          'ptah.licenseCache': {
            status: {
              valid: true,
              tier: 'community',
            },
            persistedAt: now,
            lastValidatedAt: now,
          },
        };
  await fsp.writeFile(stateFile, JSON.stringify(persisted), 'utf8');
}

export async function spawnPtahMcp(
  opts: FakeMcpHostOptions,
): Promise<FakeMcpHost> {
  const distBin = resolveDistBin();
  if (!fs.existsSync(distBin)) {
    throw new Error(
      `spawnPtahMcp: dist binary not found at ${distBin}. ` +
        `Run 'nx build ptah-cli' before running e2e specs.`,
    );
  }

  if (opts.licenseStatus !== null && opts.licenseStatus !== undefined) {
    await seedLicenseCache(opts.home, opts.licenseStatus);
  }

  const env = buildEnv(opts.home.path, opts.env);
  const args = ['mcp-serve', ...(opts.args ?? [])];

  const child = spawn(process.execPath, [distBin, ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: opts.home.path,
    env,
    windowsHide: true,
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  const pending = new Map<number, PendingRequest>();
  const notifications: Array<{ method: string; params: unknown }> = [];
  const subscribers = new Map<string, Set<(params: unknown) => void>>();
  const waiters: NotificationWaiter[] = [];
  let stderrBuf = '';
  let resolvedExitCode: number | null = null;
  let resolvedExitSignal: NodeJS.Signals | null = null;
  let closed = false;
  let nextId = 1;

  const rl = readline.createInterface({
    input: child.stdout,
    terminal: false,
    crlfDelay: Infinity,
  });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let msg: unknown;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (!isObj(msg) || msg['jsonrpc'] !== '2.0') return;

    if ('id' in msg && ('result' in msg || 'error' in msg)) {
      const resp = msg as unknown as MCPResponse;
      const rawId = (msg as { id?: unknown })['id'];
      const id =
        typeof rawId === 'number'
          ? rawId
          : typeof rawId === 'string'
            ? Number(rawId)
            : NaN;
      if (!Number.isFinite(id)) return;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (p.timer) clearTimeout(p.timer);
      p.resolve(resp);
      return;
    }

    if (typeof (msg as { method?: unknown }).method === 'string') {
      const method = (msg as { method: string }).method;
      const params = (msg as { params?: unknown }).params;
      notifications.push({ method, params });
      const subs = subscribers.get(method);
      if (subs) {
        for (const cb of subs) {
          try {
            cb(params);
          } catch {
            // Swallow callback errors so a single bad subscriber does not
            // tear down the dispatch loop.
          }
        }
      }
      for (let i = waiters.length - 1; i >= 0; i--) {
        const w = waiters[i];
        if (w.method !== method) continue;
        if (w.timer) clearTimeout(w.timer);
        waiters.splice(i, 1);
        w.resolve(params);
        break;
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

  child.once('exit', (code, signal) => {
    resolvedExitCode = code;
    resolvedExitSignal = signal;
    for (const p of pending.values()) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(
        new Error(
          `FakeMcpHost: child exited (code=${code}, signal=${signal}) with pending request; ` +
            `last 200 stderr chars: ${stderrBuf.slice(-200)}`,
        ),
      );
    }
    pending.clear();
    for (const w of waiters) {
      if (w.timer) clearTimeout(w.timer);
      w.reject(
        new Error(
          `FakeMcpHost: child exited (code=${code}) before '${w.method}' arrived. ` +
            `observed methods (last 5): ${notifications
              .map((n) => n.method)
              .slice(-5)
              .join(', ')}`,
        ),
      );
    }
    waiters.length = 0;
  });

  child.once('error', (err) => {
    for (const p of pending.values()) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(err);
    }
    pending.clear();
    for (const w of waiters) {
      if (w.timer) clearTimeout(w.timer);
      w.reject(err);
    }
    waiters.length = 0;
  });

  const sendLine = (obj: unknown): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const line = JSON.stringify(obj) + '\n';
      child.stdin.write(line, (err) => (err ? reject(err) : resolve()));
    });

  const send = <TResult = unknown>(
    method: string,
    params?: unknown,
    timeoutMs = DEFAULT_SEND_TIMEOUT_MS,
  ): Promise<MCPResponse<TResult>> =>
    new Promise<MCPResponse<TResult>>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          new Error(
            `FakeMcpHost.send('${method}') timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
      pending.set(id, {
        resolve: (v) => resolve(v as MCPResponse<TResult>),
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

  const onNotification = (
    method: string,
    cb: (params: unknown) => void,
  ): (() => void) => {
    let subs = subscribers.get(method);
    if (!subs) {
      subs = new Set();
      subscribers.set(method, subs);
    }
    subs.add(cb);
    return () => {
      subs?.delete(cb);
    };
  };

  const awaitNotification = (
    method: string,
    timeoutMs = DEFAULT_SEND_TIMEOUT_MS,
  ): Promise<unknown> =>
    new Promise<unknown>((resolve, reject) => {
      // Drain from the existing buffer first (FIFO).
      const idx = notifications.findIndex((n) => n.method === method);
      if (idx >= 0) {
        const hit = notifications[idx];
        resolve(hit.params);
        return;
      }
      const timer = setTimeout(() => {
        const wIdx = waiters.findIndex((w) => w === waiter);
        if (wIdx >= 0) waiters.splice(wIdx, 1);
        reject(
          new Error(
            `FakeMcpHost.awaitNotification('${method}') timed out after ${timeoutMs}ms. ` +
              `observed methods (last 5): ${notifications
                .map((n) => n.method)
                .slice(-5)
                .join(', ')}`,
          ),
        );
      }, timeoutMs);
      const waiter: NotificationWaiter = {
        method,
        resolve,
        reject,
        timer,
      };
      waiters.push(waiter);
    });

  // Wait for the post-bootstrap initialized notification (unless caller opts out).
  if (opts.skipInitialized !== true) {
    try {
      await awaitNotification(
        'notifications/initialized',
        opts.spawnReadyTimeoutMs ?? DEFAULT_INITIALIZED_TIMEOUT_MS,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      try {
        await killTree(child);
      } catch {
        // best-effort
      }
      throw new Error(
        `spawnPtahMcp: notifications/initialized never arrived. ${reason}\n` +
          `--- stderr (last 1000 chars) ---\n${stderrBuf.slice(-1000)}`,
      );
    }
  }

  const close = async (): Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  }> => {
    if (closed) {
      return { exitCode: resolvedExitCode, signal: resolvedExitSignal };
    }
    closed = true;
    // Fast path: child already exited (either resolved via our `exit`
    // handler OR Node's native `child.exitCode` is non-null). Use the
    // native property so a SIGTERM-triggered exit that the test polled
    // does NOT cause us to await `once('exit')` for a past event that
    // will never re-fire.
    if (resolvedExitCode !== null || child.exitCode !== null) {
      rl.close();
      try {
        child.stdin.end();
      } catch {
        // Already ended.
      }
      return { exitCode: resolvedExitCode, signal: resolvedExitSignal };
    }
    try {
      child.stdin.end();
    } catch {
      // Already ended.
    }
    const exitPromise = new Promise<void>((resolve) => {
      // Re-check inside the promise body: another async path may have
      // observed the exit event between our `child.exitCode` check above
      // and this listener attachment.
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      child.once('exit', () => resolve());
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), DEFAULT_CLOSE_GRACE_MS);
    });
    const result = await Promise.race([
      exitPromise.then(() => 'exit' as const),
      timeoutPromise,
    ]);
    if (timer !== undefined) clearTimeout(timer);
    if (result === 'timeout') {
      await killTree(child);
      // Same re-check guard: do not await `once('exit')` for an already-
      // fired event.
      if (child.exitCode === null) {
        await new Promise<void>((resolve) => {
          if (child.exitCode !== null) {
            resolve();
            return;
          }
          child.once('exit', () => resolve());
        });
      }
    }
    rl.close();
    return { exitCode: resolvedExitCode, signal: resolvedExitSignal };
  };

  const pid = child.pid;
  if (pid === undefined) {
    throw new Error('spawnPtahMcp: spawned child has no pid');
  }

  return {
    send,
    notify,
    onNotification,
    awaitNotification,
    observed: (method?: string) =>
      method === undefined
        ? notifications.slice()
        : notifications.filter((n) => n.method === method),
    stderr: () => stderrBuf,
    exitCode: () => resolvedExitCode,
    exitSignal: () => resolvedExitSignal,
    signal: (sig: NodeJS.Signals) => {
      try {
        child.kill(sig);
      } catch {
        // Already exited.
      }
    },
    close,
    pid,
  };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
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
