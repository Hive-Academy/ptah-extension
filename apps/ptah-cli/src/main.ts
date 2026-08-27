#!/usr/bin/env node
/**
 * Headless entry point for the `ptah` CLI binary.
 *
 * This file intentionally does NOT bootstrap the DI container at module load.
 * Each subcommand decides whether (and when) to call `CliDIContainer.setup()`
 * (typically via the `withEngine` helper at `src/cli/bootstrap/with-engine.ts`).
 *
 * The router (`src/cli/router.ts`) parses `--verbose` as part of
 * `GlobalOptions`. Each command receives the resolved globals object and is
 * expected to forward `globals.verbose` into `withEngine(globals, ...)` so
 * the DI container emits `debug.di.phase` notifications.
 *
 * Responsibilities:
 *   1. Install SIGINT/SIGTERM handler stubs that exit with the conventional
 *      Unix codes (130 / 143).
 *   2. Build the commander router and dispatch via `parseAsync(process.argv)`.
 *   3. Flush stdout and exit with the code the command resolved.
 *   4. Catch any uncaught error, print it to stderr, and exit 1.
 *
 * Step 3 is not decoration. Every `withEngine({ mode: 'full' })` command leaves
 * a live chokidar watcher behind (see `cli/io/finalize-exit.ts` for the
 * measurement), so waiting for the event loop to drain means waiting forever.
 * A one-shot CLI must exit on its own; `finalizeExit` is the single place that
 * makes it do so.
 */
import 'reflect-metadata';

import { fixPath } from '@ptah-extension/cli-agent-runtime';
import { buildRouter } from './cli/router.js';
import { finalizeExit, resolveExitCode } from './cli/io/finalize-exit.js';
import { JSONRPC_SCHEMA_VERSION } from './cli/jsonrpc/types.js';
import { CliDIContainer } from '@ptah-extension/cli-engine';
import { flushSessionMetadataStores } from '@ptah-extension/agent-sdk';
fixPath();

let shuttingDown = false;

/**
 * Suppress only the DEP0190 DeprecationWarning (child_process spawned with
 * `shell: true` and an args array), which the bundled SDK emits on every
 * SDK-touching command. It is harmless to the NDJSON stdout stream but noisy
 * on stderr for humans. Every other warning is re-emitted to Node's default
 * handler so genuine diagnostics still surface. The upstream fix belongs in
 * the SDK's spawn sites, which are out of scope for the CLI.
 */
function installDep0190Filter(): void {
  const isDep0190 = (warning: Error & { code?: string }): boolean =>
    warning.name === 'DeprecationWarning' && warning.code === 'DEP0190';

  const defaultHandler = (warning: Error): void => {
    process.stderr.write(`${warning.stack ?? warning.message}\n`);
  };

  process.removeAllListeners('warning');
  process.on('warning', (warning: Error & { code?: string }) => {
    if (isDep0190(warning)) return;
    defaultHandler(warning);
  });
}

function installSignalHandlers(): void {
  const onSignal = (signal: 'SIGINT' | 'SIGTERM', exitCode: number) => () => {
    if (shuttingDown) {
      process.exit(exitCode);
      return;
    }
    shuttingDown = true;
    process.stderr.write(`\n[ptah] received ${signal}, exiting\n`);
    // Started, not awaited — a signal handler is synchronous, and
    // `process.on('exit')` below is too late for an async storage write. This
    // is the head start; `main()` awaits the same call before `finalizeExit`,
    // which is where a signalled run actually ends (TASK_2026_324 finding 3).
    void flushSessionMetadataStores();
    // End the spawned CLI agent subprocesses, then the ptah-cli proxy leases
    // they were speaking through. A signalled run never reaches `withEngine`'s
    // `finally`, so without this the children of an interrupted `ptah` are
    // orphaned and their proxy sockets stay listening.
    //
    // THIS BELONGS IN THE SIGNAL HANDLER, NOT IN `exit` BELOW. `exit` is
    // synchronous end-to-end: Node runs the listener and then terminates
    // without turning the event loop, so anything after the first `await`
    // inside `disposeAll()` simply never happens. Only the synchronous prefix
    // — the `abort()` calls — would land there, and because the agent half is
    // awaited before the proxy half, an `exit`-path call would drop the proxy
    // teardown entirely. Here the awaits do complete, so both halves run in
    // the order that keeps a live child from being stranded on a dead proxy.
    //
    // Started, not awaited, for the same reason as the metadata flush above:
    // a signal handler cannot be async, and `main()` is already unwinding.
    void CliDIContainer.disposeHostRuntime();
    // Stop the event-loop sampler before we start unwinding. Its interval is
    // unref'd so it could never delay the exit, but leaving it running means
    // lag warnings interleaved with shutdown output for no diagnostic gain.
    CliDIContainer.disposeDiagnostics();
    process.exitCode = exitCode;
  };

  process.on('SIGINT', onSignal('SIGINT', 130));
  process.on('SIGTERM', onSignal('SIGTERM', 143));
  // Only synchronous work is useful here (see the note in `onSignal`).
  // `flushSync` writes settings straight to disk and `disposeDiagnostics`
  // clears an interval — both complete within the listener. Host-runtime
  // disposal is deliberately absent: the normal exit path already ran it
  // inside `withEngine`'s `finally`, and the signalled path ran it above.
  process.on('exit', () => {
    CliDIContainer.flushSync();
    CliDIContainer.disposeDiagnostics();
  });
}

