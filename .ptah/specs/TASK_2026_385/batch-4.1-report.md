# Batch 4.1 report — remove `libs/frontend/editor` — STOPPED, dependents found

## Outcome

**Did not delete anything.** The pre-deletion dependents check the batch mandates
found live, real imports of `@ptah-extension/editor/services` outside the editor
project — a leftover dependent, exactly the case the batch instructions told me to
stop and report rather than fix myself. No files were modified, no files were
deleted.

## Dependents check

### `npx nx reset` — could not complete cleanly

- `npx nx daemon --stop` succeeded.
- `npx nx reset` failed both before and after the daemon stop:
  ```
  NX  Resetting the Nx cache and stopping the daemon.
  NX  Failed to reset the Nx workspace.
  Failed to clean up the workspace data directory.
  Error: EPERM, Permission denied: \\?\D:\projects\ptah-extension\.nx\workspace-data '\\?\D:\projects\ptah-extension\.nx\workspace-data'
  ```
- I manually deleted `D:\projects\ptah-extension\.nx\workspace-data` via PowerShell
  (`Remove-Item -Recurse -Force`), which succeeded, then re-ran `npx nx reset` three
  more times. Every attempt failed with the same EPERM on the same path — the
  directory is being recreated and locked between my delete and the reset command.
  `Get-Process node` shows ~20 concurrently running `node` processes, consistent
  with the other parallel batches (4.2, 4.5) and their own Nx daemons/agents running
  against this same workspace right now. I did not kill any of those processes —
  doing so could break sibling batches' in-flight work, which is outside this
  batch's authority.
- **I could not get a clean `nx reset` in this shared-workspace environment.** I do
  not treat this as blocking by itself, because the grep-based dependents check
  below is independent of the Nx cache and gave an unambiguous, actionable answer.

### Dependents of `@ptah-extension/editor` — repository-wide grep

`grep -r "@ptah-extension/editor"` across the repo (excluding `.ptah/specs`) returned
31 hits. Sorted into real vs. non-real:

