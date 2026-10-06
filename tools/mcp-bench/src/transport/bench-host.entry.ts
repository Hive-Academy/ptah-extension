/**
 * `cli-headless` bench host: boots the CLI DI container and serves the
 * code-execution HTTP MCP from it.
 *
 * Why this process exists: `ptah mcp-serve` serves only the agent MVP tools
 * over stdio, and the CLI never starts the code-execution HTTP MCP (only the
 * Electron and VS Code hosts call `startCodeExecutionMcp`). This bench-owned
 * process makes the same `withEngine` full boot as `ptah mcp-serve`
 * (`apps/ptah-cli/src/cli/commands/mcp-serve.ts`), then starts the HTTP MCP
 * the desktop hosts start, so every call runs the real HTTP transport, the
 * protocol dispatcher and the CLI platform adapters. No product source is
 * changed; the scorecard labels the host `cli-headless`.
 *
 * Safety: it refuses to boot unless the launcher isolated it. `HOME` and
 * `USERPROFILE` must point at `PTAH_BENCH_ISOLATED_HOME` (so `os.homedir()`
 * resolves there), and `PTAH_CONFIG_PATH` and `PTAH_DB_PATH` must both lie
 * inside it, so neither the Ptah data directory nor the SQLite file can be
 * the user's real one.
 *
 * Wire contract (stdout is reserved for it; every log goes to stderr):
 *   ready: `{"benchHost":"ready","port":N,"workspaceRoot":"…","homedir":"…",
 *           "userDataPath":"…","dbPath":"…"}`
 *   fatal: `{"benchHost":"fatal","error":"…"}`, then a non-zero exit
 * Shutdown: stdin EOF, SIGTERM or SIGINT stops the MCP server and tears the
 * engine down. Usage: `node bench-host.mjs --workspace <absolute dir>`.
 */

import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';

import { CliDIContainer, withEngine } from '@ptah-extension/cli-engine';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import {
  TOKENS,
  startCodeExecutionMcp,
  type Logger,
} from '@ptah-extension/vscode-core';

/** The slice of `CodeExecutionMCP` the host drives (structural, as subsystem-bringup does). */
interface CodeExecutionMcpHandle {
  getPort(): number | null;
  disposeAsync(): Promise<void>;
}

interface WorkspaceProviderHandle {
  getWorkspaceRoot(): string | undefined;
  setConfiguration(section: string, key: string, value: unknown): Promise<void>;
}

interface IsolatedPaths {
  readonly home: string;
  readonly userDataPath: string;
  readonly dbPath: string;
}

const ENGINE_DRAIN_TIMEOUT_MS = 10_000;
const FORCED_EXIT_AFTER_MS = 20_000;

