# Follow-up overflow re-review, round 1

**Score: 6/10. Verdict: REVISE.** The zero-height calculation is fixed, but the replacement floor can put the fixed popover beyond the viewport and leave Save unreachable. This is a real boundary gap rather than a failure of the ordinary layouts.

## Prior findings

1. **Zero-height dialog — partly resolved.** `popover-height-cap.ts:15-23` returns at least 1 px, and both callers now use it (`decision-model-row.popover.ts:19-25`; `main-agent-reassign-popover.component.ts:540-544`). The resulting positive height still does not ensure the panel fits or that its footer is reachable; see finding below.
2. **Specs did not pin the boundary — partly resolved.** `popover-height-cap.spec.ts:4-30`, `decision-model-row.popover.spec.ts:17-39`, and `main-agent-reassign-popover.component.spec.ts:181-200` cover zero, negative, non-finite, 32 px, and 10 px arithmetic. They do not check the positioned panel or footer reachability. The requested rendered check belongs to the orchestrator's Electron visual pass.

## Finding

**Moderate — the 120 px floor can place Save outside a short viewport.** `popover-height-cap.ts:15-23` returns 120 px even when measured room is less than 120. The decision editor binds that cap to a fixed-position popover content box (`decision-model-row.component.ts:184-193`); its Save and footer follow the scrollable body (`:230-232,351-370`). In a 200 px viewport with the decision cell at y=60–82, the new spec expects a 120 px cap although only 86 px of content room exists below (`decision-model-row.popover.spec.ts:17-20`). With the 8 px offset and outer panel padding, the bottom of the scrollport extends about 34 px beyond the available side. Scrolling the dialog to its end cannot move its last child above the physical viewport edge. The main-agent path has the same issue (`main-agent-reassign-popover.component.ts:79-80,540-544`): at a 200 px viewport with its trigger centered, approximately 68 px of content room remains after the real frame chrome and reserve, while the helper chooses 120 px. Floating UI uses vertical `flip` but `shift` only on the cross axis for top/bottom placement (`libs/frontend/ui/src/lib/native/shared/floating-ui.service.ts:143-146`), so it cannot pull the excess vertical height into view. **Fix:** when neither trigger side has enough room for the usable floor, position a viewport-bounded scroll surface independently of the trigger, or otherwise constrain and position the complete outer panel inside the viewport. Keep a positive scrollport and verify Save is reachable at 200 px and at a 32 px boundary.

At 160 px of measured room or more, `Math.max(floor, Math.floor(room))` yields the old room result because the floor never exceeds 120 (`popover-height-cap.ts:15-23`). The prior 900/1531 px ordinary-height behavior is therefore unchanged by this helper. The 32 px and 10 px specs show finite positive numbers, but the latter cannot establish a usable visible dialog (`popover-height-cap.spec.ts:25-30`).

## Five logic questions

1. **Silent failure:** the height signal is positive while the footer can remain below the viewport (`popover-height-cap.ts:15-23`; `decision-model-row.component.ts:351-370`).
2. **User action:** opening or resizing to a roughly 200 px window with a mid-window trigger can hide Save beyond the edge (`decision-model-row.popover.spec.ts:17-20`; `main-agent-reassign-popover.component.ts:69,540-544`).
3. **Input producing a wrong result:** 86 px of actual side room maps to a 120 px cap; zero or negative room maps to the same floor (`popover-height-cap.ts:15-23`).
4. **Dependency failure:** non-finite geometry now yields the finite floor (`popover-height-cap.spec.ts:16-23`), but positioning cannot correct vertical overhang because of the middleware configuration (`floating-ui.service.ts:143-146`).
5. **Missing requirement:** there is still no explicit placement fallback when both sides of the trigger are too short for the desired minimum (`popover-height-cap.ts:4-13`).

Verification: the five changed Jest suites passed, 121 tests total. Scoped `ptah_get_diagnostics` returned unchecked coverage after a 45-second timeout. No rendered layout check was run, as requested.

## Decisions

Request revision for a viewport-bounded fallback. Accepting the overhang would leave the specifically reported short-window footer case unresolved; the 200 px arithmetic and fixed-position layout above support a fallback. This is reversible.
