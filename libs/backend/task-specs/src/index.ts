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
} from './lib/task-frontmatter';

// Pure helpers.
export { allocateTaskId } from './lib/id-allocator';
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
} from './lib/task-writer.service';
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

// DI.
export { TASK_SPECS_TOKENS, type TaskSpecsDIToken } from './lib/di/tokens';
export { registerTaskSpecsServices } from './lib/di/register';
