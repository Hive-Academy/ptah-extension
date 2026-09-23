# Lane A report — TASK_2026_534, compact wire console

Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-534-resizable-lane-console-438e420c2e66`

## Tasks completed

- Upgrade the compact session wire stream (TELETYPE WIRE STREAM pane) to match the variant-4 prototype rows.
- Make the recap / wire stream split resizable and responsive via the shared `SplitHandleComponent`.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-534-resizable-lane-console-438e420c2e66\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-session-activity.component.ts` — kind-coded badges, one-line rows, expandable detail, darker feed pane with scanline overlay, resizable split driven by CSS custom properties, responsive side-by-side / stacked orientation.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-534-resizable-lane-console-438e420c2e66\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-session-activity.component.spec.ts` — 2 existing tests updated, 8 tests added (badges, path shortening, expand toggle, split clamp, reset, re-clamp, orientation switch, handle visibility).
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-534-resizable-lane-console-438e420c2e66\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-wire-text.ts` — pure `shortenRowText()` helper that cuts path-like text from the LEFT (`…/logger.ts`) and other text from the right.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-534-resizable-lane-console-438e420c2e66\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-wire-text.spec.ts` — 8 tests for the helper.

## Stack observed

- Angular 22, standalone components, OnPush, signals (`input`, `signal`, `computed`, `viewChild`, `afterRenderEffect`), inline templates and styles — from `compact-session-activity.component.ts` and sibling molecules.
- Styling: Tailwind + daisyui tokens (`text-info`, `border-secondary/30`, `oklch(...)`) — from sibling components.
- Test stack: jest-preset-angular with the ngx-markdown jest.mock pattern — from the existing spec.

## How each criterion is met

- **A1 Kind-coded badges.** `KIND_BADGE_TONE` maps tool→info, agent→secondary, prose→primary, prompt→warning, compaction→warning, terminal→error. `BADGE_CLASSES` gives each tone `border-*/30 bg-*/10 text-*` classes. The glyph (✓ ▶ ▲ ✖ ○) and the row accent class stay, so tone stays dual-coded. A mark with `tone === 'error'` always gets the error badge. Badges have `min-w-[60px]`, `justify-center`, `text-center`.
- **A2 One-line rows.** `CompactFeedRow` now carries `label`, `text` and `detail`. The detail is the primary row text. The label is the row title attribute (tooltip). When the detail is missing, the label is the row text. `shortenRowText()` (new pure helper, own spec) shortens long paths from the LEFT (`…/molecules/compact-session/logger.ts`) at `ROW_TEXT_LIMIT = 120`.
- **A3 Expandable detail.** A row with a detail toggles on click, Enter and Space (`onRowKeydown` prevents default on the handled keys). `expandedMarkId` holds one id, so only one block is expanded at a time. The block shows the full plain-text detail, wrapped (`overflow-wrap: anywhere`), with its own scroll (`max-height: 12em`, `overflow-y: auto`). The auto-follow effect skips auto-scroll while a row is expanded.
- **A4 Console styling.** The feed pane background is darker than the recap pane (`oklch(0 0 0 / 0.16)` overlay on the tile). A static scanline overlay paints on `.cs-feed-pane::before` (repeating-linear-gradient, 1px/2px, pointer-events none, z-index 2) and the content sits at z-index 3, matching the prototype. The teletype header and the blinking cursor on the live newest row are kept.
- **A5 Resizable split.** The body grid uses `--cs-recap-w` and `--cs-recap-h`. The CSS declares the defaults (`clamp(240px, 34%, 420px)` side-by-side, `fit-content(45%)` stacked). `[style.--cs-recap-w]`/`[style.--cs-recap-h]` bind a clamped pixel value, or null to remove the property and let the default apply. Side-by-side: vertical handle, recap width clamp 200 to body-width − 280. Stacked (body width ≤ 600px, same threshold as the CSS container query): horizontal handle, recap height clamp 72 to body-height − 96. Double-click emits `reset` and `onSplitReset()` clears both signals, so both defaults return. A `ResizeObserver` on the body host and the recap pane refreshes `bodySize` (guarded `typeof ResizeObserver === 'undefined'` for jsdom, disconnected via `DestroyRef`), and the clamped size is re-clamped at read time, so a shrunk tile re-clamps the stored size.
- **A6 Container-query tiers kept.** The agent-context tier (`min-height: 300px`), the filter-chips tier (`min-height: 300px`) and the terminal footer tier (`min-height: 500px`) are unchanged. `handleVisible` hides the handle when the body width is under 480 (side-by-side) or the body height is under 200 (stacked); the `.cs-no-handle` grid variant removes the middle track so the feed pane stays in place.
- **A7 Safety and style.** No `[innerHTML]` was added; markdown stays in `MarkdownBlockComponent`. No new `as any`, no `@ts-ignore`. OnPush is kept.

## Design fidelity

Prototype: `.ptah/specs/TASK_2026_512_feaa/prototypes/variant-4-wire-console.html`. Badge width, kind colors, scanline gradient and darker feed background follow the prototype values, translated to the repository's daisyui tokens. No deviations.

## States covered

Interactive: expand/collapse, keyboard (Enter, Space), resize drag, double-click reset. Responsive: side-by-side to stacked at 600px, handle hidden when there is no room. Accessibility: rows with a detail get `role="button"`, `tabindex="0"`, `aria-expanded`, `aria-controls`, and a `title` tooltip; the handle keeps its own label and keyboard support; focus-visible styling on rows.

## Verification

Command: `npx nx run-many -t test,lint,typecheck -p @ptah-extension/chat-ui --skip-nx-cache`

- **test**: passed — 34/34 suites, **280 passed, 0 failed** (includes the 2 updated and 8 new spec tests and the 8 helper tests).
- **typecheck**: passed.
- **lint**: failed with **1 error, 9 warnings — none in files this lane changed**. The error is `@angular-eslint/no-output-native` in `libs/frontend/chat-ui/src/lib/molecules/agent-card-output.component.ts:76`, a file this lane did not modify (pre-existing on the branch, outside the lane scope). The 9 warnings are pre-existing `max-lines` and unused-import warnings in other files.

## Plan deviations

None. `CompactSessionSummary` / `CompactSemanticMark` in `compact-session-summary.ts` are unchanged. `SplitHandleComponent` is imported, not modified.

## Out-of-scope observations

- Pre-existing lint error `@angular-eslint/no-output-native` at `agent-card-output.component.ts:76` (not touched).
- The worktree also holds Lane B changes (`split-handle.component.ts`, `agent-monitor-panel.component.ts`, `panel-resize.service.ts`, `agent-monitor/`, `index.ts`); this lane did not touch them.