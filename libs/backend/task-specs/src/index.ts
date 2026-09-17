/**
 * @ptah-extension/task-specs — public API.
 *
 * Owns the `.ptah/specs/TASK_YYYY_NNN/task.md` frontmatter contract: pure
 * parse/serialize, folder scan, deterministic registry generation, and task
 * writes. Files are the source of truth; the SQLite derived index + watcher
 * (Batch B) rides on top. Depends only on `shared`, `platform-core` (ports),
 * `vscode-core` (Logger), and `persistence-sqlite` — never adapters, never
 * agent-sdk, never frontend.
 */

// Pure parser / writer (frontmatter).
export {
  parseTaskFile,
  updateFrontmatter,
  TaskFrontmatterSchema,
  type TaskFrontmatter,
  type ParseTaskFileResult,
  type UpdateFrontmatterOptions,
} from './lib/task-frontmatter';

// Pure helpers.
export { allocateTaskId } from './lib/id-allocator';
export { randomIdSuffix, TASK_ID_SUFFIX_RE } from './lib/id-suffix';
export { normalizeWorkspaceRoot } from './lib/normalize-workspace-root';

// Services.
export {
  TaskScannerService,
  type ScannedTask,
  type TaskScanResult,
} from './lib/task-scanner.service';
export {
  TaskWriterService,
  type CreateTaskInput,
  type CreateTaskResult,
  type UpdateStatusResult,
  type UpdateMetadataInput,
  type UpdateMetadataResult,
  type AdoptFolderInput,
  type AdoptFolderResult,
} from './lib/task-writer.service';
export {
  TaskSweepService,
  type ISweepGitProbe,
} from './lib/task-sweep.service';
export {
  TaskDoctorService,
  type AdoptAction,
  type RenameBatchesAction,
  type DoctorAction,
  type DoctorWarning,
  type DoctorPlan,
  type DoctorPlanResult,
  type DoctorApplyResult,
  type DoctorUndoResult,
  type DoctorErrorCode,
  type DoctorJournal,
  type DoctorJournalEntry,
} from './lib/task-doctor.service';
export {
  RegistryGeneratorService,
  type GenerateRegistryResult,
} from './lib/registry-generator.service';

// Derived index store (SQLite + in-memory fallback).
export {
  SqliteTaskIndexStore,
  InMemoryTaskIndexStore,
  type ITaskIndexStore,
  type TaskIndexFilters,
  type TaskIndexMeta,
} from './lib/task-index.store';

// Index service (lazy start + watcher + debounce + onDidChangeIndex).
export {
  TaskIndexService,
  type TaskIndexChangeEvent,
  type ReindexResult,
  type IndexListResult,
} from './lib/task-index.service';

// Write-order seam (Batch B replaces the NoOp with TaskIndexService).
export {
  TASK_INDEX_NOTIFIER_TOKEN,
  NoOpTaskIndexNotifier,
  type ITaskIndexNotifier,
} from './lib/task-index.port';

// Cross-checkout visibility seam (TASK_2026_403). `NoOpTaskFolderVisibility` is
// exported because consumers that construct `TaskWriterService` directly — the
// CLI's spec command spec among them — need the null object as a fixture.
export {
  TASK_FOLDER_VISIBILITY_TOKEN,
  NoOpTaskFolderVisibility,
  type ITaskFolderVisibility,
} from './lib/task-folder-visibility.port';
export { GitTaskFolderVisibility } from './lib/git-task-folder-visibility.service';

// DI.
export { TASK_SPECS_TOKENS, type TaskSpecsDIToken } from './lib/di/tokens';
export { registerTaskSpecsServices } from './lib/di/register';
export { startTaskSpecsIndex } from './lib/di/start-index';
