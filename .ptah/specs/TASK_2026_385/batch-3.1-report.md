# Batch 3.1 report — Git dock

## Files

- CREATED `D:\projects\ptah-extension\libs\frontend\git-ui\src\lib\git-dock\git-dock-header.component.ts` — `GitDockHeaderComponent`, a direct port of `git-status-bar.component.ts:40-141` minus the branch-picker dropdown and details popover.
- CREATED `D:\projects\ptah-extension\libs\frontend\git-ui\src\lib\git-dock\git-dock.component.ts` — `GitDockComponent`, arms/disarms `GitStatusService` + `GitBranchesService`, composes header + source-control panel + diff view, routes file clicks to `file:open`.
- CREATED `D:\projects\ptah-extension\libs\frontend\git-ui\src\lib\git-dock\git-dock.component.spec.ts` — arming/disarming/idempotent-rearm/file-open specs.
- MODIFIED `D:\projects\ptah-extension\libs\frontend\git-ui\src\index.ts` — exported `GitDockComponent`, `GitDockHeaderComponent`.
- MODIFIED `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\electron-shell.component.ts` — dynamic import switched from `@ptah-extension/editor`'s `EditorPanelComponent` to `@ptah-extension/git-ui`'s `GitDockComponent`; signal renamed `editorComponent` → `dockComponent`; sidebar tab `label="Editor"` → `label="Git"` (aria-label/title derive from `label()` in `SidebarTabComponent`, so they auto-update to "Toggle Git panel" / "Show Git" / "Hide Git"); doc comments updated. `layout.editorPanelVisible()` / `editorPanelWidth()` left untouched, as required.

## Arming / disarming design

`GitDockComponent`'s constructor:

```ts
this.gitStatus.startListening();
this.gitBranches.startListening();
void this.gitBranches.refreshBranches();

this.destroyRef.onDestroy(() => {
  this.gitStatus.stopListening();
  this.gitBranches.stopListening();
});
```

This replaces the arming that used to live in `editor-panel.component.ts` (`ngOnInit`/`ngOnDestroy`, lines ~755/761) and in `git-status-bar.component.ts`'s constructor (branch listening only) for the Electron shell's git surface. `GitStatusService.startListening()` performs its own eager `git:info` fetch, so closing and reopening the dock reconciles instead of dropping pushes that arrived while it was shut — the header component itself does no arming; it is purely a reader of both services' signals.

`GitDockHeaderComponent` keeps `data-testid="git-push-button"`, `role="status"` and `aria-label="Git status"` on its root `@if (gitStatus.isGitRepo())` div, unchanged from the source. It has no inputs or outputs, matching the "strict subset" requirement — TASK_2026_386 adds `activeTab`/`tabChange`/`openInRequested`.

`GitDockComponent`'s body wires `SourceControlPanelComponent`'s `fileClicked` output to `onFileClicked(path)`, which calls `rpcCall(this.vscodeService, 'file:open', { path })`. `file:open` is already a registered `RpcMethodRegistry` entry in `libs/shared/src/lib/types/rpc.types.ts:681` (`FileOpenParams`/`FileOpenResult` in `rpc-misc.types.ts:124-136`) — the call is fully typed today even though the Electron-side handler (Batch 3.2, parallel) had not yet landed at the time of this edit; this batch does not depend on it.

The branch-picker dropdown and details popover were **not** ported — no `BranchPickerDropdownComponent`/`BranchDetailsPopoverComponent` imports, no `git:checkout`/`git:tags`/`git:remotes` etc. calls from this component.

## Acceptance command output

```
$ npx nx run-many -t test -p @ptah-extension/git-ui @ptah-extension/chat

 NX   Running target test for 2 projects:

- @ptah-extension/git-ui
- @ptah-extension/chat


> nx run @ptah-extension/git-ui:test

Test Suites: 10 passed, 10 total
Tests:       231 passed, 231 total
Snapshots:   0 total
Time:        21.002 s
Ran all test suites.

> nx run @ptah-extension/chat:test

Test Suites: 64 passed, 64 total
Tests:       2 skipped, 988 passed, 990 total
Snapshots:   0 total
Time:        26.181 s
Ran all test suites.


 NX   Successfully ran target test for 2 projects
```

`Running target test for 2 projects` header confirms both projects actually ran (not the `nx test A B` path-filter trap).

