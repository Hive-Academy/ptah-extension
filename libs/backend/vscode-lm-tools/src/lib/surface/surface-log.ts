/**
 * Non-throwing logging for surface state transitions (review F1, batch 10).
 *
 * The real `Logger` writes through `OutputManager.write`, which rethrows an
 * `appendLine` failure (`vscode-core/src/logging/logger.ts:269`,
 * `api-wrappers/output-manager.ts:147-151`). A log line sits between a
 * committed effect and its bookkeeping (ledger settlement, ticket return,
 * eviction pushes), so a throwing log call would leave an operation pending
 * forever or skip a push. Observability must never change the outcome of a
 * transition: a failed write is dropped here, and the transition completes.
 */
import type { Logger } from '@ptah-extension/vscode-core';

export type SurfaceLog = Pick<Logger, 'info' | 'warn' | 'debug'>;

type LogWrite = (message: string, ...args: unknown[]) => void;

function guarded(write: LogWrite): LogWrite {
  return (message, ...args) => {
    try {
      write(message, ...args);
    } catch (error: unknown) {
      // Dropped on purpose: the log channel failed, the state transition did
      // not. There is no other channel to report it on without the same risk.
      void error;
    }
  };
}

/** Wrap `logger` so that no call can throw into the caller. */
export function nonThrowingSurfaceLog(logger: SurfaceLog): SurfaceLog {
  return {
    info: guarded((message, ...args) => logger.info(message, ...args)),
    warn: guarded((message, ...args) => logger.warn(message, ...args)),
    debug: guarded((message, ...args) => logger.debug(message, ...args)),
  };
}
