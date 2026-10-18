/**
 * Structural logger for this library.
 *
 * `platform-core` registers no logger token
 * (`libs/backend/platform-core/src/di/tokens.ts`). This library does not
 * import `vscode-core`. The host `Logger`
 * (`libs/backend/vscode-core/src/logging/logger.ts`) satisfies the interface:
 * `debug`, `info`, and `warn` accept `(message: string, ...args: unknown[])`,
 * and `error` accepts a string message plus an optional record.
 */
export type LaneRoutingLogMeta = Record<string, unknown>;

export interface LaneRoutingLogger {
  debug(message: string, meta?: LaneRoutingLogMeta): void;
  info(message: string, meta?: LaneRoutingLogMeta): void;
  warn(message: string, meta?: LaneRoutingLogMeta): void;
  error(message: string, meta?: LaneRoutingLogMeta): void;
}
