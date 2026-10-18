# B05 revision 1 report

## Status

Completed the B05 revision in the existing uncommitted worktree. Generator activity now enters the chat transcript through one registered `MESSAGE_HANDLERS` adapter. The shell-local activity log was removed. No committed capability was removed.

## Defect 1 — transcript and terminal mapping

- `libs/frontend/setup-wizard/src/lib/services/generation-run-event-adapter.ts:45-137` checks the exact tab, workspace, workflow and run; constructs fresh chat `message_start`, `text_delta`, `tool_start` and `tool_result` events from sanitized text/tool labels; and calls `StreamingHandlerService.processStreamEvent(event, tabId, undefined, { fanOut: false })`. It never forwards the incoming flat event or nested SDK metadata. Generator run and SDK session IDs are omitted from generated metadata and redacted from text.
- The adapter stops accepting stream events on a matching terminal push and rereads committed state. A terminal run found through lookup, including a lost terminal push, invokes the synthetic terminal turn-state at `generation-run-event-adapter.ts:142-168`. The push/stream itself does not claim backend success.
- `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.ts:24-53` removes the uncommitted local activity log; the transcript is the activity surface.
- Revision-floor mapping: the synthetic event uses the tab's **real chat session ID** (never the generator SDK ID) and its **current** `lastTurnStateRevision`, or zero if none exists. `TurnStateApplier` accepts a same-revision ordered terminal event through its terminal heal; `TabManagerService.applyTurnState` clears the busy state and finalizes the current tree without increasing the real chat revision floor. A later ordinary chat `generating` revision can therefore be accepted, followed by its terminal revision. The adapter sends no generator run ID as a session ID. No queued Send is introduced.
- Specs: `generation-run-event-adapter.spec.ts:81` checks nested/flat IDs, sanitized content and `{fanOut:false}`/tab routing; `:124` checks wrong binding and late events; `:152` uses a turn-state acceptance double for terminal heal and a subsequent ordinary turn; `:192` checks terminal-push race and lookup closure.

## Defect 2 — composer and run state

- `generation-workflow.store.ts:88-125,135-150` rejects generation start unless the bound tab's ordinary chat turn is idle and its queue is empty. It exposes `chatTurnRejection` with the exact reason `Finish this chat reply first` for B07. The start RPC is not called on rejection.
- `generation-workflow-shell.component.ts:28-50,83-91` shows Stop and a visible Send guard reason while a run is bound, including quiet or starting time. The same `startGuard` and `stopHandler` feed the bare `ptah-session-embed`. The handler returns `handled` and dispatches `store.stop()`; no chat abort is invoked. Once a terminal run is verified, `isBound` clears and ordinary Send is available.
- `generation-workflow.store.ts:171-252` queues Stop until an accepted or looked-up exact run ID, rereads after a cancellation error, preserves `stop-unconfirmed` for an active run, handles unknown lookup, and rejects a different run ID. The backend record remains the outcome authority.
- Specs: `generation-workflow.store.spec.ts:34-231` covers pending Stop, unknown provider/model, busy/queued rejection, preview-required, stop-unconfirmed, interrupted terminal, blocked ownerTabId, and lost lookup/foreign run. `generation-workflow-shell.component.spec.ts:54-116` checks binding, guard and quiet Stop wiring. Existing `chat-input.component.spec.ts` and `session-embed.component.spec.ts` also pass.

## Defect 3 — route inventory

- `apps/ptah-extension-webview/src/app/webview-routing.spec.ts:818-827` keeps the explicit parameter-route allowlist and adds `setup-wizard/generation/:workflow/:tabId` in the actual route-table order. The webview test gate passes.

## Defect 4 — regression depth

- Adapter specs now exercise exact binding, metadata stripping, sanitization, terminal race, same-floor idle, subsequent normal turn and no queued content.
- Store specs exercise start rejection, starting/quiet/cancelling/stop-unconfirmed/stop-unknown/terminal paths, provider/model hiding, preview-required, blocked ownerTabId and interrupted status.
- `generation-handoff.store.spec.ts:11-125` uses fake timers for the absolute five-second deadline, tab switch, tab close, reload and manual recovery after failed automatic launch.
- Shell specs exercise invalid workflow and current workspace restoration plus the guard and Stop handler.

## Checks

- Focused setup-wizard Jest: 4 suites, 15 tests passed before the final adapter race assertion; final adapter focused spec: 1 suite, 4 tests passed.
- Nx typecheck and lint: targets passed for all 4 requested projects after final edits.
- Nx two-project test gate: `Running target test for 2 projects`, then `Successfully ran target test for 2 projects` after final edits. The earlier failing route-inventory run had 519 passed and 1 failed; its corrected rerun and the final rerun were green.
- Chat input and session embed focused Jest: 2 suites, 92 tests passed.
- Prettier applied to changed source/spec files. `ptah_get_diagnostics` was attempted after edits but its TypeScript service reported a 45-second timeout/unchecked files; Nx typecheck was green.

## Final line counts

| File | Lines |
| --- | ---: |
| generation-run-event-adapter.ts | 224 |
| generation-run-event-adapter.spec.ts | 211 |
| generation-workflow.store.ts | 269 |
| generation-workflow.store.spec.ts | 231 |
| generation-handoff.store.spec.ts | 126 |
| generation-workflow-shell.component.ts | 101 |
| generation-workflow-shell.component.spec.ts | 117 |
| webview-routing.spec.ts | 1023 (existing long spec; only allowlist edited) |

## Notes for B06/B07

- B06: the typed open handler and launcher from the prior B05 work remain in place. Generator activity is now displayed in the bound chat transcript; terminal pushes trigger committed-run rereads.
- B07: read `GenerationWorkflowStore.chatTurnRejection()` to show the exact pre-start rejection. The shell supplies persistent Stop/guard affordances until verified terminal state. Continue to use the store's committed `run`/`rejection` signals for results and blocked owner information. `GenerationHandoffStore` retains the absolute deadline and manual fallback.
- The transcript bridge uses the publicly exported `StreamingHandlerService` from `@ptah-extension/chat-streaming`. B07 can add page controls without a second event handler or local activity log.

## Decisions

- Decision: synthesize only a small, sanitized chat event whitelist from generator payloads. Options: forward `flatEvent`, show a local log, or synthesize. Evidence: generator flat events can contain nested SDK session/run IDs; plan §5 requires chat transcript parity. Reversible: yes.
- Decision: use the current chat revision for terminal heal. Options: increment the revision, bypass chat turn-state, or reuse the current floor. Evidence: `TabManagerService.canApplyTurnState` accepts an ordered terminal at the same revision for a bound session; raising it would block the next real turn. Reversible: yes.
- Decision: show a shell Stop control throughout a bound run. Options: rely solely on chat's busy-based Stop visibility or display the shell control. Evidence: the chat Stop button is busy-predicate gated and a generator can be starting/quiet before a stream event. Reversible: yes.

## Deviations

- Direct public `@ptah-extension/chat-streaming` import is necessary because `StreamingHandlerService` is exported from that package's `src/index.ts`, not from `@ptah-extension/chat`. No other library was edited for this import.
- The ordinary-turn regression uses a faithful turn-state acceptance double rather than constructing the full streaming service dependency graph. It verifies same-floor terminal acceptance, later generating/idle revisions and an empty queue; the existing chat specs separately pass.

## Proposed Removals

None.
