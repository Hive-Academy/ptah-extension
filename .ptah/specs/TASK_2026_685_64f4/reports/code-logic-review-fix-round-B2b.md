# Code Logic Review - TASK_2026_685 fix round (3330e805f, baa2cb740) and batch B2b (ecae2eeab)

Method: read-only. Diffs read with `git show`, files read in full where cited. No tests were run: scoped `ptah_get_diagnostics` timed out ("TypeScript check still running after 45s", 2 files unchecked), and the lane reports say none of their code was executed either. Runtime and type correctness of all three commits is therefore unverified, by me and by the authors. The conclusions below come from reading.

## Part 1 - Re-review of the fix round

Score: 8/10. Verdict: APPROVED, with minors. All four earlier Moderate findings are resolved. No new Blocking or Moderate defect.

| # | Earlier finding | Status | Evidence |
|---|---|---|---|
| 1 | Replay ids depend on `Date.now()` | RESOLVED | `session-replay.service.ts:~496` now passes `0` as `parentTimestamp`. The missing-`message.id` fallback is `agent_msg_${parent}_${messageIndex}_${msg.uuid ?? 'line'}` (`:~544`). The missing-tool-id fallback is positional (`:~580`). `sequence` only advances inside `eventTime()`, so ids and timestamps are the same across calls. The new spec replays twice. |
| 2 | `continued` / `continues` disagree across skipped lines | RESOLVED | `continues` now scans forward to the next assistant line with array content (`:~656-664`). That is the same skip rule as the main loop (`:~534-537`), so `message_complete` and the merge decision agree. |
| 3 | Lane drops the agent's `summaryContent` | RESOLVED | `canvas-lane-view.component.ts:~146` passes `[summaryContent]`. `subagent-lane.component.ts` renders `<ptah-agent-summary>` ahead of the nodes. `AgentSummaryComponent` is imported (`:5`, `:19`). |
| 4 | `skipStoreEffects` partial | RESOLVED | `accumulator-core.service.ts:506` (registerAgent and the pending-delta fold), `:606-626` (background_agent_*, agent_progress, agent_status, agent_completed) now honour the flag. Together with the existing guards at `:452`, `:511`, `:550`, every `backgroundAgentStore` / `agentMonitorStore` / `sessionManager` call in the core is guarded. |
| 5 | Contradictory empty states | PARTIAL | `suppressEmpty` removes "No output recorded" as asked. It is bound to `!agentNode()`, so it also hides "Starting agent" while a live agent has no node yet, and the lane body is blank. See Minor P1-a. |
| 6 | Accessibility parity | MOSTLY RESOLVED | `aria-controls`, focus into the steer input on open, and Escape returning focus to the toggle are added. Stop and Background now ignore repeated clicks, and the store records RPC errors in `commandError` (`agent-monitor.store.ts:2549-2575`). Remaining details are Minor P1-b. |
| 7 | B2a reader details | PARTIAL | Resolved: the validation rethrow (`session-history-reader.service.ts:~216`) and the tail slice, which now starts on a `message_start` (`:~198-211`). Not resolved: `AGENT_ID_PATTERN` is still reused for `toolCallId` (`:~147`), and `agentId` is still not cross-checked against `toolCallId`. The dead assistant `tool_result` branch is unchanged. |
| 8 | B3a minors | NOT RESOLVED | The fix commits do not touch `execution-tree-builder` cache identity, `ownedByRealRoot`, or the one-shot cap warning. These are Minor and were not required. |

### New defects introduced by the fix diffs

None Blocking or Moderate. Minor items:

