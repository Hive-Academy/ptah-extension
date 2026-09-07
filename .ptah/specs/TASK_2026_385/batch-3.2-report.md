# Backend implementation — `TASK_2026_385`, Batch 3.2

**Tasks completed**: Task 3.2 — launch the external editor from `file:open` (Electron)

## Files

- CREATED `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\file-open-rpc.schema.ts` — Zod schema `FileOpenRpcParamsSchema` (`path: string.min(1)`, `line?: positive int`) + `parseFileOpenParams`, returning `null` on malformed input.
- CREATED `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\file-open-rpc.handlers.ts` — `ElectronFileOpenRpcHandlers`, the new `file:open` binding.
- CREATED `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\file-open-rpc.handlers.spec.ts` — unit spec with a fake `IProcessSpawner`.
- MODIFIED `D:\projects\ptah-extension\apps\ptah-electron\src\rpc-host-profile.ts` — `'host.fileOpen'` now maps to `ElectronFileOpenRpcHandlers` (was `EditorRpcHandlers`).
- MODIFIED `D:\projects\ptah-extension\apps\ptah-electron\src\di\phase-4-handlers.ts` — `container.registerSingleton(ElectronFileOpenRpcHandlers)` added beside the `EditorRpcHandlers` factory registration; log line updated.
- MODIFIED `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\index.ts` — barrel export added.
- MODIFIED `D:\projects\ptah-extension\libs\frontend\chat-ui\src\lib\atoms\file-path-link.component.ts` — deleted the `isElectron` branch and `openFileInElectron`, leaving `void this.rpcService.openFile(filePath)` unconditionally. Removed the now-dead `VSCodeService`/`Injector` injections. This was the last `@ptah-extension/editor` import in `chat-ui` (confirmed via grep — none remain).
- MODIFIED `D:\projects\ptah-extension\eslint.config.mjs` — added `file-open-rpc.handlers.ts` to `APP_LOCAL_RPC_HANDLERS_PENDING_MIGRATION`. See "Lint-rule decision" below.

### Deviations beyond the batch's stated file list (both required for correctness, not drive-by cleanup)

