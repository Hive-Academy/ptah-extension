# Batch U1 — chat UI leftovers

## L1 — lane usage contrast

- Changed `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-lane-usage-summary.component.ts:31-56`: all seven 10 px usage labels now use `text-base-content-muted`. Their labels and `title` text preserve the input, output, cache, cost, context and duration meaning.
- Before: visual review measured the light page at RGB (250,247,245): output 1.74:1, cost/dash 2.32:1, input 3.44:1; dark labels 5.1–8.5:1. After: the theme's muted token is 6.03:1 on light `base-100` and 6.06:1 on dark `base-100`; its minimum across `base-100`, `base-200`, and `base-300` is 5.01:1 in each theme. The page background is close to the light `base-100`, so this meets the 4.5:1 requirement there as well. These values come from `apps/ptah-extension-webview/tailwind.config.js:14-31,104-110,182-188` and the per-theme token design in `apps/ptah-extension-webview/src/styles.css:159-188`. Full-opacity info, accent and warning do not consistently meet the light-theme threshold; the neutral token is the established 10–11 px metadata color in the agent card and inspector.
- Spec: `cli-lane-usage-summary.component.spec.ts:47-52` asserts every rendered label uses the measured token and no 70% hue class remains.

## L2 — Canvas compact card chrome

- Changed `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:151-174,212`: the Canvas host omits the card title, `needs you` status, `Full view` button, empty-state status word, and the activity status row (including its `DONE` pill). Outside Canvas the card keeps its current header and status. The Canvas focus header's Compact/Full toggle remains the way to open the full view.
- Existing host signal: `RAIL_TRANSCRIPT_RETENTION` is supplied by `SessionEmbedComponent.childInjector` from its `retainRailTranscript` input. `CanvasDetailTranscriptComponent:29` is the only production binding of that input and sets it to `true`; the card injects the token. No Canvas file was changed.
- Specs: `compact-session-card.component.spec.ts:211-235` covers the Canvas activity and empty states. Existing compact-card assertions cover the non-Canvas title, status and expansion action.

## L5 — inspector partial badge

- Changed `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.ts:197`: the partial token badge now announces `at least 12.0k tokens` for the visible `≥ 12.0k tokens` example.
- Spec: `inspector-agents-section.component.spec.ts:75-81,94` checks null totals with zero segments produce no token badge, cost badge or partial marker, and checks the exact formatted accessible label for segment usage.

## Verification

- `npx jest -c libs/frontend/chat/jest.config.ts <three changed spec paths> --coverage=false --maxWorkers=1`: **3 suites passed, 62 tests passed**. One initial assertion expected the word `Waiting` to disappear entirely; the card legitimately retains `Waiting for activity` in its body. The assertion was narrowed to the status element and the rerun passed.
- `ptah_get_diagnostics` was called after edits, including after the spec correction. It returned `typescript-compiler — Unavailable` because the scoped TypeScript check was still running after 45 seconds; six files remained unchecked. No Nx target or build was run.

## Decisions

- **Use neutral muted ink for all usage labels.** Options: keep hue tokens without opacity, or use the measured neutral token. Evidence: the light hue values and previous measured failures; `--bcm` has a documented ≥5.01:1 floor on the relevant theme surfaces. Reversible: yes.
- **Use the existing rail-retention host token to identify Canvas.** Options: introduce a card input and thread it through chat-view, or read the already-provided token. Evidence: Canvas is the sole production opt-in to retained rail transcript and supplies the token through the session embed. Reversible: yes.

## Open

- Scoped TypeScript diagnostics were unavailable during this run; Jest passed, but a completed diagnostics result was not obtained.

## Fix round 1

- `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:151-181`: Canvas now omits only the repeated title and Full view button with `@if`; the header keeps the `N needs you` count when present. The activity status row stays in the grid without a hiding class, preserving its layout and detailed status. The empty card keeps its status word (including Waiting, Compacting, Limit reached, or Stopped when applicable). Outside Canvas, the card header and action remain unchanged.
- `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:214-216`: documented that Canvas alone currently binds `retainRailTranscript`, and that this signal should be replaced with `SESSION_EMBED_CHROME` once the embed supplies it. No embed or Canvas files were changed.
- `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.spec.ts:211-239`: Canvas checks no title or Full view button, visible status row and recap, retained `2 needs you` count, and retained empty-state status word. Existing non-Canvas assertions at lines 939-978 still check title, status, count, Full view action, and Waiting.
- Jest: `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/molecules/compact-session --coverage=false --maxWorkers=1` � **2 suites passed, 57 tests passed**. The first run had one overly broad assertion that matched the component's existing `overflow-hidden` class; narrowed to the removed status-row hiding class, then reran successfully.
