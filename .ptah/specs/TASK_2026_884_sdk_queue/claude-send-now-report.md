# Claude Send now report

## Design

Claude `steerQueuedFollowUp` moves the selected held item to the queue head. For an active turn, it calls the SDK query's `interrupt()` and leaves the pump's turn claim in place until the interrupted turn's result callback releases it. The pump then emits `delivered` when it yields that item. Other items retain FIFO order. An idle session admits the selected item without an interrupt. A failed or timed out interrupt restores the item's prior position and returns `INTERRUPT_FAILED`; it remains queued. The existing Stop path still withdraws its queue before interrupting.

The RPC keeps a Claude item bound until its delivered state event. The renderer leaves it queued after an interrupt receipt, then lets the delivered event settle its bubble. Codex keeps its existing immediate `steered` behavior.

## Files

- `libs/shared/src/lib/types/follow-up-queue.types.ts:37` — result mode and failure code.
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts:116` — promotion, queue order, and failure restoration.
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:121` — in-flight promotion guard.
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts:183` — result gated SDK interrupt with timeout.
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:911` and `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1880` — adapter delegation.
- `libs/backend/rpc-handlers/src/lib/chat/follow-up/chat-follow-up-queue.service.ts:198` — retain Claude binding until delivery.
- `libs/frontend/chat/src/lib/services/chat-store/follow-up-queue.service.ts:256` — Claude availability, receipt handling, and error note.
- `libs/frontend/chat/src/lib/components/molecules/queued-follow-ups/queued-follow-ups.component.ts:42` — provider label, aria label, stable test IDs.
- Specs: `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-follow-up-queue.spec.ts:48`, `libs/backend/rpc-handlers/src/lib/chat/follow-up/chat-follow-up-queue.service.spec.ts:303`, `libs/frontend/chat/src/lib/services/chat-store/follow-up-queue.service.spec.ts:460`, `libs/frontend/chat/src/lib/components/molecules/queued-follow-ups/queued-follow-ups.component.spec.ts:113`.

## Verification

- `npx jest --runInBand -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-follow-up-queue.spec.ts`: 6 passed.
- `npx jest --runInBand -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/chat/follow-up/chat-follow-up-queue.service.spec.ts`: 17 passed.
- `ptah_get_diagnostics` was attempted twice for changed source files; TypeScript checks remained unavailable after 45 seconds. Renderer specs were written but not run, per task restriction on Nx and Playwright.

## Limits

The focused pump spec verifies that the selected queued item waits for turn release and runs first. It does not execute a live Claude SDK turn, so preservation of a partial assistant reply relies on the existing stream transformer result ordering and on this path leaving conversation history untouched.

## Decisions

- Use the existing session queue and result callback, instead of handing the message directly to the SDK. Evidence: the pump already holds all later messages behind `turnInFlight`; direct mid-turn messages can be folded into the active turn. Reversible: yes.
- Keep the existing Stop interrupt behavior separate from the Send now interrupt. Evidence: Stop releases the pump immediately, while Send now must wait for the terminal result. Reversible: yes.
