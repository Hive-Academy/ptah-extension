# Code Logic Review — `TASK_2026_385` Batch 3.2

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 68/100         |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 1              |
| Serious issues      | 1              |
| Moderate issues     | 2              |
| Failure modes found | 3              |

## The claim about deleting `registerFileOpen()` — CORRECT, deletion was necessary

Verified from source, not from the report.

- `resolveRpcHandlerPlan` (`libs/backend/rpc-handlers/src/lib/host-profile/register-rpc-surface.ts:94-130`) walks `RPC_HANDLER_MANIFEST` in declaration order and constructs one plan step per manifest entry, deduping by **ctor identity** (`seen.has(ctor)`, line 124).
- `manifest.ts:360-370` orders the three host-owned entries exactly as the report states: `host.fileOpen` (360, ctor supplied = `ElectronFileOpenRpcHandlers`) → `host.editorRevert` (362, ctor supplied = `EditorRpcHandlers`) → `host.editorPane` (367, ctor supplied = `EditorRpcHandlers`, already `seen` → skipped).
- `registerHandlers` (`register-rpc-surface.ts:176-196`) then calls `.register()` once per **plan step**, in that same order: `ElectronFileOpenRpcHandlers.register()` first, `EditorRpcHandlers.register()` second (triggered by the `host.editorRevert` entry, not `host.editorPane` — irrelevant to which entry triggers it, since `register()` is not entry-scoped and touches every method the class wires).
- `RpcHandler.registerMethod` (`libs/backend/vscode-core/src/messaging/rpc-handler.ts:153-169`) does not throw or ignore a duplicate — it **silently overwrites** (`this.handlers.set(name, handler)`) after only a `logger.warn` (line 165), which nothing reads at runtime.

