# FIX-5: CI e2e failures

## a. Duplicate-session compaction marker

**Root cause:** The spec opens the split-pane inspector while checking stats (`apps/ptah-electron-e2e/src/specs/chat/compaction-duplicate-session.spec.ts:282-292`), then clicks the marker under it (`:305-308`). CI's click log says the session-details aside intercepts pointer events. The board intentionally mounts that aside over the active pane (`libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:184-191`).

**Verdict:** Stale spec. The inspector overlay is intended UI; the test must close it before interacting with the transcript.

**Change:** The existing spec clicks the inspector's accessible close button and checks that the dialog is gone before clicking “View” (`apps/ptah-electron-e2e/src/specs/chat/compaction-duplicate-session.spec.ts:305-312`). The original two-tile restoration, stats, marker, and active-pane assertions remain.

## b. Empty assistant envelope

**Root cause:** The assertion expected the former fallback title “Assistant response” (`apps/ptah-electron-e2e/src/specs/chat/empty-assistant-envelope.spec.ts`, former line 187). The clean-turn template instead renders an `<article aria-label="Assistant">` (`libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html:1-11`). With an empty execution tree, the answer and work-log blocks are absent (`:27-90`); a settled turn retains its action row (`:122-145`). The design specifies this clean-turn anatomy and hides the disclosure for a zero-activity turn (`.ptah/specs/TASK_2026_677_efcd/design-spec.md:187-205,321`).

**Verdict:** Stale spec. The injected naked envelope still produces the pre-fix empty assistant turn; only its presentation changed.

**Change:** The real-delivery case now requires text in `.cs-answer` (`apps/ptah-electron-e2e/src/specs/chat/empty-assistant-envelope.spec.ts:146`). The naked-envelope case requires exactly one visible Assistant article, a settled-turn action row, and no answer or work log (`:169-181`). The assertions still distinguish a real answer from an empty turn; the explanatory comments were updated.

## c. Plan-limits inspector at 440 px

**Root cause:** The spec only opened details when the focus-header `[data-details]` button existed (`libs/frontend/webview-e2e-harness/src/lib/scenarios/plan-limits/plan-limits-visual.e2e.spec.ts`, former lines 117,130-133). At the 440 px small-board layout, the unsplit header omits that button unless the board uses its compact sheet (`libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.ts:191-208,311-314`). The board instead exposes its collapsed “Open details” control (`libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:198-227`). The old conditional silently skipped opening the inspector, so its stats locator found no element in both themes.

**Verdict:** Stale spec. The inspector remains available through the board's narrow-layout control.

**Change:** The existing spec now opens the visible header control when present, otherwise clicks the board's accessible “Open details” button, then checks the visible inspector within that board (`libs/frontend/webview-e2e-harness/src/lib/scenarios/plan-limits/plan-limits-visual.e2e.spec.ts:116-142`). All plan-limit, lane, push, and screenshot assertions remain.

## Checks

| Command | Exit code | Result |
| --- | ---: | --- |
| `git diff --check` | 0 | No whitespace errors. |
| `node .ptah/tmp/check-run.mjs fix5-spec-checks -- npx nx run-many -t typecheck,lint -p ptah-electron-e2e @ptah-extension/webview-e2e-harness --parallel=1 --skip-nx-cache` | 0 | Typecheck and lint passed for both changed projects. |

The e2e targets were not run, as required by the task's memory-safe verification rules. CI must confirm the browser behavior after these spec changes.

## Decisions

- All three failures are stale spec interactions or assertions caused by the intended clean-session UI. No product-code change or new spec file was needed.
- The empty-envelope negative control now proves an empty rendered Assistant turn by checking its visible action row and missing answer/work log, rather than relying on a removed title string.
