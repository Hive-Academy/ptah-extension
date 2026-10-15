# Final scoped code logic review: PR #730 corrections

Review family: codex reviewing Claude. **Verdict: APPROVED. Score: 8/10.**

## Prior items

| Item | Status and evidence | Impact |
| --- | --- | --- |
| Composer failed-send outcome and retry duplication | **Closed.** `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts:1514-1546` clears the submitted visible and tab-stored draft after every resolved outcome. `chat-input.component.spec.ts:446-476,1291-1303` pins clear-on-failure and a subsequent send. | A failed prompt already left in the transcript is not offered as an unchanged retry draft. The known pre-bubble failure gap remains a separately recorded follow-up (`decisions.md:139`), not a regression from this correction. |
| Composer overlapping dispatch | **Closed.** `chat-input.component.ts:1490-1506` rejects the same tab and draft while pending; `:1551-1553` releases that exact entry in `finally` after success, unsuccessful outcome, or throw. `chat-input.component.spec.ts:388-444,446-476` covers overlap, edited follow-up, and retry after failure. | A double Send cannot dispatch the same pending draft twice, while a later or edited draft can proceed. |
| Rail dead toggle and preference rewrite (finding 1) | **Closed.** `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:298-305,682-690` derives the auto condition and refuses persistence during it; `canvas-rail.component.ts:108-127,301-303` exposes a focusable `aria-disabled` control with a reason and refuses its click. `canvas-rail-board.component.spec.ts:746-781` covers 639 px, 640 px, and details auto-collapse; `canvas-rail.component.spec.ts:70-97` covers the DOM and click. | Narrow-width activation cannot silently change the saved collapse setting; at 640 px the toggle persists normally. Keyboard activation of the native button follows its guarded click handler. |
| Empty-board clipping (finding 2) | **Closed.** `canvas-rail-board.component.ts:107-147` gives the empty section `min-h-0 overflow-y-auto` and its content `my-auto`; `canvas-rail-board.component.spec.ts:784-795` checks the structure. | Tall setup content can scroll, while fitting content remains vertically centered. The spec checks classes rather than measuring a short viewport. |
| Vacuous landmark test (finding 5) | **Closed.** `canvas-rail-board.component.spec.ts:1370-1393` mounts the real focus area in single and split panes, finds its inner section, and asserts no inner label. | Restoring an inner `aria-label` would fail the test. |

## New findings

None in these corrections. The score is 8 rather than 9 because the composer spec mocks `sendOrQueueMessage` (`chat-input.component.spec.ts:459-462`) and the empty-board spec checks DOM classes (`canvas-rail-board.component.spec.ts:784-795`), so the cross-service retry transcript and actual small-viewport geometry are supported by code tracing rather than direct integration or layout tests. The corrected paths and focused boundary tests support 8 rather than 6.

## Five failure questions

1. **Silent failure:** A resolved unsuccessful send still clears the composer (`chat-input.component.ts:1514-1546`), which is the recorded product rule because the sender retains an optimistic prompt; before-bubble failures remain the known follow-up (`decisions.md:139`). The rail's formerly silent preference rewrite is prevented (`canvas-rail-board.component.ts:682-690`).
2. **User action:** Double Send while pending returns before dispatch (`chat-input.component.ts:1497-1504`); clicking or keyboard-activating the auto-collapsed rail toggle reaches a guarded click (`canvas-rail.component.ts:108-127,301-303`).
3. **Wrong input data:** At 639 px the display collapses without writing persistence; at 640 px a toggle writes it (`canvas-rail-board.component.spec.ts:732-769`). An edited follow-up remains sendable (`chat-input.component.spec.ts:417-444`).
4. **Dependency failure or malformed result:** A resolved `{success:false}` follows the intended clear path (`chat-input.component.spec.ts:446-476`). A rejected or throwing sender exits through `finally`, releasing the guard while retaining the draft (`chat-input.component.ts:1549-1553`). A malformed resolved value is not validated, but the declared `SendOutcome` contract and the present correction provide no evidence of such a runtime result.
5. **Requirement omission:** The earlier requirement did not distinguish failures before and after an optimistic user bubble. That pre-existing gap is explicitly deferred (`decisions.md:139`); it is outside this scoped correction.

## Verification scope

Reviewed the current handlers, affected specs, prior findings, correction report, and the decision at `decisions.md:139-140`. The correction report records passing focused rail (12 tests), board (83 tests), full canvas (367 tests), and canvas typecheck (`fix-rail-toggle-report.md`, Checks). The previous chat check recorded 84 passing focused tests and chat typecheck (`fix-send-guard-report.md`, Checks); the current clear-on-failure assertions are visible at `chat-input.component.spec.ts:446-476,1291-1303`. I did not rerun a heavy check. Scoped `ptah_get_diagnostics` returned **unavailable** after its 45-second TypeScript timeout, so it is not counted as passing evidence. No source files were edited.
