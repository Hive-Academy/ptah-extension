# Batch 1D — Command Center page bindings

## Files changed

- `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts:64` — exposed the existing `commandCenterClock()` signal as `public readonly now`; no additional clock was created.
- `libs/frontend/command-center/src/lib/components/command-center-page.component.ts:249,297,411` — bound that controller signal to the start view, overlay, and work list `[now]` inputs.
- `libs/frontend/command-center/src/lib/components/command-center-page.component.ts:412-413,486-490` — bound both work-list overflow inputs to a scene-layout computed value, defaulting each count to zero when the scene is absent. The scene view query uses its existing `#scene` template reference so the page spec can exercise the layout signal.
- `libs/frontend/command-center/src/lib/components/command-center-page.component.spec.ts:216,230,248` — added tests for the clock on all three child components, scene overflow updates, and zero counts after the scene disappears. The scene stub now supplies layout and scene methods (`:22-29`) needed by the view query.

## Verification

- Scoped Jest: **Test Suites: 2 passed, 2 total; Tests: 98 passed, 98 total.** Jest also printed a worker force-exit warning after the passing result.
- Scoped `ptah_get_diagnostics`: no diagnostics in the three changed TypeScript files. It reported 29 errors in sibling specs outside this batch's ownership.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Reuse the controller clock directly | The controller already owns `commandCenterClock()` at line 64; all three child inputs accept numbers. Adding a second clock would duplicate the timer. | Yes |
| Query the scene by its template reference | The page template already names `#scene` at line 283. The existing type-only view query did not resolve the replacement scene stub in page tests; the reference resolves the live component and stub alike. | Yes |
| Default overflow to zero when the scene is absent | The scene layout exposes numeric `overflowCompleted` and `overflowOther` values, while list-only mode keeps the work list mounted after the scene is removed. | Yes |
