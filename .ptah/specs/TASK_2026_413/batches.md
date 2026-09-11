# TASK_2026_413 implementation batches

Implementation proceeds sequentially from the approved `implementation-plan.md`.
Historical review uses merge-base(base, head)..head semantics.

| Batch | Scope                                         | Status      | Verification                                                                                                                                        |
| ----- | --------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Read-only Git review backend                  | Complete    | Focused typecheck passed; scratch review 2/2 and handler suite 2725 passed, 31 skipped                                                              |
| 2     | Kiro and workspace-safe launching             | Complete    | 6-project typecheck passed; 5-project tests passed after one test-scope correction (548 core, 190 VS Code, 247 Electron, 201 CLI, 2728 handlers)    |
| 3     | Frontend state and primitives                 | Complete    | git-ui typecheck passed; 19 suites / 277 tests passed                                                                                               |
| 4     | Mounted composition and hunk layout           | Complete    | 4-project typecheck passed; final git-ui 21 suites / 284 tests passed; real-child mount specs included                                              |
| 5     | Composition-root and browser regression gates | Implemented | Chat 66 suites / 1,037 passed (2 skipped); webview 8 suites / 150 passed; required Electron proof 5/5 passed; two legacy dock scenarios remain red  |
| 6     | Legacy Electron Git dock regression repair    | Complete    | Base classification 2/2 passed; Git dock 5/5; review/hunk gate 5/5; git-ui 21 suites / 285 tests; 4 lint/typecheck targets across 2 projects passed |
| 6R    | Review fixes                                  | Complete    | 4-project tests passed (4,588 tests, 33 skipped); 6-project lint/typecheck passed; Electron 10/10; diff check clean                                 |

## Progress log

- 2026-09-10: Read root and all scoped `CLAUDE.md` guidance plus `task-description.md`, `implementation-plan.md`, and `context.md` before product edits.
- 2026-09-10: Confirmed branch `fix/git-review-controls`; initial worktree changes were limited to the untracked task-spec directory.
- 2026-09-10: Dependency preparation authorized by the user; isolated pinned install under this worktree is being prepared from the existing lockfile.
- 2026-09-10: `npm ci --no-audit --no-fund` completed from the lockfile (2,982 packages). Postinstall rebuilt `better-sqlite3` for Electron ABI 143 and patched only this worktree's installed transformers metadata to the pinned ONNX runtime.
- 2026-09-10: Batch 1 implemented merge-base historical review, issued-pair/path authorization, numstat enrichment, strict schemas, and scratch-repository immutability coverage. Focused typecheck passed. Focused tests passed after updating pre-existing spawn-count and method-count invariants.
- 2026-09-10: Batch 2 added Kiro as a PATH-only verified editor target (no inferred installer paths), shared workspace-root path resolution with containment/file checks, strict schemas, and adapter/handler coverage. Six-project typecheck passed. The first test run exposed a test helper scoped to another describe; corrected inline and reran platform-core successfully.
- 2026-09-10: Batch 3 added the launcher/review signal stores, safe branch controls, historical review primitives, and shared case-insensitive file-tree builder. `git-ui` typecheck and all 19 suites / 277 tests passed before mount edits began.
- 2026-09-10: Batch 4 mounted the restored branch controls, workspace/file Open In controls, working-tree stats, historical toolbar/panel/tree/Monaco rows, and strict mutable/historical provenance. Added real-child header and dock mount specs. Four-project typecheck passed; final git-ui suite passed 21/21 suites and 282/282 tests.
- 2026-09-10: Batch 5 workspace coordination now includes `GitReviewService`; chat passed 66 suites / 1,037 tests (2 skipped) and webview composition passed 8 suites / 150 tests.
- 2026-09-10: Required Electron proof passed 5/5 at the real 1200x800 default window without dock/window widening: historical branch review and all mouse-only hunk widget/revert paths.
- 2026-09-10: Final 11-project lint/typecheck gate passed with warnings only. `git diff --check` passed.
- 2026-09-10: Independent review gate remains open because the existing Git dock Electron group is 3/5: its synthetic same-folder status fixture renders only `a.ts` although the section count is 2, and its mocked diff-tab fixture remains at `Loading diff editor...`. Both reproduce after focused reruns and are recorded in `test-report.md`.
- 2026-09-11: Batch 6 classified both legacy failures as Batch 1-5 regressions by running the two scenarios at detached base `712478de8`; both passed. The exact temporary worktree was removed afterward.
- 2026-09-11: Root cause was the shared fake RPC fixture missing the newly mounted `editor:detectTargets` contract. Its generic fallback supplied no `targets`, so the first Open In row threw while evaluating `targets().length`, aborting sibling rendering and the diff view's pending `afterNextRender` initialization.
- 2026-09-11: Added a contract-typed empty editor-target response to the fake RPC fixture, mounted zero-target/multi-row regression coverage, and aligned the historical review describe label with the prescribed verification grep.
- 2026-09-11: Final gates passed: Git dock 5/5; historical review/hunk controls 5/5 at 1200x800; git-ui 21/21 suites and 285/285 tests; typecheck/lint 4/4 targets across 2 projects with warnings only; `git diff --check` passed.
- 2026-09-11: Batch 6R applied every accepted independent-review fix: guarded malformed editor detection, extracted historical Git reads behind the `GitInfoService` facade, bounded review authorization with a 256-entry LRU, added counts-only parser drift diagnostics, restored branch recency bounds, reduced the git-ui public API, and added the requested security/mount/coordinator coverage.
- 2026-09-11: The first four-project test gate encountered unrelated Windows parallel-run timeouts. The unchanged gate reran with `--parallel=1` and passed all four projects (4,588 tests passed, 33 skipped). Six-project lint/typecheck, Electron 10/10 at 1200x800, and `git diff --check` all passed.

## Batches 7-8 decomposition

Source: `implementation-plan.md` `## Addendum: Batches 7-8` (A.1-A.8), acceptance criteria 15-30. Author: team-leader, Mode 1, 2026-09-11. Nothing in this section is committed. The team-leader owns every status below; executors report and never edit this file.

| Batch | Scope                                                              | Status  | Depends on   | Recommended executor        | Mode       |
| ----- | ------------------------------------------------------------------ | ------- | ------------ | --------------------------- | ---------- |
| 7     | Collapsible, resizable, persisted source-control rail              | PENDING | 6R           | codex CLI                   | sequential |
| 8a    | Backend contracts, contained read, link policy, hosts, nav guard   | PENDING | 6R           | backend-developer subagent  | sequential |
| 8b    | Read-only file tab in the Git dock (Electron)                      | PENDING | 6R, 7, 8a    | codex CLI                   | sequential |
| 8c-1  | Markdown file-link parser/extension/listener + core opener token   | PENDING | none         | frontend-developer subagent | sequential |
| 8c-2  | Chat link router, context markers, FilePathLink/tasks, wiring, e2e | PENDING | 8a, 8b, 8c-1 | frontend-developer subagent | sequential |

Waves: A = {7, 8a, 8c-1}, all file-disjoint. 8c-1 may start editing now, while 6R runs. 7 and 8a start when 6R is IMPLEMENTED. B = {8b}. C = {8c-2}. Then the final gate.

### Reconciliation with Batch 6R (removed from 7/8)

Batch 6R, the Codex run in progress now, already owns the items below. No 7/8 task re-implements them. A 7/8 executor that finds one of them missing reports it and does not fill the gap.

