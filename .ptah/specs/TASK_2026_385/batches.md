# Batches - TASK_2026_385

Total tasks: 26 | Batches: 26 | Complete: 10/26

Phase 0 closed at commit `adc809373` (batches 0.1–0.5).

## Plan validation

Status: PASSED WITH RISKS

Three defects found in the plan's own ordering. All three are fixed by the
batching below; none is a BLOCKER.

### Defect 1 — commitlint has no `git-ui` scope (would break every Phase 2+ commit)

`D:\projects\ptah-extension\.commitlintrc.json` sets `scope-enum` at severity 2
(hard error). The list holds `editor`, `workspace-indexing`, `skill-synthesis-ui`
— and no `git-ui`. The husky `commit-msg` hook would reject
`refactor(git-ui): …` outright. The plan never mentions the file.

**Fix**: Batch 2.1 adds `"git-ui"` to `scope-enum`; Batch 4.1 removes `"editor"`
when the lib dies. Batch 2.1's own commit is scoped `webview`, so it does not
depend on the change it introduces.

### Defect 2 — the git-ui lazy-chunk budget cannot be measured in Phase 2

Component 1 puts the `"type": "bundle"` budget in
`apps\ptah-extension-webview\project.json` with `maximumError` "set from the
first measured build". In Phase 2 nothing imports `git-ui` lazily yet — the dock
that creates the chunk is Phase 3, Component 9. A budget written in Phase 2 is
either guessed or measured against a chunk that does not exist.

**Fix**: the budget moves out of Batch 2.1 into Batch 3.4, after the Phase 3
dock mount makes `git-ui` a real lazy chunk. Acceptance criterion CX:125 is still
met, one phase later.

### Defect 3 — Phase 2's parallel set is not file-disjoint from the surviving editor lib

The plan's Phase-2 parallel groups move `editor-tab.types.ts`,
`git-read-error-messages.ts` and the four git services out of
`libs/frontend/editor`, but assign no owner to the _importers left behind_:
`editor-diff-split.ts`, `editor-panel.component.ts`, `editor.service.ts`,
`code-editor.component.ts` and the file-tree family all resolve `EditorTab` and
friends from paths that no longer exist. Four parallel batches would each have to
edit the same three files.

**Fix**: Batch 2.7 (serialized, last in the phase) owns **every** surviving
editor-lib import repoint plus both editor barrels. Batches 2.2–2.5 touch only
files they move or own. Consequence: 2.2–2.6 do not typecheck standing alone, so
Phase 2 uses a commit window (below).

### Commit windows (the default this decomposition chose)

CX:112 requires green after **every phase**, not after every batch. The manifest
partition invariant (`register-rpc-surface.ts:141`) and the file moves both force
multi-batch atomicity. So:

| Phase | Commits                                      | Closing batch |
| ----- | -------------------------------------------- | ------------- |
| 0     | 1 (window 0.1→0.5)                           | 0.5           |
| 1     | 1 (window 1.1→1.5)                           | 1.5           |
| 2     | 2 — 2.1 alone, then window 2.2→2.7           | 2.7           |
| 3     | 4 — genuinely independent, per plan line 820 | each          |
| 4     | 2 — window 4.1→4.4, then 4.5                 | 4.4, 4.5      |

Batches inside a window are verified on disk and marked IMPLEMENTED, but no
commit is cut until the closing batch lands and the phase verification commands
pass. The team-leader cuts the commit, never the executor.

### Assumptions

- `SDK_TOKENS.SDK_PROCESS_SPAWNER` resolves inside a phase-4 Electron handler —
  **unverified**. Checked by Task 1.2, which already edits
  `container.smoke.spec.ts` to delete the `PTY_HOST` aliasing test; it adds a
  resolution assertion in the same pass. Verifying it in Phase 1 costs nothing
  and de-risks Phase 3 Batch 3.2.
- `code` is on `PATH` on the CI machine — **unverified and deliberately not
  relied on**. Task 3.2 must make a spawn failure a logged non-throwing no-op
  returning `{ success: false, error }`; no test asserts an editor appeared.
- No consumer outside the repo imports `@ptah-extension/editor` — **verified**:
  the lib has no `build` target in `libs\frontend\editor\project.json` and is not
  published. Re-checked by Task 4.1 with `npx nx graph`.
- `type:feature` may depend on `type:feature` — **verified** at
  `eslint.config.mjs` depConstraints, so the transient `editor → git-ui` edge in
  Phase 2 is legal and needs no tag change.
- The 23 files referencing `@ptah-extension/editor` outside the lib itself —
  **verified by grep**, and they match the plan's six import sites plus config,
  spec and docs references. No unknown consumer.

### Risks

