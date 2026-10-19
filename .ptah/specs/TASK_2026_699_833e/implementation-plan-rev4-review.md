# Implementation plan rev 4 review — round 1

**Verdict: APPROVED**

## Findings

| # | Severity | Original finding | Status | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Moderate | The 360 px class was incorrectly cited as an existing single-focus tile minimum. | **Closed** | `implementation-plan-rev4.md:18-25,90,242-247,330` and `decisions.md:21` now state that `canvas-rail-board.component.ts:174` applies `min-w-[360px]` only when `splitDisplayed()` and that 360 px is a new single-focus floor enforced through the dock maximum. The plan includes max-width cases 560 at lg 1400, 520 at md 1200, 312 at sm 760, and 300 at sm 640. Their available widths and tile remainders agree with the rail and tab widths; the 300 px minimum exception is explicit. |
| 2 | Minor | Spec line 574 was incorrectly described as a zero-tile test. | **Closed** | `implementation-plan-rev4.md:96,248-252,329` now calls the empty aside removal a deliberate D-7 change and adds a `mount(true, 0)` case. It correctly identifies `canvas-rail-board.component.spec.ts:574-582` as a two-tile deferred-inspector test and keeps that test's aside selector. |

The round-1 edits introduce no new defect in these two areas. This was a document review; no implementation or test run was performed.

## Decisions

- **APPROVED** for the revised plan and decision row 18. Both prior findings are closed. The 360 px floor remains conditional on enough space for the 300 px dock minimum, as the revised AC 3.2 and width cases state.
