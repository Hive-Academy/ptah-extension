# Code Logic Rereview 2 — TASK_2026_699_833e

Scope: uncommitted diff from `abf44d146` in `canvas-rail-board.component.ts` and its spec. Implementer family: claude; reviewer family: codex.

## Verdict

**REVISE — 7/10.** One moderate residual failure mode; no blocking or serious finding. The bounded md→compact correction works on the stated path, but a 0 px measurement still changes the visible dock choice. This is above 5–6 because the direct crossing, reverse handoff, band-only reset, and focus path are supported by the code and spec. It is below 8–9 because the explicit hidden-board invariant fails.

## Numbered findings

1. **Moderate — A 0 px hidden render does not preserve the last visible dock state.** `dockOpen` resets whenever `dockOpenByDefault` changes with the width band (`canvas-rail-board.component.ts:386-395`). At 0 px the band is `sm`, and the still-rendered Stats tab reads `dockOpen()` (`canvas-rail-board.component.ts:220-231`); the new effect returns before recording or restoring it (`canvas-rail-board.component.ts:579-587`). Reproduce with a single-focus board at 760 px, open its dock, render once at 0 px, then render again at 760 px: the dock is closed although the last visible width and user choice were unchanged. At 1200 px, a manually closed dock similarly reopens after 1200→0→1200. The added spec covers 1200→390→1200 only (`canvas-rail-board.component.spec.ts:913-944`); there is no 0 px assertion. Preserve the user choice across a hidden measurement without suppressing D-3 on a real, visible band crossing.

## Requested checks

| Check | Result |
| --- | --- |
| One-step md→compact and back | **Pass by code path and new behavioral spec.** At 1200 px `dockWasOpen` records true; the 390 px run passes that pre-reset value to `handOffInspector`, which opens `detailsOpen` (`canvas-rail-board.component.ts:577-589,961-976`). The reverse branch closes the sheet and opens the dock. The spec asserts rendered surfaces and the final close-control focus in both directions (`canvas-rail-board.component.spec.ts:913-944`). |
| D-3 band-only crossing | **Pass by code path; sequence lacks a direct spec.** At 1200→760 px the effect records the band-reset `dockOpen()` false while `compact` stays false. At 760→390 px it passes false, so no sheet opens (`canvas-rail-board.component.ts:385-395,579-589,966-970`). The existing band test checks 1200→760→1200 (`canvas-rail-board.component.spec.ts:843-856`). |
| 0 px hidden board | **Fail:** finding 1. |
| Effect cycle, stale state, focus leak | The handoff writes remain in `untracked`; the subsequent run can refresh `dockWasOpen` without recrossing the threshold (`canvas-rail-board.component.ts:579-589`). The reverse handoff stops the prior observer before scheduling dock focus (`canvas-rail-board.component.ts:971-976`), and `focusDock` releases its observer after finding the close control (`canvas-rail-board.component.ts:984-1003`). The hidden-width reset is the remaining stale-state case. |
| New spec checks behavior | **Yes.** It asserts source removal, destination presence, signal state, and focus after deferred rendering, rather than only checking a helper call (`canvas-rail-board.component.spec.ts:913-944`). |

## Five logic questions

1. **Silent failure:** The hidden render changes `dockOpen` without an error or announcement; when the board returns at the same width, the user's prior choice has changed (`canvas-rail-board.component.ts:386-395,579-587`).
2. **Unexpected user action:** Open a dock at 760 px, hide the board until its measurement is 0 px, then show it at 760 px; it returns closed (finding 1).
3. **Wrong-answer input:** Width sequence 760→0→760, with the dock initially open, produces false for `dockOpen()` after the intermediate `sm` source reset (`canvas-rail-board.component.ts:386-395,220-231`).
4. **Dependency failure or malformed result:** This bounded diff adds no external payload or service boundary. Deferred inspector content can arrive after a handoff; the focus routines observe for its close control and release the observer after insertion (`canvas-rail-board.component.ts:812-829,984-1003`). No additional failure is established from this diff.
5. **Missing requirement case:** The hidden-board rule needs to cover the dock's open choice at the same visible width, not only the compact threshold comparison (`canvas-rail-board.component.ts:579-587`); the spec omits this sequence (`canvas-rail-board.component.spec.ts:843-944`).

## Verification and limits

Read the bounded diff, prior re-review, correction report, relevant implementation plan, component state and focus paths, and the new and adjacent specs. No build, test, typecheck, lint, serve, or e2e command was run, per the review brief. The implementer reports 120/120 passing Jest tests in `fix-round-report.md`; that evidence does not exercise the 0 px case. Findings are based on code tracing, not an executed reproduction.

## Decisions

- Treat 0 px as a hidden measurement that must preserve the last visible dock choice. Options: preserve it, or allow D-3 to reset it through the temporary `sm` band. Evidence: the review brief explicitly requires the hidden board to keep its last visible state, and the effect comment says 0 px is not a resize across the threshold (`canvas-rail-board.component.ts:581-582`). Reversible: yes.
