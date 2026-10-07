/**
 * Process helpers of a bench host script: its `--workspace` argument, its
 * shutdown signal, its fatal-line text and its forced-exit window. Shared by
 * `bench-host.entry.ts` and by other bench host scripts (TASK_2026_620's
 * memory-skills host) so they keep the same wire behaviour.
 *
 * Importing this module starts nothing: no listener, no stdin read, no exit.
 * The host script's `main()` calls these helpers and owns `process.exit` and
 * the wire lines.
 */

import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { BenchHostBootError, BenchIsolationError } from './bench-host-boot';

/** After a shutdown request, the host exits with code 2 if teardown has not ended by then. */
export const FORCED_EXIT_AFTER_MS = 20_000;

/** A bad `--workspace` argument; its message is the host's fatal line. */
export class BenchHostArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BenchHostArgumentError';
  }
}

/**
 * The absolute, resolved `--workspace <dir>` of `argv`. Throws
 * {@link BenchHostArgumentError} when it is missing, relative, unreadable or
 * not a directory.
 */
export function readWorkspaceArg(argv: readonly string[]): string {
  const index = argv.indexOf('--workspace');
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value || !isAbsolute(value)) {
    throw new BenchHostArgumentError(
      'usage: bench-host --workspace <absolute directory>',
    );
  }
  let isDirectory: boolean;
  try {
    isDirectory = statSync(value).isDirectory();
  } catch (error: unknown) {
    throw new BenchHostArgumentError(
      `workspace unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isDirectory)
    throw new BenchHostArgumentError(`not a directory: ${value}`);
  return resolve(value);
}

/** Resolves once on stdin EOF, SIGTERM or SIGINT. */
export function shutdownRequested(
  stdin: NodeJS.ReadableStream = process.stdin,
  signals: Pick<NodeJS.EventEmitter, 'once'> = process,
): Promise<string> {
  return new Promise((done) => {
    stdin.once('end', () => done('stdin-eof'));
    stdin.once('close', () => done('stdin-eof'));
    signals.once('SIGTERM', () => done('SIGTERM'));
    signals.once('SIGINT', () => done('SIGINT'));
    stdin.resume();
  });
}

/** The fatal line: typed refusals keep their message; anything else its stack. */
export function describeFailure(error: unknown): string {
  if (
    error instanceof BenchIsolationError ||
    error instanceof BenchHostArgumentError
  )
    return error.message;
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
