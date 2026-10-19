# Batch F1 report - chat-streaming: task field and store fixes

## Files changed

- MODIFIED `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts` - new
  `SubagentRecord.taskDescription`; `onAgentStart` writes it from `agentDescription`, the progress,
  status and completed reducers carry it (spread-based merges carry it automatically).
- MODIFIED `libs/frontend/chat-streaming/src/lib/agent-monitor.store.spec.ts` - start (stream and
  history source) -> progress -> status -> completed keeps `taskDescription` while `description`
  follows progress; no start -> field unset.
- MODIFIED `libs/frontend/chat-streaming/src/lib/subagent-execution.store.ts` - m1: `remove()`
  bumps and then deletes the key's revision signal; m3: `syncRecord` adopts the record's
  `parentSessionId` when it differs and resets `not-found`/`error`/`unresolved` history to `idle`;
  D5a: `ensureHistory` on an unknown key logs `logger.warn` (`degradation-audit: reported`).
- MODIFIED `libs/frontend/chat-streaming/src/lib/subagent-execution.store.spec.ts` - seams (a), (b)
  (plus the same-session sticky case), (c).

## Acceptance

- Component 1 and 2 verification seams: met (specs above).
- `description` semantics unchanged; tray/inspector specs untouched and green.

## Checks

- `npx nx test @ptah-extension/chat-streaming --parallel=1`: PASS (28 suites, 688 passed, 1 skipped).
- `npx nx typecheck @ptah-extension/chat-streaming --parallel=1`: PASS.
- `npx nx lint @ptah-extension/chat-streaming --parallel=1`: PASS (0 errors, 17 pre-existing warnings).
