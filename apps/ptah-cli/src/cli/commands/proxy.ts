/**
 * `ptah proxy` command — Anthropic-compatible HTTP proxy MVP + lifecycle parity.
 *
 * TASK_2026_104 P2 (Anthropic-compatible HTTP proxy MVP).
 * TASK_2026_108 T3 (persistent registry + `proxy stop` / `proxy status`).
 *
 * Three subcommands per `task-description.md`:
 *   - `ptah proxy start [...flags]` — bind the HTTP listener, mint a token,
 *     register the proxy in `~/.ptah/proxies/<port>.json`, and run until
 *     SIGINT / SIGTERM / `proxy.shutdown` RPC. The `finally` block
 *     unregisters the entry so the registry never leaks past the process.
 *   - `ptah proxy stop --port <n>` — read the registry, send SIGTERM to the
 *     registered pid, poll up to 5s, then SIGKILL fallback. Stale entries
 *     (pid already dead) are GC'd silently with a stderr note.
 *   - `ptah proxy status [--json|--human]` — list every alive proxy. NDJSON
 *     in `--json` mode (default), tabular in `--human` mode. Empty registry
 *     exits 0 with no output.
 *
 * The `start` action bootstraps DI via `withEngine({ mode: 'full' })` so the
 * proxy has full access to the chat surface (`chat:start`, `chat:chunk`,
 * etc.) plus the workspace MCP collector RPCs. The lifecycle blocks until
 * a terminal signal fires; teardown drains the proxy, deletes the token
 * file + registry entry, and lets `withEngine` dispose the container.
 *
 * Permission gate enforcement: the proxy refuses to start when neither
 * `--auto-approve` nor an embedded `ptah interact` host is detected. When
 * embedded, the parent `interact` is responsible for installing the
 * `ApprovalBridge` — the proxy just verifies the env-var marker.
 *
 * All notifications go through the structured stderr formatter when there
 * is no JSON-RPC peer (i.e. when launched standalone). When embedded, the
 * caller wires a `JsonRpcServer` into `executeWith` so notifications flow
 * over stdout instead.
 *
 * Q3=A locked (TASK_2026_108 § 8): registry at `~/.ptah/proxies/` (plural).
 * Token directory `~/.ptah/proxy/` (singular) is sibling and unchanged.
 *
 * No commit, no backwards compat — direct in-place command.
 */

