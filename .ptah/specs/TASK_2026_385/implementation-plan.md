# Implementation Plan - TASK_2026_385

## Inputs and constraints

- Requirements used:
  - `D:\projects\ptah-extension\.ptah\specs\TASK_2026_385\context.md`
  - `D:\projects\ptah-extension\.ptah\specs\TASK_2026_384\context.md`
  - `D:\projects\ptah-extension\.ptah\specs\TASK_2026_384\research-report.md`
  - `D:\projects\ptah-extension\CLAUDE.md`,
    `D:\projects\ptah-extension\libs\frontend\editor\CLAUDE.md`,
    `D:\projects\ptah-extension\libs\frontend\chat\CLAUDE.md`,
    `D:\projects\ptah-extension\libs\backend\rpc-handlers\CLAUDE.md`,
    `D:\projects\ptah-extension\libs\shared\CLAUDE.md`
- Corrections applied: §"Corrections to the research report" below — 24 items.
- Design handoff used: `D:\projects\ptah-extension\.ptah\specs\TASK_2026_386\design-handoff.md`
  §1 only. The names and layer assignments this plan creates
  (`ptah-git-dock`, `ptah-git-dock-header`, `SourceControlPanelComponent` /
  `SourceControlFileComponent` / `WorktreeSectionComponent` / `DiffViewComponent`
  moved unchanged into `git-ui`) are taken verbatim from that table so
  TASK_2026_386 mounts them without a rename.
- Missing decision-critical input: none. Two decisions that context.md leaves
  implicit are resolved below with evidence and flagged as decisions, not
  assumptions: the new home for `editor:getSetting/updateSetting`
  (Component 11), and the watcher ignore-list widening (Component 12).

---

## Corrections to the research report

Every item was opened and read. `RR` = `../TASK_2026_384/research-report.md`,
`CX` = this task's `context.md`.