- Plan 7.4 (entire): the `EditorLauncherService.detect()` guard for `success:false` and non-array `targets`, the single-flight release, and its service and mount specs. It is also plan D2.
- The `issuedReviews` LRU, `GitReviewService.workspaceStates` removal pinning, and the name-status/numstat parser drift warning.
- Facade extraction of historical review out of `git-info.service.ts` into a vscode-core collaborator (`git-review-reader.service.ts` is already untracked on disk).
- From plan 7.3: style #3 (the protected-method test at `git-dock.component.spec.ts:257-263`) and style #7 (the stale JSDoc at `git-dock.component.ts:38-40`).
- From plan 8b.3: style #2, the removal of the git-ui `src/index.ts` over-exports. 8b only ADDS `type FileViewOpenRequest`.
- From plan 8a.2: style #6, creating `workspace-file-path.spec.ts`. 8a EXTENDS that file.
- Style #5 (non-null assertions in the review spec) and branch-picker recency sort with a cap of 10.

Files 6R is editing: `git-ui/src/index.ts`, `git-dock.component.ts` and its spec, `editor-launcher.service.ts` and its spec, `branch-picker-dropdown.component.ts`, `git-info.service.ts` plus the new collaborator, `git-review.service.ts`, `workspace-coordinator.service.ts` and its spec, and rpc-handlers `workspace-file-path.spec.ts`. Batches 7, 8a and 8b overlap these files and therefore declare `depends_on: 6R`. Batches 8c-1 and 8c-2 do not overlap 6R files; 8c-2 inherits the dependency through 8b.

### Plan validation

Status: PASSED WITH RISKS. There are 3 HIGH risks, and each one changes a plan decision (D6, D8, D9). They are mitigated inside the batches below. The orchestrator must acknowledge them, or send them back to the architect, before 8a and 8c-1 start.

Assumptions (plan A1-A9) are verified or assigned:

- A1 `TOKENS.GIT_INFO_SERVICE` registered: verified for Electron (`apps/ptah-electron/src/di/phase-4-handlers.ts:113`) and VS Code (`apps/ptah-extension-vscode/src/di/phase-3-handlers.ts:56`). CLI does not construct `EditorRpcHandlers`, because `editorLauncher` is absent there. Proven by the container smoke specs in Task 8a.7.
- A2 raw `href` handed to `renderer.link`: unverified. Checked in Task 8c-1.2.
- A3 ngx-markdown renders into the `markdown` host: unverified. Checked in Task 8c-1.3.
- A4 rpc-handlers `src/index.ts` re-exports the handlers barrel: verified (`libs/backend/rpc-handlers/src/index.ts:9-56`).
- A5 Monaco `getLanguages()`: unverified. Checked in Task 8b.2.
- A6/A7 renderer state survives reload and there is no `will-navigate` on reload: unverified. Proven by e2e in Tasks 7.4 and 8c-2.6.
- A8 `electron-layout.service.spec.ts` exists: verified. Task 7.1 MODIFIES it.
- A9 subagent worktree relative links resolve against the parent root: accepted limitation, recorded as a follow-up.
- The webview app has no Angular router (`app.config.ts` has no `provideRouter`), so a `href="#"` sentinel cannot change a route. Verified.
- The `'full'` preset, and therefore the new marked extension, is installed only by `apps/ptah-extension-webview/src/app/app.config.ts:79`. The `'member'` and `'basic'` presets never receive marked extensions (`provide-markdown-rendering.ts:265-274`), so the landing page and member panel are unaffected. Verified. `web-members` is still re-tested in 8c-1.

| Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Severity | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1: D8 `scope:'external-link'` authorizes all of `realpath(homedir)` and `realpath(tmpdir)`. An agent-authored link to `~/.ssh/id_ed25519`, `~/.aws/credentials`, `~/.config/gh/hosts.yml`, `~/.git-credentials`, `~/.claude/.credentials.json`, `~/.codex/auth.json` or Ptah's own secret-envelope store gets an Open In button. The plan's justification ("grants nothing `file:read` does not") leans on legacy `file:read`, which is itself the uncontained hole recorded as a follow-up. Opening a file in an AI-enabled external editor can ship its content to that editor's model context. **Worse on VS Code (D9): an absolute out-of-root link opens natively in ONE click**, with no intermediate blocked tab. Judgement: NOT acceptable as specified. | HIGH     | Enforce on the backend and also add friction in the UI. Task 8a.3: a credential deny-list applied to the realpath and the lexical path, which forces `externalOpenAllowed:false` and refusal under `external-link`. Task 8a.5: on VS Code, an absolute path outside the view roots requires a modal confirm that shows the absolute path. Task 8b.4: in Electron, Open In on a blocked tab requires an explicit confirm step that shows the full absolute path. |
| R2: D6 listener scope is every `markdown, [markdown]` host in the webview. Non-agent `'full'` markdown is present in `tasks-ui` task detail (spec documents), `chat/settings` (output-style editor, enhanced prompts), `chat/update-dialog` (GitHub release notes), `skill-synthesis-ui` (4 components), `setup-wizard` analysis results and `tribunal-panel` crucible verdict. A relative link in a task spec or release note would be hijacked into the file viewer with a wrong base.                                                                                                                                                                                                                                                                          | HIGH     | The listener becomes opt-in, and a marker outside the rendered markdown is required. Task 8c-1.3: intercept only when `markdownHost.parentElement.closest('[data-ptah-file-links]')` matches. Task 8c-2.2: put the marker on agent-output containers only. Negative specs cover task-detail, settings and update-dialog markdown.                                                                                                                               |
| R3: D9 hardens VS Code `file:open` from "open any absolute path" to root/home/tmp policy. A tool-call FilePathLink to an absolute path in an unregistered sibling repo (for example `D:\other-repo\x.ts`), which opens today, will be refused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | MEDIUM   | This is an accepted behaviour change, stated in Task 8a.5. The refusal shows a native warning with fixed copy, and the handler spec pins it. The final report lists it as a user-visible change.                                                                                                                                                                                                                                                                |
| R4: the plan omits the DI manifests. `FileLinkRootPolicy` becomes a new constructor dependency of `EditorRpcHandlers`, which Electron and VS Code both list in `expected-resolvable.ts`. `FileViewRpcHandlers` has no expected-resolvable (Electron) or expected-absent (VS Code) entry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | MEDIUM   | Task 8a.7 adds the manifest entries and runs both container smoke specs.                                                                                                                                                                                                                                                                                                                                                                                        |
| R5: the plan's file list for deleting `ClaudeRpcService.openFile` is incomplete. It also has references in `libs/frontend/core/src/testing/mock-rpc-service.ts:66-95` plus its spec, `claude-rpc-augment.spec.ts:224-250`, `tribunal-panel/.../relay-phase-rail.component.spec.ts:68-96,212` (provides `ClaudeRpcService.openFile` for the real FilePathLink) and `apps/ptah-extension-webview/src/app/unit5-message-routing.spec.ts:131`.                                                                                                                                                                                                                                                                                                                        | MEDIUM   | Task 8c-2.4 migrates all of them. `@ptah-extension/tribunal-panel` is added to the 8c-2 verification set.                                                                                                                                                                                                                                                                                                                                                       |
| R6: Windows link-path ambiguity. Cases: `C:\a.ts:12:3`, where the drive colon and line colons collide; CommonMark backslash escapes (`C:\a\.hidden` becomes `C:\a.hidden`); spaces, which need `<...>` destinations; `/C:/x` from `file:///C:/x`; `file://localhost/C:/x`; lower-case drives; `x.ts:12:` with a trailing colon; `x.ts:0`; a line number above 10^7; ADS `a.ts:stream`; and POSIX file names that legitimately contain `:12`.                                                                                                                                                                                                                                                                                                                      | MEDIUM   | Task 8c-1.1 carries the explicit case table. The backend form gate (Task 8a.2) is the authority, so any mis-parse ends as `unsupported-path` and never as a read. The POSIX `name:12` ambiguity is accepted and recorded.                                                                                                                                                                                                                                       |
| R7: shared worktree execution. `ptah-electron-e2e:e2e` depends on `ptah-electron:build-dev` + `copy-renderer-dev` (writes `dist/apps/ptah-electron/**`). `ptah-electron:test` depends on `build-main` and the worker builds. Concurrent runs clobber the renderer copy and the shared Nx daemon/cache.                                                                                                                                                                                                                                                                                                                                                                                                                                                            | HIGH     | The serialization rule below is mandatory for every executor, and the orchestrator steers the running 6R Codex session onto it.                                                                                                                                                                                                                                                                                                                                 |
| R8: agent-authored `data-ptah-file-href` or marker attributes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | LOW      | Plan D6/8c.3 already starts context lookup outside `<markdown>`. Task 8c-1.3 also resolves the opt-in marker from `markdownHost.parentElement`, so a marker inside agent HTML cannot opt a surface in. The backend re-authorizes every path.                                                                                                                                                                                                                    |
| R9: `isSameDocumentNavigation` allows a `file:` reload of the same document that differs only in query or hash, so an agent `href="index.html?x"` would reload the app.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | LOW      | The listener intercepts file-like links before navigation. Task 8a.6 spec pins that a query-only difference on the renderer document is allowed, and documents why.                                                                                                                                                                                                                                                                                             |

