# Final code-logic review — chat-layout-declutter

Score: 8/10
Verdict: APPROVED
Review family: reviewer Glm/Ollama Cloud; implementers codex (batches A–D, fix round 1), Glm (batch E), Claude (fix round 2)

Scope: full read of canvas-inspector-dock.component.ts (+spec), canvas-rail-board.component.ts (+spec defer/width
regions), canvas-focus-area, canvas-focus-header, inspector-dock-width.ts, inspector-open-state.service.ts,
session-inspector.component.{ts,html} (+spec), inspector-agents-section.component.ts (+spec), session-stats-view.ts,
lane-tiles.ts, plan-limit-tiles.ts, dock-overflow.ts; targeted spec reads (stats-limit-view-model, plan-limit-tile,
session-stats-view); design-spec.md and parity-inventory.md; byte-level encoding checks; diff-wide hygiene greps.
Not run by this reviewer: tests, typecheck, build (round-2 verify evidence accepted as reported).

## Status of the 11 earlier findings

| # | Old severity | Status | Evidence |
|---|---|---|---|
| 1 | BLOCKING | Resolved | `inspector-agents-section.component.ts:471,475` prefix `'≥ '`, `:477` join `' · '`, `:478` fallback `'—'`. Byte audit: U+2014/U+00B7/U+2265 present in prod and spec; no literal `'? '` strings. Spec `:226` asserts `'—'`, `:231` accessible name, `:239` `'12.0k · ~$0.10 est.'`, `:253-257` `'≥ 12.0k'` and `'≥ 12.0k · ≥ ~$0.10 est.'` |
| 2 | MAJOR | Resolved | Dock rail binds `[limitSummary]` (`canvas-inspector-dock.component.ts:178`); rail renders `!` mark on expand (`session-inspector.component.html:16-24`) and Ctx tile (`:41-49`), state colors via `limitAwareDot` (`session-limit-summary.ts:56-62`), fullText in aria-label/title (`session-inspector.component.ts:117-129`). Header text chip "At limit"/"Limit near" kept for split/compact-sheet (`canvas-focus-header.component.ts:211-226`). Specs `session-inspector.component.spec.ts:80-144`, dock spec `:102-110` |
| 3 | MAJOR | Resolved | `lane-tiles.ts:388-397` `humanStatus` sentence map, used `:455,466`; unknown status gets the generic sentence. No raw status on the face |
| 4 | MAJOR | Resolved | `canvas-focus-header.component.ts:169-173`: running/error text chip beside `needs you`, with `state-running`/`state-error` ink — text, not colour alone |
| 5 | MINOR | Resolved | `canvas-focus-header.component.ts:262` gates the trigger on `!inspectorExpanded() || splitDisplayed()`; split keeps 3 menu items. Spec `:86` |
| 6 | MINOR | Resolved | All three `@defer` blocks now carry `@loading` with the strip (`canvas-inspector-dock.component.ts:152-164,234-246,280-292`). `inspectorExpanded` (`canvas-rail-board.component.ts:310-314`) hides the focus-area strip exactly while the dock/sheet/split owns it — one strip in every state, including chunk load. Specs: dock `:135-156`, board `:1020-1058` assert one strip in skeleton and after completion |
| 7 | MINOR | Resolved | `session-inspector.component.html:26` `@if (stats())` gates metrics/Run/Todos; only expand remains. Spec `:80-88` (one button even with needsYouCount 2) |
| 8 | MINOR | Resolved | `lane-tiles.ts:133` passes `runs.length`; `:601-602` "N of M runs" when a subgroup was skipped. Spec `:957-974` (near and at, 1 of 3) |
| 9 | MINOR | Resolved | `session-stats-view.ts:163` uses `formatCost`; `:170-174` speaks ms/m/s as words. `formatDuration` emits only ms/s/m units (`session-stats-format.ts:34-45`), so the regex covers every output. Spec `:37-53` |
| 10 | MINOR | Resolved | `plan-limit-tiles.ts:241` value `'Unavailable'` (reads "Usage Unavailable"); reason moved into `detailLines` `:245` |
| 11 | MINOR | Resolved | `INSPECTOR_TAB_WIDTH` 56 is live (`inspector-dock-width.ts:31`, dock `:315`); `occupiedWidth` `:327-329` renders 56 compact or dock width expanded, never both; `dockAvailableWidth` subtracts only the left rail (`:94-95`). Dock spec `:112-182` proves 56 subtracted once, 400 persisted, clamp, reset, Escape |

