# Follow-up reposition code logic review

**Score: 6/10 · Verdict: REVISE.** No blocking issues; one serious failure mode and one moderate verification gap. The explicit render-time update plausibly corrects the reported kind-switch case, but the shared service can leave a panel at stale coordinates when its newest compute fails. This is above a foundational failure: normal and overlapping successful computes are guarded. It is below a sound 7–8 because the new failure path affects every native popover and the visual regression is not pinned.

## Findings

1. **Serious — failed latest compute strands the panel at its old position.** In `libs/frontend/ui/src/lib/native/shared/floating-ui.service.ts:189-195`, a newer update increments `updateSeq` before `computePosition` settles, while `updateFn` discards its promise. If that compute rejects after an older compute succeeds, the older result is suppressed at line 192, and the rejection has no handler. The panel remains at the last applied coordinates until another resize or scroll; a kind switch near the bottom can still leave Save out of view. This also changes behavior for other popovers using this service. **Fix:** handle update failures inside the service, retain or recover a valid position when the latest compute rejects, and schedule a bounded fresh compute if the panel is still current. Test an older success followed by a newer rejection, including cleanup and reopen.

2. **Moderate — specs do not pin the reported geometry or lifecycle boundary.** The chat test only spies on `reposition()` (`libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.spec.ts:697-707`); the popover test only counts `update()` after detectChanges (`libs/frontend/ui/src/lib/native/popover/native-popover.component.spec.ts:92-102`). Neither proves that the grown panel is measured after render and moved inside the viewport, or that a scheduled callback after close has no effect. The service test mocks `autoUpdate` and hardcodes 732/404 (`libs/frontend/ui/src/lib/native/shared/floating-ui.service.spec.ts:116-146`), so it cannot catch a missed ResizeObserver callback. **Fix:** add a focused component test that changes projected content height, checks post-render coordinates and close behavior, and retain the orchestrator's rendered check for actual layout.

## Five logic questions

1. **Silent failure:** a rejected latest update leaves the old `top` style in place with no result to the caller (`floating-ui.service.ts:190-204`).
2. **User action:** switching Unset to Custom near the viewport bottom grows the editor and requires a fresh measurement (`decision-model-row.component.ts:214-234`); the opt-in call schedules one at `:218`.
3. **Wrong answer from valid input:** rapid content changes can overlap computes; the sequence guard correctly rejects an older successful coordinate when a newer successful coordinate exists (`floating-ui.service.ts:189-193`), but cannot preserve correctness when the newer one rejects.
4. **Dependency failure:** `computePosition` rejection in the update callback is unhandled because `updateFn` returns void (`floating-ui.service.ts:191-196`). Initial-position rejection still follows the existing fallback (`native-popover.component.ts:259-279`).
5. **Missing requirement:** positioning recovery after an update failure and proof of containment after content growth are unspecified and untested (`floating-ui.service.ts:189-204`; cited specs above).

## Assessment of requested points

- **Root cause:** `@floating-ui/dom` 1.8.0 `autoUpdate` defaults `elementResize` to ResizeObserver availability and observes the floating element (`node_modules/@floating-ui/dom/dist/floating-ui.dom.mjs:628-660`). A blanket claim that content growth never triggers auto-update is unsupported. Its reference-resize path briefly unobserves the floating element until the next animation frame (`:642-652`), so a missed resize is plausible; a raced stale compute is also plausible. The explicit kind-change update provides an independent correction.
- **Sequence/lifecycle:** `requestToken` blocks writes after cleanup and across reopen (`floating-ui.service.ts:151-152,187,192,207-208,230-236`); `updateSeq` blocks older successful update writes. Existing cleanup tests cover late initial and update results (`floating-ui.service.spec.ts:300-367`). Failure handling is the gap above.
- **Render timing:** `afterNextRender` uses the component injector (`native-popover.component.ts:288-291`). A close followed by cleanup makes a pending callback's `update()` a no-op (`native-popover.component.ts:297-303`; `floating-ui.service.ts:230-236`). A close and reopen before that callback can target the new panel, but still uses the live service handle; no stale panel write follows from that alone.
- **Other popovers:** normal auto-update registration and default flip/shift options remain (`floating-ui.service.ts:163-196`), but the rejected-latest path applies to every consumer.
- **Verification:** UI Jest: 44/44 passed across two changed specs. Chat Jest: 36/36 passed. Scoped `ptah_get_diagnostics` was unavailable after its 45-second TypeScript timeout. No rendered check was run in this lane.

## Decision

Treat the ResizeObserver explanation as unproven and retain the explicit post-render reposition for this specific kind switch. The installed library code and the visual report support that choice; it is reversible. Revise the shared update failure path and strengthen the behavior test before approval.