Edge cases:

- A malformed persisted rail state falls back to defaults: Task 7.1.
- A drag interrupted by Escape, blur, pointercancel or lost capture restores the pre-drag width: Task 7.2.
- The right pane never drops below 12rem at the 300 px dock minimum: Task 7.3.
- A file opened from a link in a non-git workspace still gets a tab: Task 8b.3.
- A file that grows after `stat` is `too-large`: Task 8a.4.
- A symlink or junction escape is refused and not offered for external open: Task 8a.2.
- A symlink between two authorized roots is allowed: Task 8a.2.
- Streaming re-render keeps interception with exactly one listener: Task 8c-1.3.
- A handler throw keeps default navigation prevented: Task 8c-1.3.
- A dynamic import failure of git-ui is logged and the dock is unchanged: Task 8c-2.1.
- A background-workspace tab resolves its own root: Task 8c-2.1.
- A link inside a previewed markdown document resolves against that document's directory: Tasks 8b.2 and 8c-2.1.

### Mandatory serialization rule for this ONE worktree

All batches share `D:/projects/ptah-extension/.claude/worktrees/git-review-controls`, one Nx daemon and cache, and one `dist/apps/ptah-electron` output.

1. Any command that runs Nx or Playwright holds a single lock directory for its whole duration. That covers every `npx nx ...` target (lint, typecheck, test, build, e2e) and every `npx playwright`. The lock path is `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/../ptah-413-nx.lock`, which sits outside the git tree so it can never be staged. Acquire it with an exclusive, fail-if-exists `mkdir`. Then write `owner.txt` inside it with the batch id, executor and start time. Remove the directory in a `finally` block, even on failure.
2. When the lock is held, wait and poll every 30 s. Never delete another owner's lock. If a lock is older than 60 min, report it to the orchestrator; do not break it.
3. Never run `npx nx reset`, `nx daemon --stop`, or any delete of `dist/` or `.nx/`. No batch here edits a `project.json`.
4. Editing source files concurrently is allowed, because the batches are file-disjoint. A green run is authoritative only for the files in the tree at that moment. The team-leader re-runs the final gate after the last batch, before any review verdict is accepted as final.
5. The 6R Codex session started before this rule existed. The orchestrator either steers it onto the lock or holds every 7/8 Nx and Playwright run until 6R reports.
6. Every `run-many` output must show the `Running target ... for N projects` header with the N listed per batch. A missing or lower N is a failed run, whatever the exit code.

### Gated step (not a batch action): rebase onto `main`

Plan A.8 recommends one rebase after Batches 1-6 (+6R) are committed and before the 8a verification run; the only known conflict is `0caa52f27` on `git-info.service.ts` (+spec), now also touched by the 6R facade extraction. The user has NOT authorized commits. This step is BLOCKED on an explicit user/orchestrator decision; no executor may commit, stash, checkout, reset or rebase. If it stays unauthorized, 7/8 verify against base `712478de8` and the final report records that `main` conflict as open.

## Batch 7: Collapsible source-control rail — PENDING

- Recommended executor: codex CLI (it authored `git-dock*` in Batches 4-6R and has the session context)
- Fallback executor: frontend-developer subagent
- Execution mode: sequential
- Rationale: layout state, a drag handle and dock wiring are coupled through one persisted state object and one template; the e2e depends on all three.
- Tasks: 4 | Depends on: 6R (`git-dock.component.ts` + spec + mount spec)
- Acceptance criteria: 15, 16, 17, 29 (rail half), 30 (partial)
- File overlap: `git-dock.component.ts`, `.spec.ts`, `.mount.spec.ts` with 6R (before) and 8b (after); `libs/frontend/core` project (different files) with 8c-1.

### Task 7.1: Rail width/collapsed layout state — PENDING

- Files: MODIFY `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/core/src/lib/services/electron-layout.service.ts`, `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/core/src/lib/services/electron-layout.service.spec.ts`
- Plan reference: implementation-plan.md:465-484 (7.1), D1 :429
- Pattern to follow: `electron-layout.service.ts:563-601` (`persistLayout` / `restoreLayout`)
- Quality requirements: `gitRailWidth` (default 256, clamp 160-480) and `gitRailCollapsed` signals. `setGitRailWidth` clamps and does not persist. `commitGitRailWidth` and `toggleGitRail` persist. Restore applies a field only on the correct `typeof`, then clamps.
- Validation notes: malformed, absent or out-of-range persisted values fall back to defaults (AC17).
- Implementation details: add the fields to the existing persisted `electron-layout` object. Add no new storage key.

### Task 7.2: RailResizeHandleComponent — PENDING

- Files: CREATE `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/git-ui/src/lib/git-dock/rail-resize-handle.component.ts`, `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/git-ui/src/lib/git-dock/rail-resize-handle.component.spec.ts`
- Plan reference: implementation-plan.md:486-493
- Pattern to follow: `git show 05e725865^:libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts` lines 1403-1600 (port the behaviour, not the file)
- Quality requirements: OnPush and `inject()`, zoneless-safe. Accessible separator with aria-value attributes. A second pointer is refused while a drag is active. Every listener is removed on end and on destroy.
- Validation notes: Escape, blur, pointercancel and lostpointercapture restore the pre-drag width. A `setPointerCapture` throw is tolerated. ArrowLeft/Right step 16 px and Home/End jump to the limits, each key committing (AC16).
- Implementation details: the spec dispatches real `PointerEvent`/`KeyboardEvent` on the rendered separator and spies on `removeEventListener` for cleanup.

