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
// The ONE skill-drain job table. Exported because `cli-engine` registers the
// same three jobs through its own tier lifecycle and must not carry a second
// copy of the ids, handler names and cron-expression keys.
export {
  SKILL_DRAIN_JOBS,
  type SkillDrainJobSpec,
} from './lib/skill-drain-jobs';
export {
  createActivityEmitter,
  withActivityEmit,
  type ActivityEmitter,
} from './lib/activity-emitter';

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
