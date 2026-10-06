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
 * changed; the scorecard labels the host `cli-headless`. The boot itself is
 * `bootCodeExecutionHost` in `bench-host-boot.ts`.
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
import { isAbsolute, resolve } from 'node:path';

import { CliDIContainer } from '@ptah-extension/cli-engine';

import {
  BenchHostBootError,
  BenchIsolationError,
  assertIsolatedEnvironment,
  bootCodeExecutionHost,
} from './bench-host-boot';

const FORCED_EXIT_AFTER_MS = 20_000;

function writeWire(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function fail(error: string): never {
  writeWire({ benchHost: 'fatal', error });
  process.exit(1);
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

/** The fatal line: typed refusals keep their message; anything else its stack. */
function describeFailure(error: unknown): string {
  if (error instanceof BenchIsolationError) return error.message;
  if (error instanceof BenchHostBootError) {
    const cause: unknown = error.cause;
    if (cause instanceof Error && cause.stack) {
      process.stderr.write(`[bench-host] ${cause.stack}\n`);
    }
    return error.message;
  }
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}

async function main(): Promise<void> {
  // Checked before the arguments, as before the boot moved into the helper,
  // so an unisolated launch is refused whatever its arguments.
  assertIsolatedEnvironment();
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

  const host = await bootCodeExecutionHost({ workspace });
  writeWire({
    benchHost: 'ready',
    port: host.port,
    workspaceRoot: host.workspaceRoot,
    homedir: homedir(),
    userDataPath: host.isolation.userDataPath,
    dbPath: host.isolation.dbPath,
  });

  const reason = await shutdown;
  process.stderr.write(`[bench-host] shutting down (${reason})\n`);
  await host.stop();
}

main().then(
  () => process.exit(0),
  (error: unknown) => fail(describeFailure(error)),
);
