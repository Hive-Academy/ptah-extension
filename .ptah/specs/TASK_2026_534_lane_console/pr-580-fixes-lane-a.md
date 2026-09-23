# Lane A — PR #580 review/CI fixes

Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-534-resizable-lane-console-438e420c2e66`
Base: commit `8029c5849` plus the uncommitted changes below. Scope kept: `libs/frontend/chat-ui/src/lib/molecules/compact-session/**` only. No git operations. No new `as any`, no `@ts-ignore`, OnPush kept.

## Fix 1 — CI failure: banned `text-base-content/70` token

**What changed**

- `compact-session-activity.component.ts:656` — the expanded row detail block now uses the approved token `text-base-content-muted` instead of `text-base-content/70`. I chose `muted` as instructed; it matches the tone the surrounding pane already uses for secondary text (feed header, timestamps, empty state), so the multi-line detail reads as secondary to the row line without dropping to full contrast.
- A folder-wide search for `text-base-content/` in `compact-session/**` found no other occurrence — this was the only offender.
- No exception was added to the ratchet spec.

**Verification**

- `npx jest -c apps/ptah-extension-webview/jest.config.ts apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts` — **passed: 11/11 tests, 1 suite**.

## Fix 2 — CodeRabbit: auto-scroll stayed off after the expanded row left the feed

**What changed**

- `compact-session-activity.component.ts:776` — new public computed `activeExpandedMarkId`: returns `expandedMarkId()` only when the current `feedRows()` still contains a row with that mark id and a non-null detail, else `null`. It derives the active expansion from the rendered rows, so both a filter change and a `summary().marks` change unlatch it.
- `compact-session-activity.component.ts:918` — the auto-scroll effect now guards on `activeExpandedMarkId()`, so a row that left the feed no longer blocks follow-to-bottom for new marks.
- `compact-session-activity.component.ts:623` and `:653` — the template `aria-expanded` binding and the expanded-block `@if` also use `activeExpandedMarkId()`, so a stale id cannot report or render an expansion that is not on screen.
- `compact-session-activity.component.ts:969` — **choice made: `setFilter()` also clears `expandedMarkId`.** A filter switch is a navigation action, so the expansion does not survive it. Consequence: switching back to `all` does not re-open the previously expanded row (the review's preferred "does not unexpectedly re-open" behaviour). The derived id remains the safety net for the path `setFilter` cannot cover — the summary marks changing while a row is expanded.

**Specs added** (`compact-session-activity.component.spec.ts`)

- `:647` — "stops holding auto-follow when the expanded row leaves the rendered feed": expands a row, then replaces the mark set; asserts `expandedMarkId()` stays stale while `activeExpandedMarkId()` becomes null and no `.cs-row-detail` element remains. (jsdom reports `scrollHeight` 0, so the auto-scroll itself is not observable in a unit test; the test pins the guard input the effect reads.)
- `:679` — "collapses the expanded row on a filter switch and does not re-open it on return": expands a non-error row, selects the ERR filter (row hidden), asserts `expandedMarkId`/`activeExpandedMarkId` are null and no detail block renders, then switches back to ALL and asserts the block does not re-open and the row's `aria-expanded` reads `'false'`.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-534-resizable-lane-console-438e420c2e66\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-session-activity.component.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-534-resizable-lane-console-438e420c2e66\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-session-activity.component.spec.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-534-resizable-lane-console-438e420c2e66\.ptah\specs\TASK_2026_534_lane_console\pr-580-fixes-lane-a.md` (this report)

## Verification

- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/chat-ui --skip-nx-cache`:
  - **test**: passed — 34/34 suites, **284 passed, 0 failed** (was 282; +2 new specs).
  - **typecheck**: passed.
  - **lint**: failed with **1 error, 9 warnings — the known pre-existing set** (`@angular-eslint/no-output-native` at `agent-card-output.component.ts:76`, plus `max-lines` and unused-import warnings in other molecules). None of them are in files this lane touched.
- Ratchet spec (`no-alpha-base-content.spec.ts`): **passed, 11/11**.
- `npx prettier --write` run on both changed files; `prettier --check` clean.

Nothing was left undone.