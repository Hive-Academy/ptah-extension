## Verdict

The calls were not denied by a user, a Ptah permission prompt, a hook, or a rate limit. Claude Code checkpointed the still-running background agents when the parent turn ended, aborted their active tool controllers with abort reason `background`, and rendered that cancellation with its canned “user doesn't want…” text.
The affected transcripts stamp the outcome as `toolDenialKind:"cancelled"`, and Ptah's `canUseTool` callback was never invoked for the rejected tool IDs. This is a background handoff/cancellation defect in Claude Code 2.1.270, not a permission-mode inheritance failure.
The six-call batch was incidental: a different agent's single `Read` and another agent's `Agent`/`Read` calls failed at the same post-parent-turn boundary.

## Evidence

1. `C:\Users\abdal\.claude\projects\D--projects-ptah-extension\e38ba305-6227-468f-bd8e-a04065f5d03e\subagents\agent-a55ff676a5ae88b40.meta.json:1` records the affected lane as `"requestShape":"background","requestNonInteractive":true`. The two other original lanes have the same fields in `agent-acae8ec7b7d2d4a58.meta.json:1` and `agent-ab6ba5c06607b1a47.meta.json:1`.

2. The parent stopped at `2026-09-18T19:22:55.489Z`: `C:\Users\abdal\.claude\projects\D--projects-ptah-extension\e38ba305-6227-468f-bd8e-a04065f5d03e.jsonl:104` contains the parent's final assistant text, “Three subagents run now. I wait for their reports.” The stop hook completed at `2026-09-18T19:22:55.514Z` on line 105.

3. The first rejected file read followed 2.845 seconds later. `...\subagents\agent-a55ff676a5ae88b40.jsonl:29-30`, timestamp `2026-09-18T19:22:58.359Z`, records `Read` and the exact canned text, but the top-level outcome is `"toolDenialKind":"cancelled"`, not `user-rejected` or `permission-rule`.

4. The first rejected network call shows the same classification. `...\subagents\agent-acae8ec7b7d2d4a58.jsonl:36-37`, timestamp `2026-09-18T19:23:02.764Z`, records `WebFetch` returning “The user doesn't want to take this action right now…” with `"toolDenialKind":"cancelled"`.

5. The failure was not specific to WebFetch or a six-call batch. `...\subagents\agent-ab6ba5c06607b1a47.jsonl:41-42` shows a single nested `Agent` call cancelled at `2026-09-18T19:23:08.817Z`; lines 48-49 show a subsequent single `Read` cancelled at `2026-09-18T19:23:17.317Z`.

6. Ptah was in unattended YOLO mode. `C:\Users\abdal\.ptah\settings.json:137-139` says `"autopilot":{"enabled":true,"permissionLevel":"yolo"}`. In `C:\Users\abdal\AppData\Roaming\Ptah\logs\Ptah Electron-2026-09-18.log:1969-1978`, five pre-boundary WebFetch calls invoke `SdkPermissionHandler` and are each logged as `YOLO mode: auto-approved tool: WebFetch`. Lines 1982-1988 likewise auto-approve subagent Bash calls through `2026-09-18T19:22:55.143Z`.

7. The rejected tool IDs never appear in the Electron log as `canUseTool invoked`. In particular, the log contains no occurrence of `toolu_01BEidXiCFazgdQ2gyohynPW` (rejected Read), `toolu_01LR28RKQypE8wxr9BBZjWuh` (rejected WebFetch), or `toolu_01KrgxftDuDniWqdPjZCK3gF` (rejected Read). Therefore no Ptah permission request was raised, waited on, timed out, or denied for these calls; cancellation occurred inside Claude Code before Ptah's callback.

8. The exact installed Claude Code 2.1.270 source embedded in `C:\Users\abdal\.local\share\claude\versions\2.1.270:1644803` implements background checkpointing as `checkpointAgents:async(D)=>{for(let C of w)C.abortController?.abort(Fc("background"))...for(let C of l)C.abortController.abort(Fc("background"))...}`. Line 1644804 repeats the same `Fc("background")` abort during exit handoff.

9. That same runtime maps the abort to the observed result. `C:\Users\abdal\.local\share\claude\versions\2.1.270:1639098` defines `kbs(e,n)` so an aborted operation whose reason is `background` returns `ij(bS)`, and `Ifr(e,n)` labels that path `"cancelled"`. Line 1632505 defines `bS` as the exact literal “The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed.”

