# Frontend review fixes

## Status

The blocking inspector route, lost queued text, and duplicate canvas composer are fixed. Targeted regression suites pass. The requested four-project verify is **not green**: the shared parent-delivery type omits `expired`, and the full Jest run stalled. Cold recovery after a host restart and a fully interleaved A4 transcript remain open.

## Defects

| # | Fix and source | Regression evidence | Status |
| --- | --- | --- | --- |
| 1 | `inspector-agents-section.component.ts:199,248`: composer only for `cli:` rows present in monitor; SDK and background rows use tray steer. | `inspector-agents-section.component.spec.ts` tests both fallback kinds and CLI row; 20/20 targeted tests pass. | Fixed |
| 2 | `lane-composer.component.ts:160,290`: accepted text is retained by receipt id; cancellation appends it to an existing draft. | `lane-composer.component.spec.ts` cancellation test. | Fixed for current renderer |
| 3 | `canvas-lane-view.component.ts`: removed its second continue input; card owns the composer. | `canvas-lane-view.component.spec.ts` checks one input under the card; 23/23 targeted tests pass. The card is stubbed in this suite. | Fixed |
| 4 | `lane-composer.component.ts:88,240-280`: accepted text survives composer remounts, Edit cancels to draft, and a new queued send coalesces prior text. The old follow-up service remains present and is not the composer owner. | Composer remount and coalescing tests; `agent-follow-up-queue.service.spec.ts` targeted suite passes. | Partial: host-restart recovery unavailable from 160-character receipts; obsolete service cleanup remains |
| 5 | `lane-composer.component.ts:160-174`: failed, expired, and interrupted accepted receipts restore text and show a reason. | Composer accepted-then-failed test. | Fixed for retained text |
| 6 | `agent-monitor.store.ts:815-831`: rejects older timestamps, lower state ranks, and conflicting terminal transitions. | Store out-of-order receipt test; 190/190 targeted store tests pass. | Fixed |
| 7 | `lane-composer.component.ts:19,38,53,136-145,177-185,260`: previews refresh on focus, mode menu, status change, rejected send, and retry. | Composer focus/menu/status test. | Fixed |
| 8 | `lane-composer.component.ts:56,150-157,199-231`: modal, disclosure, focus entry/return, tab trap, Escape, and readonly field. Removed an effect dependency that closed the dialog on open. | Composer interrupt-confirmation focus/Escape and consent-gating tests. | Fixed |
| 9 | `lane-transcript.component.ts:105`: uses lane CLI identity and omits unknown parent family. | Thread sender tests in `lane-thread.spec.ts`. | Fixed for available identity |
| 10 | `lane-thread.ts:15-42` correlates user receipts by normalized preview and labels unmatched user text You; `lane-transcript.component.ts:52,107` suppresses duplicate user bubbles; assistant messages stay in rich bubbles. | Thread preview-correlation, user attribution, and assistant-duplicate tests. | Partial: thread summary and rich bubbles are separate sections, so A4 chronology is not fully interleaved |
| 11 | `agent-monitor.store.ts:875` uses the real UTF-8 em dash; bytes `e2 80 94` confirmed. | Store exact-copy test. | Fixed |
| 12 | `agent-monitor.store.ts:860-865` and `lane-thread.ts:42-53` show expired parent delivery as a distinct warning label; `lane-thread-row.component.ts` adds warning tone. | No valid expired payload test until shared type accepts it. | Partial; see Needs from backend |
| 13 | `lane-composer.component.ts:64-77,105-109` lists only user queued receipts and names Cancel by first 40 preview characters. | Composer parent-receipt exclusion and cancel-name tests. | Fixed |
| 14 | `agent-monitor.store.ts:815-851` refreshes receipt and parent-delivery map recency and removes previews with evicted agents. | Store 65-agent recency test covers both maps. | Fixed |
| 15 | `lane-composer.component.ts:263` leaves draft and shows error for non-unsupported outcomes lacking a receipt. | Composer no-receipt test. | Fixed |
| 16 | `agent-follow-up-queue.service.ts:104-110,140-151` clears stale queued projection and cancelled bookkeeping after refused cancellation, and replaces raw failure codes with friendly copy. | Follow-up service enqueue and unqueue refusal tests. | Fixed in service, though composer owns the new flow |
| 17 | `cli-matrix-rows.ts:288,356,479` distinguishes Cursor key requirement, reads Ptah CLI manifest, and aligns instance status; `ptah-cli-instances.component.ts` renders capability badges. | `cli-matrix-rows.spec.ts` targeted suite passes. | Fixed |
| 18 | `agent-card-header.component.ts:147-178`, `lane-thread-row.component.ts`, `lane-event-row.component.html:60`, and composer template: stop/error tones, text Resume sizing, reduced live regions, menu semantics, stable field focus, preserved resume hint case. | Composer focus test; no rendered screenshot or separate visual regression. | Code fixed; visual review remains |

## Preserve-list re-check

- Stop and explicit Resume actions remain in the card header. Permission response, account controls, and output view were not modified.
- Codex Send now still uses preview and requires consent for interrupt-resume; the confirmation test verifies no send on Escape.
- SDK subagent and background inspector rows retain tray steer; CLI rows use the monitored lane composer.
- Canvas now has one card-owned composer. Queued Edit, cancellation to draft, coalescing, and tab-switch recovery work in targeted tests.
- Cold recovery after a host restart remains unresolved because the receipt only carries a truncated preview. The background strip and SDK lane were not redesigned.

## Verification

- Required command run once: `npm run verify -- -p @ptah-extension/chat-streaming,@ptah-extension/chat-ui,@ptah-extension/chat,@ptah-extension/canvas -- --output-style=static`. It did not complete green. Initial chat-streaming typecheck and chat-ui lint errors from this work were corrected; chat-ui Jest reported 110 suites / 1893 tests passing. Chat-streaming full Jest reported one failure in `session-scope-leaks.spec.ts` (outside edited files) before stalling.
- Single-worker test-target rerun was attempted once with `-- --maxWorkers=1`; it stalled without a complete summary and was stopped.
- Targeted Jest: chat-ui composer 9/9; chat-streaming store 190/190; chat inspector 20/20; chat thread/follow-up/capability tests 3 suites passing; canvas lane 23/23.
- Native `ngc --noEmit`: chat-ui and chat-streaming pass; canvas fails only at `agent-monitor-message-handler.service.ts:135` on the shared expired-state type. Chat typecheck fails at the same line.
- `ptah_get_diagnostics` after edits timed out at 45 seconds and returned unchecked; native `ngc` provided the scoped results. No browser session was available and serve/build/e2e were prohibited, so visual quality was not assessed from a rendered page.

## Needs from backend

1. Widen `AgentParentDeliveryState` in `libs/shared/src/lib/types/messages/agent-monitor.ts` to include `'expired'`, matching its schema. This clears the frontend handler type error and permits an expired-state regression test. No shared or backend file was touched in this lane.
2. For recovery after a host restart, expose recoverable full accepted-message text through a bounded backend draft/receipt API or an approved persistence path. The current receipt preview is truncated to 160 characters, so the renderer cannot reconstruct the full draft after process loss.

## Decisions

- Card owns the canvas composer because the existing card already mounted one; removing the canvas sibling is reversible.
- Unknown parent family is omitted rather than guessed from the lane CLI; this is reversible when owner metadata is available.
- Accepted text is shared across composer instances in a bounded in-memory map, preserving tab-switch recovery without storing draft content externally. This is reversible when a persistent recovery contract exists.