/**
 * Schema version skew check.
 *
 * The host that spawned us (Electron, an A2A bridge, a CI driver) may set
 * `PTAH_HOST_SCHEMA_VERSION` to advertise the protocol version it speaks.
 * If that doesn't match `JSONRPC_SCHEMA_VERSION`, we surface a yellow
 * warning to stderr so the operator knows requests/notifications may be
 * mis-shaped. We do NOT abort — the CLI must still run for `doctor`-style
 * diagnostics to work after a host upgrade lands ahead of a CLI upgrade.
 *
 * Suppression rules:
 *   - `--quiet` (resolved via `process.argv.includes('--quiet')` since we
 *     run before `commander` parsing) silences the warning entirely.
 *   - `NO_COLOR` (any non-empty value) silences the warning entirely —
 *     hosts that disable ANSI typically also want clean stderr.
 *
 * The check runs once at process startup; subsequent skews mid-session
 * surface via `system.schema.version` notifications emitted by `interact`.
 */
function checkSchemaVersionSkew(): void {
  const hostVersion = process.env['PTAH_HOST_SCHEMA_VERSION'];
  if (!hostVersion || hostVersion === JSONRPC_SCHEMA_VERSION) return;
  if (process.argv.includes('--quiet') || process.argv.includes('-q')) {
    return;
  }
  const noColorEnv = process.env['NO_COLOR'];
  if (noColorEnv !== undefined && noColorEnv !== '') {
    return;
  }

  const noColor = process.env['PTAH_NO_TTY'] === '1';
  const colorOpen = noColor ? '' : '\u001b[33m';
  const colorClose = noColor ? '' : '\u001b[0m';
  process.stderr.write(
    `${colorOpen}[ptah] schema version skew: host='${hostVersion}' cli='${JSONRPC_SCHEMA_VERSION}'. ` +
      `JSON-RPC payloads may not match — upgrade one side.${colorClose}\n`,
  );
}

async function main(): Promise<void> {
  installDep0190Filter();
  installSignalHandlers();
  checkSchemaVersionSkew();

  try {
    const router = buildRouter();
    await router.parseAsync(process.argv);
    // Before `finalizeExit` calls `process.exit`: the session metadata store
    // coalesces a burst of writes into one update at the end of its queue
    // drain, and a CLI agent that exited on the last turn can still have its
    // reference staged. `process.on('exit')` cannot help — that hook is
    // synchronous and the write is not (TASK_2026_324 finding 3).
    await flushSessionMetadataStores();
    // Commands that own their own shutdown (`interact`, `mcp-serve`,
    // `session start --once`) have already exited by here; for everything else
    // this is the only thing that ends the process.
    await finalizeExit(resolveExitCode(process.exitCode));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[ptah] fatal: ${message}\n`);
    if (error instanceof Error && error.stack) {
      process.stderr.write(`${error.stack}\n`);
    }
    // The command threw AFTER doing real work — a failed turn still ran CLI
    // agents whose references are staged in the coalescing queue. This
    // `process.exit` skips the flush above, and `process.on('exit')` cannot
    // stand in for it: that hook is synchronous and the write is not
    // (TASK_2026_324 finding 3). Never let a flush failure replace the exit
    // code that reports the original fault.
    try {
      await flushSessionMetadataStores();
    } catch {
      // Best effort — the fatal error above is what the caller needs.
    }
    process.exit(1);
  }
}

void main();
