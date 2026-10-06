# TASK_2026_617 - Batch 0 live probes (grok 1.0.46, win32)

Run 2026-10-06 against `C:\Users\abdal\.grok\bin\grok.exe` 1.0.46, always `grok agent [--always-approve] --no-leader stdio`, and against the **live Ptah host** (Ptah.exe, MCP HTTP server on port 51820). No repository code was written. Fixtures are in `acp-batch0-fixtures/` (sanitized: home path, UUIDs remapped, thought signatures dropped; each line is `{ms, dir: in|out|stderr|exit, msg}`).

## Verdicts

| Probe | Verdict | One-line evidence |
| --- | --- | --- |
| **P1 Ptah MCP through search_tool/use_tool** | **PASS, no prompt hint needed** (P1 does not trigger the stop-and-redesign rule) | `mcpToolCount: 59` (real server, `tools/list` also 59); with the plain prompt Grok called `search_tool` then `use_tool` for `ptah__ptah_agent_list` (7 agents returned) and `ptah__ptah_agent_report`, which came back `## Report Delivered ... **Parent Session:** <real parent>`; 3 model calls, 10.8 s |
| **P2 permissions** | **PARTIAL: allow PASS, reject FAILS the plan's criterion** | `allow-once` ran shell, file write and a Ptah MCP tool (3 requests). `reject-once` ended the turn with `stopReason:"cancelled"` / `cancellationCategory:"PermissionRejected"`, not `end_turn`, and aborted the other parallel calls |
| **P2 resume / load** | **PASS (resume), replay confirmed (load)** | `session/resume` replayed 0 `user_message_chunk` and recalled `ZEBRA-4471`; `session/load` replayed 1 `user_message_chunk` + 1 `agent_message_chunk`, each tagged `_meta.isReplay:true`, and also recalled the token |
| **P2 cancel + grandchild** | **PASS** | `session/cancel` to response in 21 ms (`stopReason:"cancelled"`); the `node` sleep grandchild (pid existed 6 s into the turn) was gone 2 s after cancel |
| **P3 transcripts / failures** | **PASS** | 6 transcripts replayed through `@agentclientprotocol/sdk@1.7.0` `ClientSideConnection`: 0 "Error handling notification" (negative control with a bogus chunk produced 1, so the detector works). Error texts recorded below |

Caveats that limit these verdicts are in "What is not established".

## Environment facts

- Ptah MCP: `[::1]:51820` LISTENING (pid of the running Ptah.exe); `http://localhost:51820/` answers JSON-RPC (`serverInfo.name:"ptah"`). The URL was built exactly as `ptahMcpServerUrl(port, workingDirectory, agentId)` does (`ptah-mcp-url.ts`, opencode uses it at `opencode-cli.adapter.ts:539`): `http://localhost:51820/agent/<id>/workspace/<encodeURIComponent(worktree)>`. Entry shape sent: `{"type":"http","name":"ptah","url":"...","headers":[]}`.
- Real tracked agent id: the host holds records only for a limited time (all 28 pre-existing ids vanished mid-session), so I spawned one trivial codex lane via `ptah_agent_spawn` (id used as `/agent/<id>`) to get an attributable id.
- Only one model exists: `grok-4.7` (`session/new` -> `models.availableModels`). One earlier run reported `modelId:"grok-4.6"` in `_meta` (that log was lost, see below); `-m grok-4.6` is rejected as unknown.

## P1 - Ptah MCP through `search_tool` / `use_tool`

Prompt (no hint): "Using the Ptah MCP server: (a) find and call a read-only Ptah tool that lists the available agent CLIs, and tell me how many it lists; then (b) call the Ptah tool that reports back to the parent session with the short message ...".

Quoted lines (`grok-p1-ptah-mcp-search-use-tool.ndjson`):

