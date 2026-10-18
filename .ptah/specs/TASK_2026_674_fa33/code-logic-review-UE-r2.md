# Code Logic Review r2 (batches U1, U2, E fix round) - TASK_2026_674_fa33

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking / Serious | 0 / 0 |
| Moderate (new) | 0 |
| Minor (new) | 3 |

Read-only review of the uncommitted diff (no nx, jest, build or test run). Specs were read, not executed.
Prior review: `code-logic-review-UE.md` (5.5/10, S1 + M1-M4 + m1-m3).

## Per-finding status

| Finding | Resolved | Evidence |
| --- | --- | --- |
| S1 grid-track shift from `display:none` status row | YES | The `[&_[data-zone=status]]:hidden` class is gone. `ptah-compact-session-activity` now has only `class="min-h-0 flex-1"` (`compact-session-card.component.ts:175-176`). The activity component is untouched in this diff, so its `grid-rows-[auto_1fr_auto]` and `.cs-board` tracks keep all items and the body never collapses. The empty-state branch (`:166-173`) still renders `summary().status.text`. Spec `compact-session-card.component.spec.ts` (new "omits repeated title..." test) asserts `[data-zone="status"]` text `Done`, the class string, the recap text and `2 needs you`. |
| M1 host signal coupling | ACCEPTED (per decision) | Comment at `compact-session-card.component.ts:214-215` names the single binder (`canvas-detail-transcript.component.ts:29`) and the planned `SESSION_EMBED_CHROME` switch. The token is a plain boolean from `SessionEmbed` (`session-embed.component.ts:88-91`), so `=== true` at `:216` is correct. Follow-up stays open after PR #736. |
| M2 information lost | YES | Status row kept (fine status words, workspace label). The "N needs you" count is kept: the header row renders when `!canvasHost \|\| needsYouCount() > 0` (`:151`), and only the title (`:155`) and Full view (`:161`) are behind `@if (!canvasHost)`. In Canvas with count 0 no header row is rendered, so no empty bordered strip. |
| M3 card stays open after A to B sweep | YES | `canvas-lane-tabs.component.ts:346` now `queueCardClose(this.cardKey() ?? key)`. Trace: card A open, leave A (close timer for A queued), enter B (`:333` `clearCardTimer()` cancels it, open timer for B), leave B inside 220 ms (`:343-346` clears the open timer, queues the close for `cardKey()` = A). `closeCardIfIdle(A)` (`:413`) finds `cardHovered` false, `tabHoveredKey` null and no focus-visible, so it closes. Tab to own card: leave tab queues the close for A, card `pointerenter` calls `onCardHovered(true)` (`:360-363`), which sets `cardHovered` and clears the timer, so the card stays. Both cases have specs (`canvas-lane-tabs.component.spec.ts` new tests at the end: tab to card to leave, and the two-tab sweep). If B is held longer than 220 ms the card switches to B and B's leave closes B. No leak: the one timer slot is always cleared before a new one is set, and `closeCard` clears it. |
| M4 e2e cleanup only reaches rendered panes | YES | See e2e section. |
| m1 strip button size | ACCEPTED | `btn-xs` is 24 px high, which meets WCAG 2.5.8; visual check is the visual reviewer's. |
| m2 static `aria-expanded` | YES | `canvas-rail-board.component.ts:231` is now `[attr.aria-expanded]="detailsOpen()"` (always `false` in this `@else` branch of `@if (detailsOpen())` at `:203`, and the spec asserts `'false'`). |
| m3 template indentation | NO (style only) | `compact-session-card.component.ts:151-165` still unindented. Route to code-style-reviewer. |

## E: stale-session cleanup selectors

All selectors exist:
- `aside[aria-label="Sessions"]`: `canvas-rail.component.ts:80`.
- `li[ptah-canvas-rail-card]`: selector `canvas-rail-card.component.ts:42`, rendered for every ordered tile in the `@for` at `canvas-rail.component.ts:204-209`, so all sessions are reached, not only focused panes.
- `ptah-compact-rail-card span[title]`: `compact-rail-card.component.ts:233` (`[title]="shownTitle()"`).
- Click focuses the session: host `(click)` to `onClick` to `openSession()` (`canvas-rail-card.component.ts:307-316`, `:295-297`). `position {x:10,y:40}` is the left edge of the card, clear of the actions cell checked at `:309-312`.
- `[data-testid="canvas-tile"]`: `canvas-rail-board.component.ts:162`. `ptah-canvas-focus-header strong[title]`: `canvas-focus-header.component.ts:123-127`. `Close session` button: `canvas-focus-header.component.ts:271-276`, wired to `close(id)` (`canvas-rail-board.component.ts:182,838`), which only removes that tile (no confirm dialog in this path).

Bounded: loops stop at 9 (`canvas-orchestra`, `chat-code-edit`) and 20 (`lane-console-review`). Non-destructive: each pass matches only `agent-\d+`, `code-edit` or `lane-review` titles (the scenes' own artifacts; `TILE_LABEL` is `'code-edit'`, `chat-code-edit.scene.ts:44`). The `chat-code-edit` scene leaves `TILE_LABEL` in use (`:246`), so no unused const. `sessions.shot.ts` now counts `canvas-tile` instead of the removed `.grid-stack-item`.

## New findings

- Minor, `canvas-orchestra.scene.ts:123`, `chat-code-edit.scene.ts:214`, `lane-console-review.scene.ts:110,115-118`: `if (!(await staleCard.count())) return;` also returns when the rail is in the 56 px collapsed state, where `ptah-compact-rail-card` is not rendered (collapsed branch, `canvas-rail-card.component.ts:117-135`). Stale sessions then stay and, in `lane-console-review`, the final "Stale ... remain" guard passes vacuously. Acceptable for scenes that run at the expanded rail width; note in the scene comment or expand the rail first.
- Minor, `lane-console-review.scene.ts:113`: `director.click(...Close session)` has no visibility guard (the other two scenes guard with `visible(close)`). A failure to render the focus header throws on the click timeout rather than skipping. This fails loudly, which is acceptable.
- Minor (style, not logic): the three scene edits have long unformatted lines (prettier would reflow them), and the card spec's `Object.defineProperty(pointer(...), 'pointerType', ...)` is verbose. Route to code-style-reviewer.

No `any` or type casts, no `class` plus `[class]` conflict on one element (`canvas-rail-board.component.ts:228` has a static `class` only), no new timers or listeners without disposal.

## Residual uncertainty

Layout (S1) cannot be proven in jsdom; it holds by construction (the status row is no longer removed from the grid) and needs the visual re-check at zero and one lane on the Canvas compact card. The e2e flows were not run.

## Verdict

APPROVED, 8/10, confidence HIGH on S1/M2/M3 and MEDIUM on the e2e flow at runtime (selectors verified in source, not executed). Remaining items: m3 indentation (style) and the optional collapsed-rail note in the scenes.