Also ran the git-ui typecheck target directly, zero output (pass):

```
$ npx ngc --noEmit --project libs/frontend/git-ui/tsconfig.lib.json
(no output — clean)
```

Stale-import grep, as required:

```
$ Grep pattern "@ptah-extension/editor" path libs/frontend/git-ui
libs\frontend\git-ui\CLAUDE.md:7:  ... Carved out of `@ptah-extension/editor` (TASK_2026_385) ...
libs\frontend\git-ui\CLAUDE.md:15: ... must never import `@ptah-extension/editor` ...
libs\frontend\git-ui\src\lib\services\diff-tabs.service.spec.ts:8: ... stayed in `@ptah-extension/editor` ...
```

All three hits are documentation/comment prose about the historical/forbidden import, not actual TypeScript imports. No source file in `git-ui` imports `@ptah-extension/editor`.

Note: `npx ngc --noEmit --project libs/frontend/chat/tsconfig.lib.json` surfaced two pre-existing TS errors in `libs/frontend/chat-ui/src/lib/atoms/file-path-link.component.ts` (`Property 'vscodeService' does not exist` / `Property 'injector' does not exist`). `git status` confirms that file is currently modified with unstaged changes belonging to Batch 3.2 (external-editor `file:open`), running in parallel in another session — it is not a file this batch touched or owns, and the transient state does not affect `git-ui` or `chat`'s own Jest suites, both of which are fully green above.

## Plan deviations

None. Selectors, `data-testid`s, arming sequence, body wiring, and the shell mount all match `implementation-plan.md:461-529` and `batches.md:525-539` as written.

## Reviewer notes

- `GitDockComponent`'s split between the file list (`w-64` fixed) and the diff view (`flex-1`, shown only when `diffTabs.activeDiffTab()` is truthy) is a straightforward flex layout — no design-handoff.md exists in this task folder to check pixel-exact values against, so this is a reasonable default rather than a verified spec match. Worth a visual pass once Batch 3.3's e2e/docs shot lands.
- `git-dock.component.spec.ts` deliberately never calls `fixture.detectChanges()`, so `GitDockHeaderComponent`, `SourceControlPanelComponent` and `DiffViewComponent` are never actually instantiated/rendered in this suite — only the host component's constructor and `DestroyRef.onDestroy` callback are exercised. This keeps the arming spec isolated from those children's own dependency graphs (`SourceControlService`, `WorktreeService`, `MonacoLoaderService`), matching the acceptance-evidence text ("a jest spec asserting the constructor arms both services and `ngOnDestroy` disarms both") without needing to stand up Monaco in a Jest environment.
- Did not touch `editor-panel.component.ts` — it is untouched by this batch's file list and remains the VS Code extension's editor-panel host until Phase 4 deletes `@ptah-extension/editor` entirely.

## Fix pass

Both reviews APPROVED (style 88/100, logic 8/10), zero blocking. Three items closed:

**FIX 1 (logic, moderate) — unhandled dynamic-import rejection.**
`libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts` — the `import('@ptah-extension/git-ui').then(...)` had no `.catch()`, so a lazy-chunk load failure left `dockComponent` `null` forever with only an indefinite spinner and no way to recover short of an unrelated re-render. Added:

- `readonly dockLoadFailed = signal(false)` — a tracked dependency inside the load `effect()` (unlike `dockComponent`, which stays `untracked` to avoid the effect re-running on its own write).
- `.catch((error: unknown) => { console.error(...); this.dockLoadFailed.set(true); })` on the import chain.
- `protected retryDockLoad(): void { this.dockLoadFailed.set(false); }` — flipping the tracked signal back to `false` re-triggers the effect (condition: `editorPanelVisible() && !untracked(dockComponent) && !dockLoadFailed()`), so the retry actually re-imports rather than just resetting a flag nothing reads again.
- Template: a new `@else if (dockLoadFailed())` branch between the mounted-dock branch and the spinner `@else`, rendering `"Failed to load the git panel."` plus a `Retry` button wired to `(click)="retryDockLoad()"`.

**FIX 2 (logic, moderate) — no regression guard for the DI-identity fact the whole batch depends on.**
`git-dock.component.spec.ts` proves `GitDockComponent` _calls_ `startListening()`/`stopListening()`, but its `useValue` stubs bypass real Angular DI entirely — they cannot catch a future regression where something re-provides `GitStatusService`/`GitBranchesService` at a narrower scope than root, which would silently reintroduce "the push gate has no armer" with every existing test (including that spec) still green.

