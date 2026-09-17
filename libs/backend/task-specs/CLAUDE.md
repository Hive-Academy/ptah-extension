# @ptah-extension/task-specs

[Back to Main](../../../CLAUDE.md)

## Purpose

Owns the `.ptah/specs/TASK_YYYY_NNN_xxxx/task.md` frontmatter contract for the Ptah task-management system (TASK_2026_157). Files are the source of truth; this lib parses/serializes the frontmatter carrier, scans folders into included tasks vs. typed exclusions, generates the derived `registry.md`, and writes task carriers. The SQLite derived index + file watcher (Batch B) ride on top of the same services.

**No legacy support** (phase-1 decision): folders without a valid `task.md` are EXCLUDED (counted + logged, never inferred, never emoji-parsed). The parser NEVER throws past its boundary.

## Boundaries

**Belongs here**:

- Frontmatter parse/serialize (`task-frontmatter.ts`) — pure, Zod at the file boundary only
- Folder scan (`task-scanner.service.ts`), task writes (`task-writer.service.ts`)
- Deterministic registry generation (`registry-generator.service.ts`)
- Pure helpers: `id-allocator.ts`, `id-suffix.ts`, `normalize-workspace-root.ts`
- SQLite derived index store + watcher/debounce service (Batch B)
- The cross-checkout visibility seam (`task-folder-visibility.port.ts`) and its one git-backed implementation (`git-task-folder-visibility.service.ts`)

**Does NOT belong**:

- RPC surface (`TasksRpcHandlers` lives in `rpc-handlers`)
- Frontend rendering (`tasks-ui`)
- Platform adapters or `agent-sdk` — this lib depends on ports only

## Public API

Parser: `parseTaskFile`, `updateFrontmatter`, `TaskFrontmatterSchema`, `TaskFrontmatter`, `ParseTaskFileResult`.
Helpers: `allocateTaskId`, `randomIdSuffix`, `TASK_ID_SUFFIX_RE`, `normalizeWorkspaceRoot`.
Services: `TaskScannerService` (+ `TaskScanResult`, `ScannedTask`), `TaskWriterService` (+ `CreateTaskInput`, `CreateTaskResult`, `UpdateStatusResult`), `RegistryGeneratorService` (+ `GenerateRegistryResult`).
Seams: `ITaskIndexNotifier`, `TASK_INDEX_NOTIFIER_TOKEN`, `NoOpTaskIndexNotifier`; `ITaskFolderVisibility`, `TASK_FOLDER_VISIBILITY_TOKEN`, `NoOpTaskFolderVisibility`, `GitTaskFolderVisibility`.
DI: `TASK_SPECS_TOKENS`, `TaskSpecsDIToken`, `registerTaskSpecsServices`.

## Internal Structure

- `src/lib/task-frontmatter.ts` — pure parse (`gray-matter` + Zod essentials) + byte-preserving splice writer
- `src/lib/task-scanner.service.ts` — `.ptah/specs/*/task.md` scan; never throws
- `src/lib/task-writer.service.ts` — create + updateStatus; file-mutation-first write order
- `src/lib/registry-generator.service.ts` — deterministic table, write-if-changed
- `src/lib/id-allocator.ts` — folder names + a suffix → next `TASK_YYYY_NNN_xxxx`; a malformed suffix throws rather than producing an unsafe path segment
- `src/lib/id-suffix.ts` — `randomIdSuffix()` (two `randomBytes` → four lowercase hex chars, no slicing and no modulo bias) + `TASK_ID_SUFFIX_RE`. A separate file so `id-allocator.ts` keeps zero I/O and stays trivially pure
- `src/lib/normalize-workspace-root.ts` — single canonical workspace-root key
- `src/lib/task-index.port.ts` — write-order seam (`ITaskIndexNotifier` + NoOp)
- `src/lib/task-folder-visibility.port.ts` — cross-checkout seam (`ITaskFolderVisibility` + NoOp). Contract: **never throws** — an unreachable source contributes nothing
- `src/lib/git-task-folder-visibility.service.ts` — the ONE place this subsystem talks to git; also the two pure parsers `specFolderNamesFromLsTree` and `specDirsFromWorktreeList`
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
- **An id is allocated from the UNION, and the union is fetched once per `create`.** `TaskWriterService.create` calls `ITaskFolderVisibility.listBeyondWorkspace` ONCE, before the retry loop, and unions the result with a FRESH local `readDirectory` on every attempt. The split is not symmetry for its own sake: the local re-scan is what makes the retry converge (the winner of the race just lost is visible to the next allocation), while the external half cannot change inside a five-attempt loop and each fetch may cost three git spawns. Draw a fresh `randomIdSuffix()` per attempt too — a reused suffix re-proposes the identical id and loses the same race again. `MAX_CREATE_ATTEMPTS` and the exclusive `createDirectoryExclusive` claim are still the correctness guarantee; the union only stops the claim from being contended across checkouts, which the local scan alone could not see because `.ptah/**` is gitignored.
- **`GitTaskFolderVisibility` never throws, on any of its five branches**, and each guarded catch carries BOTH a `// degradation-audit: reported — <code>` marker and one reporter call whose `code` is a string literal (`vscode-core/CLAUDE.md`, "Counting a degradation"). A `worktree list` failure also SKIPS the remote steps — a directory that is not a repository cannot have `origin/main`. A `fetch` failure does NOT skip `ls-tree`: a stale remote view is strictly better than none. `DegradationSource` has no `tasks` member and must not be widened for these codes; `'workspace'` is the honest fit.
- **The off-thread spawner is reached by MIRRORED SYMBOL, never by import.** `Symbol.for('SdkProcessSpawner')` must match `agent-sdk`'s `SDK_TOKENS.SDK_PROCESS_SPAWNER` character for character, and is injected `{ isOptional: true }` so this lib gains no `agent-sdk` edge and VS Code / the CLI keep `execGit`'s inline path. A typo does not fail loudly — it resolves `null` and every git call runs `CreateProcessW` on the Electron main thread again — so the description is pinned as a string literal in `git-task-folder-visibility.service.spec.ts`.
- **The specs watcher is scoped to its root** — `createFileWatcher('.ptah/specs/**', { cwd: root })`,
  one watcher per workspace. Not a bare cross-workspace glob: `extractFolder`
  discards other roots' events anyway, and the `cwd` is what lets every adapter
  resolve the pattern exactly (`RelativePattern` in VS Code, a concrete
  directory in the chokidar-backed adapters).
- `catch (error: unknown)`, narrow with `instanceof Error`.

## Cross-Lib Rules

Consumed by `rpc-handlers` (`rpc-handlers → task-specs`) and `skill-synthesis` (`skill-synthesis → task-specs`, shared parser) — both acyclic. Imports `platform-core`/`vscode-core`/`shared`/`persistence-sqlite` only. Frontend libs MUST NOT import this.