### Task 7.3: Dock rail container and header toggle — PENDING

- Depends on: Tasks 7.1, 7.2; 6R
- Files: MODIFY `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/git-ui/src/lib/git-dock/git-dock.component.ts`, `git-dock.component.spec.ts`, `git-dock.mount.spec.ts`, `git-dock-header.component.ts`, `git-dock-header.component.spec.ts` (same folder)
- Plan reference: implementation-plan.md:495-506 (7.3), minus style #3/#7 (6R-owned)
- Pattern to follow: existing real-child mount at `git-dock.mount.spec.ts:115`
- Quality requirements: `#git-source-control-rail` uses `[style.width.px]` with `max-width: calc(100% - 12rem)`. When collapsed, the right pane is `flex-1`. The header toggle carries `data-testid="git-rail-toggle"`, `aria-controls` and `aria-expanded`, uses the `PanelLeftClose`/`PanelLeft` icons, and renders only when `isGitRepo() && mode === 'working-tree'`.
- Validation notes: the review-mode rail (`git-review-panel.component.ts:26-43`) is untouched. The mount spec clicks the rendered toggle; no protected-method calls.
- Implementation details: the handle's `widthChange` is wired to `setGitRailWidth` and `widthCommit` to `commitGitRailWidth`.

### Task 7.4: Electron e2e `git source-control rail` — PENDING

- Depends on: Task 7.3
- Files: CREATE `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/apps/ptah-electron-e2e/src/specs/git/git-rail-collapse.spec.ts`
- Plan reference: implementation-plan.md:519-526
- Pattern to follow: `apps/ptah-electron-e2e/src/specs/git/hunk-widget-mouse.spec.ts:47` (1200x800 assertion); `support/fixtures.ts:92-110`; `support/ui-driver.ts:312-325`
- Quality requirements: the describe title is exactly `git source-control rail`. Assert the window is `[1200, 800]` and the dock is 700 ±1. The spec contains no window resize and no `editorPanelWidth` override.
- Validation notes: covers collapse and expand; a mouse drag to 200 px; `webContents.reload()` restoring the width and collapsed state (A6/A7); and an `editor:detectTargets` mock of `{}` still rendering every file row. The last scenario consumes the 6R guard. If that guard is missing, report it and do not patch it.

### Batch 7 verification

- `npx nx run-many -t lint typecheck test -p @ptah-extension/core @ptah-extension/git-ui --parallel=1`, expecting a header of 2 projects
- `npx nx run-many -t lint typecheck -p ptah-electron-e2e`, expecting 1 project
- `npx nx e2e ptah-electron-e2e -- --grep "git source-control rail|Git dock|historical branch review controls|in-editor hunk action widget"`, all passing
- `git diff --check`
- Reviewer: code-logic-reviewer (drag state machine, persistence). The visual review is deferred to the final gate.

## Batch 8a: Backend contracts, contained read, link policy, hosts, navigation guard — PENDING

- Recommended executor: backend-developer subagent (security-ordered path policy; Node realpath, junction and ADS semantics)
- Fallback executor: ptah-cli Claude subscription lane (`pc-effaa2c4-0d41-4e95-980a-89d3bf971b4d`)
- Execution mode: sequential
- Rationale: the shared contracts, manifest registry, DI manifests and three host handlers form one integration surface. The contract feeds every later task, so parallel lanes would race on `rpc.types.ts`, `manifest.ts` and `src/index.ts`. Task 8a.6 is file-disjoint; if the orchestrator wants a lane, it may run 8a.6 on an antigravity CLI lane, under the serialization rule.
- Tasks: 7 | Depends on: 6R (it creates `workspace-file-path.spec.ts`; its `git-info.service.ts` facade must keep `getWorktrees` stable)
- Acceptance criteria: 24, 25 (backend), 26, 27, 28, 30 (partial)
- File overlap: `workspace-file-path.spec.ts` with 6R. `libs/shared` RPC type files and `editor-rpc.*` / `file-open-rpc.*` are not touched by any other 7/8 batch.
- Scope note: 8a must not touch the legacy `file:read` handler. That stays a follow-up.

### Task 8a.1: Wire contracts — PENDING

- Files: MODIFY `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/shared/src/lib/types/rpc/rpc-misc.types.ts`, `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/shared/src/lib/types/rpc/rpc-editor.types.ts`, `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/shared/src/lib/types/rpc.types.ts`
- Plan reference: implementation-plan.md:530-567
- Quality requirements: `FileOpenParams` gains `column?`. Add `FileViewFailureReason`, `FileViewContentParams`, `FileViewContentResult` and `FILE_VIEW_MAX_BYTES`. `EditorOpenFileParams.scope?` is `'workspace' | 'external-link'`. `'file:viewContent'` is added to the registry (near :689) and to the method-name map (near :3348).
- Validation notes: additive only. `FileOpenParams.workspaceRoot` already exists, so do not duplicate it.

### Task 8a.2: Linked-path resolver (form gate, base selection, lexical, worktree, realpath, stat) — PENDING

- Depends on: Task 8a.1; 6R
- Files: MODIFY `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/backend/rpc-handlers/src/lib/handlers/workspace-file-path.ts`, EXTEND `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/backend/rpc-handlers/src/lib/handlers/workspace-file-path.spec.ts` (created by 6R)
- Plan reference: implementation-plan.md:569-621 (the ordered algorithm is part of the contract)
- Pattern to follow: `libs/backend/platform-core/src/utils/path-containment.ts:22-74`; fs precedent `file-rpc.handlers.ts:20,170,242,251`
- Quality requirements: `checkLinkedPathForm` runs before any fs or git call, on `path`, `workspaceRoot` and `documentPath`. `process.cwd()` is never consulted. Worktrees are consulted lazily, only on a lexical miss. Roots are realpath'd, and a root that fails realpath is dropped.
- Validation notes: extend the 6R spec with realpath and symlink cases.
  - The form gate rejects UNC, `\\?\`, `\\.\`, `//server`, drive-relative, root-relative, ADS and C0 input, and spies prove `realpath`/`stat` were never called.
  - Traversal and sibling-prefix (`/ws` vs `/ws2`) paths are rejected.
  - Win32 case-folding is exercised through the platform parameter.
  - A symlink out of the root is refused. On Windows without symlink privilege, use a junction instead.
  - A symlink between two authorized roots is allowed.
  - Also cover: a directory, a FIFO (POSIX only), the size-cap boundary, an unregistered hint, and a worktree root through a fake `listWorktrees`.
- Implementation details: `resolveLinkedFilePath(request, roots, options)` returns a `file`, `directory` or `rejected` result. The existing `resolveWorkspaceFilePath` is kept.

### Task 8a.3: FileLinkRootPolicy with credential deny-list (R1) — PENDING

