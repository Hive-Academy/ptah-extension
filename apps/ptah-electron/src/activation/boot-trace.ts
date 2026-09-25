import * as fs from 'fs';

/**
 * Start-up step markers for the path from `app.whenReady` to the renderer load
 * (TASK_2026_556).
 *
 * Written with `fs.writeSync(2, …)` rather than `console.*`: on Windows, stderr
 * connected to a pipe is asynchronous, so a line logged right before a stall
 * can sit unflushed and make the captured log lie about where boot stopped. A
 * synchronous write is on the pipe before the next statement runs.
 *
 * One short line per step, a dozen per boot — cheap enough to leave on. They
 * are what located the start-up stall this module was added for.
 */

/** The step that ends the boot window: the Angular renderer loaded. */
export const RENDERER_LOADED_STEP = 'renderer did-finish-load';

const bootStartedAt = Date.now();
let lastStep = '(none)';
let guards: { goal: string; dispose: () => void } | null = null;

function writeStderr(line: string): void {
  try {
    fs.writeSync(2, `${line}\n`);
  } catch {
    // stderr can be closed or absent: EPIPE once a harness is gone, EBADF in a
    // packaged Windows GUI build with no console. `writeSync` reports both as a
    // synchronous throw, so this catch is the whole of the guarantee that a
    // marker can never break the boot it describes.
  }
}

/**
 * Record and print a named start-up step. Reaching the goal of armed
 * {@link armBootGuards} disarms them.
 */
export function bootStep(step: string): void {
  lastStep = step;
  writeStderr(`[Ptah Boot +${Date.now() - bootStartedAt}ms] ${step}`);
  if (guards !== null && guards.goal === step) {
    disarmBootGuards();
  }
}

/** The most recent step passed to {@link bootStep}. */
export function lastBootStep(): string {
  return lastStep;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return typeof error.stack === 'string' && error.stack.length > 0
      ? error.stack
      : `${error.name}: ${error.message}`;
  }
  return String(error);
}

/**
 * Report a failure on the start-up path to stderr, synchronously, with the
 * last step reached and the stack. Never throws.
 */
export function reportBootFailure(context: string, error: unknown): void {
  writeStderr(
    `[Ptah Boot] ${context} (last step: ${lastStep}): ${describeError(error)}`,
  );
}

/** The slice of `process` the crash handlers attach to. Injectable for specs. */
export type BootProcessEvents = Pick<NodeJS.Process, 'on' | 'off'>;

export interface BootGuardOptions {
  /** The step whose `bootStep` call ends the boot window. */
  goal: string;
  /** How long before a missing `goal` is reported. */
  timeoutMs: number;
  /**
   * Ends the process after an uncaught exception during boot — a Sentry flush
   * then `app.exit` in production. Called on the next turn, after every other
   * `uncaughtException` listener has run. Required, not defaulted: continuing
   * after an uncaught exception is exactly the outcome these guards must never
   * produce.
   */
  exit: (code: number) => void;
  /** Defaults to the real `process`. */
  processEvents?: BootProcessEvents;
}

/**
 * Arm the boot window's guards: a watchdog and two process-level handlers.
 *
 * Scoped to the boot on purpose. The handlers exist so a failure between
 * `whenReady` and the renderer is never silent; left armed for the process's
 * lifetime they would replace Electron's default crash behaviour (and stop
 * Sentry's `OnUncaughtException` from exiting) for every later error too. They
 * come off at `bootStep(goal)` or {@link disarmBootGuards}, after which the
 * defaults apply again.
 *
 * - Watchdog: prints the last reached step if `goal` is not reached in
 *   `timeoutMs`. Diagnostics only, and `unref`'d so it never holds a quitting
 *   process open.
 * - `uncaughtException`: logs the step and error, lets the other listeners
 *   (Sentry) run, then exits non-zero — the default outcome, kept.
 * - `unhandledRejection`: logs only.
 *
 * Arming again replaces the previous guards.
 */
export function armBootGuards(options: BootGuardOptions): void {
  disarmBootGuards();
  const { goal, timeoutMs, exit } = options;
  const events = options.processEvents ?? process;

  const timer = setTimeout(() => {
    writeStderr(
      `[Ptah Boot] WATCHDOG: "${goal}" not reached after ${timeoutMs}ms (last step: ${lastStep})`,
    );
  }, timeoutMs);
  timer.unref?.();

  const onRejection = (reason: unknown): void => {
    reportBootFailure('UNHANDLED_REJECTION during boot', reason);
  };
  // The exit is deferred, not called here: this listener is armed before
  // Sentry initializes, so Sentry's own `uncaughtException` listener runs AFTER
  // it in the same emit. Exiting synchronously would kill the process before
  // Sentry captured the crash. `exit` is expected to flush Sentry itself.
  const onException = (error: unknown): void => {
    try {
      reportBootFailure('UNCAUGHT_EXCEPTION during boot', error);
    } finally {
      setImmediate(() => exit(1));
    }
  };
  events.on('unhandledRejection', onRejection);
  events.on('uncaughtException', onException);

  guards = {
    goal,
    dispose: () => {
      clearTimeout(timer);
      events.off('unhandledRejection', onRejection);
      events.off('uncaughtException', onException);
    },
  };
}

/**
 * Remove the boot guards, if armed — for a boot that ends without reaching its
 * goal (recovery shell, a start-up failure already reported).
 */
export function disarmBootGuards(): void {
  if (guards === null) return;
  const current = guards;
  guards = null;
  current.dispose();
}