Added CREATED `D:\projects\ptah-extension\apps\ptah-extension-webview\src\app\git-dock-arming-identity.spec.ts`. Chosen project: **`ptah-extension-webview`** — that is where `app.config.ts` (the actual `MESSAGE_HANDLERS` composition root, `useExisting: GitStatusService` / `useExisting: GitBranchesService` at lines 190-191) lives, and it is the one project whose jest config exercises it. Neither `git-ui` (no `app.config.ts`) nor `chat` (same) can run this assertion meaningfully. The spec follows the exact pattern of the pre-existing neighbour `editor-message-routing.spec.ts`: real `MessageRouterService` + real `GitStatusService`/`GitBranchesService` wired through the identical `MESSAGE_HANDLERS` `useExisting` registrations `app.config.ts` uses, `rpcCall` mocked at the module boundary. Three specs:

1. `TestBed.inject(GitStatusService)` (the instance `MESSAGE_HANDLERS` holds) is reference-identical (`toBe`) to the private `gitStatus` field `GitDockComponent`'s constructor injected.
2. Same assertion for `GitBranchesService`.
3. An end-to-end push: a real `window` `MessageEvent` carrying `MESSAGE_TYPES.GIT_STATUS_UPDATE` dispatched after `GitDockComponent` is constructed (and thus armed) is observed on `gitStatus.branchName()` — proving the instance the dock armed is the one the router's real dispatch path actually updates, not merely two objects that happen to satisfy `toBe` in isolation.

**FIX 3 (style, minor) — stale comment.**
`electron-shell.component.ts`'s comment at the git-dock mount point read "keeps monaco out of the VS Code extension bundle", misleading in a component confirmed Electron-only. Reworded to "keeps monaco out of the initial Electron renderer bundle".

**Deferred, not fixed (per coordinator instruction):** `git:push` failure has no user-facing feedback (`git-dock-header.component.ts:124-132`) — pre-existing debt carried over from the ported `git-status-bar.component.ts`, and the batch text says port, not redesign. Same for the empty file-list body in a non-git workspace (`SourceControlPanelComponent` is out of this batch's scope). Both recorded by the coordinator as future enhancements, not addressed here.

### Fix-pass verification

```
$ npx nx run-many -t test -p @ptah-extension/git-ui @ptah-extension/chat ptah-extension-webview

 NX   Running target test for 3 projects:

- @ptah-extension/git-ui
- @ptah-extension/chat
- ptah-extension-webview


> nx run @ptah-extension/git-ui:test

Test Suites: 10 passed, 10 total
Tests:       231 passed, 231 total
Snapshots:   0 total
Time:        24.379 s
Ran all test suites.

> nx run ptah-extension-webview:test

Test Suites: 8 passed, 8 total
Tests:       144 passed, 144 total
Snapshots:   0 total
Time:        32.082 s
Ran all test suites.

> nx run @ptah-extension/chat:test

Test Suites: 64 passed, 64 total
Tests:       2 skipped, 988 passed, 990 total
Snapshots:   0 total
Time:        36.415 s
Ran all test suites.


 NX   Successfully ran target test for 3 projects
```

`Running target test for 3 projects` header confirms all three ran (git-ui, chat, and the webview app carrying the new FIX 2 spec) — not the `nx test A B C` path-filter trap.

Also re-ran the git-ui typecheck target after the fix pass, zero output (pass):

```
$ npx ngc --noEmit --project libs/frontend/git-ui/tsconfig.lib.json
(no output — clean)
```

### Fix-pass files

- MODIFIED `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\electron-shell.component.ts` — `dockLoadFailed` signal, `.catch()` on the dynamic import, `retryDockLoad()`, retry-state template branch, reworded stale comment.
- CREATED `D:\projects\ptah-extension\apps\ptah-extension-webview\src\app\git-dock-arming-identity.spec.ts` — DI-identity regression guard for FIX 2.

No files were touched outside this batch's ownership: `apps/ptah-electron/**`, `libs/frontend/chat-ui/**`, `libs/frontend/canvas/**`, `.gitignore` and `tools/video-editor/` were left untouched, per the coordinator's rules.
