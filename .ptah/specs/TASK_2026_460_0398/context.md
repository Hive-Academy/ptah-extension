# TASK_2026_460 — `createChild` resets cost, tokens and createdAt

Found by the independent logic review of TASK_2026_452 (PR #517), round 2.
Recorded there for visibility and NOT fixed, because it predates that task and
the change did not introduce it.

## The defect

Two writers can reach the SAME session id on the Ptah CLI chat path:

- `SdkAgentAdapter`'s session-id callback calls `SessionMetadataStore.create`
  for every session (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`,
  the `createSessionIdCallback` body).
- `ChatStreamBroadcaster` calls `createChild` for the same id when the session
  is Ptah CLI backed
  (`libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts:205-222`).

Order decides the outcome:

- **`createChild` first, then `create`** — `create`
  (`libs/backend/agent-sdk/src/lib/session-metadata-store.ts:1128-1136`) finds an
  existing record and takes its early return, keeping the whole record and
  bumping `lastActiveAt` only. Correct.
- **`create` first, then `createChild`** — `createChild`
  (`session-metadata-store.ts:1166-1184`) unconditionally builds and saves a
  FRESH record. `_saveInternal`'s merge (`session-metadata-store.ts:456-471`)
  carries over only `isChildSession`, `cliSessions`, `workingDirectory` and
  `resumableSdkSubagents` — so `createdAt`, `totalCost` and `totalTokens` are
  silently reset to `now` / zero.

TASK_2026_452 made both writers pass the SAME name, so the NAME is consistent
in either order. The numeric fields are not.

## Proposed scope

- `createChild` preserves an existing record's `createdAt`, `totalCost` and
  `totalTokens` (and any other accumulating field) instead of overwriting them,
  or reuses `create`'s existing-record branch and then sets the child marker.
- Decide the rule once and state it beside the merge in `_saveInternal`, since
  that merge is the reason the asymmetry is invisible today.
- Specs for both orders, asserting name, `isChildSession`, `createdAt`,
  `totalCost` and `totalTokens`.

## Acceptance

- With `create` first and `createChild` second, the stored record keeps the
  original `createdAt` and the accumulated cost and token totals, and is marked
  as a child session.
- The reverse order behaves as it does today.
- No change to the session-name resolution shipped by TASK_2026_452.
