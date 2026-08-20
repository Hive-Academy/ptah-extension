# @ptah-extension/task-specs

[Back to Main](../../../CLAUDE.md)

## Purpose

Owns the `.ptah/specs/TASK_YYYY_NNN/task.md` frontmatter contract for the Ptah task-management system (TASK_2026_157). Files are the source of truth; this lib parses/serializes the frontmatter carrier, scans folders into included tasks vs. typed exclusions, generates the derived `registry.md`, and writes task carriers. The SQLite derived index + file watcher (Batch B) ride on top of the same services.

**No legacy support** (phase-1 decision): folders without a valid `task.md` are EXCLUDED (counted + logged, never inferred, never emoji-parsed). The parser NEVER throws past its boundary.

## Boundaries

**Belongs here**:

- Frontmatter parse/serialize (`task-frontmatter.ts`) — pure, Zod at the file boundary only
- Folder scan (`task-scanner.service.ts`), task writes (`task-writer.service.ts`)
- Deterministic registry generation (`registry-generator.service.ts`)
- Pure helpers: `id-allocator.ts`, `normalize-workspace-root.ts`
- SQLite derived index store + watcher/debounce service (Batch B)

**Does NOT belong**:

- RPC surface (`TasksRpcHandlers` lives in `rpc-handlers`)
- Frontend rendering (`tasks-ui`)
- Platform adapters or `agent-sdk` — this lib depends on ports only

## Public API

Parser: `parseTaskFile`, `updateFrontmatter`, `TaskFrontmatterSchema`, `TaskFrontmatter`, `ParseTaskFileResult`.
Helpers: `allocateTaskId`, `normalizeWorkspaceRoot`.
Services: `TaskScannerService` (+ `TaskScanResult`, `ScannedTask`), `TaskWriterService` (+ `CreateTaskInput`, `CreateTaskResult`, `UpdateStatusResult`), `RegistryGeneratorService` (+ `GenerateRegistryResult`).
Seam: `ITaskIndexNotifier`, `TASK_INDEX_NOTIFIER_TOKEN`, `NoOpTaskIndexNotifier`.
DI: `TASK_SPECS_TOKENS`, `TaskSpecsDIToken`, `registerTaskSpecsServices`.

## Internal Structure

- `src/lib/task-frontmatter.ts` — pure parse (`gray-matter` + Zod essentials) + byte-preserving splice writer
- `src/lib/task-scanner.service.ts` — `.ptah/specs/*/task.md` scan; never throws
- `src/lib/task-writer.service.ts` — create + updateStatus; file-mutation-first write order
- `src/lib/registry-generator.service.ts` — deterministic table, write-if-changed
- `src/lib/id-allocator.ts` — folder names → next `TASK_YYYY_NNN`
- `src/lib/normalize-workspace-root.ts` — single canonical workspace-root key
- `src/lib/task-index.port.ts` — write-order seam (`ITaskIndexNotifier` + NoOp)
- `src/lib/di/{tokens,register}.ts` — `TASK_SPECS_TOKENS`, `registerTaskSpecsServices`

## Dependencies

**Internal**: `@ptah-extension/shared`, `@ptah-extension/platform-core`, `@ptah-extension/vscode-core`, `@ptah-extension/persistence-sqlite` (Batch B store).
**External**: `gray-matter`, `zod`, `tsyringe`.

## Guidelines

- **File access via `IFileSystemProvider`** (platform-core) — never `node:fs` in services. Pure functions take strings (no I/O).
- **`parseTaskFile` never throws** — every failure is a typed exclusion. Essential fields (exclude on failure): `status`, `title`. Everything else degrades to a `validationIssue` warning; folder name wins over frontmatter `id`.
- **Byte-preservation**: `updateFrontmatter` rewrites ONLY the frontmatter block; the body (CRLF, `---` in code fences, trailing bytes) is copied through untouched.
- **Registry determinism**: no wall-clock in output — header freshness is `max(updated)` of included tasks.
- **Windows-safe paths**: always `path.join` + `normalizeWorkspaceRoot`.
- `catch (error: unknown)`, narrow with `instanceof Error`.

## Cross-Lib Rules

Consumed by `rpc-handlers` (`rpc-handlers → task-specs`) and `skill-synthesis` (`skill-synthesis → task-specs`, shared parser) — both acyclic. Imports `platform-core`/`vscode-core`/`shared`/`persistence-sqlite` only. Frontend libs MUST NOT import this.
