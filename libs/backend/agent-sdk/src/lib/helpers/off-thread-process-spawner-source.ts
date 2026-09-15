/**
 * The off-thread spawner worker's program text, carried as a string.
 *
 * **Why this worker exists at all.** `child_process.spawn` is not asynchronous
 * on Windows. libuv's `uv_spawn` calls `CreateProcessW` inline on the calling
 * thread, and Windows scans the target image while creating the process — so
 * the cost tracks the executable's SIZE. Measured on the reference machine:
 * `cmd.exe` 9 ms, `node.exe` ~700 ms, `claude.exe` (253 MB) 1850-1975 ms. The
 * Claude Agent SDK spawns the CLI inside `query()`'s SYNCHRONOUS prologue
 * (`ProcessTransport` constructor -> `initialize()` -> `spawnLocalProcess()`),
 * so every launch froze the Electron main process for ~1.6 s — ten times during
 * boot alone (TASK_2026_341). No spawn flag helps: `windowsHide`, `detached`
 * and the `stdio` shape all measured identical. A different THREAD is the only
 * lever, and `Options.spawnClaudeCodeProcess` is the only public seam the SDK
 * offers for taking it.
 *
 * **Why a string and not a `.ts` file.** Started with
 * `new Worker(source, { eval: true })`, so there is nothing to resolve on disk
 * and nothing to bundle. A real entry file would need a new esbuild target in
 * every host that runs an SDK query (`apps/ptah-electron`,
 * `apps/ptah-extension-vscode`, `apps/ptah-cli`) plus a host-implemented
 * factory port to hand the lib the emitted path. This is the same trade
 * `ts-diagnostics-worker-source.ts` documents in `workspace-intelligence`, and
 * it is worth taking for the same reason: the worker body is a thin pipe over
 * `child_process`, not a subsystem.
 *
 * **The trade this makes.** The body below is not type-checked or linted. It is
 * covered instead by `off-thread-process-spawner.spec.ts`, which drives real
 * child processes through it — round trip, exit, kill, abort, ENOENT and worker
 * reuse — so a typo here fails the suite rather than shipping.
 *
 * **Constraints on edits.** The literal is a `String.raw` template, so the
 * program text must contain no backticks and no `${` sequence or it stops being
 * a string and starts being an interpolation. Use `'a' + b` concatenation.
 *
 * Protocol (see `off-thread-process-spawner.ts` for the typed mirror). Every
 * message in both directions carries the `id` of the lease it belongs to:
 *   host -> worker: { type: 'spawn', id, command, args, cwd, env, stderrMode,
 *                     detached, windowsHide, windowsVerbatimArguments }
 *                 | { type: 'stdin', id, chunk: Uint8Array }
 *                 | { type: 'stdin-end', id }
 *                 | { type: 'kill', id, signal }
 *                 | { type: 'pause', id } | { type: 'resume', id }
 *   worker -> host: { type: 'spawned', id, pid }
 *                 | { type: 'stdout', id, chunk: Uint8Array }
 *                 | { type: 'stderr', id, text }
 *                 | { type: 'stderr-chunk', id, chunk: Uint8Array }
 *                 | { type: 'stdout-end', id } | { type: 'stderr-end', id }
 *                 | { type: 'exit', id, code, signal }
 *                 | { type: 'error', id, message, code, errno, syscall, path }
 *
 * **One worker serves many children, one at a time (TASK_2026_437 C12).** The
 * host keeps a small pool of these threads instead of paying a fresh V8 isolate
 * per spawn, so every `spawn` message builds a NEW per-child state object and
 * nothing about the previous child survives into it. The `id` keeps two
 * consecutive children apart: the previous child's listeners are closures over
 * ITS state and keep posting ITS id, which the host has already stopped
 * accepting, and a non-`spawn` host message whose id is not the current one is
 * dropped here. The host returns a worker to its pool only after the previous
 * child exited and its stdio drained, so a `spawn` never lands beside a live
 * child.
 *
 * **`stderrMode` selects which of the two stderr shapes the host wants.**
 * `'callback'` decodes each chunk here and posts `stderr` text — the SDK seam,
 * whose whole use of stderr is one classifier callback. `'stream'` posts the
 * raw bytes as `stderr-chunk` and ends with `stderr-end`, so the host can
 * expose a real `Readable`: the rival-CLI adapters call `setEncoding('utf8')`
 * on it, and decoding in the worker instead would split a multi-byte character
 * across two chunks. `'ignore'` never pipes stderr at all.
 *
 * **The Windows command is already resolved when it arrives.** `cross-spawn`'s
 * parser runs on the HOST and sends the resolved `command`, `args` and
 * `windowsVerbatimArguments`, so a `.cmd` wrapper works here with a plain
 * `child_process.spawn`. Do NOT add a `require('cross-spawn/...')` below: this
 * body is created with `new Worker(source, { eval: true })` and has no reliable
 * module resolution inside a bundled Electron app.
 *
 * **`error.code` must survive the trip.** The SDK's spawn-failure classifier
 * reads `error.code` (ENOENT / EACCES / EPERM / ENOTDIR / ELOOP / EROFS) to
 * decide whether to report "Claude Code executable not found" instead of a
 * generic transport failure. `Error` instances do not structured-clone their
 * own enumerable extras reliably, so the error is flattened into a plain object
 * here and rebuilt on the host.
 *
 * **`stdout-end` is posted exactly once per child, from either source.** A
 * successful run ends it when the pipe closes; a failed spawn (ENOENT) never
 * emits `exit` at all and its stdio stream is destroyed rather than ended, so
 * the error handler ends it too. The host releases the worker only once it has
 * seen both a terminal event and `stdout-end`, so an end that never arrives
 * would strand a thread per failed launch.
 */
