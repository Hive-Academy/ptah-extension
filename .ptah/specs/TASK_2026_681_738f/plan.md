# TASK_2026_681_738f — plan (Partial depth, BUGFIX)

Base: `main` @ 851846797 (PR #734 merged). Worktree `.claude-worktrees/clean-session-followups`,
branch `fix/clean-session-followups`. Locations below were re-checked on `main`.

## Batches (file-disjoint, codex lanes, run in parallel)

### A1 — chat logic (items 1, 2, 3, 9)

| # | Fix | Files |
| --- | --- | --- |
| 1 | Key the held task result and the in-flight/stale guard by normalized workspace root + task ID (or a request generation). Regression spec: same task ID, new workspace root → old result is not shown and `openDocument` uses the new task's folder. | `libs/frontend/chat/src/lib/components/organisms/session-inspector/session-task-reader.ts` (+ spec) |
| 2 | Answer for an unmounted question card: resolve the request to its message, bring that message into the transcript render window, focus the card after mount; keep the miss state when no message matches. Regression spec. | `chat-view.component.ts:1010-1040`, `organisms/transcript/chat-transcript.component.{ts,html}` (render window) (+ specs) |
| 3 | `SESSION_WORKFLOW_ADDONS` entry: replace `component: Type<unknown>` with a precise component type (the inputs contract the host binds). | `libs/frontend/chat/src/lib/tokens/session-workflow-addons.token.ts` and its providers |
| 9 | `@defer` the turn activity panel so it leaves the initial bundle. | `organisms/message-bubble.component.ts`, `molecules/turn/turn-activity-panel.component.ts` |

### A2 — inspector polish (items 4, 5, 10)

| # | Fix | Files |
| --- | --- | --- |
| 4 | Null-session expansion key: give the inspector stats a stable host key; when a tile opened under a null session ID gets a real ID, migrate the entry; on a switch to another session, clear it. No state bleed between sessions. | `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/stats-tile-expansion.state.ts`, `inspector-stats/inspector-session-stats.component.ts`, `inspector-limits-lanes.component.ts`, `session-stats-summary.component.ts` (+ specs) |
| 5 | Set `title` = full branch name on the git branch span (sheet has no other hint). | `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-git-section.component.ts:59` |
| 10 | `--sel` is never defined: remove it from the fallback chain (`var(--ptah-gold, oklch(var(--s)))`). `--ptah-gold` is theme-aware (`apps/ptah-extension-webview/src/styles.css:41`). | `libs/frontend/chat/src/lib/components/molecules/session-header/session-header.component.ts:104` |

### B — canvas (items 6, 7, 8)

| # | Fix | Files |
| --- | --- | --- |
| 6 | `closedDetailsDescription` passes `0` to `inspectorToggleDescription`. Pass the focused session's real needs-you count (same source the chat transcript uses). Regression spec. | `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:332-338` (+ spec) |
| 7 | `onSheetKeydown` queries `ptah-session-inspector [role="dialog"]` inside the wrapper; scope the trap to the sheet's own element (`event.currentTarget` / the `[data-compact-sheet]` element of this board). Regression spec: a second dialog inside the sheet does not capture the trap. | `canvas-rail-board.component.ts:735-750` (+ spec) |
| 8 | Add `data-testid="canvas-tile"` to the per-session tile element that the showcase scenes count (`apps/ptah-electron-e2e/src/showcase/canvas-orchestra.scene.ts:121,206`). | canvas tile component |

## Verify

1. Orchestrator: `npx nx run-many -t typecheck,test,lint -p chat chat-ui canvas --parallel=1`, one run.
2. Item 9: ONE webview production build after the user is told; before = 3.62 MB (TASK_2026_677
   decisions row 107). Lower `maximumError` only if the size drops.
3. Code review: Claude `code-logic-reviewer` subagent (implementer family codex).
4. Screenshots for items 5, 6, 10: visual-reviewer, dark + light, 1440 / 760 / 400 px.

## Scope extension: items 11-17 (user, 2026-10-16, decisions rows 15-16)

Mapping: Explore subagent report (summarized in decisions rows 15-16). Base: 75ce4a6d1.

### C — canvas (items 11, 12, 14, 17 canvas side), codex
- 11: remove the model chip `canvas-focus-header.component.ts:137-145` (+ its `model` input wiring in `canvas-focus-area.component.ts:39` if unused). Specs `canvas-focus-header.component.spec.ts:296-309,399,412-424`.
- 12: Compact (`:170-190`) -> lucide `Minimize2`/`Maximize2`; `...` (`:228-240`) -> `Ellipsis`; Close (`:281-292`) -> `X`. Icon-only buttons, native `title` + `aria-label` (repo convention, no tooltip directive). Keep the titles "Switch to compact view"/"Switch to full view" (showcase selectors) and `data-compact`, `data-header-menu`, the ngDoCheck focus hook (`:351-361`).
- 14: remove Back to conversation (`canvas-lane-view.component.ts:70-72`, `back()` stays for Escape `:386-392`); lane-open auto-focus (`:274-283`) targets the lane panel instead. Specs `canvas-lane-view.component.spec.ts`.
- 17: canvas-lane-view (`:76-115,145-172`) renders the lane without extra wrappers, using the `flat` presentation from batch D.

### D — chat agent card + inspector agents (items 15, 17 chat side), codex
- 17: `agent-card.component.ts`, `agent-card-header.component.ts`, `cli-agent-output.component.ts`: add a flat presentation input (default = today's card, so `agent-monitor-panel` is unchanged). Flat: no card frame/border/background, no name badge, no expand chevron (always expanded), no up/down stats bar in cli-agent-output (the usage row stays), CLI session id moves into the Task details; spacing/typography of the main transcript.
- 15: `inspector-agents-section.component.ts:145-187`: the activity line skips usage segments (`isUsageSegment`, `stats-bar.utils.ts:53`) in `session-agent-roster.ts:70-79`; show small stat badges (tokens, cost, duration) from `usageTotals` with chat-ui atoms/formatters.

### E — compact view + inspector Model row (items 13, 16), codex
- 16: `chat-view.component.ts:922-929` `showCompactCard` also true when the tab's `viewMode` is `compact`; update the doc comment; align `compact-session-card.component.ts` with the 677 clean session view (current tokens, status words, no duplicate model line, no empty sections); `expandToFull` returns to full.
- 13: `chat-ui/.../inspector-session-stats.component.ts:113-116`: label/value structure with padding, value bold like the stat tiles (`:63-112`), keep the multi-model button.

### Verify
Scoped checks for chat, chat-ui, canvas (one run). Claude code-logic review. Before (dist at 75ce4a6d1) / after screenshots dark + light, 1440/760/400.
