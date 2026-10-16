# Code Logic Review: fix round for code-logic-review-11-17.md (S1, M1, M3, M4, M5)

Review family: implementer codex, reviewer Claude.
Scope: fix hunks only, from the uncommitted diff vs HEAD in `chat-view.component.ts/html/spec.ts` and `inspector-agents-section.component.ts/spec.ts`. Read-only. No nx, build or e2e run; the orchestrator reports chat typecheck, lint and test as PASS.

## Verdict: APPROVED

| Finding | Result |
| ------- | ------ |
| S1 | Fixed |
| M1 | Fixed |
| M3 | Fixed |
| M4 | Fixed, with a data-hiding edge case on a zero total (Minor) |
| M5 | Fixed |
| Blocking / Serious / Moderate | 0 / 0 / 0 |
| Minor | 5 |

## S1: inspector while a compact card shows (fixed)

- `chat-view.component.ts:1103-1108`: `hostsInspector` now includes `!this.showCompactCard()`. `showCompactCard` is the union of the forced and user-compact states (`:926-932`).
- The inspector block in `chat-view.component.html:~277` is gated on `hostsInspector() && shell.isOpen() && shell.tab()`. The session header, with its toggle and cue, sits inside the hidden region and is also gated on `hostsInspector()` (`html:33`).
- The shell is bound with `bindTab(() => hostsInspector() ? resolvedTabId() : null)` (`ts:983-985`). While a card shows, `shell.tab()` is null and `isOpen` is false (`inspector-shell.controller.ts:~150-157`).
- Prior open state is preserved. The controller never writes the docked choice on a tab-null transition. `setDocked` is called only from `toggle()` (`:220`) and `closeInsp()` (`:247`), and the tab-change effect calls `onTabChanged` (`:256-263`), which only clears `sheetOpen`. On return to full, `dockedOpen(tabId, 'full', ...)` returns the stored choice.
- Overlay band: a sheet that was open when Compact was pressed is closed by `onTabChanged` and stays closed on return. That matches the controller's overlay rules, where the sheet is never persisted.
- Nothing else targets a hidden element. The inspector row Answer (`focusQuestionCard`, `ts:1018`) is unreachable because the inspector is gone. The card's needs-you cue and Answer go through `openFullView()` (`compact-session-card.component.ts:154-182`). The dock and agent sidebar tab are also gated on `!showCompactCard()` (`html:311,370`).
- Spec: `chat-view.component.spec.ts` "removes the open inspector in compact mode and restores it in full mode" asserts `.cs-inspector` is present, absent, then present.

## M1: keep-alive region (fixed)

- `html:21` is `@if (!forcedCard() || !resolvedActiveTab())`.
  - User compact keeps the whole session view mounted. The wrapper div carries `[class.hidden]` and `[attr.inert]` (`html:25-29`).
  - A forced card still tears the region down. The compact card block renders for `showCompactCard()` and the session region only when not forced.
- The two blocks are siblings and cannot both be visible. The card is a flex-1 child; the hidden region is `display:none` through Tailwind `hidden`, which sorts after `flex` in the generated CSS.
- No visible duplicate of the session header, question cards or banners. The hidden copies are removed from the layout and the accessibility tree, and inert blocks `focus()` calls from stray autofocus code.
- Focus after the Compact toggle. The only callers of `toggleTabViewMode` are `tab-bar.component.ts:329`, `canvas-focus-area.component.ts:51` and `conductor-tile.component.ts:246`. All are outside the chat-view session region, so focus stays on the pressed button and cannot land in the inert region. There is no keyboard shortcut for the toggle.
- Spec for the same instance:
  - "keeps transcript and composer instances through full, compact, full" compares element identity with `toBe` across both transitions and checks the `[inert].hidden` selector.
  - The first compact test checks that the transcript and composer sit inside `[inert].hidden`.
  - The forced-card test still asserts no transcript mounts.

## M3: `expandToFullView` guard (fixed)

- `ts:2098` toggles only when `resolvedActiveTab()?.viewMode === 'compact'`.
- Both directions are asserted: compact tab gives exactly one `toggleTabViewMode('tab-abc')`; forced card on a 'full' tab gives zero calls.

## M4 and M5: inspector CLI badges (fixed)

- Tokens (`inspector-agents-section.component.ts:332-336,357-360`):
  - Precedence is numeric `totalTokens`, then `input + output` only when both are numbers.
  - The badge is suppressed when the value is not finite or is 0.
  - Specs cover total-only, in+out, input-only (absent), zero (absent) and usage absent.
- Cost (`:200,278`):
  - Rendered with `formatEstimatedCost`, which gives "~$0.25 est.", in a `badge-ghost` span titled "Reported or estimated cost".
  - `ptah-cost-badge`, the green exact-cost badge, is no longer used. The spec asserts `ptah-cost-badge` is null.
  - There is no exact-cost claim.

## Minor findings

1. `inspector-agents-section.component.ts:332-336`, spec "omits a zero token total". A reported `totalTokens: 0` beats non-zero input and output, so the badge is hidden even though real counts exist. An adapter that defaults the total to 0 loses its data, and the spec pins this. Suggested: use `total > 0 ? total : in+out`. This is a choice; the batch report documents the opposite one.
2. `inspector-agents-section.component.ts:358`. `costUsd` of 0 renders "~$0.00 est." while the tokens path suppresses 0. A non-finite value would print "~$NaN est.". Guard with `Number.isFinite` and decide on 0.
3. `chat-view.component.html:106`. `[active]` on the retained transcripts is still true while the region is `display:none`. The transcripts keep live-rendering and auto-scrolling against a zero-size box. `[active]="... && !userCompact()"` would freeze them. I did not verify the effect on scroll restore.
4. Focus on expand (from the earlier item 16, not this fix). "Full view" in the card destroys its own button (`compact-session-card.component.ts:157`) when the tab flips to full. Focus falls to `body`, and nothing moves it to the header or composer.
5. Spec coverage. The S1 spec stubs `dockedOpen: () => inspectorOpen` (constant), so it cannot show that the stored per-tab choice survives. It also does not cover the overlay or sheet band. The code path analysis above shows both are correct.

## Five logic questions (fix round only)

1. Silent failure: none new. The dead Answer target is removed because the inspector is not mounted. Hidden question cards can still match `findQuestionCard`, but the only caller is the unmounted inspector.
2. Unexpected user action: Compact then Full keeps the draft, scroll and instances (spec-proven for the transcript and composer). The focus drop after "Full view" is minor finding 4.
3. Wrong answer from data: minor findings 1 and 2.
4. Dependency failure: none introduced.
5. Missing: none beyond the minor items above.

Confidence: HIGH on S1, M1 and M3. Both were traced in the controller source as well as the specs. MEDIUM on rendering, since I did not run the app.
