# Fix round 2 — chat layout declutter

Status: all tests and typechecks pass in chat-ui, chat and canvas. Lint passes in chat-ui and canvas.
`@ptah-extension/chat:lint` still fails, but all 140 errors come from code that is already on `main`.
The branch did not introduce any of them (see Lint).

## Test failures

| Failure | Root cause | Fix | Test or production |
| --- | --- | --- | --- |
| `stats-limit-view-model.spec.ts` "counts unknown runs alongside a at-limit warning": got `Near limit · 1 of 3 runs (sonnet)` | Bad fixture. The test built "at-limit" from `percent: 100` alone. `classifyWindow` (`libs/shared/src/lib/utils/plan-limits/window-state.ts:203-232`) returns `limit-reached` only when the window has active exhaustion evidence. Otherwise 100% is `near-limit`, as designed. So production was right to print "Near limit" for that input. | `stats-limit-view-model.spec.ts:956-967`: the at-limit case now carries `exhaustion` (`error-derived`, the same shape as the `weeklyOpusExhausted` fixture). The assertion still expects exactly `At limit · 1 of 3 runs (sonnet)`. | Test. The assertion is unchanged; only the fixture now models a real at-limit state. |
| `plan-limit-tile.component.spec.ts:185` "status row ... without a bar or disclosure": expected a disabled trigger | Stale test. In round 1, `expandable` (`plan-limit-tile.component.ts:355-359`) became true for a `status` tile that has `detailLines`. That follows design-spec.md:125 and parity-inventory.md:46/72: the face shows "Unavailable" once, and "Account not resolved" plus its reason move into the disclosure. Round 1 updated the inspector-variant suite (`status without details`) but not this row-variant test. Its fixture also still used the removed `resetLine: 'owner not resolved'` face text. | `plan-limit-tile.component.spec.ts:163-212`: added a `statusRow(detailLines)` fixture in the production shape (see `unavailableTile`, `plan-limit-tiles.ts:229-247`). (a) With details: face reads exactly `Unavailable`, title holds the detail lines, no `owner not resolved` or `unknown account`, no progressbar, button enabled with `aria-expanded="false"`. (b) With no details: button disabled and `aria-expanded` absent. The disabled assertion is kept for (b). | Test. Production matches the spec. |
| `canvas-inspector-dock.component.spec.ts:144` (dock and sheet): no `ptah-canvas-lane-tabs` in the skeleton | A real production bug behind review finding 6. Each `@defer (when X)` sits inside `@if (X)`, so the trigger is already true when the block is created. Angular's `ɵɵdeferWhen` then calls `triggerDeferBlock` and goes straight to `DeferBlockState.Loading`. It never shows `@placeholder`. There was no `@loading` block, so nothing rendered while the inspector chunk downloaded. During that window, zero avatar strips were on screen. In the test's `DeferBlockBehavior.Manual` mode, nothing renders until a state is forced. | `canvas-inspector-dock.component.ts:152, 234, 280`: `@placeholder` is now `@loading` in the split, dock and sheet defer blocks. The skeleton, with its single `laneStrip` outlet, now shows during the actual load. Comment updated at :214. The spec (`:135-157`) now forces `DeferBlockState.Loading`, asserts exactly one strip inside `[data-inspector-skeleton]`, then completes and asserts exactly one strip inside the inspector. | Both. Production fix, plus a test that models the state Angular really uses. |
| `canvas-rail-board.component.spec.ts` "binds the pane entrance only when a split is displayed": CSS regex | The test reads the source text. Prettier had reformatted the style to a multi-line rule with single quotes (`canvas-rail-board.component.ts:121-123`). The `overflow: clip` declaration and its `:has(> .rail-pane-enter)` selector are unchanged. | `canvas-rail-board.component.spec.ts:727`: the regex accepts either quote style and any whitespace. It still requires that exact selector and `overflow: clip`. | Test (formatting only). |
| `canvas-rail-board.component.spec.ts:1024` "expands the compact rail ... projects one selector": 0 strips before completion | Same cause as the dock row: there was no `@loading` block. The test also never entered a load state in Manual mode. | Spec helper `renderDeferBlocks(fixture, state)` (`:284-297`); `completeDeferBlocks` now delegates to it. After the expand click, the test forces Loading and asserts one strip inside the skeleton and one strip overall (`:1027-1038`). The completed-state assertions are unchanged. The pre-existing focus test (`:1158`) forced `DeferBlockState.Placeholder`, which can no longer occur at runtime. It now forces Loading, with the same skeleton and focus assertions. | Test, following the production fix. |

