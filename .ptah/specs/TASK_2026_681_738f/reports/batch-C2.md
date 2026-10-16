# Batch C2 — canvas visual fix

## Changes

- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts:76,146`: added one `px-3 pt-2` inset to each CLI and subagent lane wrapper.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.ts:20,164,196,211,220,272,295`: switched icon button focus outlines to `base-content` and replaced the details glyph with a `PanelRight` lucide icon; retained toggle labels and bindings.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts:86`: added the dock's bottom shadow, stacking order, and chip-to-shadow gap.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.spec.ts:71-80` and `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.spec.ts:165-168`: asserted the details icon, focus color, and dock shadow classes.

## Verification

- `npx jest -c libs/frontend/canvas/jest.config.ts libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.spec.ts libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.spec.ts --coverage=false --maxWorkers=1`: 2 suites passed, 32 tests passed.
- `ptah_get_diagnostics` scoped to the five changed files: zero errors in requested files. Seven sibling errors remain in `orchestra-canvas.rail.spec.ts`, `mock-rpc-service.ts`, and `capability-id-codec.ts`; those files are outside this batch.

## Decisions

- Used `oklch(var(--bc)/0.35)` for the shadow. Options were the `--bc` form and `--color-base-content`; existing frontend source uses `--bc`, while the alternative search returned no hits. Reversible by changing one class.
- Applied the lane inset to the two named wrappers once each, preserving child row spacing. Reversible by changing the two wrapper classes.