- Depends on: Task 8a.2
- Files: CREATE `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/backend/rpc-handlers/src/lib/handlers/file-link-root-policy.ts`, `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/backend/rpc-handlers/src/lib/handlers/file-link-root-policy.spec.ts`
- Plan reference: implementation-plan.md:590-593, D8 :443. The deny-list is a team-leader RISK mitigation that tightens D8.
- Quality requirements: `@injectable()`, injecting `PLATFORM_TOKENS.WORKSPACE_PROVIDER` and `TOKENS.GIT_INFO_SERVICE`. `resolveForView` uses no extra roots and the 2 MiB cap. `resolveForExternalOpen` adds `homedir` and `tmpdir` as extra roots and has no size cap. `listWorktrees` drops UNC paths.
- Validation notes (R1, mandatory):
  - `resolveForExternalOpen` rejects with `outside-roots` (no `lexicalPath`, so `externalOpenAllowed:false`) whenever the lexical OR real path lies under a credential location. This check applies to the home and tmp extra roots, not to registered view roots.
  - Directories: `.ssh`, `.gnupg`, `.aws`, `.azure`, `.kube`, `.docker`, `.config/gcloud`, `.config/gh`.
  - Files: `.netrc`, `_netrc`, `.git-credentials`, `.npmrc`, `.pypirc`, `.pgpass`, `.claude/.credentials.json`, `.codex/auth.json`.
  - Windows: `AppData/Roaming/Microsoft/Credentials`, `AppData/Local/Microsoft/Credentials`, `AppData/Roaming/Microsoft/Protect`.
  - Ptah's own secret-envelope store. The executor locates its path in `libs/backend/settings-core` and cites it in the report.
  - Basenames: `id_rsa*`, `id_ed25519*`, `id_ecdsa*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `.env` and `.env.*`.
  - Matching is case-insensitive on win32.
  - The spec covers each class on both the lexical path and a symlink whose realpath lands in `.ssh`.
- Implementation details: the deny-list lives in one named constant with a JSDoc explaining why. It is not configurable from the renderer.

### Task 8a.4: `file:viewContent` handler, schema and host registration — PENDING

- Depends on: Task 8a.3
- Files: CREATE `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/backend/rpc-handlers/src/lib/handlers/file-view-rpc.handlers.ts`, `file-view-rpc.schema.ts`, `file-view-rpc.handlers.spec.ts`. MODIFY `libs/backend/rpc-handlers/src/lib/handlers/index.ts`, `libs/backend/rpc-handlers/src/index.ts` (export `FileViewRpcHandlers`, `FileLinkRootPolicy`, `FileOpenRpcParamsSchema`, `checkLinkedPathForm`), `libs/backend/rpc-handlers/src/lib/host-profile/capabilities.ts`, `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`, `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/apps/ptah-electron/src/rpc-host-profile.ts`, `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/backend/cli-engine/src/lib/rpc/expected-absent.ts`, `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`
- Plan reference: implementation-plan.md:611-630
- Quality requirements: the Zod schema is `.strict()` with a 4096-character cap on each field. A bounded read opens the file and reads `maxBytes + 1` bytes, closing in `finally`. Decoding follows BOM detection, then the NUL-in-first-8000-bytes binary check, then a fatal UTF-8 decode. A fixed message table covers every failure. `logger.warn` receives the reason only, never a path or content. The handler never rejects to the transport.
- Validation notes: the `file:` prefix is already allowlisted (`rpc-handler.ts:47-48`), so no prefix change. `rpc-allowlist.spec.ts` and the manifest invariants must pass UNMODIFIED. `externalOpenAllowed` is computed through `resolveForExternalOpen`, so it includes the R1 deny-list.

### Task 8a.5: `editor:openFile` scope; `file:open` column; VS Code `file:open` hardening (R3 + R1 VS Code confirm) — PENDING

- Depends on: Task 8a.3
- Files: MODIFY `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/backend/rpc-handlers/src/lib/handlers/editor-rpc.schema.ts`, `editor-rpc.handlers.ts`, `editor-rpc.handlers.spec.ts`, `file-open-rpc.schema.ts`, `file-open-rpc.handlers.spec.ts`; MODIFY `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.ts`; CREATE `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/apps/ptah-extension-vscode/src/services/rpc/handlers/file-rpc.handlers.spec.ts`
- Plan reference: implementation-plan.md:632-642, D9 :445
- Quality requirements:
  - `scope` routes to either `resolveForExternalOpen` (file only) or `resolveWorkspaceFilePath`. The launcher stays line-only.
  - `FileOpenRpcParamsSchema` gains `column`.
  - The VS Code handler parses with the exported schema. A relative path goes through `resolveForView` with `maxBytes: Infinity, allowDirectory: true`. An absolute path goes through `resolveForExternalOpen(…, { allowDirectory: true })`.
  - UNC and device forms are refused before `stat`. Selection is `new vscode.Position(line-1, (column ?? 1)-1)`.
  - Error copy is fixed; the handler never returns raw `error.message`. Sentry capture is kept.
- Validation notes (R1): when an absolute path resolves outside the view roots but is allowed under external-link, VS Code shows a modal `showWarningMessage` with the absolute path and an explicit Open action before opening. Cancel opens nothing.
- Validation notes (R3): a refusal is a user-visible change and shows a native warning.
- The spec mocks `vscode` and covers:
  - a relative path with an authorized root, and with an unregistered root;
  - UNC with no `stat` call, and a deny-listed credential path;
  - modal confirm and cancel;
  - column selection and directory reveal.
- Current callers stay compatible: `ClaudeRpcService.openFile` sends `{path,line}` and tasks-store sends `{path}`. Both are verified to fit the strict schema.

### Task 8a.6: Electron navigation policy — PENDING

- Files: CREATE `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/apps/ptah-electron/src/windows/navigation-policy.ts`, `navigation-policy.spec.ts`; MODIFY `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/apps/ptah-electron/src/windows/main-window.ts`
- Plan reference: implementation-plan.md:644-655, D10 :447
- Quality requirements: the policy module does not import `electron`. `isInternalNavigation` and `EXTERNAL_SCHEMES` (`main-window.ts:38-56`) are DELETED and replaced; they are not kept alongside. A cancelled `file:` navigation is never handed to `shell.openExternal`.
- Validation notes: the spec covers same-document `#hash` (allowed); a same document differing only in query (R9, pin and document); a sibling `file:` path; a relative-resolved `renderer/src/a.ts`; `file://server/share`; `javascript:`; an empty current URL; and malformed input.

### Task 8a.7: DI manifests (R4) — PENDING

- Depends on: Tasks 8a.4, 8a.5
- Files: MODIFY `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/apps/ptah-electron/src/di/expected-resolvable.ts` (add `FileViewRpcHandlers`), `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/apps/ptah-extension-vscode/src/di/expected-absent.ts` (add `FileViewRpcHandlers` to handlers and `'fileViewer'` to capabilities)
- Validation notes: `container.smoke.spec.ts` in both apps must resolve `EditorRpcHandlers`, which now requires `FileLinkRootPolicy` → `GIT_INFO_SERVICE` (A1). If the Electron smoke container lacks `GIT_INFO_SERVICE` at resolution time, report it as a BLOCKER. Do not add a lazy `isRegistered` workaround.

### Batch 8a verification

- `npx nx run-many -t lint typecheck test -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/cli-engine ptah-electron ptah-extension-vscode --parallel=1`, expecting a header of 5 projects. `ptah-electron:test` builds the main bundle and workers, so it runs under the lock.
- `npx nx run-many -t typecheck -p @ptah-extension/core @ptah-extension/git-ui`, expecting 2 projects (shared-contract consumers)
- `npx nx e2e ptah-electron-e2e -- --grep "Git dock"`, all passing (the navigation guard does not break boot or the dock)
- `git diff --check`
- Reviewer: code-logic-reviewer, cross-vendor (codex CLI or antigravity CLI). Why: path-policy ordering, TOCTOU, the deny-list and error sanitization are behavioural and security risks. The review must confirm R1, R3, R4 and R9.

## Batch 8b: Read-only file tab in the Git dock (Electron) — PENDING