## Regression checks (extraction and round 2)

- Compact rail vs expanded dock are mutually exclusive `@if` branches (`:171/:185`); 56px never persisted — dock width clamps to >=300 (`inspector-dock-width.ts:7,85`) and open state stores only the boolean (`inspector-open-state.service.ts`).
- 360px main minimum retained (`inspector-dock-width.ts:15`); dock goes overlay below 660 available (`:206-209`), matching `inspectorMaxWidthFor` (300+360).
- Focus restore: close -> rail expand control (`:483-497`); expand holds shell then moves to close (`:527-551`); mode toggle -> lane tab (`canvas-focus-area.component.ts:152-163`); 400px threshold handoff (`:504-521`, board `:710-723`).
- Git dock untouched (not in diff); inspector Git section retained (`session-inspector.component.html:220-224`).
- Round-2 at-limit fixture now supplies exhaustion evidence the shared `classifyWindow` contract requires; the assertion text is unchanged — production was right, the test was wrong, and the fix followed the contract, not the output.
- plan-limit-tile disclosure: disabled assertion kept for the no-details case (`plan-limit-tile.component.spec.ts:199-210`); details case asserts enabled + `aria-expanded="false"` (`:181-197`).
- Board CSS regex still requires the exact selector and `overflow: clip` (`canvas-rail-board.component.ts:117-124`).
- showStats defaults true (`agent-card.component.ts:257`, `subagent-lane.component.ts:227`, `execution-header.component.ts:89`); false only at `canvas-lane-view.component.ts:194,249`.
- 1100px declared once on the focus-area host (`canvas-focus-area.component.ts:40`); nested 758px override removed; fallbacks kept (`chat-view.component.html:83`, `chat-input.component.ts:591`, `lane-column.ts:10`, `chat-transcript.component.css:67`).

## Five logic questions

1. Silent failure: stats null degrades to a rail with only the expand control; deferred loads announce `role="status" "Loading session details"`. No success-looking failure found.
2. Unexpected user action: menu trigger, sheet Tab trap and Escape paths all resolve to exactly one strip and one focus target; no double surface found.
3. Wrong input: 100% without exhaustion prints "Near limit" by shared contract; measured zero still prints `0`; unknown cost keeps `—`, never synthetic zero.
4. Dependency failure: refresh failures print human sentences (`lane-tiles.ts:388-397`); unmeasured widths allow max dock, zero width yields 0 capacity — no crash paths found.
5. Requirements gap: none found beyond the minor below.

## New findings

1. MINOR — `canvas-rail-board.component.spec.ts:2111` adds `}) as unknown as Parameters<typeof
   coordinator.touch>[0];`, the only forbidden-pattern hit in the whole diff. Scenario: none at runtime (spec-only test
   double); it breaks the stated "no `as unknown as`" rule the same way the first review's accepted spec-only cast did.
   Fix: build the event as a fully typed literal `const event: Parameters<typeof coordinator.touch>[0] = {...}` (or a
   typed factory in the spec) so the double satisfies the signature without a cast.

Checked, not defects: guarded `s.snapshot!.totalCost` (`inspector-session-stats.component.ts:85-86`, behind a null
branch, disclosed in round 2); raw reason string inside the status tile's expanded `detailLines`
(`plan-limit-tiles.ts:221,245`) — design-spec explicitly preserves the technical reason there.

## Checks that passed

- No `any`, `@ts-ignore` or `console.*` added; `libs/frontend/chat` imports nothing from `libs/frontend/canvas`.
- No U+FFFD replacement characters and no CR bytes in any changed lib file.
- Round-2 verify: chat-ui 1591/1591, chat 4706 passed, canvas 480/480, all typechecks pass; only `chat:lint` fails,
  140 errors all pre-existing on main (commit 89d2d6720 and 04fd8e12d files unchanged from main) — out of scope here.

Score rationale: all 11 findings resolved with evidence, no regression found in the extraction, tests strengthened
rather than weakened; 8 not 9-10 because one rule violation remains and runtime parity rests on the reported verify
runs, which this reviewer did not execute.