- MODIFIED `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\editor-rpc.handlers.ts` — removed `registerFileOpen()` (and its call in `register()`). **Why this was necessary, not optional:** `resolveRpcHandlerPlan` (`libs/backend/rpc-handlers/src/lib/host-profile/register-rpc-surface.ts`) constructs one instance per manifest entry's resolved ctor, in manifest order, and calls `.register()` on each — which registers _every_ method that class's `register()` touches, not just the one manifest entry pulled it in for. `manifest.ts` orders the three host-owned entries `host.fileOpen` (360) → `host.editorRevert` (362) → `host.editorPane` (367). With the old `EditorRpcHandlers` still registering `'file:open'` internally, the plan would run `ElectronFileOpenRpcHandlers.register()` first (correct `file:open`), then hit `EditorRpcHandlers` for `host.editorRevert`, whose `register()` unconditionally called `registerFileOpen()` again — silently overwriting the new handler back to the old file-read behaviour on every boot. `EditorRpcHandlers` still owns `editor:openFile` untouched.
- MODIFIED `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\editor-rpc.handlers.spec.ts` — the exclusion-reachability suite iterated `['file:open', 'editor:openFile']` against `EditorRpcHandlers` directly; updated to `editor:openFile` only, since `file:open` moved. Same coverage (workspace-containment on `EditorRpcHandlers`'s own methods) is preserved; the new handler's containment path has its own spec.
- MODIFIED `D:\projects\ptah-extension\libs\frontend\chat-ui\src\lib\atoms\file-path-link.component.spec.ts` — dropped the `VSCodeService`/`isElectron` fixture and the Electron-path assertions, since the branch they tested no longer exists.

`manifest.ts:378` (the `{ key: 'host.fileOpen', methods: ['file:open'], requires: ['fileOpen'] }` entry) was left untouched, as instructed — only the binding and the stale duplicate registration moved.

## Containment + spawn design

- **Params**: `FileOpenRpcParamsSchema` (Zod) — `path` required non-empty string, `line` optional positive int. `parseFileOpenParams` returns `null` on anything malformed; the handler answers `{ success: false, error: 'path is required' }` rather than throwing.
- **Containment**: `isPathWithinRoots(parsed.path, this.workspace.getWorkspaceFolders())` (`platform-core/src/utils/path-containment.ts:71`, re-exported from the package root) runs before any spawn. Failure → `{ success: false, error: 'Path is outside the workspace' }`, no spawn, no `notifyFileOpened`.
- **Spawn**: `this.spawner.spawnProcess({ command: 'code', args: ['-g', line ? `${path}:${line}` : path], cwd: workspace.getWorkspaceRoot(), env: process.env, detached: process.platform !== 'win32', needsConsole: false })` via `@inject(SDK_TOKENS.SDK_PROCESS_SPAWNER)` — the same shape `cli-adapter.utils.ts:258-269` uses, including the `detached` platform guard. No shell string; `command` and `args` stay separate so `path` never reaches a shell interpolation. The child is never awaited; an `on('error')` listener logs at `warn`.
- **Notify**: `this.editorProvider.notifyFileOpened(parsed.path)` fires on the success path only (after `spawnProcess` returns without throwing), keeping the `ptah_ide` MCP tools and context auto-include alive per `electron-editor-provider.ts:49-53`.
- **Never throws**: the whole spawn + notify sequence is wrapped in `try/catch (error: unknown)`; a synchronous throw from `spawnProcess` (e.g. binary resolution failure) is caught, logged at `warn`, and returned as `{ success: false, error: message }`.

## Stack observed

- DI: `tsyringe` `@injectable()` / `@inject(...)` constructor injection, same pattern as `EditorRpcHandlers` in the same directory. `SDK_TOKENS.SDK_PROCESS_SPAWNER` confirmed already registered in Phase 2 (`phase-2-libraries.ts` → `registerSdkServices`) and resolvable from a Phase-4 handler (pinned by `apps/ptah-electron/src/di/container.smoke.spec.ts:236`).
- RPC transport: `RpcHandler.registerMethod<TParams, TResult>(name, handler)` requires a `Promise`-returning handler (`libs/backend/vscode-core/src/messaging/rpc-types.ts:66`) — `handleFileOpen` is declared `async` for that reason even though it never awaits.
- Validation: Zod 4, file-local `*.schema.ts` alongside the handler — matches the `rpc-handlers` convention (`git-rpc.schema.ts`, `update-rpc.schema.ts`) even though this handler lives in the app, not the lib.
- Manifest/dual-registration: `file:` is already in `ALLOWED_METHOD_PREFIXES` (`libs/backend/vscode-core/src/messaging/rpc-handler.ts:47`) and `file:open` is already a member of `RpcMethodName`/`RPC_METHOD_ENTRIES` (`libs/shared/src/lib/types/rpc.types.ts:681,3368`) and `manifest.ts:378` — no dual-registration edit needed, verified rather than assumed.

## Verification

- `npx nx run-many -t typecheck -p ptah-electron @ptah-extension/chat-ui` → `Successfully ran target typecheck for 2 projects` (both clean, no errors).
- `npx nx run-many -t test -p ptah-electron @ptah-extension/chat-ui` → header confirmed `Running target test for 2 projects`:
  - `ptah-electron:test` → `Test Suites: 1 skipped, 32 passed, 32 of 33 total` / `Tests: 4 skipped, 405 passed, 409 total`.
  - `@ptah-extension/chat-ui:test` → `Test Suites: 22 passed, 22 total` / `Tests: 123 passed, 123 total`.
- `npx nx run-many -t lint -p ptah-electron @ptah-extension/chat-ui` → `0 errors` on both projects (a handful of pre-existing, unrelated `max-lines`/`no-unused-vars`/`no-empty-function` warnings in other files). No `RpcHandlers`-naming lint error, confirming the `APP_LOCAL_RPC_HANDLERS_PENDING_MIGRATION` entry works.

## Lint-rule decision

`ClassDeclaration[id.name=/RpcHandlers$/]` under `apps/**` is a lint ERROR unless the file is in `APP_LOCAL_RPC_HANDLERS_PENDING_MIGRATION` (`eslint.config.mjs`). `ElectronFileOpenRpcHandlers` is deliberately app-local and Electron-only per the plan ("Deliberately minimal … `IEditorLauncher`/`EditorTarget[]` are TASK_2026_386"), the same reasoning that already grandfathers `EditorRpcHandlers` in this same directory. I added `apps/ptah-electron/src/services/rpc/handlers/file-open-rpc.handlers.ts` to the exception list rather than moving the class into `libs/backend/rpc-handlers`, because:

- The plan explicitly scopes this as a throwaway shape superseded by TASK_2026_386's `IEditorLauncher` design — moving it to the shared lib now means moving it again (or deleting it) in the very next task.
- VS Code explicitly keeps its own `FileRpcHandlers` for `file:open` (per the plan), so this is not yet a cross-host-shared namespace the way `rpc-handlers` classes are.
- `eslint.config.mjs` is outside this batch's assigned file list; documenting the choice here rather than silently absorbing an unrelated lint-error fix.

## Out-of-scope observations

- `tasks-store.service.ts:1362` (`openArtifact`) was noted in the plan as "fixed for free" by this change — not verified directly, out of this batch's file list.
- None else observed within the touched files.

## Fix pass

Addressed both BLOCKING findings, the SERIOUS finding, and both MODERATE findings from `batch-3.2-code-style-review.md` (62/100, NEEDS_REVISION) and `batch-3.2-code-logic-review.md` (68/100, NEEDS_REVISION). The `registerFileOpen()` deletion from `editor-rpc.handlers.ts` was confirmed correct by the logic reviewer and is unchanged.

### BLOCKING 1 (style) — relocated out of `apps/**`, eslint exception reverted

- DELETED `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\file-open-rpc.handlers.ts`, `...\file-open-rpc.schema.ts`, `...\file-open-rpc.handlers.spec.ts`.
- CREATED `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\file-open-rpc.schema.ts` (relocated, with the schema-message fix below).
- CREATED `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\file-open-rpc.handlers.ts` (relocated, with the spawn-confirmation fix below).
- CREATED `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\file-open-rpc.handlers.spec.ts` (relocated, plus the new async-failure case below).
- MODIFIED `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\index.ts` — added `export { ElectronFileOpenRpcHandlers } from './file-open-rpc.handlers';`.
- MODIFIED `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\index.ts` — added `ElectronFileOpenRpcHandlers` to the named re-export list from `./lib/handlers` (that barrel is explicit named exports, not `export *`, so the lib index needed its own line).
- MODIFIED `D:\projects\ptah-extension\eslint.config.mjs` — reverted `APP_LOCAL_RPC_HANDLERS_PENDING_MIGRATION` to its original 3 entries (the fourth entry from the first pass is gone).
- MODIFIED `D:\projects\ptah-extension\apps\ptah-electron\src\rpc-host-profile.ts` — `ElectronFileOpenRpcHandlers` is now imported from `@ptah-extension/rpc-handlers` instead of the local app directory. `hostHandlers['host.fileOpen']` is unchanged in shape — same key, same class, only the import source moved. `manifest.ts`'s `host.fileOpen` entry stays host-owned (no `handler:` field) and untouched, per the original batch instruction that only the binding moves — `host.fileOpen` is host-VARYING (VS Code supplies its own `FileRpcHandlers`, still app-local), unlike `FileSystemRpcHandlers`/`FilePickerRpcHandlers`, which are the SAME class on every host that turns the capability on. Making it a `handler:`-owned manifest entry would have been a manifest-shape change beyond the scope the coordinator described.
- MODIFIED `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\index.ts` — barrel export removed (class no longer lives here).
- MODIFIED `D:\projects\ptah-extension\apps\ptah-electron\src\di\phase-4-handlers.ts` — `ElectronFileOpenRpcHandlers` import moved into the `@ptah-extension/rpc-handlers` import block; `container.registerSingleton(ElectronFileOpenRpcHandlers)` moved next to `FileSystemRpcHandlers`/`FilePickerRpcHandlers`/`ImagePickerRpcHandlers` (Phase 4.1, the "shared" section) and added to that section's log list. The Phase 4.2 "capability-gated" log comment and list reverted to naming only `EditorRpcHandlers` — the count is back to one app-local handler class, so the top-of-file doc comment ("EditorRpcHandlers is the only handler class still declared in this app") is true again and needed no edit.

### BLOCKING 2 (logic) — spawn confirmation before answering, narrowed `try`

`file-open-rpc.handlers.ts`'s `handleFileOpen` now:

1. Calls `spawnProcess` inside a `try` that wraps ONLY the spawn call (MODERATE fix — `notifyFileOpened` is now outside the `try`, so its own future fallibility can never turn a real launch into a false `{success:false}`).
2. Attaches `handle.on('error', ...)` before waiting.
3. `await`s a new private `waitForSpawnConfirmation(handle)` — races `handle.whenSpawned` against a 3s bound (`SPAWN_CONFIRMATION_TIMEOUT_MS`) — before answering or calling `notifyFileOpened`.
4. If the confirmed pid is `null` (the port's own contract for "the child never started," which is also what a timeout resolves to), returns `{ success: false, error: spawnError?.message ?? 'Failed to launch the external editor' }` — the captured `'error'` event message if one arrived, otherwise a generic message.
5. Only on a confirmed pid does it call `notifyFileOpened` and return `{ success: true }`.

This is "await confirmation the child STARTED," not "await the child's exit" — the batch text's "do not await the child" is preserved; nothing here waits on `close`/`exit`. Never rejects: `waitForSpawnConfirmation` resolves (never throws) via `.then`/`.catch`, and both branches of `handleFileOpen` return a value.

### SERIOUS (logic) — spec now drives the real async failure shape

`file-open-rpc.handlers.spec.ts` gained `fakeFailingHandle(error)`, which returns a handle synchronously (like the real `OffThreadProcessSpawner`) whose `whenSpawned` resolves to `null` on a later microtask, firing the `'error'` listener first — mirroring `WorkerBackedProcess.fail()`'s actual order (`settleSpawned()` then `emit('error')`). New test: `'returns {success:false} — not an optimistic success — when the handle reports an async spawn failure, and never notifies'`, asserting `{success:false, error:'spawn code ENOENT'}` and that `notifyFileOpened` was NOT called. The original synchronous-throw test is kept (renamed to say "synchronously") since a synchronous throw is still a real, if rare, code path (`waitForSpawnConfirmation` is never reached in that case).

### MODERATE — schema error message reflects the actual failure

`file-open-rpc.schema.ts`'s `parseFileOpenParams` now returns a discriminated `{success:true,data} | {success:false,error}` instead of collapsing every Zod failure to `null`/a static string. The error string is `${field}: ${zodMessage}` built from the first Zod issue — a missing `path` reports a `path:`-prefixed message, an invalid `line` (e.g. `0`) reports a `line:`-prefixed message. New spec case: `'reports a line-specific error for an invalid line, not the generic path message'`, asserting the error string contains `'line'` for `{path:'...', line:0}` and a separate case asserting the malformed-params error contains `'path'`.

### Verification — `npx nx run-many -t lint typecheck test -p ptah-electron @ptah-extension/rpc-handlers @ptah-extension/chat-ui`

Header confirmed 3 projects requested and run:

```
NX   Running targets lint, typecheck, test for 3 projects:
- ptah-electron
- @ptah-extension/rpc-handlers
- @ptah-extension/chat-ui
```

Test results:

- `@ptah-extension/chat-ui:test` → `Test Suites: 23 passed, 23 total` / `Tests: 131 passed, 131 total`.
- `@ptah-extension/rpc-handlers:test` → `Test Suites: 91 passed, 91 total` / `Tests: 31 skipped, 2687 passed, 2718 total`. (On the first full-suite run, two UNRELATED pre-existing specs — `skills-sh-source-root.service.spec.ts` and `skills-sh-legacy-adoption.spec.ts`, both 5000ms Jest timeouts under full-suite load — failed; re-run in isolation with `-t "writes every slug of a whole-repo install"` passed cleanly in 19s, and the full run reported above is green. Neither test touches `file:open` or anything this batch changed.)
- `ptah-electron:test` → `Test Suites: 1 skipped, 31 passed, 31 of 32 total` / `Tests: 4 skipped, 400 passed, 404 total`.

Lint: `0 errors` across all three projects (pre-existing, unrelated `max-lines`/`no-unused-vars`/`no-empty-function`/`no-non-null-assertion` warnings only — none in any file this batch touched). No `RpcHandlers`-naming lint error anywhere; `eslint.config.mjs`'s exception list is back to its original 3 entries.

Typecheck: `Successfully ran target typecheck for 3 projects` — all three clean.

```
NX   Successfully ran targets lint, typecheck, test for 3 projects
```

### Files touched in this fix pass (full list)

- DELETED: `apps/ptah-electron/src/services/rpc/handlers/file-open-rpc.handlers.ts`, `file-open-rpc.schema.ts`, `file-open-rpc.handlers.spec.ts`
- CREATED: `libs/backend/rpc-handlers/src/lib/handlers/file-open-rpc.handlers.ts`, `file-open-rpc.schema.ts`, `file-open-rpc.handlers.spec.ts`
- MODIFIED: `libs/backend/rpc-handlers/src/lib/handlers/index.ts`, `libs/backend/rpc-handlers/src/index.ts`, `eslint.config.mjs`, `apps/ptah-electron/src/rpc-host-profile.ts`, `apps/ptah-electron/src/services/rpc/handlers/index.ts`, `apps/ptah-electron/src/di/phase-4-handlers.ts`

### Deferred (per coordinator instruction)

The unguarded duplicate-registration overwrite in `RpcHandler.registerMethod` / `registerRpcSurface` (infrastructure, not this batch) — coordinator will record it as a future enhancement.
