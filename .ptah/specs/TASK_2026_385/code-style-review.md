# Code Style Review — `TASK_2026_385`

Scope: uncommitted working-tree diff only (`git status --short` / `git diff`), Phase 1 batches 1.1–1.5
(terminal renderer, PTY host, packaging, e2e/scene, RPC contract surface). Out-of-scope noise per
instructions — `.gitignore`, `.claude/skills/**`, `.ptah/specs/**`, `tools/video-editor/**`,
`package-lock.json` — was excluded from findings.

## Summary

| Metric          | Value                                                                   |
| --------------- | ----------------------------------------------------------------------- |
| Overall score   | 8/10                                                                    |
| Assessment      | APPROVED                                                                |
| Blocking issues | 0                                                                       |
| Serious issues  | 2                                                                       |
| Minor issues    | 3                                                                       |
| Files reviewed  | 72 (all files in `git diff --stat` minus the declared out-of-scope set) |

## Five style questions

### 1. What breaks in six months?

Nothing structural. Every port removal (`PLATFORM_TOKENS.PTY_HOST`, `IPtyHost`,
`RPC_CAPABILITIES.pty`, `terminal:*` in `rpc.types.ts:626,3391` and `RPC_METHOD_ENTRIES`) was
removed from both the type-level contract and the three host profiles
(`apps/ptah-electron/src/rpc-host-profile.ts:36-39`, `apps/ptah-extension-vscode/src/rpc-host-profile.ts`,
`libs/backend/cli-engine/src/lib/rpc/cli-host-profile.ts`) and the three `expected-absent` /
`rpc-surface.spec.ts` pairs. A future contributor grepping `terminal:` or `pty` in
`libs/shared/src/lib/types/rpc.types.ts` or `platform-core` finds nothing live to re-wire
incorrectly. The two residual doc staleness items below (CLAUDE.md:100, diff-view.component.ts:489-490)
are the only things a reader could act on wrongly — they describe a mechanism (xterm terminal
resize handle) that stopped existing this diff.

### 2. What would a new team member misread?