```
out  {"method":"session/new","params":{"cwd":"...\\p1","mcpServers":[{"type":"http","name":"ptah","url":"http://localhost:51820/agent/<id>/workspace/<workspace-encoded>","headers":[]}]}}
in   {"method":"_x.ai/mcp_initialized","params":{"mcpToolCount":59,"elapsedMs":44}}
in   tool_call search_tool {"query":"ptah list agent CLIs available","limit":10}   (+ a second parallel search_tool)
in   tool_call use_tool {"tool_name":"ptah__ptah_agent_list","tool_input":{}}
in   tool_call use_tool {"tool_name":"ptah__ptah_agent_report","tool_input":{"message":"b0 probe nohint attempt 5 ..."}}
in   rawOutput {"type":"MCP","tool_name":"ptah_agent_report","server_name":"ptah","output":{"OkayOutput":"## Report Delivered\n\n\n**Delivered:** Yes  \n\n**Parent Session:** <uuid>\n"}}
in   rawOutput {"type":"MCP","tool_name":"ptah_agent_list","server_name":"ptah","output":{"OkayOutput":"## Available Agents\n\n\n**Total:** 7 ..."}}
```

- Server tool count: `tools/list` on the same URL returned 59 tools (includes `ptah_agent_report`, `execute_code`, `ptah_session_*`, browser, harness). `mcpToolCount` matched.
- Cost: 3 model calls total for the two tool calls (call 1: two parallel `search_tool`; call 2: two parallel `use_tool`; call 3: final text). The overhead versus a direct tool call is the single `search_tool` round, within the plan's "at most 2 extra model calls". Wall time 10.8 s for the prompt (9.9 s and 14.2 s in two earlier passes); `session/new` 0.3-1.1 s; `mcp_initialized` 17-44 ms.
- Attribution: the delivered report named the real parent session (the Claude session that owned the spawned lane). Counter-evidence of how the router behaves with a wrong id, observed live: fake id -> `Reason: unattributed-caller`; known id whose parent never resolved -> `no-parent-recorded`; repeated identical text -> `duplicate-report`. So the `/agent/<id>` segment is parsed and used, and the lane can call `ptah_agent_report` through Grok.
- Hint variant (exact tool names via `use_tool`): ran in the first pass (4 model calls, both tools reached the server, 16.9 s). Not needed for the verdict, since the plain prompt passes. Re-running it later was blocked by quota (see below), so no hint transcript is kept.
- The model figured out the `ptah__<tool>` naming by itself from `search_tool` results; a task-prompt sentence is not needed, but naming `ptah_agent_report` in the lane's task prompt/profile still saves the first `search_tool` round for that tool.

## P2 - permissions, resume, cancel

**Permission requests** (no `--always-approve`, `grok-p2-permission-allow-once.ndjson`): one prompt asking for a shell command, a file write and a Ptah tool in parallel produced three JSON-RPC requests:

| `toolCall.kind` | `title` | note |
| --- | --- | --- |
| `execute` | ``Execute `echo b0 > shell.txt` `` | `_meta["x.ai/tool"].name = run_terminal_command` |
| `edit` | ``Write `...\edit.txt` `` | `name = write` |
| `other` | `ptah__ptah_agent_list` | `name = use_tool`, `read_only:false`. **Every MCP call through `use_tool` is gated, even read-only ones.** `search_tool` produced no request |

Options on each request: `{"optionId":"always-allow","kind":"allow_always"}`, `{"optionId":"allow-once","kind":"allow_once"}`, `{"optionId":"reject-once","kind":"reject_once"}`, `{"optionId":"reject-always","kind":"reject_always"}`. Replying `{"outcome":{"outcome":"selected","optionId":"allow-once"}}` to all three: `shell.txt` and `edit.txt` were created and the Ptah tool returned its list (`rawOutput` `type:"MCP"`).

**Reject** (`grok-p2-permission-reject-once.ndjson`): reply `{"result":{"outcome":{"outcome":"selected","optionId":"reject-once"}}}` to the first request:

```
tool_call_update status:"failed"  "User rejected the execution for tool `run_terminal_command`"
_x.ai/session/prompt_complete {"stopReason":"cancelled","cancellationCategory":"PermissionRejected","cancellationContext":{"tool_name":"run_terminal_command","reason":"User rejected the execution"}}
{"id":2,"result":{"stopReason":"cancelled", ...}}
```

Only 1 of 3 parallel calls ever produced a request, and neither file was created. This does **not** meet the plan's "refused tool and the turn still ends `end_turn`". A reject aborts the whole turn.

