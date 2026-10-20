# Code Logic Rereview — TASK_2026_699_833e

Review family: codex (implementer: claude)  
Scope: `0485f95b4..abf44d146`, Canvas Rail board component and spec only.

## Summary

| Metric | Result |
| --- | --- |
| Verdict | **REVISE** |
| Score | **6/10** |
| Blocking / Serious / Moderate | 0 / 1 / 0 |
| Failure modes | 1 |

The fix transfers an open inspector across the 400 px boundary when both widths stay in the sm band. It still loses an open dock when one resize goes from md or wider directly below 400 px. The score is above the 3–4 band because the ordinary crossings, focus cleanup, and defer structure are implemented; it remains in the 5–6 band because a specified resize path still loses the visible inspector.

## Numbered findings

1. **Serious — A direct md-to-compact resize closes the inspector instead of handing it to the sheet.** At `canvas-rail-board.component.ts:386-395`, `dockOpen` is a `linkedSignal` whose source changes from true to false when the width crosses 1120 px. The new effect at `canvas-rail-board.component.ts:577-584` then calls `handOffInspector`, but its compact branch reads the already reset `dockOpen()` at `canvas-rail-board.component.ts:955-965`. Starting with the dock open at 1200 px and setting the width directly to 390 px leaves `detailsOpen` false; the dock disappears and no sheet opens. The new test uses 760→390 px, remaining in sm throughout (`canvas-rail-board.component.spec.ts:858-878`), while the existing band test only checks 1200→760 px (`canvas-rail-board.component.spec.ts:843-855`). Capture the pre-transition open choice before the band reset, or make the handoff own the combined band/compact transition; add a 1200→390 px test with focus assertions. This also covers the stated D-3 interaction.

## Five logic questions

1. **Silent failure:** The md→compact jump leaves both visible presentations closed without an error or announcement (`canvas-rail-board.component.ts:397-400,577-584,955-965`).
2. **Unexpected user action:** Narrow an open md board directly from 1200 to 390 px, for example by resizing its host pane; the inspector vanishes instead of becoming a sheet (same lines).
3. **Wrong-answer input:** A width sequence of 1200→390 px produces the wrong open state because the `linkedSignal` reset changes the value that handoff consults (`canvas-rail-board.component.ts:386-395,955-965`).
4. **Dependency failure or malformed result:** This diff adds no external dependency or payload boundary. If the deferred inspector has not loaded, the dock handoff focuses the Stats tab and observes for the close control (`canvas-rail-board.component.ts:978-996`); the compact path focuses the sheet while waiting (`canvas-rail-board.component.ts:805-823`). No separate failure finding is supported.
5. **Missing requirement case:** The tests do not cover a compact crossing that also changes the sm/md band (`canvas-rail-board.component.spec.ts:843-878`).

## Other requested checks

| Check | Result and evidence |
| --- | --- |
| 0 px hidden measurement | The effect skips a zero measurement without updating `wasCompact`, so a later real width is compared with the last nonzero presentation (`canvas-rail-board.component.ts:577-584`). |
| sm-band dock ↔ sheet | The new tests assert both directions, old presentation removed, destination open, and focus on its close control after deferred rendering (`canvas-rail-board.component.spec.ts:858-910`). |
| Split presentation | Split keeps `detailsOpen` and redirects focus to the destination shell (`canvas-rail-board.component.ts:955-959,805-823`). |
| Focus observer disposal | Toggle, close, compact close, split close, handoff to dock, and destroy call `stopDetailsFocusObserver` (`canvas-rail-board.component.ts:431-433,826-853,933-996`). The dock observer also stops after the close control appears (`canvas-rail-board.component.ts:989-995`). |
| Effect cycle | The effect tracks `compactSheet()`; its handoff reads and writes are inside `untracked`, so the new state writes do not subscribe the effect to themselves (`canvas-rail-board.component.ts:577-584`). |
| Three deferred inspectors | Each `@defer (when <open signal>)` is inside the matching open `@if`; the inspector remains a deferred standalone component. Each placeholder is a three-line skeleton with loading status (`canvas-rail-board.component.ts:202-212,231-272,277-288`). Closing removes its block and reopening creates it again. |
| Manual defer tests | The suite now uses `DeferBlockBehavior.Manual` and explicitly renders current blocks (`canvas-rail-board.component.spec.ts:195-200,370-374,875-878,902-910`). This preserves state/focus assertions but does not itself exercise automatic `when` triggering. Template structure supports the trigger; production timing remains unverified by these tests. No observed production regression follows from the test setting. |

## Data flow and failure mode

The host width feeds `band` and `compactSheet` (`canvas-rail-board.component.ts:323-325,386`). The band sources `dockOpen` through `linkedSignal` (`canvas-rail-board.component.ts:391-395`). The compact effect detects the threshold and asks `handOffInspector` to read the open state (`canvas-rail-board.component.ts:577-584,955-965`). On a direct md→compact jump, the source reset consumes that state before the read. The template then renders neither dock nor sheet (`canvas-rail-board.component.ts:220-231,277-289`). Preserve the pre-reset state for this transition and move focus into the resulting sheet.

## Decisions

- **Direct band and compact crossing must preserve an already open inspector.** Options: let D-3 reset close it, or carry the open choice into the compact sheet. The rereview request expressly requires the single md→below-400 jump to hand off; the existing L1 finding required open-state continuity. Carrying it is reversible.

## Verification and limits

Read the changed implementation, its relevant spec setup and transition cases, the width-band definition, and the fix-round report. The orchestrator reports scoped typecheck, test, and lint green for chat-ui, chat, and canvas. No build, test, typecheck, lint, serve, or e2e command was run here, as instructed. The existing 119 passing specs do not exercise the direct md→compact jump or production defer scheduling.

## Verdict

**REVISE.** Fix the direct md→compact handoff and test its open state, source removal, destination focus, and deferred close focus.

