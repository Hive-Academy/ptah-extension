# Batch F6 report - single-chat in-place view uses the lane (Decision 2 = yes)

## Files changed

- MODIFIED `libs/frontend/chat/src/lib/components/organisms/transcript/single-chat-subagent-view.component.ts`
  - looks up `AgentMonitorStore.subagents().get(node().toolCallId)`; with a record it renders
  `<ptah-subagent-lane [record] [sessionId]="rec.parentSessionId ?? null" [getPermissionForTool]
  (permissionResponded)>` (stats bar + always-visible composer); without one it keeps the
  `ptah-execution-node` body. Back, entry focus and Escape (editable-field guard) unchanged.
- MODIFIED `.../single-chat-subagent-view.component.spec.ts` - lane with a record (record, session,
  permission lookup and response forwarded), node fallback that switches when a record appears,
  Escape inside the lane's input keeps the view.

## Acceptance

- Component 10 seam met. The bubble is not edited (it is simply not mounted when the lane is).
  chat-transcript specs that open a sub-agent stay green.

## Checks

- `npx jest -c libs/frontend/chat/jest.config.ts .../single-chat-subagent-view.component.spec.ts
  .../chat-transcript.component.spec.ts --coverage=false --maxWorkers=2`: PASS (2 suites, 50 tests).
- `npx nx typecheck @ptah-extension/chat --parallel=1`: PASS.

## Notes

- The lane's `sessionId` is the record's `parentSessionId` (no transcript template change). A record
  without it gets no tray context, so the composer shows follow-up only when a session is known, else
  the "session is not open" notice.
