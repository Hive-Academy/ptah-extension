# Batch FIX-3 report

## D-1 items

### Serious 1: context details inside progressbar

Moved the progressbar role and value attributes from the Context tile to its inner content wrapper in `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-session-stats.component.ts:42-62`. The details button rendered after that wrapper is now a sibling of the progressbar.

### Serious 2: LANES accessible name

Added `role="img"` to the named LANES summary span in `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-limits-lanes.component.ts:52`. The existing `aria-label` now supplies its accessible name.

### Serious 3: budget stage and percent

Both budget bars use the budget's `stage` for ink, clamp width and `aria-valuenow` to 0–100, and floor the announced true percent in `inspector-session-stats.component.ts:70-75,90-95,212-215`. Tighten/handoff use need ink; limit uses error ink; normal/unknown use gold. The announced true percent follows `budgetTooltip`'s floor rule.

### Moderate 4: duplicate cost subtotal

The known subtotal caption renders only when `costBudgetText` is absent in `inspector-session-stats.component.ts:83-89`. Lower-bound and weighted-fallback values therefore have one visible cost sentence; the detail text still carries the subtotal.

### Moderate 5: expansion key

Deferred to a named later task. The shared expansion store is keyed by session ID; preserving an open tile as a null ID becomes real requires a defined migration or stable host key for both inspector components. This is more than a few-line fix without risking state bleed between sessions.

### Moderate 6: Escape bubbles

`closeOnEscape` now prevents default and stops propagation only for an open disclosure before closing it in `inspector-session-stats.component.ts:120,151,206-211`. It covers the Models button and the shared details button, keeping focus on the button.

### Moderate 7: context value range

Context `aria-valuenow` uses the same 0–100 clamp in `inspector-session-stats.component.ts:45,212`; the visible label and `aria-valuetext` retain the true percent.

## Locators

- `apps/ptah-electron-e2e/src/showcase/canvas-orchestra.scene.ts:153-158`: `ptah-session-stats-summary` → visible canvas `ptah-session-inspector [data-testid="inspector-session-stats"]`; opens the canvas details control when closed.
- `apps/ptah-electron-e2e/src/showcase/chat-code-edit.scene.ts:120-125`: assistant-bubble `ptah-session-stats-summary` → visible canvas inspector stats; opens the canvas details control when closed.
- `apps/ptah-electron-e2e/src/specs/chat/compaction-duplicate-session.spec.ts:282-287`: tile `ptah-session-stats-summary` → inspector stats within its rail board after opening that pane's details. The compaction assertion now matches `1 compaction` at :292.
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/plan-limits/plan-limits-visual.e2e.spec.ts:117-193`: strip → visible canvas inspector stats; plan and lane tile assertions target `ptah-inspector-limits-lanes`. Removed references to strip expand/collapse and its old alert/refresh test IDs; the scenario still captures near-limit, at-limit, tiles open, and refresh-failed states.
- `inspector-session-stats.component.ts:24`: one new `data-testid="inspector-session-stats"` provides the shared locator.

## Files

- `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-session-stats.component.ts`
- `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-limits-lanes.component.ts`
- `apps/ptah-electron-e2e/src/showcase/canvas-orchestra.scene.ts`
- `apps/ptah-electron-e2e/src/showcase/chat-code-edit.scene.ts`
- `apps/ptah-electron-e2e/src/specs/chat/compaction-duplicate-session.spec.ts`
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/plan-limits/plan-limits-visual.e2e.spec.ts`
- `.ptah/specs/TASK_2026_677_efcd/reports/batch-FIX-3.md`

## Spec changes

Updated the two named existing e2e spec files. No chat-ui spec asserted the changed inspector behavior, so none was modified. No new spec was created. E2e and showcase commands were prohibited for this parallel wave.

## Diagnostics

`ptah_get_diagnostics` was called twice with the six changed TypeScript files only. Both calls reported the TypeScript compiler unavailable after 45 seconds and all six files unchecked. No Nx, Jest, build, Playwright, e2e, or showcase command was run.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use stage for budget ink; clamp numeric progress values while preserving true percent in text | Percent thresholds; stage mapping | `SessionBudgetStage` in `libs/shared/src/lib/types/session-budget.types.ts:15-16`; D-1 review Serious 3 | Yes |
| Use canvas details control and visible rail-board inspector in canvas locators | Main chat header toggle; canvas details control | `canvas-focus-header.component.ts:205-215` has `data-details` and `aria-expanded`; `canvas-rail-board.component.ts:182-250` renders inspector outside focus area | Yes |
| Defer null-session expansion migration | Pin temporary key; migrate store key on ID arrival; host-supplied stable key | `stats-tile-expansion.state.ts` keys by session ID; D-1 review Moderate 5; few-line changes do not handle session switching safely | Yes |

## Clarifications Needed

- Named later task: define and implement expansion-key migration for a tile opened while `sessionId` is null, including behavior when the component later changes to another session. Recommended: give the inspector a stable host session key, then migrate or clear entries explicitly.
- The showcase scripts still seek `[data-testid="canvas-tile"]` outside the four requested locator lines, but the current canvas source has no such test ID. Their broader scene setup needs a separate canvas showcase migration; these locator edits cannot be runtime verified under this wave's no-e2e rule.
