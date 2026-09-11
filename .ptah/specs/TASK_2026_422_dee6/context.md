# TASK_2026_422 — Context

## Origin

Found while verifying TASK_2026_420 (team-leader rejection R1, see
`TASK_2026_420_84d9/batches.md`). TASK_2026_420 removed its own dependency on
`nativeUuid` anchoring, so this bug no longer reorders the transcript; it
still affects fork and rewind.

## Defect

`TabManagerService.reconcileUserMessageNativeUuid`
(`libs/frontend/chat-state/src/lib/tab-manager.service.ts` ~1541) targets the
first user message with a non-UUID id and no `nativeUuid`.

Scenario:

1. A direct send fails. The optimistic bubble stays (non-UUID id, no
   `nativeUuid`) and a "Message delivery failed" message is appended.
2. The next send succeeds. The SDK's user `message_start` echo carries the real
   transcript uuid; `StreamingHandlerService.processEventForTab` calls
   `reconcileUserMessageNativeUuid`, which stamps the FAILED bubble.
3. The new bubble stays unstamped. Fork / rewind (`nativeUuid ?? id`, commit
   ebbcaa16f) on the new message anchors on its optimistic id, and on the
   failed message anchors on a uuid that belongs to a different prompt.

## Fix direction (to validate)

Stamp the most recent unstamped optimistic user bubble, or skip bubbles that
are followed by a delivery-failure message. Add a spec with the failed-send
sequence.