So: if `EditorRpcHandlers.register()` still called a `registerFileOpen()` that bound `'file:open'` internally, it would run strictly after `ElectronFileOpenRpcHandlers.register()` in every real boot, and would silently replace the new spawn-based handler with the old file-read handler — exactly the regression the report describes, and with no build-time or dev-mode signal (`assertOnDrift` / `verifyAndReportRpcRegistration` check _coverage_ of the manifest's method set, not _last-writer-wins_ collisions inside one call). The deletion in `editor-rpc.handlers.ts` was necessary, and its comment at lines 102-106 records the reason accurately.

**Confirmed nothing else was taken with it.** `EditorRpcHandlers.register()` (`editor-rpc.handlers.ts:101-115`) still calls `registerOpenFile()` (→ `'editor:openFile'`, not `'file:open'` — line 131-137), `registerRevertFiles`, `registerSaveFile`, `registerGetFileTree`, `registerGetDirectoryChildren`, `registerCreateFile`, `registerCreateFolder`, `registerRenameItem`, `registerDeleteItem`. That is exactly `EDITOR_PANE_METHODS` (manifest.ts:97-106, 8 entries) plus `'editor:revertFiles'` (host.editorRevert) — 9 methods, matching what the class now serves with nothing missing and nothing extra. The `editor-rpc.handlers.spec.ts` reachability suite (`opens a file inside an excluded directory...`, line 149) still exercises `editor:openFile` end-to-end and passes.

## Five logic questions

### 1. How does this fail silently?

**Primary finding (see Blocking issue below):** `handleFileOpen` (`file-open-rpc.handlers.ts:49-87`) reports `{ success: true }` and fires `notifyFileOpened` (line 77) the instant `spawnProcess()` **returns**, not when the child process actually starts or the external editor actually launches. The real `IProcessSpawner` (`OffThreadProcessSpawner`, `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts`) returns a `WorkerBackedProcess` handle synchronously and reports a spawn failure (e.g. `code` not on `PATH`, the single most likely failure for this exact feature) **asynchronously**, via a worker round-trip that resolves to `WorkerBackedProcess.fail()` → `emit('error', ...)` (lines 397-431). By the time that fires, the RPC response has already gone out as success and `notifyFileOpened` has already run. The only trace is `handle.on('error', ...)` at `file-open-rpc.handlers.ts:73-75`, which logs at `warn` — nothing a user or the `ptah_ide` MCP consumer ever sees. This is the textbook "success-looking result on failure" case the review brief asks about.

### 2. What user action produces unexpected behaviour?

Clicking a `<ptah-file-path-link>` (or the MCP `open file` action) when the `code` CLI is not on `PATH` (common on a machine where VS Code was installed but "Shell Command: Install 'code' command in PATH" was never run, or on a machine with no VS Code at all): the UI gets `{success:true}`, `notifyFileOpened` fires (so `ptah_ide` context auto-include and the active-editor state update as if the file opened), and nothing visibly happens. There is no retry path and no user-facing error — see Blocking issue.

### 3. What input data produces a wrong answer?

- `line: 0` is rejected by `z.number().int().positive()` (`file-open-rpc.schema.ts:13`), so it is treated as a validation failure (`'path is required'` — see Moderate issue on the misleading error string) rather than "open without a line", even though `0` is a value a caller might reasonably compute for "start of file." Not a security issue, just a slightly confusing edge case not covered by any test.
- A `path` containing characters `cmd.exe` treats specially (`&`, `|`, `"`, `^`) is not sanitized before being joined into `target = \`${path}:${line}\``(line 62), but this is safe in practice:`spawnProcess`resolves the Windows`.cmd`wrapper through`cross-spawn`'s `\_parse` (`off-thread-process-spawner.ts:637-660`), which is the library that exists specifically to escape argv for `cmd.exe /d /s /c`invocation of`.cmd`/`.bat` targets. No injection path found.

### 4. What happens when a dependency fails?

- `workspace.getWorkspaceFolders()` returning `[]` (no workspace open) is handled correctly: `isPathWithinRoots` (`platform-core/src/utils/path-containment.ts:69-70`) fails closed on an empty root set, so the handler always answers `{success:false, error:'Path is outside the workspace'}` before any spawn — matches the containment-before-spawn requirement.
- `spawner.spawnProcess` throwing **synchronously** is caught (`file-open-rpc.handlers.ts:79-86`) and turned into `{success:false, error}` — never a rejection. Verified: the real spawner essentially never throws synchronously (`OffThreadProcessSpawner.launch` swallows a `WorkerBackedProcess` constructor throw internally and falls back to inline spawn, `off-thread-process-spawner.ts:671-684`), so this branch is reachable only for a spawner implementation different from the shipped one. The asynchronous failure mode (worker `'error'` message) is the one that actually occurs in production and is NOT translated into `{success:false}` — see Blocking issue.
- `editorProvider.notifyFileOpened` throwing synchronously (it does not, today — `electron-editor-provider.ts:49` is a simple synchronous event fire) would be caught by the same `try` and reported as `{success:false, error}` even though the process was already spawned successfully — a latent trap if that method is ever changed to do I/O, flagged as Moderate below.

### 5. What is missing that the requirements never mentioned?

- No mechanism ties the RPC's optimistic success to the async spawn outcome — not even a best-effort follow-up notification (e.g. a push telling the renderer "the editor failed to launch") for the case the header itself calls out as the reason this class exists (spawn a process and "do nothing else"). Given the class explicitly replaces a handler that used to give real success/failure (file read), regressing to "always succeeds once the call returns" for a user-initiated action is a behaviour change worth a line in `context.md`/`task-description.md`, and it is not one that either document appears to name (only `batches.md`/`batch-3.2-report.md`, per this task's context, describe the manifest-collision reasoning — the async-failure gap is not addressed there).
- No test exercises the asynchronous spawn-failure path at all (see spec finding below), so this gap shipped without a red test to catch it.

## Failure modes

### Optimistic success on async spawn failure

- Trigger: `code` (or whatever `command` is configured) is not resolvable/executable — the common case being the VS Code CLI not on `PATH`.
- Symptom: RPC caller receives `{success:true}`, `notifyFileOpened` fires, but no editor window opens; the only trace is a `warn`-level log line the user never sees.
- Evidence: `file-open-rpc.handlers.ts:64-78` (success path returns/notifies before any error can surface) vs. `off-thread-process-spawner.ts:397-431` (real spawn failures resolve asynchronously via a worker message, well after `spawnProcess()` has returned).
- Current handling: `handle.on('error', ...)` only logs at `warn` (line 73-75); the already-sent success response and the already-fired notification are not corrected or revoked.
- Recommendation: either await `handle.whenSpawned` (exposed by `PtahSpawnedProcess`/`SpawnedProcessHandle`, `off-thread-process-spawner.ts:229`) with a short bound before answering, or defer `notifyFileOpened` and the boolean truthiness of the RPC result until the `'error'`/spawn confirmation resolves within a small window, so a same-tick ENOENT is at least caught before the response is sent.

### Spec's "throwing spawner" test does not exercise the real failure mode