| #   | Claim                                                                                   | Correction (verified)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | CX:52-53, RR §4 Phase 2 — move `provideMonacoEditor` into `git-ui`                      | **Wrong.** `provideMonacoEditor` is an `ngx-monaco-editor-v2` export (`apps\ptah-extension-webview\src\app\app.config.ts:7`), called at `:250-252`. It is an npm symbol, not an editor-lib symbol. It stays in `app.config.ts` untouched.                                                                                                                                                                                                                                                                                                                          |
| 2   | CX:52 — move `MonacoLoaderService` (implied public)                                     | `MonacoLoaderService` is **not** exported from `src\index.ts` or `src\services.ts`. It is internal (`libs\frontend\editor\src\lib\services\monaco-loader.service.ts:61`), consumed only by `diff-view.component.ts:38,683` and `code-editor.component.ts:22,172`. It moves as an internal file of `git-ui`, not as public API.                                                                                                                                                                                                                                     |
| 3   | CX:53-55, RR §4 — "the diff subset of `editor-tab.types.ts`"                            | **Incomplete.** `DiffViewComponent.diffTab` is `input<EditorTab \| null>` (`diff-view.component.ts:696`), and design-handoff.md:31 freezes that input. `EditorTab` (`editor-tab.types.ts:104`) must move too, along with `normalizeDiffPath` (:135), `diffTabLabel` (:156), `DiffComparison` (:17), `DiffTabStatus` (:33), `DiffSideRef` (:19) and the re-export block (:192-197). In practice the whole 231-line file moves.                                                                                                                                      |
| 4   | CX:56-57, RR §4 — "the diff half of `EditorDiffSplitHelper` as a git-owned service"     | **No public member of that class is pure diff.** All 16 public members touch `EditorInternalState`/`EditorTabsHelper` (ctor `editor-diff-split.ts:97-100`); 9 of them (`:394`–`:613`) are split-pane only and have no diff involvement at all. The genuinely portable code is the private tail — `requestDiff` :684, `toDiffState` :704, `transportFailureState` :753, `labelFor` :784, `applyFreshDiff` :798, `patchDiff` :820, `toWorkspaceRelative` :838 — plus the debounce/in-flight fields (:72-84). The new service re-owns the tab store; see Component 6. |
| 5   | RR §4 Phase 1, CX:36 — `pty-manager.spec.ts` under `specs\editor\`                      | **Wrong path.** E2e spec is `apps\ptah-electron-e2e\src\specs\pty-manager.spec.ts` (specs root). The unit spec is `apps\ptah-electron\src\services\pty-manager.service.spec.ts`. Two files, neither under `specs\editor\`.                                                                                                                                                                                                                                                                                                                                         |
| 6   | CX:82, RR §4 Phase 3c — re-home `git-diff-mock.ts` under a `git/` folder                | Already outside the purge target: `apps\ptah-electron-e2e\src\support\git-diff-mock.ts`. **No move needed.**                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 7   | CX:82 — "`git/git-status.md`" as a spec                                                 | It is a **docs page**, `apps\ptah-docs\src\content\docs\git\git-status.md` (49 lines). There is no `specs\git\` folder; git e2e today is `apps\ptah-electron-e2e\src\specs\git-watcher.spec.ts` plus the two git tests inside `specs\editor\editor.spec.ts:145-194`.                                                                                                                                                                                                                                                                                               |
| 8   | RR §4 Phase 1 — `rpc-host-profile.ts:40` is the terminal wiring                         | `:40` is `pty: true,` — a **capability flag**, not a handler key. `host.fileOpen` is `:44`. There are three profiles, not one: `apps\ptah-electron\src\rpc-host-profile.ts`, `apps\ptah-extension-vscode\src\rpc-host-profile.ts`, `libs\backend\cli-engine\src\lib\rpc\cli-host-profile.ts`.                                                                                                                                                                                                                                                                      |
| 9   | CLAUDE.md + RR — `rpc-handler.ts:46` is `ALLOWED_METHOD_PREFIXES`                       | The array opens at **`:44`**; `:46` is `'chat:'`. Targets are `:67` `'editor:'`, `:68` `'layout:'`, `:72` `'terminal:'`.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 10  | RR §2 — `editor:getSetting/updateSetting` callers                                       | **Incomplete.** Besides `diff-view.component.ts:1432,1448` there is `vim-mode.service.ts:69,89`. Vim dies in Phase 0, so by Phase 2 the diff view is the only caller.                                                                                                                                                                                                                                                                                                                                                                                              |
| 11  | — (not in the report)                                                                   | **Live bug found.** `DIFF_LAYOUT_SETTING_KEY = 'editor.diff.renderSideBySide'` (`diff-view.component.ts:142`) is **not** in `FILE_BASED_SETTINGS_KEYS` (`libs\backend\platform-core\src\file-settings-keys.ts` — the only `editor.*` entry is `editor.vimMode` :208/:480). `editor:updateSetting` rejects any key failing `isFileBasedSettingKey` (`editor-rpc.handlers.ts:450`), so the diff layout preference has **never** persisted. The rename in Phase 2 must register the key or the silent failure survives the move.                                      |
| 12  | CX:100-103, RR §5.2 — add `.nx/cache` to the watcher ignore list                        | **Already ignored.** `.nx` :93, `dist` :96 and `node_modules` :95 are in `TREE_HIDDEN_DIRS` (`libs\shared\src\lib\constants\workspace-scan.constants.ts:80-97`); `WATCH_IGNORED_DIRS` :128-131 is derived from it plus `.angular`; `isExcludedWorkspacePath` :156-167 matches **any** path segment. `git-watcher.service.ts:450-455` uses exactly that predicate. So a write under `.nx\cache` or `.angular\cache` already schedules nothing. `perf-m3-watcher-churn.md` predates TASK_2026_208 and is stale.                                                      |
| 13  | CX:102 — add `coverage` and `tmp`                                                       | The module argues **against** both by name at `workspace-scan.constants.ts:21-27`: _"`out`, `build`, `coverage`, `.next` and `.turbo` are all plausible source directories in real projects and are deliberately NOT excluded. Do not add a name here without evidence that it can never hold source."_ See Component 12 for the resolution.                                                                                                                                                                                                                       |
| 14  | CX:126, RR §5.6 — persisted `editorWidth`/`editorVisible` risk                          | **Already benign.** `restoreLayout` (`libs\frontend\core\src\lib\services\electron-layout.service.ts:576-597`) declares `editorVisible?: boolean` at :581 and **never reads it**; only `editorWidth` is applied (:592-594). Extra keys are ignored by construction.                                                                                                                                                                                                                                                                                                |
| 15  | CX:90, RR §4 Phase 4 — delete "the editor layout state in `electron-layout.service.ts`" | **Wrong for this task.** `_editorPanelWidth`/`_editorPanelVisible` (:58-59) are the **shell's right-dock slot**, not editor-lib state — the git dock fills the same slot (`electron-shell.component.ts:252-282`). Deleting them deletes the dock. They stay; only their doc comments and the `ptah-sidebar-tab label="Editor"` string change.                                                                                                                                                                                                                      |
| 16  | CX:123 — "re-baseline `startup-tti.spec.ts`"                                            | `apps\ptah-electron-e2e\src\specs\perf\startup-tti.spec.ts:7-14` explicitly asserts **no** budget; it only `console.log`s three figures (:64,:66,:70). "Re-baseline" therefore means _re-run and record_, not _edit a threshold_.                                                                                                                                                                                                                                                                                                                                  |
| 17  | RR §3 — Electron `openArtifact` is "already a silent no-op"                             | `tasks-store.service.ts:1362` calls `this.rpc.openFile(absPath)` → `ClaudeRpcService.openFile` (`claude-rpc.service.ts:284-289`) → `file:open`. It is a real RPC whose Electron implementation reads bytes and shows nothing. Phase 3 fixes it for free.                                                                                                                                                                                                                                                                                                           |
| 18  | RR §2 — webview `project.json:28-30` asset glob                                         | The monaco-vim glob is **`:27-31`**. Budgets are `:62-73` and contain only `initial` and `anyComponentStyle` — **no lazy-chunk budget of any kind exists**.                                                                                                                                                                                                                                                                                                                                                                                                        |
| 19  | RR §5.4, CX:134 — CLI git usage `git.ts:137-340`                                        | First call is `:125` (`git:info`). Nine methods: `git:info` :125, `git:worktrees` :137, `git:addWorktree` :157, `git:removeWorktree` :191, `git:stage` :219, `git:unstage` :248, `git:discard` :283, `git:commit` :312, `git:showFile` :340. **`git:push` and `git:diffFile` are not CLI-consumed** but are dock-critical — prune nothing from the 18.                                                                                                                                                                                                             |
| 20  | CX:136, RR §5.8 — three `git:worktreeChanged` producers                                 | **Four call sites in three files**: `git-rpc.handlers.ts:370`, `ptah-api-builder.service.ts:874`, `sdk-callbacks.ts:356` **and** `:374`.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 21  | CX:70, RR §4 Phase 3a — "through `IProcessSpawner`"                                     | The port is **type-only and carries no DI token** (`libs\backend\platform-core\src\interfaces\process-spawner.interface.ts:12-13,79-82`). Bind via `SDK_TOKENS.SDK_PROCESS_SPAWNER` (`libs\backend\agent-sdk\src\lib\di\tokens.ts:51`, registered `register.ts:316`). One implementation exists: `OffThreadProcessSpawner` (`off-thread-process-spawner.ts:593`). There is **no** `platform-electron` / `platform-vscode` / `platform-cli` spawner.                                                                                                                |
| 22  | RR §4 Phase 0 — delete `editor-rpc.handlers.spec.ts:1-49`                               | Those lines are **not** editor-pane tests. They are the `EXCLUDED_DIRS_GLOB` suite that pins `TREE_HIDDEN_DIRS` derivation (`apps\ptah-electron\src\services\rpc\handlers\editor-rpc.handlers.spec.ts:1-49`, referenced from `workspace-scan.constants.ts:62-65`). It must be **re-homed**, not deleted (Component 12).                                                                                                                                                                                                                                            |
| 23  | RR §3 — `file:open` reference implementation "`file-rpc.handlers.ts:43-71`"             | Two files share that name. The one with `file:open` is the **app-local, `vscode`-importing** `apps\ptah-extension-vscode\src\services\rpc\handlers\file-rpc.handlers.ts:43-71`. The lib file `libs\backend\rpc-handlers\src\lib\handlers\file-rpc.handlers.ts` explicitly does **not** own `file:open` (header :2-4) and holds `FileSystemRpcHandlers` + `FilePickerRpcHandlers`.                                                                                                                                                                                  |
| 24  | RR §4 Phase 1 — `workspace-authorization.ts:46,58`                                      | `authorizedTerminalRoots` :46 has one consumer (`terminal-rpc.handlers.ts:32,85`) and dies with it. `isAuthorizedTerminalCwd` :58 and `isWithinHomeDir` :30 already have **zero** production callers — dead exports, delete in the same pass. `isAuthorizedWorkspace` :14 and `isPathWithinRoots` (`platform-core\src\utils\path-containment.ts:71`) stay.                                                                                                                                                                                                         |

---

## Codebase evidence

| Evidence                                                                                                                                     | Location                                                                                                                                                                                                                                        | Architectural implication                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every route into the editor lib from outside is a **runtime `import()`**; no static component import exists anywhere                         | `electron-shell.component.ts:307`, `file-path-link.component.ts:91`, `lazy-diff-view.component.ts:166`, `workspace-coordinator.service.ts:104`; static only via `/services` at `app.config.ts:54-58` and `editor-message-routing.spec.ts:32-35` | Six repoint sites, and the lazy boundary is the shape `git-ui` must preserve.                                                                                                                                                                          |
| The webview app config is the **only** composition root; Electron reuses the same build artifact                                             | only two `app.config.ts` exist repo-wide; the other is `apps\ptah-landing-page`                                                                                                                                                                 | One provider edit serves both hosts.                                                                                                                                                                                                                   |
| `EditorPanelComponent` is the sole `GitStatusService.startListening()` caller                                                                | `editor-panel.component.ts:845`; gate at `git-status.service.ts:269,286-290`                                                                                                                                                                    | Deleting the panel without a replacement host drops every `git:status-update`. Phase 3 must land before Phase 4.                                                                                                                                       |
| `GitStatusBarComponent` is the sole `GitBranchesService.startListening()` caller, and holds the whole branch + ahead/behind + push recipe    | `git-status-bar.component.ts:147-165`, template `:40-141`                                                                                                                                                                                       | The dock header is a port of this file, not a new design.                                                                                                                                                                                              |
| `GitBranchesService` and `WorktreeService` use raw `window.addEventListener('message')`; `GitStatusService` uses `MESSAGE_HANDLERS`          | `git-branches.service.ts:179-192`, `worktree.service.ts:251`, vs `git-status.service.ts:268-275`                                                                                                                                                | Two conversions, both required by editor CLAUDE.md guideline 1 / core CLAUDE.md guideline 2.                                                                                                                                                           |
| `WorktreeService` already injects `ElectronLayoutService` from `@ptah-extension/core`                                                        | `worktree.service.ts:8-12`                                                                                                                                                                                                                      | The precedent for swapping `WorktreeSectionComponent`'s `EditorService.activeWorkspacePath` (`worktree-section.component.ts:278`) to `ElectronLayoutService.activeWorkspace()` (`electron-layout.service.ts:76-80`) already exists in the same folder. |
| `SourceControlPanelComponent` / `SourceControlFileComponent` inject only `SourceControlService` and take `GitFileStatus` + `OpenDiffRequest` | `source-control-panel.component.ts:232-239`, `source-control-file.component.ts:144-156`                                                                                                                                                         | They move with zero template change, exactly as design-handoff.md:28-30 assumes.                                                                                                                                                                       |
| `DiffViewComponent` has 4 inputs + 1 output and injects no editor coordinator                                                                | `diff-view.component.ts:696-730`                                                                                                                                                                                                                | It is already dock-ready; only its type imports move.                                                                                                                                                                                                  |
| Manifest partitions `RPC_METHOD_NAMES` **exactly**, asserted at boot in dev and by spec                                                      | `manifest.ts:114-389`, `assertManifestInvariants` at `register-rpc-surface.ts:141`, `rpc-allowlist.spec.ts:41,45,50,59,84`                                                                                                                      | Every contract removal is atomic across 6+ files or the app throws on boot.                                                                                                                                                                            |
| Editor/terminal/layout methods are gated by four capabilities                                                                                | `capabilities.ts:50 editorRevert`, `:52 editorHost`, `:56 layoutPersistence`, `:58 pty`; manifest `:358-363`, `:364-369`, `:378`, `:379-383`, `:384-388`                                                                                        | Removing a capability also edits `apps\ptah-extension-vscode\src\di\expected-absent.ts:50-62` and `libs\backend\cli-engine\src\lib\rpc\expected-absent.ts:19-29`.                                                                                      |
| `git:*` has **no** capability — it is ungated on every host                                                                                  | `capabilities.ts:18-61` has no git entry; `manifest.ts` git entry has `requires: []`-equivalent                                                                                                                                                 | The git surface survives the purge without any host-profile work.                                                                                                                                                                                      |
| `SettingsRpcHandlers` is host-agnostic, registered for every host, and already injects `IWorkspaceProvider`                                  | `settings-rpc.handlers.ts:50-73`, ctor `:67-68`; manifest `:226-228`                                                                                                                                                                            | It is the natural, capability-free home for the renamed setting get/set pair.                                                                                                                                                                          |
| `isFileBasedSettingKey` lives in `platform-core`                                                                                             | `apps\ptah-electron\...\editor-rpc.handlers.ts:34`, used `:450`; also `cli-engine\container.ts:486-530`                                                                                                                                         | The write guard travels with the methods at no cost.                                                                                                                                                                                                   |
| `IEditorProvider` is a pure event bus with no Electron imports; `notifyFileOpened` fans out to context auto-include                          | `electron-editor-provider.ts:18,49-53`; consumers `electron-ide-capabilities.ts:151-170` (read half) and `context.service.ts:634-644` (write half)                                                                                              | The Phase-3 launcher must call `notifyFileOpened` or `ptah_ide` tools and auto-include go dark.                                                                                                                                                        |
| `registerSdkServices` runs in phase 2, before handler registration in phase 4                                                                | `apps\ptah-electron\src\di\phase-2-libraries.ts:184`; handlers `phase-4-handlers.ts`                                                                                                                                                            | `SDK_TOKENS.SDK_PROCESS_SPAWNER` is resolvable by a phase-4 handler.                                                                                                                                                                                   |
| The watcher's exclusion predicate is already segment-level and already covers `.nx`, `dist`, `.angular`                                      | `git-watcher.service.ts:450-455`; `workspace-scan.constants.ts:80-97,128-131,156-167`                                                                                                                                                           | The acceptance criterion "a write under `.nx\cache` schedules nothing" is a **pin of existing behaviour**, not a fix.                                                                                                                                  |
| `scheduleTreeRefresh` is one of four schedulers and owns one timer                                                                           | `git-watcher.service.ts:546-578`, timer field `:78`, constants `TREE_DEBOUNCE_MS` :140 / `TREE_MAX_WAIT_MS` :172; call site `:491-493`                                                                                                          | Its removal is surgical and leaves `scheduleUpdate` :681, `scheduleContentChange` :585 and `scheduleGitOpsRefresh` :638 intact.                                                                                                                        |
| Plain Angular feature libs ship exactly 6 files — no `package.json`, no `ng-package.json`                                                    | `libs\frontend\workspace-indexing\`                                                                                                                                                                                                             | `git-ui` mirrors this, not the editor lib's vestigial ng-packagr files.                                                                                                                                                                                |
| The webview eslint ban is on the **bare** specifier only; the skills ban covers subpaths too                                                 | `apps\ptah-extension-webview\eslint.config.mjs:50-69`; `libs\frontend\skill-synthesis-ui\eslint.config.mjs:43-71`                                                                                                                               | Both must be rewritten in the same commit as the alias, or lint goes green on a dead rule.                                                                                                                                                             |
| `no-editor-dependency.spec.ts` matches the specifier **anywhere in a file**, including comments                                              | `libs\frontend\tasks-ui\src\lib\no-editor-dependency.spec.ts:63,107`                                                                                                                                                                            | It cannot merely be retargeted at `git-ui` — tasks-ui is allowed to depend on `git-ui`. Delete it (Phase 4); its purpose ends with the lib.                                                                                                            |

---

## Architecture decision

- **Chosen approach.** Five sequential phases, each its own green commit set, with
  one structural rule: **the git surface is extracted to a new peer lib
  `libs/frontend/git-ui` before anything that hosts it is deleted, and a live
  host for that surface exists before its old host dies.** Concretely:
  Phase 0 removes what has no consumer; Phase 1 removes the terminal
  (a self-contained vertical from xterm to `node-pty` packaging); Phase 2
  carves `git-ui` while the editor lib still compiles by importing from it;
  Phase 3 builds the two replacements the shell needs (a minimal external-editor
  `file:open` and a `GitDockComponent` that arms both git listeners); Phase 4
  deletes the shell and every contract, spec, scene and doc that names it.

- **Rationale.** The editor lib is simultaneously the _only_ frontend git surface
  and the _only_ consumer of the IDE shell (`RR §1`, verified: 6 external import
  sites, of which 4 want git or diff). A single-commit deletion would drop
  `git:status-update` (`git-status.service.ts:269` gate, sole caller
  `editor-panel.component.ts:845`) and the file-link open path
  (`file-path-link.component.ts:78-82`) with nothing to replace them. Extraction
  first, replacement second, deletion last is the only ordering where every
  intermediate state boots. The manifest partition invariant
  (`register-rpc-surface.ts:141`) then forces each phase's contract edits into one
  atomic commit, which is a constraint, not a preference.

- **Rejected alternatives.**
  1. _Delete first, rebuild git afterwards._ Loses the diff view for
     Skill Synthesis (`lazy-diff-view.component.ts:166` plus two drawers) for the
     length of the task and violates CX:112's "green after every phase".
  2. _Move the git surface into `libs/frontend/chat`._ `chat` already hosts
     `electron-shell` and would then own both the dock and the transcript;
     `skill-synthesis-ui` would have to import `chat` for a diff view, which its
     own eslint boundary (`skill-synthesis-ui\eslint.config.mjs:43-71`) exists to
     prevent, and `chat`'s CLAUDE.md §Boundaries excludes non-chat features.
  3. _Move it into `libs/frontend/ui`._ That lib is `scope:shared, type:ui`
     (presentational primitives). The git services call RPC and hold workspace-
     partitioned state; they are a feature, not a primitive.
  4. _Keep `libs/frontend/editor` and shrink it in place._ Fails the "replace,
     do not accumulate" rule and leaves the name, the two eslint bans, the
     `/services` secondary entry and the `no-editor-dependency` guard all lying
     about what the lib is.
  5. _Put the renamed setting methods in a new `preferences:` namespace._ Costs a
     new prefix in `ALLOWED_METHOD_PREFIXES`, a new capability, a new manifest
     entry and two expected-absent edits — for two methods that
     `SettingsRpcHandlers` can serve today with no capability at all.

- **Assumptions.**
  1. `SDK_TOKENS.SDK_PROCESS_SPAWNER` resolves inside a phase-4 Electron handler.
     _Check_: `phase-2-libraries.ts:184` calls `registerSdkServices` before
     `phase-4-handlers.ts` runs — confirm by resolving the token in
     `container.smoke.spec.ts` alongside the existing PTY_HOST aliasing test
     (which is being deleted in Phase 1, so the file is already being edited).
  2. `code` is on `PATH` on the developer/CI machine used for the Phase-3 e2e.
     _Check_: the launcher must treat a spawn failure as a logged, non-throwing
     no-op and return `{ success: false, error }`; the e2e asserts the RPC
     resolves and `notifyFileOpened` fired, never that an editor appeared.
  3. No consumer outside the repo imports `@ptah-extension/editor`.
     _Check_: the lib has no `build` target in `project.json` and is not
     published; `nx graph` after Phase 4 must show zero dependents.

- **Effect on existing code.** Replaced: `libs/frontend/editor` → the git subset
  becomes `libs/frontend/git-ui`, everything else is deleted (~22-24k LOC,
  RR §1). `EditorRpcHandlers` loses `file:open` to a new focused handler and is
  then deleted with the rest of the editor pane surface.
  `EditorDiffSplitHelper` is replaced by `DiffTabsService` — the split-pane half
  is not ported anywhere. Left alone: all 18 `git:*` handlers, `GitInfoService`,
  the recursive `fs.watch`, `FILE_CONTENT_CHANGED`, the `editorWidth`/
  `editorVisible` layout slot, `node-pty` in the **root** `package.json:175`
  (CLI e2e `pty-runner.ts` needs it), Monaco (TASK_2026_386 owns the CodeMirror
  swap).

---

## Component specifications

### 1. `libs/frontend/git-ui` — the new lib shell

- **Purpose.** Own the webview's entire git surface behind one public API.
- **Responsibilities.** Project registration, path alias, lint/test/typecheck
  targets, and a single `src/index.ts` barrel. No secondary entry point — the
  `/services` split existed only to keep xterm out of the initial bundle
  (`apps\ptah-extension-webview\eslint.config.mjs:50-57`), and xterm is gone
  after Phase 1.
- **Verified contracts and entry points.** Scaffolding mirrors
  `libs\frontend\workspace-indexing\` exactly — 6 files, no `package.json`, no
  `ng-package.json` (that pair exists only for `core`, `editor`, `markdown`,
  `tribunal-panel`, `ui`, `webview-e2e-harness`).
  - `libs/frontend/git-ui/project.json` — `"name": "@ptah-extension/git-ui"`,
    `"sourceRoot": "libs/frontend/git-ui/src"`, `"prefix": "ptah"`,
    `"projectType": "library"`, **`"tags": ["scope:webview", "type:feature"]`**,
    targets `test` (`@nx/jest:jest`), `lint` (`@nx/eslint:lint`), `typecheck`
    (`npx ngc --noEmit --project libs/frontend/git-ui/tsconfig.lib.json`) — byte
    for byte the shape of `workspace-indexing\project.json` with the name
    substituted.
  - `libs/frontend/git-ui/jest.config.ts` — `displayName: 'git-ui'`,
    `preset: '../../../jest.preset.js'`,
    `setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts']`,
    `coverageDirectory: '../../../coverage/libs/frontend/git-ui'`, the standard
    `jest-preset-angular` transform and the three snapshot serializers. The
    editor lib's `moduleNameMapper` for `ngx-markdown`
    (`libs\frontend\editor\jest.config.ts:16-24`) is **not** carried over — it
    exists for `CodeEditorComponent`, which is not moving.
  - `libs/frontend/git-ui/eslint.config.mjs` — verbatim
    `workspace-indexing\eslint.config.mjs` (base + `flat/angular` +
    `flat/angular-template` + the two `ptah` selector rules).
  - `libs/frontend/git-ui/tsconfig.json`, `tsconfig.lib.json`,
    `tsconfig.spec.json` — verbatim from `workspace-indexing`.
  - `D:\projects\ptah-extension\tsconfig.base.json` — add, in alphabetical
    position (between `@ptah-extension/editor` at `:95` while it still exists and
    the next key): `"@ptah-extension/git-ui": ["./libs/frontend/git-ui/src/index.ts"]`.
    Single entry point only.
