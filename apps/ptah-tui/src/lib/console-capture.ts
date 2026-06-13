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

  return () => {
    for (const method of CAPTURED_METHODS) {
      const original = originals.get(method);
      if (original) {
        console[method] = original;
      }
    }
  };
}