- Recommended executor: codex CLI (`DiffTabsService`, the dock and Monaco lifecycle are its Batch 4-6R territory)
- Fallback executor: frontend-developer subagent
- Execution mode: sequential
- Rationale: the tab model, reader, component, dock composition and launcher scope form one chain inside `git-ui`, and 8b.3 edits files that 7 and 6R just changed.
- Tasks: 4 | Depends on: 6R (`editor-launcher.service.ts`, `src/index.ts`, `git-dock.component.ts`), 7 (`git-dock.component.ts` + specs), 8a (contracts `FileViewContentResult`, `EditorOpenFileParams.scope`)
- Acceptance criteria: 23, 25 (UI), 19 (dock side), 30 (partial)
- File overlap: `git-dock.component.ts` / `.spec` / `.mount.spec` and `editor-launcher.service.ts` / `.spec` with 6R and 7; `src/index.ts` with 6R; `git-ui/CLAUDE.md` with none.

### Task 8b.1: Tab model, FileViewReaderService, DiffTabsService view tabs — PENDING

- Files: MODIFY `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/git-ui/src/lib/types/diff-tab.types.ts`, `libs/frontend/git-ui/src/lib/services/diff-tabs.service.ts`, `libs/frontend/git-ui/src/lib/services/diff-tabs.service.spec.ts`; CREATE `libs/frontend/git-ui/src/lib/services/file-view-reader.service.ts`, `file-view-reader.service.spec.ts`
- Plan reference: implementation-plan.md:661-698, D3 :433
- Quality requirements: `EditorTab.view?` is the discriminant, and exactly one of `diff`/`view` is present. The key is `view:<normalized path>`. The reader is a facade collaborator, so `DiffTabsService` stays near 647 lines. Diff-only paths skip view tabs. View tabs are not dropped on workspace switch.
- Validation notes:
  - A stale `requestId` is dropped.
  - A transport failure on refresh keeps the old content.
  - An authorization failure on refresh (`outside-roots`, `root-not-open`) clears content.
  - Only known reasons use backend copy.

### Task 8b.2: FileViewComponent + monaco-theme extraction — PENDING

- Depends on: Task 8b.1
- Files: CREATE `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/git-ui/src/lib/file-view/file-view.component.ts`, `file-view.component.spec.ts`, `libs/frontend/git-ui/src/lib/services/monaco-theme.ts`, `monaco-theme.spec.ts`; MODIFY `libs/frontend/git-ui/src/lib/diff-view/diff-view.component.ts` (replace inline theme detection at :1208-1259 with the extracted helper; no copy is left behind), `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/git-ui/CLAUDE.md`
- Plan reference: implementation-plan.md:700-722
- Pattern to follow: `git show 05e725865^` `code-editor.component.ts:68-112,232-240,545-556`; `libs/frontend/markdown` `__mocks__/ngx-markdown.ts`
- Quality requirements:
  - Monaco is read-only and always mounted, made `invisible` while preview shows.
  - One model per instance, disposed on tab change and on destroy.
  - Reveal is clamped to the model.
  - Preview goes through `MarkdownBlockComponent` only, preview-first for `.md`, `.markdown` and `.mdx`, and is disabled above 512 KiB with a visible note.
  - No `[innerHTML]`; a template scan assertion enforces it.
  - The body host carries `data-ptah-link-root`, `data-ptah-link-document` and the 8c-1 opt-in marker `data-ptah-file-links`.
- Validation notes: A5 check. Language comes from `getLanguages()` extension match, falling back to `plaintext`. git-ui has no `package.json`, so the new `@ptah-extension/markdown` import needs no manifest edit. The lint `scope:webview → scope:shared` rule permits it.

### Task 8b.3: Dock composition + launcher `openLinkedFile` + barrel addition — PENDING

- Depends on: Task 8b.2; 7; 6R
- Files: MODIFY `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/git-ui/src/lib/git-dock/git-dock.component.ts`, `git-dock.component.spec.ts`, `git-dock.mount.spec.ts`, `libs/frontend/git-ui/src/lib/services/editor-launcher.service.ts`, `editor-launcher.service.spec.ts`, `libs/frontend/git-ui/src/index.ts`
- Plan reference: implementation-plan.md:724-742, minus the over-export removal (6R-owned)
- Quality requirements: the tab strip renders whenever tabs exist, including in a non-git workspace. A view tab renders `<ptah-file-view>` and a diff tab renders `<ptah-diff-view>`. `openLinkedFile` sends `editor:openFile` with `scope:'external-link'` and reuses `launchStatus`. The barrel adds only `type FileViewOpenRequest`.
- Validation notes: the mount spec uses real header, source-control, file-view (fake Monaco) and markdown-block children. It covers a view tab in a non-git workspace, a mixed strip with keyboard navigation, `.md` preview, and the blocked-tab Open In path.

### Task 8b.4: External-open confirm on blocked tabs (R1 UI) — PENDING

- Depends on: Task 8b.3
- Files: MODIFY `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/git-ui/src/lib/file-view/file-view.component.ts`, `file-view.component.spec.ts`, `libs/frontend/git-ui/src/lib/git-dock/git-dock.mount.spec.ts`
- Quality requirements: choosing an Open In target on a `blocked` tab does not launch directly. It opens an inline confirm region (`role="alertdialog"` or the existing daisyUI confirm pattern used by the discard confirmation) showing the full absolute path and the editor name. Only an explicit Open button emits `openExternal`, and Cancel emits nothing. The whole flow is keyboard-reachable. Theme tokens only.
- Validation notes: the mount spec clicks target → confirm → exactly one `editor:openFile {scope:'external-link'}`, and target → cancel → zero calls. Open In is still hidden when `externalOpenAllowed` is false (AC25).

### Batch 8b verification

- `npx nx run-many -t lint typecheck test -p @ptah-extension/git-ui ptah-extension-webview --parallel=1`, expecting a header of 2 projects
- `npx nx e2e ptah-electron-e2e -- --grep "git source-control rail|Git dock|historical branch review controls|in-editor hunk action widget|hunk revert dialog"`, all passing (the dock restructure must not regress Batches 4-7)
- `git diff --check`
- Reviewers: code-logic-reviewer (tab lifecycle, stale request, model disposal) and code-style-reviewer (facade rule for the reader, barrel surface)

## Batch 8c-1: Markdown file-link parser, extension, opt-in listener + core opener token — PENDING

- Recommended executor: frontend-developer subagent (sanitizer round-trip, DOM delegation, lint-scope constraints)
- Fallback executor: antigravity CLI
- Execution mode: sequential
- Rationale: the parser, extension and listener share one barrel and one CLAUDE.md. The core token is tiny and has to exist before 8c-2. None of it overlaps 6R, 7, 8a or 8b files, so this batch can start now.
- Tasks: 4 | Depends on: none
- Acceptance criteria: 19 (capture, one listener), 20, 30 (partial)
- File overlap: none with any 7/8 batch. It shares the `@ptah-extension/core` PROJECT with Batch 7 (different files). `core/src/index.ts` is only touched here.
- Boundary: `markdown` is `scope:shared`, so it must import nothing from core, chat or shared-webview libs. The handler port is markdown-owned.

### Task 8c-1.1: `parseFileLinkHref` with Windows case table (R6) — PENDING

