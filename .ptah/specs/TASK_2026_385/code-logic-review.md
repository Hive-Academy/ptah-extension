# Code Logic Review — `TASK_2026_385` (Phase 1)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 9/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 1        |
| Failure modes found | 0        |

Scope reviewed: the uncommitted working-tree diff for Phase 1 (Batches 1.1-1.5,
`batches.md:246-348`), obtained via `git status --short` and `git diff` scoped
to each named file set, cross-checked against a repo-wide grep for every
deleted symbol/token/channel name (`ptahTerminal`, `PtyManagerService`,
`PTY_HOST`, `TerminalRpcHandlers`, `'terminal:'`, `rpc-terminal`, `IPtyHost`,
`authorizedTerminalRoots`/`isAuthorizedTerminalCwd`/`isWithinHomeDir`,
`isAllowedShell`/`shell-allowlist`, `node-pty`, `@xterm`, `TerminalCreateParams`
etc.) across `apps/` and `libs/`. Out-of-scope noise (`.gitignore`,
`.claude/skills/**`, `.ptah/specs/**`, `tools/video-editor/**`,
`package-lock.json`) was excluded per instruction. This is a deletion-only
batch, so the review is weighted toward completeness of the removal — every
consumer site that referenced a deleted symbol, token, channel or capability —
rather than new-logic correctness.

The one prior review in this file (Phase 0) has been replaced by this Phase 1
review; Phase 0 covered a different batch (vim mode / quick-open / worktree
dialogs / `layout:*`) and is superseded.

## Five logic questions

### 1. How does this fail silently?

No silent-failure path found. This is the interesting question for a deletion
refactor — a _partial_ removal typically fails loudly (an unresolvable DI
token throws at boot, a missing `ipcMain` handler produces "no such channel" on
the renderer side) rather than silently, which is exactly why the review
focus is on finding a stray dangling reference rather than a swallowed error.
None was found:

- `bootstrapElectron` no longer resolves `ELECTRON_TOKENS.PTY_MANAGER_SERVICE`
  at all (`apps/ptah-electron/src/activation/bootstrap.ts:29-33,299-311` diff
  removes the whole try/catch), so there is no longer a `console.warn`
  fallback path that could mask a missing registration — the prior code's
  "resolve failed, continuing without pty" catch is gone along with its
  reason for existing.
- `IpcBridge.setupTerminalHandlers` and its five `ptahTerminal:*` /
  `terminal:*` channel registrations are deleted whole
  (`apps/ptah-electron/src/ipc/ipc-bridge.ts:126-142,524-568`); `dispose()`'s
  `ptyManager?.disposeAll()` call and the two `removeAllListeners` calls for
  `terminal:data-in`/`terminal:resize` are removed with it. Confirmed by grep:
  zero remaining references to `ptahTerminal`, `PtyManagerService`, `PTY_HOST`,
  or any `terminal:*` binary channel name anywhere in `apps/` or `libs/`.

### 2. What user action produces unexpected behaviour?

None identified as a regression beyond the intended one (the terminal panel no
longer exists, by design). The one behaviour change worth flagging as a
verification gap rather than a defect: `editor-panel.component.ts` previously
exposed `data-testid="editor-terminal-toggle"` and the corresponding e2e
assertion (`apps/ptah-electron-e2e/src/specs/editor/editor.spec.ts:64-69`, now
removed) is the only place that button's absence was pinned. The removal of
both the button and its own assertion in the same diff is internally
consistent, but it means "the toggle is truly gone from the DOM" now relies on
the template diff alone rather than a runtime assertion — acceptable for a
deletion batch, since asserting a negative (element does not exist) adds
little over the template review already performed here.

### 3. What input data produces a wrong answer?

Not applicable in the classic sense — this is a subtractive diff with no new
computation introduced. The closest analogue, checked directly: does anything
that "looks like" the removed PTY authorization/shell-allowlist logic
silently degrade rather than fail? `isAuthorizedWorkspace`
(`libs/backend/rpc-handlers/src/lib/utils/workspace-authorization.ts:14-22`,
kept) is unchanged in its own logic; only the two now-dead exports
(`isWithinHomeDir`, `authorizedTerminalRoots`, `isAuthorizedTerminalCwd`) were
removed alongside it, per the batch's explicit instruction
(`batches.md:276`). `isPathWithinRoots` in `platform-core` (kept, per
instruction, because `path-containment.spec.ts:71` still needs it) had its
docstring correctly de-scoped from "the terminal-cwd policy" framing to a
generic "any sink" framing (`path-containment.ts:2-16,26-32,58-63`) — the
mechanism itself is untouched, so no wrong-answer risk there.

### 4. What happens when a dependency fails?

Not applicable — no new external dependency or fallible I/O was introduced;
this batch only removes a dependency (`node-pty`) and its packaging
plumbing. Verified the removal is asymmetric in exactly the direction the
batch specifies: `node-pty` is dropped from `apps/ptah-electron/package.json:42`
and the `externals` array in `apps/ptah-electron/project.json:68`, and the
`electron-builder.yml` prune blocks for all three platforms
(`electron-builder.yml:124,142,162`, six lines total) are removed — but
`node-pty: "1.1.0"` is confirmed still present at the ROOT
`D:\projects\ptah-extension\package.json:171`, per the batch's explicit
constraint that the CLI e2e `pty-runner.ts` (`apps/ptah-cli/tests/e2e/_harness/pty-runner.ts`)
still needs it. `rebuild-native.js` and `packaged-deps.spec.ts` comments were
updated to match (no rebuild claim survives for a module that is no longer
packaged).

### 5. What is missing that the requirements never mentioned?

- No changelog/release-note entry records the loss of the integrated terminal
  for an end user upgrading from a version that had it — a product decision,
  not a code defect, flagged once per the reviewing convention.
- `batches.md:337` describes "the three expected-absent lists"; the repo only
  has two files whose export is literally named `EXPECTED_ABSENT_CAPABILITIES`
  (`apps/ptah-extension-vscode/src/di/expected-absent.ts`,
  `libs/backend/cli-engine/src/lib/rpc/expected-absent.ts` — the latter serves
  both the CLI and TUI headless hosts from one file). Both are correctly
  updated (`'pty'` removed from both, confirmed via
  `grep -n "'pty'"` returning zero hits repo-wide). This is a discrepancy in
  the batch's own bookkeeping, not a gap in the diff — the full existing set
  was found and updated.

## Failure modes

None found that rise above the "requirements drift" note above. The specific
runtime-dangle shapes named in the review brief were each checked and closed:

