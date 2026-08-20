/**
 * Public barrel for `@ptah-extension/thoth-runtime`.
 *
 * Runtime-agnostic boot of the Thoth channel — SQLite, memory curator,
 * skill synthesis, code-symbol indexing, workspace file index, push bridges
 * and the cron scheduler. Hosts (Electron main, VS Code extension host,
 * headless CLI) own their own activation ordering and teardown; this library
 * owns only the Thoth lifecycle.
 *
 * Anything not re-exported here is internal and may change without notice.
 */
export { bootThothRuntime } from './lib/boot-thoth-runtime';
export { startThothCron } from './lib/start-thoth-cron';

export {
  DEFAULT_THOTH_LOG_PREFIX,
  emptyThothRuntimeRefs,
  type BootThothRuntimeOptions,
  type StartThothCronOptions,
  type ThothRuntimeRefs,
} from './lib/types';

export {
  emitVecLoadDiagnostic,
  resetVecLoadDiagnosticForTest,
  serializeEmbedderSnapshotForBridge,
  serializeVecDiagnosticForBridge,
} from './lib/diagnostics';
