# Batch B2b review fix

## Changed files

- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\rpc-handlers\src\lib\handlers\subagent-history-page.ts` — versioned opaque cursor tied to the last delivered event's id and kind; strict canonical parser; real cursor length in envelope sizing; bounded visible fallback for oversized events.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\rpc-handlers\src\lib\handlers\subagent-history-page.spec.ts` — cursor assertion, unclippable event fallback, final cut-back branch.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\rpc-handlers\src\lib\handlers\subagent-rpc.handlers.ts` — resolve cursor against each fresh read, return `HISTORY_CURSOR_STALE` when its anchor is absent, preserve missing-file status, and map reader validation errors to `INVALID_PARAMS`.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\rpc-handlers\src\lib\handlers\subagent-rpc.handlers.spec.ts` — append, same-id continuation, missing anchor, malformed token, pruned file, and reader validation cases.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\rpc-handlers\src\lib\handlers\subagent-rpc.schema.ts` — session id format matches the reader's path-safe validation.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\.ptah\specs\TASK_2026_685_64f4\reports\batch-B2b-fix.md` — this report.

## Evidence and risks

- M1: Pages now resume after the exact last event, even when a growing transcript changes array positions. An anchor removed by a same-id merge or the retained-window shift yields `HISTORY_CURSOR_STALE` with a restart instruction. Malformed, noncanonical, unknown-kind, and old numeric cursors yield `INVALID_PARAMS` before reading. A pruned file returns `status: 'not-found'`.
- M2: An event that remains over 96 KB after clipping becomes a visible event of the same kind and identity with “Content too large to display”; paging advances over it. The unclippable numeric-payload spec covers this path.
- Minor m1: reader validation errors surface as `INVALID_PARAMS`; the schema also rejects unsafe session IDs before the read.
- Minor m2: `not-found` and `unresolved` statuses are returned before anchor lookup.
- Minor m6: a long encoded cursor forces and verifies the final cut-back branch.
- Deferred m3: a cross-request cache adds invalidation and lifecycle behavior beyond this fix; each request still rereads the transcript.
- Deferred m4: widening provider tool ids requires matching reader validation in agent-sdk, outside the five-file scope.
- Deferred m5: preserving typed scalar tool input while clipping requires a separate renderer-contract decision; the existing clipping behavior remains.
- Scoped `ptah_get_diagnostics` after the final source edit: 0 errors and 0 warnings, clean coverage. No tests, typecheck, lint, build, serve, e2e, or package commands were run, per lane rules.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use event id plus kind as a versioned cursor anchor | Array index; transcript fingerprint; event identity | Replay emits deterministic ids; index shifts under same-id merges and the 10,000-event window; wire cursor remains a string | Yes, with a cursor-version migration |
| Use `HISTORY_CURSOR_STALE` for a missing anchor | `INVALID_PARAMS`; persistence error; existing stale code | The shared RPC error union already defines `HISTORY_CURSOR_STALE`; a valid cursor can become stale as history changes | Yes |
| Return a kind-preserving visible fallback after clipping fails | Throw; omit event; fallback event | Throw permanently blocks later pages; omitting silently loses output | Yes |
| Return missing-file statuses before anchor lookup | Stale cursor error; status result | Reader explicitly distinguishes `not-found` and `unresolved` | Yes |

## Clarifications Needed

None for the assigned five-file fix.

## Check fix

- Team-leader check: rpc-handlers typecheck and lint passed; tests had 4,613 passes and one failure in the oversized-event spec. The failure was the spec's page-size assumption: the placeholder and short following event both fit in 1,024 bytes. No paging defect was found.
- Updated `subagent-history-page.spec.ts` to measure the serialized one-event page and following event, choose a budget that fits the first but not both, and assert that the first event equals the placeholder and the cursor advances past it.
- Updated `subagent-history-page.ts` so the fallback copies optional identity fields only when defined on the source event. The spec checks that absent `sessionId`, `parentToolUseId`, and `toolCallId` stay absent.
- Scoped `ptah_get_diagnostics` on those two files after the edits: 0 errors, 0 warnings. No test, typecheck, lint, build, serve, e2e, or package command was run in this lane.