- **DI/container**: `container.smoke.spec.ts`'s prior "Risk R2" describe block
  (asserting `PLATFORM_TOKENS.PTY_HOST` aliases `ELECTRON_TOKENS.PTY_MANAGER_SERVICE`
  by reference identity) is replaced, not merely deleted, by a new describe
  that resolves `SDK_TOKENS.SDK_PROCESS_SPAWNER` from a container that has run
  the REAL `registerSdkServices` (`apps/ptah-electron/src/di/container.smoke.spec.ts:219-249`).
  Traced the claim that this genuinely resolves rather than being declared
  inert: `registerSdkServices` eagerly resolves `SDK_TOKENS.SDK_CONFIG_WATCHER`
  at `libs/backend/agent-sdk/src/lib/di/register.ts:502`; `ConfigWatcher`'s
  constructor (`libs/backend/agent-sdk/src/lib/helpers/config-watcher.ts:20-30`)
  synchronously calls `this.config.watch(...)` and
  `this.secretStorage.onDidChange(...)` — exactly the two methods the diff adds
  to the `TOKENS.CONFIG_MANAGER` and `PLATFORM_TOKENS.SECRET_STORAGE` mocks in
  `buildMinimalContainer` (`container.smoke.spec.ts:79-95`). Without those two
  additions the new test would throw during `registerSdkServices` before ever
  reaching the `SDK_PROCESS_SPAWNER` resolve, so the mocks are load-bearing,
  not decorative, and the assertion is real. `OffThreadProcessSpawner`'s own
  constructor takes only `TOKENS.LOGGER`
  (`libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts:593-598`),
  confirming the test's own comment that it is the container's one
  implementation and needs nothing else the minimal container lacks.
- **Preload/IPC symmetry**: `preload.ts`'s `ptahTerminal` bridge (write/resize/
  onData/onExit, four `ipcRenderer` calls) and `ipc-bridge.ts`'s
  `setupTerminalHandlers` (the matching `ipcMain.on`/`ipcMain.removeAllListeners`
  pairs) were removed together — neither side left registering a channel the
  other no longer sends/listens on.
- **RPC contract surface**: traced end to end — `rpc.types.ts` (interface +
  `RPC_METHOD_ENTRIES`) → `manifest.ts` (`terminal` entry) →
  `capabilities.ts`/`host-profile.ts` (`pty` capability + `ALL_DISABLED`) →
  `rpc-handler.ts` (`'terminal:'` prefix) → all three host profiles (Electron's
  `pty: true` flag, VS Code's doc-comment, cli-engine's doc-comment, neither of
  the latter two ever set the flag) → both `expected-absent.ts` files → both
  `rpc-surface.spec.ts` files' `EXPECTED_ABSENT_METHODS` arrays. Every layer
  drops exactly the terminal-shaped entries and nothing else; no layer retains
  a reference to a layer above it that no longer exists (e.g. no capability
  advertised with no manifest entry behind it, no manifest entry requiring a
  capability nobody sets).
- **`workspace-coordinator.service.ts`**: now resolves three editor services,
  not four (`libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts:105-108`).
  Checked the one spec for this file
  (`workspace-coordinator.service.spec.ts`) for a stale expectation — it never
  referenced `TerminalService` or asserted on `editorServices`'s length/
  membership, so the reduced set required no test update and none is missing.
- **Editor panel drag tests**: the two repointed drag tests
  (`editor-panel.component.spec.ts` — "restores the split divider percentage…"
  and "(209-5) losing capture ends the drag…") now assert against
  `aria-label="Resize split panes"` / `onSplitResizeStart` /
  `readSignal('splitLeftPercent')`, all of which are real, pre-existing
  production code paths (`editor-panel.component.ts:325-326,678,1427-1445`),
  not a no-op left after deleting the terminal-handle assertions they replace.
  Confirmed the `moveTo(x, y=100, pointerId=1)` helper signature
  (`editor-panel.component.spec.ts:441`) is used consistently with the split
  divider's horizontal (`clientX`-based) drag arithmetic in both repointed
  tests.