`libs/frontend/editor/src/lib/file-tree/file-tree-context-menu.component.ts:19,122` — a new
contributor would reasonably assume the imported `Terminal` icon and `TerminalIcon` field back a
context-menu action ("Open in Terminal"). They don't: `ContextMenuAction` never included a
terminal variant and the template never renders it. It reads as unfinished wiring, not as a
leftover from this deletion (the file wasn't touched here), but this batch's own acceptance
criterion ("no reference to terminal anywhere") is exactly the kind of check that should have
caught it.

### 3. What does this cost to maintain?

Low. The removal is symmetric everywhere it needed to be: DI token, port interface, capability
flag, manifest entry, three host profiles, three expected-absent lists, RPC type + entries,
IPC preload bridge, binary IPC channels, packaging externals/prune-blocks (root `package.json`
node-pty kept per contract), and every spec file that asserted the old shape was repointed to
assert the new one (e.g. `editor-panel.component.spec.ts`'s terminal-resize-drag test was
replaced by an equivalent split-divider-drag test, not just deleted — the coalescing behaviour
it existed to prove is still covered).

### 4. Where is this inconsistent with the rest of the repository?

- `CLAUDE.md:100` (Tech Stack line) still lists `xterm.js` in the same file whose other three
  terminal/xterm mentions (lines 27, 63, 223) this diff correctly scrubbed — an inconsistency
  within the _same file_, not just within the repo.
- `libs/frontend/editor/src/lib/diff-view/diff-view.component.ts:489-490` cross-references
  "the terminal resize handle" inside `editor-panel.component.ts`'s isolation wrapper. That
  target comment was rewritten by this very diff (`editor-panel.component.ts` docblock, "the
  terminal separator and terminal panel" → "in-flow siblings of this region") to drop exactly
  this wording, so the two comments that used to agree now disagree.

### 5. What would you have done differently, and why is that better rather than merely other?

Nothing structural — the shape of the deletion (interface-then-token-then-capability-then-
manifest-then-profile-then-contract, mirrored per host) is the correct order and matches how the
feature was presumably added. The only change I'd make is running a final `grep -ril
"terminal\|pty\|xterm" libs/ apps/ --include=*.ts --include=*.md` across the _whole_ tree (not
just files this batch already planned to touch) before closing Phase 1, which is exactly the
kind of pass that would have caught the two doc staleness items and the dead icon import — cheap,
and it is what "Acceptance evidence: no `@xterm` import anywhere under `libs/frontend`" was
gesturing at without fully covering doc prose or unused-but-still-compiling imports.

## Blocking issues

None. Every batch's stated acceptance evidence is met by the diff:

- Batch 1.1: no `@xterm` import remains under `libs/frontend` (confirmed by grep); `editor.service.ts`
  keeps everything non-terminal (`terminalVisible`/`terminalHeight`/`toggleTerminal`/
  `setTerminalHeight` removed, nothing else touched).
- Batch 1.2: `isAuthorizedWorkspace` (`libs/backend/rpc-handlers/src/lib/utils/workspace-authorization.ts:9`)
  and `isPathWithinRoots` (`libs/backend/platform-core/src/utils/path-containment.ts:71`) both kept;
  `authorizedTerminalRoots`, `isAuthorizedTerminalCwd`, `isWithinHomeDir` all removed in the same pass.
  `container.smoke.spec.ts` replaced the `PTY_HOST` aliasing test with an `SDK_PROCESS_SPAWNER`
  resolution assertion exactly as Assumption 1 specified.
- Batch 1.3: root `package.json:171` keeps `node-pty`; `apps/ptah-electron/package.json`,
  `project.json` externals, and `electron-builder.yml` prune blocks (mac/win/linux) all drop it;
  `packaged-deps.spec.ts` updated in the same file, same pass.
- Batch 1.4: `pty-manager.spec.ts` deleted from the specs root (not `specs/editor/`, matching
  correction #5); `editor.spec.ts:145-194`'s two git tests are untouched; `editor-tour.scene.ts`'s
  `director.say()` indices (0-8) match the 9-entry `editor-tour.json` lines array exactly — no
  off-by-one left by the beat removal.
- Batch 1.5: `rpc.types.ts` interface entry (former `:626`) and `RPC_METHOD_ENTRIES` (former
  `:3391`) both removed; `manifest.ts`'s `terminal` entry, `capabilities.ts`'s `pty`,
  `rpc-handler.ts`'s `'terminal:'` prefix, all three host profiles' `pty`/`pty: true`, and
  `phase-4-handlers.ts`'s `TerminalRpcHandlers` + `PtyManagerService` registrations are gone
  together. `PLATFORM_TOKENS` claims "25 ports" consistently in `CLAUDE.md:27,223` and
  `platform-core/CLAUDE.md:51`, matching the actual 25 `Symbol.for(...)` entries in `tokens.ts`
  after `PTY_HOST`'s removal.

## Serious issues

### Stale "xterm.js" claim in the root Tech Stack line

- File: `CLAUDE.md:100`
- Problem: `- **UI**: Tailwind 3, daisyui 4, lucide-angular, gsap / @hive-academy/angular-gsap, Monaco, xterm.js, gridstack` still names `xterm.js` as a UI dependency. This diff removed `xterm.js` from every package manifest that shipped it (root `package.json`, `apps/ptah-electron/package.json`) and rewrote three OTHER claims in this same file (`CLAUDE.md:27,63,223`) to stop mentioning terminal/xterm, but left this one.
- Impact: a reader of the root doc — the first file this repo tells agents to load — is told the UI stack includes a library that, after this Phase 1 commit, is not a dependency anywhere in the shipped app.
- Fix: drop `, xterm.js` from the Tech Stack bullet.

### Stale cross-reference to "the terminal resize handle" in diff-view.component.ts

- File: `libs/frontend/editor/src/lib/diff-view/diff-view.component.ts:489-490`
- Problem: the TASK_2026_227 z-index docblock explains the isolation wrapper in `editor-panel.component.ts` was "added so Monaco could not swallow the terminal resize handle". This diff rewrote that exact wrapper's own comment in `editor-panel.component.ts` (the block right above the removed resize-handle/terminal-panel `@if`s) to say "the in-flow siblings of this region" instead of naming the terminal separator — because the terminal resize handle this comment describes no longer exists. `diff-view.component.ts` was not in this batch's file list and was not updated to match.
- Tradeoff: leaving it costs nothing today, but the next person will "fix" a supposedly-broken terminal handle that isn't there, or distrust the surrounding TASK_2026_227 history because one of its two cross-referencing comments is provably wrong.
- Recommendation: reword to "so Monaco could not swallow a resize handle underneath" (matching the generic language now used in `editor-panel.component.ts`), or reference the split-pane handle by name since that's the surviving in-flow sibling.

## Minor issues

- `libs/frontend/editor/src/lib/file-tree/file-tree-context-menu.component.ts:19,122` — `Terminal` icon imported from `lucide-angular` and assigned to `TerminalIcon`, never used in the template (`ContextMenuAction` has no terminal variant). Dead code that happens to share this deletion's vocabulary; not touched by this batch, but visible under the same "no reference to terminal anywhere" bar the batch set for itself.
- `apps/ptah-electron/src/di/phase-4-handlers.ts:61-62` — two blank lines left where the `PtyManagerService` / `ELECTRON_TOKENS` imports were deleted (single blank line elsewhere in the file). Cosmetic; likely caught by `nx format:write` on commit per the repo's lint-staged config, but present in the current working tree.
- `libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts:392-394` — a stray blank line inside the template literal where the resize-handle/terminal-panel `@if` blocks were removed. Cosmetic, no functional effect.

## File-by-file

### `libs/backend/platform-core/src/{di/tokens.ts,index.ts,utils/path-containment.ts,utils/shell-allowlist.ts(deleted)}`

Score 9/10 — 0B, 0S, 0M. `PTY_HOST` token, `IPtyHost`/`PtySpawnRequest`/`PtySpawnResult`/
`PtyKillResult` exports, and the whole `shell-allowlist.ts` (+ spec) are removed cleanly.
`path-containment.ts`'s docblock was rewritten to drop the terminal-specific framing while
keeping the `isAuthorizedWorkspace` cross-reference — exactly the kept/removed split Batch 1.2
specified.

### `libs/backend/rpc-handlers/src/lib/{utils/workspace-authorization.ts,host-profile/*,handlers/index.ts}`

Score 9/10 — 0B, 0S, 0M. `authorizedTerminalRoots`/`isAuthorizedTerminalCwd`/`isWithinHomeDir`
removed, `isAuthorizedWorkspace` kept verbatim (`:9-16`). `manifest.ts`'s `terminal` entry,
`capabilities.ts`'s `pty`, and `host-profile.ts`'s `pty: false` default all removed together —
no orphaned capability flag anywhere in this trio.

### `libs/shared/src/lib/types/rpc.types.ts` (+ `rpc/rpc-terminal.types.ts` deleted)

Score 10/10 — 0B, 0S, 0M. Both the barrel re-export (`export * from './rpc/rpc-terminal.types'`),
the `import type` block, the `RpcMethodRegistry` interface entries (`terminal:create`,
`terminal:kill`), and their `RPC_METHOD_ENTRIES` counterparts are removed in the same commit-ready
diff — the two places batches.md called out explicitly (former `:626` and `:3391`) are both clean.

### `apps/ptah-electron/src/{di,ipc,preload.ts,activation/bootstrap.ts}` and `services/pty-manager.service.ts` (deleted)

Score 9/10 — 0B, 0S, 0M. `PtyManagerService`, `ELECTRON_TOKENS.PTY_MANAGER_SERVICE`, the
`ptahTerminal` preload bridge, and all four binary IPC channels (`terminal:data-in/resize/data-out/exit`)
are gone with no dangling references. `container.smoke.spec.ts`'s Risk R2 aliasing test was
replaced (not just deleted) with an `SDK_PROCESS_SPAWNER` resolution test per plan Assumption 1 —
the "de-risks Task 3.2 one phase early" validation note is honored.

### `apps/ptah-electron/{package.json,project.json,electron-builder.yml,scripts/rebuild-native.js,src/config/packaged-deps.spec.ts}`

Score 9/10 — 0B, 0S, 0M. `node-pty` removed from the packaged app's deps/externals/prune-blocks
consistently across all three platforms (mac/win/linux); the root `package.json` keeps it exactly
as instructed for the CLI e2e `pty-runner.ts`.

### `apps/ptah-electron-e2e/src/{specs/pty-manager.spec.ts(deleted),specs/editor/editor.spec.ts,showcase/editor-tour.scene.ts,showcase/scripts/editor-tour.json,support/rpc-bridge.ts}`

Score 9/10 — 0B, 0S, 0M. Deletion is at the specs root, matching correction #5. `editor.spec.ts`'s
git tests (`:145-194`) untouched. Scene/script beat removal is numerically consistent (9 `say()`
calls against 9 lines).

### `libs/frontend/editor/src/{index.ts,services.ts,lib/services/editor.service.ts,lib/editor-panel/editor-panel.component.ts,lib/terminal/**(deleted),lib/types/terminal.types.ts(deleted),lib/services/terminal.service.ts(deleted)}`

Score 8/10 — 0B, 0S, 0M (project-local). Every export, signal, and template block for the
terminal is removed symmetrically; `editor.service.ts` correctly keeps everything non-terminal
per the quality requirement. One cosmetic stray blank line noted above; the file's own docblocks
were rewritten in step with the deletion.

### `CLAUDE.md`, `libs/backend/platform-core/CLAUDE.md`, `libs/frontend/editor/CLAUDE.md`, `libs/shared/CLAUDE.md`, `apps/ptah-electron/CLAUDE.md`

Score 6/10 — 0B, 2S, 0M. Four of five doc updates are complete and accurate (token counts,
editor lib purpose/guidelines renumbering, RPC namespace list, native-externals list). The root
`CLAUDE.md`'s Tech Stack line is the one miss (Serious issue above).

## Pattern compliance

| Repository rule or nearby convention                                                                                                             | Status                       | Evidence                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RPC dual-registration: namespace removal needs both `rpc.types.ts` (compile-time) and `rpc-handler.ts` `ALLOWED_METHOD_PREFIXES` (runtime guard) | PASS                         | `libs/shared/src/lib/types/rpc.types.ts` (interface + entries removed), `libs/backend/vscode-core/src/messaging/rpc-handler.ts:68` (`'terminal:'` prefix removed)         |
| Hexagonal rule: backend depends on `platform-core` interfaces, not adapters                                                                      | PASS                         | `isAuthorizedWorkspace` continues to import `isPathWithinRoots` from `@ptah-extension/platform-core` (`workspace-authorization.ts:2`), no new adapter coupling introduced |
| Frontend/backend isolation                                                                                                                       | PASS                         | No new cross-boundary imports found; editor lib changes stay within `libs/frontend/editor` and `libs/frontend/chat`                                                       |
| File-size soft ceiling / facade rule (n/a — deletion only)                                                                                       | NOT_APPLICABLE               | No new files created past the ceiling                                                                                                                                     |
| Task-spec carrier conventions (`task.md`, `batches.md`)                                                                                          | NOT_APPLICABLE               | Out of review scope (`.ptah/specs/**` excluded)                                                                                                                           |
| Doc claims must match code (`CLAUDE.md` token counts, tech stack)                                                                                | FAIL (partial)               | `CLAUDE.md:100` retains `xterm.js`; all token-count and per-lib claims otherwise pass (`CLAUDE.md:27,223`, `platform-core/CLAUDE.md:51`)                                  |
| No dead imports / orphaned exports                                                                                                               | FAIL (partial, pre-existing) | `file-tree-context-menu.component.ts:19,122` unused `Terminal`/`TerminalIcon` (file untouched by this batch)                                                              |

## Maintenance debt

- Introduced: nothing new — this is a subtractive refactor.
- Retired: the integrated terminal panel (renderer), the PTY host port and its Electron
  implementation, `node-pty`/`@xterm/*` from the packaged app, the terminal RPC namespace end to
  end, and the e2e/scene surface that exercised it.
- Net: strongly negative (good) line-count delta (143 insertions / 3427 deletions across 72
  files), with two small doc-consistency debts and one dead-import debt left for a follow-up pass.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: two stale doc references (`CLAUDE.md:100`, `diff-view.component.ts:489-490`) and
  one unrelated dead icon import are exactly what a repo-wide `grep -i "terminal\|pty\|xterm"`
  pass would catch before the Phase 1 commit; none of them affect behaviour or compile.
- What a 10/10 version would do differently: run that repo-wide grep (not just the
  `libs/frontend` `@xterm` check called out in the batch's own acceptance evidence) before
  closing Phase 1, and either fix or explicitly file the `file-tree-context-menu.component.ts`
  dead icon as a tracked follow-up rather than leaving it silently unaddressed.

---

## Phase 2

Scope: uncommitted working-tree diff, Phase 2 batches 2.1–2.7 (carve
`libs/frontend/git-ui` out of `libs/frontend/editor`). Batch 2.1
(`chore(webview): scaffold the git-ui library project and path alias`) is
already committed at `16e13df24`; 2.2–2.7 are uncommitted working-tree state.
Reviewed against `implementation-plan.md` Components 1–11 and `batches.md`
Batches 2.1–2.7, including each batch's own stated acceptance evidence.
Out-of-scope noise excluded per instructions (`libs/frontend/canvas/**`,
`.gitignore`, `.ptah/specs/**`, `tools/video-editor/**`, `.claude/skills`
deletions).

### Summary

| Metric          | Value                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Overall score   | 5/10                                                                                                                                         |
| Assessment      | NEEDS_REVISION                                                                                                                               |
| Blocking issues | 3                                                                                                                                            |
| Serious issues  | 2                                                                                                                                            |
| Minor issues    | 3                                                                                                                                            |
| Files reviewed  | 61 (all git-ui, editor, webview, skill-synthesis-ui, chat, rpc-handlers, platform-core, shared, cli-engine, vscode files touched by Phase 2) |

### Five style questions

#### 1. What breaks in six months?

The diff layout toggle. `libs/frontend/git-ui/src/lib/diff-view/diff-view.component.ts:142,1432,1449`
still names `DIFF_LAYOUT_SETTING_KEY = 'editor.diff.renderSideBySide'` and calls
`rpcCall(this.vscodeService, 'editor:getSetting'/'editor:updateSetting', …)` —
both methods this same diff DELETED from every contract site (`rpc.types.ts`,
`manifest.ts` `EDITOR_PANE_METHODS`, `apps/ptah-electron/.../editor-rpc.handlers.ts`).
Six months from now someone will "fix" the side-by-side toggle that silently
fails to load or persist, grep for `editor:getSetting`, find nothing, and have
to re-discover that Task 2.6 built the replacement (`settings:get`/`settings:set`
on `SettingsRpcHandlers`, plus `'diff.renderSideBySide'` registered in
`FILE_BASED_SETTINGS_KEYS`) one file away and Task 2.7 never wired the caller to
it. This is the exact "live bug" the plan's correction #11 documented and Task
2.6 was written specifically to fix; the frontend half never landed.

#### 2. What would a new team member misread?

`libs/frontend/git-ui/src/lib/services/git-status.service.spec.ts:305-446` — a
whole `describe('GitStatusService.changedDirPrefixes (B3)', …)` block calling
`service.changedDirPrefixes()` on the MOVED `GitStatusService`, which no longer
has that member (Component 2 explicitly drops `fileStatusMap` and
`changedDirPrefixes` — both now live on the new, editor-lib-only
`FileTreeGitIndexService`). A reader who trusts the moved spec file as a
description of `GitStatusService`'s current contract will misread it entirely;
worse, `npx nx test @ptah-extension/git-ui` cannot even compile this file today.

#### 3. What does this cost to maintain?

High, right now: three of the moved/converted units (the diff-view settings
call, the `GitStatusService` spec, the `GitBranchesService` listener spec) are
inconsistent with their own production code, which means the Phase 2 acceptance
evidence in `batches.md` — `npx nx run-many -t lint typecheck test -p
@ptah-extension/git-ui …` green, 9-project header — cannot be true as filed.
Whoever runs that command next either discovers the break themselves (cheap, if
caught immediately) or, if a prior green run is trusted without re-running,
carries a broken assumption into Phase 3, where `GitDockComponent` is built on
top of these exact services.

#### 4. Where is this inconsistent with the rest of the repository?

- `GitBranchesService` and `WorktreeService` were converted from a raw `window`
  listener to `MessageHandler` in the same batch (Task 2.2), with the SAME
  stated spec requirement ("rewrite ... to dispatch through `handleMessage`
  instead of `window.dispatchEvent`"). `WorktreeService`'s new spec
  (`worktree.service.spec.ts:62-160`) does this correctly — `handleMessage()` is
  called directly, and a test asserts "registers NO global message listener at
  construction" (`:91`). `GitBranchesService`'s existing spec
  (`git-branches.service.spec.ts:396-471`) was left completely untouched —
  still `window.dispatchEvent(new MessageEvent('message', …))` against a
  service that no longer listens on `window` at all. One conversion in the same
  batch got the spec migration the plan asked for; its sibling did not.
- `SettingsRpcHandlers` (backend) and `DiffViewComponent` (frontend) are two
  halves of the same rename (Component 11 / Task 2.6 + 2.7). The backend half
  is complete and tested (`settings-rpc.handlers.spec.ts:252-351` covers both
  methods, including the `isFileBasedSettingKey` refusal). The frontend half —
  the only caller of either method — was never repointed.

#### 5. What would you have done differently, and why is that better rather than merely other?

Nothing about the overall carve shape — the peer-lib approach, the barrel
discipline, the `MonacoLoaderService`/`git-read-error-messages.ts` internal
duplication with an expiry comment, and the eslint/jest boundary retargeting
are all exactly right and match sibling libs (`workspace-indexing`). The one
process change: Task 2.7's own acceptance evidence line explicitly says
`npx nx run-many -t lint typecheck test -p @ptah-extension/git-ui …` should be
green with a 9-project header — running that command (not just grepping for
the files the task list named) before calling the batch closed would have
caught all three blocking issues below in one pass, because two of them are
compile errors and the third is a spec whose own assertions cannot be met by
the code it tests.

### Blocking issues

#### `DiffViewComponent` still calls the two RPC methods this diff deleted

- File: `libs/frontend/git-ui/src/lib/diff-view/diff-view.component.ts:142,1432,1449`
- Problem: `DIFF_LAYOUT_SETTING_KEY = 'editor.diff.renderSideBySide'` (`:142`)
  and the two calls `rpcCall(this.vscodeService, 'editor:getSetting', { key:
DIFF_LAYOUT_SETTING_KEY })` (`:1432-1433`) and `rpcCall(this.vscodeService,
'editor:updateSetting', { key: DIFF_LAYOUT_SETTING_KEY, value: sideBySide })`
  (`:1448-1451`) were never updated. `editor:getSetting`/`editor:updateSetting`
  no longer exist anywhere in the contract: removed from `RpcMethodRegistry`
  and `RPC_METHOD_ENTRIES` (`libs/shared/src/lib/types/rpc.types.ts`), from
  `EDITOR_PANE_METHODS` (`libs/backend/rpc-handlers/.../manifest.ts:103-112`),
  and from the Electron handler that used to serve them
  (`apps/ptah-electron/.../editor-rpc.handlers.ts`, `registerGetSetting`/
  `registerUpdateSetting` both deleted). Task 2.6 registered the replacement
  key `'diff.renderSideBySide'` (no `editor.` prefix) in
  `FILE_BASED_SETTINGS_KEYS`/`FILE_BASED_SETTINGS_DEFAULTS`
  (`libs/backend/platform-core/src/file-settings-keys.ts:208,480`) and built
  `settings:get`/`settings:set` specifically to serve this caller
  (`settings-rpc.handlers.ts`). Task 2.7's own file list and quality
  requirements say in as many words: "Rename `DIFF_LAYOUT_SETTING_KEY` from
  `'editor.diff.renderSideBySide'` to `'diff.renderSideBySide'` and the two RPC
  method names to `'settings:get'` / `'settings:set'`, matching Task 2.6"
  (`batches.md:505`). None of that happened.
- Impact: `loadLayoutPreference()`/`persistLayoutPreference()`
  (`diff-view.component.ts:1428-1455`) call a method name no handler on any
  host registers. Both calls are wrapped in an empty `catch`, so the failure is
  invisible — the side-by-side/inline diff layout preference silently never
  loads and never persists, which is precisely the bug correction #11 and Task
  2.6 exist to fix, except the fix stops one file short of the only caller.
  This also means the manifest partition's own guarantee — every live method
  name is reachable from some host — is now violated from the CALLER's side:
  a real code path names two methods that exist nowhere in
  `RpcMethodRegistry`.
- Fix: rename the constant to `'diff.renderSideBySide'` and change both
  `rpcCall` sites to `'settings:get'` / `'settings:set'`, matching the
  `{ key, value }` / `{ key }` shapes `SettingsRpcHandlers` already implements.

#### Moved `GitStatusService` spec still tests members the move deleted

- File: `libs/frontend/git-ui/src/lib/services/git-status.service.spec.ts:305-446`
- Problem: `describe('GitStatusService.changedDirPrefixes (B3)', …)` (opens
  `:313`) calls `service.changedDirPrefixes()` nine times against the imported,
  real `GitStatusService` (`:17`, not mocked). Component 2 / Task 2.2 both say
  `fileStatusMap` and `changedDirPrefixes` are dropped from `GitStatusService`
  on the move "and their B3 specs" go with them (`batches.md:386`,
  `implementation-plan.md:259-262`) — confirmed dropped: the production
  `git-status.service.ts` moved into this same lib has neither member. The two
  derivations were correctly re-homed into the new
  `FileTreeGitIndexService` (`libs/frontend/editor/src/lib/file-tree/file-tree-git-index.service.ts:28,66`,
  reading `gitStatus.files()`), but the spec file that used to test them on
  `GitStatusService` was moved wholesale instead of being pruned, and no
  replacement spec exists for `FileTreeGitIndexService` at all.
- Impact: `service.changedDirPrefixes` does not exist on the class this file
  imports — `npx nx test @ptah-extension/git-ui` cannot compile this spec.
  This is a direct violation of Task 2.7's / the phase's own closing
  acceptance evidence, which requires `@ptah-extension/git-ui` in a 9-project
  green `run-many -t lint typecheck test`.
- Fix: delete the `B3` describe block (`:305-446`) from this file, and add a
  small spec for `FileTreeGitIndexService` in the editor lib asserting the same
  invariants (O(1) lookup map shape, ancestor-prefix set, workspace
  partitioning via `gitStatus.files()`) so the coverage is not simply lost.

#### `GitBranchesService`'s `MessageHandler` conversion has no passing test for it

- File: `libs/frontend/git-ui/src/lib/services/git-branches.service.spec.ts:396-471`
- Problem: the production service was converted from a raw `window` listener to
  `implements MessageHandler` (`git-branches.service.ts:92,189-198`) — there is
  no `window.addEventListener` anywhere in the file (confirmed by search). The
  `describe('startListening()', …)` block in its spec (`:396-471`, four tests)
  still exclusively drives the service via
  `window.dispatchEvent(new MessageEvent('message', { data: {...} }))`
  (`:404-408`, `:423-427`, `:442-446`, `:461-465`) and asserts
  `refreshForCauses`/`refreshSpy` fired in response. Nothing in the current
  `GitBranchesService` listens for a raw `window` `message` event, so these
  dispatches reach no code in the class under test; the assertions that expect
  `refreshSpy` to have been called cannot be satisfied by the current
  implementation. Compare with the sibling conversion in the SAME batch:
  `WorktreeService`'s new spec (`worktree.service.spec.ts:62-160`) correctly
  drives the converted service through `service.handleMessage({...})` and even
  asserts "registers NO global message listener at construction" (`:91`) —
  exactly the migration Task 2.2 asked for on both services.
  `git-branches.service.spec.ts` never received it.
- Impact: either these four tests are failing right now (breaking the Phase 2
  closing `run-many -t … test -p … @ptah-extension/git-ui …` acceptance
  command), or — if some other mechanism keeps them green — they are asserting
  nothing about the code they claim to cover, which is worse: the
  `MessageHandler` conversion of `GitBranchesService`, including its
  `_isListening` gate and the "arrives before `startListening()`" drop
  behaviour Task 2.2 explicitly asked to be pinned, has zero real coverage.
- Fix: rewrite `:396-471` to call `service.handleMessage({ type:
MESSAGE_TYPES.GIT_STATUS_UPDATE, payload: {...} })` directly, matching the
  `WorktreeService` spec's pattern, and add the missing assertion that a push
  arriving before `startListening()` is dropped (batches.md's own Task 2.2
  requirement, not yet present for either service in this file).

### Serious issues

#### Stale `'settings:'` prefix comment undersells the namespace it gates

- File: `libs/backend/vscode-core/src/messaging/rpc-handler.ts:69`
- Problem: `'settings:', // Settings export/import (Electron desktop)` was not
  updated when Task 2.6 added `settings:get`/`settings:set` as
  capability-free, every-host methods under the same prefix. The comment now
  describes two of the four methods this prefix gates, and specifically
  omits the two that are new and load-bearing for the git-ui carve.
- Tradeoff: harmless to the guard itself (the prefix check is string-based,
  not comment-based), but the next person auditing `ALLOWED_METHOD_PREFIXES`
  for "what needs Electron" will misclassify `settings:get`/`settings:set` as
  Electron-only, when `SettingsRpcHandlers`'s own manifest entry is
  capability-free.
- Recommendation: update to `'settings:', // Settings get/set (all hosts),
export/import (Electron desktop)`.

#### Two verbatim internal duplicates carry no build-time guard against drift

- File: `libs/frontend/editor/src/lib/services/monaco-loader.service.ts`,
  `libs/frontend/editor/src/lib/services/editor/git-read-error-messages.ts`
- Problem: both are byte-identical (confirmed by diff) to their `git-ui`
  counterparts except for a header comment explaining the Phase-4 expiry. That
  is the right call for this phase (`MonacoLoaderService` is a real internal
  dependency of `CodeEditorComponent`, which is not moving until Phase 4), and
  the header comment is honest about it. But nothing enforces the two copies
  staying identical between now and Phase 4 — a bug fix landing in one copy
  during the gap silently does not reach the other.
- Tradeoff: a lint rule or spec asserting file-content parity is arguably
  overkill for a multi-week-at-most window, so this is Serious rather than
  Blocking; leaving it unflagged is how "harmless, temporary duplication"
  becomes an unnoticed permanent fork if Phase 4 slips.
- Recommendation: no code change needed now — file a one-line reminder in
  Phase 4's own batch entry (already implicit in "delete this lib") that these
  two files must be diffed against their `git-ui` originals immediately before
  deletion, not assumed identical.

### Minor issues

- `libs/frontend/git-ui/src/lib/services/diff-tabs.service.ts:410-428` —
  `applyHunks`'s in-flight `rpcCall` params object type-asserts `satisfies
GitApplyHunksParams` correctly, but the sibling `requestDiff` at `:475-490`
  does the same for `GitDiffFileParams`; both are fine, noted only because a
  reader scanning for "does every RPC call site validate its own shape" will
  want to confirm this pattern is deliberate (it is) rather than copy-paste
  drift — no action needed, included for completeness of the review's
  boundary-contract pass.
- `libs/frontend/git-ui/CLAUDE.md` and `libs/frontend/editor/CLAUDE.md` both
  correctly describe the intended end state (git-ui owns the git surface,
  editor is being dismantled) but neither mentions the Phase-2-in-progress
  reality that `DiffViewComponent`'s settings persistence is currently broken
  — a doc reader has no signal that this specific corner is unfinished. Once
  the Blocking issue above is fixed this note is moot; flagged only in case
  the fix lands in a later batch than the doc claims completeness.
- `libs/frontend/git-ui/src/lib/services/git-status.service.spec.ts` header
  comment (`:1-10`) still describes only the F2 switch-freshness specs and
  does not mention the file also carries (mistakenly) the B3 block — once B3
  is removed per the Blocking fix above, no further action needed here.

### File-by-file

#### `libs/frontend/git-ui/{project.json,jest.config.ts,eslint.config.mjs,tsconfig*.json,src/index.ts,CLAUDE.md}`

Score 9/10 — 0B, 0S, 0M. Scaffolding is byte-for-byte the `workspace-indexing`
shape Component 1 specified: no `package.json`/`ng-package.json`, single entry
point, `tags: ["scope:webview", "type:feature"]`. The barrel exports exactly
the Component-1 list; `MonacoLoaderService` and `git-read-error-messages.ts`
correctly stay unexported. `.commitlintrc.json` and `tsconfig.base.json` both
carry the `git-ui` entries already committed at `16e13df24`.

#### `libs/frontend/git-ui/src/lib/services/{git-status,git-branches,worktree,source-control}.service.ts`

Score 9/10 — 0B, 0S, 0M (production code only; specs reviewed separately
below). All four conversions/moves match their Component 2-5 contracts:
signatures unchanged, `GitBranchesService`/`WorktreeService` correctly
converted from raw `window` listeners to `MessageHandler`, `WorktreeService`
keeps the `'git:worktreeChanged'` literal-type match rather than adding it to
`MESSAGE_TYPES` (correct per the plan's explicit reasoning), `SourceControlService`
moved with zero behavioural change.

#### `libs/frontend/git-ui/src/lib/services/diff-tabs.service.ts` (+ `.spec.ts`)

Score 8/10 — 0B, 0S, 0M. The keep-half port from `EditorDiffSplitHelper` is
faithful to Component 6: the revalidate-on-reopen (A1), stale-snapshot-token
refusal without an RPC (D2 AC6), and refreshing/stale/error states never
blanking rendered content are all present with the same reasoning preserved in
comments. `DiffTabsService → GitStatusService`, never the reverse, is
respected (`:70`).

#### `libs/frontend/git-ui/src/lib/diff-view/diff-view.component.ts` (+ specs)

Score 3/10 — 1B, 0S, 0M. The four frozen inputs/one output are untouched as
required, and the loader/type import specifiers were correctly repointed. The
one edit Task 2.7 explicitly assigned to this file — the settings-key and
RPC-method rename — was not made (Blocking issue above). Everything else
about this file is a clean move.

#### `libs/frontend/git-ui/src/lib/{source-control,worktree}/*.component.ts` (+ specs)

Score 9/10 — 0B, 0S, 0M. `SourceControlPanelComponent`/`SourceControlFileComponent`
moved with zero signature change, matching design-handoff.md's "reused as-is."
`WorktreeSectionComponent`'s one behavioural edit — `EditorService.activeWorkspacePath`
→ `ElectronLayoutService.activeWorkspace()?.path` — is exactly as specified
(`:274-280`) and is the only file in this batch with a genuinely new,
purpose-built spec (`worktree-section.component.spec.ts`) proving it.

#### `libs/frontend/editor/src/{index.ts,services.ts,lib/file-tree/*,lib/services/editor/editor-diff-split.ts,lib/services/monaco-loader.service.ts,lib/services/editor/git-read-error-messages.ts}`

Score 8/10 — 0B, 1S, 0M. Both barrels correctly drop every moved export and
nothing else. `FileTreeGitIndexService` is a clean, well-documented re-home of
the two tree-only derivations, correctly root-provided and correctly imported
by `FileTreeNodeComponent`. The two private internal copies are deliberate and
well-commented (Serious issue above is about their unguarded future drift, not
about the duplication itself being wrong).

#### `apps/ptah-extension-webview/src/app/app.config.ts`, `editor-message-routing.spec.ts`, `eslint.config.mjs`

Score 10/10 — 0B, 0S, 0M. Five `MESSAGE_HANDLERS` multi-providers now present
(`GitStatusService`, `GitBranchesService`, `WorktreeService`, `DiffTabsService`,
plus the pre-existing `ElectronLayoutService`), exactly what Task 2.7 required
to keep the two converted services from going silently deaf. The dead
xterm-era `no-restricted-imports` ban was deleted outright rather than
retargeted, correctly reasoned (its cause died in Phase 1).

#### `libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts`

Score 10/10 — 0B, 0S, 0M. The two-module `Promise.all` repoint is clean and
preserves the original error-handling shape.

#### `libs/frontend/skill-synthesis-ui/{eslint.config.mjs,jest.config.ts,src/lib/components/clones/lazy-diff-view.component.ts,src/__mocks__/ptah-git-ui.ts,CLAUDE.md}`

Score 10/10 — 0B, 0S, 0M. The eslint ban is retargeted (paths + patterns group,
both renamed), not deleted — correct, since its stated cause (Monaco) survives
this task. The mock rename is mechanical and the lazy `import()` boundary is
preserved verbatim.

#### `libs/backend/rpc-handlers/src/lib/handlers/{settings-rpc.handlers.ts,settings-rpc.schema.ts,settings-rpc.handlers.spec.ts}`, `host-profile/manifest.ts`, `libs/backend/platform-core/src/file-settings-keys.ts`, `libs/shared/src/lib/types/rpc.types.ts`, both `expected-absent`/`rpc-surface.spec.ts` pairs

Score 9/10 — 0B, 1S, 0M (the Serious issue is the stale prefix comment, filed
above). Every contract site is edited atomically and consistently: `rpc.types.ts`
interface + entries, `EDITOR_PANE_METHODS` losing the two methods, both
`expected-absent` lists losing them (since every host now serves the pair,
capability-free), and a genuinely new Zod schema (`settings-rpc.schema.ts`)
with full test coverage including the `isFileBasedSettingKey` refusal path.
This is the backend half of Component 11 done exactly as specified — the
defect is entirely that the ONE caller of this contract (`DiffViewComponent`)
was never repointed to it.

### Pattern compliance

| Repository rule or nearby convention                                                                   | Status                                                 | Evidence                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git-ui` depends only on `@ptah-extension/core` + `@ptah-extension/shared`, never `chat`/`ui`/`editor` | PASS                                                   | grep of every `git-ui/src` import; no `chat`/`ui`/`editor` specifier found                                                                                                                                                         |
| Public API reached only via `src/index.ts`                                                             | PASS                                                   | `MonacoLoaderService`/`git-read-error-messages.ts` correctly unexported; no deep import found outside the lib                                                                                                                      |
| RPC dual-registration (compile-time `rpc.types.ts` + runtime `ALLOWED_METHOD_PREFIXES`)                | PASS (backend) / FAIL (frontend caller)                | Backend: `rpc.types.ts` + manifest edited together. Frontend: `diff-view.component.ts:1432,1449` still names two methods removed from the registry — see Blocking issue                                                            |
| `MESSAGE_HANDLERS` multi-provider registered for every converted `MessageHandler`                      | PASS                                                   | `app.config.ts` gained four new `useExisting` entries (`GitBranchesService`, `WorktreeService`, `DiffTabsService`, plus the existing `GitStatusService`)                                                                           |
| Converted `MessageHandler` has a test exercising `handleMessage`, not the retired listener             | PASS (`WorktreeService`) / FAIL (`GitBranchesService`) | `worktree.service.spec.ts:62-160` vs `git-branches.service.spec.ts:396-471` — see Blocking issue                                                                                                                                   |
| Moved spec drops members the move deleted                                                              | FAIL                                                   | `git-status.service.spec.ts:305-446` still tests `changedDirPrefixes`, removed from the class — see Blocking issue                                                                                                                 |
| Zod schema at every RPC boundary                                                                       | PASS                                                   | `settings-rpc.schema.ts` validates both new methods' params                                                                                                                                                                        |
| Zero net contract growth for the settings rename (removed 2, added 2, no widened surface)              | PASS                                                   | `rpc.types.ts` diff shows a straight swap, not an addition                                                                                                                                                                         |
| No compatibility alias for `@ptah-extension/editor`                                                    | PASS                                                   | grep of remaining `@ptah-extension/editor` imports shows only the two intended runtime `import()` sites (`electron-shell.component.ts:307`, `file-path-link.component.ts:91`) plus the `no-editor-dependency.spec.ts` guard itself |

### Maintenance debt

- Introduced: `@ptah-extension/git-ui` as a clean peer lib; `FileTreeGitIndexService`
  as a small, well-scoped re-home; `settings:get`/`settings:set` as a
  capability-free, every-host settings pair replacing an Electron-only,
  editor-coupled one.
- Retired: `GitStatusService`/`GitBranchesService`/`WorktreeService`/
  `SourceControlService`/`DiffViewComponent`/`MonacoLoaderService`'s public
  presence in `@ptah-extension/editor`; two raw `window` listeners; the
  Electron-only `editor:getSetting`/`editor:updateSetting` pair.
- Net: the shape of the debt paid down is correct and large, but three
  concrete regressions are open at the same time — one functional (the diff
  layout preference), two structural (a spec testing removed members, a spec
  testing a retired code path). None is cosmetic; all three are things Phase 3
  (which builds `GitDockComponent` directly on top of these same services)
  will inherit if this batch is called closed as-is.

### Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Key concern: `batches.md`'s own Phase 2 closing acceptance evidence — a green
  9-project `npx nx run-many -t lint typecheck test -p @ptah-extension/git-ui …`
  — cannot currently be true. `git-status.service.spec.ts` cannot compile
  against the moved `GitStatusService`, and `git-branches.service.spec.ts`'s
  `startListening()` block asserts behaviour the converted, listener-free
  service cannot produce. Both are inside the one project (`@ptah-extension/git-ui`)
  that command names first.
- What a 10/10 version would do differently: run the batch's own stated
  verification command before marking 2.2–2.7 done, not just verify each
  batch's file list was touched; that single step surfaces all three blocking
  issues, since two are compile failures and the third is a test whose
  assertions the code under test cannot satisfy.

### Phase 2 resolution (c6b263c72)

All blocking and serious findings were re-applied on disk before the commit: worktree and branches services converted to MessageHandler, editor-tab.types imports repointed to types/diff-tab.types, the diff layout preference moved to settings:get / settings:set under diff.renderSideBySide, fileStatusMap and changedDirPrefixes removed from GitStatusService, and the worktree section reads ElectronLayoutService.activeWorkspace(). Verified: typecheck 94 projects, lint 10 projects, tests 9 projects, webview build, all green.