function writeWire(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function fail(error: string): never {
  writeWire({ benchHost: 'fatal', error });
  process.exit(1);
}

function isInside(path: string, root: string): boolean {
  const fold = (value: string): string =>
    process.platform === 'win32' ? value.toLowerCase() : value;
  const rel = relative(fold(resolve(root)), fold(resolve(path)));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function samePath(left: string, right: string): boolean {
  const fold = (value: string): string =>
    process.platform === 'win32'
      ? resolve(value).toLowerCase()
      : resolve(value);
  return fold(left) === fold(right);
}

/** Refuse to run unless every state path is inside the launcher's temp home. */
function readIsolation(): IsolatedPaths {
  const home = process.env['PTAH_BENCH_ISOLATED_HOME'];
  const userDataPath = process.env['PTAH_CONFIG_PATH'];
  const dbPath = process.env['PTAH_DB_PATH'];
  if (!home || !userDataPath || !dbPath) {
    fail(
      'refusing to boot: PTAH_BENCH_ISOLATED_HOME, PTAH_CONFIG_PATH and PTAH_DB_PATH must all be set by the launcher',
    );
  }
  if (!samePath(homedir(), home)) {
    fail(
      `refusing to boot: os.homedir() is ${homedir()}, not the isolated home ${home}`,
    );
  }
  if (!isInside(userDataPath, home) || !isInside(dbPath, home)) {
    fail(
      'refusing to boot: PTAH_CONFIG_PATH and PTAH_DB_PATH must lie inside the isolated home',
    );
  }
  return { home, userDataPath, dbPath };
}

function readWorkspaceArg(argv: readonly string[]): string {
  const index = argv.indexOf('--workspace');
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value || !isAbsolute(value)) {
    fail('usage: bench-host --workspace <absolute directory>');
  }
  try {
    if (!statSync(value).isDirectory()) fail(`not a directory: ${value}`);
  } catch (error: unknown) {
    fail(
      `workspace unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return resolve(value);
}

/** Resolves once on stdin EOF, SIGTERM or SIGINT. */
function shutdownRequested(): Promise<string> {
  return new Promise((done) => {
    process.stdin.once('end', () => done('stdin-eof'));
    process.stdin.once('close', () => done('stdin-eof'));
    process.once('SIGTERM', () => done('SIGTERM'));
    process.once('SIGINT', () => done('SIGINT'));
    process.stdin.resume();
  });
}

async function main(): Promise<void> {
  const isolation = readIsolation();
  const workspace = readWorkspaceArg(process.argv);
  const shutdown = shutdownRequested();
  // The engine teardown (Thoth, host runtime, container) is awaited below. If
  // any part of it hangs, the process still ends: exit 2 marks a forced exit.
  void shutdown.then(() => {
    setTimeout(() => process.exit(2), FORCED_EXIT_AFTER_MS).unref();
  });

  process.on('exit', () => {
    CliDIContainer.flushSync();
    CliDIContainer.disposeDiagnostics();
  });

  await withEngine(
    { cwd: workspace, config: isolation.userDataPath },
    // `oneshot` opens and migrates the (isolated) SQLite file so the symbol
    // and memory layers resolve, without the cron loop, the gateway or the
    // memory triggers a bench run must not start.
    { mode: 'full', requireSdk: false, thoth: 'oneshot' },
    async (ctx) => {
      const logger = ctx.container.resolve<Logger>(TOKENS.LOGGER);
      if (!ctx.container.isRegistered(TOKENS.CODE_EXECUTION_MCP)) {
        fail(
          'BLOCKER: TOKENS.CODE_EXECUTION_MCP is not registered in the CLI container',
        );
      }
      const workspaceProvider = ctx.container.resolve<WorkspaceProviderHandle>(
        PLATFORM_TOKENS.WORKSPACE_PROVIDER,
      );
      // Port 0: the OS picks a free port, so a running desktop Ptah holding
      // 51820 is never displaced and never answers in our place. Written to
      // the isolated config only.
      await workspaceProvider.setConfiguration('ptah', 'mcpPort', 0);

      await startCodeExecutionMcp({ container: ctx.container, logger });
      const mcp = ctx.container.resolve<CodeExecutionMcpHandle>(
        TOKENS.CODE_EXECUTION_MCP,
      );
      const port = mcp.getPort();
      if (port === null) {
        // `startCodeExecutionMcp` never throws; its warning is on stderr.
        fail('the code-execution MCP server did not start (see stderr)');
      }

      writeWire({
        benchHost: 'ready',
        port,
        workspaceRoot: workspaceProvider.getWorkspaceRoot() ?? workspace,
        homedir: homedir(),
        userDataPath: isolation.userDataPath,
        dbPath: isolation.dbPath,
      });

      const reason = await shutdown;
      process.stderr.write(`[bench-host] shutting down (${reason})\n`);
      await withTimeout(mcp.disposeAsync(), ENGINE_DRAIN_TIMEOUT_MS);
    },
  );
}

async function withTimeout(work: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      work,
      new Promise<void>((done) => {
        timer = setTimeout(done, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) =>
    fail(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    ),
);
