# Code Logic Review — `TASK_2026_677_efcd` batch D-1

Review family: reviewer grok; implementer codex (+3 Claude fix lines)

| Metric | Value |
| --- | --- |
| Overall score | 5/10 |
| Assessment | REVISE |
| Blocking issues | 0 |
| Serious issues | 3 |
| Moderate issues | 4 |
| Failure modes found | 7 |

Commit `9e36b8753` (the Claude `inputTokens` / `outputTokens` fix and the lane-chip class fold are in that commit). Scope: the twelve files in that diff, read whole, plus direct types they branch on (`StatsLimitIndicator`, `SessionBudgetState`, `modelUsageList`, `session-budget-format.ts`, `session-stats-format.ts`, `planSectionProvenance` / `sharedLaneCaption`). No `code-style-review.md` in the task folder. No nx, jest, or `ptah_get_diagnostics`: ptah tools are not connected in this lane, and the batch forbids those checks.

The score is 5 rather than 3–4 because the pure contracts hold: `sessionLimitSummary` worst-wins with session-then-lane tie break, `confirmed-room` / `unknown` are not candidates, null VM is `'none'`, `limitAwareDot` matches the four-step precedence, `sessionContextCue` copies the strip's known-window predicate, unknown context is `'—'` / `null` rather than `0`, and the strip's token, context, agent, duration, and population strings delegate without a markup edit. It is not 7–8 because three new surfaces give a wrong or unreachable result on inputs the design names (a details button inside `progressbar`, a lanes name that never becomes the accessible name, a budget bar that ignores `SessionBudgetStage`).

## Five logic questions

### 1. How does this fail silently?

The Context details button is inside `role="progressbar"` (`inspector-session-stats.component.ts:41` through the `#detail` outlet at `:61`). The control is in the DOM and looks right; many accessible-name calculations treat the progressbar's descendants as presentational, so the button is not operated as "Context details".

The LANES meta sets `aria-label` on a generic `span` (`inspector-limits-lanes.component.ts:52`). ARIA 1.2 does not name generic elements. The same codebase already records that at `session-stats-summary.component.html:123-126` and uses `role="img"` there. Here the label `lanesAriaLabelFor` ("N lane runs, not in session totals") is dropped and the visible "1 lane · 2 runs" is announced instead. No error.

`sessionId ?? ''` (`inspector-session-stats.component.ts:201`, and `:91-92` on the limits component) stores expansion under `''`. When a later snapshot supplies a real id, `isOpen` reads a different key and the open tile closes with no signal that state was discarded.

### 2. What user action produces unexpected behaviour?

Escape on an open details button (`inspector-session-stats.component.ts:149`) calls `close`, which only `setOpen(..., false)` (`:203`). The event is not stopped. An ancestor that closes the inspector on Escape still runs, so focus does not stay on the button. Design D3.3 requires Escape to close the region and keep focus on that button.

Activating a lane "see plan tile" chip calls `openPlanTile` (`inspector-limits-lanes.component.ts:97-108`). That path does focus the plan tile's inner `button` when `data-tile-id` matches (`plan-limit-tile.component.ts:43` and `:47`). It does nothing when the id is absent from `planTiles` (early return at `:98`). That silent return is correct for a stale id. It cannot focus a `disabled` button (`plan-limit-tile.component.ts:51` disables `status` and `local-usage`). Window tiles stay enabled, so the D3.5 chip path works for windows.

### 3. What input data produces a wrong answer?

Budget bar. `SessionBudgetStage` is `unknown | normal | tighten | handoff | limit` (`session-budget.types.ts:15-16`). The stage machine, not a percent constant, is the warn/limit state (`session-budget.types.ts:4-7`). `budgetInk` (`inspector-session-stats.component.ts:204`) paints gold below 80, need from 80, err from 100, and the fill width is the raw percent (`:74`, `:92`) with no clamp and no `overflow-hidden`.

- Input: `measure: 'tokens'`, `percent: 55`, `stage: 'tighten'` (default tighten is 50). Output: a gold bar. The session is already in the warn stage that lowers auto-compact (`budgetTooltip` text at `session-budget-format.ts:86`). Expected: need ink.
- Input: `percent: 70`, `stage: 'limit'` because `handoffAfterCompactions` fired (`session-budget.types.ts:112`). Output: gold (70 < 80). Expected: err, over the limit.
- Input: `percent: 140`. Output: `aria-valuenow` 140 with `aria-valuemax` 100, and a fill wider than the track. The plan-limit bar clamps (`plan-limit-tile.component.ts:203-207`). These bars do not.
- Input: `percent: 79.6`. `aria-valuenow` is `Math.round` → 80 (`:72`). `budgetTooltip` uses `Math.floor` → 79 (`session-budget-format.ts:86`). The bar announces the need threshold while `budgetInk` still paints gold.