- **Public API (`libs/frontend/git-ui/src/index.ts`) — every moved symbol keeps
  its exact current signature.** Services: `GitStatusService`,
  `GitBranchesService`, `WorktreeService`, `SourceControlService`, plus the new
  `DiffTabsService`. Components: `DiffViewComponent`,
  `SourceControlPanelComponent`, `SourceControlFileComponent`,
  `WorktreeSectionComponent`, plus the new `GitDockComponent` and
  `GitDockHeaderComponent` (Phase 3). Types (all `export type` except the three
  functions): `EditorTab`, `DiffTabState`, `DiffTabStatus`, `DiffComparison`,
  `DiffSideRef`, `OpenDiffRequest`, `HunkApplyRequest`, `HunkApplyFn`, and the
  re-exported `GitApplyHunksOperation`, `GitApplyHunksResult`,
  `GitDiffFileResult`, `GitHunkRef`; functions `diffTabKey`,
  `diffComparisonLabel`, `normalizeDiffPath`, `diffTabLabel`.
  `MonacoLoaderService`, `GIT_READ_ERROR_MESSAGES` and its helpers stay
  **internal** — they are not exported from the editor lib today either.
- **Exact file moves** (`libs/frontend/editor/src/…` → `libs/frontend/git-ui/src/…`):

  | From                                                                                   | To                                                   |
  | -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
  | `lib/services/git-status.service.ts` (+`.spec.ts`)                                     | `lib/services/git-status.service.ts` (+`.spec.ts`)   |
  | `lib/services/git-branches.service.ts` (+`.spec.ts`)                                   | `lib/services/git-branches.service.ts` (+`.spec.ts`) |
  | `lib/services/worktree.service.ts`                                                     | `lib/services/worktree.service.ts`                   |
  | `lib/services/source-control.service.ts`                                               | `lib/services/source-control.service.ts`             |
  | `lib/services/monaco-loader.service.ts`                                                | `lib/services/monaco-loader.service.ts`              |
  | `lib/services/editor/editor-tab.types.ts`                                              | `lib/types/diff-tab.types.ts`                        |
  | `lib/services/editor/git-read-error-messages.ts`                                       | `lib/services/git-read-error-messages.ts`            |
  | _(new, from `lib/services/editor/editor-diff-split.ts` keep-half)_                     | `lib/services/diff-tabs.service.ts` (+`.spec.ts`)    |
  | `lib/diff-view/diff-view.component.ts` (+`.spec.ts`, +`diff-view-dialog.a11y.spec.ts`) | `lib/diff-view/…` (3 files)                          |
  | `lib/source-control/source-control-panel.component.ts` (+`.spec.ts`)                   | `lib/source-control/…`                               |
  | `lib/source-control/source-control-file.component.ts` (+`.spec.ts`)                    | `lib/source-control/…`                               |
  | `lib/worktree/worktree-section.component.ts`                                           | `lib/worktree/worktree-section.component.ts`         |
  | `src/test-setup.ts`                                                                    | `src/test-setup.ts` (copy, 6 lines)                  |

  Not moved, deleted with the lib: `lib/worktree/worktree-panel.component.ts`,
  `lib/worktree/add-worktree-dialog.component.ts` (Phase 0),
  `lib/branch-picker/*` (Phase 4 — its 7 RPCs stay, the popover UI does not),
  `lib/git-status-bar/git-status-bar.component.ts` (Phase 4 — ported into
  `GitDockHeaderComponent`), `src/testing/ngx-markdown.stub.ts`.

- **Dependencies.** `@angular/core`, `@angular/common`, `@angular/forms`,
  `lucide-angular`, `monaco-editor` (type-only + runtime via the loader),
  `@ptah-extension/shared`, `@ptah-extension/core`. It must **not** depend on
  `@ptah-extension/chat`, `@ptah-extension/editor`, `@ptah-extension/ui`
  (nothing moving imports `ui` — only the branch-picker did, and it stays behind).
- **Integration points.** `app.config.ts` (providers), `electron-shell.component.ts`
  (dock mount), `lazy-diff-view.component.ts` (lazy diff), `tasks-ui` is
  permitted to depend on it.
- **Failure behaviour.** Not applicable at lib level.
- **Quality requirements.** A new `"type": "bundle"` budget entry in
  `apps\ptah-extension-webview\project.json` (after `:62-73`) naming the lazy
  git-ui chunk, with `maximumError` set from the first measured build; CX:123.
- **Verification seam.** `npx nx run-many -t lint typecheck test -p @ptah-extension/git-ui`
  plus `npx nx graph` showing no edge from `git-ui` to `editor`.
- **Files.** CREATE `libs/frontend/git-ui/{project.json,jest.config.ts,eslint.config.mjs,tsconfig.json,tsconfig.lib.json,tsconfig.spec.json}`, `libs/frontend/git-ui/src/{index.ts,test-setup.ts}`. MODIFY `D:\projects\ptah-extension\tsconfig.base.json`, `D:\projects\ptah-extension\apps\ptah-extension-webview\project.json`.

### 2. `GitStatusService` (moved)

- **Purpose.** Workspace-partitioned git status, fed by `git:status-update` pushes.
- **Responsibilities.** The existing set minus the two tree-only derivations.
- **Verified contracts.** `MessageHandler` gate `git-status.service.ts:268-275`;
  `startListening`/`stopListening` `:286-290`/`:296-300`; per-workspace cache and
  its 5 s TTL `:73-89`; `activeWorkspacePath` `:196`.
  **Drop** `fileStatusMap` `:142-153` and `changedDirPrefixes` `:180-194` — both
  exist solely for `FileTreeNodeComponent` (doc `:141`, `:157-160`), and their
  B3 specs (`git-status.service.spec.ts`, `file-tree/perf-m2-*.spec.ts`) go with
  them. Every other public member keeps its signature.
- **Dependencies.** `VSCodeService`, `rpcCall` (`@ptah-extension/core`), shared
  git types. Direction unchanged: `git-ui → core → shared`.
- **Integration points.** Registered as `MESSAGE_HANDLERS` in `app.config.ts:185`
  (import specifier changes only); armed by `GitDockComponent` (Component 9).
- **Failure behaviour.** Unchanged — a failed `git:info` leaves the previous
  slice and clears `isLoading`.
- **Quality requirements.** Removing the two computeds must not change any
  signal identity used by `SourceControlPanelComponent` (`files()` only).
- **Verification seam.** `git-status.service.spec.ts` minus the B3 blocks;
  `editor-message-routing.spec.ts` (repointed) still proves a
  `git:status-update` reaches `handleMessage` through `MessageRouterService`.
