/**
 * AcpProcessTransport — run one ACP agent child and present it as the byte
 * stream the SDK connects to (`AcpByteStream`) plus a small lifecycle API.
 *
 * This module knows nothing about ACP messages. It only moves bytes between
 * the child's stdio and web streams, so the runner can hand `stream` straight
 * to `connectAcp`:
 * - `readable` = the child's stdout bytes,
 * - `writable` = the child's stdin.
 *
 * Lifecycle rules carried over from the Pi adapter and PR #658:
 * - `getPid()` is live-only: `undefined` before the spawn resolves and after
 *   exit/error, because an exited pid can be reused by another process.
 * - `kill()` = end stdin (graceful), then `whenSpawned` → `killProcessTree`,
 *   and is idempotent.
 * - `exited` never rejects; a spawn error settles it with
 *   `{ code: null, signal: 'error' }`. An `error` event on a child that did
 *   start (e.g. a failed signal) is logged only: the child is still tracked,
 *   so `getPid()` and `kill()` keep working until it really exits.
 * - On `exit` the readable closes after {@link EXIT_DRAIN_GRACE_MS} even when
 *   stdout never reports `close` (a descendant that inherited the pipe keeps
 *   it open), so the SDK connection and any pending request settle.
 *
 * The factory returns synchronously even though the spawn is not: Windows
 * needs `resolveDirectSpawn` (async) before `spawnCli`, so early stdin writes
 * are queued and flushed once the child exists.
 */
import { killProcessTree } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  IProcessSpawner,
  ProcessErrorListener,
  ProcessExitListener,
  SpawnedProcessHandle,
} from '@ptah-extension/platform-core';
import {
  resolveDirectSpawn,
  spawnCli,
  stripAnsiCodes,
} from '../cli-adapter.utils';
import type { AcpByteStream } from './acp-sdk-loader';

/** How the child ended. `signal: 'error'` means the child never started. */
export interface AcpProcessExit {
  readonly code: number | null;
  readonly signal: string | null;
}

/** One live agent child presented as an SDK byte stream plus lifecycle. */
export interface AcpProcessTransport {
  /** The agent's streams, seen from the client: read stdout, write stdin. */
  readonly stream: AcpByteStream;
  /** The child's pid while it is alive, else `undefined` (PR #658 live-only rule). */
  getPid(): number | undefined;
  /** Resolves when the child ends. Never rejects. */
  readonly exited: Promise<AcpProcessExit>;
  /** Graceful stop then tree-kill. Idempotent. */
  kill(): void;
}

/** What {@link spawnAcpProcess} needs to create the child. */
export interface AcpSpawnOptions {
  /** The binary or wrapper to run. Windows `.cmd` wrappers are resolved. */
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** Merged over the inherited environment by `spawnCli`. */
  readonly env?: Readonly<Record<string, string>>;
  /** Creates the child off-thread (TASK_2026_367); inline `cross-spawn` otherwise. */
  readonly spawner?: IProcessSpawner;
  /** Receives each non-empty, ANSI-stripped stderr line. */
  readonly onStderrLine?: (line: string) => void;
  /** Receives spawn refusals and errors on a live child. */
  readonly logger?: Logger;
}

/** Injectable so specs can substitute an in-memory transport. */
export type AcpTransportFactory = (
  options: AcpSpawnOptions,
) => AcpProcessTransport;

/** A stderr line longer than this without a newline is truncated (64 KiB). */
const STDERR_MAX_LINE_CHARS = 64 * 1024;
/** Appended to a truncated stderr line so the gap is visible in logs. */
const STDERR_TRUNCATION_MARKER = ' …[truncated]';
/**
 * After `exit`, how long stdout may keep draining before the readable is
 * closed anyway. `close` normally arrives well within this.
 */
export const EXIT_DRAIN_GRACE_MS = 500;

/**
 * Start one ACP agent child. Returns synchronously; the child is created once
 * the (async) Windows `.cmd` resolution finishes. Stdin writes made before
 * then are queued and flushed in order.
 */