**Resume vs load** (`grok-p2-session-resume.ndjson`, `grok-p2-session-load-replay.ndjson`): process 1 `session/new` + "Remember the token ZEBRA-4471" (`end_turn`, 1 model call), process killed, process 2:
- `session/resume {sessionId, cwd, mcpServers:[]}` -> result keys `models, configOptions, _meta`; replayed `user_message_chunk` 0, `agent_message_chunk` 0; next prompt answered `ZEBRA-4471` (`end_turn`, 11.2 s).
- `session/load` same params -> replayed `user_message_chunk` 1, `agent_message_chunk` 1, each carrying `_meta.isReplay:true` (`"isReplay":t...` in the first chunk's `_meta`); next prompt answered `ZEBRA-4471`.

**Cancel mid-shell** (`grok-p2-cancel-mid-shell.ndjson`, `node -e "setTimeout(()=>{},45000)"`):
- node pid present before cancel (found by command line via CIM, 6 s after the permission was allowed); `session/cancel` sent -> prompt response `stopReason:"cancelled"` after **21 ms**; pid absent 2 s later and after killing grok. Grok kills the shell child on cancel, so the plan's grandchild-survival risk did not materialize in this run. (A hard kill of grok while a command runs was not tested; the manager's tree-kill stays as the backstop.)

## P3 - transcripts and failures

Fixtures: plain turn (`grok-plain-turn`), tool+MCP turn (`grok-p1-...`), permission allow/reject, cancel, load replay, resume, 429, signed-out, `-m` flag, set-model.