10. This repository's own gate would have allowed both calls if reached: `libs/backend/agent-sdk/src/lib/permission/permission-tool-classifier.ts:13-30` classifies `Read` as safe; `sdk-permission-handler.ts:447-468` auto-allows safe tools; and `sdk-permission-handler.ts:504-511` auto-allows every tool in YOLO mode, including WebFetch.

11. The resumed run is a control case. The Electron log records a persistent resumed query with `promptMode:"idle+streamInput"` at `2026-09-18T19:26:23.768Z` (`Ptah Electron-2026-09-18.log:2091-2095`), followed by successful YOLO-approved WebFetch calls at lines 2126-2129, 2142-2143, 2156-2160, 2163-2164, and 2170-2184. Calls continued successfully even after session stats at line 2144, so concurrency and the parent merely becoming idle are not the cause; the failing boundary is the background checkpoint/handoff from the original completed turn.

12. No configured settings hook explains the outcome. `D:\projects\ptah-extension\.claude\settings.local.json:1-22` has only MCP and `permissions.allow`; `C:\Users\abdal\.claude\settings.json:1-20` has model/UI settings and no `hooks` key. The Electron log also contains no hook-denial record around the rejected IDs.

## Where the decision is made

The decisive path is inside Claude Code 2.1.270, before Ptah's callback:

1. The Agent launcher persists these lanes as background and non-interactive (`...\agent-*.meta.json:1`).
2. When Claude Code checkpoints/hands off the completed parent turn, `C:\Users\abdal\.local\share\claude\versions\2.1.270:1644803-1644804` aborts the carried background agents' controllers with reason `background`.
3. `C:\Users\abdal\.local\share\claude\versions\2.1.270:1639098` converts that abort to both the canned `bS` message and denial kind `cancelled`; line 1632505 contains the literal text seen in all three transcripts.
4. Because the abort happens before the permission callback, execution never reaches Ptah's `SdkPermissionHandler.createCallback` (`libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts:421-445`), its Read auto-allow (`:447-468`), or its YOLO auto-allow (`:504-511`).

Ptah does contribute the lifecycle shape for slash-command sessions: `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:308-319` supplies slash commands as a finite string prompt, while only resumed non-slash sessions attach persistent `streamInput` at lines 339-348. The installed SDK also treats string prompts as single-turn and closes input after the first result (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs:60`, `isSingleUserTurn` / `transport.endInput()`), which is consistent with the observed checkpoint immediately after the parent result.

## How to make background subagents run unattended

The reliable workaround is to keep the parent turn/control stream alive until its background agents finish: after spawning them, wait on `TaskOutput`/`Monitor` and do not emit the parent's final answer while they still need tools. The successful calls before `19:22:55.489Z` and the persistent resumed-query control case prove that the same YOLO access works while that lifecycle remains live.

The product fix is not another permission rule. Change the slash-command/background-agent lifecycle so `session-query-executor.service.ts:308-348` does not let a finite parent result checkpoint active background agents, or change the Claude Code checkpoint/handoff path represented by `2.1.270:1644803-1644804` to preserve/rebind active tool controllers. At minimum, a `background` abort must be surfaced as a retryable handoff cancellation rather than the user-denial string at `2.1.270:1639098`.

For genuinely unattended queries that do not need `AskUserQuestion` or `ExitPlanMode`, the repository already demonstrates the permission flags: `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:395-406` uses `permissionMode:'bypassPermissions'` plus `allowDangerouslySkipPermissions:true`. However, those flags address permission prompts; they are not proven to prevent the pre-callback background-controller abort diagnosed here. Likewise, adding `Read`/`WebFetch` to `.claude/settings.local.json` would not repair a call already stamped `cancelled` before Ptah is consulted.

## Not proven

- No human action occurred, and the evidence rules out a Ptah prompt timeout, stricter inherited mode, settings hook, rate limit, and batch-size trigger. The exact internal scheduler event name is inferred as checkpoint/handoff from Claude Code's 2.1.270 source and the immediate parent-turn boundary; Claude Code did not emit a dedicated “checkpointAgents invoked” log record for this session.
- It was not tested whether a future Claude Code release changes this behavior, or whether an upstream flag exists to keep a raw slash-command query bidirectional after its first result.
- `bypassPermissions` was not tested against this incident. Source shows it avoids `canUseTool`, but this failure is an abort before that callback, so it should not be presented as the primary fix.
