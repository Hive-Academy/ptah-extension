/**
 * DI Token Registry — Task Specs Tokens.
 *
 * Convention mirrors `libs/backend/skill-synthesis/src/lib/di/tokens.ts`:
 *  - Always `Symbol.for('Name')` (globally interned across bundles).
 *  - Each description globally unique.
 *  - Frozen `as const`.
 *
 * NOTE: the write-order seam token `TASK_INDEX_NOTIFIER_TOKEN` is declared in
 * `../task-index.port.ts` beside its interface (ISP), not here.
 */
export const TASK_SPECS_TOKENS = {
  /** TaskScannerService — folder scan → included tasks + typed exclusions. */
  TASK_SCANNER: Symbol.for('TaskSpecsScanner'),
  /** TaskWriterService — create + updateStatus (byte-preserving). */
  TASK_WRITER: Symbol.for('TaskSpecsWriter'),
  /** RegistryGeneratorService — deterministic registry.md table. */
  REGISTRY_GENERATOR: Symbol.for('TaskSpecsRegistryGenerator'),
  /** TaskIndexStore — SQLite derived index (Batch B). */
  TASK_INDEX_STORE: Symbol.for('TaskSpecsIndexStore'),
  /** TaskIndexService — lazy start + watcher + debounce (Batch B). */
  TASK_INDEX_SERVICE: Symbol.for('TaskSpecsIndexService'),
} as const;

export type TaskSpecsDIToken = keyof typeof TASK_SPECS_TOKENS;