| Risk                                                                                   | Severity | Mitigation                                                                                                                       |
| -------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| commitlint rejects `git-ui`-scoped commits                                             | HIGH     | Task 2.1                                                                                                                         |
| Bundle budget guessed instead of measured                                              | MEDIUM   | Task 3.4, after the dock mount                                                                                                   |
| Phase 2 leaves the editor lib with dangling imports                                    | HIGH     | Task 2.7 owns all repoints; commit window                                                                                        |
| A partial contract edit throws at boot (`assertManifestInvariants`)                    | HIGH     | One serialized contract batch per phase: 0.4, 1.5, 2.6, 4.4. Never split across executors                                        |
| `phase-4-handlers.ts` edited by two Phase 1 batches                                    | MEDIUM   | The whole file belongs to Task 1.5 only; Task 1.2 does not touch it                                                              |
| Removing `node-pty`/`@xterm/*` from the Electron package breaks the native rebuild     | MEDIUM   | Task 1.3 runs `npm install` before the phase verification; `node-pty` stays in the ROOT `package.json` (CLI e2e `pty-runner.ts`) |
| Deleting `EditorPanelComponent` before the dock exists drops every `git:status-update` | HIGH     | Phase 3 → 4 is a hard order; Task 4.1 is gated on Task 3.3's `specs/git/git-dock.spec.ts` passing                                |
| CLI consumes 9 of the 18 `git:*` methods                                               | HIGH     | No batch prunes any `git:*` method. `git:push` and `git:diffFile` are dock-critical though CLI-unused                            |
| Four producers broadcast `git:worktreeChanged`                                         | MEDIUM   | Task 2.2 keeps the literal type string; producers untouched                                                                      |
| `editor-tour` is the documented showcase exemplar                                      | LOW      | Task 4.5 promotes `chat-code-edit.scene.ts` in `FOLLOW-UP.md:35` in the same edit                                                |
| `DIFF_LAYOUT_SETTING_KEY` has never persisted (live bug, correction #11)               | MEDIUM   | Task 2.6 registers `diff.renderSideBySide` in `FILE_BASED_SETTINGS_KEYS`/`DEFAULTS`; Task 2.7 renames the constant               |

### Edge cases

- A `git:status-update` arriving before `startListening()` — dropped by the
  `_isListening` gate. Task 2.2 adds the assertion for the converted
  `GitBranchesService`.
- A diff tab revalidating on `file:content-changed` must not blank rendered
  content — Task 2.3, ported A1/A2/A3 assertions.
- A hunk apply whose `snapshotToken` moved must be refused — Task 2.3, D2.
- `file:open` with a path outside every workspace root must spawn nothing —
  Task 3.2.
- A write under `.nx\cache`, `coverage` or `tmp` schedules nothing, while `out`,
  `build`, `.next` and `.turbo` still do — Task 4.3 (negative controls are the
  counterweight `workspace-scan.constants.ts:21-27` was protecting).
- A persisted layout blob carrying `editorWidth`/`editorVisible` still restores —
  no batch changes `LAYOUT_STATE_KEY`; Task 4.1 changes doc comments and the
  sidebar label only.

### Verification commands (from the plan, project names are `project.json` `name` fields)

Check the `Running target … for N projects` header every time — `npx nx test a b c`
silently runs only `a`.

- Every phase: `npm run typecheck:all`, `npm run lint:all`, `npm run build:all`
- Phase 0 (5): `npx nx run-many -t test -p @ptah-extension/editor @ptah-extension/rpc-handlers @ptah-extension/cli-engine ptah-extension-vscode @ptah-extension/shared`
- Phase 1 (6): `npx nx run-many -t test -p @ptah-extension/editor @ptah-extension/rpc-handlers @ptah-extension/cli-engine ptah-extension-vscode @ptah-extension/shared ptah-electron` then `nx run ptah-electron-e2e:e2e`
- Phase 2 (9): `npx nx run-many -t lint typecheck test -p @ptah-extension/git-ui @ptah-extension/editor @ptah-extension/skill-synthesis-ui @ptah-extension/chat @ptah-extension/core @ptah-extension/rpc-handlers @ptah-extension/platform-core @ptah-extension/shared ptah-extension-webview` plus `npx nx graph` showing no `git-ui → editor` edge
- Phase 3 (5): `npx nx run-many -t test -p @ptah-extension/git-ui @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/rpc-handlers ptah-electron` then `nx run ptah-electron-e2e:e2e`
- Phase 4 (13): `npx nx run-many -t test -p @ptah-extension/git-ui @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/core @ptah-extension/tasks-ui @ptah-extension/rpc-handlers @ptah-extension/vscode-core @ptah-extension/platform-core @ptah-extension/cli-engine @ptah-extension/shared ptah-electron ptah-extension-vscode ptah-extension-webview` then `nx run ptah-electron-e2e:e2e`, `nx build ptah-docs`, and re-run + record `apps\ptah-electron-e2e\src\specs\perf\startup-tti.spec.ts`

---

## Batch 0.1: Vim removal — COMPLETE (adc809373)

- Recommended executor: frontend-developer
- Fallback executor: CLI lane
- Execution mode: sequential (single task)
- Rationale: one Angular lib concern, five files, no contract surface.
- Tasks: 1 | Depends on: none | Parallel with: 0.2, 0.3

### Task 0.1: delete the vim mode service and its asset plumbing — COMPLETE

- Files: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\vim-mode.service.ts` + `.spec.ts` (DELETE), `D:\projects\ptah-extension\libs\frontend\editor\src\lib\code-editor\code-editor.component.ts`, `D:\projects\ptah-extension\apps\ptah-extension-webview\project.json` (monaco-vim asset glob `:27-31`), `D:\projects\ptah-extension\package.json` (`monaco-vim` dependency)
- Plan reference: implementation-plan.md:907 (Phase 0 parallel set), context.md:20-22
- Pattern to follow: none — deletion
- Quality requirements: no dead import left in `code-editor.component.ts`; do not touch `editor-panel.component.ts` or either barrel (Task 0.5 owns them)
- Validation notes: `vim-mode.service.ts:69,89` are two of the three `editor:getSetting/updateSetting` callers (correction #10). After this batch the diff view is the only caller, which is what makes Task 2.6's rename a two-site edit
- Implementation details: the `editor.vimMode` settings-key retirement in `file-settings-keys.ts` is **NOT** in this batch — Task 0.4 owns it, because that file is part of the contract set
- Acceptance evidence: `libs\frontend\editor` contains no `vim` file; `package.json` has no `monaco-vim`; webview `project.json` has no `monaco-vim` glob

---

## Batch 0.2: Quick-open and search panel removal — COMPLETE (adc809373)

- Recommended executor: frontend-developer
- Fallback executor: CLI lane
- Execution mode: sequential
- Rationale: two sibling folders plus their one host; disjoint from 0.1 and 0.3.
- Tasks: 1 | Depends on: none | Parallel with: 0.1, 0.3

### Task 0.2: delete the quick-open and search surfaces — COMPLETE

- Files: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\quick-open\` (DELETE), `D:\projects\ptah-extension\libs\frontend\editor\src\lib\search\` (DELETE), `D:\projects\ptah-extension\libs\frontend\editor\src\lib\sidebar\sidebar.component.ts`
- Plan reference: implementation-plan.md:907, context.md:22-23
- Quality requirements: `sidebar.component.ts` keeps its source-control and worktree mounts (`:19,116-121`) — they die in Phase 4, not here
- Validation notes: `editor:searchInFiles` and `editor:listAllFiles` lose their consumers here; their contract removal is Task 0.4
- Acceptance evidence: both folders gone; `sidebar.component.ts` compiles with no search/quick-open reference

---

## Batch 0.3: Dead worktree components — COMPLETE (adc809373)

- Recommended executor: frontend-developer
- Fallback executor: CLI lane
- Execution mode: sequential
- Rationale: two consumer-less components; smallest batch in the phase.
- Tasks: 1 | Depends on: none | Parallel with: 0.1, 0.2

### Task 0.3: delete WorktreePanelComponent and AddWorktreeDialogComponent — COMPLETE

- Files: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\worktree\worktree-panel.component.ts` (+ spec if present), `D:\projects\ptah-extension\libs\frontend\editor\src\lib\worktree\add-worktree-dialog.component.ts` (+ spec if present) — DELETE
- Plan reference: implementation-plan.md:231-232, context.md:23
- Quality requirements: `worktree-section.component.ts` **stays** — it moves to `git-ui` in Task 2.4
- Acceptance evidence: only `worktree-section.component.ts` remains under `lib/worktree/`

---

## Batch 0.4: Phase 0 contract set — COMPLETE (adc809373)

- Recommended executor: backend-developer
- Fallback executor: none — do not split this batch
- Execution mode: sequential
- Rationale: Component 13's atomic edit set. `assertManifestInvariants` turns a
  partial edit into a boot-time throw, so every site lands together or none does.
- Tasks: 1 | Depends on: 0.1, 0.2, 0.3 | Parallel with: 0.5

### Task 0.4: remove editor:searchInFiles, editor:listAllFiles and layout:\* from every contract site — COMPLETE

- Files:
  - DELETE `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\layout-rpc.handlers.ts` + its spec
  - `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts` — both the `RpcMethodRegistry` interface (opens `:626`) and `RPC_METHOD_ENTRIES` (opens `:3391`); `_AssertAllRpcMethodsListed` `:3813-3819` fails the build if they disagree
  - `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\host-profile\manifest.ts` — `EDITOR_PANE_METHODS` `:99-112`, the `layout` entry `:358-363`
  - `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\host-profile\capabilities.ts` — `layoutPersistence` `:56`
  - `D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-handler.ts` — `ALLOWED_METHOD_PREFIXES` opens `:44`; remove `'layout:'` `:68`
  - `D:\projects\ptah-extension\apps\ptah-electron\src\rpc-host-profile.ts`, `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\rpc-host-profile.ts`, `D:\projects\ptah-extension\libs\backend\cli-engine\src\lib\rpc\cli-host-profile.ts`
  - `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\rpc-surface.spec.ts` (`:34-194`), `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\expected-absent.ts` (`:50-62`), `D:\projects\ptah-extension\libs\backend\cli-engine\src\lib\rpc\rpc-surface.spec.ts` (`:35-63`), `D:\projects\ptah-extension\libs\backend\cli-engine\src\lib\rpc\expected-absent.ts` (`:19-29`)
  - `D:\projects\ptah-extension\libs\backend\platform-core\src\file-settings-keys.ts` — retire `editor.vimMode` (`:208` key, `:480` default)
  - **(correction, found at verification)** `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\editor-rpc.handlers.ts` + `.spec.ts` — the Electron-side implementations behind the two removed `editor:*` methods (`registerSearchInFiles`, `registerListAllFiles`, `EXCLUDED_DIRS_GLOB`, `BINARY_EXTENSIONS`). The original list named only the contract sites; removing the contract without these leaves dead handlers registered. `TREE_HIDDEN_DIRS` / `isExcludedWorkspacePath` stay — still used by `editor:getFileTree`
  - **(correction)** `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\host-profile\host-profile.ts` — `layoutPersistence` in `ALL_DISABLED`
  - **(correction)** `D:\projects\ptah-extension\package-lock.json` — must be regenerated with `npm install --package-lock-only` when `monaco-vim` leaves `package.json`, or `npm ci` fails on the lock/manifest mismatch
- Plan reference: implementation-plan.md:685-722 (Component 13), :907
- Pattern to follow: the manifest partition must stay total and disjoint — `rpc-allowlist.spec.ts:41,45,50,59,84`
- Quality requirements: removing a capability also edits both `expected-absent` lists. `_AssertAllRpcMethodsListed` is the compile-time guard; `assertManifestInvariants` (`register-rpc-surface.ts:141`) is the boot guard
- Validation notes: carries the HIGH "partial contract edit" risk. One executor, one pass
- Acceptance evidence: `npx nx run-many -t test -p @ptah-extension/rpc-handlers @ptah-extension/cli-engine ptah-extension-vscode @ptah-extension/shared` green (4 projects in the header)

---

## Batch 0.5: Phase 0 lib closer — COMPLETE (adc809373)

- Recommended executor: frontend-developer
- Fallback executor: CLI lane
- Execution mode: sequential
- Rationale: the three files every 0.1–0.3 batch would otherwise contend for.
- Tasks: 1 | Depends on: 0.1, 0.2, 0.3 | Parallel with: 0.4

### Task 0.5: reconcile the editor panel and both barrels — COMPLETE

- Files: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\editor-panel\editor-panel.component.ts` + `.spec.ts`, `D:\projects\ptah-extension\libs\frontend\editor\src\index.ts`, `D:\projects\ptah-extension\libs\frontend\editor\src\services.ts`
- Plan reference: implementation-plan.md:907 ("all four touch `editor-panel.component.ts`, `index.ts` and the Component-13 contract set")
- Quality requirements: `editor-panel.component.ts:845` — the sole `GitStatusService.startListening()` call — **must survive this phase**. It is only replaced in Phase 3
- Acceptance evidence: `npx nx run-many -t lint typecheck test -p @ptah-extension/editor ptah-extension-webview` green

### Batch 0.4 + 0.5 verification (phase close)

- `npm run typecheck:all`, `npm run lint:all`, `npm run build:all` green
- `npx nx run-many -t test -p @ptah-extension/editor @ptah-extension/rpc-handlers @ptah-extension/cli-engine ptah-extension-vscode @ptah-extension/shared` — header reads 5 projects
- **Phase 0 commit** (team-leader): `refactor(webview): delete vim, quick open, search and the layout rpc surface`

---

## Batch 1.1: Terminal renderer removal — COMPLETE (d9a2a9f1a)

- Recommended executor: frontend-developer
- Fallback executor: CLI lane
- Execution mode: sequential
- Rationale: the xterm-facing half of the vertical, all inside the editor lib.
- Tasks: 1 | Depends on: Phase 0 complete | Parallel with: 1.2, 1.3, 1.4

### Task 1.1: delete the terminal panel, service and xterm styling — COMPLETE

- Files: `D:\projects\ptah-extension\libs\frontend\editor\src\lib\terminal\` (DELETE), `...\src\lib\services\terminal.service.ts` + `.spec.ts` (DELETE), `...\src\lib\services\editor.service.ts` (terminal signals), `...\src\lib\types\terminal.types.ts` (DELETE), `D:\projects\ptah-extension\apps\ptah-extension-webview\src\styles.css` (xterm CSS import), `D:\projects\ptah-extension\libs\frontend\editor\src\index.ts` + `services.ts` (terminal exports)
- Plan reference: context.md:29-31, implementation-plan.md:908
- Quality requirements: `editor.service.ts` keeps everything non-terminal — it dies in Phase 4, not here
- Validation notes: after this, `workspace-coordinator.service.ts:104-110` resolves three services, not four, which is what makes the Phase 2 repoint smaller (plan line 894)
- Acceptance evidence: no `@xterm` import anywhere under `libs/frontend`; webview builds

---

## Batch 1.2: PTY host removal — COMPLETE (d9a2a9f1a)

- Recommended executor: backend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: DI tokens, preload bridge and binary IPC channels — one coherent host concern.
- Tasks: 1 | Depends on: Phase 0 complete | Parallel with: 1.1, 1.3, 1.4

### Task 1.2: delete PtyManagerService, the preload bridge and the PTY_HOST port — COMPLETE

- Files: `D:\projects\ptah-extension\apps\ptah-electron\src\services\pty-manager.service.ts` + `.spec.ts` (DELETE), `...\src\preload.ts` (`ptahTerminal` bridge), `...\src\ipc\ipc-bridge.ts` (binary channels), `...\src\activation\bootstrap.ts`, `...\src\di\electron-tokens.ts`, `...\src\di\container.smoke.spec.ts`, `D:\projects\ptah-extension\libs\backend\platform-core\src\interfaces\pty-host.interface.ts` (DELETE), `...\src\di\tokens.ts`, `...\src\index.ts`, `...\src\utils\shell-allowlist.ts` (DELETE), `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\utils\workspace-authorization.ts`
- Plan reference: context.md:30-33, implementation-plan.md:908, correction #24
- Quality requirements: from `workspace-authorization.ts` remove `authorizedTerminalRoots` `:46` and, in the same pass, the two already-dead exports `isAuthorizedTerminalCwd` `:58` and `isWithinHomeDir` `:30`. **Keep** `isAuthorizedWorkspace` `:14` and `isPathWithinRoots` (`platform-core\src\utils\path-containment.ts:71`) — Task 3.2 depends on the latter
- Validation notes: **carries Assumption 1.** While editing `container.smoke.spec.ts` to delete the `PTY_HOST` aliasing test, add an assertion that `SDK_TOKENS.SDK_PROCESS_SPAWNER` (`libs\backend\agent-sdk\src\lib\di\tokens.ts:51`) resolves from the built container. This de-risks Task 3.2 one phase early at near-zero cost
- Implementation details: **do not touch** `apps\ptah-electron\src\di\phase-4-handlers.ts` — Task 1.5 owns that whole file to keep the two batches disjoint
- Acceptance evidence: `npx nx run-many -t test -p ptah-electron @ptah-extension/platform-core` green; the smoke spec resolves `SDK_PROCESS_SPAWNER`

---

## Batch 1.3: Terminal packaging removal — COMPLETE (d9a2a9f1a)

- Recommended executor: devops-engineer
- Fallback executor: backend-developer
- Execution mode: sequential
- Rationale: packaging manifests and electron-builder prune blocks — build surface, not application source.
- Tasks: 1 | Depends on: Phase 0 complete | Parallel with: 1.1, 1.2, 1.4

### Task 1.3: drop node-pty and @xterm from the Electron package — COMPLETE

- Files: `D:\projects\ptah-extension\apps\ptah-electron\package.json`, `...\project.json` (externals), `...\electron-builder.yml` (prune blocks), `...\src\config\packaged-deps.spec.ts`
- Plan reference: context.md:34-36, implementation-plan.md:908
- Quality requirements: **`node-pty` stays in the ROOT `D:\projects\ptah-extension\package.json`** — the CLI e2e `pty-runner.ts` uses it (context.md:38-39). Removing it there breaks a green suite in an unrelated app
- Validation notes: a native dependency leaving the packaged app changes the postinstall electron rebuild. Run `npm install` after the edit and before the phase verification
- Acceptance evidence: `npx nx test ptah-electron` green including `packaged-deps.spec.ts`; `nx build ptah-electron` produces a bundle with no `node-pty` external

---

## Batch 1.4: Terminal e2e and scene cleanup — COMPLETE (d9a2a9f1a)

- Recommended executor: devops-engineer
- Fallback executor: CLI lane
- Execution mode: sequential
- Rationale: e2e harness files only.
- Tasks: 1 | Depends on: Phase 0 complete | Parallel with: 1.1, 1.2, 1.3

### Task 1.4: remove the pty e2e and the terminal beats — COMPLETE

- Files: `D:\projects\ptah-extension\apps\ptah-electron-e2e\src\specs\pty-manager.spec.ts` (DELETE — note the path, correction #5: it is at the specs root, not under `specs\editor\`), `...\src\specs\editor\editor.spec.ts` (the terminal test at `:69`), `...\src\showcase\editor-tour.scene.ts` (`:220-234`, terminal beats)
- Plan reference: context.md:36, implementation-plan.md:908
- Quality requirements: `editor.spec.ts:145-194` (the two git tests) must survive untouched — Task 3.3 ports them into `specs\git\git-dock.spec.ts`
- Acceptance evidence: `nx run ptah-electron-e2e:e2e` green with no pty spec

---

## Batch 1.5: Phase 1 contract set — COMPLETE (d9a2a9f1a)

- Recommended executor: backend-developer
- Fallback executor: none — do not split
- Execution mode: sequential
- Rationale: Component 13 again, plus the two files 1.1–1.4 were told not to touch.
- Tasks: 1 | Depends on: 1.1, 1.2, 1.3, 1.4

### Task 1.5: remove the terminal: prefix, pty capability and terminal RPC surface — COMPLETE

- Files:
  - DELETE `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\terminal-rpc.handlers.ts`, `terminal-rpc.schema.ts` and their specs
  - DELETE `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc\rpc-terminal.types.ts` and the `rpc.types.ts:20,329` re-exports
  - `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts` — interface `:626` and `RPC_METHOD_ENTRIES` `:3391`
  - `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\host-profile\manifest.ts` — `terminal` entry `:364-369`
  - `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\host-profile\capabilities.ts` — `pty` `:58`
  - `D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-handler.ts` — `'terminal:'` `:72`
  - `D:\projects\ptah-extension\apps\ptah-electron\src\rpc-host-profile.ts` (`pty: true` at `:40` — a capability flag, not a handler key, correction #8), plus the VS Code and cli-engine profiles
  - `D:\projects\ptah-extension\apps\ptah-electron\src\di\phase-4-handlers.ts` (both the `TerminalRpcHandlers` and the `PtyManagerService` registrations — this batch owns the whole file)
  - the two expected-absent lists and their two `rpc-surface.spec.ts` files
- Plan reference: implementation-plan.md:685-722, :908
- Validation notes: carries the HIGH partial-contract risk
- Acceptance evidence: `npx nx run-many -t test -p @ptah-extension/rpc-handlers @ptah-extension/cli-engine ptah-extension-vscode @ptah-extension/shared ptah-electron` green (5 projects)

### Batch 1 verification (phase close)

- `npm install` (native rebuild after the packaging change), then `npm run typecheck:all`, `npm run lint:all`, `npm run build:all`
- `npx nx run-many -t test -p @ptah-extension/editor @ptah-extension/rpc-handlers @ptah-extension/cli-engine ptah-extension-vscode @ptah-extension/shared ptah-electron` — header reads 6
- `nx run ptah-electron-e2e:e2e`
- **Phase 1 commit**: `refactor(electron): delete the terminal panel, pty host and its packaging`

---

## Batch 2.1: git-ui library scaffolding — COMPLETE (16e13df24)

- Recommended executor: devops-engineer
- Fallback executor: frontend-developer
- Execution mode: sequential — **lands alone and is committed alone**
- Rationale: project registration and workspace config. Nothing can move until the target project resolves.
- Tasks: 1 | Depends on: Phase 1 complete

### Task 2.1: create the git-ui project, alias and commit scope — PENDING

- Files: CREATE `D:\projects\ptah-extension\libs\frontend\git-ui\{project.json,jest.config.ts,eslint.config.mjs,tsconfig.json,tsconfig.lib.json,tsconfig.spec.json}`, `...\src\index.ts` (empty barrel), `...\src\test-setup.ts`. MODIFY `D:\projects\ptah-extension\tsconfig.base.json`, `D:\projects\ptah-extension\.commitlintrc.json`
- Plan reference: implementation-plan.md:163-250 (Component 1)
- Pattern to follow: `D:\projects\ptah-extension\libs\frontend\workspace-indexing\` — 6 config files, **no `package.json`, no `ng-package.json`** (that pair exists only for the ng-packagr libs; the editor lib's copies are vestigial and are not carried over)
- Quality requirements: `"name": "@ptah-extension/git-ui"`, `"prefix": "ptah"`, **`"tags": ["scope:webview", "type:feature"]`** (verified: `type:feature → type:feature` is permitted by `eslint.config.mjs` depConstraints, so the transient `editor → git-ui` edge is legal). `typecheck` target is `npx ngc --noEmit --project libs/frontend/git-ui/tsconfig.lib.json`. Single entry point — no `/services` secondary barrel, because the xterm reason for the split died in Phase 1. `jest.config.ts` does **not** carry the editor lib's `ngx-markdown` `moduleNameMapper` (`libs\frontend\editor\jest.config.ts:16-24`) — that exists for `CodeEditorComponent`, which is not moving
- Validation notes: **fixes Defect 1.** Add `"git-ui"` to `scope-enum` in `.commitlintrc.json`. Severity is 2, so without it every subsequent `refactor(git-ui): …` is rejected by the husky commit-msg hook. Do **not** add the bundle budget here — Defect 2 moved it to Task 3.4
- Implementation details: `tsconfig.base.json` gets `"@ptah-extension/git-ui": ["./libs/frontend/git-ui/src/index.ts"]` in alphabetical position
- Acceptance evidence: `npx nx run-many -t lint typecheck test -p @ptah-extension/git-ui` succeeds on an empty lib; `npx nx show project @ptah-extension/git-ui` resolves
- Commit (its own, scoped `webview` so it does not depend on the scope it adds): `chore(webview): scaffold the git-ui library project and path alias`

---

## Batch 2.2: Git services move — COMPLETE (c6b263c72)

- Recommended executor: frontend-developer
- Fallback executor: CLI lane
- Execution mode: sequential
- Rationale: four services, two listener conversions, one shared review context.
- Tasks: 1 | Depends on: 2.1 | Parallel with: 2.3, 2.4, 2.5, 2.6

### Task 2.2: move the four git services and convert two raw window listeners — PENDING

- Files (`git mv`, then fix imports): `git-status.service.ts` + `.spec.ts`, `git-branches.service.ts` + `.spec.ts`, `worktree.service.ts` (+ new spec), `source-control.service.ts` — from `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\` to `D:\projects\ptah-extension\libs\frontend\git-ui\src\lib\services\`
- Plan reference: implementation-plan.md:252-333 (Components 2–5)
- Pattern to follow: `git-status.service.ts:268-275` is the `MessageHandler` shape both conversions copy
- Quality requirements:
  - `GitStatusService`: **drop** `fileStatusMap` `:142-153` and `changedDirPrefixes` `:180-194` (tree-only) and their B3 specs. Every other public member keeps its signature. Do not change the identity of `files()`
  - `GitBranchesService`: replace the raw listener `:179-192` with `implements MessageHandler`, filtering `MESSAGE_TYPES.GIT_STATUS_UPDATE` behind the same `_isListening` gate. `startListening()`/`stopListening()` keep their names and idempotence
  - `WorktreeService`: convert `:216-258` (`window.addEventListener` at `:251`). **`'git:worktreeChanged'` is dispatched by literal type string and is NOT in `MESSAGE_TYPES`** — match the literal, as `tasks-store.service.ts:47-52` does. Four backend producers broadcast it (`git-rpc.handlers.ts:370`, `ptah-api-builder.service.ts:874`, `sdk-callbacks.ts:356` and `:374`); the wire contract must not move
- Validation notes: a converted service with no `MESSAGE_HANDLERS` provider is **silently deaf** — `MessageRouterService` builds its map at construction. The providers are Task 2.7's, so this batch does not typecheck end-to-end on its own. That is expected inside the commit window
- Implementation details: rewrite `git-branches.service.spec.ts` (~`:397-463`) to dispatch through `handleMessage` rather than `window.dispatchEvent`, and add an assertion that a push arriving **before** `startListening()` is dropped. New worktree spec: a `{action:'created', operationId}` routed through `handleMessage` resolves the matching pending op and calls `addFolderByPath`
- Acceptance evidence: the four services exist under `git-ui`; no `window.addEventListener` remains in any of them

---

## Batch 2.3: Diff engine move and DiffTabsService — COMPLETE (c6b263c72)

- Recommended executor: frontend-developer
- Fallback executor: none — this is the hardest batch in the task
- Execution mode: sequential
- Rationale: a 1512-line spec port and a service extracted from a 900-line helper; needs one continuous head.
- Tasks: 1 | Depends on: 2.1 | Parallel with: 2.2, 2.4, 2.5, 2.6

### Task 2.3: move the diff view and extract DiffTabsService — PENDING

- Files:
  - MOVE `lib/diff-view/diff-view.component.ts` + `.spec.ts` + `diff-view-dialog.a11y.spec.ts` → `D:\projects\ptah-extension\libs\frontend\git-ui\src\lib\diff-view\`
  - MOVE `lib/services/monaco-loader.service.ts` → `...\git-ui\src\lib\services\` (internal, **not** exported from the barrel — it is not public in the editor lib either)
  - MOVE `lib/services/editor/editor-tab.types.ts` → `...\git-ui\src\lib\types\diff-tab.types.ts` (**the whole 231-line file**, correction #3 — `DiffViewComponent.diffTab` is `input<EditorTab | null>` and design-handoff.md:31 freezes it)
  - MOVE `lib/services/editor/git-read-error-messages.ts` → `...\git-ui\src\lib\services\`
  - CREATE `...\git-ui\src\lib\services\diff-tabs.service.ts` + `.spec.ts`
- Plan reference: implementation-plan.md:335-424 (Components 6, 7)
- Pattern to follow: port from `D:\projects\ptah-extension\libs\frontend\editor\src\lib\services\editor\editor-diff-split.ts`
- Quality requirements:
  - `DiffViewComponent`'s four inputs and one output (`:696-730`) are **frozen** by design-handoff.md:31. The only edits are the import specifiers at `:38` and `:39-45`. **Do not** touch `:142`, `:1432`, `:1449` — Task 2.7 owns the setting-key rename, to keep it in the same commit as Task 2.6's backend half
  - `DiffTabsService` is `@Injectable({ providedIn: 'root' })` and ports only the keep-half: `requestDiff` `:684`, `toDiffState` `:704`, `transportFailureState` `:753`, `labelFor` `:784`, `applyFreshDiff` `:798`, `patchDiff` `:820`, `toWorkspaceRelative` `:838`, fields `:68`/`:76`/`:79-82`, and the public bodies `openDiff` `:113`, `onGitStatusUpdate` `:180`, `onFileContentChanged` `:202`, `refreshAllDiffTabs` `:214`, `refreshDiffTab` `:230`, `applyHunks` `:307`, `dispose` `:372`, rewritten against its own signals. **Not ported**: the nine split-pane members `:394`–`:613`, the five privates `:626`–`:669`, `MIRROR_DEBOUNCE_MS` `:92`, `mirrorTimer` `:95`
  - It exposes a bound `applyHunksFn: HunkApplyFn` so `DiffViewComponent` needs no injection. `EditorInternalState.showError` becomes a local `errorMessage: Signal<string | null>`
  - `DiffTabsService → GitStatusService`, never the reverse
- Validation notes: the A1/A2/A3 and D2 assertions of `editor-diff-split.spec.ts` must survive the port — revalidate-on-reopen, per-comparison keys, sanitized error copy, and refusal of an apply whose `snapshotToken` moved. A `refreshing`/`stale`/`error` state must never blank previously-rendered content (`editor-tab.types.ts:29-31`)
- Implementation details: one `git:diffFile` per workspace per 250 ms burst; never more than one in flight per key
- Acceptance evidence: `npx nx run-many -t test -p @ptah-extension/git-ui` shows the ported diff suites green; no split-pane symbol exists in `git-ui`

---

## Batch 2.4: Source-control and worktree components move — COMPLETE (c6b263c72)

- Recommended executor: frontend-developer
- Fallback executor: CLI lane
- Execution mode: sequential
- Rationale: four components moving with one behavioural edit between them.
- Tasks: 1 | Depends on: 2.1 | Parallel with: 2.2, 2.3, 2.5, 2.6

### Task 2.4: move the source-control panel, file row and worktree section — PENDING

- Files: MOVE `lib/source-control/source-control-panel.component.ts` + `.spec.ts`, `lib/source-control/source-control-file.component.ts` + `.spec.ts`, `lib/worktree/worktree-section.component.ts` (+ new spec) into `D:\projects\ptah-extension\libs\frontend\git-ui\src\lib\`
- Plan reference: implementation-plan.md:426-459 (Component 8)
- Quality requirements: **no signature may change** — design-handoff.md:28-29 names both source-control components as reused as-is. `SourceControlPanelComponent`: selector `ptah-source-control-panel`, `files = input.required<GitFileStatus[]>()` `:235`, outputs `fileClicked` `:237` / `diffRequested` `:239`. `SourceControlFileComponent`: inputs `:144-145`, five outputs `:147-156`. The per-instance `aria-controls` ids (`:243-247`) must survive
- Implementation details: the one behavioural edit is `WorktreeSectionComponent.isActiveWorktree` `:277-283` — replace `this.editorService.activeWorkspacePath` with `this.layoutService.activeWorkspace()?.path ?? null`. `ElectronLayoutService` is **already injected** at `:257`, so delete the `EditorService` injection `:256` and its import `:19`. `WorktreeService` at `worktree.service.ts:8-12` is the in-folder precedent
- Validation notes: add one spec asserting the active-worktree highlight now tracks `ElectronLayoutService.activeWorkspace()`
- Acceptance evidence: the four components exist under `git-ui`; no `EditorService` reference remains in any of them

---

## Batch 2.5: skill-synthesis-ui repoint — COMPLETE (c6b263c72)

- Recommended executor: frontend-developer
- Fallback executor: CLI lane
- Execution mode: sequential
- Rationale: one consuming lib, four config/source files, fully disjoint.
- Tasks: 1 | Depends on: 2.1 | Parallel with: 2.2, 2.3, 2.4, 2.6

### Task 2.5: retarget the Skills lazy diff at git-ui — PENDING

- Files: `D:\projects\ptah-extension\libs\frontend\skill-synthesis-ui\src\lib\components\clones\lazy-diff-view.component.ts` (`:166`), `...\jest.config.ts` (`:23`, `'^@ptah-extension/editor$'` → `'^@ptah-extension/git-ui$'`), RENAME `...\src\__mocks__\ptah-editor.ts` → `ptah-git-ui.ts`, `...\eslint.config.mjs` (`:43-71`), `...\CLAUDE.md`
- Plan reference: implementation-plan.md:418-424
- Quality requirements: the lazy boundary must survive — keep the runtime `import()`. The skills eslint ban is **retargeted, not deleted**: its stated reason is Monaco, which survives this task. Keep both the `paths` entry and the `patterns` group, renamed to `@ptah-extension/git-ui`
- Validation notes: the mock's three declared inputs already match `DiffViewComponent`'s, so the rename is mechanical
- Acceptance evidence: `npx nx run-many -t lint test -p @ptah-extension/skill-synthesis-ui` green; the enhance-preview and clone drawers still render a diff

---

## Batch 2.6: settings:get / settings:set rename — COMPLETE (c6b263c72)

- Recommended executor: backend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: Component 13's Phase-2 contract set. Plan line 901 requires it in the same commit as the `diff-view.component.ts` repoint — the commit window delivers that.
- Tasks: 1 | Depends on: 2.1 | Parallel with: 2.2, 2.3, 2.4, 2.5

### Task 2.6: move the setting pair onto SettingsRpcHandlers and fix the dead diff-layout key — PENDING

- Files: `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\settings-rpc.handlers.ts`, CREATE `...\settings-rpc.schema.ts`, `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`, `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\host-profile\manifest.ts` (`:226-228`), `D:\projects\ptah-extension\libs\backend\platform-core\src\file-settings-keys.ts`, the three expected-absent lists and their two `rpc-surface.spec.ts` files
- Plan reference: implementation-plan.md:586-623 (Component 11)
- Pattern to follow: lift the two bodies verbatim from `apps\ptah-electron\...\editor-rpc.handlers.ts:414-440` (get) and `:443-478` (set), including the `isFileBasedSettingKey` guard at `:450`
- Quality requirements: `SettingsRpcHandlers` already injects `PLATFORM_TOKENS.WORKSPACE_PROVIDER` (`:67-68`) and already calls `setConfiguration('ptah', key, value)` (`:262`). Its manifest entry is capability-free, so every host gets the pair — this **removes** two entries from each expected-absent list rather than adding any. Zod schema is mandatory (the class has no param schema today because both existing methods are parameterless)
- Validation notes: **fixes the live bug in correction #11.** Add `'diff.renderSideBySide'` to `FILE_BASED_SETTINGS_KEYS` (beside `:208`) and `'diff.renderSideBySide': true` to `FILE_BASED_SETTINGS_DEFAULTS` (beside `:480`). Without it the diff layout preference keeps silently failing to persist, exactly as it has since it was written. The frontend half of this fix is Task 2.7
- Acceptance evidence: `rpc-allowlist.spec.ts` proves the partition still holds; both host `rpc-surface.spec.ts` files prove the pair is now **present** on VS Code and CLI; a `SettingsRpcHandlers` spec proves the write guard rejects a non-file-based key

---

## Batch 2.7: Phase 2 repoint closer — COMPLETE (c6b263c72)

- Recommended executor: frontend-developer
- Fallback executor: none — do not split
- Execution mode: sequential
- Rationale: **fixes Defect 3.** Every file that two or more Phase-2 batches would otherwise contend for, plus the composition root.
- Tasks: 1 | Depends on: 2.2, 2.3, 2.4, 2.5, 2.6

### Task 2.7: fill the barrel and repoint every consumer — PENDING

- Files:
  - `D:\projects\ptah-extension\libs\frontend\git-ui\src\index.ts` — the public API
  - `D:\projects\ptah-extension\libs\frontend\editor\src\index.ts` and `services.ts` — drop the moved exports
  - Every surviving editor-lib importer of a moved symbol: `...\editor\src\lib\services\editor\editor-diff-split.ts`, `...\lib\editor-panel\editor-panel.component.ts`, `...\lib\services\editor.service.ts`, `...\lib\code-editor\code-editor.component.ts`, the `lib\file-tree\` family
  - `D:\projects\ptah-extension\apps\ptah-extension-webview\src\app\app.config.ts`
  - `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\workspace-coordinator.service.ts` + `.spec.ts`
  - `D:\projects\ptah-extension\apps\ptah-extension-webview\src\app\editor-message-routing.spec.ts`
  - `D:\projects\ptah-extension\apps\ptah-extension-webview\eslint.config.mjs`
  - `D:\projects\ptah-extension\libs\frontend\git-ui\src\lib\diff-view\diff-view.component.ts` (`:142`, `:1432`, `:1449`)
- Plan reference: implementation-plan.md:199-212 (public API), :909 (serialized set), :611-612
- Quality requirements:
  - The barrel exports exactly the Component-1 list. `MonacoLoaderService`, `GIT_READ_ERROR_MESSAGES` and its helpers stay **internal**
  - `app.config.ts` needs **five** `MESSAGE_HANDLERS` multi-providers: the existing `GitStatusService` plus new `useExisting` entries for `GitBranchesService`, `WorktreeService` and `DiffTabsService`, beside the existing two at `:183-185`. **Without them the Task 2.2 conversions are silently deaf**
  - `provideMonacoEditor` stays in `app.config.ts:7,250-252` untouched — it is an `ngx-monaco-editor-v2` export, not an editor-lib symbol (correction #1). Contradicts context.md:52; the correction wins
  - The webview eslint `no-restricted-imports` ban (`eslint.config.mjs:50-69`) is **deleted, not retargeted** — its stated reason is `TerminalComponent`/xterm, which died in Phase 1. Leaving it makes lint pass on a dead rule
  - Rename `DIFF_LAYOUT_SETTING_KEY` from `'editor.diff.renderSideBySide'` to `'diff.renderSideBySide'` and the two RPC method names to `'settings:get'` / `'settings:set'`, matching Task 2.6
- Validation notes: `git-ui` must depend on `core` + `shared` only — never `chat`, `ui` or `editor`. No compatibility alias for `@ptah-extension/editor` is created anywhere
- Acceptance evidence: `npx nx run-many -t lint typecheck test -p @ptah-extension/git-ui @ptah-extension/editor @ptah-extension/skill-synthesis-ui @ptah-extension/chat @ptah-extension/core @ptah-extension/rpc-handlers @ptah-extension/platform-core @ptah-extension/shared ptah-extension-webview` — header reads 9; `npx nx graph` shows **no** `git-ui → editor` edge

### Batch 2 verification (phase close)

- `npm run typecheck:all`, `npm run lint:all`, `npm run build:all` green
- The 9-project `run-many` above; `npx nx graph` clean
- **Phase 2 commit** (window 2.2→2.7): `refactor(webview): carve the git surface into the git-ui library`

---

## Batch 3.1: Git dock — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: new components plus the shell mount; independently revertible per plan line 820.
- Tasks: 1 | Depends on: Phase 2 complete | Parallel with: 3.2

### Task 3.1: build GitDockComponent and mount it in the shell slot — PENDING

- Files: CREATE `D:\projects\ptah-extension\libs\frontend\git-ui\src\lib\git-dock\git-dock.component.ts` + `.spec.ts`, `...\git-dock-header.component.ts`. MODIFY `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\electron-shell.component.ts`, `...\git-ui\src\index.ts`
- Plan reference: implementation-plan.md:461-528 (Component 9)
- Pattern to follow: the header is a **port** of `git-status-bar.component.ts:40-141`, not a new design
- Quality requirements:
  - Selectors from design-handoff.md:16-17: `ptah-git-dock` (`data-testid="git-dock"`) and `ptah-git-dock-header` (`data-testid="git-dock-header"`). Ship with **no** inputs or outputs — a strict subset of what TASK_2026_386 adds
  - **Arming**: the constructor calls `gitStatus.startListening()` and `gitBranches.startListening()` + `void gitBranches.refreshBranches()`, and registers `destroyRef.onDestroy` to call both `stopListening()`s. This replaces `editor-panel.component.ts:845` and `git-status-bar.component.ts:162-165`. `startListening` performs an eager fetch, which is what makes re-arming after a dock close idempotent
  - **Keep `data-testid="git-push-button"`** and `role="status"` + `aria-label="Git status"` — the retargeted e2e locators in Task 3.3 depend on both
  - The branch-picker dropdown and details popover (`git-status-bar.component.ts:94-104`) are **not** ported; their 7 RPCs stay in the contract for TASK_2026_386
  - `ChangeDetectionStrategy.OnPush`, `inject()` only, new control flow
- Implementation details: mount at `electron-shell.component.ts:298-311` — the dynamic import becomes `import('@ptah-extension/git-ui').then(m => …GitDockComponent)`, the signal is renamed `dockComponent`, and the `ptah-sidebar-tab label="Editor"` at `:277-282` becomes `label="Git"` with `Toggle Git panel` for `aria-label`/`title`. **`layout.editorPanelVisible()` / `editorPanelWidth()` stay** — they are the shell's right-dock slot, not editor-lib state (correction #15); deleting them deletes the dock
- Validation notes: this is the batch that makes Phase 4 safe. Until it lands, `git-status.service.ts:269` has no armer
- Acceptance evidence: a jest spec asserting the constructor arms both services and `ngOnDestroy` disarms both; `npx nx run-many -t test -p @ptah-extension/git-ui @ptah-extension/chat` green
- Commit: `feat(webview): add a git dock that hosts the git surface in the shell`

---

## Batch 3.2: External-editor file:open — PENDING

- Recommended executor: backend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: a new Electron handler, a host-profile rebinding and one frontend collapse; disjoint from 3.1.
- Tasks: 1 | Depends on: Phase 2 complete | Parallel with: 3.1

### Task 3.2: launch the external editor from file:open — PENDING

- Files: CREATE `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\file-open-rpc.handlers.ts` + `.spec.ts` + `file-open-rpc.schema.ts`. MODIFY `...\src\rpc-host-profile.ts` (`:44`), `...\src\di\phase-4-handlers.ts` (beside `:168`), `...\src\services\rpc\handlers\index.ts`, `D:\projects\ptah-extension\libs\frontend\chat-ui\src\lib\atoms\file-path-link.component.ts`
- Plan reference: implementation-plan.md:530-584 (Component 10)
- Quality requirements:
  - Exactly one method, `file:open`. **Deliberately minimal** — no editor detection, no target list, no remembered choice, no deep links. `IEditorLauncher` and `EditorTarget[]` are TASK_2026_386
  - Params unchanged: `{ path, line? }`. `manifest.ts:378` is **untouched** — the capability and entry already exist, only the binding moves. VS Code keeps `FileRpcHandlers`
  - **Security, not optional**: validate containment with `isPathWithinRoots` (`libs\backend\platform-core\src\utils\path-containment.ts:71`) against `workspaceProvider.getWorkspaceFolders()` **before** any spawn. Zod schema on the params. No shell string — `spawnProcess` takes `command` and `args` separately and the path is never interpolated
  - Spawn via `SDK_TOKENS.SDK_PROCESS_SPAWNER` (`agent-sdk\src\lib\di\tokens.ts:51`; the `IProcessSpawner` port is type-only and carries no token of its own, correction #21). Request shape copied from `cli-adapter.utils.ts:258-269`, including the `detached: process.platform !== 'win32'` guard. Do not await the child
  - **Call `this.editorProvider.notifyFileOpened(filePath)` on the success path** — `electron-editor-provider.ts:49-53`, the same call `editor-rpc.handlers.ts:282` makes today. Without it the `ptah_ide` MCP editor tools (`electron-ide-capabilities.ts:151-170`) and context auto-include (`context.service.ts:634-644`) go dark
  - **Never throws.** Out-of-workspace → `{ success:false, error:'Path is outside the workspace' }`, no spawn. Spawn throws or the child errors → logged at `warn`, `{ success:false, error }`
- Validation notes: carries Assumption 2 — `code` may not be on `PATH`. The e2e asserts the RPC resolves and `notifyFileOpened` fired, **never** that an editor appeared. Assumption 1 was already discharged by Task 1.2
- Implementation details: frontend collapse — delete the `isElectron` branch (`file-path-link.component.ts:78-82`) and the whole `openFileInElectron` method (`:85-100`), leaving `void this.rpcService.openFile(filePath)`. This removes the last `@ptah-extension/editor` import from `chat-ui`. `tasks-store.service.ts:1362` (`openArtifact`) is fixed for free (correction #17)
- Acceptance evidence: unit spec with a fake spawner asserting the argv is `['-g', 'C:\\ws\\a.ts:12']`, that `notifyFileOpened` fired with the same path, that an out-of-workspace path spawns nothing, and that a throwing spawner yields `{success:false}` rather than a rejection
- Commit: `feat(electron): launch the external editor from the file open rpc`

---

## Batch 3.3: Git e2e, docs and showcase retarget — PENDING

- Recommended executor: devops-engineer
- Fallback executor: CLI lane
- Execution mode: sequential
- Rationale: e2e harness, capture manifest and docs pages — delivery surface, and the `git-dock.spec.ts` needs the dock to exist.
- Tasks: 1 | Depends on: 3.1

### Task 3.3: re-home the git specs, retarget the shots and rewrite the git docs — PENDING

- Files:
  - MOVE into new `D:\projects\ptah-extension\apps\ptah-electron-e2e\src\specs\git\`: `diff-view-state.spec.ts`, `glyph-margin-visual.spec.ts`, `hunk-apply-real-rpc.spec.ts`, `hunk-revert-top-layer.spec.ts`, `hunk-widget-mouse.spec.ts`, `perf-m1-diff-redisplay.spec.ts` (from `specs\editor\`)
  - CREATE `...\specs\git\git-dock.spec.ts`
  - MODIFY `...\src\docs-screenshots\editor-git.shot.ts`, `...\src\support\ui-driver.ts`
  - MODIFY `D:\projects\ptah-extension\apps\ptah-docs\SCREENSHOTS.md`, `...\src\content\docs\git\git-status.md`, `...\astro.config.mjs`; DELETE `...\src\content\docs\workspace\file-tree.md`
- Plan reference: implementation-plan.md:724-776 (Component 14), context.md:82
- Quality requirements:
  - `support\git-diff-mock.ts` **does not move** — it is already outside the purge target at `apps\ptah-electron-e2e\src\support\` (correction #6)
  - `git-dock.spec.ts` carries the two ported git tests from `editor.spec.ts:145-194` **plus** the CX:120 assertion: inject a synthetic `git:status-update` via `ui.pushEvent` and assert the dock's file count and branch update
  - `editor-git.shot.ts`: delete the file-tree block `:63-88` and the `file-tree-panel` shot `:86-88`; `:91` `ptah-git-status-bar` → `ptah-git-dock-header`; drop the `getByRole('tab', {name:/^Git\b/})` click `:98-101` (the dock has no tab rail in this task); `:102` and `:122` unchanged; the crop at `:129` becomes `ptah-git-dock`; rename the shot `git-status-bar` → `git-dock-header`
  - `ui-driver.ts`: delete the `'editor'` view branch `:312-327` and its locator `:381-383` (the `pushEvent file:tree-changed` nudge at `:325` goes with it); add a `'git'` branch that toggles the Git panel and waits for `ptah-git-dock`
  - `git-status.md`: the "Location" column `:14-19` says "Status bar, bottom-left" for every indicator; the surface is now the Git dock header. Rewrite `:12-19` and the `:10` image reference. `:21-34` and `:36-40` stay true
- Validation notes: this task **pins acceptance criterion CX:120**, the one that proves the dock is not silently deaf
- Acceptance evidence: `nx run ptah-electron-e2e:e2e` green including `specs/git/git-dock.spec.ts`; `nx build ptah-docs` green (the docs gate — there is no `check` target)
- Commit: `test(e2e): re-home the git specs and retarget the docs shots`

---

## Batch 3.4: git-ui lazy-chunk budget — PENDING

- Recommended executor: devops-engineer
- Fallback executor: none
- Execution mode: sequential
- Rationale: **fixes Defect 2.** A measured budget needs a real chunk, which only exists after 3.1's dock mount.
- Tasks: 1 | Depends on: 3.1

### Task 3.4: add a measured bundle budget for the git-ui chunk — PENDING

- File: `D:\projects\ptah-extension\apps\ptah-extension-webview\project.json`
- Plan reference: implementation-plan.md:245-247, context.md:124-125
- Pattern to follow: the existing budgets block at `:62-73`, which today holds only `initial` and `anyComponentStyle` — **no lazy-chunk budget of any kind exists yet** (correction #18)
- Quality requirements: run `nx build ptah-extension-webview` first, read the emitted git-ui chunk size, then write a `"type": "bundle"` entry with `maximumError` derived from that measurement. Do not guess a number
- Validation notes: record the measured figure in the batch report so the reviewer can check the budget against it
- Acceptance evidence: `nx build ptah-extension-webview` green with the budget in place; the recorded chunk size is under `maximumError`
- Commit: `build(webview): add a lazy chunk budget for the git-ui bundle`

---

## Batch 4.1: Delete the editor library — PENDING

- Recommended executor: frontend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: the whole project plus its workspace registrations.
- Tasks: 1 | Depends on: Phase 3 complete (all four batches) | Parallel with: 4.2, 4.5

### Task 4.1: remove libs/frontend/editor and every workspace reference — PENDING

- Files: DELETE `D:\projects\ptah-extension\libs\frontend\editor\**` (entire project), `D:\projects\ptah-extension\libs\frontend\tasks-ui\src\lib\no-editor-dependency.spec.ts`. MODIFY `D:\projects\ptah-extension\tsconfig.base.json` (drop the alias), `D:\projects\ptah-extension\.commitlintrc.json` (drop the `editor` scope), `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\electron-layout.service.ts`, `D:\projects\ptah-extension\CLAUDE.md` (module index)
- Plan reference: context.md:84-93, implementation-plan.md:854-855, :911
- Quality requirements:
  - `no-editor-dependency.spec.ts` is **deleted, not retargeted** — it matches the specifier anywhere in a file including comments (`:63,:107`), and `tasks-ui` is _allowed_ to depend on `git-ui`. Its purpose ends with the lib
  - `electron-layout.service.ts`: **only doc comments change.** `_editorPanelWidth`/`_editorPanelVisible` (`:58-59`) are the shell's right-dock slot and the git dock fills it (correction #15). `LAYOUT_STATE_KEY` keys (`:558-566`) are unchanged, so persisted blobs carrying `editorWidth`/`editorVisible` still restore — `restoreLayout` (`:576-597`) declares `editorVisible?` at `:581` and never reads it (correction #14)
- Validation notes: discharges Assumption 3 — run `npx nx graph` and confirm zero dependents on the deleted project before deleting
- Acceptance evidence: `libs/frontend/editor` does not exist; `npx nx graph` resolves with no dangling reference; no `@ptah-extension/editor` string remains outside `.ptah/specs`

---

## Batch 4.2: Delete EditorRpcHandlers on both hosts — PENDING

- Recommended executor: backend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: two handler classes plus their DI registrations; disjoint from 4.1.
- Tasks: 1 | Depends on: Phase 3 complete | Parallel with: 4.1, 4.5

### Task 4.2: remove the editor handler classes and their registrations — PENDING

- Files: DELETE `D:\projects\ptah-extension\apps\ptah-electron\src\services\rpc\handlers\editor-rpc.handlers.ts` + `.spec.ts`, `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\editor-rpc.handlers.ts` + `.spec.ts`. MODIFY both `handlers\index.ts` files, `apps\ptah-electron\src\di\phase-4-handlers.ts`, `D:\projects\ptah-extension\eslint.config.mjs` (`APP_LOCAL_RPC_HANDLERS_PENDING_MIGRATION` — remove the two `editor-rpc.handlers.ts` entries)
- Plan reference: context.md:88, implementation-plan.md:916
- Quality requirements: `ElectronFileOpenRpcHandlers` from Task 3.2 already owns `host.fileOpen`, so `file:open` does not regress. The VS Code host keeps `FileRpcHandlers` (`rpc-host-profile.ts:32`) — that is a different file, correction #23
- Validation notes: **the `EXCLUDED_DIRS_GLOB` suite at `editor-rpc.handlers.spec.ts:1-49` is NOT editor-pane tests** (correction #22). It pins the derivation `workspace-scan.constants.ts:62-65` points at by name. Do not delete those assertions — Task 4.3 re-homes them, and 4.3 must land in the same commit window
- Acceptance evidence: `npx nx run-many -t test -p ptah-electron ptah-extension-vscode` green

---

## Batch 4.3: Watcher reduction and exclusion-set collapse — PENDING

- Recommended executor: backend-developer
- Fallback executor: none
- Execution mode: sequential
- Rationale: the watcher change the task carries after Phase 4; coupled to 4.2 because it inherits that spec's assertions.
- Tasks: 1 | Depends on: 4.2

### Task 4.3: drop the tree job and collapse the two exclusion sets — PENDING

- Files: `D:\projects\ptah-extension\apps\ptah-electron\src\services\git-watcher.service.ts` + `.spec.ts`, `D:\projects\ptah-extension\libs\shared\src\lib\constants\workspace-scan.constants.ts` + `.spec.ts`
- Plan reference: implementation-plan.md:625-683 (Component 12), context.md:97-103
- Quality requirements:
  - DELETE `scheduleTreeRefresh()` `:546-578`, its call site `:491-493`, `treeDebounceTimer` `:78`, `treeBurstStartedAt`, and the constants `TREE_DEBOUNCE_MS` `:140` / `TREE_MAX_WAIT_MS` `:172`. **KEEP** `scheduleUpdate` `:681`, `scheduleContentChange` `:585`, `scheduleGitOpsRefresh` `:638` and the recursive watcher `:478-499` — the `'workspace'` cause is how agent working-tree edits surface at all
  - `EDITOR_REREAD_OPEN_TABS` is broadcast at `:654` inside `scheduleGitOpsRefresh`, **not** in the tree job. Remove that one line and the alias; the surrounding `fetchAndPush()` at `:653` stays
  - Collapse `TREE_HIDDEN_DIRS` `:80-97` and `WATCH_IGNORED_DIRS` `:128-131` into one exported `WATCH_IGNORED_DIRS` holding the union, delete `TREE_HIDDEN_DIRS`, and rewrite the 70-line header so it documents one question instead of two
  - The `.git/*` dedicated watchers stay **outside** the exclusion predicate (`:469-474`) — routing them through it would stop every commit, stage and checkout being detected
- Validation notes: `.nx`, `.angular` and `dist` are **already** excluded (correction #12), so CX:102's stated goal is already met and the `.nx\cache` spec is a **pin of existing behaviour** — name the test that way. `coverage` and `tmp` are the only genuinely new names, and `workspace-scan.constants.ts:21-27` argues against `coverage` **by name**. Decision: add both and **replace that paragraph** with the reasoning (with the explorer gone, the only cost of an over-broad name is a missed `git status` refresh), rather than contradict it silently
- Implementation details: re-home the surviving `EXCLUDED_DIRS_GLOB` assertions from `editor-rpc.handlers.spec.ts:1-49` into `workspace-scan.constants.spec.ts` and update the `:62-65` reference. Delete the five tree-refresh tests in `git-watcher.service.spec.ts` (`:95`, `:121`, `:370`, `:444`, `:464`)
- Acceptance evidence: a spec asserting a write under `.nx\cache` schedules **nothing**; `coverage/lcov.info` and `tmp/x` excluded; and the negative controls `out`, `build`, `.next`, `.turbo` **not** excluded
- Commit note: part of the Phase 4 window

---

## Batch 4.4: Phase 4 contract set — PENDING

- Recommended executor: backend-developer
- Fallback executor: none — do not split
- Execution mode: sequential
- Rationale: the last Component 13 pass. Closes the Phase 4 commit window.
- Tasks: 1 | Depends on: 4.1, 4.2, 4.3

### Task 4.4: remove the editor RPC surface, capabilities and push types — PENDING

- Files: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts` (interface `:626` + `RPC_METHOD_ENTRIES` `:3391`), `...\lib\types\messages\message-constants.ts` and `payload-map.ts` (`FILE_TREE_CHANGED`, `EDITOR_REREAD_OPEN_TABS`, `EDITOR_TAB_CONTENT_REVERTED`), `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\host-profile\manifest.ts` (`:99-112`, `:379-383`, `:384-388`), `...\host-profile\capabilities.ts` (`editorRevert` `:50`, `editorHost` `:52`), `D:\projects\ptah-extension\libs\backend\vscode-core\src\messaging\rpc-handler.ts` (`'editor:'` `:67`), the three host profiles, the three expected-absent lists and their two `rpc-surface.spec.ts` files
- Plan reference: implementation-plan.md:685-722, context.md:88-90
- Quality requirements: **`FILE_CONTENT_CHANGED` is KEPT** (context.md:95) — `DiffTabsService` revalidates on it and is a `MESSAGE_HANDLERS` subscriber. Removing it silently breaks diff revalidation. All 18 `git:*` methods are kept; `git:*` has no capability and is ungated on every host, so no host-profile work is needed for it
- Validation notes: carries the HIGH partial-contract risk. `assertManifestInvariants` (`register-rpc-surface.ts:141`) turns a partial edit into a startup throw
- Acceptance evidence: `npx nx run-many -t test -p @ptah-extension/git-ui @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/core @ptah-extension/tasks-ui @ptah-extension/rpc-handlers @ptah-extension/vscode-core @ptah-extension/platform-core @ptah-extension/cli-engine @ptah-extension/shared ptah-electron ptah-extension-vscode ptah-extension-webview` — header reads 13
- **Phase 4 window commit**: `refactor(webview): delete the editor library and its rpc surface`

---

## Batch 4.5: Showcase and perf close-out — PENDING

- Recommended executor: devops-engineer
- Fallback executor: CLI lane
- Execution mode: sequential — **its own commit**
- Rationale: capture harness and scene files, decoupled from the build.
- Tasks: 1 | Depends on: Phase 3 complete | Parallel with: 4.1, 4.2

### Task 4.5: delete the editor tour, prewarm targeting and remaining editor specs — PENDING

- Files: DELETE `D:\projects\ptah-extension\apps\ptah-electron-e2e\src\specs\editor\**` (what remains after Task 3.3's moves: `editor.spec.ts`, `file-ops-dialogs-top-layer.spec.ts`, `file-tree-windowing.spec.ts`, `perf-m2-electron-spotcheck.spec.ts`, `perf-m4-drag-cd.spec.ts`, `perf-m3-watcher-churn.{md,script.mjs}`), `...\src\showcase\editor-tour.scene.ts`, `...\src\showcase\scripts\editor-tour.json`. MODIFY `...\src\showcase\_harness\prewarm.ts`, `D:\projects\ptah-extension\apps\ptah-video-studio\FOLLOW-UP.md`, `D:\projects\ptah-extension\apps\ptah-docs\SCREENSHOTS.md`
- Plan reference: implementation-plan.md:745-772, context.md:91-93, :140
- Quality requirements: `prewarm.ts` — delete `prewarmEditor` `:161-184` and the leaf-file helpers `:114-116`; its doc at `:153-160` names the editor as "the known worst offender (~31 s)", which is the win to record in the batch report. `perf-m3-watcher-churn.{md,script.mjs}` is stale per correction #12 and is replaced by Task 4.3's constants spec
- Validation notes: `FOLLOW-UP.md:35` names `editor-tour` as the hand-written exemplar for the other scenes. Promote `chat-code-edit.scene.ts` in that sentence and say why in the same edit — it is the closest structural analogue, a single-surface walkthrough with a body and a payoff. Note that 14 scenes exist on disk while `FOLLOW-UP.md` says 13
- Acceptance evidence: `nx run ptah-electron-e2e:e2e` green; `nx build ptah-docs` green; `apps\ptah-electron-e2e\src\specs\perf\startup-tti.spec.ts` **re-run and its three console figures recorded** before/after (it asserts no budget — "re-baseline" means record, not edit a threshold, correction #16)
- Commit: `test(e2e): drop the editor tour, specs and prewarm targeting`

### Batch 4 verification (task close)

- `npm run typecheck:all`, `npm run lint:all`, `npm run build:all` green
- The 13-project `run-many`; `nx run ptah-electron-e2e:e2e`; `nx build ptah-docs`
- `libs/frontend/editor` does not exist; `git-ui` exports every moved symbol with an unchanged signature
- Skill Synthesis enhance preview and clone drawers still render the diff
- `git:status-update` reaches the dock (pinned by `specs/git/git-dock.spec.ts`)
- Transcript file links open the external editor
- A write under `.nx/cache` schedules nothing (pinned by spec)
- Persisted layout blobs with `editorWidth`/`editorVisible` still restore