- P1-a. `subagent-lane.component.ts` (`@empty` block) and `canvas-lane-view.component.ts:~147`. `[suppressEmpty]="!agentNode()"` also silences the "Starting agent" copy. This happens when a live lane has no node yet and no saved-transcript fallback is showing. Fix: suppress only when the saved-transcript fallback is active and the agent is not live.
- P1-b. `aria-controls="subagent-steer-<id>"` points at an element that exists only while the input is open. Escape handling is on the input host element, so it works only while focus is inside it. `onStop` and `onBackground` have a `finally` but no `catch`. This is safe today because the store methods record their own errors, but a thrown rejection would be unhandled. Two lanes sharing a `parentToolUseId` would produce duplicate ids, which is unlikely.
- P1-c. Preserve-mode fallback timestamps are now `0 + n*0.0001` (1970) when a JSONL line has no parseable timestamp. Ids are stable, but anything that renders or sorts these timestamps (durations, "time ago") will show epoch values for such lines. Fix: derive the fallback from the first parseable timestamp in the file, or from the line index offset against it.
- P1-d. The `agent_start` guard in the core also skips the fold of `pendingDeltas` into `summaryContent` for isolated per-agent states. That is correct for isolation, but an isolated state never gets a summary from live deltas, so the lane relies on `agentNode().summaryContent` being set some other way. Confirm in B3b.

## Part 2 - First review of B2b (ecae2eeab)

Score: 6.5/10. Verdict: CHANGES REQUESTED. There are no Blocking issues and two Moderate ones. The registration, validation and byte-budget work is solid. The paging contract is weak against transcripts that change between page requests.

### Checked and sound

- Registration. The method is in `RpcMethodRegistry` (`rpc.types.ts` after the `subagent:transcript` entry), in `RPC_METHOD_ENTRIES`, in `SubagentRpcHandlers.METHODS` with `satisfies readonly RpcMethodName[]`, and registered in `register()` (`subagent-rpc.handlers.ts:~95,~124`). The name matches none of the host-source baseline words (`turn|recap|...|usage`), so the baseline contract spec is unaffected. No separate allowlist file names `subagent:transcript` outside these places, so there is nothing else to extend.
- Zod boundary. `subagent-rpc.schema.ts` limits `toolCallId` and `agentId` to `^[A-Za-z0-9_-]{1,128}$`. `maxBytes` is an integer from 1024 to 262144 with a default. `cursor` is a string, checked in the handler with `^(0|[1-9][0-9]*)$` plus `isSafeInteger`. Malformed cursors are rejected before any read. All of this runs before file access.
- Pagination edges. An empty transcript gives `done: true` and `nextCursor: null`. A cursor equal to the length gives an empty terminal page. A cursor greater than the length gives `INVALID_PARAMS`. A negative or non-decimal cursor is rejected. The page always holds at least one event (`subagent-history-page.ts:121-128`), so the cursor always advances. The final cut-back loop (`:129-132`) re-measures the whole envelope.
- Error paths. Handler failures are logged with the error name only, and the user message has no path. Coded errors are `INVALID_PARAMS` and `PERSISTENCE_UNAVAILABLE`, and both exist in `rpc-error-codes.types.ts` (lines 13 and 17).
- Message-boundary alignment. The page unit is the event, not the message. The plan allows this (implementation-plan.md, component 6, "Paging"), on the condition that the store accumulates and merges by id plus block index. Splitting a message across pages is therefore by design, but B3b must honour that condition.

### Moderate

M1. The cursor is an index into an array that is rebuilt on every call, so it is not stable for a transcript that changes.
- Evidence: `subagent-rpc.handlers.ts:~403-405` re-reads and re-replays the whole JSONL on each page. The cursor is `String(end)` (`subagent-history-page.ts:112`).
- Scenario A, live or growing agent. When a new JSONL line shares the last message's id, the previously emitted trailing `message_complete` disappears (`continues` becomes true in `session-replay.service.ts:~656-668`). Every later index shifts by one. A cursor taken just after that event now skips one event or repeats one.
- Scenario B, more than 10 000 events. The retained window is the last 10 000 events (`session-history-reader.service.ts:~197-211`). When the file grows, the window start moves, so every cursor points at different events. The page can silently skip or duplicate events, and `truncated` stays `true` so nothing signals it.
- Scenario C. A `tool_result` that arrives between two page requests changes an earlier `tool_start` or result event, because results are correlated from later lines.
- Impact: a lane for a running agent can lose or repeat blocks. The id-plus-blockIndex merge hides duplicates but not skips.
- Fix: make the cursor content-anchored, for example the id of the last emitted event plus its position, resolved against the fresh array. Or return a short transcript fingerprint (file size or last line index) and let the client restart when it changes. Or state in the contract that history paging is only valid for finished agents, and have the store refetch from 0 for running ones. Add a spec that grows the source between two calls.

