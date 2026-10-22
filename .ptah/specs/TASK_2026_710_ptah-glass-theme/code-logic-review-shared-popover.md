# Shared popover repair — independent source review

Author: Grok lane c2cbae0f-0c0a-4431-afea-ddd87b06963d.
Reviewer: OpenAI parent session. Source review only. No checks or Electron launch.

## Verdict: INCOMPLETE — not accepted for merge

The manual top-layer shell is a source-supported correction for panels trapped inside isolated glass ancestors. showPopover precedes Floating UI positioning. Optional backdrop and panel retain pointer events while the full-viewport shell and native backdrop do not. Existing inputs/outputs and generation cancellation remain. No persistence path changes.

## Open findings and limits

1. New specs introduce `as unknown as` double casts of HTMLElement.prototype and the Angular component definition. The project coding rule forbids that pattern. Record for the next authorized correction. No correction round starts because the user requested a stop after the current round.
2. The implementation adds an unsupported-engine/showPopover-error fallback that returns to in-DOM placement. That fallback cannot solve the original ancestor stacking defect. It is not top-layer success. The source/report distinguish this, but acceptance must not count fallback opening as successful repair.
3. Nested native dialog behavior is unverified. A manual popover does not itself prove Escape arbitration with a parent dialog's native close request. The host keydown handler stops propagation and prevents default, but no actual Electron nested-dialog interaction ran.
4. Pointer hit testing is unverified, especially hasBackdrop=false and multiple/nested top-layer surfaces. Unit API mocks cannot prove click-through or the order of native top-layer entries.
5. Existing fallback placement can overflow a small viewport if Floating UI fails. This patch preserves usability intent but does not clamp that failure path.
6. No unit tests, diagnostics, lint or typechecks ran. Review cannot establish Angular compilation or Jest success. Shared host compatibility remains unverified.

## Required next evidence

After explicit execution authorization, run only scoped UI specs/checks under the single-heavy-slot rules. In Electron dark/light modes, check ordinary popup, nested modal popup, transparent/dark/no backdrop, anchor override, Escape, outside dismissal, focus return, resize and close/destroy during positioning. Do not merge on source inspection alone.

## Stop boundary

Preserve the patch. Do not resume or spawn another correction lane in this session. Handoff records the open items for a new session.