Context over the window. `sessionContextCue` accepts any finite `contextPercent` (`session-stats-view.ts:41-54`). The ring clamps to 0–100 (`context-ring.component.ts:28`). The tile label prints the raw percent (`inspector-session-stats.component.ts:51`) and `aria-valuenow` is `Math.round` of the raw value (`:44`) against max 100. Input: known window, `contextPercent: 132`. Output: label `132%`, valuenow 132, arc drawn as 100% in err ink.

Cost tile under a lower bound. `costBudgetText` replaces the badge for `cost-lower-bound` and `weighted-fallback` (`session-budget-format.ts:50-60`). The strip shows that string **instead of** the badge, the `/ $limit` suffix, and the known-subtotal chip (`session-stats-summary.component.html:97-119`). The inspector shows the replacement as the value (`inspector-session-stats.component.ts:83`) and then, because `costBudgetSuffix` is null unless `measure === 'cost'`, still renders `known subtotal …` (`:86-87`). Input: `measure: 'cost-lower-bound'`, `used: 1.5`, `limit: 30`, `totalCost: null`, `pricingCoverage: 'partial'`, `knownCost: 1.5`. Output: value `≥ $1.50 / $30 (some models have no price)` plus caption `known subtotal $1.50`. The strip shows only the `≥` line. Design D3.3 treats `costBudgetText()` as the "with a cost budget" branch, which is the caption path, not an extra subtotal line.

`modelUsageList` rows: `inputTokens` / `outputTokens` / optional `cacheRead` / `cacheCreation` / `costUSD: number | null` (`rpc-session.types.ts:380-388`). The template reads those fields (`inspector-session-stats.component.ts:133-136`). `formatCost(null)` is `'—'` (`session-stats-format.ts:7-9`), so an unpriced model is not `$0.00`. That mapping is right.

### 4. What happens when a dependency fails?

`limits.refreshNotice` is the first line of PLAN LIMITS and is the only `role="status"` (`inspector-limits-lanes.component.ts:23-25`). A failed refresh with held tiles still renders the tiles. A null `limits` input is not handled inside the component; the plan says the host omits the section. `ModelStateService` is injected for display names (`inspector-session-stats.component.ts:164`). If `availableModels()` is empty, `resolveModelDisplayName` still runs; this review did not re-read that function, so a missing catalog falling back to the raw id is unverified. No new timer, subscription, or fire-and-forget call was added. `focusHeading` (`inspector-limits-lanes.component.ts:93-96`) no-ops when the heading is absent (section omitted). The Plan limits / Lanes button only emits (`inspector-session-stats.component.ts:35`); moving focus is the host's job (B-4), and `focusHeading` is public for that.

### 5. What is missing that the requirements never mentioned?

`StatsTileExpansionState` is `inject(..., { optional: true }) ?? new StatsTileExpansionState()` in both new sections (`inspector-session-stats.component.ts:165`, `inspector-limits-lanes.component.ts:79`). If the host does not provide one instance, the two sections keep separate stores. Tile ids differ (`sd-*` vs VM ids), so they do not clobber each other. They also will not survive together if a parent later expects one store. The plan allows the optional inject. Not a defect until B-4 mounts both without a shared provider; worth a host check, not a D-1 fail.

New token and cost bars have no 400 ms `--ptah-ease-soft` transition (design D3.8). The ring does (`context-ring.component.ts:20-21`). Values still update in place. Recorded as a gap, not a wrong figure.

## Failure modes

### Context details button sits inside the progressbar

- Trigger: context window is known, so the Context tile has `role="progressbar"`, and the user tabs to Context details.
- Symptom: the button is inside the progressbar. Accessible-name and role resolution for that button is unreliable; the design puts `progressbar` on the ring/value, and says the tile must not be the button because a button's children are presentational (`design-spec.md` D3.3).
- Evidence: `inspector-session-stats.component.ts:41-61` (role and the `#detail` outlet are the same div); button at `:147-151`.
- Current handling: none. The ring host is `aria-hidden` (`context-ring.component.ts:6`), so the wrapper role is the only progressbar.
- Recommendation: move `role` and the `aria-value*` attributes onto an inner element that contains the ring and the percent, and leave the details button as a sibling outside that role.

