# Session budget banner

The tighten notice above the composer is now a compact card: stage icon, title, a DaisyUI progress meter colored by stage, a stat row, short copy with `/compact` as inline code, and outline/primary buttons. Handoff and limit use the same card. Rotation keeps its own actions and uses the info tone.

## What changed

`libs/frontend/chat/src/lib/components/molecules/notifications/session-budget-banner.component.ts`

- Card shell, icon, role and live region: lines 104–122. `role="alert"` on limit, `role="status"` otherwise. `aria-live` is `assertive` on limit and `polite` otherwise. Icons: Gauge (tighten), ArrowRightLeft (handoff), OctagonAlert (limit), RefreshCw (rotation), from `lucide-angular`.
- Meter: lines 127–140 and 446–458. Native `<progress class="progress">`. Tighten is `progress-warning`, handoff and limit are `progress-error`, rotation is `progress-info`. The bar clamps to 0–100; over-limit copy stays in `aria-label` (for example `100.2% of session budget, over the limit`). Hidden when `percent` is null.
- Stats: lines 142–176 and 426–444. Used, Budget, Percent, Compactions. Cost measures (`cost`, `cost-lower-bound`) label the first cell Cost and format USD, with a `≥` prefix when `lowerBound` is true. `weighted-fallback` is labeled `Used (est.)`. Token figures use the existing `14.1M` / `950.0k` scale.
- Copy: lines 168–184 and 489–501. `/compact` is split out and rendered in `<code>`. The used/limit sentence moved into the stat row. Window, handoff, pause and transcript sentences are unchanged in meaning.
- Actions: lines 220–296. Tighten: Dismiss (emits `dismiss`), plus Restore auto-compact when the window was applied. Handoff and limit: New session (emits `continueInNewSession`; accessible name stays "Start new session from handoff" or "Continue in new session"), Preview handoff, then Dismiss (handoff) or Allow 20% more (limit). Rotation: Rotate session and Keep this session, unchanged. Every button is `type="button"` with a visible focus ring.

`session-budget-banner.component.spec.ts` expectations follow the new labels, stat test ids, meter classes and shorter body text. 32 tests passed.

## Data used

From `SessionBudgetState` (`libs/shared/src/lib/types/session-budget.types.ts` lines 110–137), which the banner already receives:

- `used`, `limit`, `percent`, `lowerBound`, `measure`, `unit` for the meter and the used/budget/percent cells
- `compactions` for the compactions cell
- `window`, `handoff`, `blocked`, `rotation`, `contextTokens` (input) for the explanatory lines and existing actions

No usage series. `SessionBudgetState` has no history, samples or points, and a search of session-budget and session-stats types found none. The card shows the meter only. No sparkline and no invented points.

## Sibling notifications

The notifications folder next to this component has `auth-required-banner`, `resume-notification-banner` and `voice-provider-error-toast`. None of them is a compaction notice.

`ptah-compaction-notification` lives in `libs/frontend/chat-ui` and is an in-progress alert (spinning icon, "Optimizing Context", indeterminate bar). It has no budget state. It was left as it is.

## Verification

- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/molecules/notifications/session-budget-banner.component.spec.ts --coverage=false --maxWorkers=2 --no-watchman` — PASS, 32 tests, 1 suite.
- `npx eslint` on the component and the spec — exit 0.
- `ptah_get_diagnostics` is not registered in this session (`search_tool` returned no ptah server).
- No browser pass. The banner renders inside the VS Code webview; Jest covered roles, meter, stats, copy and button outputs.

## Decisions

- No Compact button. `SessionBudgetAction` is only `dismiss | extend | restore-window | write-handoff | preview-handoff`. The parent wires those outputs and does not run `/compact`. The hint stays inline code in the copy.
- New session is shown only on handoff and limit, where `continueInNewSession` already starts a handoff session. Tighten still tells the user to start a fresh session in the copy. Wiring that button to `continueInNewSession` on tighten would write a handoff and send it, which is a different action.
- Rotation is not a budget stage. It keeps the info tone, RefreshCw, and the Rotate / Keep labels. Keep is the rotation-keep store, not `dismiss`.
- Dismiss replaces OK (tighten) and Keep working (handoff). Both still emit `dismiss`. Handoff's accessible name is "Dismiss and keep working".
- Amount text left the paragraph so the stat row is the figure. Tests assert the figures on `session-budget-used`, `session-budget-limit`, `session-budget-percent` and `session-budget-compactions`.

## Not done

- Sparkline. No series in the store or on the budget state.
- Compact action button. No existing action to call.
- Visual check in a running webview.
- `ptah-compaction-notification` restyle. Different component, no budget data.
- `ptah_agent_report` was not registered, so this file is the handoff.
