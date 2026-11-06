/** Host-side logging of what the search worker reports. */
import { rebuildWorkerError } from './search-worker-error';
import type { DroppedRowsReport, SearchWorkerOutbound } from './search-worker.protocol';
import type { CuratorLogger } from './sqlite-reader-deps.types';

const LOG_PREFIX = '[sqlite-search-worker]';

/** Log a worker `log` message at its own level on the host logger. */
export function forwardWorkerLog(
  logger: CuratorLogger,
  message: Extract<SearchWorkerOutbound, { kind: 'log' }>,
): void {
  const text = `${LOG_PREFIX} ${message.message}`;
  // A logged Error is rebuilt with the worker's stack and cause chain, so the
  // host logger receives a real Error, as everywhere else in the host.
  const detail = message.error ? rebuildWorkerError(message.error) : message.context;
  const args: unknown[] = detail === undefined ? [] : [detail];
  switch (message.level) {
    case 'debug':
      logger.debug(text, ...args);
      return;
    case 'info':
      logger.info(text, ...args);
      return;
    case 'warn':
      logger.warn(text, ...args);
      return;
    case 'error':
      logger.error(text, detail);
      return;
  }
}

export function reportDroppedRows(logger: CuratorLogger, report: DroppedRowsReport): void {
  logger.warn(`${LOG_PREFIX} dropped result rows that failed validation`, {
    kind: report.kind,
    dropped: report.dropped,
    kept: report.kept,
    issue: report.issue,
    path: report.path,
  });
}
