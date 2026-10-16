# Phase E round 3 — layout lane

## Findings addressed

- **S-C / M-r1-1:** `command-center-page.component.ts:51-108,212-323` bounds the wide stage row to 420–620 px, stops the layout from growing to fill its scroll container, caps the rail to the same height, and gives the work list a focused, keyboard reachable scroll region. Under the 720 px container query, the rail returns to document flow with a 24 rem work list cap. The template order is now stage, dock, rail, so narrow Tab order follows the visible order. The host retains page scrolling.
- **M-r1-3:** `command-center-page.component.ts:217-259` places the toast at the start of the dock, adjacent to voice controls and ahead of the rail. It retains alert/status role, Retry speech, and dismissal. It no longer covers the selected card title.
- **S-D:** `command-pending-input.component.ts:118` gives the input border and placeholder important Tailwind color utilities, overriding the higher specificity light theme `.input` rule locally. The border uses 50% base content and the placeholder 80% base content in both themes. Browser contrast measurements remain for visual review.
- **S-F:** `command-center-page.component.ts:183,378-382` passes IDs whose scene layout has a `labelRect` to `command-overlay.component.ts:42,131`. The overlay hides labels without a placed rectangle, including nodes omitted from a dense layout and labels previously placed. Hidden labels retain their dimensions for scene measurement. No scene source was edited.
- **Minor badge:** `command-center-page.component.ts:149` forces the session badge to the 12 px Tailwind text size over DaisyUI's smaller badge typography.

## Specs updated

- `command-center-page.component.spec.ts:206-252` checks dock-before-rail DOM order, scroll region focusability, and toast placement by voice controls.
- `command-pending-input.component.spec.ts:94-95` checks the important local color utilities.
- `command-overlay.component.spec.ts:71-80` checks that a formerly placed plate becomes hidden when excluded.

## Verification

Scoped `ptah_get_diagnostics` found **zero errors in the six changed files**. It reported 17 errors in sibling integration/model specs and shared capability codec outside this lane's ownership. Nx, Jest, build, serve, and e2e were not run per the parallel lane instruction. Browser geometry and contrast were not measured in this lane.

## Files changed

- `libs/frontend/command-center/src/lib/components/command-center-page.component.ts`
- `libs/frontend/command-center/src/lib/components/command-center-page.component.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-pending-input.component.ts`
- `libs/frontend/command-center/src/lib/components/command-pending-input.component.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-overlay.component.ts`
- `libs/frontend/command-center/src/lib/components/command-overlay.component.spec.ts`
- This report.

## Decisions

- **Bound the wide grid row with a viewport based clamp.** Options were a fixed height or a viewport based clamp. The prototype calls for roughly 420–640 px and the page host already owns vertical scrolling; the clamp preserves a usable stage on short and tall screens. Reversible.
- **Keep the toast in the dock at all widths.** Options were duplicating responsive toast markup or placing one toast by the controls. A single location preserves its existing actions and makes it visible early in stacked flow. Reversible.
- **Use the scene's public layout signal for plate visibility.** Options were changing the scene renderer or passing placed label IDs to the overlay. The latter stays within assigned ownership and follows the scene's `labelRect` placement result. Reversible.

## Not done

- **M-r1-6:** The distant Ptah plate comes from the root label fallback in `scene-layout.ts`; no overlay-only geometry change can move it without conflicting with scene placement. This file is outside the lane scope.
- **M-r1-7:** The overflow chip's rectangular backing is drawn on the canvas by `command-scene-renderer.ts:299-302`, outside the allowed edit paths.
- The reported 3:1 border, 4.5:1 placeholder, stage viewport, and page scroll criteria await orchestrator browser measurement.
