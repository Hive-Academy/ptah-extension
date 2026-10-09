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
 *
 * Memory seeding: when `PTAH_BENCH_MEMORY_SEED` names the memory roots
 * (`readMemorySeedRoots`), the memory ground truth is inserted through the
 * product's memory store in `afterContainerReady`, inside this isolated host
 * and before the MCP server listens, so no call can race the seeding.
 */

import { homedir } from 'node:os';

import { CliDIContainer } from '@ptah-extension/cli-engine';
import type { MemoryStore } from '@ptah-extension/memory-curator';

import {
  buildMemoryQuestionSet,
  seedMemory,
} from '../ground-truth/memory-questions';
import {
  assertIsolatedEnvironment,
  bootCodeExecutionHost,
  type AfterContainerReadyHook,
} from './bench-host-boot';
import {
  BenchHostArgumentError,
  FORCED_EXIT_AFTER_MS,
  describeFailure,
  readWorkspaceArg,
  shutdownRequested,
} from './bench-host-process';
import {
  MemorySeedEnvError,
  readMemorySeedRoots,
  type MemorySeedRoots,
} from './memory-seed-env';

// `MEMORY_TOKENS.MEMORY_STORE`, by `Symbol.for` as `bench-host-boot.ts` keys
// the thoth registrations, so the entry stays off memory-curator's runtime.
const MEMORY_STORE = Symbol.for('PtahMemoryStore');

function seedMemoryHook(roots: MemorySeedRoots): AfterContainerReadyHook {
  return async (container) => {
    if (!container.isRegistered(MEMORY_STORE)) {
      throw new Error('the memory store is not registered; cannot seed');
    }
    const store =
      container.resolve<Pick<MemoryStore, 'insertMemoryWithChunks'>>(
        MEMORY_STORE,
      );
    const inserted = await seedMemory(store, buildMemoryQuestionSet(), roots);
    process.stderr.write(`[bench-host] seeded ${inserted.size} memory rows\n`);
  };
}

/** The seeding request; a malformed one is a fatal line, like a bad argument. */
function readSeedRequest(): MemorySeedRoots | null {
  try {
    return readMemorySeedRoots();
  } catch (error: unknown) {
    if (error instanceof MemorySeedEnvError)
      throw new BenchHostArgumentError(error.message);
    throw error;
  }
}

function writeWire(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function fail(error: string): never {
  writeWire({ benchHost: 'fatal', error });
  process.exit(1);
}

async function main(): Promise<void> {
  // Checked before the arguments, as before the boot moved into the helper,
  // so an unisolated launch is refused whatever its arguments.
  assertIsolatedEnvironment();
  // A bad argument throws BenchHostArgumentError; its message is the fatal
  // line (exit 1) through `describeFailure` below.
  const workspace = readWorkspaceArg(process.argv);
  const memorySeed = readSeedRequest();
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

  const host = await bootCodeExecutionHost({
    workspace,
    ...(memorySeed === null
      ? {}
      : { afterContainerReady: seedMemoryHook(memorySeed) }),
  });
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
