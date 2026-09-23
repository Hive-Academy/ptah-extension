# Lane A revision 1 — TASK_2026_534, compact wire console

Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-534-resizable-lane-console-438e420c2e66`

Scope kept: `libs/frontend/chat-ui/src/lib/molecules/compact-session/**` only. No git operations. No new `as any`, no `@ts-ignore`, OnPush kept.

## Defect 1 — Path shortening never fired in practice

**What changed**

- `compact-wire-text.ts:15` — new `shortenPathToken()`: any whitespace-delimited token with >= 3 path segments (`/` or `\`) becomes `…` + separator + its last 2 segments. A token that starts like `scheme://` (URL) is left untouched (`URL_PATTERN`, line 9).
- `compact-wire-text.ts:23` — `shortenRowText()` now splits on whitespace (captured separators), shortens every path token independently of the total length, and applies the length cap afterwards (right cut with `…`). The leading verb survives because the whole text is no longer split on `/`.
- `compact-session-activity.component.ts:765` — the row tooltip now carries the full un-shortened line: `title = label — detail` (label only when no detail).
- `compact-session-activity.component.ts:629` — template binds `[attr.title]="row.title"`.
- `ROW_TEXT_LIMIT` stays 120 (`compact-session-activity.component.ts:93`); it is now only an overflow cap, not the path-shortening trigger.
- `CompactFeedRow` gained the `title` field (`compact-session-activity.component.ts:38`).

**Spec updates**

- `compact-wire-text.spec.ts` rewritten: verb kept with a deep path (`Reading …/lib/logger.ts`), deep path shortened even under the budget, Windows backslash path, 2-segment path untouched, URL untouched, several path tokens shortened independently, right cut on overflow, cap applied after path shortening, non-positive budget.
- `compact-session-activity.component.spec.ts` — the detail/title test now expects `title === 'Bash failed — Exit code 1: 3 test suites failed'`; the path test now expects `row.text === 'Reading …/lib/logger.ts'` and `row.title` to contain the full path.

## Defect 2 — Stacked body without a handle rendered two columns

**What changed**

- `compact-session-activity.component.ts:283` — inside the `@container (max-width: 600px)` block, the `.cs-body.cs-no-handle` rule now also sets `grid-template-columns: 1fr`, so it overrides the base two-column `.cs-body.cs-no-handle` rule (line 157) at the same specificity but later cascade position. A stacked body with width <= 600 and height < 200 now renders one column.

**Verification**

- `compact-session-activity.component.spec.ts:590` — structural check: reads the component source (the repo's established `readFileSync`-in-spec pattern, e.g. `app-shell.notification-center.spec.ts`), slices the last `@container (max-width: 600px)` block and its `.cs-body.cs-no-handle` rule, and asserts the rule contains `grid-template-columns: 1fr`. The test fails without the CSS fix.
- A def-based check was tried first (reading `ɵcmp.styles`) and rejected: the compiled def in this Jest setup carries an empty `styles` array and jsdom injects no style elements, so no runtime surface exposes the CSS.

## Defect 3 — Handle start size was 24px smaller than the rendered track

**What changed**

- `compact-session-activity.component.ts:929` — the ResizeObserver callback now measures the recap pane's border box: `entry.borderBoxSize[0].inlineSize/blockSize`, falling back to `entry.target.getBoundingClientRect()` when `borderBoxSize` is empty. The body host still uses `contentRect` (it has no padding). `paneSize` therefore matches the grid track, so the handle no longer jumps 24px (the pane's `p-3` padding) on the first drag.

**Verification**

- jsdom defines no `ResizeObserver`, so the callback cannot run in unit tests (the component guards this). Verified by typecheck plus reading the code path; the callback only feeds `paneSize`, whose consumers are covered by the existing handle-size tests.

## Defect 4 — Trailing newline and prettier width

**What changed**

- Ran `npx prettier --write` on all four changed files. The `imports: [...]` list is wrapped (`compact-session-activity.component.ts:135`), the trailing newline is restored, and all four files pass `npx prettier --check`.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-534-resizable-lane-console-438e420c2e66\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-wire-text.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-534-resizable-lane-console-438e420c2e66\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-wire-text.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-534-resizable-lane-console-438e420c2e66\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-session-activity.component.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-534-resizable-lane-console-438e420c2e66\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-session-activity.component.spec.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-534-resizable-lane-console-438e420c2e66\.ptah\specs\TASK_2026_534_lane_console\lane-a-revision-1.md` (this report)

## Verification

Command: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/chat-ui --skip-nx-cache`

- **test**: passed — 34/34 suites, **282 passed, 0 failed**.
- **typecheck**: passed.
- **lint**: failed with **1 error, 9 warnings — all pre-existing and outside this lane's scope**: the error is `@angular-eslint/no-output-native` at `agent-card-output.component.ts:76` (file not modified by this lane); the warnings are `max-lines` and unused-import findings in other molecules.
- **prettier --check**: all four changed files clean.

Nothing was left undone.