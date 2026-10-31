# Code Style Review — `TASK_2026_853_3401`

Scope: uncommitted worktree `feat-artifact-display-window-be2e973df42f` vs `main` (58 modified or deleted files, about 30 untracked source files). Read in full: the port, the null host, the RPC handler, the Electron host and guards, the display-window frontend (component, sync service head, state handler, wiring, webview config and `main.ts`). The remaining specs and the large `chat-view.component.ts` were read only through the diff. No verify or build was run.

## Summary

| Metric          | Value          |
| --------------- | -------------- |
| Overall score   | 7/10           |
| Assessment      | NEEDS_REVISION |
| Blocking issues | 1              |
| Serious issues  | 3              |
| Minor issues    | 5              |
| Files reviewed  | about 45 (non-spec source read, specs skimmed) |

## Five style questions

### 1. What breaks in six months?

- `scripts/eager-closure-gate.js:30` still allow-lists the deleted `display-sheet.state.ts`. The new eager files are not listed (see Blocking). The next person to touch the allowlist cannot tell which entries are live.
- `display-sheet.component.ts:217-219` and `display-window-sync.service.ts:274-282` each hold their own copy of the "open review" logic and its two message constants (`NO_CHANGE_SET_TEXT`, `ACTION_FAILED_TEXT`; sheet lines 18-19, sync lines 54-55). If one changes, the in-sidebar and detached paths diverge.
- `DISPLAY_WINDOW_ALLOWED_METHODS` (`ipc-bridge.ts`) and the documented child allowlist in `display-window.config.ts` ("`displayWindow:getState`, `displayWindow:action`, `displayWindow:close` and `artifacts:openLink`") are two copies of one list. One is code and one is a comment, so the comment will rot.

### 2. What would a new team member misread?

- `display-sheet` is now a right sidebar with Pin/Detach/Collapse (`display-sheet.component.ts` header and template). The name, the `data-testid="display-sheet"`, `.sheet-*` CSS classes and `sheet-open` still say "sheet", i.e. a bottom drawer.
- `connectDisplaySidebar` (`display-sidebar-wiring.ts:36`) behaves differently for `main` and non-main views: two code paths hide behind one boolean. The doc comment explains it well, but the boolean is the thing a reader will trip on.
- `main.ts` branches on `?ptahWindow=display` with an inline `URLSearchParams` check. The reason (keeping the config chunk lazy) is in a comment, which is good.

### 3. What does this cost to maintain?

- `DisplayWindowSync` is 362 lines and holds bind, publish scheduling, action application, review failure state, user-facing text and the message handler (`display-window-sync.service.ts:130-362`). It is cohesive around "the main side of the detached window", but `applyAction` (line 234) reimplements dock and review behaviour that `DisplaySheetComponent` already owns.
- Eight `console.warn/error` calls were added in frontend and main code (see Minor). They match the siblings, so no extra cost, but there is no logger seam to test or filter them.
- `chat-view.component.ts` is 1977 lines (+60 in this diff). The sidebar logic was moved out into `display-sidebar-wiring.ts`, which is the right call, but the view keeps four more `displayWindow*` computeds.

### 4. Where is this inconsistent with the rest of the repository?

- Mostly consistent. The port follows the `ArtifactRpcHandlers` precedent: token in `PLATFORM_TOKENS` (`tokens.ts:+7`), null adapter in platform-core, `requires: []` manifest entry (`manifest.ts`), `ALLOWED_METHOD_PREFIXES` (`rpc-handler.ts:47`), `RpcMethodRegistry` and `RPC_METHOD_ENTRIES` entries (`rpc.types.ts`), `expected-resolvable` in both hosts, and a contract runner used by the Electron spec (`display-window.spec.ts:250`).
- The Electron binding is in `bootstrap.ts` (about line 550) and not in `platform-electron/src/registration.ts`. This departs from the "one binding per adapter" rule, but it is justified: the host needs the `IpcBridge`. The token comment states it. Accept, but record it as a decision.
- Frontend tests mix `as unknown as` casts (spec files only; none in production code).

### 5. What would you have done differently?

- Put the review-action logic (resolve change set, open review, map failure to text) in one service used by both the sheet and the sync service. Today it exists twice.
- Update the eager-closure allowlist in the same change that adds eager files (a regex per directory instead of one per file, or fewer eager files in the first place).
- Keep one source of truth for the child IPC allowlist and have the webview config doc point at it.

## Blocking issues

### Eager-closure gate not updated for new eager files; stale entry for a deleted file

