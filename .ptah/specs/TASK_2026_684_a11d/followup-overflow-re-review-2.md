# Follow-up overflow re-review, round 2

**Score: 8/10. Verdict: APPROVED.** The previous short-window overhang is addressed in the code. The score is below 9 because the tests verify cap arithmetic and option propagation, while the orchestrator's rendered check is still needed to verify scrolling and reachability. No material logic finding remains in this diff.

## Prior findings

1. **120 px floor could put Save beyond the viewport — resolved for usable viewport heights.** Both dialogs opt in to `keepInViewport` (`decision-model-row.component.ts:147`; `main-agent-reassign-popover.component.ts:72`). The service orders `offset`, `flip`, then `shift` with `crossAxis: true` for the opt-in (`floating-ui.service.ts:152-164`), so the vertical placement can move away from the trigger. There is no `size` middleware after `shift`. The installed Floating UI implementation clamps both placement and alignment axes when `crossAxis` is true. The decision cap allows viewport height minus 32 px (`decision-model-row.popover.ts:7-10,22-30`): 16 px outer panel padding and 8 px at each edge. Main Agent measures its outer frame chrome and allows viewport height minus that chrome and 16 px (`main-agent-reassign-popover.component.ts:536-546`). Thus a 120 px floor fits within a 200 px viewport, and shift can bring the entire panel on screen. The fixed Save follows each dialog's scrollable body (`decision-model-row.component.ts:230-232,351-370`; `main-agent-reassign-popover.component.ts:95,194-208`).
2. **Boundary behavior not pinned — resolved at unit level.** `popover-height-cap.spec.ts:4-30` covers floor, fit, zero, negative and non-finite values. `decision-model-row.popover.spec.ts:17-38` and `main-agent-reassign-popover.component.spec.ts:160-210` cover short viewports; the component specs check the opt-in, and `floating-ui.service.spec.ts:147-166` checks default and opt-in middleware options. These tests do not measure rendered footer reachability; that remains the orchestrator's visual check.

## New findings

None. For valid cell and viewport geometry, room of at least 160 px cannot exceed either component's fit limit, so the ordinary-height cap is unchanged (`decision-model-row.popover.ts:7-10,27-30`; `main-agent-reassign-popover.component.ts:542-546`; `popover-height-cap.ts:18-25`). Other popovers retain the previous options: `keepInViewport` defaults false, the spread adds no property, and the service passes the original `shift({ boundary, padding })` shape (`native-popover.component.ts:155-160,257-265`; `floating-ui.service.ts:155-164`).

The positive 1 px fallback necessarily exceeds a zero or negative fit limit (`popover-height-cap.ts:18-25`). In a viewport at or below the panel chrome plus edge margins, no positive scrollport can fit those margins; the 32 px and 10 px specs cover this arithmetic limit. This is an impossible physical layout, not a regression in the reported short-window range.

## Five logic questions

1. **Silent failure:** a positioning timeout still shows the panel at its static location (`native-popover.component.ts:219-235`); this pre-existing fallback is outside the changed height and middleware path.
2. **User action:** opening either dialog in a 200 px window now gives a bounded cap and opt-in vertical shift (`decision-model-row.popover.spec.ts:17-20`; `main-agent-reassign-popover.component.ts:72,536-546`).
3. **Wrong-answer input:** negative or non-finite room selects the bounded floor for finite fit; non-finite fit cannot provide a viewport guarantee (`popover-height-cap.ts:18-25`).
4. **Dependency failure:** if Floating UI positioning fails or times out, the existing static fallback applies (`native-popover.component.ts:219-235,255-277`); no new failure handling was added.
5. **Missing requirement:** rendered scrollbar count and Save reachability at 900 px and 1531 px widths still need the orchestrator's visual check; unit specs assert classes and arithmetic rather than geometry (`decision-model-row.component.spec.ts:702-715`; `main-agent-reassign-popover.component.spec.ts:160-210`).

Verification: UI Jest 21/21 and chat Jest 122/122 passed, scoped to the changed specs. Scoped `ptah_get_diagnostics` remained unavailable after its 45-second timeout. No browser or Electron run.

## Decisions

Approve the bounded, opt-in shift. Requiring a positive scrollport and 8 px edges in a viewport shorter than their combined chrome is geometrically impossible; treating that as a separate product requirement would need a minimum supported viewport height. This decision is reversible.