- Trigger: reviewing `ElectronFileOpenRpcHandlers — file:open` spec's fourth test (`file-open-rpc.handlers.spec.ts:113-127`).
- Symptom: the suite believes the failure path is covered ("returns `{success:false}` instead of rejecting when the spawner throws"), but the fake spawner throws **synchronously inside `spawnProcess`**, a shape the real `OffThreadProcessSpawner.spawnProcess` essentially never produces (see above) — real ENOENT-class failures surface asynchronously on the returned handle's `'error'` event, a path this spec never simulates.
- Evidence: `file-open-rpc.handlers.spec.ts:113-116` (`spawnProcess = jest.fn(() => { throw new Error(...) })`) vs. the shipped `off-thread-process-spawner.ts:637-660` + `397-431` (async failure via handle).
- Current handling: none — the gap between "what the spec tests" and "how the dependency actually fails" is invisible from the green test run.
- Recommendation: add a case where `fakeHandle()`'s `on('error', cb)` is captured and invoked after `spawnProcess` returns a handle synchronously, asserting on what the RPC caller already received by then (today: an already-sent `{success:true}` and an already-fired `notifyFileOpened`, which is the defect to fix, not just to pin).

### Duplicate-registration silent overwrite is unguarded infrastructure, not just this handler's problem

- Trigger: any future manifest entry ordered after another that shares an underlying class touching the same method name (the exact shape this batch just fixed).
- Symptom: the second `register()` call wins with no error, no throw, and only a `logger.warn` that `verifyAndReportRpcRegistration`/`assertOnDrift` do not appear to surface as drift (they check _set coverage_ against `RPC_METHOD_NAMES`, not last-writer-wins collisions within one method name).
- Evidence: `register-rpc-surface.ts:176-196` (`registerHandlers`), `rpc-handler.ts:164-166` (`Overwriting method` warn-and-continue).
- Current handling: relies entirely on developer discipline (the comment this batch added at `editor-rpc.handlers.ts:102-106`) to avoid a repeat.
- Recommendation: out of scope for this batch to fix, but worth flagging to the manifest owner — a dev-mode assertion that no two plan steps register the same method name twice would have caught this class of regression mechanically instead of by review.

## Blocking issues

### RPC reports success and fires the "file opened" notification before the spawn is confirmed

- File: `apps/ptah-electron/src/services/rpc/handlers/file-open-rpc.handlers.ts:64-78`
- Scenario: the external editor command is not found or fails to start (async spawn error via the real `OffThreadProcessSpawner`).
- Impact: the caller (webview UI, `ptah_ide` MCP tool) is told the file opened and the editor-active-path state updates accordingly, when nothing happened. The user sees no error and cannot self-diagnose (e.g. "why doesn't clicking this link do anything").
- Fix: either bound-await `handle.whenSpawned` before answering (the port already exposes it), or restructure so `notifyFileOpened`/the success response wait on the handle's first `'spawned'`/`'error'` outcome instead of firing unconditionally right after `spawnProcess()` returns.

## Serious issues

### The spec's failure-path test does not match the real dependency's failure shape

- File: `apps/ptah-electron/src/services/rpc/handlers/file-open-rpc.handlers.spec.ts:113-127`
- Scenario: reviewer/future maintainer trusts this test as proof the failure path is handled; it is not — it proves only that a _synchronous_ throw is handled, which the real spawner practically never does.
- Impact: the Blocking issue above shipped with green tests, because the one test aimed at failure handling exercises a scenario the dependency doesn't produce.
- Fix: add the asynchronous-`'error'`-event case described in "Failure modes" above.

## Moderate and minor issues

- `file-open-rpc.handlers.ts:79-86`: the same `try/catch` wraps both `spawnProcess()` and `notifyFileOpened()`. If `notifyFileOpened` is ever changed to do fallible work, a successfully-spawned process would be reported as `{success:false}` even though the editor did launch. Not a defect today (the current implementation is a synchronous, non-throwing event fire — `electron-editor-provider.ts:49`), but the coupling is fragile. Consider narrowing the `try` to just the spawn call, or moving `notifyFileOpened` before the `try` closes if its failure should not affect the reported result.
- `file-open-rpc.schema.ts` / `file-open-rpc.handlers.ts:53-55`: a `line: 0` (or any Zod validation failure) is reported with the generic message `'path is required'`, even when the actual problem is the line number. Minor clarity issue only — `parseFileOpenParams` collapses all Zod failures to `null` and the handler has one static message for that case.

## Data flow

1. RPC transport dispatches `'file:open'` → `handleFileOpen(params)` — OK, method registered once by `ElectronFileOpenRpcHandlers.register()` and never overwritten (confirmed above).
2. `parseFileOpenParams(params)` — OK, Zod `safeParse`, never throws, returns `null` on any shape mismatch.
3. Containment check `isPathWithinRoots(parsed.path, this.workspace.getWorkspaceFolders())` — OK, runs strictly before any spawn, fails closed on empty roots/candidate.
4. `target` built from `path`/`line` — OK, stays a single argv element; no shell string is built.
5. `spawner.spawnProcess({...})` called — GAP: returns synchronously with a handle whose real failure signal (worker `'error'` message) arrives later; the code below treats the synchronous return as "done."
6. `handle.on('error', ...)` attached — GAP: only logs; does not affect the response already computed at step 7.
7. `notifyFileOpened(parsed.path)` + `return {success:true}` — GAP: fires optimistically, ahead of step 6's real answer.
8. Synchronous throw (rare) → `catch` → `{success:false, error}` — OK, never rejects.