### LANES meta name is ignored

- Trigger: any LANES section render. Screen reader reads the meta.
- Symptom: announced text is "{n} lane(s) · {runs} runs". The required name "{runs} lane run(s), not in session totals" is on an `aria-label` the platform drops.
- Evidence: `inspector-limits-lanes.component.ts:52-54`. Contrast `session-stats-summary.component.html:123-131` (`role="img"` plus the same label). `lanesAriaLabelFor` itself is correct (`session-stats-view.ts:121-123`).
- Current handling: attribute is set and has no effect.
- Recommendation: put `role="img"` on that span (same ruling as the strip pill), or put the runs sentence in text that is visually hidden inside a named element.

### Budget bar colour, width, and announced percent ignore the stage machine

- Trigger: a token or cost budget whose `stage` is `tighten` or `limit` while `percent` is under 80, or any `percent` above 100, or a fractional percent.
- Symptom: gold bar during tighten; gold bar during compaction-driven `limit`; fill spills past the track; announced integer disagrees with `budgetTooltip`'s `Math.floor`.
- Evidence: `inspector-session-stats.component.ts:70-75`, `:88-93`, `:204`. Stage union `session-budget.types.ts:15-16`. Floor at `session-budget-format.ts:86`. Clamp precedent `plan-limit-tile.component.ts:203-207`.
- Current handling: hardcoded 80 / 100 and a raw CSS width.
- Recommendation: ink from `stage` (`tighten` and `handoff` → need, `limit` → err, `normal` / `unknown` → gold). Clamp the fill to 0–100. Announce `Math.floor(percent)` so the bar matches the tooltip.

### Lower-bound cost also prints a known subtotal

- Trigger: `budget.measure` is `cost-lower-bound` or `weighted-fallback` and `knownSubtotalOf(snapshot)` is non-null.
- Symptom: the replacement sentence and `known subtotal $…` both show. The strip shows only the replacement.
- Evidence: `inspector-session-stats.component.ts:83-87`. Strip branch `session-stats-summary.component.html:97-119`. `knownSubtotalOf` `session-stats-view.ts:107-110`.
- Current handling: `@else if (knownSubtotal())` runs whenever `costBudgetSuffix` is null, which it is for both fallbacks.
- Recommendation: when `costBudgetText(budget)` is non-null, do not also render the known-subtotal caption (the details disclosure still carries `KNOWN_SUBTOTAL_DETAILS` via `costDetailsText`).

### Open tile closes when sessionId arrives

- Trigger: user opens Tokens (or a plan tile) while `sessionId` is null; the next inputs carry a real id.
- Symptom: the disclosure renders closed. Design D3.3 / D5: a snapshot push must not collapse an open tile.
- Evidence: `inspector-session-stats.component.ts:201-203`; `inspector-limits-lanes.component.ts:91-92`.
- Current handling: null is stored as `''`, so the id change is a different key.
- Recommendation: keep the last non-null id used for expansion until the component is destroyed, or key by a host-supplied stable id. Do not write `''` for null.

### Escape closes the region and still bubbles

- Trigger: focus is on an open details button and the user presses Escape while an ancestor listens for Escape.
- Symptom: the region closes and the ancestor acts (typically dismissing the inspector), so focus does not remain on the button.
- Evidence: `inspector-session-stats.component.ts:149` and `:203`. Models disclosure (`:116-118`) has no Escape handler at all; D3.3 names the details buttons, so Models is the smaller gap.
- Current handling: `setOpen(false)` only.
- Recommendation: on Escape, `preventDefault` and `stopPropagation` when the tile is open, then close it. Handle the Models button the same way.

### Context percent outside 0–100

- Trigger: known window with `contextPercent` 132 (used tokens above the verified window).
- Symptom: label `132%`, `aria-valuenow` 132, `aria-valuemax` 100, arc drawn as a full circle.
- Evidence: `session-stats-view.ts:52-54` (percent stored raw); `context-ring.component.ts:28` (clamped); `inspector-session-stats.component.ts:43-46` and `:51`.
- Current handling: only the arc is clamped.
- Recommendation: clamp `aria-valuenow` to 0–100. Keep the true percent in the visible label and `aria-valuetext`.

## Blocking issues

None.

## Serious issues

### 1. Context details control is inside `role="progressbar"`