- **Packaging**: `electron-builder.yml`'s three per-platform prune blocks,
  `project.json`'s `externals` array and `package.json`'s dependency entry all
  drop `node-pty` together; `packaged-deps.spec.ts`'s `rendererOnly` filter
  drops the `@xterm/` prefix check to match the webview `styles.css` import
  removal. Root `package.json:171` retains `node-pty` per the batch's explicit
  carve-out for the CLI e2e harness.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- **Moderate** — `batches.md:337`'s "three expected-absent lists" does not
  match the two files that actually exist in the repo carrying that export
  (see Five Logic Questions #5). Not a code defect — both real lists were
  found and correctly updated — but worth a one-line correction in the batch
  record so a future reader does not go looking for a third file that isn't
  there.
- Minor — `apps/ptah-electron-e2e/src/support/rpc-bridge.ts`'s doc comment
  correctly drops the `terminal:*` channel bullet
  (`rpc-bridge.ts:28-31`); no residual mention of terminal channels found
  anywhere in that file.

## Data flow

Ordered verification path for the HIGH "partial contract edit" risk this
batch explicitly carries (Batch 1.5's own validation note), all confirmed
present and mutually consistent:

1. `libs/shared/src/lib/types/rpc.types.ts` — `rpc-terminal.types` re-export
   and import dropped; `RpcMethodRegistry`'s `terminal:create`/`terminal:kill`
   entries and their matching `RPC_METHOD_ENTRIES` `true` rows removed
   together (lines ~17-20, 320-326, 1489-1495, 3542-3544 pre-diff). OK — both
   halves of the compile-time `Record<RpcMethodName, true>` guard were edited
   together, so the guard cannot silently drift.
2. `libs/shared/src/lib/types/rpc/rpc-terminal.types.ts` deleted whole; grep
   confirms zero remaining importers of `TerminalCreateParams`,
   `TerminalCreateResult`, `TerminalKillParams`, `TerminalKillResult` anywhere
   in the repo. OK.
3. `libs/backend/rpc-handlers/src/lib/handlers/terminal-rpc.handlers.ts` +
   `.schema.ts` + both specs deleted whole; both barrels
   (`rpc-handlers/src/index.ts:44-47`, `handlers/index.ts:53-56`) drop the
   `TerminalRpcHandlers` export in the same diff. OK — no barrel re-exports a
   deleted class.
4. `manifest.ts` — the whole `terminal` manifest entry (key, methods, `requires:
['pty']`, handler) removed as one unit
   (`host-profile/manifest.ts:351-357` pre-diff), and the `TerminalRpcHandlers`
   import dropped from the same file's import block. OK.
5. `capabilities.ts` / `host-profile.ts` — `pty` removed from the capability
   vocabulary and from `ALL_DISABLED` together
   (`capabilities.ts:52-54`, `host-profile.ts:79`). OK — no manifest entry left
   requiring a capability that no longer exists in the vocabulary.
6. `libs/backend/vscode-core/src/messaging/rpc-handler.ts` — `'terminal:'`
   dropped from `ALLOWED_METHOD_PREFIXES` (`rpc-handler.ts:68-72`). OK — the
   runtime transport guard and the manifest agree; a stray `terminal:*` call
   would now be rejected at the same layer that used to allow it, not silently
   swallowed.
7. Host profiles: `apps/ptah-electron/src/rpc-host-profile.ts` drops
   `pty: true` (line 36-39); `apps/ptah-extension-vscode/src/rpc-host-profile.ts`
   and `libs/backend/cli-engine/src/lib/rpc/cli-host-profile.ts` never set the
   flag (doc-comment-only edits, grep-confirmed no `pty:` assignment in
   either). OK.
8. Both `expected-absent.ts` files and both `rpc-surface.spec.ts` files drop
   `'pty'` / `'terminal:create'` / `'terminal:kill'` in lockstep — confirmed by
   repo-wide grep returning zero hits for `'pty'` as a capability-string
   literal and zero hits for `terminal:create`/`terminal:kill` anywhere. OK.
9. `apps/ptah-electron/src/di/phase-4-handlers.ts` — the `PtyManagerService`
   construction + `ELECTRON_TOKENS.PTY_MANAGER_SERVICE` registration +
   `PLATFORM_TOKENS.PTY_HOST` alias + `TerminalRpcHandlers` singleton
   registration + its name in the handler-name array are all five removed
   together (`phase-4-handlers.ts:167-186` pre-diff), along with the now-dead
   `PtyManagerService`/`ELECTRON_TOKENS` imports. Confirmed
   `apps/ptah-electron/src/di/electron-tokens.ts` drops
   `PTY_MANAGER_SERVICE` and keeps `GIT_WATCHER_SERVICE`. OK — no capability
   left pointing at a deleted handler or token.
10. `libs/backend/platform-core/src/di/tokens.ts` drops `PLATFORM_TOKENS.PTY_HOST`;
    `src/index.ts` drops the `IPtyHost`/`PtySpawnRequest`/`PtySpawnResult`/
    `PtyKillResult` type re-exports AND the `isAllowedShell`/`WIN_SHELLS`/
    `POSIX_SHELLS` re-exports (the shell-allowlist file was deleted whole,
    matching its own file deletion). Grep confirms zero remaining references to
    any of these six symbols anywhere in the repo. OK.
11. `workspace-authorization.ts` — `authorizedTerminalRoots`,
    `isAuthorizedTerminalCwd` and `isWithinHomeDir` (the two already-dead
    exports named in the batch's quality requirement) are all three removed,
    while `isAuthorizedWorkspace` is kept verbatim and `isPathWithinRoots`'s
    consumer doc comment is correctly re-scoped rather than deleted. OK —
    matches `batches.md:276`'s explicit instruction exactly.
12. Bootstrap/IPC/preload: `bootstrap.ts` no longer resolves or passes a
    `PtyManagerService` into `IpcBridge`; `IpcBridge`'s constructor drops the
    now-unused third parameter and its type import; `ipc-bridge.ts` drops
    `setupTerminalHandlers()` and its call site, plus the `terminal:*`
    `removeAllListeners`/`disposeAll` calls in `dispose()`; `preload.ts` drops
    the whole `ptahTerminal` bridge. All four files edited in the same diff,
    consistent with each other — no orphaned constructor parameter, no
    dangling call to a removed private method. OK.
13. Frontend: `editor.service.ts` drops the two terminal signals and their two
    mutator methods; `editor-panel.component.ts` drops the toolbar toggle
    button, the resize handle, the terminal panel host div, the
    `onTerminalResizeStart` handler, the `TerminalIcon`/`TerminalPanelComponent`
    imports, and every terminal-referencing comment/JSDoc line — all in one
    coherent edit with no dangling template binding to a removed signal/method
    or vice versa. Both spec files (`.component.spec.ts`, `.a11y.spec.ts`) drop
    the matching `StubTerminalPanelComponent` and stubbed signals from every
    `TestBed` import array they previously appeared in (14 occurrences,
    grep-counted, all removed). OK.
14. `libs/frontend/editor/src/index.ts` and `services.ts` barrels — every
    deleted component/service/type (`TerminalComponent`, `TerminalTabBarComponent`,
    `TerminalPanelComponent`, `TerminalService`, `TerminalTab`, `PtahTerminalApi`)
    removed from both barrels; both files' own doc comments re-written to drop
    the terminal/xterm architecture description. OK.
15. `workspace-coordinator.service.ts` — `injectable.get(editorModule.TerminalService)`
    call and its doc-comment mentions removed; the one spec for this file
    carries no reference to `TerminalService` to begin with, so no orphaned
    test expectation. OK.
16. Packaging: `electron-builder.yml` (3 prune blocks), `project.json`
    (externals array), `package.json` (dependency), `rebuild-native.js`
    (comment), `packaged-deps.spec.ts` (`@xterm/` filter) all edited
    consistently; root `package.json` retains `node-pty` per the explicit
    carve-out. `styles.css` drops the `@xterm/xterm/css/xterm.css` import. OK.
17. E2E/scene: `pty-manager.spec.ts` deleted from the specs root (not
    `specs/editor/`, matching the batch's own correction note);
    `editor.spec.ts` drops only the `editor-terminal-toggle` visibility
    assertion, leaving the rest of the describe block (including the two git
    tests the batch says must survive untouched — confirmed
    `editor.spec.ts:145-194` region is absent from this diff) intact;
    `editor-tour.scene.ts` drops the terminal-reveal beat and its
    `director.say(8)`/`say(9)`/`say(10)` calls are renumbered down to
    `say(8)` as the new final call, matching the `editor-tour.json` script's
    line count dropping from 11 to 9 (0-indexed `say(i)` still lines up 1:1
    with the `lines` array after the edit — verified by counting both).
    `rpc-bridge.ts`'s doc-comment channel list drops the four terminal binary
    channels. OK.

No step in this chain shows a partial edit — every consumer site named in
`batches.md:254-341` was located and confirmed changed, and the repo-wide grep
for every deleted symbol/token/channel name found no fifth site the batch plan
missed.

## Requirements fulfilment

| Requirement                                                                   | Status   | Gap                                                                                                                                    |
| ----------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Delete terminal panel, service and xterm styling (Batch 1.1)                  | COMPLETE | none — barrels, `editor.service.ts`, webview CSS import all consistent                                                                 |
| Delete `PtyManagerService`, preload bridge, `PTY_HOST` port (Batch 1.2)       | COMPLETE | none — DI, IPC, preload all symmetric; `SDK_PROCESS_SPAWNER` smoke assertion genuinely resolves (traced dependency chain)              |
| Drop `node-pty`/`@xterm` from Electron package (Batch 1.3)                    | COMPLETE | none — root `package.json` retains `node-pty` as required                                                                              |
| Remove pty e2e and terminal beats (Batch 1.4)                                 | COMPLETE | none — the two git tests in `editor.spec.ts:145-194` survive untouched                                                                 |
| Remove `terminal:` prefix, `pty` capability, terminal RPC surface (Batch 1.5) | COMPLETE | `batches.md`'s own count of "three expected-absent lists" is off by one (see Moderate); the diff itself updated every list that exists |

Implicit requirements not addressed: a user-facing changelog note for the
removed terminal feature. Not named as in-scope by `batches.md` or
`context.md`, and does not block Phase 1.

## Edge cases

| Case                                                                                                                                            | Handled                         | How                                                                                                                                                                                                                                                                                                                                         | Concern                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A stray reference to any deleted symbol/token/channel anywhere in the monorepo                                                                  | YES (verified)                  | Repo-wide grep for `ptahTerminal`, `PtyManagerService`, `PTY_HOST`, `TerminalRpcHandlers`, `terminal:*`, `IPtyHost`, `authorizedTerminalRoots`/`isAuthorizedTerminalCwd`/`isWithinHomeDir`, `isAllowedShell`/`shell-allowlist`, `TerminalCreateParams` family, `@xterm`, all return zero hits outside doc/comment mentions already reviewed | none                                                                                                                                                       |
| `container.smoke.spec.ts`'s new `SDK_PROCESS_SPAWNER` assertion running against a container missing the newly-added `watch`/`onDidChange` mocks | N/A (not a real risk — checked) | `registerSdkServices` would throw inside `ConfigWatcher`'s constructor before reaching the assertion if the mocks were absent; they are present                                                                                                                                                                                             | Confirms the test is a real, not vacuous, gate                                                                                                             |
| The two repointed drag specs asserting against the split divider instead of the deleted terminal handle                                         | YES                             | Both assert against real signals/handlers (`splitLeftPercent`, `onSplitResizeStart`, `aria-label="Resize split panes"`) that predate this diff                                                                                                                                                                                              | none — not a vacuous pass                                                                                                                                  |
| `workspace-coordinator.service.ts` losing its fourth resolved service with a spec that might assume four                                        | YES                             | The one spec file for this service never referenced `TerminalService`                                                                                                                                                                                                                                                                       | none                                                                                                                                                       |
| Electron packaging trying to load `node-pty`/`@xterm` after this diff                                                                           | NO (correctly)                  | Package, externals and prune-block entries all removed together; `packaged-deps.spec.ts` filter updated to match                                                                                                                                                                                                                            | none — `npm install` + native rebuild step is the batch's own stated verification gate, not re-verified by this review since it requires running the build |
| CLI e2e's `pty-runner.ts` losing `node-pty` from the workspace                                                                                  | NO (correctly avoided)          | Root `package.json:171` retains `node-pty` per the batch's explicit carve-out                                                                                                                                                                                                                                                               | none                                                                                                                                                       |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none rises to blocking or serious. The only residual risk worth
  naming is that this review is static (diff + grep), not a build/test run —
  `npm install` + `npm run typecheck:all`/`lint:all`/`build:all` and the
  `nx run-many -t test` / `nx run ptah-electron-e2e:e2e` gates `batches.md:344-347`
  names as the phase-close verification have not been executed here and
  remain the actual proof that the container still builds and the e2e suite
  is green.
- What a robust implementation would add: (1) a one-line correction to
  `batches.md:337` so "three expected-absent lists" matches the two files that
  exist; (2) a changelog/release-note line recording the terminal feature's
  removal for upgrading users; (3) run the Batch 1 verification commands
  (`batches.md:344-347`) before the phase commit, since this review — however
  exhaustive at the diff/grep level — cannot substitute for the container
  actually booting and the e2e suite actually passing.

---

# Code Logic Review — `TASK_2026_385` (Phase 2)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 2/10     |
| Assessment          | REJECTED |
| Blocking issues     | 2        |
| Serious issues      | 1        |
| Moderate issues     | 2        |
| Failure modes found | 3        |

Scope reviewed: the uncommitted working-tree diff for Phase 2 (Batches
2.1-2.7, `batches.md:351-513`), read whole-file (not diff-only) for every
moved/created file under `libs/frontend/git-ui/**`, plus the repointed
consumers named in the review brief: `libs/frontend/editor/**`
(`file-tree-git-index.service.ts`, `editor.service.ts`,
`editor-diff-split.ts`, `editor-file-ops.ts`, `editor-internal-state.ts`),
`libs/frontend/chat/.../workspace-coordinator.service.ts`,
`libs/frontend/skill-synthesis-ui/**`, `apps/ptah-extension-webview/src/app/{app.config.ts,editor-message-routing.spec.ts}`,
`libs/backend/rpc-handlers/.../{settings-rpc.handlers.ts,settings-rpc.schema.ts,manifest.ts}`,
`libs/backend/platform-core/src/file-settings-keys.ts`,
`libs/shared/src/lib/types/rpc.types.ts`,
`apps/ptah-electron/.../editor-rpc.handlers.ts`, and both
`rpc-surface.spec.ts` files. Verified with `git status --porcelain`,
`git diff HEAD` per path, and a recursive grep of every relative import
(`from '\.\./`) inside `libs/frontend/git-ui/src` against the files that
actually exist on disk. `libs/frontend/canvas/**`, `.gitignore`,
`.ptah/specs/**`, `tools/video-editor/**` and `.claude/skills` deletions were
excluded as foreign concurrent work, per instruction.

This review reaches a REJECTED verdict on a single, decisive, and mechanically
verifiable fact: **`libs/frontend/git-ui` does not compile.** Four of the
library's public-surface files — `DiffViewComponent`, `SourceControlPanelComponent`,
`SourceControlFileComponent`, `WorktreeSectionComponent` — and their four
matching spec files import a module path that does not exist anywhere in the
library, a leftover from before the files were moved. Everything else examined
in Phase 2 — the two `MessageHandler` listener conversions, the five
`MESSAGE_HANDLERS` providers, the `settings:get`/`settings:set` rename and its
dead-key fix, the four `git:worktreeChanged` producers, the file-tree git-index
split, the CLI's untouched `git:*` surface — is correct and well-evidenced. The
compile failure is what makes the rest moot: none of Batch 2.3's or 2.4's
acceptance evidence ("`npx nx run-many -t test -p @ptah-extension/git-ui`
shows the ported diff suites green") can be true against these files as
written.

## Five logic questions

### 1. How does this fail silently?

It does not fail silently — it fails LOUDLY, at compile time, which is the one
mercy here. But there is one genuinely silent gap: `DiffTabsService.errorMessage`
(`libs/frontend/git-ui/src/lib/services/diff-tabs.service.ts:94,109`) is
documented as "Dock-level failure copy — the replacement for the editor
coordinator's `showError`" and is exported as part of the service's public
surface, yet the private backing signal `_errorMessage` is **only ever**
`.set(null)` (`diff-tabs.service.ts:197`, inside `openDiff`) and is never once
set to a non-null string anywhere in the file. `applyHunks` returns its failure
messages (`SELECTION_SUPERSEDED_MESSAGE`, `APPLY_TRANSPORT_MESSAGE`) as part of
the returned `GitApplyHunksResult`, never through this signal
(`diff-tabs.service.ts:383-445`). A future `GitDockComponent` that renders
`diffTabs.errorMessage()` expecting dock-level apply failures to surface there
will render nothing, forever — the signal is wired up, documented, and
plausible-looking, but functionally dead. `diff-tabs.service.spec.ts` never
asserts on the service-level `errorMessage` (only on the per-tab
`diff.errorMessage`, a different and correctly-wired field — line 280, 376,
379), so nothing would catch this before a consumer relies on it.

### 2. What user action produces unexpected behaviour?

Opening the Source Control panel, the worktree section, or any diff — i.e.
almost any interaction with the git dock once it exists (Phase 3) — is
unreachable today because the components those actions render simply cannot be
built: `nx build`/`nx test`/`ngc --noEmit` on `@ptah-extension/git-ui` fails at
module resolution before a single test runs. See Failure modes below for the
exact broken specifiers.

### 3. What input data produces a wrong answer?

`GitStatusService.fileStatusMap` / `.changedDirPrefixes`
(`libs/frontend/git-ui/src/lib/services/git-status.service.ts:142-153,180-194`)
were supposed to be **dropped** on the move — Component 2 and Batch 2.2 both
say so explicitly ("drop `fileStatusMap` `:142-153` and `changedDirPrefixes`
`:180-194` (tree-only) and their B3 specs") — but they were not removed. A
byte-for-byte duplicate of both computeds now also lives in the new
`libs/frontend/editor/src/lib/file-tree/file-tree-git-index.service.ts:28-80`,
reading from the same `GitStatusService.files()`. Today this produces no wrong
answer because the git-ui copies are unexported from `src/index.ts` and have
no reader — but it is two independent implementations of one derivation with
no shared source, which is exactly the shape that drifts: a future bugfix
applied to one (e.g. a path-separator edge case) has every reason not to reach
the other, and nothing enforces that it should. The B3 spec block instructed
for removal (`git-status.service.spec.ts:305-445`) is also still present and
still green, since the code it tests is still there — the whole cleanup this
task asked for silently didn't happen while its own test suite reports success.

### 4. What happens when a dependency fails?

Not newly introduced in this diff. `DiffTabsService.requestDiff` and the retry
paths correctly propagate a transport failure into `stale`/`error` states that
retain prior content (`diff-tabs.service.ts:335-343,544-565`), matching the A1/A3
contract this batch was required to preserve. The one dependency-failure gap is
architectural, not behavioral: `worktree-section.component.ts` and the two
source-control components cannot even resolve their own dependencies at build
time (see Failure modes), which is a stronger and more immediate failure than
anything a runtime RPC could produce.

### 5. What is missing that the requirements never mentioned?

- A lint rule or CI check that would have caught a relative import pointing at
  a path that no longer exists after a `git mv`-based batch move. TypeScript's
  own `noUnusedLocals`/`noImplicitAny` would not catch this either — only an
  actual `tsc --noEmit` run would, and Batch 2.3/2.4's own acceptance criteria
  say to run exactly that (`npx nx run-many -t lint typecheck test -p
@ptah-extension/git-ui`) before marking the batch complete. That command was
  evidently never run against the current working tree, or it would have
  failed immediately with four `Cannot find module` errors.
- A test asserting `DiffTabsService.errorMessage()` becomes non-null on an
  apply failure, which would have caught the dead-signal gap in question 1
  before a dock renders it.

## Failure modes

### git-ui does not compile — stale relative imports to a directory that no longer exists

- Trigger: any build, lint, or test run of `@ptah-extension/git-ui`, or any
  consumer library that imports `DiffViewComponent`, `SourceControlPanelComponent`,
  `SourceControlFileComponent`, or `WorktreeSectionComponent` from it (that is,
  the entire component-layer public surface Batch 2.3/2.4 moved).
- Symptom: `Cannot find module '../services/editor/editor-tab.types'` (or
  `'../services/editor.service'`) at TypeScript compile time. Nothing runs —
  not the unit tests, not `ngc --noEmit`, not `nx build`.
- Evidence (every hit from a recursive grep of `from '\.\./` under
  `libs/frontend/git-ui/src`, checked against what actually exists on disk —
  confirmed only `libs/frontend/git-ui/src/lib/types/diff-tab.types.ts`
  exists; there is no `lib/services/editor/` directory and no
  `lib/services/editor.service.ts` anywhere in `git-ui`):
  - `libs/frontend/git-ui/src/lib/diff-view/diff-view.component.ts:44-45` —
    `} from '../services/editor/editor-tab.types';` /
    `import { diffComparisonLabel } from '../services/editor/editor-tab.types';`
    (should be `'../types/diff-tab.types'`, exactly as this same file's line
    38 correctly resolves `MonacoLoaderService` from `'../services/monaco-loader.service'` —
    the sibling import three lines up shows the fix was applied selectively).
  - `libs/frontend/git-ui/src/lib/diff-view/diff-view.component.spec.ts:40-41`
    — identical broken specifier.
  - `libs/frontend/git-ui/src/lib/diff-view/diff-view-dialog.a11y.spec.ts:54-55`
    — identical broken specifier.
  - `libs/frontend/git-ui/src/lib/source-control/source-control-panel.component.ts:19`
    — `import type { OpenDiffRequest } from '../services/editor/editor-tab.types';`.
  - `libs/frontend/git-ui/src/lib/source-control/source-control-file.component.ts:21`
    and `source-control-file.component.spec.ts:22` — same.
  - `libs/frontend/git-ui/src/lib/worktree/worktree-section.component.ts:19` —
    `import { EditorService } from '../services/editor.service';`. This is a
    second, distinct defect layered on the same file (see next failure mode):
    even if the path existed, `EditorService` was never supposed to travel
    with this component at all.
- Current handling: none — the files were moved (`git mv`, confirmed by the
  `RM`/`R` status lines in `git status --porcelain`) but their internal
  relative imports were never repointed to the new directory layout. Batch
  2.7 ("Phase 2 repoint closer") explicitly scopes itself to "every surviving
  editor-lib importer of a moved symbol" plus the composition root — it does
  not claim ownership of import paths _inside_ the moved files themselves,
  and no other batch does either, so this is a gap in the plan's batch
  boundaries as much as in the execution.
- Recommendation: fix the five import sites to `'../types/diff-tab.types'`
  and the `worktree-section.component.ts` one per the next failure mode, then
  actually run `npx nx run-many -t lint typecheck test -p @ptah-extension/git-ui`
  before treating Batch 2.3/2.4 as complete.

### `WorktreeSectionComponent` still depends on `EditorService`, contradicting its own spec and the explicit plan instruction

- Trigger: any use of `WorktreeSectionComponent.isActiveWorktree()` — i.e. the
  worktree section's active-row highlight, the one behavioral edit Batch 2.4
  was scoped to make.
- Symptom: even setting the import-path defect aside, the production code at
  `worktree-section.component.ts:255,278` still reads
  `this.editorService.activeWorkspacePath` — a plain, non-reactive field on a
  service that (a) does not belong in `git-ui` per this task's own boundary
  rule ("git-ui must never depend on `@ptah-extension/editor`" —
  `libs/frontend/git-ui/CLAUDE.md` §Boundaries) and (b) was explicitly named
  for deletion from this component by Component 8 / Task 2.4: "delete the
  `EditorService` injection `:256` and its import `:19`", replaced by
  `this.layoutService.activeWorkspace()?.path ?? null`.
  `ElectronLayoutService` **is** injected (`worktree-section.component.ts:256`)
  but is dead — nothing in the file reads `this.layoutService` anywhere
  outside the constructor-style field declaration.
- Evidence: `worktree-section.component.ts:18-20,255-256,277-283`, contrasted
  with `worktree-section.component.spec.ts:1-112` — the spec that ships beside
  it in the same diff. The spec's own header comment states the intended fix
  in the past tense ("It now reads `ElectronLayoutService.activeWorkspace()?.path`")
  and its `TestBed.configureTestingModule` provides only `WorktreeService` and
  `ElectronLayoutService` — no `EditorService` provider at all. Against the
  actual production code, `inject(EditorService)` in a component under test
  with no `EditorService` provider and no `TestBed.overrideProvider` will
  resolve `EditorService`'s real, root-provided instance (it is
  `@Injectable({ providedIn: 'root' })` in the editor lib) rather than the
  spec's intended stub — but this is moot, because the broken import in the
  prior failure mode means the file cannot compile far enough to reach that
  question at runtime.
- Current handling: none. The spec was written to the _intended_ post-fix
  behaviour; the production file was left at its pre-fix state. This is the
  clearest single piece of evidence in this diff that the batch's own
  described edit was written down but not applied to the file it names.
- Recommendation: apply the edit Component 8 already specifies verbatim —
  delete the `EditorService` import and field, change `isActiveWorktree` to
  read `this.layoutService.activeWorkspace()?.path ?? null`.

### `GitStatusService` still carries the tree-only computeds it was supposed to shed

- Trigger: any read of `GitStatusService.fileStatusMap` or
  `.changedDirPrefixes` from within `git-ui` (currently no reader exists,
  since neither is exported from `src/index.ts`).
- Symptom: none observable today — this is a maintainability/boundary defect,
  not a runtime bug, because the duplicate in `FileTreeGitIndexService` is
  what `FileTreeNodeComponent` actually consumes
  (`libs/frontend/editor/src/lib/file-tree/file-tree-node.component.ts:24-25,147-148,210,323`,
  confirmed correctly repointed). But `git-status.service.ts:142-194` is dead
  weight inside the class this task's own CLAUDE.md says must never own tree
  state, and its B3 spec block (`git-status.service.spec.ts:305-445`) still
  runs and still passes, certifying code that was supposed to be deleted.
- Evidence: `libs/frontend/git-ui/src/lib/services/git-status.service.ts:136-194`
  (the two computeds, present verbatim) vs. `implementation-plan.md:255-262`
  / `batches.md:386` ("drop `fileStatusMap` `:142-153` and `changedDirPrefixes`
  `:180-194` (tree-only) and their B3 specs").
- Current handling: none — left in place, duplicated, not flagged anywhere in
  the diff or the batch record as a deliberate deviation.
- Recommendation: delete both computeds and the B3 spec block from
  `git-status.service.ts(.spec.ts)`, per the plan already written.

## Blocking issues

### `libs/frontend/git-ui` fails to compile

- File: `libs/frontend/git-ui/src/lib/diff-view/diff-view.component.ts:44-45`,
  `diff-view.component.spec.ts:40-41`, `diff-view-dialog.a11y.spec.ts:54-55`,
  `source-control/source-control-panel.component.ts:19`,
  `source-control/source-control-file.component.ts:21` (+`.spec.ts:22`),
  `worktree/worktree-section.component.ts:19`.
- Scenario: `npx nx run-many -t lint typecheck test -p @ptah-extension/git-ui`
  (Batch 2.3/2.4's own stated acceptance evidence) or any downstream build
  that reaches these files.
- Impact: the entire diff-view, source-control, and worktree surface of the
  new library is unbuildable. Every other Phase-2 acceptance criterion that
  depends on `git-ui` building — the 9-project `run-many` in Batch 2.7, the
  `nx graph` check, the Phase-2 phase-close verification in `batches.md:509-513`
  — cannot pass as things stand. This is not a partial regression; it is a
  hard stop on the whole phase.
- Fix: repoint the six broken specifiers to `'../types/diff-tab.types'` (five
  sites) and remove the `EditorService` import in `worktree-section.component.ts`
  (see next issue for the accompanying behavioral fix), then run the batch's
  own verification command before considering Phase 2 closed.

### `WorktreeSectionComponent.isActiveWorktree` never made the `EditorService → ElectronLayoutService` swap the plan requires

- File: `libs/frontend/git-ui/src/lib/worktree/worktree-section.component.ts:255,277-283`.
- Scenario: any render of the worktree section once the library compiles.
- Impact: reintroduces the exact dependency (`git-ui → editor`, through
  `EditorService`) this task's architecture decision is built around
  eliminating ("the git surface is extracted to a new peer lib ... before
  anything that hosts it is deleted" — `implementation-plan.md:92-94`; "It
  must not depend on `@ptah-extension/editor`" — `git-ui/CLAUDE.md`
  §Boundaries). Once `libs/frontend/editor` is deleted in Phase 4, this file
  cannot compile at all even with the import path fixed, because the module
  it names will no longer exist anywhere in the repo. This one issue would
  silently reopen the whole Phase-2/Phase-4 ordering risk `implementation-plan.md`
  is careful to sequence around.
- Fix: delete the `EditorService` import and injection; read
  `this.layoutService.activeWorkspace()?.path ?? null` as `worktree-section.component.spec.ts`
  already assumes.

## Serious issues

### `GitStatusService` retains `fileStatusMap`/`changedDirPrefixes`, duplicated by the new `FileTreeGitIndexService`

- File: `libs/frontend/git-ui/src/lib/services/git-status.service.ts:136-194`
  (should be deleted) vs. `libs/frontend/editor/src/lib/file-tree/file-tree-git-index.service.ts:28-80`
  (correct, new home).
- Scenario: any future maintenance of the tree-status derivation logic.
- Impact: two independent, byte-identical implementations of the same
  algorithm with no shared source of truth. Not user-visible today (the
  git-ui copy is unreachable — not exported from `src/index.ts`), but it
  directly contradicts an explicit, named instruction in both
  `implementation-plan.md` (Component 2) and `batches.md` (Task 2.2), and its
  own obsolete test block (`git-status.service.spec.ts:305-445`) passes green
  while certifying code the plan says should not exist.
- Fix: delete `fileStatusMap`/`changedDirPrefixes` and the B3 spec block from
  `git-status.service.ts`/`.spec.ts`.

## Moderate and minor issues

- **Moderate** — `DiffTabsService.errorMessage` (`diff-tabs.service.ts:94,109`)
  is documented and exported as dock-level failure copy but is never set to a
  non-null value anywhere in the file; `applyHunks`'s failure messages return
  through `GitApplyHunksResult` instead. Untested (no spec references the
  service-level `errorMessage`). Either wire it up before `GitDockComponent`
  is built on top of it (Phase 3), or remove it until it has a writer.
- **Minor** — `libs/frontend/git-ui/src/lib/types/diff-tab.types.ts:205` still
  says "see `EditorDiffSplitHelper.applyHunks`" in `HunkApplyRequest`'s doc
  comment; the method now lives on `DiffTabsService.applyHunks`
  (`diff-tabs.service.ts:383`). Stale cross-reference, no behavioral effect.
- **Minor** — `worktree.service.ts`'s `loadWorktrees()`
  (`libs/frontend/git-ui/src/lib/services/worktree.service.ts:71-85`) calls
  `git:worktrees` with an empty params object (`{}`), never a `workspaceRoot` —
  unlike every other RPC in this file and in `GitBranchesService`, which all
  scope by workspace. Pre-existing behaviour carried over verbatim from the
  editor lib (not introduced by this move), so not scored as a Phase-2 defect,
  but worth a forward-pointer to whoever builds the Phase-3 git dock for a
  multi-root workspace, since every other worktree method in this file (`add`,
  `remove`) does not need `workspaceRoot` either (they identify the target by
  branch/path), so this may simply be correct as-is — flagged for confirmation,
  not asserted as a bug.

## Data flow

1. `GitBranchesService`/`WorktreeService` convert from raw `window` listeners
   to `MessageHandler` — **OK**. Both gate `handleMessage` behind
   `_isListening`, both keep `startListening()`/`stopListening()` idempotent,
   `WorktreeService` matches the `'git:worktreeChanged'` literal exactly as
   instructed (`worktree.service.ts:34,60,250`). Verified against all four
   backend broadcast sites (`git-rpc.handlers.ts:370`,
   `ptah-api-builder.service.ts:874`, `sdk-callbacks.ts:356,374`) — every one
   broadcasts the identical string.
2. `app.config.ts` registers five `MESSAGE_HANDLERS` entries for the git
   surface (`GitStatusService`, `GitBranchesService`, `WorktreeService`,
   `DiffTabsService`, plus the pre-existing one) — **OK**, all five present
   at `app.config.ts:190-193` beside the existing `EditorService` entry at
   `:189`. Without any one of these the corresponding service is "silently
   deaf" per the plan's own framing; all four new ones are present.
3. `GitStatusService.fileStatusMap`/`changedDirPrefixes` — **GAP**. Not
   dropped as instructed; duplicated instead of moved. See Serious issues.
4. `FileTreeGitIndexService` (new, editor lib) — **OK**. Correctly derives
   from `GitStatusService.files()`, correctly consumed by
   `FileTreeNodeComponent` (`file-tree-node.component.ts:147-148,210,323`).
5. `DiffViewComponent`'s persisted layout preference — **OK**. Renamed from
   `editor:getSetting`/`editor:updateSetting` to `settings:get`/`settings:set`
   (`diff-view.component.ts:1440-1441,1456-1457`), `DIFF_LAYOUT_SETTING_KEY`
   renamed to `'diff.renderSideBySide'` (`:143`), and the dead-key bug
   (correction #11 — the key was never in `FILE_BASED_SETTINGS_KEYS`) is
   fixed: `'diff.renderSideBySide'` is now present in both
   `FILE_BASED_SETTINGS_KEYS` (`file-settings-keys.ts:208`) and
   `FILE_BASED_SETTINGS_DEFAULTS` (`:480`). The old Electron-only
   `registerGetSetting`/`registerUpdateSetting` handlers and their
   `editor:getSetting`/`editor:updateSetting` contract entries are cleanly
   removed with no dangling caller (`editor-rpc.handlers.ts` diff, `rpc.types.ts`
   diff) — but see step 6, this file itself cannot compile.
   5b. Contract bookkeeping for the rename — **OK**. `rpc.types.ts` moves the
   two method definitions from `editor:*` to `settings:*` in the same commit
   window; both host `rpc-surface.spec.ts`/`expected-absent.ts` pairs drop
   `editor:getSetting`/`editor:updateSetting` (confirmed via diff — no residual
   mention); the manifest's `settings` entry (`manifest.ts:218-223`) is
   `requires: []`, matching the plan's "capability-free, every host serves it"
   design.
6. `DiffViewComponent`/`SourceControlPanelComponent`/`SourceControlFileComponent`/
   `WorktreeSectionComponent` — **BLOCKED**. See Blocking issues; the files
   this preference lives in, and the components the dock will host, do not
   compile.
7. `EditorRpcHandlers` (Electron) drops `file:open`'s two sibling settings
   methods cleanly, with no dangling `registerGetSetting`/`registerUpdateSetting`
   call site left in `register()` — **OK**.

## Requirements fulfilment

| Requirement                                                                                                       | Status          | Gap                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Move `GitStatusService`, drop `fileStatusMap`/`changedDirPrefixes` (Component 2 / Batch 2.2)                      | PARTIAL         | Service moved; the two computeds and their B3 spec were not dropped, only duplicated elsewhere                                                                                |
| Convert `GitBranchesService`/`WorktreeService` to `MessageHandler` (Component 3-4 / Batch 2.2)                    | COMPLETE        | none — both conversions correct, both registered in `app.config.ts`                                                                                                           |
| Move `SourceControlService` (Component 5 / Batch 2.2)                                                             | COMPLETE        | none                                                                                                                                                                          |
| Extract `DiffTabsService` from `EditorDiffSplitHelper`'s keep-half (Component 6 / Batch 2.3)                      | MOSTLY COMPLETE | Logic correctly ported; `errorMessage` signal is dead (never written)                                                                                                         |
| Move `DiffViewComponent`+`MonacoLoaderService` unchanged (Component 7 / Batch 2.3)                                | BROKEN          | Moved, but its own imports do not resolve — does not compile                                                                                                                  |
| Move source-control + worktree components, swap `EditorService`→`ElectronLayoutService` (Component 8 / Batch 2.4) | BROKEN          | Moved, but imports do not resolve AND the `EditorService`→`ElectronLayoutService` swap was never applied to `worktree-section.component.ts`                                   |
| Retarget Skills lazy diff at git-ui (Component 7 tail / Batch 2.5)                                                | COMPLETE        | eslint ban, jest mapper, mock rename all correct                                                                                                                              |
| `settings:get`/`settings:set` rename + dead-key fix (Component 11 / Batch 2.6)                                    | COMPLETE        | none — contract, manifest, both expected-absent lists, `FILE_BASED_SETTINGS_*` all consistent                                                                                 |
| Fill the barrel, repoint every consumer, 5 `MESSAGE_HANDLERS` providers (Component 1/Task 2.7)                    | COMPLETE        | barrel matches the Component-1 list exactly; `app.config.ts` has all five providers; `workspace-coordinator.service.ts`, `editor-message-routing.spec.ts` correctly repointed |
| `.commitlintrc.json` / `tsconfig.base.json` scaffolding (Task 2.1)                                                | COMPLETE        | `"git-ui"` scope present, alias present in alphabetical position                                                                                                              |
| CLI `git:*` surface untouched                                                                                     | COMPLETE        | `apps/ptah-cli/src/cli/commands/git.ts` has no diff and no working-tree changes                                                                                               |
| Four `git:worktreeChanged` producers keep the literal                                                             | COMPLETE        | all four broadcast sites confirmed unchanged                                                                                                                                  |

Implicit requirements not addressed: none beyond what is captured above as
gaps.

## Edge cases

| Case                                                                                                 | Handled                                     | How                                                                                                            | Concern                                                                                      |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| A `git:status-update`/`git:worktreeChanged` push arriving before `startListening()`                  | YES                                         | Both converted services gate `handleMessage` on `_isListening`, matching the pre-move raw-listener behaviour   | none                                                                                         |
| Hunk apply whose `snapshotToken` moved on                                                            | YES                                         | `DiffTabsService.applyHunks` refuses without an RPC when the token mismatches (`diff-tabs.service.ts:396-408`) | none                                                                                         |
| Diff tab revalidating on `file:content-changed` / `git:status-update`                                | YES                                         | Content never blanked; only `status` changes (`refreshDiffTab`, `onFileContentChanged`)                        | none                                                                                         |
| The file tree still receiving `fileStatusMap`/`changedDirPrefixes` after the `GitStatusService` move | YES (via the new `FileTreeGitIndexService`) | `FileTreeNodeComponent` correctly repointed                                                                    | The dropped originals were duplicated rather than removed from `git-ui` — see Serious issues |
| `git-ui` importing from `editor` at any depth (the boundary this task exists to establish)           | NO — violated                               | `worktree-section.component.ts` still imports `EditorService`                                                  | This is the one dependency-direction violation the whole task is structured to prevent       |
| `@ptah-extension/git-ui` actually building                                                           | NO                                          | Six broken relative imports across four production files and four specs                                        | Blocking — see above                                                                         |
| Dock-level apply-failure copy reaching a future `GitDockComponent`                                   | NO                                          | `DiffTabsService.errorMessage` is never written                                                                | Moderate — flagged before Phase 3 builds on it                                               |

## Verdict

- Recommendation: REJECT
- Confidence: HIGH — the compile failure is verified directly against the
  filesystem (grep of every relative import in `git-ui/src`, cross-checked
  against `ls`/`find` of what actually exists), not inferred from the diff
  alone.
- Top risk: `libs/frontend/git-ui` as staged cannot be built, tested, or
  linted — the phase's own stated verification command
  (`npx nx run-many -t lint typecheck test -p @ptah-extension/git-ui ...`,
  `batches.md:507`) would fail immediately with module-resolution errors, and
  nothing in the working tree suggests it was run after Batches 2.3/2.4 landed.
- What a robust implementation would add: (1) fix the six broken relative
  imports (`../services/editor/editor-tab.types` → `../types/diff-tab.types`,
  five sites; `../services/editor.service` → delete, one site); (2) finish
  the `EditorService`→`ElectronLayoutService` swap in
  `WorktreeSectionComponent.isActiveWorktree` that the file's own spec already
  assumes happened; (3) delete `GitStatusService.fileStatusMap`/
  `changedDirPrefixes` and their B3 spec block, now that
  `FileTreeGitIndexService` is the real owner; (4) either wire
  `DiffTabsService.errorMessage` to the two failure paths in `applyHunks` or
  remove it until Phase 3 needs it; (5) actually run
  `npx nx run-many -t lint typecheck test -p @ptah-extension/git-ui @ptah-extension/editor @ptah-extension/skill-synthesis-ui @ptah-extension/chat @ptah-extension/core @ptah-extension/rpc-handlers @ptah-extension/platform-core @ptah-extension/shared ptah-extension-webview`
  and confirm the "9 projects" header before re-submitting this batch for
  review.

### Phase 2 resolution (c6b263c72)

All blocking and serious findings were re-applied on disk before the commit: worktree and branches services converted to MessageHandler, editor-tab.types imports repointed to types/diff-tab.types, the diff layout preference moved to settings:get / settings:set under diff.renderSideBySide, fileStatusMap and changedDirPrefixes removed from GitStatusService, and the worktree section reads ElectronLayoutService.activeWorkspace(). Verified: typecheck 94 projects, lint 10 projects, tests 9 projects, webview build, all green.