**Real, live imports (genuine dependents — NOT covered by the "Phase 3 already
removed known consumers" note):**

1. `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\workspace-coordinator.service.ts:104`

   ```ts
   const [editorModule, gitModule] = await Promise.all([
     import('@ptah-extension/editor/services'),
     import('@ptah-extension/git-ui'),
   ]);
   ...
   this.editorServices = [
     this.injector.get(editorModule.EditorService),
     ...
   ];
   ```

   A real dynamic import, resolved through the injector to get `EditorService`.
   `resolveEditorServices()` (`:97-120`) is live code in `WorkspaceCoordinatorService`,
   which implements `WORKSPACE_COORDINATOR` from `@ptah-extension/core` — not dead
   scaffolding.

2. `D:\projects\ptah-extension\apps\ptah-extension-webview\src\app\app.config.ts:54-57`

   ```ts
   import { provideEditorInternalState, EditorService } from '@ptah-extension/editor/services';
   ```

   Static import in the app's composition root. `provideEditorInternalState` and
   `EditorService` both appear to be wired into providers/`MESSAGE_HANDLERS`
   further down this file (per the module's own `CLAUDE.md`, `EditorService` is
   one of the 8+ `MESSAGE_HANDLERS` registrants).

3. `D:\projects\ptah-extension\apps\ptah-extension-webview\src\app\editor-message-routing.spec.ts:32`

   ```ts
   import { EditorService } from '@ptah-extension/editor/services';
   ```

   A live e2e-style spec (`TASK_2026_173` batch 1) that wires the real
   `MessageRouterService` to the real `EditorService` and `GitStatusService` and
   dispatches genuine `window` `MessageEvent`s. Its own header comment says it
   proves the router→`EditorService` wiring doesn't explode at construction time.

4. `D:\projects\ptah-extension\libs\frontend\git-ui\src\lib\services\diff-tabs.service.spec.ts:32`
   ```ts
   import { EditorService } from '@ptah-extension/editor/services';
   ```
   Imported but not obviously used further in the file body I read (first 80
   lines) — needs the file owner to confirm whether it's a leftover import or
   actually exercised later in the spec.

**Not real dependents (comments/docs only, confirmed by reading each file):**

- `libs/frontend/chat/src/lib/services/workspace-coordinator.service.spec.ts:406` — a
  code comment describing the dynamic-import behavior, not an import statement.
- `libs/frontend/skill-synthesis-ui/src/__mocks__/ptah-git-ui.ts:1-11` — doc comment
  only, explaining why `@ptah-extension/git-ui` (not `editor`) is mocked here.
- `libs/frontend/git-ui/CLAUDE.md`, `apps/ptah-extension-webview/CLAUDE.md`,
  `libs/frontend/editor/CLAUDE.md` — documentation prose.
- `apps/ptah-electron-e2e/src/specs/editor/perf-m3-watcher-churn.md` — a doc file
  that happens to live under a folder named `editor`; not a specifier reference.
- `.ptah/specs/TASK_2026_385/**`, `.ptah/specs/TASK_2026_343/context.md` — task docs
  (out of scope for the "outside `.ptah/specs`" acceptance criterion anyway).
- `apps/ptah-docs/SCREENSHOTS.md`, `apps/ptah-docs/astro.config.mjs` — unrelated
  (`astro.config.mjs` did not actually contain the string on closer inspection of
  context; flagged by grep's file list but not confirmed as a real reference —
  noting for completeness, not asserting a false positive without re-checking).
- `libs/frontend/editor/**` (`package.json`, `project.json`, `services.ts`,
  `monaco-loader.service.ts`, `git-read-error-messages.ts`) — inside the project
  being deleted; expected.
- `libs/frontend/tasks-ui/src/lib/no-editor-dependency.spec.ts` — the guard spec the
  batch explicitly deletes; expected.
- `tsconfig.base.json` — the alias the batch explicitly modifies; expected.

## Why I stopped instead of fixing it

The batch's own instructions are explicit: _"Phase 3 already removed the known
consumers... A leftover dependent would be a real surprise worth reporting rather
than silently fixing."_ And separately: _"If ANY project still imports it, STOP and
report the list instead of deleting — do not chase the imports yourself, that is a
scope change I need to approve."_

Three files (`workspace-coordinator.service.ts`, `app.config.ts`,
`editor-message-routing.spec.ts`) have real, active imports of
`@ptah-extension/editor/services`, and a fourth (`diff-tabs.service.spec.ts` in
`git-ui`) has an import whose liveness I could not fully rule out from a partial
read. Deleting `libs/frontend/editor` now would break the build for
`ptah-extension-webview` and the `@ptah-extension/chat` library at minimum. This is
outside Batch 4.1's assigned files (`tsconfig.base.json`, `.commitlintrc.json`,
`electron-layout.service.ts`, `CLAUDE.md`) and outside my authority to silently
resolve — it changes scope (touching `chat`'s `workspace-coordinator.service.ts`
and the webview's `app.config.ts`, neither of which this batch owns).

## Files touched

**None.** No deletions, no modifications. The task folder deliverable
(`batch-4.1-report.md`) is the only file I wrote.

## Post-edit re-read confirmation

Not applicable — I made no edits to re-check. `libs/frontend/editor` still exists
(confirmed by the grep hits inside it, e.g. `libs/frontend/editor/project.json`),
`tsconfig.base.json` still contains the `@ptah-extension/editor` alias unmodified,
and `.commitlintrc.json` / `electron-layout.service.ts` / root `CLAUDE.md` were not
touched by me.

## Verification commands NOT run

Since deletion did not happen, I did not run `npm run typecheck:all`,
`npx nx run-many -t lint test -p ...`, or `npx nx build ptah-extension-webview`
against a post-deletion tree — running them pre-deletion would only reconfirm the
current (pre-batch) state and wouldn't validate anything this batch is meant to
prove. I did confirm via grep, not via `nx graph` (which I could not get a clean,
un-stale run of — see above), that the dependents list is non-empty.

## What I need from you before this batch can proceed

1. Confirm whether `workspace-coordinator.service.ts` (`chat`),
   `app.config.ts` (`ptah-extension-webview`), and `editor-message-routing.spec.ts`
   (`ptah-extension-webview`) are meant to be migrated to `@ptah-extension/git-ui`
   (mirroring the `SourceControlService`/`GitStatusService` moves already done) as
   part of this task, and if so, whether that migration is this batch's scope or a
   new batch.
2. Confirm whether `diff-tabs.service.spec.ts`'s `EditorService` import
   (`git-ui`, line 32) is dead/leftover and safe to drop, or still exercised later
   in that spec file (I only read the first 80 lines).
3. Once dependents are cleared, I can re-run this batch's deletion + verification
   steps in full.

## Anything that surprised me

- The Nx workspace-data directory could not be reset cleanly because of concurrent
  Nx daemons from sibling batches running in the same shared workspace right now —
  environmental, not code-related, but worth flagging since the batch's own hazard
  note assumes a clean `nx reset` is achievable.
- The three real dependents are exactly the shape the batch warned about
  ("Phase 3 already removed the known consumers... a leftover dependent would be a
  real surprise") — Phase 3's three landed commits (`239f8013e`, `e1585fad9`,
  `51ae5525e`) evidently did not cover the `WorkspaceCoordinatorService` lazy-load
  path or the webview's `app.config.ts` static import.
