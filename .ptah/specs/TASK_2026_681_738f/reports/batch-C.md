# Batch C — canvas

## Changes

- **11 — model chip:** Removed the focused header model chip and input (`libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.ts:137,291`), removed its focus-area binding (`canvas-focus-area.component.ts:39`), and updated the focus-header and focus-area specs to expect only the branch chip (`canvas-focus-header.component.spec.ts:306,339,357`; `canvas-focus-area.component.spec.ts:34,318`).
- **12 — header actions:** Compact/full, More, and Close use `lucide-angular` icons in square ghost buttons with focus-visible outlines (`canvas-focus-header.component.ts:19,27,162-179,217-229,270-278,292-295`). Native titles and accessible labels remain; `data-compact`, `data-header-menu`, and the `ngDoCheck` focus hook remain. Updated header specs for labels, title changes, icons, and keyboard reachability (`canvas-focus-header.component.spec.ts:94-116,176-200,290-307,422-435`).
- **14 — lane navigation:** Removed Back to conversation and retained `back()` on Escape. The lane panel now has `tabindex="-1"` and receives focus after a transition from the transcript (`canvas-lane-view.component.ts:60-72,273-281,374-391`). Updated lane specs for panel focus, Escape and opener restoration, and focus retention (`canvas-lane-view.component.spec.ts:249,454-459,500-725`).
- **17 — flat lane:** Removed lane-added padding from CLI and subagent content containers, retained the permission prompts, and passed `presentation="flat"` to the CLI agent card (`canvas-lane-view.component.ts:76-113,145-170`). Background and subagent rendering paths remain intact.

## Verification

`npx jest -c libs/frontend/canvas/jest.config.ts <three changed spec paths> --coverage=false --maxWorkers=1`: **3 suites passed, 50 tests passed**. The three paths were the focus-header, focus-area, and lane-view specs.

`ptah_get_diagnostics` was called with all six changed TypeScript files. It returned unavailable twice because its TypeScript check was still running after 45 seconds; it reported no file diagnostics. The orchestrator will typecheck after batch D supplies the new `AgentCardComponent.presentation` input.

## Decisions

- Focus the existing `role="tabpanel"` element after opening a lane. Options were adding a separate focus target or using the panel. The panel already owns the lane content and label, so using it avoids a new wrapper. Reversible.
- Keep the CLI flex container and subagent content grouping. Options were removing them entirely or removing their lane-added padding. The CLI container still lays out permission prompts above the card; the subagent grouping preserves spacing between usage and transcript. Removing their padding eliminates the extra inset. Reversible.

## Proposed Removals

None.

## Not done

Scoped diagnostics did not complete. Cross-lane integration with batch D's new card input remains for the orchestrator's typecheck.
