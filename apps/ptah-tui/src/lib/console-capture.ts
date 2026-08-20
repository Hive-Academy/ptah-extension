import * as fs from 'node:fs';

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace';

const CAPTURED_METHODS: readonly ConsoleMethod[] = [
  'log',
  'info',
  'warn',
  'error',
  'debug',
  'trace',
];

type StderrWrite = typeof process.stderr.write;

function formatLine(method: ConsoleMethod, args: readonly unknown[]): string {
  const parts = args.map((arg) => {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return arg.stack ?? arg.message;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  });
  return `[${method}] ${parts.join(' ')}\n`;
}

export function installConsoleCapture(): () => void {
  if (process.env['PTAH_TUI_DEBUG'] === '1') {
    return () => undefined;
  }

  const logPath = process.env['PTAH_TUI_LOG'];
  const sink =
    logPath && logPath.length > 0
      ? (method: ConsoleMethod, args: readonly unknown[]): void => {
          try {
            fs.appendFileSync(logPath, formatLine(method, args));
          } catch {
            // a broken log path must never crash the TUI
          }
        }
      : (): void => undefined;

  const originals = new Map<ConsoleMethod, (...args: unknown[]) => void>();

  for (const method of CAPTURED_METHODS) {
    originals.set(method, console[method] as (...args: unknown[]) => void);
    console[method] = (...args: unknown[]): void => {
      sink(method, args);
    };
  }

  // Patching `console.*` alone is not enough: the engine bootstrap
  // (`withEngine`) and several backend services write straight to
  // `process.stderr`, which bypasses `console` entirely and corrupts the Ink
  // frame. Divert stderr to the same sink for the duration of the session.
  //
  // Only stderr is diverted. Ink renders through `process.stdout`, so patching
  // stdout here would swallow the UI itself.
  // Kept unbound so teardown restores the exact same function reference the
  // stream had before us.
  const originalStderrWrite: StderrWrite = process.stderr.write;

  const patchedStderrWrite = ((
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    maybeCallback?: (error?: Error | null) => void,
  ): boolean => {
    const text =
      typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    sink('error', [text.replace(/\n$/, '')]);

    const callback =
      typeof encodingOrCallback === 'function'
        ? encodingOrCallback
        : maybeCallback;
    // Report the write as fully flushed so callers that await drain proceed.
    if (typeof callback === 'function') {
      callback(null);
    }
    return true;
  }) as StderrWrite;

  process.stderr.write = patchedStderrWrite;

  return () => {
    for (const method of CAPTURED_METHODS) {
      const original = originals.get(method);
      if (original) {
        console[method] = original;
      }
    }
    // Only restore if nothing else re-patched stderr after us, so we never
    // clobber a later owner of the stream.
    if (process.stderr.write === patchedStderrWrite) {
      process.stderr.write = originalStderrWrite;
    }
  };
}
