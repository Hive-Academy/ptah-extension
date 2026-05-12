#!/usr/bin/env node
/**
 * Headless entry point for the `ptah` CLI binary.
 *
 * TASK_2026_104 Batch 2 — scaffold only. This file intentionally does NOT
 * bootstrap the DI container at module load. Each subcommand decides whether
 * (and when) to call `CliDIContainer.setup()` (typically via the `withEngine`
 * helper added in Batch 4 at `src/cli/bootstrap/with-engine.ts`); that wiring
 * lands in Batches 5-6.
 *
 * The router (`src/cli/router.ts`) parses `--verbose` as part of
 * `GlobalOptions`. Each command receives the resolved globals object and is
 * expected to forward `globals.verbose` into `withEngine(globals, ...)` so
 * the DI container emits `debug.di.phase` notifications. No call sites exist
 * yet — Batch 4 only prepares the propagation surface.
 *
 * Responsibilities for this batch:
 *   1. Install SIGINT/SIGTERM handler stubs that exit with the conventional
 *      Unix codes (130 / 143).
 *   2. Build the commander router and dispatch via `parseAsync(process.argv)`.
 *   3. Catch any uncaught error, print it to stderr, and exit 1.
 */

// MUST be the first import. tsyringe requires the reflect polyfill loaded
// before any decorated class is touched, and esbuild preserves import order.
import 'reflect-metadata';

import { fixPath } from '@ptah-extension/agent-sdk';
import { buildRouter } from './cli/router.js';
import { JSONRPC_SCHEMA_VERSION } from './cli/jsonrpc/types.js';
import { CliDIContainer } from './di/container.js';

// Repair process.env.PATH on Linux/macOS for parity with the Electron app
// and the VS Code extension. Most CLI invocations inherit PATH from the
// invoking shell (so this is a no-op), but the binary may also be launched
// from non-interactive contexts (cron, systemd units, A2A bridges spawned
// from GUI parents) where ~/.bashrc / ~/.zshrc were not sourced and
// npm-global / nvm bins are missing — those paths cause CLI agent
// detection to falsely report Gemini / Codex / Copilot as not installed.
// Idempotent; no-op on Windows.
fixPath();

let shuttingDown = false;

function installSignalHandlers(): void {
  const onSignal = (signal: 'SIGINT' | 'SIGTERM', exitCode: number) => () => {
    if (shuttingDown) {
      // Second signal — bail hard without waiting for the event loop.
      process.exit(exitCode);
      return;
    }
    shuttingDown = true;
    process.stderr.write(`\n[ptah] received ${signal}, exiting\n`);
    // Set the intended exit code then let the event loop drain naturally.
    // The synchronous 'exit' handler registered below will call flushSync()
    // before the process terminates, ensuring pending settings writes land on disk.
    process.exitCode = exitCode;
    // Return — do NOT call process.exit() here. Letting the event loop finish
    // means the 'exit' event fires synchronously, which is the only safe place
    // to call synchronous fs operations (flushSync).
  };

  process.on('SIGINT', onSignal('SIGINT', 130));
  process.on('SIGTERM', onSignal('SIGTERM', 143));

  // Synchronous exit hook — guaranteed to fire on all exit paths:
  // clean exit, process.exit(), and unhandled-rejection crashes.
  // flushSync() uses fs.writeFileSync + fs.renameSync and never throws.
  process.on('exit', () => {
    CliDIContainer.flushSync();
  });
}

/**
 * Stream B item #11 — schema version skew check.
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

  // Honour `--quiet` (set on root program) without parsing the full argv.
  // Commander will still process the flag normally below; this is a
  // best-effort early read that avoids importing the router twice.
  if (process.argv.includes('--quiet') || process.argv.includes('-q')) {
    return;
  }

  // Fully suppress under NO_COLOR — hosts that disable ANSI almost always
  // also want stderr free of warning chatter (CI logs, A2A bridges).
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
  installSignalHandlers();
  checkSchemaVersionSkew();

  try {
    const router = buildRouter();
    await router.parseAsync(process.argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[ptah] fatal: ${message}\n`);
    if (error instanceof Error && error.stack) {
      process.stderr.write(`${error.stack}\n`);
    }
    process.exit(1);
  }
}

void main();