## Lint (`@ptah-extension/chat:lint`): pre-existing on main, not introduced

- 138 of the 140 errors are `@nx/enforce-module-boundaries` "Static imports of lazy-loaded libraries are forbidden" for `@ptah-extension/shared`. Every report names the same two lazy loaders: `libs/frontend/chat/src/lib/services/artifact.store.ts:57` and `artifact-message-handler.service.ts:13`. Both call `await import('@ptah-extension/shared/mcp-apps-contracts')`. They came from main commit `89d2d6720` ("keep artifact schemas out of the eager webview bundle"), which is an ancestor of `main`. Both files are identical to `main` (`git diff main` is empty).
  - The rule therefore flags every static `@ptah-extension/shared` import in the chat lib. That includes `inspector-agents-section.component.ts:32` (the same `resolveModelDisplayName` import exists on main at :25) and `session-task-reader.ts:18` (file unchanged from main).
  - The branch neither adds nor moves a dynamic import.
- The other 2 errors are also in files unchanged from main:
  - `services/attention-context.util.ts:1:184` (no-useless-escape)
  - `services/chat-attention-source.service.ts:27:30` (no-control-regex)
  - Both were last touched on main by `04fd8e12d`.
- Error count was 140 in both round 1 and round 2. Nothing was suppressed, and nothing outside the branch's changed files was edited.

## Audit of round-1 parallel-lane edits

- No duplicated or contradictory logic found.
- `plan-limit-tile.component.ts`: `expandable` treats a status tile as expandable only when it has details. Both the row and the inspector templates guard `resetLine` with `@if`. This is consistent with `unavailableTile`, which moves the owner reason into `detailLines`.
- `inspector-session-stats.component.ts` and `agent-lane-stats.component.ts`: both take empty-value text from the single `STATS_EMPTY` in `session-stats-view.ts`, so there is no second copy. The removed Agents tile matches the declutter spec.
  - One residual style note: `s.snapshot!.totalCost` at the cost branch is a non-null assertion behind a null check. It is not in the forbidden list. It was left as is.
- `canvas-lane-tabs.component.ts`: two `[class]`/`class` bindings were merged into one concatenated `[class]` (the round-1 lint fix). No behaviour change.

## Verification

Command (worktree root, foreground, run once):
`node D:/projects/ptah-extension/scripts/verify.mjs -p @ptah-extension/chat-ui,@ptah-extension/chat,@ptah-extension/canvas -- --output-style=static`

- Header: "Running targets lint, test, typecheck for 3 projects".
- Exit 1. The lock was held for 140.5 s. The only failed task was `@ptah-extension/chat:lint` (the pre-existing errors above).

| Project | Test | Typecheck | Lint |
| --- | --- | --- | --- |
| chat-ui | Pass: 86/86 suites, 1591/1591 tests | Pass | Pass (0 errors, 12 warnings) |
| chat | Pass: 274/274 suites, 4706 passed, 2 skipped (cache hit, no chat source changed this round) | Pass (cache hit) | Fail: 140 errors, all pre-existing on main |
| canvas | Pass: 23/23 suites, 480/480 tests | Pass | Pass (0 errors, 79 warnings) |

No build, serve, e2e, or git operations were run.

## Decisions

- Use `@loading` rather than `@defer (on immediate)` or a loaded flag. This is the smallest change that keeps exactly one strip mounted for the whole time the inspector is not loaded. `@placeholder` was dead, because the `when` trigger is true at creation. Easy to reverse.
- Treat a 100%-used window without exhaustion evidence as near-limit, which is what the shared `classifyWindow` contract says. The test now supplies exhaustion evidence; the shared util was not changed.
