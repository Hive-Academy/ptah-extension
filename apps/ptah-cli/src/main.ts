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

import { buildRouter } from './cli/router.js';

let shuttingDown = false;

function installSignalHandlers(): void {
  const onSignal = (signal: 'SIGINT' | 'SIGTERM', exitCode: number) => () => {
    if (shuttingDown) {
      // Second signal — bail hard.
      process.exit(exitCode);
      return;
    }
    shuttingDown = true;
    // Defer the exit one tick so an in-flight stdout write can flush.
    process.stderr.write(`\n[ptah] received ${signal}, exiting\n`);
    setImmediate(() => process.exit(exitCode));
  };

  process.on('SIGINT', onSignal('SIGINT', 130));
  process.on('SIGTERM', onSignal('SIGTERM', 143));
}

async function main(): Promise<void> {
  installSignalHandlers();

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