- **SDK replay:** all inbound lines with a `method` (notifications and permission requests; responses skipped) from 6 transcripts (`p2-allow`, `p2-reject`, `p2-cancel`, plain, load, P1 success) fed through `ClientSideConnection(ndJsonStream)` from `@agentclientprotocol/sdk@1.7.0` (installed in a temp dir). Zero `console.error("Error handling notification", ...)` (the string is at `dist/jsonrpc.js:788`). Standard kinds seen: `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `available_commands_update`, `session_info_update`, `user_message_chunk`. `_x.ai/*` notifications did not error either. A negative control (a `session/update` with `content.type:"bogus"`) produced exactly 1 error, so the detector is valid.
- **Provider error (quota):** the prompt response is a JSON-RPC error, not a `stopReason`:
  `{"id":2,"error":{"code":-32003,"message":"Rate limited","data":"API error (status 429 Too Many Requests): subscription:free-usage-exhausted: You've used all the included free usage for model grok-4.7 for now. Usage resets over a rolling 24-hour window — tokens (actual/limit): 611385/600000. ..."}}`
  Before it, `_x.ai/session_notification {"sessionUpdate":"retry_state","type":"retrying","attempt":1,"max_retries":15,"reason":"API error (status 429 ...)","error_type":"rate_limited"}` and a stderr `ERROR responses API error status=429`. Time to failure varied from 3 s to about 50 s (retries). The `data` field was a string in some runs and an object `{message, promptUsage}` in others. The adapter must handle both and treat `-32003` as a vendor error with `done` 1.
- **Signed out** (`USERPROFILE/HOME/APPDATA/LOCALAPPDATA` pointed at an empty dir): `initialize` still succeeds with `authMethods:["grok.com"]`; `session/new` fails `{"code":-32000,"message":"Authentication required","data":"no auth method id provided"}`; process stays alive.
- **Model selection:** `grok agent -m nonexistent-model stdio` does **not** fail: `initialize` and `session/new` succeed and `currentModelId` stays `grok-4.7` (the flag is silently ignored by `agent stdio` in this build). Changing model has to go through ACP: `session/set_config_option {configId:"model", value:"nonexistent-model"}` and `session/set_model {modelId:"nonexistent-model"}` both return `{"code":-32602,"message":"Invalid params","data":"unknown model id"}` (so the adapter learns a bad model id immediately, before any turn). The earlier `grok -p -m nonexistent` failure (exit 1) from `grok-probe.md` is a different path.

## What is not established

1. **Quota blocked parts of the work.** My probes consumed the free allowance (611385/600000 tokens, rolling 24 h), after which only the first model call of a turn succeeded intermittently and later calls returned 429. Consequences: (a) the **hint** variant of P1 was run only in the first pass (console output, not kept), and a re-run failed on 429; (b) the P2 reject/allow turns never reached a second model call, so "does the turn complete after allow-once" is shown by files created and tool output, not by a closing `end_turn`; (c) a model-visible reaction to `reject-once` (the plan's "model continues") is moot, since the turn is cancelled.
2. **Lost first-pass P1 logs.** My cleanup `rm` deleted the first three P1 logs (fake id, stale id, hint). Their results are quoted from the console of this session only: fake id -> `unattributed-caller`, 3 calls 9.9 s; stale agent id -> `no-parent-recorded`, 3 calls 16.8 s; hint + stale id -> `unattributed-caller` (record had been evicted), 4 calls 16.9 s. The kept success transcript is the fifth attempt of the plain prompt (attempts 1-4 died on 429 after the first model call; their logs are not fixtures).
3. A report that is "attributed" was verified by the router's own `Report Delivered` text, not by the host's log (no host-side log of `tools/call` on the `/agent/<id>` route was reachable).
4. `reject-always`, `allow_always`, and a client that never answers a permission request were not run.
5. Hard kill of grok mid-command (not via `session/cancel`) and non-Windows behaviour were not tested.
6. Only the first turn after `session/new` was measured for `search_tool` overhead; whether a second use in the same session skips it was not measured.

## Plan changes implied

1. **P1 passes, so Decision 2 (supportsMcp=false, stop-and-redesign) is not triggered.** The prompt-hint sentence is optional. Keep `supportsMcp = true`. Gate and cost: 3 model calls and about 25k input tokens on the first tool turn.
2. **Permission policy (Component 4).**
   - MCP tool calls are permission-gated (kind `other`, title `<server>__<tool>`). A policy that auto-approves must answer these too, or the lane stalls on `ptah_agent_report`.
   - `reject_once` cancels the whole turn with `stopReason:"cancelled"` and `cancellationCategory:"PermissionRejected"`. If the policy ever rejects, the mapper must map that to a "permission refused" result, not to a user stop, and `end_turn` cannot be assumed. The plan's fallback applies: `alwaysApproveFlag: true` (or allow-once answers for every request) as the default.
   - Option ids are `allow-once`/`reject-once`/`always-allow`/`reject-always`; select by `kind`, not by id string.
3. **Resume/load (Component 2/5).** `session/resume` needs no replay suppression. If `load` is used, suppress by `_meta.isReplay === true` instead of heuristics. Prefer `resumeStrategy: 'resume'`.
4. **Cancel.** `session/cancel` is clean and reaps the shell child; the interrupt path needs no extra tree-kill. A queued prompt starts by itself after a cancel (from `grok-probe.md`), so keep the "interrupt then send / interrupt and drop queue" handling.
5. **Model handling (Component 6 / `grokModel`).** Do not rely on `-m` on `grok agent`. Apply the configured model with `session/set_config_option {configId:"model"}` after `session/new`, and surface its `-32602 unknown model id` as the error. The list of valid ids comes from `session/new.models.availableModels` (one entry on this account).
6. **Error mapping (Component 3/5).** Add table rows: JSON-RPC `-32003 Rate limited` on `session/prompt` (data may be string or object; includes retries up to 15, so failure can take about 50 s), `-32000 Authentication required` on `session/new`. A mid-turn quota failure produces a `retry_state` notification stream first; the mapper should ignore it or emit one `info`.
7. **Fixtures for Batch 3:** copy from `acp-batch0-fixtures/`. A fixture spec should assert 0 SDK notification errors over the six listed transcripts (the replay script is a 20-line `ClientSideConnection` + `ndJsonStream` harness; the detector is `console.error` capture, validated by a negative control).

## Cleanup

- All grok sessions created by these probes were deleted with `grok sessions delete` (`No sessions found.`), plus their `~/.grok/sessions/...grok-b0...` folders. No grok process remains (`tasklist`). Throwaway scripts and raw logs are under `%TEMP%\grok-b0` (outside the repo).
- `~/.grok/leader.lock` and `leader.log` pre-date this run (timestamps 2026-10-06 03:12 / 03:16, from the earlier `--leader` probe); I did not create, change or delete them. No `--leader` was used.
- Spawned one codex lane through the live Ptah host (id used for attribution); it has since been evicted by the host's retention. Its `ptah_agent_report` deliveries landed in the Claude session that ran this batch (probe text "b0 probe ... attempt N"), nothing else.
- Repository: only `.ptah/specs/TASK_2026_617_e5d4/acp-batch0-probe.md` and `.ptah/specs/TASK_2026_617_e5d4/acp-batch0-fixtures/` are new, uncommitted.