import { withEngine } from '../bootstrap/with-engine.js';
import { ExitCode, type ExitCodeValue } from '../jsonrpc/types.js';
import { emitFatalError } from '../output/stderr-json.js';
import { buildFormatter } from '../output/formatter.js';
import type { GlobalOptions } from '../router.js';
import {
  PLATFORM_TOKENS,
  type IHttpServerProvider,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { AnthropicProxyService } from '../../services/proxy/anthropic-proxy.service.js';
import {
  findStale,
  list,
  register,
  unregister,
  type ProxyRegistryEntry,
} from '../../services/proxy/proxy-registry.js';

/** Options accepted by `ptah proxy start`. */
export interface ProxyStartOptions {
  /** TCP port to bind. Required for `start`. */
  port?: number;
  /** Bind host (default `localhost` — dual-stack IPv4/IPv6 loopback). */
  host?: string;
  /** Idle-timeout in seconds (0 disables — default). */
  idleTimeout?: number;
  /** Workspace MCP / plugin-skill exposure (default true). */
  exposeWorkspaceTools?: boolean;
}

/** Options accepted by `ptah proxy stop`. */
export interface ProxyStopOptions {
  /** TCP port of the proxy to stop. Required — bulk stop is YAGNI. */
  port?: number;
}

/**
 * Options accepted by `ptah proxy status`.
 *
 * Currently empty — `--json` / `--human` are read from `globals`. Typed as a
 * record alias rather than an empty interface so ESLint's
 * `no-empty-interface` / `no-empty-object-type` rules stay happy while still
 * naming the slot for future option flags.
 */
export type ProxyStatusOptions = Record<string, never>;

// ---------------------------------------------------------------------------
// Internal seams (process-level operations grouped here for testability)
// ---------------------------------------------------------------------------

/**
 * Test seam: process control + clock. Production wires real
 * `process.kill` and `setTimeout`; spec mocks supply scripted versions.
 *
 * We expose these as a single object so callers (tests) can pass a single
 * `hooks` argument instead of N positional overrides.
 */
export interface ProxyLifecycleHooks {
  /** Override `process.kill`. Production: real `process.kill`. */
  kill?: (pid: number, signal?: NodeJS.Signals | number) => true;
  /** Override `setTimeout` to drive fake timers. Default: real. */
  setTimeoutImpl?: typeof setTimeout;
  /** Override `clearTimeout`. Default: real. */
  clearTimeoutImpl?: typeof clearTimeout;
  /** Override `process.stderr.write`. Default: real. */
  stderrWrite?: (chunk: string) => boolean;
  /** Override `process.stdout.write` (for `--json` NDJSON). Default: real. */
  stdoutWrite?: (chunk: string) => boolean;
  /** Override registry `list()` — used to inject in-memory fixtures in tests. */
  list?: typeof list;
  /** Override registry `findStale()`. */
  findStale?: typeof findStale;
  /** Override registry `unregister()`. */
  unregister?: typeof unregister;
}

/**
 * `ptah proxy start` — long-running HTTP listener.
 *
 * Resolves to an exit code so the router can set `process.exitCode` instead
 * of calling `process.exit` directly (matches the pattern used by every
 * other Batch 5+ command).
 */
export async function executeStart(
  opts: ProxyStartOptions,
  globals: GlobalOptions,
): Promise<number> {
  // ---- Validate flags -----------------------------------------------------
  if (typeof opts.port !== 'number' || !Number.isFinite(opts.port)) {
    emitFatalError('proxy_invalid_request', '`--port <n>` is required', {
      command: 'proxy start',
    });
    return ExitCode.UsageError;
  }
  if (opts.port < 0 || opts.port > 65535 || !Number.isInteger(opts.port)) {
    emitFatalError(
      'proxy_invalid_request',
      `--port must be an integer in [0, 65535] (got ${opts.port})`,
      { command: 'proxy start' },
    );
    return ExitCode.UsageError;
  }

  // Use 'localhost' (rather than '127.0.0.1') so Node's dual-stack DNS resolution
  // applies — clients that prefer IPv6 (::1) can still reach the proxy on hosts
  // where the loopback iface only exposes one of the two address families.
  const host = opts.host ?? 'localhost';
  // `--auto-approve` is a global flag (see `program.option` in router.ts) so
  // we read it from `globals` rather than the subcommand-level `opts` to
  // avoid commander's parent/subcommand option-name conflict (the value lands
  // on the parent only when both are declared).
  const autoApprove = globals.autoApprove === true;
  const exposeWorkspaceTools = opts.exposeWorkspaceTools !== false;
  const embedded = process.env['PTAH_INTERACT_ACTIVE'] === '1';

  // Permission gate fail-fast.
  if (!autoApprove && !embedded) {
    emitFatalError(
      'permission_gate_unavailable',
      '`ptah proxy start` requires either `--auto-approve` or to be launched embedded inside `ptah interact`',
      { command: 'proxy start' },
    );
    return ExitCode.AuthRequired;
  }

  let exitCode: ExitCodeValue = ExitCode.Success;

  try {
    await withEngine(globals, { mode: 'full' }, async (ctx) => {
      const httpProvider = ctx.container.resolve<IHttpServerProvider>(
        PLATFORM_TOKENS.HTTP_SERVER_PROVIDER,
      );
      const workspaceProvider = ctx.container.resolve<IWorkspaceProvider>(
        PLATFORM_TOKENS.WORKSPACE_PROVIDER,
      );
      const workspacePath =
        workspaceProvider.getWorkspaceRoot() ?? globals.cwd ?? process.cwd();

      const proxy = new AnthropicProxyService(
        {
          host,
          port: opts.port as number,
          exposeWorkspaceTools,
          autoApprove,
          workspacePath,
          idleTimeoutSeconds: opts.idleTimeout ?? 0,
        },
        httpProvider,
        ctx.transport,
        ctx.pushAdapter,
        // No JSON-RPC peer when standalone — notifications drop. When
        // embedded inside `interact`, the parent process bridges the proxy
        // by importing this command's internals (see Phase 2 TODO below).
      );

      // Track the bound port so the `finally` block can unregister even when
      // `proxy.start()` partially succeeds and the SIGTERM teardown unwinds.
      let boundPort: number | null = null;

      try {
        const {
          port,
          host: boundHost,
          tokenPath,
          tokenFingerprint,
        } = await proxy.start();
        boundPort = port;

        // Persist the proxy in the on-disk registry so `ptah proxy status`
        // and `ptah proxy stop --port <n>` can find this process. The
        // fingerprint is the SHA-256 prefix of the bearer token — the raw
        // token never leaves the proxy service.
        await register({
          pid: process.pid,
          port,
          host: boundHost,
          startedAt: Date.now(),
          tokenFingerprint,
        });

        // Surface the bound address to stderr so supervisors can scrape it
        // when the JSON-RPC stdout channel is unavailable.
        process.stderr.write(
          `[ptah] proxy listening on http://${boundHost}:${port} (token: ${tokenPath})\n`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emitFatalError('proxy_bind_failed', message, {
          command: 'proxy start',
          host,
          port: opts.port,
        });
        exitCode = ExitCode.GeneralError;
        return;
      }

      // Block until SIGINT / SIGTERM. EOF on stdin is NOT used because
      // the standalone proxy doesn't read stdin.
      let resolveBlock: (() => void) | null = null;
      const blockPromise = new Promise<void>((resolve) => {
        resolveBlock = resolve;
      });
      const onSigint = (): void => {
        process.stderr.write('[ptah] proxy received sigint, shutting down\n');
        resolveBlock?.();
      };
      const onSigterm = (): void => {
        process.stderr.write('[ptah] proxy received sigterm, shutting down\n');
        resolveBlock?.();
      };
      process.once('SIGINT', onSigint);
      process.once('SIGTERM', onSigterm);

      try {
        await blockPromise;
      } finally {
        process.off('SIGINT', onSigint);
        process.off('SIGTERM', onSigterm);
        await proxy.stop('shutdown');
        // Unregister covers BOTH SIGTERM/SIGINT teardown AND the
        // `proxy.shutdown` RPC drain path (T1 wired the RPC handler to
        // unwind through this same finally). `unregister` is idempotent on
        // missing files so a duplicate call from an embedded interact host
        // is safe. Wrapped in `.catch(() => {})` so a stale unregister
        // doesn't mask the proxy's terminal exit code.
        if (boundPort !== null) {
          await unregister(boundPort).catch(() => {
            /* swallow — registry leak is non-fatal at process exit */
          });
        }
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emitFatalError('internal_failure', message, {
      command: 'proxy start',
    });
    return ExitCode.InternalFailure;
  }

  return exitCode;
}

// ---------------------------------------------------------------------------
// `ptah proxy stop` — TASK_2026_108 T3 Task 3.4
// ---------------------------------------------------------------------------

/**
 * `ptah proxy stop --port <n>` — graceful SIGTERM with 5s timeout, then
 * SIGKILL fallback.
 *
 * Algorithm:
 *   1. Validate `--port`. Missing → exit 1 with `proxy_invalid_request`.
 *   2. Look up the entry via `list()` (which auto-filters dead pids and
 *      auto-unregisters them). If the matching entry is in `findStale()`
 *      instead — pid already dead — call `unregister`, emit a stderr
 *      `[ptah] removed stale registry entry on port <n>` line, exit 0.
 *      (The desired end-state — "no proxy on port" — is already achieved.)
 *   3. If neither alive nor stale → exit 1 with `proxy_not_found`.
 *   4. Otherwise: SIGTERM the pid. Poll `process.kill(pid, 0)` every 100ms
 *      up to 5000ms total. If still alive at deadline, SIGKILL with a stderr
 *      warning line.
 *
 * Q3=A: bulk stop (`--all`) is YAGNI — explicitly out-of-scope per plan
 * § 7.2. `--port` is mandatory.
 */
export async function executeStop(
  opts: ProxyStopOptions,
  _globals: GlobalOptions,
  hooks: ProxyLifecycleHooks = {},
): Promise<number> {
  const stderrWrite =
    hooks.stderrWrite ?? ((chunk: string) => process.stderr.write(chunk));
  const killImpl = hooks.kill ?? process.kill.bind(process);
  const setTimeoutImpl = hooks.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = hooks.clearTimeoutImpl ?? clearTimeout;
  const listImpl = hooks.list ?? list;
  const findStaleImpl = hooks.findStale ?? findStale;
  const unregisterImpl = hooks.unregister ?? unregister;

  if (typeof opts.port !== 'number' || !Number.isFinite(opts.port)) {
    emitFatalError('proxy_invalid_request', '`--port <n>` is required', {
      command: 'proxy stop',
    });
    return ExitCode.GeneralError;
  }
  const targetPort = opts.port;

  // Read alive entries (this also auto-GCs dead-pid entries inline). We do
  // NOT short-circuit on alive miss — we still check `findStale()` so a
  // pid-already-dead entry exits 0 with the desired end-state achieved.
  const alive = await listImpl();
  const aliveEntry = alive.find((e) => e.port === targetPort);

  if (aliveEntry === undefined) {
    // Maybe the entry exists but the pid is dead. Check findStale().
    const stale = await findStaleImpl();
    const staleEntry = stale.find((e) => e.port === targetPort);
    if (staleEntry !== undefined) {
      await unregisterImpl(targetPort).catch(() => {
        /* swallow — concurrent unregister */
      });
      stderrWrite(
        `[ptah] removed stale registry entry on port ${targetPort}\n`,
      );
      return ExitCode.Success;
    }
    // Truly missing — neither alive nor stale.
    writeStderrJson(stderrWrite, {
      error: 'proxy_not_found',
      message: `no proxy registered on port ${targetPort}`,
    });
    return ExitCode.GeneralError;
  }

  // SIGTERM, then poll. We cannot use `await sleep(100)` here easily because
  // tests need to advance fake timers — instead we manually orchestrate
  // setTimeout-based polls with explicit promise resolution.
  try {
    killImpl(aliveEntry.pid, 'SIGTERM');
  } catch (err) {
    // pid disappeared between list() and SIGTERM — treat as success and GC.
    if (isNodeErrnoException(err) && err.code === 'ESRCH') {
      await unregisterImpl(targetPort).catch(() => undefined);
      return ExitCode.Success;
    }
    const message = err instanceof Error ? err.message : String(err);
    emitFatalError('internal_failure', message, {
      command: 'proxy stop',
      port: targetPort,
      pid: aliveEntry.pid,
    });
    return ExitCode.InternalFailure;
  }

  const pollIntervalMs = 100;
  const totalDeadlineMs = 5000;
  const exitedCleanly = await waitForPidExit(
    aliveEntry.pid,
    pollIntervalMs,
    totalDeadlineMs,
    killImpl,
    setTimeoutImpl,
    clearTimeoutImpl,
  );

  if (!exitedCleanly) {
    stderrWrite(
      `[ptah] proxy on port ${targetPort} did not exit on SIGTERM, sent SIGKILL\n`,
    );
    try {
      killImpl(aliveEntry.pid, 'SIGKILL');
    } catch (err) {
      // Pid may have died in the gap between the last poll and SIGKILL —
      // ESRCH is benign.
      if (!(isNodeErrnoException(err) && err.code === 'ESRCH')) {
        const message = err instanceof Error ? err.message : String(err);
        emitFatalError('internal_failure', message, {
          command: 'proxy stop',
          port: targetPort,
          pid: aliveEntry.pid,
        });
        return ExitCode.InternalFailure;
      }
    }
  }

  // Best-effort registry cleanup. The proxy itself usually does this in its
  // `finally` block, but if the pid was SIGKILL'd that block never ran.
  await unregisterImpl(targetPort).catch(() => undefined);

  return ExitCode.Success;
}

/**
 * Poll `process.kill(pid, 0)` every `intervalMs` until the pid is dead or
 * the deadline passes. Resolves `true` when the process is dead before the
 * deadline, `false` when the deadline expires.
 *
 * Uses injected `setTimeoutImpl` / `clearTimeoutImpl` so spec tests can
 * drive the loop with `jest.useFakeTimers()`.
 */
function waitForPidExit(
  pid: number,
  intervalMs: number,
  deadlineMs: number,
  killImpl: (pid: number, signal?: NodeJS.Signals | number) => true,
  setTimeoutImpl: typeof setTimeout,
  clearTimeoutImpl: typeof clearTimeout,
): Promise<boolean> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cancel = (): void => {
      if (timer !== null) {
        clearTimeoutImpl(timer);
        timer = null;
      }
    };
    const tick = (): void => {
      if (!isPidAlive(pid, killImpl)) {
        cancel();
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= deadlineMs) {
        cancel();
        resolve(false);
        return;
      }
      timer = setTimeoutImpl(tick, intervalMs);
    };
    // First check immediately so a process that died before SIGTERM polled
    // doesn't burn 100ms of wall clock.
    tick();
  });
}

/**
 * Local pid-alive probe. Mirrors the registry's internal helper but uses
 * the injected `killImpl` so tests can script the result.
 */
function isPidAlive(
  pid: number,
  killImpl: (pid: number, signal?: NodeJS.Signals | number) => true,
): boolean {
  try {
    killImpl(pid, 0);
    return true;
  } catch (err) {
    if (isNodeErrnoException(err) && err.code === 'EPERM') {
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// `ptah proxy status` — TASK_2026_108 T3 Task 3.5
// ---------------------------------------------------------------------------

/**
 * `ptah proxy status` — list every alive proxy in the registry.
 *
 * `--json` mode (default per `globals.json === true && globals.human !== true`):
 *   one NDJSON line per entry on stdout, terminated with `\n`. Format:
 *   `{"port":<n>,"host":"<h>","pid":<p>,"started_at":<t>,"alive":true}`.
 *
 * `--human` mode: a fixed-width tabular print (port | host | pid | uptime).
 *
 * Empty registry: exit 0, no output.
 *
 * No `--watch` mode (out-of-scope per plan § 7.3).
 */
export async function executeStatus(
  _opts: ProxyStatusOptions,
  globals: GlobalOptions,
  hooks: ProxyLifecycleHooks = {},
): Promise<number> {
  const listImpl = hooks.list ?? list;
  const stdoutWrite =
    hooks.stdoutWrite ?? ((chunk: string) => process.stdout.write(chunk));

  let entries: ProxyRegistryEntry[];
  try {
    entries = await listImpl();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emitFatalError('internal_failure', message, {
      command: 'proxy status',
    });
    return ExitCode.InternalFailure;
  }

  if (entries.length === 0) {
    return ExitCode.Success;
  }

  if (globals.human === true) {
    const table = renderHumanTable(entries);
    stdoutWrite(table);
    // Touch the formatter import to satisfy linters that flag unused
    // re-exports, and to keep the human formatter accessible if a future
    // change wants to delegate row formatting through it.
    void buildFormatter;
    return ExitCode.Success;
  }

  // Default: NDJSON one line per entry.
  for (const entry of entries) {
    stdoutWrite(
      `${JSON.stringify({
        port: entry.port,
        host: entry.host,
        pid: entry.pid,
        started_at: entry.startedAt,
        alive: true,
      })}\n`,
    );
  }
  return ExitCode.Success;
}

/**
 * Render the registry as a fixed-width human-readable table.
 *
 * Columns: PORT | HOST | PID | UPTIME (humanized). One trailing newline.
 */
function renderHumanTable(entries: ProxyRegistryEntry[]): string {
  const now = Date.now();
  const headers = ['PORT', 'HOST', 'PID', 'UPTIME'];
  const rows: string[][] = entries.map((e) => [
    String(e.port),
    e.host,
    String(e.pid),
    humanizeUptime(now - e.startedAt),
  ]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );
  const formatRow = (cells: string[]): string =>
    cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  const lines = [formatRow(headers), ...rows.map(formatRow)];
  return `${lines.join('\n')}\n`;
}

/**
 * Render a millisecond duration as a compact human string (e.g. `1h 23m`).
 * Negative / NaN / non-finite inputs render as `0s` to keep the table aligned.
 */
function humanizeUptime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

// ---------------------------------------------------------------------------
// Free helpers
// ---------------------------------------------------------------------------

/** Type guard for `NodeJS.ErrnoException` (`.code` field access). */
function isNodeErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return (
    value instanceof Error &&
    typeof (value as NodeJS.ErrnoException).code === 'string'
  );
}

/**
 * Emit a single-line NDJSON error envelope to the supplied `stderrWrite`.
 *
 * Format: `{"error":"<code>","message":"<msg>"}\n`. Distinct from
 * `emitFatalError` because `executeStop` reports `proxy_not_found` which is
 * NOT a fatal `PtahErrorCode` — the caller can easily retry with a different
 * port.
 */
function writeStderrJson(
  stderrWrite: (chunk: string) => boolean,
  payload: Record<string, unknown>,
): void {
  try {
    stderrWrite(`${JSON.stringify(payload)}\n`);
  } catch {
    /* swallow — stderr write failure cannot be reported anywhere */
  }
}
