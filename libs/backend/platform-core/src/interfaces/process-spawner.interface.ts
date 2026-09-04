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