- Severity: Serious
- File: `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-session-stats.component.ts:41`
- Scenario: known context (`context.known === true`, `percent: 15.3`) → the tile div is a progressbar and the Context details button (`:147`) is rendered inside it by the outlet at `:61`. A screen-reader user looking for the disclosure gets progressbar semantics instead of a button, or cannot reach the button as its own control.
- Suggested fix: put the progressbar role, `aria-valuemin/max/now`, `aria-labelledby`, and `aria-valuetext` on a non-interactive inner wrapper around the ring and the percent. Keep the `info` button outside that wrapper.

### 2. LANES `aria-label` is on a generic span, so it is not the name

- Severity: Serious
- File: `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-limits-lanes.component.ts:52`
- Scenario: `laneTiles.length === 1`, `lanesCount === 2` → visible text "1 lane · 2 runs". `lanesAriaLabelFor(2)` is "2 lane runs, not in session totals" and is set as `aria-label` on a `span` with no role. The accessible name stays the visible text. The "not in session totals" cue is missing unless `sharedLaneCaption` happens to be shown below.
- Suggested fix: `role="img"` on that span, matching `session-stats-summary.component.html:127-130`.

### 3. Budget bar does not follow `SessionBudgetStage`

- Severity: Serious
- File: `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-session-stats.component.ts:204` (ink), `:74` and `:92` (width and `aria-valuenow`)
- Scenario: `{ measure: 'tokens', percent: 55, stage: 'tighten', limit: 50_000_000 }` → gold fill and a 55% width. The budget is already in `tighten`. A second input `{ percent: 70, stage: 'limit' }` is also gold because 70 < 80. `{ percent: 140, stage: 'limit' }` sets `aria-valuenow` to 140 and a 140% width.
- Suggested fix: map ink from `stage`; clamp the fill and `aria-valuenow` to 0–100; use `Math.floor(percent)` in `aria-valuetext` / `aria-valuenow` so they match `budgetTooltip`.

## Moderate issues

### 4. Known-subtotal caption appears under `costBudgetText`

- Severity: Moderate
- File: `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-session-stats.component.ts:83`
- Scenario: `cost-lower-bound` budget with `used: 1.5`, `limit: 30`, and a partial snapshot whose `knownCost` is 1.5 and `totalCost` is null → value `≥ $1.50 / $30 (some models have no price)` and caption `known subtotal $1.50`. The strip (`session-stats-summary.component.html:97`) shows only the `≥` string.
- Suggested fix: skip the known-subtotal caption when `costBudgetText(budget)` is non-null.

### 5. Null `sessionId` is an expansion key that changes under the user

- Severity: Moderate
- File: `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-session-stats.component.ts:201`
- Scenario: open `sd-tokens` while `stats.sessionId` is null (stored as `''`), then the same component receives `sessionId: 'sess-1'` on the next snapshot → `isOpen('sd-tokens')` is false and the region closes.
- Suggested fix: do not substitute `''`. Pin expansion to the first non-null session id for the lifetime of the component, and use the same rule in `inspector-limits-lanes.component.ts:91`.

### 6. Escape on a details button does not stay on the button

- Severity: Moderate
- File: `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-session-stats.component.ts:149`
- Scenario: Tokens details is open and focused; user presses Escape; an ancestor overlay also handles Escape → the region closes and the ancestor dismisses, so focus leaves the button.
- Suggested fix: when the key is open, `preventDefault()` and `stopPropagation()` before `close(key)`.

### 7. Known context above 100% is an out-of-range progressbar

- Severity: Moderate
- File: `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-session-stats.component.ts:44` and `libs/frontend/chat-ui/src/lib/atoms/context-ring.component.ts:28`
- Scenario: `sessionContextCue` returns `known: true`, `percent: 132`, `label: '132%'` → `aria-valuenow` 132 with max 100, while the arc is clamped to a full circle.
- Suggested fix: clamp `aria-valuenow` to 0–100; leave `132%` in the label and `aria-valuetext`.

## What was checked and is not a defect

