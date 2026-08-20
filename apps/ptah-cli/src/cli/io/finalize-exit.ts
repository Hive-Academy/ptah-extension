/**
 * The one-shot CLI's terminal step: flush stdout, then exit with the code the
 * command resolved.
 *
 * ## Why this exists
 *
 * `main()` used to set `process.exitCode` and return, leaving the process to
 * end when the event loop drained. For a `commander` router over a 27-lib DI
 * graph that never happens. Measured on this repo (`node --experimental` probe
 * over `dist/apps/ptah-cli/main.mjs`, `process.getActiveResourcesInfo()` 30s
 * after the command finished writing its output): every `withEngine({ mode:
 * 'full' })` command leaves an `FSEventWrap` alive — a chokidar watcher from
 * `CliFileSystemProvider.createFileWatcher`, opened by the agent/command
 * discovery services in `workspace-intelligence`. `container.clearInstances()`
 * drops tsyringe's references to those singletons; it does not call `dispose()`
 * on them, and nothing else does either.
 *
 * That reproduced as `ptah doctor --json` printing a complete, correct
 * `doctor.report` and then hanging until the caller's timeout killed it — a
 * scripted or CI consumer reads the JSON and then waits forever for EOF.
 *
 * ## Why a backstop rather than chasing the handles
 *
 * Those watchers are correct for a long-running host (Electron, the extension,
 * `ptah interact`, `ptah tui`) and wrong only for a process whose whole life is
 * one command. Disposing each one is a per-lib audit that regresses the moment
 * a 28th lib opens a 3rd watcher, and it is not enforceable by any test that
 * does not boot the real container. Exiting deterministically is one rule, in
 * one place, that cannot rot.
 *
 * It is also not a new idea in this CLI — `session start --once`, `interact`
 * and `mcp-serve` each already race a drain against a cap and call
 * `process.exit`. This is that same step, hoisted so the OTHER thirty
 * subcommands get it too.
 *
 * ## Ordering
 *
 * Drain first, always. Windows pipes accept writes asynchronously, so exiting
 * on the tick a notification was written truncates it. The drain is raced
 * against a cap because a consumer that has stopped reading must not be able to
 * hang the exit path we added to stop hangs.
 *
 * `main.ts` registers `process.on('exit', CliDIContainer.flushSync)`, which
 * still runs under `process.exit()` — pending settings writes are not lost.
 */

/** Cap on the stdout drain. Matches `session start --once`. */
export const DEFAULT_DRAIN_TIMEOUT_MS = 5_000;

interface DrainableStream {
  write(chunk: string, callback: () => void): unknown;
}

interface StderrLike {
  write(chunk: string): unknown;
}

export interface FinalizeExitOptions {
  /** Override the drain cap. */
  drainTimeoutMs?: number;
  /** Sink to drain — defaults to `process.stdout`. */
  stdout?: DrainableStream;
  /** Diagnostics sink — defaults to `process.stderr`. */
  stderr?: StderrLike;
  /** Exit hook — defaults to `process.exit`. */
  exit?: (code: number) => void;
}

/**
 * Normalize whatever landed on `process.exitCode` into a number.
 *
 * Node types it as `number | string | null | undefined`; commander and our own
 * router only ever assign numbers, but a string would silently become `NaN` and
 * then exit 0, turning a failed CI gate green.
 */
export function resolveExitCode(
  raw: number | string | null | undefined,
): number {
  if (typeof raw === 'number' && Number.isInteger(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isInteger(parsed)) return parsed;
  }
  return 0;
}

/**
 * Flush stdout (bounded) and exit with `code`. Resolves only if the injected
 * `exit` hook returns, which is what the spec relies on — the real
 * `process.exit` never does.
 */
export async function finalizeExit(
  code: number,
  options: FinalizeExitOptions = {},
): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
  const exit = options.exit ?? ((c: number): void => process.exit(c));

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const drained = new Promise<void>((resolve) => {
    stdout.write('', () => resolve());
  });
  const capped = new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(() => {
      stderr.write(
        `[ptah] stdout drain timeout (${drainTimeoutMs}ms); forcing exit\n`,
      );
      resolve();
    }, drainTimeoutMs);
  });

  try {
    await Promise.race([drained, capped]);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }

  exit(code);
}
