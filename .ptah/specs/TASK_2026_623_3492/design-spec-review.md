# Design Spec Review — TASK_2026_623_3492

Author: ui-ux-designer subagent  
Reviewer: codex lane  
Revision: 3  
Round: 2

## Verdict

REVISE

## Round 0 defects

| # | Status | Evidence |
| --- | --- | --- |
| 1 | Fixed | `design-spec.md:136-167` specifies Files status, rename, binary/null counts, actions, reconciliation, paging/action errors, and per-run Tests outcome, command and failure details. |
| 2 | Fixed | `design-spec.md:179-199` specifies Bash, Read, Write and Edit, including copy/open actions, retention/expand controls, language and replacement metadata. |
| 3 | Fixed | `design-spec.md:77,203-235` makes accordions closed initially and provides inert, Escape, focus-return and keyboard assertions. |
| 4 | Fixed | `design-spec.md:112-115` requires wrapped, fully available subtitle text and accessible naming. |
| 5 | Not fixed in round 1 | Round 1 found that keyboard activation changed only tab selection and roving tabindex, not the controlled panel. See the round-1 follow-up below. |
| 6 | Fixed | `$agents` is restricted to R5 fields in `design-spec.md:95-110`, including the defined turn-token share. |

## Round 1 items

| Item | Status | Evidence |
| --- | --- | --- |
| (a) Defect 5: keyboard tab activation must switch its controlled panel | Partially fixed | `prototype/index.html:639-650` now uses `selectTab()` to synchronize `aria-selected`, roving `tabindex`, and each controlled panel's `hidden` state for ArrowLeft/Right and Home/End. `?selftest=1` at `671-680` probes the display strip and the top segmented tabs, recording selected/hidden state and focus. However, the empty dock path remains broken as documented under New defects. |
| (b) 600 px maximum-width contradiction | Fixed | `design-spec.md:38-41` restores the dock maximum to 75% of host width and assigns 600 px only to the overlay trigger. `design-spec.md:249-253` explicitly confirms `aria-valuemax` is 75% (960 px at a 1280 px host) and that 600 px is not a second clamp. The prototype separator is capped at 960 for the 1280 px review harness (`prototype/index.html:663-669`). |

## New defects

1. **Serious — empty dock tabpanel is missing.** `prototype/index.html:557-563` renders an enabled `Agents` tab with `aria-controls="p-agents-${k}"`, but the `empty` branch returns only `p-displays-${k}`. Activating Agents with ArrowRight or click calls `selectTab()` (`639-653`), hides the Displays panel, and cannot show the missing Agents panel; the dock becomes blank and the selected tab has an unresolved `aria-controls` reference. Render the Agents panel in this branch (or remove/disable the Agents tab when no corresponding panel exists), and extend `?selftest=1` to cover the empty variant.

## Verified claims

- The normal display strip and top `Displays | Agents` tablists now show the selected controlled panel and hide sibling panels; their panels retain the matching static `aria-labelledby` values (`prototype/index.html:557-571`).
- The `?selftest=1` probe now records selected/visible/hidden state for display-strip navigation and selected/hidden state for the segmented tabs (`prototype/index.html:671-680`).
- The 600 px value appears in the revised design only as the below-600-host overlay threshold; the required 75%-of-host maximum and panel-wide 960 px reference are preserved.
- Regenerated `dock-dark.png`, `dock-light.png`, `empty-dark.png`, and `empty-light.png` were visually inspected. The dark/light dock layouts, selected tab treatments, narrow overlay, and empty-state typography remain coherent, with no visible clipping or theme regression. The empty captures also expose the unresolved Agents tab described above.

## Taste questions for the user

1. Sparkline highlight: gold (`secondary`) or theme `primary`?
2. Host Turn summary: warm gradient or flat surface?