export const spawnAcpProcess: AcpTransportFactory = (
  options,
): AcpProcessTransport => {
  const onStderrLine = options.onStderrLine;
  const logger = options.logger;

  let child: SpawnedProcessHandle | undefined;
  /** Set once the child exited or errored (or the spawn itself failed). */
  let processGone = false;
  /** Set once `kill()` ran; a second call is a no-op. */
  let killRequested = false;
  /** The readable was closed (or cancelled), so never enqueue again. */
  let readableClosed = false;

  const encoder = new TextEncoder();
  const pendingWrites: Array<{ chunk: Uint8Array; resolve: () => void }> = [];
  /** stdout/stderr data listeners: removed on `close` or on a start failure. */
  const detachStreamListeners: Array<() => void> = [];
  /**
   * `exit`/`close` listeners and the no-op `error` guards on the child and its
   * pipes. Removed on `close` only: a stream that emits `error` with no
   * listener crashes the host, and `close` may still follow a start failure.
   */
  const detachLifecycleListeners: Array<() => void> = [];

  // --- readable: child stdout bytes ---------------------------------------

  let readableController:
    ReadableStreamDefaultController<Uint8Array> | undefined;
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      readableController = controller;
    },
    cancel() {
      readableClosed = true;
      readableController = undefined;
    },
  });

  const closeReadable = (): void => {
    if (readableClosed) return;
    readableClosed = true;
    try {
      readableController?.close();
    } catch {
      // Already closed by a `cancel()` racing this teardown.
    }
    readableController = undefined;
  };

  const onStdoutData = (chunk: string | Buffer): void => {
    if (readableClosed || !readableController) return;
    const bytes =
      typeof chunk === 'string' ? encoder.encode(chunk) : new Uint8Array(chunk);
    try {
      readableController.enqueue(bytes);
    } catch {
      // Reader cancelled between the guard and the enqueue.
      readableClosed = true;
    }
  };
  const onStdoutEnd = (): void => closeReadable();
  const onStdoutError = (): void => closeReadable();

  // --- stderr: line splitting with ANSI strip and 64 KiB truncation -------

  let stderrTail = '';
  /** Inside the discarded remainder of an oversized line, up to the newline. */
  let discardingOversizedLine = false;

  const emitStderrLine = (rawLine: string): void => {
    const line = stripAnsiCodes(rawLine.replace(/\r+$/, ''));
    if (line.trim().length === 0) return;
    onStderrLine?.(line);
  };

  const onStderrData = (chunk: string): void => {
    stderrTail += chunk;
    for (;;) {
      const newline = stderrTail.indexOf('\n');
      if (newline < 0) {
        if (discardingOversizedLine) {
          stderrTail = '';
          return;
        }
        if (stderrTail.length > STDERR_MAX_LINE_CHARS) {
          emitStderrLine(
            stderrTail.slice(0, STDERR_MAX_LINE_CHARS) +
              STDERR_TRUNCATION_MARKER,
          );
          discardingOversizedLine = true;
          stderrTail = '';
        }
        return;
      }
      const rawLine = stderrTail.slice(0, newline);
      stderrTail = stderrTail.slice(newline + 1);
      if (discardingOversizedLine) {
        // The rest of the oversized line; drop it and resume normal handling.
        discardingOversizedLine = false;
        continue;
      }
      if (rawLine.length > STDERR_MAX_LINE_CHARS) {
        // The same 64 KiB cap applied to a line that arrived complete, so
        // the marker does not depend on how the pipe chunked the bytes.
        emitStderrLine(
          rawLine.slice(0, STDERR_MAX_LINE_CHARS) + STDERR_TRUNCATION_MARKER,
        );
        continue;
      }
      emitStderrLine(rawLine);
    }
  };

  const onStderrEnd = (): void => {
    if (discardingOversizedLine) {
      discardingOversizedLine = false;
      stderrTail = '';
      return;
    }
    const rest = stderrTail;
    stderrTail = '';
    if (rest.length > STDERR_MAX_LINE_CHARS) {
      emitStderrLine(
        rest.slice(0, STDERR_MAX_LINE_CHARS) + STDERR_TRUNCATION_MARKER,
      );
    } else {
      emitStderrLine(rest);
    }
  };
  const onStderrError = (): void => {
    // A dead stderr pipe must not become an unhandled 'error' event.
  };
  const onStdinError = (): void => {
    // A dead stdin pipe must not become an unhandled 'error' event (Pi :399).
  };

  // --- lifecycle -----------------------------------------------------------

  let settleExited!: (exit: AcpProcessExit) => void;
  const exited = new Promise<AcpProcessExit>((resolve) => {
    settleExited = resolve;
  });

  let drainTimer: ReturnType<typeof setTimeout> | undefined;
  const clearDrainTimer = (): void => {
    if (drainTimer !== undefined) clearTimeout(drainTimer);
    drainTimer = undefined;
  };

  const onChildExit: ProcessExitListener = (code, signal) => {
    processGone = true;
    settleExited({ code, signal: signal ?? null });
    // 'close' normally follows once stdout drained. A descendant holding the
    // inherited stdout pipe delays it indefinitely, so stop waiting after a
    // short grace: the SDK connection then closes and a pending prompt fails.
    if (!readableClosed && drainTimer === undefined) {
      drainTimer = setTimeout(() => {
        drainTimer = undefined;
        closeReadable();
      }, EXIT_DRAIN_GRACE_MS);
    }
  };
  const onChildError: ProcessErrorListener = (error) => {
    if (processGone) return;
    const pid = child?.pid;
    if (pid !== undefined && child?.exitCode === null) {
      // A child that started and has not exited (e.g. a signal that could not
      // be delivered) is still running: keep its pid and listeners so
      // 'exit'/'close' settle it and kill() can still reach it.
      logger?.warn('[AcpProcessTransport] error on a running agent process', {
        pid,
        error: error.message,
      });
      return;
    }
    // The child never started (no pid), or a wrapper reported its start
    // failure in place of 'exit' (cross-spawn's ENOENT on Windows): no 'exit'
    // follows, so settle here. 'close' may still come and detaches the rest.
    logger?.error('[AcpProcessTransport] agent process failed to start', {
      command: options.command,
      error: error.message,
    });
    processGone = true;
    closeReadable();
    settleExited({ code: null, signal: 'error' });
    for (const detach of detachStreamListeners.splice(0)) detach();
  };
  const onChildClose: ProcessExitListener = () => {
    // 'close' fires after the stdio drained, so every stdout byte is enqueued
    // before the readable closes.
    clearDrainTimer();
    closeReadable();
    for (const detach of detachStreamListeners.splice(0)) detach();
    for (const detach of detachLifecycleListeners.splice(0)) detach();
  };

  const endStdin = (): void => {
    const stdin = child?.stdin;
    if (stdin?.writable) {
      try {
        stdin.end();
      } catch {
        // The child died between the guard and the end() — teardown owns it.
      }
    }
  };

  /** End stdin, then tree-kill via `whenSpawned` (works for inline and
   *  off-thread spawns alike; settles to null when the child never started). */
  const killChild = (): void => {
    endStdin();
    const target = child;
    if (!target) return;
    void target.whenSpawned.then((pid) => {
      if (pid !== null && pid !== undefined && !target.killed) {
        void killProcessTree(pid);
      }
    });
  };

  const kill = (): void => {
    if (killRequested) return;
    killRequested = true;
    killChild();
  };

  // --- writable: child stdin, buffered until the child exists --------------

  /** Set once `resolveDirectSpawn`/`spawnCli` refused the spawn outright. */
  let spawnFailed = false;

  /** Resolve on the first of 'drain', 'close' or 'error', then detach all three. */
  const resolveWhenDrained = (
    stdin: NodeJS.WritableStream,
    resolve: () => void,
  ): void => {
    const settle = (): void => {
      stdin.removeListener('drain', settle);
      stdin.removeListener('close', settle);
      stdin.removeListener('error', settle);
      resolve();
    };
    stdin.once('drain', settle);
    stdin.once('close', settle);
    stdin.once('error', settle);
  };

  const flushWrites = (): void => {
    for (;;) {
      const next = pendingWrites[0];
      if (!next) return;
      if (!child) {
        if (spawnFailed) {
          // No child will ever exist — drop the write, do not hang the SDK.
          pendingWrites.shift();
          next.resolve();
          continue;
        }
        // Still waiting for the async spawn resolution.
        return;
      }
      const stdin = child.stdin;
      pendingWrites.shift();
      let accepted = true;
      if (stdin?.writable) {
        try {
          accepted = stdin.write(next.chunk);
        } catch {
          // EPIPE mid-write; the no-op stdin 'error' listener owns the event.
        }
      }
      if (!accepted && stdin) {
        // Backpressure: hold the SDK's next write until the pipe drains, or
        // until stdin closes or fails (then the write is dropped as below).
        resolveWhenDrained(stdin, next.resolve);
        continue;
      }
      // A closed stdin (child exiting, or a write after exit) drops the write
      // instead of throwing into the SDK.
      next.resolve();
    }
  };

  let closeRequested = false;
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise<void>((resolve) => {
        pendingWrites.push({ chunk, resolve });
        flushWrites();
      });
    },
    close() {
      // The SDK closes the writable when the connection shuts down; ending
      // stdin lets a well-behaved agent exit on its own before any tree-kill.
      closeRequested = true;
      endStdin();
      return Promise.resolve();
    },
  });

  // --- the async spawn itself ----------------------------------------------

  const attachChild = (spawned: SpawnedProcessHandle): void => {
    child = spawned;
    const stdout = spawned.stdout;
    if (stdout) {
      stdout.on('data', onStdoutData);
      stdout.on('end', onStdoutEnd);
      stdout.on('close', onStdoutEnd);
      stdout.on('error', onStdoutError);
      detachStreamListeners.push(
        () => stdout.off('data', onStdoutData),
        () => stdout.off('end', onStdoutEnd),
        () => stdout.off('close', onStdoutEnd),
      );
      detachLifecycleListeners.push(() => stdout.off('error', onStdoutError));
    }
    const stderr = spawned.stderr;
    if (stderr) {
      // `setEncoding('utf8')` makes Node replace invalid byte sequences
      // instead of throwing, so garbage on stderr cannot crash the host.
      stderr.setEncoding('utf8');
      stderr.on('data', onStderrData);
      stderr.on('end', onStderrEnd);
      stderr.on('close', onStderrEnd);
      stderr.on('error', onStderrError);
      detachStreamListeners.push(
        () => stderr.off('data', onStderrData),
        () => stderr.off('end', onStderrEnd),
        () => stderr.off('close', onStderrEnd),
      );
      detachLifecycleListeners.push(() => stderr.off('error', onStderrError));
    }
    const stdin = spawned.stdin;
    if (stdin) {
      // Defensive no-op (Pi :399): an async EPIPE on a write into a dying
      // child emits 'error' on stdin; without a listener Node rethrows it.
      stdin.on('error', onStdinError);
      detachLifecycleListeners.push(() => stdin.off('error', onStdinError));
    }
    spawned.on('exit', onChildExit);
    spawned.on('error', onChildError);
    spawned.on('close', onChildClose);
    detachLifecycleListeners.push(
      () => spawned.off('exit', onChildExit),
      () => spawned.off('close', onChildClose),
      () => spawned.off('error', onChildError),
    );

    flushWrites();
    if (closeRequested) endStdin();
    if (killRequested) killChild();
  };

  void resolveDirectSpawn(options.command)
    .then((descriptor) => {
      attachChild(
        spawnCli(
          descriptor.command,
          [...descriptor.prefixArgs, ...options.args],
          {
            cwd: options.cwd,
            env: options.env,
            detached: true,
            spawner: options.spawner,
          },
        ),
      );
    })
    .catch((error: unknown) => {
      // `spawnCli` refused the command line outright — same contract as a
      // spawn 'error': settle, close, and drop anything queued for stdin.
      logger?.error('[AcpProcessTransport] agent process was not spawned', {
        command: options.command,
        error: error instanceof Error ? error.message : String(error),
      });
      spawnFailed = true;
      processGone = true;
      closeReadable();
      settleExited({ code: null, signal: 'error' });
      flushWrites();
    });

  return {
    stream: { readable, writable },
    getPid: () => (processGone ? undefined : child?.pid),
    exited,
    kill,
  };
};