- **Files.** MOVE + MODIFY as in Component 1.

### 3. `GitBranchesService` (moved, listener converted)

- **Purpose.** Branch list, stash count, last commit, recent-branch persistence.
- **Responsibilities.** Unchanged, plus: stop owning a `window` listener.
- **Verified contracts.** Raw listener `git-branches.service.ts:179-192`;
  `startListening` gate `:175-177`; `refreshForCauses(payload?.causes)` `:189`;
  workspace filter `:183-187`. Convert to
  `implements MessageHandler` with `handleMessage(message)` filtering
  `MESSAGE_TYPES.GIT_STATUS_UPDATE` behind the same `_isListening` gate — i.e.
  the exact shape of `git-status.service.ts:268-275`. `startListening()` /
  `stopListening()` keep their names and their idempotence so
  `GitDockHeaderComponent` calls them unchanged.
- **Dependencies.** Gains nothing; loses `window`.
- **Integration points.** A new `{ provide: MESSAGE_HANDLERS, useExisting: GitBranchesService, multi: true }` entry in `app.config.ts` beside the existing two at `:183-185`. **Without it the conversion silently deafens the service** — `MessageRouterService` builds its map from the multi-provider at construction (`libs\frontend\core\CLAUDE.md` §Key Files).
- **Failure behaviour.** Unchanged; `refreshForCauses` already swallows.
- **Quality requirements.** Not applicable.
- **Verification seam.** Rewrite the raw-listener block of
  `git-branches.service.spec.ts` (RR names `:397-463`) to dispatch through
  `handleMessage` instead of `window.dispatchEvent`; add one assertion that a
  push arriving before `startListening()` is dropped.
- **Files.** MOVE + MODIFY. MODIFY `apps\ptah-extension-webview\src\app\app.config.ts`.

### 4. `WorktreeService` (moved, listener converted)

- **Purpose.** Worktree CRUD, workspace-folder registration, async op correlation.
- **Responsibilities.** Unchanged.
- **Verified contracts.** Raw listener `worktree.service.ts:216-258`,
  `window.addEventListener` `:251`; type filter `:220`; `operationId`
  correlation `:227-239`; `layoutService.addFolderByPath` `:243`; 5-minute
  pending-op timeout `:21`. Convert to `MessageHandler` on the
  `'git:worktreeChanged'` type. **The wire contract must not move**: four
  producer call sites broadcast it — `git-rpc.handlers.ts:370`,
  `ptah-api-builder.service.ts:874`, `sdk-callbacks.ts:356` and `:374` — and
  `tasks-store.service.ts:47-52` cites this message as the precedent for its own
  router-dispatched type. `'git:worktreeChanged'` is dispatched by type string
  and is **not** in `MESSAGE_TYPES`; the handler must therefore match the literal,
  as `tasks-store.service.ts` does.
- **Dependencies.** Already injects `ElectronLayoutService` (`:8-12`).
- **Integration points.** Add a fourth `MESSAGE_HANDLERS` provider in `app.config.ts`.
- **Failure behaviour.** Pending ops still time out and reject; `destroyRef`
  cleanup drops the listener removal and keeps the timer clearing.
- **Quality requirements.** Not applicable.
- **Verification seam.** A new spec asserting that a `git:worktreeChanged`
  `{action:'created', operationId}` routed through `handleMessage` resolves the
  matching pending op and calls `addFolderByPath`.
- **Files.** MOVE + MODIFY.

### 5. `SourceControlService` (moved)

- **Purpose.** Thin RPC wrapper for stage / unstage / discard / commit / showFile.
- **Responsibilities.** Unchanged.
- **Verified contracts.** `source-control.service.ts:1-29` — injects
  `VSCodeService` and `GitStatusService`, no state. All five RPCs are in the
  18-method `git:*` set (`git-rpc.handlers.ts:98-115`) and four of them are also
  CLI-consumed (`apps\ptah-cli\src\cli\commands\git.ts:219,248,283,312,340`).
- **Dependencies / Integration / Failure / Quality.** Unchanged.
- **Verification seam.** `source-control-panel.component.spec.ts` (moved) exercises it.
- **Files.** MOVE only.

### 6. `DiffTabsService` — the git-owned keep-half of `EditorDiffSplitHelper`

**This is the named service CX:56-57 asks for.** `DiffTabsService`, at
`libs/frontend/git-ui/src/lib/services/diff-tabs.service.ts`,
`@Injectable({ providedIn: 'root' })`.

- **Purpose.** Own the set of open diff tabs and everything that keeps them
  truthful: opening, revalidation and hunk application.
- **Responsibilities.** (a) hold `diffTabs: WritableSignal<EditorTab[]>` and
  `activeDiffKey: WritableSignal<string | null>`, with `activeDiffTab` and
  `openDiffKeys` as `computed`; (b) `openDiff(request: OpenDiffRequest)`;
  (c) `onGitStatusUpdate(workspaceRoot?)` / `onFileContentChanged(absolutePath)`
  revalidation; (d) `refreshDiffTab(key)` / `refreshAllDiffTabs()`;
  (e) `applyHunks(request: HunkApplyRequest)` with the snapshot-token guard;
  (f) `closeDiff(key)` and `dispose()`.
- **Verified contracts and entry points.** Ported verbatim from
  `libs\frontend\editor\src\lib\services\editor\editor-diff-split.ts`:
  `requestDiff` `:684` (the single `git:diffFile` RPC), `toDiffState` `:704`,
  `transportFailureState` `:753`, `labelFor` `:784`, `applyFreshDiff` `:798`,
  `patchDiff` `:820`, `toWorkspaceRelative` `:838`; the fields
  `DIFF_REFRESH_DEBOUNCE_MS` `:68`, `inFlightDiffRefreshes` `:76`,
  `refreshDebounceTimers` `:79-82`; and the public bodies of `openDiff` `:113`,
  `onGitStatusUpdate` `:180`, `onFileContentChanged` `:202`,
  `refreshAllDiffTabs` `:214`, `refreshDiffTab` `:230`, `applyHunks` `:307`,
  `dispose` `:372` with their `state.openTabs` / `tabs.*` calls rewritten
  against the service's own signals. `SELECTION_SUPERSEDED_MESSAGE` `:41-42`
  and `APPLY_TRANSPORT_MESSAGE` `:45` move with it.
  **Not ported:** the nine split-pane public members `:394`–`:613` and the five
  private ones `:626`–`:669`, `MIRROR_DEBOUNCE_MS` `:92`, `mirrorTimer` `:95`.
  It exposes an `applyHunksFn: HunkApplyFn` bound method so
  `DiffViewComponent`'s `applyHunks` input (`diff-view.component.ts:722`) is
  satisfied without the component injecting anything.
  `EditorInternalState.showError` is replaced by a local
  `errorMessage: Signal<string | null>` the dock renders; there is no editor
  coordinator left to route to.
- **Dependencies.** `VSCodeService` + `rpcCall`, `GitStatusService` (to read
  the active workspace path that `state.getActiveWorkspacePath()` supplied),
  the moved `git-read-error-messages.ts`, the moved diff types. Direction:
  `DiffTabsService → GitStatusService`, never the reverse.
- **Integration points.** `GitDockComponent` binds `activeDiffTab()` /
  `openDiffKeys()` / `applyHunksFn` into `DiffViewComponent`;
  `SourceControlPanelComponent.diffRequested` (`source-control-panel.component.ts:239`)
  is its `openDiff` source; `retryRequested` (`diff-view.component.ts:730`) maps
  to `refreshDiffTab`. It subscribes to `FILE_CONTENT_CHANGED` and
  `GIT_STATUS_UPDATE` as a `MessageHandler` (a fifth `app.config.ts` provider) —
  which is what makes CX:95's "keep `FILE_CONTENT_CHANGED`" load-bearing.
- **Failure behaviour.** Preserved exactly: `refreshing` / `stale` / `error`
  never blank the previously-rendered content (`editor-tab.types.ts:29-31`); a
  transport failure yields `transportFailureState`; an apply whose
  `snapshotToken` no longer matches is refused with
  `SELECTION_SUPERSEDED_MESSAGE` and nothing is written.
- **Quality requirements.** One `git:diffFile` per workspace per 250 ms burst
  (`:68`), never more than one in flight per key (`:76`).
- **Verification seam.** Port `editor-diff-split.spec.ts` (1512 lines) to
  `diff-tabs.service.spec.ts`, dropping every split-pane block. The A1/A2/A3 and
  D2 assertions — revalidate-on-reopen, per-comparison keys, sanitized error
  copy, stale-token refusal — must all survive.
- **Files.** CREATE `libs/frontend/git-ui/src/lib/services/diff-tabs.service.ts` + `.spec.ts`. DELETE `libs/frontend/editor/src/lib/services/editor/editor-diff-split.ts` + `.spec.ts` (Phase 4).

### 7. `DiffViewComponent` + `MonacoLoaderService` (moved unchanged)

- **Purpose.** Render a Monaco diff with optional glyph-margin hunk staging.
- **Responsibilities.** Unchanged. Monaco stays in this task (CX:66).
- **Verified contracts.** The four inputs and one output at
  `diff-view.component.ts:696-730` — `diffTab: EditorTab | null`,
  `openDiffKeys: readonly string[]`, `showHeader: boolean`,
  `applyHunks: HunkApplyFn | null`, `retryRequested: output<string>` — are frozen
  by design-handoff.md:31 and must not change. The only edits are the import
  specifiers at `:38` (loader) and `:39-45` (types), and the two RPC method
  names at `:1432` / `:1449` (Component 11).
- **Dependencies.** `MonacoLoaderService` (internal), `VSCodeService`,
  `rpcCall`, moved diff types, `monaco-editor`.
- **Integration points.** `GitDockComponent`, and
  `skill-synthesis-ui\src\lib\components\clones\lazy-diff-view.component.ts:166`
  which constructs it dynamically and sets three of the four inputs.
- **Failure behaviour.** Unchanged: loader poll 100 ms / 20 s cap
  (`monaco-loader.service.ts:150-161`), 30-pair LRU (`diff-view.component.ts:691`).
- **Quality requirements.** The lazy boundary must survive: `lazy-diff-view`
  keeps its runtime `import()`, and the skills eslint ban is retargeted, not
  dropped.
- **Verification seam.** `diff-view.component.spec.ts` (2006 lines) and
  `diff-view-dialog.a11y.spec.ts` move unchanged except imports; the
  `skill-synthesis-ui` mock must be retargeted (below).
- **Files.** MOVE 3 diff-view files + `monaco-loader.service.ts`. MODIFY
  `libs\frontend\skill-synthesis-ui\src\lib\components\clones\lazy-diff-view.component.ts:166`,
  `libs\frontend\skill-synthesis-ui\jest.config.ts:23`
  (`'^@ptah-extension/editor$'` → `'^@ptah-extension/git-ui$'`),
  RENAME `libs\frontend\skill-synthesis-ui\src\__mocks__\ptah-editor.ts` →
  `ptah-git-ui.ts` (its 3 declared inputs already match),
  MODIFY `libs\frontend\skill-synthesis-ui\eslint.config.mjs:43-71`.

### 8. Source-control and worktree components (moved)