- File: `scripts/eager-closure-gate.js:28-31` (unchanged by this diff; `git diff main --stat -- scripts` is empty). Stale reference also at `apps/ptah-electron/src/config/eager-closure-gate.spec.ts:131`.
- Problem: `assertNoUnlistedEagerGrowth` (line 111-127) throws for every eager input that is not in the base build and does not match `ALLOWED_EAGER_GROWTH_INPUTS`. The static `ChatViewComponent` and `DisplaySheetComponent` now import new modules: `services/display-window/display-window-sync.service.ts`, `services/display-window/display-window-wire.ts` (imported by `display-sheet.component.ts` for `selectionForKey`/`selectionKey`), `templates/display-sidebar-wiring.ts`, `transcript/transcript-turn-artifacts.ts` and `services/artifacts/published-artifact.ts` (via `artifact.store.ts`). None matches the allowlist. The list also still contains `display-sheet.state.ts`, which this change deletes, so the spec at line 131 tests a path that no longer exists.
- Impact: the Electron `validate-deps` build gate (pre-push and CI) is likely to fail with `[eager-closure-gate] unlisted eager input growth: ...`. I did not run the build (CLAUDE.md forbids it), so this is inferred from reading the gate and the import graph.
- Fix: add patterns for the new eager modules (or a single directory pattern for `services/display-window/`), remove the `display-sheet.state.ts` pattern and the matching `it.each` row, and run the gate script against a build when the user permits one.

## Serious issues

### Duplicated review-action logic and text between sheet and sync service

- File: `libs/frontend/chat/src/lib/components/organisms/display-sheet/display-sheet.component.ts:18-19,217-219`; `libs/frontend/chat/src/lib/services/display-window/display-window-sync.service.ts:54-55,274-282`.
- Problem: same two constants and the same "no change set / error message fallback" branch in two places. This is already two copies of the same behaviour in a brand-new change.
- Tradeoff: a shared helper costs one file; two copies mean the in-sidebar and detached windows show different errors the first time someone edits one.
- Recommendation: extract one function (for example in `change-set-actions.service.ts`) that returns the message, and use it from both.

### Child-window IPC allowlist documented in two places

- File: `apps/ptah-electron/src/ipc/ipc-bridge.ts` (`DISPLAY_WINDOW_ALLOWED_METHODS`) and `apps/ptah-extension-webview/src/app/display-window/display-window.config.ts:46-52` (comment).
- Problem: the config comment restates the allowlist. The webview cannot import the Electron constant, so a comment is the only link, and it will drift.
- Recommendation: shorten the comment to point at `DISPLAY_WINDOW_ALLOWED_METHODS`, or move the list to `@ptah-extension/shared` and let both sides use it.

### Component keeps the "sheet" name after becoming a sidebar

- File: `display-sheet.component.ts` (selector `ptah-display-sheet`, `data-testid="display-sheet*"`, `.sheet-shell`, `sheet-open`, `sheet-overlay`) and the barrel entry `libs/frontend/chat/src/index.ts`.
- Problem: the doc comment says "right sidebar" while every identifier says "sheet". The file rename would also need the gate pattern above, which is a reason to do it now rather than later.
- Recommendation: either rename to `display-sidebar` while this change is open, or add a one-line note in the header comment that the name is kept for stability (and say why).

## Minor issues

