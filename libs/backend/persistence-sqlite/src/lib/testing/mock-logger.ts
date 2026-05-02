/**
 * Tiny Logger stub for spec files in this lib. Mirrors the public surface of
 * vscode-core's Logger that we actually call (debug/info/warn/error). We
 * cannot import the real Logger because it pulls in vscode-* APIs.
 */
import type { Logger } from '@ptah-extension/vscode-core';

export interface MockLogger extends Logger {
  readonly entries: {
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    context?: unknown;
  }[];
}

export function createMockLogger(): MockLogger {
  const entries: {
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    context?: unknown;
  }[] = [];
  const stub = {
    entries,
    debug: (message: string, context?: unknown) => {
      entries.push({ level: 'debug', message, context });
    },
    info: (message: string, context?: unknown) => {
      entries.push({ level: 'info', message, context });
    },
    warn: (message: string, context?: unknown) => {
      entries.push({ level: 'warn', message, context });
    },
    error: (message: string, context?: unknown) => {
      entries.push({ level: 'error', message, context });
    },
  } as unknown as MockLogger;
  return stub;
}