- Files: CREATE `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/markdown/src/lib/file-link-target.ts`, `file-link-target.spec.ts`
- Plan reference: implementation-plan.md:748-765
- Quality requirements: pure function that returns a filesystem path, never a URL, or `null`.
- Validation notes (R6): the spec table must include every plan form plus:
  - Drive forms: `C:\a.ts:12:3` → `{path:'C:\\a.ts',line:12,column:3}`, `c:/a.ts:7`, `C:\a.ts#L12C3`, `C:\a.ts#L12-L20`, and `C:` alone.
  - File URLs: `file:///C:/a%20b.ts` → `C:/a b.ts`, `file://localhost/C:/x`, and `file://server/share/x` (target kept, the backend rejects it).
  - Line edge cases: `x.ts:12:` (trailing colon not stripped), `x.ts:0`, `x.ts:10000001` (not stripped), and ADS `a.ts:stream` (kept whole, the backend rejects it).
  - Other inputs: `//host/x` → null, `\\server\x` → target, `#anchor` → null, `?q` → null, `http:`, `mailto:`, and `javascript:` → null, malformed `%E0%A4%A` kept raw, and C0 → null.
  - The doc comment states two accepted limits: POSIX file names that end in `:<n>` are parsed as a line, and CommonMark backslash escapes happen before this function sees the href.

### Task 8c-1.2: Marked file-link extension + sanitizer round-trip — PENDING

- Depends on: Task 8c-1.1
- Files: MODIFY `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/markdown/src/lib/marked-extensions.ts`, `marked-extensions.spec.ts`, `provide-markdown-rendering.spec.ts`
- Plan reference: implementation-plan.md:766-768, 788
- Pattern to follow: `marked-extensions.ts:179-217,289-321,335-343`
- Quality requirements: `renderer.link` returns `false` for a non-file href. Otherwise it emits `<a href="#" data-ptah-file-href title class="ptah-file-link">` with `escapeHtml`. `ALLOWED_URI_REGEXP`, `FORBID_*` and `ALLOW_DATA_ATTR` are NOT changed.
- Validation notes: A2 check. If marked hands over a cleaned or encoded href, `decodeURI` it before parsing, and pin that with a test. The round-trip test covers: `data-ptah-file-href="C:\x.ts:12:3"` and a `file:///` value survive the permissive sanitizer, a raw `href="C:\x"` is still stripped, and an http link renders unchanged. The member-preset chokepoint spec (`libs/web/members/src/lib/markdown-chokepoint.spec.ts`) stays green unmodified.

### Task 8c-1.3: `provideMarkdownFileLinks` opt-in document listener (R2, R8) — PENDING

- Depends on: Task 8c-1.1
- Files: CREATE `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/markdown/src/lib/markdown-file-links.ts`, `markdown-file-links.spec.ts`; MODIFY `libs/frontend/markdown/src/index.ts`, `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/markdown/CLAUDE.md`
- Plan reference: implementation-plan.md:769-790. R2 tightens D6.
- Quality requirements:
  - Capture-phase `click` and `auxclick` listeners (button ≤ 1), installed once per `Document` through a `WeakSet` guard and removed on destroy.
  - Skips anchors inside `pre` or `code`. No `stopPropagation`.
  - A handler throw is caught, logged with the `[MarkdownFileLinks]` prefix, and default navigation stays prevented.
  - Also exports `MARKDOWN_FILE_LINKS_OPT_IN_ATTR = 'data-ptah-file-links'`.
- Validation notes (R2/R8): intercept only when BOTH conditions hold:
  1. `host = anchor.closest('markdown, [markdown]')` exists (A3 check).
  2. `host.parentElement?.closest('[data-ptah-file-links]')` exists. The lookup starts outside the rendered markdown, so a marker authored inside agent HTML cannot opt a surface in.
     Without the marker the listener does nothing, so non-agent `'full'` surfaces keep today's behaviour.
- The spec covers:
  - one listener after N renders;
  - interception after a replaced `innerHTML`;
  - `pre`/`code` ignored, and http with no `preventDefault`;
  - `auxclick` button 1 and a handler throw;
  - an unmarked `<markdown>` ignored, and a marker placed INSIDE `<markdown>` ignored;
  - removal on destroy.
- CLAUDE.md states "six extensions", the opt-in marker rule and "data attribute is transport, not trust".

### Task 8c-1.4: Core `FILE_LINK_OPENER` token — PENDING

- Files: CREATE `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/core/src/lib/tokens/file-link-opener.token.ts`; MODIFY `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/core/src/index.ts`
- Plan reference: implementation-plan.md:792-803 (token only; the `openFile` deletion moves to 8c-2.4)
- Quality requirements: `FileLinkOpenRequest`, `IFileLinkOpener`, `FILE_LINK_OPENER` `InjectionToken`. There is no default provider; the composition root binds it (core Guideline 6).

### Batch 8c-1 verification

- `npx nx run-many -t lint typecheck test -p @ptah-extension/markdown @ptah-extension/core --parallel=1`, expecting a header of 2 projects
- `npx nx run-many -t test typecheck -p web-members ptah-landing-page`, expecting 2 projects (markdown consumers outside the webview are unaffected)
- `git diff --check`
- Reviewers: code-logic-reviewer (listener gating, parser table) and code-style-reviewer (scope:shared boundary, public API)

## Batch 8c-2: Chat link router, agent context markers, FilePathLink/tasks migration, wiring, e2e — PENDING

- Recommended executor: frontend-developer subagent (cross-lib DI ports, dynamic import, both platform branches)
- Fallback executor: ptah-cli Claude subscription lane (`pc-effaa2c4-0d41-4e95-980a-89d3bf971b4d`)
- Execution mode: sequential
- Rationale: the router, markers, caller migration and composition root form one dependency chain, and the `ClaudeRpcService.openFile` deletion must land together with its last caller. The e2e runs last.
- Tasks: 6 | Depends on: 8a (`file:open` column contract), 8b (`DiffTabsService.openFileView`, barrel `FileViewOpenRequest`, file-view marker), 8c-1 (tokens, listener, parser)
- Acceptance criteria: 19, 20, 21, 22, 26 (renderer side), 27 (reload proof), 29 (links half), 30 (partial)
- File overlap: none with 6R, 7, 8a, 8b or 8c-1. It edits the `@ptah-extension/core` project (`claude-rpc.service.ts`, `testing/mock-rpc-service.ts`) after 8c-1.

### Task 8c-2.1: FileLinkRouterService — PENDING

- Files: CREATE `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/chat/src/lib/services/file-link-router.service.ts`, `file-link-router.service.spec.ts`; MODIFY `libs/frontend/chat/src/lib/services/index.ts`
- Plan reference: implementation-plan.md:805-827
- Pattern to follow: `libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts:24,40-43,121-128` (dynamic git-ui import + `Injector`; no static git-ui import)
- Quality requirements: implements both `IFileLinkOpener` and `MarkdownFileLinkHandler`. Context lookup starts at `origin.closest('markdown,[markdown]')?.parentElement ?? origin` and continues as follows:
  - a `data-ptah-link-document` / `data-ptah-link-root` ancestor supplies the document and root;
  - otherwise a `data-ptah-tab-id` ancestor resolves the root through `TabManagerService.findTabByIdAcrossWorkspaces` (`tab-manager.service.ts:504`);
  - otherwise the root is `vscode.config().workspaceRoot`.
    On Electron: `setEditorPanelVisible(true)`, then `GitReviewService.setMode('working-tree')`, then `DiffTabsService.openFileView`. On VS Code: `rpcCall('file:open', {path,line,column,workspaceRoot})`. Import failures are logged with the `[FileLinkRouter]` prefix.