- `apps/ptah-electron/src/windows/display-window.ts:229,255,317`, `apps/ptah-extension-webview/src/app/display-window/display-window.config.ts:41`, `display-window-state.handler.ts:78`, `display-window-sync.service.ts:186,351,359`, `artifact.store.ts` (`console.warn` in the publish path): `console` instead of a logger. Matches the siblings (`main-window.ts:101,109`, `ipc-bridge.ts:189`, other chat services), so not a violation; noted because the task brief asked for Logger.
- `apps/ptah-electron/src/windows/display-window.ts:203` and `transcript-turn-artifacts.ts:76` use constructor parameter properties. Fine for classes created with `new`; the Angular code uses `inject()` elsewhere.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` is at 1977 lines. Pre-existing, but this change adds to it.
- Specs use `as unknown as` (for example `chat-view.component.spec.ts`, added lines about 828-850, 1012, 1666). Test-only, but a typed stub would read better.
- `display-window.component.ts:24-26` keeps its own timer for the link error. It is released in `onDestroy`, so it is correct; a shared toast would be simpler but is not needed.

## File-by-file

### `libs/backend/platform-core/src/interfaces/display-window-host.interface.ts` and `display-window/desktop-only-display-window-host.ts`

Score 9/10 — 0 B, 0 S, 0 M. `I*` name, type-only export (`index.ts:173`), kebab-case with role suffix, documented contract, null adapter matches the artifact precedent.

### `libs/backend/rpc-handlers/src/lib/handlers/display-window-rpc.handlers.ts`

Score 8/10 — 0 B, 0 S, 0 M. Strict zod schemas at the boundary (lines 28-62), size cap, `satisfies readonly RpcMethodName[]`, port resolved per call, matches `ArtifactRpcHandlers`. Registered in the manifest, `ALLOWED_METHOD_PREFIXES`, both `expected-resolvable.ts` files and the surface specs.

### `apps/ptah-electron/src/windows/display-window.ts`, `window-guards.ts`

Score 8/10 — 0 B, 0 S, 1 M. Injected options keep the host testable. Guards are shared with the main window and the module explains why they live apart from `main-window.ts`. Only the `console` use.

### `apps/ptah-electron/src/ipc/ipc-bridge.ts`, `ipc-sender-policy.ts`

Score 8/10 — 0 B, 0 S, 0 M. Role-based sender check and a narrow allowlist are fail-closed. Duplicated allowlist wording noted above.

### `libs/frontend/chat/src/lib/components/templates/display-window/*`, `display-sidebar-wiring.ts`

Score 8/10 — 0 B, 1 S, 0 M. Standalone, OnPush, signals, `inject()`, no `[innerHTML]`; the panel is named only inside `@defer`. Cleanup is registered through `DestroyRef`.

### `libs/frontend/chat/src/lib/services/display-window/display-window-sync.service.ts`, `display-window-wire.ts`

Score 7/10 — 0 B, 1 S, 0 M. Frame and timer have release paths. Review logic is duplicated (Serious above). Eager import of `display-window-wire` from the sheet drives the gate failure.

### `libs/frontend/chat/src/lib/components/organisms/display-sheet/display-sheet.component.ts`

Score 6/10 — 0 B, 1 S, 0 M. Uses `input()`/`output()`, and the previous duplicated key helpers moved to one place. Name drift remains.

### `scripts/eager-closure-gate.js` and its spec

Score 3/10 — 1 B. Not updated; stale entry. See Blocking.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| New port token in `PLATFORM_TOKENS`, `Symbol.for` | PASS | `tokens.ts` (`DISPLAY_WINDOW_HOST: Symbol.for('PlatformDisplayWindowHost')`) |
| Port `I*`-prefixed, `export type` | PASS | `platform-core/src/index.ts:173` |
| Port bound in every adapter | PASS (with note) | VS Code `registration.ts:134`, CLI `registration.ts:117`, Electron `bootstrap.ts` ~550 (needs the bridge) |
| Contract runner for the port | PASS | `run-display-window-host-contract.ts`, used at `display-window.spec.ts:250` |
| DI guard specs updated | PASS | both `expected-resolvable.ts`, `rpc-surface.spec.ts` in electron, vscode, cli-engine, `rpc-allowlist.spec.ts` |
| RPC method in the typed registry | PASS | `rpc.types.ts` (`RpcMethodRegistry`, `RPC_METHOD_ENTRIES`), new file `rpc-display-window.types.ts` (183 lines, split by domain) |
| Agnostic libs do not import adapters or vscode-core tokens | PASS | handler imports `PLATFORM_TOKENS` only; `vscode-core` use matches `ArtifactRpcHandlers` |
| Cross-lib imports via public barrel | PASS | `display-window.config.ts` imports from `@ptah-extension/chat`; `chat/src/index.ts` exports the three new symbols |
| Angular standalone/OnPush/signals/`inject()` | PASS | `display-window.component.ts`, `display-sheet.component.ts` |
| No untrusted `[innerHTML]` | PASS | no match in added lines |
| No `any` / `@ts-ignore` / `as unknown as` in production code | PASS | only in specs; `manifest.ts:97` `any[]` is pre-existing |
| `eslint-disable` of module boundaries | PASS | none added |
| No leftover references to deleted `display-sheet.state.ts` | FAIL | `scripts/eager-closure-gate.js:30`, `eager-closure-gate.spec.ts:131` |
| Eager-closure allowlist updated for new eager modules | FAIL | see Blocking |
| Logger not console | NOT_APPLICABLE | sibling main and chat code use `console`; consistent |
| Electron IPC trust policy | PASS | `ipc-sender-policy.ts` array of ids; `ipc-sender-policy.spec.ts` updated |

## Decisions

- Electron binds `DISPLAY_WINDOW_HOST` in `bootstrap.ts`, not in `platform-electron/registration.ts`. Options: adapter registration (cannot reach the bridge) or composition root. Evidence: token comment and the `ArtifactRpcHandlers` precedent. Reversible. Accepted.
- Treated `console` use as acceptable because it matches the siblings in each layer.

## Maintenance debt

- Introduced: a second window path (host, sync, wire, state handler, config), about 4,400 lines including specs, and duplicated review logic.
- Retired: `display-sheet.state.ts`, and the duplicated summary/artifact key helpers in the sheet.
- Net: neutral to slightly up. The extra structure is mostly well placed; the duplication and the unmaintained gate list are the real debt.

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM (the gate failure is inferred from reading, not from a build)
- Key concern: `scripts/eager-closure-gate.js` is not updated for the new eager modules and still lists the deleted `display-sheet.state.ts`.
- What a 10/10 version would do differently:
  - Update the eager-closure allowlist and its spec in the same change, and run the gate once.
  - Extract one shared review-action helper for the sheet and the sync service.
  - Keep one source for the child-window IPC allowlist.
  - Rename the sheet to match its role, or document why not.
  - Keep `chat-view.component.ts` from growing by moving the four `displayWindow*` computeds into the wiring result.