## Requirements fulfilment

| Requirement                                             | Status   | Gap                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Containment before spawn                                | COMPLETE | None found — verified ordering and fail-closed empty-roots behaviour.                                                                                                                                                                                                                                                                     |
| No shell injection                                      | COMPLETE | `command`/`args` stay separate; Windows `.cmd` resolution goes through `cross-spawn`, which escapes for `cmd.exe`.                                                                                                                                                                                                                        |
| `notifyFileOpened` fires on success only                | PARTIAL  | Fires on _apparent_ success (spawn call returned), not confirmed success — see Blocking issue.                                                                                                                                                                                                                                            |
| Never throws                                            | COMPLETE | Every path returns a value; synchronous throw is caught, no `Promise` rejection found.                                                                                                                                                                                                                                                    |
| Zod validation / `catch (error: unknown)`               | COMPLETE | Present and correctly narrowed.                                                                                                                                                                                                                                                                                                           |
| Spec proves all four acceptance assertions              | PARTIAL  | Argv/notify/out-of-workspace assertions hold; the "throwing spawner" assertion is real but does not represent the dependency's actual failure mode (see Serious issue).                                                                                                                                                                   |
| `EditorRpcHandlers` deletion scoped correctly           | COMPLETE | Verified `register()` still serves exactly `EDITOR_PANE_METHODS` + `editor:revertFiles`; nothing else removed.                                                                                                                                                                                                                            |
| `file-path-link.component.ts` opens files on both hosts | COMPLETE | `ClaudeRpcService.openFile` posts `'file:open'` unconditionally (`claude-rpc.service.ts:284`); VS Code's `host.fileOpen` entry is host-supplied by `FileRpcHandlers` (out of this batch's scope but present in the manifest as `host-owned`, `handler` omitted).                                                                          |
| DI phase / resolvability                                | COMPLETE | `ElectronFileOpenRpcHandlers` registered as a plain `@injectable()` singleton (`phase-4-handlers.ts:169`); `container.smoke.spec.ts:221-239` separately pins that `SDK_TOKENS.SDK_PROCESS_SPAWNER` (its sole non-shared dependency) is resolvable by phase 4, sourced from the real `registerSdkServices` rather than a hand-copied stub. |

Implicit requirements not addressed: correcting an optimistic success/notification when the underlying spawn later fails asynchronously (not called out in any task document reviewed, but a real regression versus the file-read handler this replaces, which reported genuine success/failure).

## Edge cases

| Case                                                       | Handled                     | How                                                                    | Concern                                           |
| ---------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------- |
| No workspace open (`getWorkspaceFolders() === []`)         | YES                         | `isPathWithinRoots` fails closed                                       | None                                              |
| Path outside every workspace root                          | YES                         | Explicit check, no spawn, no notify                                    | None                                              |
| `line` omitted                                             | YES                         | `target = parsed.path`                                                 | None                                              |
| `line: 0`                                                  | YES (as validation failure) | Zod `.positive()` rejects it                                           | Generic error message doesn't say why             |
| Malformed params (`{}`)                                    | YES                         | `parseFileOpenParams` → `null` → `{success:false,'path is required'}`  | None                                              |
| Synchronous spawner throw                                  | YES                         | `try/catch` → `{success:false,error}`                                  | Real spawner rarely does this (see Serious issue) |
| Asynchronous spawn failure (real-world `code` not on PATH) | NO                          | `handle.on('error')` only logs                                         | Blocking issue above                              |
| `.cmd`/`.bat` argv escaping on Windows                     | YES                         | Delegated to `cross-spawn`'s `_parse` inside `OffThreadProcessSpawner` | None found                                        |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: a user (or the `ptah_ide` MCP tooling that depends on `notifyFileOpened`) is told a file opened when the external editor spawn silently failed, with no way to discover why — the one failure path the handler's own header and the review brief call out as the thing to get right is the one the tests don't actually exercise.
- What a robust implementation would add: bound-await the spawn's `whenSpawned`/`'error'` signal before answering and before calling `notifyFileOpened`; a spec case that drives the real asynchronous failure shape instead of a synchronous throw; and, ideally, a dev-mode assertion in `registerRpcSurface` that a manifest plan never lets two steps register the same method name (the class of bug this batch just fixed by hand).
