# TASK_2026_464 — tasks:reindex timeout on Electron

## User report

On the Electron app, Tasks board → Reindex shows the red banner
`RPC timeout: tasks:reindex`. The workspace has ~230 task folders under `.ptah/specs/`.

## Verified findings (read-only investigation, checked against code)

1. **Timeout** — `libs/frontend/core/src/lib/services/claude-rpc.service.ts:135`
   defaults to `30000` ms. `libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts:1553-1556`
   calls `tasks:reindex` with no options, so a batch rebuild gets the same budget as a UI read.
2. **Serial scan** — `libs/backend/task-specs/src/lib/task-scanner.service.ts:120-128` awaits
   `scanFolder` one folder at a time. `scanFolder` (`:187-191`) calls `fs.exists(carrier)` then
   `fs.readFile(carrier)`: two file-system calls per folder where one would do.
   Only `task.md` is read; other files in a folder do not affect cost.
3. **Double rebuild** — `libs/backend/task-specs/src/lib/task-index.service.ts:263-274`
   `reindex()` awaits `ensureStarted(root)` and then always runs `rebuild(..., true)`.
   When the start latch was reset (`:180-192`, index not written because the SQLite connection
   was not open) or a start scan is in flight (`:160`), the user pays for two full scans.
4. **Duplicate board load** — after success, `tasks-store.service.ts:1561` calls `loadBoard()`,
   while the backend `fireChange({ reason: 'reindex' })` (`task-index.service.ts:554`) is
   broadcast as `tasks:changed` (`tasks-rpc.handlers.ts:305-307`) and also refreshes the board.

On Electron the file system is local Node.js, so ~460 local reads alone should not take 30s.
The Electron main process being busy (see TASK_2026_437) likely amplifies the serial scan.

## Scope

- `libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts` (+ spec)
- `libs/backend/task-specs/src/lib/task-scanner.service.ts` (+ spec)
- `libs/backend/task-specs/src/lib/task-index.service.ts` (+ spec)

## Acceptance criteria

1. `tasks:reindex` is called with an explicit, longer timeout (named constant, e.g. 120 000 ms).
2. The scanner makes one file-system call per folder for the carrier (`readFile`; a missing
   file maps to `no_carrier`, other errors to `unreadable`), keeping exclusion semantics.
3. Folders are scanned with bounded concurrency; result order stays deterministic
   (same order as `folderNames`), and `knownFolders` / cross-file issue logic is unchanged.
4. `reindex()` does not run a second full rebuild when `ensureStarted()` just performed one
   that wrote the index; it still emits the `reason: 'reindex'` change so boards refresh.
5. After a successful reindex the board is loaded once, not twice.
6. Specs cover each item; `npx nx run-many -t test -p @ptah-extension/task-specs @ptah-extension/tasks-ui`
   and typecheck/lint for the touched projects pass.

## Out of scope

- Changing the global RPC default timeout.
- Electron main-process scheduling (TASK_2026_437).