- `sessionLimitSummary` (`session-limit-summary.ts:12-44`): indicator states are only `'at-limit' | 'near-limit'` (`stats-limit-view-model.types.ts:125-126`), so the non-at → near branch does not promote `confirmed-room`. Lane `confirmed-room` and `unknown` hit `break`. Ordering is all `at` then all `near`, stable, session pushed first. `extra` counts every other near/at candidate. `fullText` is `` `${text} (+${extra} more)` `` when `extra > 0`. Null VM → `state: 'none'`.
- `inspectorToggleDescription` (`session-limit-summary.ts:46-52`): omits context when `!hasLive`, uses `Context unknown.` when live but unknown, rounds the percent, appends `fullText` and `{n} need you.` only when `needsYou > 0`, joins with one space.
- `limitAwareDot` (`session-limit-summary.ts:54-60`): open → null; base `'need'` wins; then `'at'` → `'err'`; then `'near'` → `'need'`; else base. Null summary does not change the base.
- Strip delegation: `hasKnownContextWindow`, `contextPercentLabel`, `agentCount`, `durationMs`, `knownSubtotal`, and `lanesAriaLabel` call the pure helpers with the same predicates that were inlined. `contextTooltip` passes `compactions = 0`, so the new compaction sentence is not added to the strip. `tokenTooltip` matches the old estimate-plus-breakdown path because `tokenDetailsText` keys the estimate off `provisional`, and `isEstimate` is `provisional === true` (`session-stats-summary.component.ts:256`). `costTooltip` (`:259-265`) strips `KNOWN_SUBTOTAL_DETAILS` back off so the chip title stays the budget line; the subtotal chip still uses `knownSubtotalTooltip`.
- `backgroundAgentPopulation` is the previous `summaryText` body; the strip computed calls it (`background-agent-strip.component.ts` delegation).
- Default `variant === 'strip'` face classes are the previous strings (`plan-limit-tile.component.ts:189-191`, `lane-subtotal-tile.component.ts:57-59`). `linkPlanTiles` default false keeps the chip as a `span` (`lane-usage-tile.component.ts:162-171`).
- Time is omitted when `durationMsOf` is null (0 or absent). Agents are omitted when the count is 0. Time spans two columns when agents are absent (`inspector-session-stats.component.ts:97-105`). Turns caption renders only when `turns()` is non-null, including 0 (`:101`), which matches D-O4.
- Context ring: no ring when `percent === null` (`:48`); ink gold under 80, need from 80, err from 95 (`context-ring.component.ts:32-33`); host `aria-hidden`; 400 ms transition cancelled under reduced motion.
- PLAN LIMITS omitted when there are no plan tiles and no refresh notice; LANES omitted when there are no lane tiles and no subtotal (`inspector-limits-lanes.component.ts:20`, `:48`). Provenance uses `Gauge` and adds no provider field. `StatsLimitViewModel` and `PlanSectionProvenance` have no provider id.
- Barrel append matches the D3-7 names; `LiveModelStats` is not re-exported (`index.ts` tail of the commit).
- Per-model `title`s and the Models show/hide `title`s are the strings D3.3 says to keep. Tile detail text is not in a `title`.

Residual uncertainty: Angular template typecheck and the unchanged specs were not run (forbidden in this lane, and the executor report says the same). `resolveModelDisplayName` behaviour when `availableModels()` is empty was not re-read. Whether B-4's overlay actually listens for Escape is outside this diff; finding 6 is the missing `stopPropagation` against the D3.3 requirement, not a trace of that host.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Indicator `state !== 'at-limit'` mapped to `'near'` is correct, not a finding | Treat any other indicator state as a bug / accept the type | `StatsLimitIndicator.state` is only `'at-limit' \| 'near-limit'` (`stats-limit-view-model.types.ts:125-126`) | Yes |
| `Gauge` with no provider mark meets D-O3 | Require `ProviderMarkComponent` / flag as missing | `planSectionProvenance` returns caption and source chips only (`stats-limit-sections.ts:17-25`); `StatsLimitViewModel` has no provider id (`stats-limit-view-model.types.ts:215-227`) | Yes |
| Header caption may be absent when lane captions differ | Always render `LANE_CAPTION` | Plan D3-5 names `sharedLaneCaption`, which returns null when captions differ (`stats-limit-sections.ts:74-85`) | Yes |
| Strip `costTooltip` post-strip of `KNOWN_SUBTOTAL_DETAILS` is preservation, not a logic bug | Call it a double-format bug | Old tooltip was `costTooltip(budget)` plus the estimate line only; the known-subtotal sentence lived on a separate chip title (`session-stats-summary.component.ts:259-265`) | Yes |
| `turns() === 0` showing "0 turns" is in spec | Hide 0 | D-O4: caption when the input is non-null (`inspector-session-stats.component.ts:101`) | Yes |
