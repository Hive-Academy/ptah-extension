# Code Logic Review - TASK_2026_685 B2b fix round (aa1d41dd9)

Scope: `libs/backend/rpc-handlers/src/lib/handlers/{subagent-history-page,subagent-rpc.handlers,subagent-rpc.schema}.ts` read in full; specs skimmed; replay id generation in `libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts` and `session-history-reader.service.ts`; consumer `libs/frontend/chat-streaming/src/lib/subagent-execution.store.ts`. No tests run (static review; lane and team-leader report typecheck/lint/test pass).

## Verdict

Score 8/10. APPROVED WITH KNOWN LIMITS (no further fix round). 0 Blocking, 0 Moderate, 5 Minor.

## Previous findings

| Finding | Status | Evidence |
| --- | --- | --- |
| M1 unstable index cursor | RESOLVED | Cursor is `v1.` + base64url of `[event.id, eventType]` (`subagent-history-page.ts:16-18`). Handler re-reads, finds the anchor with `findIndex` and resumes at `position + 1` (`subagent-rpc.handlers.ts:~405-410`). Replay ids are `evt_<eventIndex>_<ts>` / `evt_agent_<toolCallId>_<eventIndex>_<ts>`; `eventIndex` is a per-replay counter and, in preserve mode, timestamps come from the JSONL (`session-replay.service.ts:496,525,549`), so ids are deterministic and unique and appends do not shift them. The 10,000-event window slice keeps ids, so only the anchor leaving the window triggers STALE. |
| M2 unclippable event blocks paging | RESOLVED | Fallback placeholder after the clip loop when still over 96 KB (`subagent-history-page.ts:~106-148`). It keeps `id`, `eventType`, `messageId`, `timestamp` and the optional identity fields only when defined, and `toolCallId`/`blockIndex`. Per-type shape keeps the required discriminating fields (`delta`, `toolName`+`isTaskTool`+`toolInput`, `isError`+`output`, `role`, `stopReason`), so the frontend accumulator and dedup key on the same identity. The cast `as FlatStreamEventUnion` in the `default` branch drops required fields of other types (see m-A). |
| m1 reader validation maps to PERSISTENCE_UNAVAILABLE | RESOLVED (fragile) | `subagent-rpc.handlers.ts:~412` maps three message prefixes to INVALID_PARAMS; the prefixes match the reader's messages (`session-history-reader.service.ts:148,151,261`). Schema `sessionId` now `^[A-Za-z0-9_-]+$` (`subagent-rpc.schema.ts:100`). See m-B. |
| m2 not-found/unresolved reported as bad cursor | RESOLVED | `read.status !== 'ok'` returns an empty page with that status before anchor lookup (`subagent-rpc.handlers.ts:~403`); store sets `history = page.status` (`subagent-execution.store.ts:~357`). |
| m3 per-page reread | NOT RESOLVED (deferred, documented) | Each page still re-reads and replays the file. |
| m4 tool id charset | NOT RESOLVED (deferred, documented) | `agentFileId` regex unchanged (`subagent-rpc.schema.ts:97`). |
| m5 clipped tool input loses typed fields | NOT RESOLVED (deferred, documented) | `{ clipped: ... }` shape unchanged (`subagent-history-page.ts:~79`). |
| m6 cut-back branch untested | RESOLVED | Lane reports a long-cursor spec; branch is at `:~178`. Not executed by me. |
| m7 nothing run | RESOLVED per reports | Team-leader reports typecheck/lint passed and one test failure that was a spec assumption, then fixed. I did not re-run. |

## Specific checks

- Token format and validation: `parseHistoryCursor` enforces `^v1\.[A-Za-z0-9_-]{1,4096}$`, JSON array of length 2, non-empty string id, event type in an allow-list, then round-trips through `historyCursor` so non-canonical base64 or whitespace is rejected (`subagent-history-page.ts:21-32`). The allow-list has all 20 members of `FlatStreamEventUnion` (`libs/shared/src/lib/types/execution/stream-background.ts:315-335`). Old numeric cursors are rejected as INVALID_PARAMS.
- Anchor gone: `HISTORY_CURSOR_STALE` is in the shared union (`libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts:23`) and is raised as `RpcUserError`, which the handler rethrows. The store does not special-case it: a non-success response throws `new Error(response.error ?? ...)`, the entry becomes `history = 'error'` with `historyError` set, and `ensureHistory` can be called again (only `loaded`/`not-found` short-circuit), restarting from `cursor = undefined` (`subagent-execution.store.ts:325-328,354,376-381`). It fails visibly and recovers on retry, but there is no automatic restart, and the partial `snapshot` is discarded (correct).
- Duplicate identities: ids carry a unique per-replay index, so `(id, eventType)` is unique in practice. `findIndex` returns the first match with no uniqueness check, so a duplicate would make the next page re-send events, and the store loop has no guard against a non-advancing cursor (m-C).
- Not-found / INVALID_PARAMS: as above; both paths are covered by specs per the lane report.

## New defects from the fix diff

None Blocking or Moderate. Minor:

- m-A. The `default` placeholder branch (`subagent-history-page.ts:~144`) builds `{ ...common, eventType, notice }` and casts it to the union. For `agent_start`, `agent_progress`, `agent_completed`, `background_agent_*`, `compaction_*`, `turn_state` it omits required fields (for example `agentId`, `result`). Those events are rarely near 96 KB, but when one is, the accumulator receives a malformed event. A narrower per-type placeholder or dropping the event with `clippedEvents` accounting would be safer.
- m-B. INVALID_PARAMS is decided by `error.message` prefix regex (`subagent-rpc.handlers.ts:~412`). A reader message edit silently reverts this to PERSISTENCE_UNAVAILABLE. Also `Invalid agent id` can come from a server-correlated id (`session-history-reader.service.ts:180`), which is then reported as the caller's fault. A typed error code on the reader would be better.
- m-C. No defense against a cursor that does not advance: if the anchor resolves to an earlier duplicate, `nextCursor` repeats and the store's `while (valid())` loop (`subagent-execution.store.ts:347`) would spin. Unreachable with current ids; a one-line `cursor === page.nextCursor` check in the store would close it.
- m-D. For a still-running agent with more than 10,000 events, every append shifts the window; an anchor near the window start becomes STALE and the user sees an error state rather than a retry. Acceptable for the stated finished-agent scope.
- m-E. The `eventTypes` allow-list is hand-maintained (`subagent-history-page.ts:9-14`), with no compile-time exhaustiveness check. A new union member would make its own cursors parse as INVALID_PARAMS mid-paging.

## Five logic questions

1. Silent failure: the earlier silent skip or repeat is gone; a lost anchor now errors. The remaining silent case is a malformed `default` placeholder (m-A).
2. Unexpected user action: reloading history while an agent writes now works for appends; a very long running agent can produce a STALE error (m-D), recoverable by retry.
3. Wrong answer from data: duplicate `(id, kind)` would repeat events (m-C); not reachable with the current replay.
4. Dependency failure: file pruned between pages returns `not-found`; read errors return PERSISTENCE_UNAVAILABLE with a fixed message and no path.
5. Missing: no automatic restart on STALE in the store; no per-call cache (m3).

## Decision for the user

Accept as is. No Blocking or Moderate items remain. Optionally schedule m-A and m-C as a small follow-up before B3b builds on the cursor.
