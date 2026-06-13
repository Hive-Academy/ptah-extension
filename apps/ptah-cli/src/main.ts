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
 *   3. Catch any uncaught error, print it to stderr, and exit 1.
 */
import 'reflect-metadata';

import { fixPath } from '@ptah-extension/cli-agent-runtime';
import { buildRouter } from './cli/router.js';
import { JSONRPC_SCHEMA_VERSION } from './cli/jsonrpc/types.js';
import { CliDIContainer } from '@ptah-extension/cli-engine';
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
    process.exitCode = exitCode;
  };

  process.on('SIGINT', onSignal('SIGINT', 130));
  process.on('SIGTERM', onSignal('SIGTERM', 143));
  process.on('exit', () => {
    CliDIContainer.flushSync();
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