- **Purpose.** The working-tree file list, commit composer, and worktree section.
- **Responsibilities.** Unchanged.
- **Verified contracts.** `SourceControlPanelComponent` — selector
  `ptah-source-control-panel`, `files = input.required<GitFileStatus[]>()`
  (`:235`), outputs `fileClicked: output<string>` (`:237`) and
  `diffRequested: output<OpenDiffRequest>` (`:239`); it renders
  `<ptah-worktree-section />` at `:227`.
  `SourceControlFileComponent` — selector `ptah-source-control-file`, inputs
  `file` / `staged` (`:144-145`), outputs `stage` / `unstage` / `discard` /
  `openDiff` / `openFile` (`:147-156`). Both are named as reused-as-is by
  design-handoff.md:28-29, so **no signature may change**.
  `WorktreeSectionComponent` — selector `ptah-worktree-section`; the one edit is
  `isActiveWorktree` at `worktree-section.component.ts:277-283`, which reads
  `this.editorService.activeWorkspacePath` (`:256`). Replace with
  `this.layoutService.activeWorkspace()?.path ?? null`
  (`electron-layout.service.ts:76-80`); `ElectronLayoutService` is **already
  injected** at `:257`, so the `EditorService` injection at `:256` and its import
  at `:19` are simply deleted.
- **Dependencies.** `lucide-angular`, `FormsModule`, `SourceControlService`,
  `WorktreeService`, `ElectronLayoutService`, shared git types.
- **Integration points.** Hosted by `GitDockComponent` (was
  `sidebar.component.ts:19,116-121`, which is deleted in Phase 4).
- **Failure behaviour.** Unchanged — add/remove errors render inline
  (`worktree-section.component.ts:274-276`).
- **Quality requirements.** The per-instance `aria-controls` ids
  (`source-control-panel.component.ts:243-247`, D1 AC3/AC4) must survive; the
  dock mounts exactly one instance, but the guard stays.
- **Verification seam.** `source-control-panel.component.spec.ts` (427) and
  `source-control-file.component.spec.ts` (255) move; add one
  `worktree-section` test asserting the active-worktree highlight now tracks
  `ElectronLayoutService.activeWorkspace()`.
- **Files.** MOVE 4 files + 2 specs. MODIFY `worktree-section.component.ts`.

### 9. `GitDockComponent` + `GitDockHeaderComponent` (Phase 3, new)

- **Purpose.** Be the live host for the git surface in the Electron shell's
  right dock, so `git:status-update` pushes have somewhere to land.
- **Responsibilities.** `GitDockComponent`: arm and disarm the two listeners,
  compose header + source-control panel + diff view, own the split between the
  file list and the diff. `GitDockHeaderComponent`: branch name, ahead/behind,
  stash count, push.