M2. One unclippable event makes the whole agent's history unreadable.
- Evidence: `subagent-history-page.ts:96` throws `Agent history event exceeds RPC budget` when the 8-attempt clip loop ends over 96 KB. The loop only shrinks strings (`largestStringPath`), and breaks if there is no string (`:~72`). `:117` and `:134` also throw. The handler catch turns every throw into `PERSISTENCE_UNAVAILABLE` / "Could not read agent output" (`subagent-rpc.handlers.ts:~411-415`).
- Scenario: a `tool_start` input with a huge array of numbers or many small strings, or an event with many keys. The clip cannot reach the cap, so every page request that includes it fails permanently. The user sees a retryable-looking persistence error forever, and later pages are unreachable because the cursor cannot advance past the event.
- Fix: at the end of the loop, replace the event with a minimal placeholder that keeps `eventType`, ids and block index, and set `clipped: true`. This makes the plan's "guaranteed-terminating fallback" actually terminate.

### Minor

- m1. The reader's validation error (`Invalid agent id`, `Invalid tool call id`, invalid session id) is thrown inside the handler's `try`, so it surfaces as `PERSISTENCE_UNAVAILABLE`, not `INVALID_PARAMS` (`subagent-rpc.handlers.ts:~406-415`). The Zod schema catches most of these first, but a correlated agent id that fails the pattern (`session-history-reader.service.ts:~172`) and `sessionId` (schema is only `min(1)`; the reader's `validateSessionId` is the real check) reach this path.
- m2. A `not-found` or `unresolved` result with a non-zero cursor, for example when the SDK prunes the file between pages, is reported as `INVALID_PARAMS` "Invalid agent history cursor" (`:~404`) and not as `status: 'not-found'`.
- m3. Cost: each page re-reads and re-parses the whole file (up to 50 MB per the plan) and re-runs replay. With a 2000-event page limit and a 10 000-event window this is up to 5 or more full reads per lane. Consider a small per-call cache keyed by file mtime and size.
- m4. `toolCallId` is limited to `[A-Za-z0-9_-]`. A provider that uses `.` or `:` in tool ids gets `INVALID_PARAMS` and no history. Same root cause as earlier finding 7.
- m5. A clipped `tool_start` input becomes `{ clipped: "<json text>" }` (`subagent-history-page.ts:~66`). Any renderer that reads typed fields from `toolInput` (for example `file_path`) loses them above 16 KB. Keep small scalar fields.
- m6. The cut-back branch (`:129-132`) has no spec, and the lane report says a multi-event overrun is not constructible. The branch is cheap, but it is untested, and `clippedEvents` digit growth is the only thing it protects against.
- m7. Nothing has been executed: no jest run for the shared, rpc-handlers or agent-sdk specs, and diagnostics were unavailable. The lane report lists the seven checks that remain to run.

## Five logic questions

1. Silent failure: M1 (skipped or repeated events with no signal); `truncated` stays `true` and is the only hint.
2. Unexpected user action: opening a lane for a running agent, or reloading while it writes, shifts the cursors (M1). Double-clicking Stop or Background is now guarded.
3. Wrong answer from valid input: transcripts with a trailing same-id continuation, more than 10 000 events, or lines with no timestamps (1970 timestamps, P1-c).
4. Dependency failure: a read error maps to a user-safe `PERSISTENCE_UNAVAILABLE` (fine). A poison event converts into a permanent failure (M2). A file pruned between pages becomes `INVALID_PARAMS` (m2).
5. Missing: a stable cursor or change detection; a placeholder fallback for unclippable events; a test that grows the transcript between pages.

## Verdicts

- Part 1 (fix round): 8/10, APPROVED. 4 of 4 Moderate resolved; 2 Minor partial; B3a minors left open; no new Blocking or Moderate.
- Part 2 (B2b): 6.5/10, CHANGES REQUESTED. 0 Blocking, 2 Moderate (M1, M2), 7 Minor. Because there is no further fix round, the user should either accept M1 and M2 as known limits (history paging for finished agents only) or schedule a follow-up before B3b depends on this cursor.
