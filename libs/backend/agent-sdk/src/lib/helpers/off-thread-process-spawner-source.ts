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
 * child processes through it — round trip, exit, kill, abort and ENOENT — so a
 * typo here fails the suite rather than shipping.
 *
 * **Constraints on edits.** The literal is a `String.raw` template, so the
 * program text must contain no backticks and no `${` sequence or it stops being
 * a string and starts being an interpolation. Use `'a' + b` concatenation.
 *
 * Protocol (see `off-thread-process-spawner.ts` for the typed mirror):
 *   host -> worker: { type: 'spawn', command, args, cwd, env, stderrMode,
 *                     detached, windowsHide, windowsVerbatimArguments }
 *                 | { type: 'stdin', chunk: Uint8Array }
 *                 | { type: 'stdin-end' }
 *                 | { type: 'kill', signal }
 *                 | { type: 'pause' } | { type: 'resume' }
 *   worker -> host: { type: 'spawned', pid }
 *                 | { type: 'stdout', chunk: Uint8Array }
 *                 | { type: 'stderr', text }
 *                 | { type: 'stderr-chunk', chunk: Uint8Array }
 *                 | { type: 'stdout-end' } | { type: 'stderr-end' }
 *                 | { type: 'exit', code, signal }
 *                 | { type: 'error', message, code, errno, syscall, path }
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
 * **`stdout-end` is posted exactly once, from either source.** A successful run
 * ends it when the pipe closes; a failed spawn (ENOENT) never emits `exit` at
 * all and its stdio stream is destroyed rather than ended, so the error handler
 * ends it too. The host tears the thread down only once it has seen both a
 * terminal event and `stdout-end`, so an end that never arrives would leak a
 * thread per failed launch.
 */
export const OFF_THREAD_SPAWNER_WORKER_SOURCE = String.raw`
const { parentPort } = require('node:worker_threads');
const { spawn } = require('node:child_process');

if (!parentPort) {
  throw new Error('off-thread spawner worker started without a parentPort');
}

let child = null;
let stdoutEnded = false;
let stderrEnded = false;
let streamStderr = false;
let pendingStdin = [];
let pendingEnd = false;
let pendingKill = null;

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

function endStdoutOnce() {
  if (stdoutEnded) return;
  stdoutEnded = true;
  parentPort.postMessage({ type: 'stdout-end' });
}

function endStderrOnce() {
  if (!streamStderr || stderrEnded) return;
  stderrEnded = true;
  parentPort.postMessage({ type: 'stderr-end' });
}

function writeStdin(chunk) {
  if (!child || !child.stdin || child.stdin.writableEnded) return;
  try {
    child.stdin.write(Buffer.from(chunk));
  } catch (err) {
    // A child that died mid-write is already reported through 'exit'/'error';
    // a second report from the stdin pipe adds nothing the host can act on.
  }
}

function endStdin() {
  if (!child || !child.stdin || child.stdin.writableEnded) return;
  try {
    child.stdin.end();
  } catch (err) {
    // Same reasoning as writeStdin.
  }
}

function killChild(signal) {
  if (!child) return;
  try {
    child.kill(signal || 'SIGTERM');
  } catch (err) {
    // ESRCH: the host's direct process.kill already reaped it.
  }
}

function startChild(message) {
  const stderrMode = message.stderrMode || 'ignore';
  streamStderr = stderrMode === 'stream';
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
    parentPort.postMessage(flattenError(err));
    endStdoutOnce();
    endStderrOnce();
    return;
  }

  parentPort.postMessage({
    type: 'spawned',
    pid: child.pid === undefined ? null : child.pid,
  });

  child.on('error', function (err) {
    parentPort.postMessage(flattenError(err));
    endStdoutOnce();
    endStderrOnce();
  });

  child.on('exit', function (code, signal) {
    parentPort.postMessage({ type: 'exit', code: code, signal: signal });
  });

  child.stdout.on('data', function (chunk) {
    const view = new Uint8Array(chunk);
    parentPort.postMessage({ type: 'stdout', chunk: view }, [view.buffer]);
  });
  child.stdout.on('end', endStdoutOnce);
  child.stdout.on('close', endStdoutOnce);
  child.stdout.on('error', endStdoutOnce);

  if (child.stderr) {
    if (streamStderr) {
      child.stderr.on('data', function (chunk) {
        const errView = new Uint8Array(chunk);
        parentPort.postMessage({ type: 'stderr-chunk', chunk: errView }, [
          errView.buffer,
        ]);
      });
      child.stderr.on('end', endStderrOnce);
      child.stderr.on('close', endStderrOnce);
      child.stderr.on('error', endStderrOnce);
    } else {
      child.stderr.on('data', function (chunk) {
        parentPort.postMessage({
          type: 'stderr',
          text: chunk.toString('utf8'),
        });
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

  const queued = pendingStdin;
  pendingStdin = [];
  for (let i = 0; i < queued.length; i++) writeStdin(queued[i]);
  if (pendingEnd) {
    pendingEnd = false;
    endStdin();
  }
  if (pendingKill) {
    const signal = pendingKill;
    pendingKill = null;
    killChild(signal);
  }
}

parentPort.on('message', function (message) {
  if (!message || typeof message !== 'object') return;
  switch (message.type) {
    case 'spawn':
      if (!child) startChild(message);
      return;
    case 'stdin':
      if (child) writeStdin(message.chunk);
      else pendingStdin.push(message.chunk);
      return;
    case 'stdin-end':
      if (child) endStdin();
      else pendingEnd = true;
      return;
    case 'kill':
      if (child) killChild(message.signal);
      else pendingKill = message.signal || 'SIGTERM';
      return;
    case 'pause':
      if (child && child.stdout) child.stdout.pause();
      return;
    case 'resume':
      if (child && child.stdout) child.stdout.resume();
      return;
    default:
      return;
  }
});
`;