- **Verified contracts and entry points.**
  - Selectors and layer come from design-handoff.md:16-17:
    `ptah-git-dock` (template, no inputs, root-mounted like
    `EditorPanelComponent` was, `data-testid="git-dock"`) and
    `ptah-git-dock-header` (organism, `data-testid="git-dock-header"`).
    TASK_2026_386 adds `activeTab` / `tabChange` / `openInRequested` to the
    header; this task ships it with **no** inputs or outputs and reads its state
    from the two injected services, which is a strict subset and does not
    contradict the handoff.
  - **Arming.** `GitDockComponent`'s constructor calls
    `gitStatus.startListening()` (`git-status.service.ts:286`) and
    `gitBranches.startListening()` + `void gitBranches.refreshBranches()`
    (`git-status-bar.component.ts:163-164`), and registers
    `destroyRef.onDestroy` to call both `stopListening()`s. This replaces
    `editor-panel.component.ts:845` and `git-status-bar.component.ts:162-165`.
    `startListening` performs an eager fetch (`git-status.service.ts:289`), which
    is what makes re-arming after a dock close idempotent — the same
    reconcile-on-arm property editor CLAUDE.md guideline 6 documents.
  - **Header content** is a direct port of `git-status-bar.component.ts:40-141`:
    `gitBranches.currentBranch() || gitStatus.branchName()`,
    `gitStatus.branch().ahead` / `.behind` gated on `.upstream`,
    `gitBranches.stashCount()`, and the `data-testid="git-push-button"` button
    shown only when `ahead > 0` calling `gitBranches.push()`. **Keep that
    `data-testid`** — `editor.spec.ts:186-193` asserts on it and the retargeted
    spec reuses the assertion. The branch-picker dropdown and details popover
    (`:94-104`) are **not** ported; their 7 RPCs stay in the contract for
    TASK_2026_386.
  - **Body wiring.** `<ptah-source-control-panel [files]="gitStatus.files()"
(diffRequested)="diffTabs.openDiff($event)" (fileClicked)="onFileClicked($event)" />`
    and `<ptah-diff-view [diffTab]="diffTabs.activeDiffTab()"
[openDiffKeys]="diffTabs.openDiffKeys()" [applyHunks]="diffTabs.applyHunksFn"
(retryRequested)="diffTabs.refreshDiffTab($event)" />`, the diff shown only
    when `activeDiffTab()` is non-null. `onFileClicked` routes to `file:open`
    (Component 10) — a file name click opens the external editor, matching
    CX:70-76.
  - **Mount.** `electron-shell.component.ts` — the `effect()` at `:298-311`
    changes its dynamic import to `import('@ptah-extension/git-ui').then(m => this.editorComponent.set(m.GitDockComponent))`;
    the signal is renamed `dockComponent`; the slot markup at `:252-282` is
    unchanged except the `ptah-sidebar-tab label="Editor"` at `:277-282` becomes
    `label="Git"` and its `aria-label`/`title` become `Toggle Git panel`. The
    `layout.editorPanelVisible()` / `editorPanelWidth()` signals stay
    (correction #15).
- **Dependencies.** `GitStatusService`, `GitBranchesService`, `DiffTabsService`,
  `SourceControlPanelComponent`, `DiffViewComponent`, `lucide-angular`.
- **Integration points.** `electron-shell.component.ts`; the docs shot and the
  retargeted e2e.
- **Failure behaviour.** No git repo → `gitStatus.isGitRepo()` false → header
  hidden (same guard as `git-status-bar.component.ts:40`) and the panel shows
  its existing "No changes" empty state. A `git:push` failure leaves
  `isPushing` false and surfaces through the existing service error.
- **Quality requirements.** `ChangeDetectionStrategy.OnPush`, `inject()` only,
  new control flow — `chat`/`core` CLAUDE.md conventions. Accessibility: keep
  `role="status"` + `aria-label="Git status"` on the header
  (`git-status-bar.component.ts:44-45`), because the retargeted e2e locator
  depends on it.
- **Verification seam.** New Electron e2e (CX:120): mount the dock, inject a
  synthetic `git:status-update` push via `ui.pushEvent`, assert the file count
  and branch update. Plus a jest spec asserting the constructor arms both
  services and `ngOnDestroy` disarms both.
- **Files.** CREATE `libs/frontend/git-ui/src/lib/git-dock/git-dock.component.ts` (+`.spec.ts`), `libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.ts`. MODIFY `libs\frontend\chat\src\lib\components\templates\electron-shell.component.ts`.

### 10. `ElectronFileOpenRpcHandlers` (Phase 3, new) — minimal `file:open`

- **Purpose.** On Electron, make `file:open` launch the user's external editor
  instead of reading bytes for a Monaco tab, while keeping `IEditorProvider`
  alive.
- **Responsibilities.** Exactly one method, `file:open`. Nothing else.
  **Deliberately minimal**: no editor detection, no target list, no remembered
  choice, no deep links — `IEditorLauncher` and `EditorTarget[]` are
  TASK_2026_386 (design-handoff.md:40).
- **Verified contracts and entry points.**
  - Params/result are unchanged: `file:open` at `rpc.types.ts:689` /
    `RPC_METHOD_ENTRIES:3412`, `{ path, line? }` per
    `claude-rpc.service.ts:284-289`.
  - **Ownership move.** `apps\ptah-electron\src\rpc-host-profile.ts:44` changes
    from `'host.fileOpen': EditorRpcHandlers` to
    `'host.fileOpen': ElectronFileOpenRpcHandlers`. `manifest.ts:378`
    (`{ key: 'host.fileOpen', methods: ['file:open'], requires: ['fileOpen'] }`)
    is untouched — the capability and the manifest entry already exist, only the
    binding moves. VS Code keeps `FileRpcHandlers` (`rpc-host-profile.ts:32`).
    Register the class in `apps\ptah-electron\src\di\phase-4-handlers.ts` beside
    the existing `EditorRpcHandlers` registration (`:168`).
  - **Path guard.** Reuse `isPathWithinRoots`
    (`libs\backend\platform-core\src\utils\path-containment.ts:71`, re-exported
    `platform-core\src\index.ts:95`) against
    `workspaceProvider.getWorkspaceFolders()`. This preserves the containment
    check `EditorRpcHandlers.handleFileOpen` (`:262-283`) performs via
    `validatePathInWorkspace`, without importing the class that is about to die.
  - **Spawn.** Inject `IProcessSpawner` under `SDK_TOKENS.SDK_PROCESS_SPAWNER`
    (`libs\backend\agent-sdk\src\lib\di\tokens.ts:51`; correction #21) and call
    `spawnProcess({ command: 'code', args: ['-g', line ? `${path}:${line}` : path], cwd: <workspace root>, env: process.env, detached: process.platform !== 'win32', needsConsole: false })` —
    the exact request shape at
    `libs\backend\cli-agent-runtime\...\cli-adapter.utils.ts:258-269`, with the
    `detached` platform guard that helper applies verbatim (`:258`). Do not await
    the child; `spawnProcess` returns immediately by contract
    (`process-spawner.interface.ts:80-81`). Attach an `on('error')` listener that
    logs at `warn`.
  - **Notify.** Call `this.editorProvider.notifyFileOpened(filePath)`
    (`electron-editor-provider.ts:49-53`) on the success path — the same call
    `editor-rpc.handlers.ts:282` makes today. This is what keeps
    `electron-ide-capabilities.ts:151-170` (the `ptah_ide` MCP editor tools) and
    `context.service.ts:634-644` (context auto-include) alive; RR §5.3.
  - **Frontend collapse.** `libs\frontend\chat-ui\src\lib\atoms\file-path-link.component.ts` —
    delete the `isElectron` branch (`:78-82`) and the whole
    `openFileInElectron` method (`:85-100`), leaving
    `void this.rpcService.openFile(filePath)`. This also removes the last
    `@ptah-extension/editor` import from `chat-ui`.
- **Dependencies.** `TOKENS.LOGGER`, `TOKENS.RPC_HANDLER`,
  `PLATFORM_TOKENS.WORKSPACE_PROVIDER`, `PLATFORM_TOKENS.EDITOR_PROVIDER`,
  `SDK_TOKENS.SDK_PROCESS_SPAWNER`. Five deps, well under the ~8 ceiling.
- **Integration points.** `file-path-link.component.ts` (transcript links),
  `tasks-store.service.ts:1362` (`openArtifact` — silently fixed, correction #17).
- **Failure behaviour.** Path outside every workspace root → `{ success: false, error: 'Path is outside the workspace' }`, no spawn. Spawn throws or the child errors → logged at `warn`, `{ success: false, error }` returned. **Never throws**, and never blocks on the child.
- **Quality requirements.** Security: the workspace-containment check is not optional — `file:open` takes a caller-supplied absolute path. Zod schema for the params per rpc-handlers CLAUDE.md ("Zod schemas mandatory").
- **Verification seam.** Unit spec with a fake `IProcessSpawner`: asserts the argv is `['-g', 'C:\\ws\\a.ts:12']`, that `notifyFileOpened` fired with the same path, that an out-of-workspace path spawns nothing, and that a throwing spawner yields `{success:false}` rather than a rejection.
- **Files.** CREATE `apps/ptah-electron/src/services/rpc/handlers/file-open-rpc.handlers.ts` (+`.spec.ts`, +`file-open-rpc.schema.ts`). MODIFY `apps\ptah-electron\src\rpc-host-profile.ts`, `apps\ptah-electron\src\di\phase-4-handlers.ts`, `apps\ptah-electron\src\services\rpc\handlers\index.ts`, `libs\frontend\chat-ui\src\lib\atoms\file-path-link.component.ts`.

### 11. `settings:get` / `settings:set` — the renamed setting pair

- **Purpose.** Give the diff view's layout preference a home that does not
  contain the word "editor" and does not need a capability.
- **Responsibilities.** Read and write one `ptah` configuration key through
  `IWorkspaceProvider`, with the file-based-key write guard.
- **Verified contracts.** `SettingsRpcHandlers`
  (`libs\backend\rpc-handlers\src\lib\handlers\settings-rpc.handlers.ts:50`)
  already injects `PLATFORM_TOKENS.WORKSPACE_PROVIDER` (`:67-68`) and already
  calls `setConfiguration('ptah', key, value)` (`:262`). Its manifest entry
  (`manifest.ts:226-228`) is capability-free, so **every** host gets the pair —
  which removes two entries from each expected-absent list instead of adding
  any. The two bodies are lifted verbatim from
  `apps\ptah-electron\...\editor-rpc.handlers.ts:414-440` (get) and `:443-478`
  (set), including the `isFileBasedSettingKey` guard at `:450`
  (`@ptah-extension/platform-core`).
  **The rename must also fix correction #11**: add
  `'diff.renderSideBySide'` to `FILE_BASED_SETTINGS_KEYS`
  (`libs\backend\platform-core\src\file-settings-keys.ts`, beside `:208`) and
  `'diff.renderSideBySide': true` to `FILE_BASED_SETTINGS_DEFAULTS` (beside
  `:480`), and change `DIFF_LAYOUT_SETTING_KEY`
  (`diff-view.component.ts:142`) from `'editor.diff.renderSideBySide'` to
  `'diff.renderSideBySide'`. Without this the preference keeps silently failing
  to persist.
- **Dependencies.** None new.
- **Integration points.** `diff-view.component.ts:1432` → `'settings:get'`,
  `:1449` → `'settings:set'`. `vim-mode.service.ts:69,89` is deleted in Phase 0
  and is not migrated.
- **Failure behaviour.** Unchanged from the lifted bodies: missing key →
  `{ success:false, error:'key is required' }`; non-file-based key on write →
  `{ success:false, error:"Setting key '…' is not writable" }`.
- **Quality requirements.** Zod schema in `settings-rpc.schema.ts` (new file —
  the class has no param schema today because both existing methods are
  parameterless).
- **Verification seam.** `rpc-allowlist.spec.ts` proves the partition still
  holds; both host `rpc-surface.spec.ts` files prove the pair is now _present_
  on VS Code and CLI; a `SettingsRpcHandlers` spec proves the write guard.
- **Files.** MODIFY `libs\backend\rpc-handlers\src\lib\handlers\settings-rpc.handlers.ts`, CREATE `libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.schema.ts`, MODIFY `libs\shared\src\lib\types\rpc.types.ts`, `libs\backend\rpc-handlers\src\lib\host-profile\manifest.ts`, `libs\backend\platform-core\src\file-settings-keys.ts`, and the three expected-absent lists.

### 12. `GitWatcherService` reduction + exclusion-set collapse

- **Purpose.** Stop producing a push nothing consumes, and stop the ignore-list
  policy from lying about what it is for.
- **Responsibilities.** Keep the recursive `fs.watch`, the git-status job, the
  content-change job and the git-ops job. Drop the tree job.
- **Verified contracts and entry points.**
  - **Delete** `scheduleTreeRefresh()` (`git-watcher.service.ts:546-578`), its
    call site `:491-493`, the field `treeDebounceTimer` `:78` and
    `treeBurstStartedAt`, and the constants `TREE_DEBOUNCE_MS` `:140` and
    `TREE_MAX_WAIT_MS` `:172`. **Keep** `scheduleUpdate` `:681`,
    `scheduleContentChange` `:585`, `scheduleGitOpsRefresh` `:638`, and the
    recursive watcher `:478-499` — RR §5.2: the `'workspace'` cause is how agent
    working-tree edits surface at all.
  - **`EDITOR_REREAD_OPEN_TABS`** is broadcast at `:654` inside
    `scheduleGitOpsRefresh`, **not** inside the tree job (correction to RR §4,
    which grouped them). Remove that one line and the `EDITOR_REREAD_OPEN_TABS`
    alias; the surrounding `fetchAndPush()` at `:653` stays.
  - **Exclusion sets.** `TREE_HIDDEN_DIRS`
    (`libs\shared\src\lib\constants\workspace-scan.constants.ts:80-97`) loses its
    only consumer when the tree builder dies. Collapse the two sets into one
    exported `WATCH_IGNORED_DIRS` holding the current union — `.git`, `.hg`,
    `.svn`, `.DS_Store`, `.Trash`, `.cache`, `.tmp`, `.temp`, `.nx`,
    `node_modules`, `dist`, `.angular` — delete `TREE_HIDDEN_DIRS`, and rewrite
    the 70-line header so it documents one question ("should a write here
    schedule a `git status`?") instead of two.
  - **`coverage` and `tmp`.** `.nx`, `.angular` and `dist` are already members,
    so CX:102's stated goal is already met (correction #12). `coverage` and `tmp`
    are the only genuinely new names, and the module argues against `coverage`
    **by name** at `:21-27`. **Decision: add `coverage` and `tmp`, and replace
    that paragraph rather than contradict it silently.** The paragraph's
    conservatism rule was written when one set served the file explorer, where an
    over-broad name hides a directory the user wanted to see. With the explorer
    gone the only cost is a missed `git status` refresh, and both names are
    conventionally git-ignored build output. Record the reasoning in the header
    and pin it: a spec asserting `coverage/lcov.info` and `tmp/x` are excluded,
    and — as the counterweight the old paragraph was protecting — that `out`,
    `build`, `.next` and `.turbo` are **not**.
  - **Re-home the derivation pin.** `editor-rpc.handlers.spec.ts:1-49` is the
    `EXCLUDED_DIRS_GLOB` suite that proves the glob is derived from the shared
    set rather than restated (correction #22); `workspace-scan.constants.ts:62-65`
    points at it by name. Both the glob and the spec die with
    `EditorRpcHandlers`. Move the surviving assertions into
    `libs\shared\src\lib\constants\workspace-scan.constants.spec.ts` and update
    the `:62-65` reference.
- **Dependencies.** Unchanged.
- **Integration points.** `FILE_TREE_CHANGED` loses its only producer; the
  message type and payload go in Phase 4.
- **Failure behaviour.** Unchanged. The dedicated `.git/*` watchers remain
  outside the exclusion predicate (`:469-474`) — routing them through it would
  stop every commit, stage and checkout from being detected.
- **Quality requirements.** Performance: one fewer debounce timer and one fewer
  broadcast per rename burst.
- **Verification seam.** CX:122 — a spec asserting a write under `.nx\cache`
  schedules **nothing** (a pin of already-correct behaviour, stated as such in
  the test name), plus the new `coverage` / `tmp` / negative-control
  assertions. Delete the five tree-refresh tests in
  `git-watcher.service.spec.ts` (`:95`, `:121`, `:370`, `:444`, `:464`).
- **Files.** MODIFY `apps\ptah-electron\src\services\git-watcher.service.ts` + `.spec.ts`, `libs\shared\src\lib\constants\workspace-scan.constants.ts` + `.spec.ts`.

### 13. The wire-contract surface (the atomic edit set)

- **Purpose.** Keep the manifest partition total and disjoint at every commit.
- **Responsibilities.** For each phase, one commit touching every site below.
- **Verified contracts and entry points.** The seven sites, all confirmed:
  1. `libs\shared\src\lib\types\rpc.types.ts` — **both** the
     `RpcMethodRegistry` interface (opens `:626`) **and** the
     `RPC_METHOD_ENTRIES: Record<RpcMethodName, true>` map (opens `:3391`).
     `_AssertAllRpcMethodsListed` at `:3813-3819` fails the build if they
     disagree.
  2. `libs\backend\rpc-handlers\src\lib\host-profile\manifest.ts` — the
     `EDITOR_PANE_METHODS` tuple `:99-112`, the `layout` entry `:358-363`, the
     `terminal` entry `:364-369`, and the three host-owned entries `:378`,
     `:379-383`, `:384-388`.
  3. `libs\backend\rpc-handlers\src\lib\host-profile\capabilities.ts` —
     `editorRevert` `:50`, `editorHost` `:52`, `layoutPersistence` `:56`,
     `pty` `:58`.
  4. `libs\backend\vscode-core\src\messaging\rpc-handler.ts` —
     `ALLOWED_METHOD_PREFIXES` (opens `:44`): `'editor:'` `:67`, `'layout:'`
     `:68`, `'terminal:'` `:72`.
  5. Host profiles — `apps\ptah-electron\src\rpc-host-profile.ts` (`pty` `:40`,
     `hostHandlers` `:44-46`), `apps\ptah-extension-vscode\src\rpc-host-profile.ts`
     (`:24-34`), `libs\backend\cli-engine\src\lib\rpc\cli-host-profile.ts`.
  6. The three expected-absent lists —
     `apps\ptah-extension-vscode\src\di\rpc-surface.spec.ts`
     (`VSCODE_EXPECTED_ABSENT_METHODS` `:34-194`),
     `libs\backend\cli-engine\src\lib\rpc\rpc-surface.spec.ts`
     (`CLI_EXPECTED_ABSENT_METHODS` `:35-63`),
     `apps\ptah-extension-vscode\src\di\expected-absent.ts`
     (`EXPECTED_ABSENT_CAPABILITIES` `:50-62`) and its cli-engine sibling
     `libs\backend\cli-engine\src\lib\rpc\expected-absent.ts:19-29`.
  7. `libs\shared\src\lib\types\messages\message-constants.ts` +
     `payload-map.ts` for the push types.
- **Failure behaviour.** `assertManifestInvariants` runs at boot in development
  (`register-rpc-surface.ts:140-142`), so a partial edit is a **startup throw**,
  not a silent regression. `rpc-allowlist.spec.ts` catches it earlier.
- **Verification seam.** `npx nx run-many -t test -p @ptah-extension/rpc-handlers @ptah-extension/cli-engine ptah-extension-vscode` after every contract edit.
- **Files.** MODIFY the seven above, per phase.

### 14. Showcase, e2e and docs retarget

- **Purpose.** Leave no capture, scene or page pointing at a deleted surface.
- **Verified contracts and entry points.**
  - `apps\ptah-electron-e2e\src\docs-screenshots\editor-git.shot.ts` (133 lines).
    Delete the file-tree block `:63-88` and the `file-tree-panel` shot `:86-88`.
    Repoint: `:91` `ptah-git-status-bar` → `ptah-git-dock-header`; `:98-101` the
    `getByRole('tab', {name:/^Git\b/})` click disappears (the dock has no tab
    rail in this task); `:102` `ptah-source-control-panel` unchanged; `:122`
    `ptah-diff-view` unchanged; `:125-130` `widenEditorPanel` still works — it
    targets the rightmost `ptah-electron-resize-handle` (`:19-35`), which the
    dock keeps — but the crop at `:129` becomes `ptah-git-dock`. Rename the shot
    `git-status-bar` → `git-dock-header`.
  - `apps\ptah-docs\SCREENSHOTS.md` — delete the `file-tree-panel` row `:90`,
    rename `git-status-bar` `:98`, update the captured-by-automation list `:166`.
  - `apps\ptah-docs\src\content\docs\git\git-status.md` (49 lines) — the
    "Location" column `:14-19` says "Status bar, bottom-left" for every
    indicator; the surface is now the Git dock header. Rewrite `:12-19` and the
    `:10` image reference. `:21-34` (how the watcher works) and `:36-40` stay
    true. Also delete `workspace\file-tree.md` and its sidebar entry in
    `apps\ptah-docs\astro.config.mjs`.
  - `apps\ptah-electron-e2e\src\specs\editor\` (13 files). **Delete**:
    `editor.spec.ts` (keeping its two git tests, ported), `file-ops-dialogs-top-layer.spec.ts`,
    `file-tree-windowing.spec.ts`, `perf-m2-electron-spotcheck.spec.ts`,
    `perf-m4-drag-cd.spec.ts`, `perf-m3-watcher-churn.{md,script.mjs}` (stale per
    correction #12 — replaced by the constants spec). **Move to a new
    `apps\ptah-electron-e2e\src\specs\git\`**: `diff-view-state.spec.ts`,
    `glyph-margin-visual.spec.ts`, `hunk-apply-real-rpc.spec.ts`,
    `hunk-revert-top-layer.spec.ts`, `hunk-widget-mouse.spec.ts`,
    `perf-m1-diff-redisplay.spec.ts`. **Create** `specs\git\git-dock.spec.ts`
    with the ported git-status-bar tests (`editor.spec.ts:145-194`) plus the
    CX:120 synthetic-push assertion. `support\git-diff-mock.ts` does not move
    (correction #6).
  - `apps\ptah-electron-e2e\src\support\ui-driver.ts` — delete the `'editor'`
    view branch `:312-327` and its locator `:381-383`; add a `'git'` branch that
    toggles the Git panel and waits for `ptah-git-dock`. The `pushEvent
file:tree-changed` nudge `:325` goes with it.
  - `apps\ptah-electron-e2e\src\showcase\_harness\prewarm.ts` — delete
    `prewarmEditor` `:161-184` and the leaf-file helpers `:114-116`; its own doc
    at `:153-160` names the editor as "the known worst offender (~31 s)", which
    is the win to record.
  - `apps\ptah-electron-e2e\src\showcase\editor-tour.scene.ts` (259 lines) and
    `showcase\scripts\editor-tour.json` — delete both. `FOLLOW-UP.md:35` names
    `editor-tour` as the hand-written exemplar for the other 13 scenes; promote
    `chat-code-edit.scene.ts` in that sentence (it is the closest structural
    analogue — a single-surface walkthrough with a body and a payoff) and say
    why in the same edit. 14 scenes exist on disk; `FOLLOW-UP.md` says 13.
  - `apps\ptah-electron-e2e\src\specs\perf\startup-tti.spec.ts` — re-run and
    record; no assertion changes (correction #16).
- **Failure behaviour.** Not applicable.
- **Verification seam.** `nx run ptah-electron-e2e:e2e`; `nx build ptah-docs`
  (the docs gate — there is no `check` target, `apps\ptah-docs\CLAUDE.md`).
- **Files.** As listed.

---

## Integration architecture

- **Data flow (after Phase 4).**
  1. A working-tree write → `fs.watch` recursive callback
     (`git-watcher.service.ts:483`) → `isIgnoredWorkspaceEvent` `:484` →
     `scheduleUpdate(WORKSPACE_DEBOUNCE_MS, 'workspace')` `:487` →
     `fetchAndPush` → broadcast `git:status-update`.
  2. `MessageRouterService` (single `window` listener,
     `libs\frontend\core\CLAUDE.md` §Key Files) dispatches by type to
     `GitStatusService.handleMessage`, `GitBranchesService.handleMessage` and
     `DiffTabsService.handleMessage`, each behind its own `_isListening` gate.
  3. `GitDockComponent` renders `gitStatus.files()` through
     `SourceControlPanelComponent`; a row's `diffRequested` →
     `DiffTabsService.openDiff` → `git:diffFile` → `GitInfoService` →
     `DiffTabState` → `DiffViewComponent`.
  4. A hunk action → `DiffViewComponent.applyHunks` input →
     `DiffTabsService.applyHunks` (snapshot-token guard) → `git:applyHunks` →
     index-tree rollback on failure (`git-info.service.ts:1517-1537`).
  5. A transcript file link → `file-path-link.component.ts` →
     `ClaudeRpcService.openFile` → `file:open` → `ElectronFileOpenRpcHandlers`
     → containment check → `IProcessSpawner.spawnProcess('code', ['-g', …])`
     **and** `IEditorProvider.notifyFileOpened` → `ContextService.includeFile`
     (`context.service.ts:641-644`).
- **State or persistence.**
  `GitStatusService` owns the per-workspace status cache
  (`_workspaceGitState`, 5 s TTL `:89`), lifetime = renderer.
  `DiffTabsService` owns the open-diff set, lifetime = renderer, cleared on
  workspace switch by `WorkspaceCoordinatorService`.
  `ElectronLayoutService` owns the dock width/visibility and persists
  `{sidebarWidth, sidebarVisible, editorWidth, editorVisible}` under
  `LAYOUT_STATE_KEY` (`:558-566`) — key names unchanged, so no migration.
  Backend: none new.
- **External boundaries.** One new one: the `file:open` path spawns a process
  from a caller-supplied path. Controls: Zod on the params,
  `isPathWithinRoots` against the workspace folders **before** the spawn, no
  shell (`spawnProcess` takes `command` + `args` separately —
  `process-spawner.interface.ts:23-34`), and `detached` only off Windows
  (`cli-adapter.utils.ts:258`). The path is never interpolated into a string.
- **Failure and rollback.** Per phase: every contract edit lands in one commit,
  so `git revert` of that commit restores a bootable manifest. Within Phase 3,
  the dock and the launcher are independent and either can be reverted alone.
  Phase 4 is the only irreversible one and it is gated on Phase 3's e2e passing.
- **Observability.** The two failures that would otherwise be invisible:
  (a) a dropped `git:status-update` — the CX:120 e2e injects a synthetic push
  and asserts the dock updates; (b) `IEditorProvider` going dark — the
  Component 10 unit spec asserts `notifyFileOpened` fires on every successful
  open. Both launcher failure modes log at `warn` through `TOKENS.LOGGER`.

---

## Architecture-level quality requirements

- **Functional.** `libs/frontend/editor` does not exist. `libs/frontend/git-ui`
  exports every moved symbol with an unchanged signature. Skill Synthesis
  enhance-preview and clone drawers still render a diff. Transcript file links
  open the external editor. `git:status-update` reaches the dock. The manifest
  partition, `rpc-allowlist.spec.ts` and all three expected-absent specs pass.
- **Performance.** `chunk-RGPXAOHE.js` (1,129,192 B, xterm + tree + panel) and
  `monaco-vim.umd.js` (373 kB) leave the renderer. `startup-tti.spec.ts` re-run
  and its three console figures recorded before and after. A `"type": "bundle"`
  budget for the git-ui lazy chunk exists in
  `apps\ptah-extension-webview\project.json`. One fewer watcher debounce and one
  fewer broadcast per rename burst.
- **Security.** `file:open` validates containment before spawning and never
  builds a shell string. `isPathWithinRoots` and `isAuthorizedWorkspace` survive
  the `workspace-authorization.ts` trim; only `authorizedTerminalRoots` (and the
  two already-dead exports) go.
- **Maintainability.** `git-ui` depends on `core` + `shared` only, never on
  `chat`, `ui` or `editor`. No `V2`, no shim, no compatibility alias for
  `@ptah-extension/editor`. Both eslint bans are rewritten to name `git-ui`, or
  deleted where the boundary they guarded (xterm/Monaco in the initial bundle)
  no longer exists — the webview ban's stated reason is `TerminalComponent`
  (`eslint.config.mjs:51-52`), which is gone, so that one is **deleted**; the
  skills ban's reason is Monaco, which survives, so that one is **retargeted**.
  `no-editor-dependency.spec.ts` is deleted, not retargeted: `tasks-ui` is
  allowed to depend on `git-ui`.
- **Testability.** Behaviour that must stay covered: a `git:status-update` push
  reaching the dock through the router; a diff tab revalidating on
  `file:content-changed` without blanking; a hunk apply refused when the
  snapshot token moved; a worktree-created notification resolving its pending
  op; `file:open` spawning with the right argv, notifying the editor provider,
  and refusing an out-of-workspace path; a write under `.nx\cache`, `coverage`
  and `tmp` scheduling nothing while `out` / `build` still do.

---

## Team-leader handoff

- **Recommended executors.**
  - Components 1-8 (lib carve, service moves, listener conversions):
    **frontend-developer** — Angular libs, signals, `MESSAGE_HANDLERS`.
  - Component 9 (git dock): **frontend-developer**, after 1-8.
  - Component 10 (`file:open` launcher): **backend-developer** — tsyringe, DI
    phases, `IProcessSpawner`, host profiles.
  - Component 11 (`settings:get/set`): **backend-developer** — it spans
    `rpc-handlers`, `shared`, `platform-core` and one frontend line.
  - Component 12 (watcher + constants): **backend-developer**.
  - Component 13 (wire contract): **backend-developer**, and it is the
    coordination point every phase passes through — do not split it across
    executors within a phase.
  - Component 14 (showcase / e2e / docs): **devops-engineer** for the e2e and
    project.json budget; **video-director** for the scene deletion and the
    `FOLLOW-UP.md:35` exemplar promotion; **technical-content-writer** for
    `git-status.md` and `SCREENSHOTS.md`.
  - Phases 0, 1 and 4 are deletion-dominated: **backend-developer** for the host
    and contract halves, **frontend-developer** for the lib half.
- **Complexity: HIGH.** ~22-24k LOC removed across 5 phases, 7 coordinated
  contract sites, one new lib, one new backend handler, a native dependency
  leaving the packaged app, and a boot-time invariant that turns a partial edit
  into a startup throw.
- **Dependencies and ordering.** **The five phases are strictly sequential.**
  - Phase 0 → 1: independent in principle, but Phase 0 shrinks
    `editor-panel.component.ts` and `editor-panel.component.spec.ts`, which
    Phase 1 also edits. Keep the order.
  - Phase 1 → 2: `TerminalService` is one of the four services
    `workspace-coordinator.service.ts:104-110` resolves; removing it first makes
    the Phase 2 repoint a three-service edit instead of four.
  - Phase 2 → 3: the dock cannot import from a lib that does not exist.
  - Phase 3 → 4: **hard.** Deleting `EditorPanelComponent` before the dock exists
    drops every `git:status-update` (`git-status.service.ts:269`); deleting
    `EditorRpcHandlers` before the launcher exists breaks `file:open` on Electron.
  - Component 11 must land inside Phase 2, in the same commit as the
    `diff-view.component.ts` import repoint.
  - Component 12 may land any time from Phase 2 onward **except** its
    `EXCLUDED_DIRS_GLOB` re-home, which must land in Phase 4 with
    `editor-rpc.handlers.spec.ts`.
- **Parallel-safe work (file-disjoint, within a phase).**
  - _Phase 0_: {vim: `vim-mode.service.*`, `code-editor.component.ts`, webview `project.json` glob, root `package.json`, `file-settings-keys.ts`} ∥ {search + quick-open: `search/`, `quick-open/`, `sidebar.component.ts`} ∥ {worktree dead exports: `worktree-panel.component.ts`, `add-worktree-dialog.component.ts`} ∥ {`layout-rpc.handlers.ts` + its spec}. **Not disjoint**: all four touch `editor-panel.component.ts`, `index.ts` and the Component-13 contract set — those three land in one serialized commit at the end of the phase.
  - _Phase 1_: {renderer: `terminal/`, `terminal.service.*`, `editor.service.ts`, `styles.css`, `types/terminal.types.ts`} ∥ {host: `pty-manager.service.*`, `preload.ts`, `ipc-bridge.ts`, `phase-4-handlers.ts`, `bootstrap.ts`, `container.smoke.spec.ts`, `pty-host.interface.ts`, `tokens.ts`, `electron-tokens.ts`} ∥ {packaging: `apps\ptah-electron\package.json`, `project.json`, `electron-builder.yml`, `packaged-deps.spec.ts`} ∥ {e2e: `specs\pty-manager.spec.ts`, `editor.spec.ts:69`, `editor-tour.scene.ts:220-234`}. Serialized: Component 13 + `terminal-rpc.handlers.*`, `shell-allowlist.ts`, `workspace-authorization.ts`.
  - _Phase 2_: {new lib scaffolding: the 6 config files + `tsconfig.base.json`} lands first, alone. Then {services: git-status, git-branches, worktree, source-control} ∥ {diff: `diff-view/`, `monaco-loader`, `diff-tab.types.ts`, `DiffTabsService`} ∥ {components: `source-control/`, `worktree-section`} ∥ {skill-synthesis-ui: component, jest config, mock, eslint}. Serialized last: `app.config.ts`, `workspace-coordinator.service.ts`, `editor-message-routing.spec.ts`, the webview eslint config, `src/index.ts`, and Component 11's contract edits.
  - _Phase 3_: {Component 9 dock, in `git-ui` + `electron-shell.component.ts`} ∥ {Component 10 launcher, in `apps\ptah-electron` + `file-path-link.component.ts`} ∥ {Component 14 e2e/docs/showcase retarget}. Fully disjoint — three parallel batches.
  - _Phase 4_: {frontend lib deletion} ∥ {`EditorRpcHandlers` + Electron host} ∥ {`electron-layout.service.ts` doc/label edits} ∥ {showcase + docs}. Serialized: Component 13's final contract commit and the `git-watcher` / `workspace-scan.constants` pair.
- **Files affected.**
  - **CREATE** — `libs/frontend/git-ui/{project.json,jest.config.ts,eslint.config.mjs,tsconfig.json,tsconfig.lib.json,tsconfig.spec.json}`; `libs/frontend/git-ui/src/{index.ts,test-setup.ts}`; `libs/frontend/git-ui/src/lib/services/diff-tabs.service.ts` + `.spec.ts`; `libs/frontend/git-ui/src/lib/git-dock/git-dock.component.ts` + `.spec.ts`; `libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.ts`; `apps/ptah-electron/src/services/rpc/handlers/file-open-rpc.handlers.ts` + `.spec.ts` + `file-open-rpc.schema.ts`; `libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.schema.ts`; `apps/ptah-electron-e2e/src/specs/git/git-dock.spec.ts`.
  - **MOVE (git mv, then fix imports)** — the 13 rows of the Component 1 table; the 6 e2e specs listed in Component 14 into `apps/ptah-electron-e2e/src/specs/git/`.
  - **MODIFY** — `tsconfig.base.json`; `apps/ptah-extension-webview/project.json`; `apps/ptah-extension-webview/src/app/app.config.ts`; `apps/ptah-extension-webview/src/app/editor-message-routing.spec.ts`; `apps/ptah-extension-webview/eslint.config.mjs`; `apps/ptah-extension-webview/src/styles.css`; root `package.json`; `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`; `libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts` (+ spec); `libs/frontend/chat-ui/src/lib/atoms/file-path-link.component.ts`; `libs/frontend/core/src/lib/services/electron-layout.service.ts`; `libs/frontend/skill-synthesis-ui/{eslint.config.mjs,jest.config.ts}` + `src/lib/components/clones/lazy-diff-view.component.ts` + `src/__mocks__/ptah-editor.ts`→`ptah-git-ui.ts`; `libs/shared/src/lib/types/rpc.types.ts`; `libs/shared/src/lib/types/messages/{message-constants.ts,payload-map.ts}`; `libs/shared/src/lib/constants/workspace-scan.constants.ts` + `.spec.ts`; `libs/shared/src/lib/types/rpc/rpc-terminal.types.ts` (delete) and the `rpc.types.ts:20,329` re-exports; `libs/backend/rpc-handlers/src/lib/host-profile/{manifest.ts,capabilities.ts}`; `libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.handlers.ts`; `libs/backend/rpc-handlers/src/lib/utils/workspace-authorization.ts`; `libs/backend/vscode-core/src/messaging/rpc-handler.ts`; `libs/backend/platform-core/src/{file-settings-keys.ts,di/tokens.ts,utils/shell-allowlist.ts,interfaces/pty-host.interface.ts,index.ts}`; `libs/backend/cli-engine/src/lib/rpc/{rpc-surface.spec.ts,expected-absent.ts,cli-host-profile.ts}`; `apps/ptah-extension-vscode/src/di/{rpc-surface.spec.ts,expected-absent.ts}`; `apps/ptah-electron/src/{rpc-host-profile.ts,preload.ts}`; `apps/ptah-electron/src/ipc/ipc-bridge.ts`; `apps/ptah-electron/src/di/{phase-4-handlers.ts,electron-tokens.ts,container.smoke.spec.ts}`; `apps/ptah-electron/src/activation/bootstrap.ts`; `apps/ptah-electron/src/services/git-watcher.service.ts` + `.spec.ts`; `apps/ptah-electron/{package.json,project.json,electron-builder.yml}`; `apps/ptah-electron/src/config/packaged-deps.spec.ts`; `apps/ptah-electron-e2e/src/support/ui-driver.ts`; `apps/ptah-electron-e2e/src/showcase/_harness/prewarm.ts`; `apps/ptah-electron-e2e/src/docs-screenshots/editor-git.shot.ts`; `apps/ptah-video-studio/FOLLOW-UP.md`; `apps/ptah-docs/{SCREENSHOTS.md,astro.config.mjs}` + `src/content/docs/git/git-status.md`; `.vscodeignore` (only if Monaco leaves — it does not, in this task).
  - **REWRITE (delete whole file/folder)** — `libs/frontend/editor/**` (entire project, Phase 4); `libs/frontend/tasks-ui/src/lib/no-editor-dependency.spec.ts`; `libs/backend/rpc-handlers/src/lib/handlers/layout-rpc.handlers.ts` + spec; `libs/backend/rpc-handlers/src/lib/handlers/terminal-rpc.{handlers,schema}.ts` + specs; `apps/ptah-electron/src/services/pty-manager.service.ts` + spec; `apps/ptah-electron/src/services/rpc/handlers/editor-rpc.handlers.ts` + spec; `apps/ptah-extension-vscode/src/services/rpc/handlers/editor-rpc.handlers.ts` + spec; `apps/ptah-electron-e2e/src/specs/pty-manager.spec.ts`; `apps/ptah-electron-e2e/src/specs/editor/**`; `apps/ptah-electron-e2e/src/showcase/editor-tour.scene.ts` + `scripts/editor-tour.json`; `apps/ptah-docs/src/content/docs/workspace/file-tree.md`.
- **Verification points.**
  - **References to confirm before writing code**: `manifest.ts:99-112` (which
    methods `EDITOR_PANE_METHODS` actually holds), `rpc.types.ts:626` and
    `:3391` (both structures), `rpc-handler.ts:44-90`,
    `apps\ptah-electron\src\rpc-host-profile.ts:44-46`,
    `electron-editor-provider.ts:49`, `process-spawner.interface.ts:79-82`,
    `SDK_TOKENS.SDK_PROCESS_SPAWNER` at `agent-sdk\src\lib\di\tokens.ts:51`.
  - **Contracts to honour**: `DiffViewComponent`'s four inputs and one output
    (`diff-view.component.ts:696-730`); `SourceControlPanelComponent` and
    `SourceControlFileComponent` IO (`:235-239`, `:144-156`);
    `'git:worktreeChanged'` as a literal type string with `operationId`
    correlation; all 18 `git:*` methods; `file:open`'s `{path, line?}` params;
    `FILE_CONTENT_CHANGED`.
  - **Data changes**: none persisted. `LAYOUT_STATE_KEY` keys are unchanged; the
    only settings-key change is adding `diff.renderSideBySide` to
    `FILE_BASED_SETTINGS_KEYS`/`DEFAULTS` and retiring `editor.vimMode`.
  - **Commands that must pass, per phase** (project names are the `project.json`
    `name` fields; check the `Running target … for N projects` header —
    `npx nx test a b c` silently runs only `a`):
    - Every phase: `npm run typecheck:all`, `npm run lint:all`, `npm run build:all`.
    - Phase 0: `npx nx run-many -t test -p @ptah-extension/editor @ptah-extension/rpc-handlers @ptah-extension/cli-engine ptah-extension-vscode @ptah-extension/shared` (5).
    - Phase 1: the Phase-0 set plus `ptah-electron` → 6 projects; then
      `nx run ptah-electron-e2e:e2e`.
    - Phase 2: `npx nx run-many -t lint typecheck test -p @ptah-extension/git-ui @ptah-extension/editor @ptah-extension/skill-synthesis-ui @ptah-extension/chat @ptah-extension/core @ptah-extension/rpc-handlers @ptah-extension/platform-core @ptah-extension/shared ptah-extension-webview` (9); `npx nx graph` shows no `git-ui → editor` edge.
    - Phase 3: `npx nx run-many -t test -p @ptah-extension/git-ui @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/rpc-handlers ptah-electron` (5); then `nx run ptah-electron-e2e:e2e` including the new `specs/git/git-dock.spec.ts`.
    - Phase 4: `npx nx run-many -t test -p @ptah-extension/git-ui @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/core @ptah-extension/tasks-ui @ptah-extension/rpc-handlers @ptah-extension/vscode-core @ptah-extension/platform-core @ptah-extension/cli-engine @ptah-extension/shared ptah-electron ptah-extension-vscode ptah-extension-webview` (13); `nx run ptah-electron-e2e:e2e`; `nx build ptah-docs`; re-run and record `specs/perf/startup-tti.spec.ts`.