- Validation notes: covers a background-workspace root, an agent-injected attribute inside `<markdown>` being ignored, and the document context passing `documentPath`.

### Task 8c-2.2: Agent-output context markers (R2) — PENDING

- Depends on: Task 8c-2.1
- Files: MODIFY `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts` (host `data-ptah-tab-id` + `data-ptah-file-links`) and `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts` (same). Also MODIFY the host containers that render agent markdown outside those two hosts:
  - `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts` (mounted at `chat-view.component.html:264` and `tribunal-panel/.../vendor-card.component.ts:25`);
  - `libs/frontend/chat/src/lib/components/organisms/subagent-transcript-overlay.component.ts` (mounted in `app-shell.component.html:7`).
    The executor greps `<ptah-execution-node`, `<ptah-agent-card-output`, `<ptah-subagent-transcript-viewer`, `<markdown` and `<ptah-markdown-block` across `libs/frontend` and lists each host in the report as marked or deliberately unmarked.
- Quality requirements: markers are Angular host bindings only. They are never placed on a `markdown` element or inside rendered content.
- Validation notes (R2, deliberately unmarked: non-agent content): `tasks-ui` task-detail, `chat/settings/*`, `chat/update-dialog`, `skill-synthesis-ui/*`, `setup-wizard` `analysis-results`, and `tribunal-panel` `crucible-verdict-panel`. `harness-builder` and `setup-wizard` analysis transcripts render agent execution nodes without a session tab. The default is UNMARKED, recorded in the report as a follow-up, unless the orchestrator decides otherwise. A spec asserts that a relative link inside task-detail markdown is not intercepted.

### Task 8c-2.3: FilePathLink + tasks board through `FILE_LINK_OPENER` — PENDING

- Depends on: Task 8c-2.1
- Files: MODIFY `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/chat-ui/src/lib/atoms/file-path-link.component.ts`, `file-path-link.component.spec.ts`, `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts` (`openArtifact` :1351-1368) and its spec
- Plan reference: implementation-plan.md:829-834
- Quality requirements: FilePathLink injects `FILE_LINK_OPENER` and `ElementRef`, emits `clicked`, then calls `open({path, origin})`. The tasks store sets its error signal only when the opener rejects.
- Validation notes: the spec performs a rendered click, not a method call.

### Task 8c-2.4: Delete `ClaudeRpcService.openFile` and every test double (R5) — PENDING

- Depends on: Task 8c-2.3
- Files: MODIFY
  - `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/core/src/lib/services/claude-rpc.service.ts` (delete `openFile` at :284-289; drop the `FileOpenResult` import if it becomes unused)
  - `libs/frontend/core/src/lib/services/claude-rpc-augment.spec.ts` (:224-250)
  - `libs/frontend/core/src/testing/mock-rpc-service.ts` (:66-95) and `mock-rpc-service.spec.ts` (:34-39)
  - `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/libs/frontend/tribunal-panel/src/lib/components/relay-phase-rail.component.spec.ts` (:68-96, 212: provide a fake `FILE_LINK_OPENER` and assert the path passed)
  - `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/apps/ptah-extension-webview/src/app/unit5-message-routing.spec.ts` (:131)
- Validation notes: after the change, `grep -rn "rpcService.openFile\|rpc.openFile\|openFile: jest.fn" libs apps` must return nothing. The remaining `openFile` hits are the git-ui launcher, the platform adapters and the backend handlers.

### Task 8c-2.5: Composition root wiring — PENDING

- Depends on: Tasks 8c-2.1, 8c-2.4
- Files: MODIFY `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/apps/ptah-extension-webview/src/app/app.config.ts` (near :115-134 and :266); CREATE `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/apps/ptah-extension-webview/src/app/file-link-wiring.spec.ts`
- Quality requirements: `{provide: FILE_LINK_OPENER, useExisting: FileLinkRouterService}`, `{provide: MARKDOWN_FILE_LINK_HANDLER, useExisting: FileLinkRouterService}` and `provideMarkdownFileLinks()`.
- Validation notes: the spec proves both tokens resolve to the same instance and that exactly one document listener is installed.

### Task 8c-2.6: Electron e2e `agent file links` — PENDING

- Depends on: Tasks 8c-2.1 through 8c-2.5
- Files: CREATE `D:/projects/ptah-extension/.claude/worktrees/git-review-controls/apps/ptah-electron-e2e/src/specs/git/agent-file-links.spec.ts`
- Plan reference: implementation-plan.md:836-848
- Pattern to follow: `apps/ptah-electron-e2e/src/support/session-seed.ts`, `support/fixtures.ts`, `ui.getObservedCalls`
- Quality requirements: the describe title is exactly `agent file links`. Assert `[1200,800]` and a dock of 700 ±1. No window or dock resizing, and real clicks only.
- Validation notes: plan steps 1-7, plus these additions:
  - (R1) An `outside-roots` result with `externalOpenAllowed:true` requires the confirm step, which shows the absolute path, before `editor:openFile {scope:'external-link'}` is observed. Cancel produces no call.
  - (R2) A relative link rendered in a non-agent markdown surface reachable in the fixture (the task detail, if seedable) issues no `file:viewContent`. If no such surface can be seeded, state it; the unit spec from 8c-2.2 is then the proof.
  - Step 7: `webContents.reload()` completes, the window URL is unchanged after every link click, and the dock state restores (A6/A7, D10).

### Batch 8c-2 verification

- `npx nx run-many -t lint typecheck test -p @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/tasks-ui @ptah-extension/tribunal-panel @ptah-extension/core ptah-extension-webview --parallel=1`, expecting a header of 6 projects
- `npx nx run-many -t lint typecheck -p ptah-electron-e2e`, expecting 1 project
- `npx nx e2e ptah-electron-e2e -- --grep "agent file links|git source-control rail|Git dock|historical branch review controls|in-editor hunk action widget|hunk revert dialog"`, all passing
- `git diff --check`
- Reviewer: code-logic-reviewer (context resolution, platform branches, deletion completeness). The visual review follows in the final gate.

### Batches 7-8 final gate (team-leader, after 8c-2)

- `npx nx run-many -t lint typecheck -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/cli-engine @ptah-extension/core @ptah-extension/git-ui @ptah-extension/markdown @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/tasks-ui @ptah-extension/tribunal-panel ptah-electron ptah-extension-vscode ptah-extension-webview ptah-electron-e2e --parallel=1`, expecting a header of 14 projects
- `npx nx run-many -t test -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/cli-engine @ptah-extension/core @ptah-extension/git-ui @ptah-extension/markdown @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/tasks-ui @ptah-extension/tribunal-panel ptah-electron ptah-extension-vscode ptah-extension-webview web-members`, expecting a header of 14 projects
- `npx nx e2e ptah-electron-e2e -- --grep "agent file links|git source-control rail|Git dock|historical branch review controls|in-editor hunk action widget|hunk revert dialog"`
- `git diff --check`
- Reviews: code-logic-reviewer and code-style-reviewer across all of 7-8, then the visual-reviewer at 1200x800 with the 700 px dock (rail collapse and drag, file tab, markdown preview, blocked tab and confirm).
- Every R1-R9 row needs a recorded resolution before any batch is marked COMPLETE.
- Commits stay blocked until the user authorizes them.