export const OFF_THREAD_SPAWNER_WORKER_SOURCE = String.raw`
const { parentPort } = require('node:worker_threads');
const { spawn } = require('node:child_process');

if (!parentPort) {
  throw new Error('off-thread spawner worker started without a parentPort');
}

// The child this worker serves now. Replaced wholesale by every 'spawn'
// message, so a reused worker carries nothing over from the previous child.
let current = null;

function createState(message) {
  return {
    id: message.id,
    child: null,
    stdoutEnded: false,
    stderrEnded: false,
    streamStderr: message.stderrMode === 'stream',
    pendingStdin: [],
    pendingEnd: false,
    pendingKill: null,
  };
}

function send(state, message, transfer) {
  message.id = state.id;
  parentPort.postMessage(message, transfer);
}

function flattenError(err) {
  const source = err && typeof err === 'object' ? err : {};
  return {
    type: 'error',
    message:
      source.message === undefined ? String(err) : String(source.message),
    code: source.code === undefined ? undefined : String(source.code),
    errno: typeof source.errno === 'number' ? source.errno : undefined,
    syscall: source.syscall === undefined ? undefined : String(source.syscall),
    path: source.path === undefined ? undefined : String(source.path),
  };
}

function endStdoutOnce(state) {
  if (state.stdoutEnded) return;
  state.stdoutEnded = true;
  send(state, { type: 'stdout-end' });
}

function endStderrOnce(state) {
  if (!state.streamStderr || state.stderrEnded) return;
  state.stderrEnded = true;
  send(state, { type: 'stderr-end' });
}

function writeStdin(state, chunk) {
  const child = state.child;
  if (!child || !child.stdin || child.stdin.writableEnded) return;
  try {
    child.stdin.write(Buffer.from(chunk));
  } catch (err) {
    // A child that died mid-write is already reported through 'exit'/'error';
    // a second report from the stdin pipe adds nothing the host can act on.
  }
}

function endStdin(state) {
  const child = state.child;
  if (!child || !child.stdin || child.stdin.writableEnded) return;
  try {
    child.stdin.end();
  } catch (err) {
    // Same reasoning as writeStdin.
  }
}

function killChild(state, signal) {
  if (!state.child) return;
  try {
    state.child.kill(signal || 'SIGTERM');
  } catch (err) {
    // ESRCH: the host's direct process.kill already reaped it.
  }
}

function startChild(state, message) {
  const stderrMode = message.stderrMode || 'ignore';
  let child;
  try {
    child = spawn(message.command, message.args, {
      cwd: message.cwd,
      env: message.env,
      stdio: ['pipe', 'pipe', stderrMode === 'ignore' ? 'ignore' : 'pipe'],
      windowsHide: message.windowsHide !== false,
      detached: message.detached === true,
      windowsVerbatimArguments: message.windowsVerbatimArguments === true,
    });
  } catch (err) {
    send(state, flattenError(err));
    endStdoutOnce(state);
    endStderrOnce(state);
    return;
  }
  state.child = child;

  send(state, {
    type: 'spawned',
    pid: child.pid === undefined ? null : child.pid,
  });

  child.on('error', function (err) {
    send(state, flattenError(err));
    endStdoutOnce(state);
    endStderrOnce(state);
  });

  child.on('exit', function (code, signal) {
    send(state, { type: 'exit', code: code, signal: signal });
  });

  const onStdoutEnd = function () {
    endStdoutOnce(state);
  };
  child.stdout.on('data', function (chunk) {
    const view = new Uint8Array(chunk);
    send(state, { type: 'stdout', chunk: view }, [view.buffer]);
  });
  child.stdout.on('end', onStdoutEnd);
  child.stdout.on('close', onStdoutEnd);
  child.stdout.on('error', onStdoutEnd);

  if (child.stderr) {
    if (state.streamStderr) {
      const onStderrEnd = function () {
        endStderrOnce(state);
      };
      child.stderr.on('data', function (chunk) {
        const errView = new Uint8Array(chunk);
        send(state, { type: 'stderr-chunk', chunk: errView }, [
          errView.buffer,
        ]);
      });
      child.stderr.on('end', onStderrEnd);
      child.stderr.on('close', onStderrEnd);
      child.stderr.on('error', onStderrEnd);
    } else {
      child.stderr.on('data', function (chunk) {
        send(state, { type: 'stderr', text: chunk.toString('utf8') });
      });
      child.stderr.on('error', function () {
        // Nothing to report: stderr is advisory logging only.
      });
    }
  }

  if (child.stdin) {
    child.stdin.on('error', function () {
      // A closed stdin pipe is normal teardown, not a process failure.
    });
  }

  const queued = state.pendingStdin;
  state.pendingStdin = [];
  for (let i = 0; i < queued.length; i++) writeStdin(state, queued[i]);
  if (state.pendingEnd) {
    state.pendingEnd = false;
    endStdin(state);
  }
  if (state.pendingKill) {
    const signal = state.pendingKill;
    state.pendingKill = null;
    killChild(state, signal);
  }
}

parentPort.on('message', function (message) {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'spawn') {
    current = createState(message);
    startChild(current, message);
    return;
  }
  const state = current;
  // A message for a lease this worker no longer serves is stale by definition.
  if (!state || message.id !== state.id) return;
  switch (message.type) {
    case 'stdin':
      if (state.child) writeStdin(state, message.chunk);
      else state.pendingStdin.push(message.chunk);
      return;
    case 'stdin-end':
      if (state.child) endStdin(state);
      else state.pendingEnd = true;
      return;
    case 'kill':
      if (state.child) killChild(state, message.signal);
      else state.pendingKill = message.signal || 'SIGTERM';
      return;
    case 'pause':
      if (state.child && state.child.stdout) state.child.stdout.pause();
      return;
    case 'resume':
      if (state.child && state.child.stdout) state.child.stdout.resume();
      return;
    default:
      return;
  }
});
`;
