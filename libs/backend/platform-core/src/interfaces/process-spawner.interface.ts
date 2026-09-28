/**
 * `IProcessSpawner` — the platform port for creating a child process without
 * blocking the calling thread.
 *
 * `child_process.spawn` is not asynchronous. libuv's `uv_spawn` runs
 * `CreateProcessW` inline on the calling thread, and Windows scans the target
 * image while it creates the process, so the cost tracks the executable's SIZE.
 * The rival-CLI spawns measured 300-900 ms of event-loop lag each
 * (TASK_2026_367). A different THREAD is the only lever, so the spawn itself
 * has to move behind a port.
 *
 * The port is type-only and carries no DI token. `platform-core` therefore
 * gains no dependency on `agent-sdk`, on `cross-spawn` or on `child_process` —
 * only the `NodeJS.*` stream and signal types, which are ambient.
 *
 * **An implementation must resolve the command the way `cross-spawn` does.**
 * On Windows an npm-installed CLI is a `.cmd` wrapper that a bare `spawn`
 * refuses with EINVAL. Resolving it is the implementation's job, not the
 * caller's, so a caller can pass the same `command` on every platform.
 */

/**
 * File facts that must still hold at the instant the child is created
 * (TASK_2026_559 Lane K, closing review r2 finding 1).
 *
 * A spawner may create the process later and on another thread than the one
 * that decided to launch it. A caller whose authorization rests on files — a
 * consent record, the identity of the binary it approved — passes those facts
 * here, and the implementation re-checks them on the thread that creates the
 * process, immediately before creating it. If any fact no longer holds (or
 * cannot be read) no child is created and the handle reports `error` with
 * `code` {@link LAUNCH_GUARD_REFUSED}.
 *
 * Paths are absolute. Canonical paths are compared case-insensitively on
 * win32. A metadata check narrows the window to the moment of creation; it is
 * not an OS-level execution-identity guarantee against a writer of the
 * binary's own directory.
 */
export interface SpawnLaunchGuard {
  /** Files that must exist with exactly these bytes (SHA-256, hex). */
  readonly fileContents?: ReadonlyArray<{
    readonly path: string;
    readonly sha256: string;
  }>;
  /**
   * Paths whose canonical path must still be `realpath` and, when given,
   * whose `size` / `mtimeMs` (plain `stat`) and `devIno` (`${dev}:${ino}` of a
   * bigint `stat`; skipped when `null` or when the volume reports ino 0)
   * must still match.
   */
  readonly fileIdentities?: ReadonlyArray<{
    readonly path: string;
    readonly realpath: string;
    readonly size?: number;
    readonly mtimeMs?: number;
    readonly devIno?: string | null;
  }>;
}

/** The `error.code` of a spawn a {@link SpawnLaunchGuard} refused. */
export const LAUNCH_GUARD_REFUSED = 'ELAUNCHGUARD';

/** What to launch. One request produces at most one child. */
export interface ProcessSpawnRequest {
  /** The binary or wrapper to run. Resolved by the implementation. */
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  /** The child's complete environment. Keys whose value is `undefined` are dropped. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** POSIX: make the child a process-group leader so a tree kill can reach it. */
  readonly detached?: boolean;
  /** Windows: give the child its own hidden console. ConPTY needs one. */
  readonly needsConsole?: boolean;
  /**
   * Re-checked at the instant of creation; see {@link SpawnLaunchGuard}. An
   * implementation MUST honour it (or refuse the request); it must never
   * create the child without checking it.
   */
  readonly launchGuard?: SpawnLaunchGuard;
}

export type ProcessExitListener = (
  code: number | null,
  signal: NodeJS.Signals | null,
) => void;

export type ProcessErrorListener = (error: Error) => void;

/**
 * The caller's half of a spawned child.
 *
 * The shape is `ChildProcess`-like on purpose: every consumer already reads
 * `stdout`/`stderr`, ends `stdin` and waits for `close`, so an implementation
 * backed by a real `ChildProcess` needs no translation at the call site.
 *
 * `close` fires after the child exited AND its stdio drained — `exit` alone can
 * arrive with output still in flight. Consumers that read stdout must use
 * `close`.
 */
export interface SpawnedProcessHandle {
  readonly stdin: NodeJS.WritableStream | null;
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  /**
   * Resolves with the child's pid once the spawning thread reports it, or with
   * `null` if the child never started.
   *
   * A tree kill needs the real pid, and off the calling thread that pid is not
   * available when the handle is returned. `pid` is the synchronous read and is
   * `undefined` until then; `whenSpawned` is the one every tree-kill site awaits.
   */
  readonly whenSpawned: Promise<number | null>;
  readonly pid: number | undefined;
  readonly killed: boolean;
  readonly exitCode: number | null;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: 'exit' | 'close', listener: ProcessExitListener): void;
  on(event: 'error', listener: ProcessErrorListener): void;
  once(event: 'exit' | 'close', listener: ProcessExitListener): void;
  once(event: 'error', listener: ProcessErrorListener): void;
  off(event: 'exit' | 'close', listener: ProcessExitListener): void;
  off(event: 'error', listener: ProcessErrorListener): void;
}

export interface IProcessSpawner {
  /** Returns immediately. The child may not exist yet — see `whenSpawned`. */
  spawnProcess(request: ProcessSpawnRequest): SpawnedProcessHandle;
}
