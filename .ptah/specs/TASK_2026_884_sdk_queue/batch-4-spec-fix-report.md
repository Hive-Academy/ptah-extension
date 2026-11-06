# Batch 4 spec follow-up

## Changes made

| Suite | Cause | Spec change | Production fix |
| --- | --- | --- | --- |
| `chat-message-handler.service.spec.ts` | `ChatMessageHandler` now injects `FollowUpQueueService`; the real provider transitively needs `SURFACE_ACTIVE`. | Provide a queue mock and assert that a queued-state push for a hidden tab reaches it. | None. |
| `message-sender.command-center.spec.ts` | The renderer queue-flush method was removed. | Keep the command-center owner-lock assertions for direct sends; remove the obsolete flush invocation. The backend queue and local slash-command delivery are covered in `follow-up-queue.service.spec.ts`. | None. |
| `streaming-handler.service.spec.ts` | Terminal `turn_state` now delegates to `TurnStateApplier` without looking up queued tabs. | Assert that no tab lookup or stream warning occurs. | None. |
| `generation-workflow.store.spec.ts` | The generation guard reads `QueuedFollowUpStore.forTab`, not `TabState.queuedContent`. | Provide a controlled queue and assert busy and queued rejection, then acceptance after the queue empties. | None. |

## Remaining suites

| Suite | Cause | Needed change |
| --- | --- | --- |
| `auto-handoff-source-closer.service.spec.ts` | Expectations use `queuedContent`; the coordinator now uses `QueuedFollowUpStore`. | Assert store entries and ordering after source closure. |
| `message-sender.service.spec.ts` | Multiple tests call removed `continueExistingSessionForQueueFlush` and assert renderer flush bubble/abort behavior. | Move backend submission assertions to `submitQueuedFollowUp`; keep normal `send` assertions for local slash commands. |
| `session-auto-handoff-coordinator.service.spec.ts` | Expects `queuedContent` and the removed flush method. | Assert local FIFO handoff items in `QueuedFollowUpStore` and dispatch via normal send when idle. |
| `session-budget-actions.auto-handoff.spec.ts` | Expects `queuedContent` and the removed flush method. | Assert queue store and withdraw/restore behavior. |
| `session-budget-actions.queue.spec.ts` | Expects `queuedContent` and the removed flush method. | Assert queue store and backend withdraw ordering. |
| `session-budget-actions.service.spec.ts` | Service gained `QueuedFollowUpStore` and `FollowUpQueueService` dependencies. | Provide mocks and assert actions against queue entries. |

`follow-up-queue.service.spec.ts` already has tests for backend submission, hidden-tab delivery, held slash-command FIFO, hidden-tab idle trigger, and Stop ordering. These were reviewed in source, not executed here.

## Verification

- `npx jest --runInBand -c libs/frontend/chat/jest.config.ts` with the eight requested chat specs: all eight suites stopped before test execution because esbuild worker spawn returned `EPERM`.
- Equivalent single-spec commands for chat-streaming and setup-wizard: each stopped before test execution with the same `spawn EPERM`.
- `ptah_get_diagnostics` scoped to the three changed project specs: twice returned `Unavailable`, TypeScript check still running after 45 seconds. No clean typecheck result is claimed.
- No production code changed. No `nx`, `npm run verify`, git, commit, push, or PR command ran.

## Decisions

- Retain the existing `follow-up-queue.service.spec.ts` coverage for hidden tabs, local slash-command FIFO, and Stop ordering; it matches the approved design and is the current owner of those behaviors. This is reversible if the coordinator wants the scenarios duplicated at an integration boundary.

## Limitation

The requested spec migration is incomplete. The six remaining chat suites above still contain outdated queue assumptions; their test assertions cannot be considered passing. Skill loading is unavailable in this lane (no skill-loading tool listed); repository guidance was followed directly.
