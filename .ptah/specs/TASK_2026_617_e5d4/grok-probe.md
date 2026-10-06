# Phase 0 - Grok CLI, probed

Run 2026-10-06 on win32. `grok --version` reports **1.0.46 (2765805b9442) [stable]** at
`C:\Users\abdal\.grok\bin\grok`, signed in with grok.com (`apiKeySource: "oauth"`, no `XAI_API_KEY`), default model
`grok-4.7`. Nothing in the repository was changed; this file is the deliverable.

Everything marked "observed" below came from a live process on this machine, run with cwd
`C:\Users\abdal\AppData\Local\Temp\grok-probe` (or `\p1`, `\p2`, `\p3` under it). Where I quote the bundled docs at
`~/.grok/docs/user-guide/*.md` I say so, and I treat that as a claim, not a measurement. Raw ACP transcripts are in
`acp-A.log`, `acp-B.log`, `acp-D.log`, `acp-E.log`, `acp-F.log` and `g1.log`..`g4b.log` in that temp directory.
Total model prompts: 11 (about 16-18k input tokens each, about USD 0.03-0.05 per cold turn).

## The answer in one paragraph

`grok agent stdio` (ACP) answers the questions Ptah's three modes ask. A second `session/prompt` sent mid-turn is
**queued** (`queue-next-turn` natively), `session/cancel` ends the running prompt in about 20 ms with
`stopReason: "cancelled"` and leaves the session usable (`interrupt-resume`), and an http MCP server with custom
headers can be injected **per session** through `session/new.mcpServers`. There is no mid-turn `steer`. Headless
`grok -p` has none of that (no per-process MCP flag, no live input channel) and yields the session id only at the end
in `streaming-json`. Do not use `--leader`: through the shared leader the MCP child process got the **leader's** env
and cwd, not the client's (the opencode 2.x trap, reproduced).

## 1. Headless `grok -p`

Command: `grok -p "Reply PONG" --output-format streaming-json --always-approve --no-alt-screen`
(stdout to file, stderr empty).

| Run | Exit | Wall time | Notes |
| --- | --- | --- | --- |
| `streaming-json`, "Reply PONG" | **0** | 4.2 s | 34 lines |
| `streaming-messages-json`, "Reply PONG" | **0** | 4.1 s | 3 lines |
| `streaming-json`, shell command that exits 7 | **0** | 6.7 s | tool failure does NOT change the exit code |
| `-m nonexistent-model` | **1** | 2.4 s | 1 stdout line + stderr line, no model call made |
| `-s <existing id>` (no `--resume`) | **1** | 1.2 s | stderr only, stdout empty |

### `streaming-json` event shapes (one line per distinct `type`, trimmed)

Counts for the PONG run: `available_commands` 3, `thought` 27, `text` 2, `usage` 1, `end` 1.

```
{"type":"available_commands","tools":["run_terminal_command","read_file",...],"commands":["compact","always-approve",...]}
{"type":"thought","data":"The"}
{"type":"text","data":"P"}
{"type":"usage","usage":{"input_tokens":16713,"output_tokens":29,"cache_read_input_tokens":1152,"cache_creation_input_tokens":0,"reasoning_tokens":27},"signature":"p+fa9x..."}
{"type":"end","stopReason":"end_turn","sessionId":"01a10e89-caf0-7e00-b0c6-a3af8a9c1ce0","requestId":"af14d317-...","usage":{...,"total_tokens":17894},"num_turns":1,"total_cost_usd":0.034176,"modelUsage":{"grok-4.7":{...}}}
```

From the tool run (events appear between `text` events):

```
{"type":"tool_call","toolCallId":"call-09adc8e5-...-0","title":"run_terminal_command","kind":"execute","status":"pending","toolName":"run_terminal_command","rawInput":{"command":"node -e \"process.exit(7)\"","description":"..."},"content":[],"locations":[]}
{"type":"tool_call_update","toolCallId":"call-09adc8e5-...-0","status":"in_progress","content":[...],"rawOutput":{"type":"Bash","output":[],"exit_code":0,"command":"node -e ...",...}}
{"type":"tool_call_update","toolCallId":"call-09adc8e5-...-0","status":"completed","content":[...],"rawOutput":{"type":"Bash","output_for_prompt":"exit: 1\n","exit_code":1,"command":"...","output_file":"C:\\Users\\abdal\\.grok\\sessions\\...\\terminal\\call-...-0.log"}}
```

- **Session id**: appears ONLY on the final `end` line (`sessionId`). No earlier `streaming-json` line carries it, so
  an adapter cannot know the id until the turn is over (observed: `thought`/`text`/`usage` lines have no id).
- **Completion**: the `end` event (`stopReason: "end_turn"`) followed by process exit 0.
- **Text and thoughts are token-level deltas** (`text`, `thought` with a `data` string), not whole messages.
- A failing tool has `status: "completed"` with a non-zero `rawOutput.exit_code`. Grok reported exit code **1** for a
  command that exits 7 (`output_for_prompt: "exit: 1"`; the model then said "exit code 1"), so the real code is
  not preserved on this platform. The exit status of the grok process stayed 0.
- The `tool_call_update` line carries `status: null` for its first update and omits `rawOutput` (`null`).

### `streaming-messages-json` (Anthropic Messages shape, whole messages)

3 lines for PONG. Session id is on the FIRST line here:

```
{"type":"system","subtype":"init","session_id":"01a10e89-fae1-7963-b2af-410368ff3460","apiKeySource":"oauth","model":"grok-4.7","cwd":"C:\\Users\\abdal\\AppData\\Local\\Temp\\grok-probe","permissionMode":"bypassPermissions","tools":["run_terminal_command",...]}
{"type":"assistant","message":{"id":"msg_0","type":"message","role":"assistant","model":"grok-4.7","content":[{"type":"thinking","thinking":"...","signature":"..."},{"type":"text","text":"PONG"}],"stop_reason":"end_turn",...}}
{"type":"result","subtype":"success","is_error":false,"duration_ms":2389,"duration_api_ms":2187,"num_turns":1,"result":"PONG","stop_reason":"end_turn","total_cost_usd":0.034162,"usage":{...},"modelUsage":{...}}
```

This is the same shape Claude Code emits (`system/init`, `assistant`, `result`), and the only headless format that
exposes the session id before the turn ends. It does not stream deltas by default (not tried with
`--include-partial-messages`; not established). Tool-failure behaviour in this format was not run (not established).

### Invalid `-m`

stdout (one line, `type:"error"`) and stderr, exit 1, before any model call:

```
{"type":"error","message":"Couldn't set model 'nonexistent-model': Invalid params: \"unknown model id\". Run 'grok models' to see available models."}
Error: Couldn't set model 'nonexistent-model': Invalid params: "unknown model id". Run 'grok models' to see available models.
```

A provider-side error (auth, quota, 5xx) was **not** produced (not established). The leader log shows
`tokenize-text failed status=402 Payment Required` warnings, which did not fail the turns.

## 2. Resume

Session id format: a UUID v7 string (`01a10e8a-71b1-77f1-96e6-9d0c0c54a3e2`).

| Command | Result |
| --- | --- |
| Turn 1: `grok -p "Remember the token ZEBRA-4471. Reply OK only."` | `end.sessionId = 01a10e8a-71b1-...` |
| `grok -r 01a10e8a-71b1-... -p "What was the token? Reply with the token only."` | model text `ZEBRA-4471`; same `end.sessionId`; exit 0; 3.1 s |
| `grok -s 01a10e8a-71b1-... -p ...` (existing id) | exit 1, stderr `Error: Error: Session ID 01a10e8a-71b1-77f1-96e6-9d0c0c54a3e2 is already in use.` |

`-r <id>` continues the same conversation and keeps the same id. `-s` is for naming a NEW session (help text:
"must be a valid UUID and must not already exist"); it does not resume. So Ptah could pre-assign the id with
`-s <uuid>` on the first turn (it would then know the id up front even with `streaming-json`); I did not run that
positive case (not established), only its refusal for an existing id. `--fork-session` and `-c` were not run.
Sessions are scoped by cwd (stored under `~/.grok/sessions/<url-encoded cwd>/<id>/`); whether `-r <id>` from a
different cwd works was not tested (not established).

## 3. Leader

- Headless `grok -p` did **not** start or attach to a leader: before the probe `grok leader list` printed
  `No leader candidates found.`, no `~/.grok/leader.sock` existed, and no leader appeared after four `-p` runs.
  Docs (`02-authentication.md:224`, `26-config-reference.md:114`): `[cli] use_leader` is off by default. This
  machine's `~/.grok/config.toml` sets only `[cli] installer = "internal"`.
- `--leader` is an `agent` option (`grok agent --leader stdio`; the top-level `grok --help` lists only
  `--leader-socket`). Using it **spawned a detached leader** that outlives the client:
  `grok.exe agent leader --no-exit-on-disconnect --relay-on-demand --grok-ws-url wss://code.grok.com/ws/code-agent --grok-ws-origin https://grok.com`
  (PID 45376, parent was another process, created at the moment of my first `--leader` run). It left
  `~/.grok/leader.lock` and `~/.grok/leader.log`. `grok leader info` then answered
  `Error: no reachable leader found for target wss://code.grok.com/ws/code-agent` and `grok leader list` showed
  `PID ? (Stale)`, so the CLI's own discovery did not see it. I stopped that PID with `Stop-Process` (it was mine; no
  leader existed before the probe). `leader.lock` / `leader.log` were left in `~/.grok`.
- **The trap reproduces.** Same `session/new` with a stdio MCP entry (env list `FROM_CONFIG=acp-new`), a stub MCP
  server that records its own `process.env` and cwd. Client env `PTAH_PROBE_ENV` was set per run:

  | Mode | Client cwd | Client env | What the MCP child recorded |
  | --- | --- | --- | --- |
  | `--no-leader` | `\p2` | `CLIENT-ENV-noleader-E` | `{"cwd":"...\\p2","PTAH_PROBE_ENV":"CLIENT-ENV-noleader-E","SERVER_ENV":"acp-new"}` |
  | `--leader` | `\p3` | `CLIENT-ENV-leader-D` | `{"cwd":"...\\p2","PTAH_PROBE_ENV":"LEADER-A","SERVER_ENV":"acp-new"}` |

  Through the leader the child got the env (`LEADER-A`, the env of the first client that spawned the leader) and the
  cwd (`\p2`, where that first client ran) of the **leader**, not of the connecting client. Only the explicit `env`
  entries in `session/new.mcpServers` reached the child (`SERVER_ENV` was correct in both). An http entry through the
  leader still connected and sent its custom header (stub saw `x-ptah-probe: acp-hdr`).
- `--leader --plugin-dir <dir>` produced no `_x.ai/mcp/server_status` event and no MCP child at all (two clients), so
  a per-process plugin dir was not honoured through the leader (observed; reason not investigated).
- Project `.grok/config.toml` through the leader was not tested separately; see item 4 for the trust gate.

Conclusion: an adapter must pass `--no-leader` explicitly (or never pass `--leader`) so a user's
`[cli] use_leader = true` cannot capture the lane.

## 4. MCP for one process

| Mechanism | Result (observed) |
| --- | --- |
| `./.grok/config.toml` in cwd with `[mcp_servers.envdump]` (stdio) and `[mcp_servers.projhttp]` (`url`, `headers`) | `grok mcp list` shows both as `(project)`. `grok mcp doctor` fails both: `folder untrusted (repo-local (project-scoped) server not started for an untrusted folder)`, `re-run with --trust`. Over ACP `session/new` in that fresh dir: `mcpToolCount: 0`, stub saw no request. **A temp dir is untrusted, so project config does not work for a per-lane MCP entry without a trust grant.** Granting trust (`~/.grok/trusted_folders.toml` per `18-sandbox.md:55`) would change `~/.grok`; not done. |
| `grok agent --plugin-dir <dir> stdio`, dir has `.mcp.json` `{"mcpServers":{"plughttp":{"type":"http","url":"http://127.0.0.1:47651/plug","headers":{"x-ptah-probe":"plug-hdr"}}}}` and `plugin.json` | `_x.ai/mcp/server_status {name:"plughttp",status:"ready"}`, `mcpToolCount:1`; stub log shows `initialize`, `notifications/initialized`, `tools/list` with header `x-ptah-probe: plug-hdr`. Works with no trust step. |
| `--plugin-dir` with a stdio `.mcp.json` entry (`command`, `args`, `env`) | `server_status ready`; child recorded `PTAH_PROBE_ENV=FLAG-A` (the client's env) and `FROM_CONFIG=plug2`. |
| `session/new` with `_meta.pluginDirs:[...]` (docs `09-plugins.md:421`) | Not effective in my run: `mcpToolCount: 0`, no child process. Key/shape may be wrong; **not established**. |
| **`session/new.mcpServers`** (ACP standard) | Best. See below. |

`session/new.mcpServers` with this array was accepted and **connected**:

```
[{"name":"envd3","command":"node","args":[".../envdump.js"],"env":[{"name":"FROM_CONFIG","value":"acp-new"}]},
 {"type":"http","name":"acphttp","url":"http://127.0.0.1:47651/acp","headers":[{"name":"x-ptah-probe","value":"acp-hdr"}]}]
```

Server sequence: `_x.ai/mcp/init_progress {total:1,connected:0}` -> `connected:1` -> `_x.ai/mcp_initialized
{mcpToolCount:1,elapsedMs:40}` -> `_x.ai/mcp/server_status {name:"ptahstub",source:"local",status:"ready"}`.
`initialize` advertises `"mcpCapabilities":{"http":true,"sse":true}`. The stub received, with the custom header:
a `server/discover` call (protocolVersion `2026-07-28`, rejected by my stub as unknown, ignored), then `initialize`
(`protocolVersion:"2025-11-25"`), `notifications/initialized`, `tools/list`, and later `tools/call`.
The session **used** the tool: the model called `search_tool` then `use_tool` with `tool_name:"ptahstub__probe_echo"`
and replied `STUB-OK-9931`; the result arrived as `rawOutput:{"type":"MCP","tool_name":"probe_echo","server_name":"ptahstub","output":{"OkayOutput":"STUB-OK-9931"}}`.

Details that matter for Ptah's MCP naming:

- Grok does **not** put MCP tools in the model's tool list directly. The model sees the built-ins plus `search_tool`
  and `use_tool`, and calls MCP tools as `<server>__<tool>` (`ptahstub__probe_echo`) through `use_tool`. The first
  turn therefore spends an extra model call on `search_tool`. (Observed: 3 model calls for one tool use.)
- Authorization headers were passed through unchanged (custom `x-ptah-probe`); `Authorization` was not tested.
- Whether a Ptah MCP server (`ptah`, with many tools) works under this `search_tool` indirection was not tested
  (not established).

## 5. ACP over `grok agent [--always-approve] stdio`

Transport: newline-delimited JSON-RPC 2.0, as expected. The Node harness `acp.js` in the temp dir wrote every line
with a ms timestamp. `initialize` responded in **111 ms**; `session/new` in about **300 ms**.

### `initialize`

Request: `{"protocolVersion":1,"clientCapabilities":{"fs":{...false},"terminal":false},"clientInfo":{...}}`.
Response (trimmed):

```
{"protocolVersion":1,
 "agentCapabilities":{"loadSession":true,
   "promptCapabilities":{"image":false,"audio":false,"embeddedContext":true},
   "mcpCapabilities":{"http":true,"sse":true},
   "sessionCapabilities":{"list":{},"resume":{},"close":{}},
   "auth":{},
   "_meta":{"x.ai/fs_notify":true,"x.ai/hooks":{...},"x.ai/capabilities":{...}}},
 "authMethods":[{"id":"cached_token",...},{"id":"grok.com",...}],
 "_meta":{"grokShell":true,"defaultAuthMethodId":"cached_token","x.ai/mcp/sdk":true,"x.ai/pluginDirs":true,
   "agentVersion":"1.0.46","modelState":{"currentModelId":"grok-4.7","availableModels":[{"modelId":"grok-4.7",...,"_meta":{"totalContextTokens":256000,"supportsReasoningEffort":true,"reasoningEfforts":[xhigh,high,medium,low]}}]}}}
```

No `authenticate` call was needed (signed in via `cached_token`). The unauthenticated path was not tried
(not established). `initialize` already carries the model list (`_meta.modelState.availableModels`).

### `session/new`, `session/prompt`, updates

`session/new {cwd, mcpServers, _meta:{yoloMode:true}}` -> `result.sessionId` (UUID v7),
`models`, `configOptions` (`model`, `reasoning_effort`), many `_x.ai/session/setup {phase:...}` notifications.
`session/prompt {sessionId, prompt:[{type:"text",text}]}` -> notifications, then the response:

```
{"id":3,"result":{"stopReason":"end_turn","_meta":{"sessionId":"...","requestId":"41cd8880-...","promptId":"41cd8880-...","totalTokens":18335,"modelId":"grok-4.7","usage":{...,"modelCalls":3,"apiDurationMs":5421,"costUsdTicks":532640000,"numTurns":3}}}}
```

Notification types observed in a tool-using turn (count in parentheses), all standard ones on `session/update`:
`agent_thought_chunk` (65, `content:{type:"text",text}`), `agent_message_chunk` (7), `tool_call` (2, `toolCallId`,
`title`, `rawInput`, `_meta["x.ai/tool"]`), `tool_call_update` (4, `status` `in_progress` | `completed`, `rawOutput`),
`available_commands_update`, `session_info_update` (`title`). Grok extensions as notifications: `_x.ai/queue/changed`,
`_x.ai/session_notification` with `sessionUpdate` in {`tool_call_delta_chunk`, `response_completed` (usage per model call),
`pending_interaction`, `interaction_resolved`, `turn_completed`, `session_summary_generated`}, `_x.ai/session/prompt_complete`
(`{promptId, stopReason, cancellationCategory?}`), `_x.ai/mcp/*`, `_x.ai/models/update`, `_x.ai/settings/update`,
`_x.ai/announcements/update`, `_x.ai/sessions/changed`. A parser can ignore every `_x.ai/*` notification and still run.
Each chunk's `_meta` carries `promptId`, `eventId`, `chunkId`.

**Completion signal**: the JSON-RPC response to `session/prompt` (`result.stopReason`), plus `_x.ai/session/prompt_complete`
and `turn_completed {stop_reason}` a few ms earlier. It does not depend on process exit.

### Permissions

- Without `--always-approve` (`grok agent stdio`), Grok sent a **JSON-RPC request** `session/request_permission`
  (id 0) for a shell command, preceded by `_x.ai/session_notification {sessionUpdate:"pending_interaction", kind:"permission"}`:

  ```
  {"method":"session/request_permission","params":{"sessionId":"...","toolCall":{"toolCallId":"call-...","kind":"execute","title":"Execute `echo hi > probe.txt`","rawInput":{"variant":"Bash","command":"echo hi > probe.txt",...}},
   "options":[{"optionId":"always-allow","kind":"allow_always"},{"optionId":"allow-once","kind":"allow_once"},{"optionId":"reject-once","kind":"reject_once"},{"optionId":"reject-always","kind":"reject_always"}]}}
  ```

  The client answers `{"result":{"outcome":{"outcome":"selected","optionId":"always-allow"}}}` (I selected
  `options[0]`). After approval the command ran (`probe.txt` created) and the turn ended `end_turn`. The reject paths
  were not exercised (not established).
- With `--always-approve` (alone, and also with `_meta.yoloMode:true`), no `session/request_permission` was sent;
  `pending_interaction` was immediately followed by `interaction_resolved` (A and B runs).
- When the harness had no handler for agent->client requests, I replied `-32601`; that case (a client that never
  answers a permission request) was not run (not established).

### Cancel, and a second prompt during a turn (run B, `--always-approve`)

Timeline of one session (`ms` since process start; first prompt = a 45 s shell command):

| ms | Event |
| --- | --- |
| 735 | `session/prompt` #1 (id 3) sent |
| 859 | `_x.ai/queue/changed`: `runningPromptId` = #1 |
| 4235-4258 | `tool_call run_terminal_command` -> `in_progress` (the 45 s `node` sleep starts) |
| 7736 | `session/prompt` #2 (id 4): "Also reply with the word SECOND at the end." sent mid-turn |
| 7739 | `_x.ai/queue/changed`: `entries:[{kind:"prompt",text:"Also reply...",position:0}]`, `runningPromptId` still #1 |
| 12743 | `session/cancel {sessionId}` sent (a notification, no id) |
| 12745 | `turn_completed {prompt_id:#1, stop_reason:"cancelled"}` (2 ms later) |
| 12764 | `_x.ai/session/prompt_complete {stopReason:"cancelled", cancellationCategory:"MidTurnAbort"}` and the `session/prompt` #1 response `{"stopReason":"cancelled"}` (**21 ms** after the cancel) |
| 12746 | `_x.ai/queue/changed`: `runningPromptId` = #2 (**queued prompt #2 started by itself**) |
| 14274 | `session/prompt` #3 "Reply ALIVE only." sent: queued behind #2 |
| 62836 | #2's tool call (the same 45 s command, re-run by the model) `completed`, `exit_code:0` |
| 63904-63930 | #2 ends `end_turn`: text `DONE\nSECOND`; #3 starts |
| 65734 | #3 response `end_turn`, text `ALIVE` |

Findings:

1. **A second `session/prompt` while a turn is running is accepted and queued, not rejected or injected.** It is a
   FIFO queue per session with ids (`_x.ai/queue/changed.entries[].id`, `version`, `position`); each entry has a
   `kind` (only `"prompt"` was seen). Each queued prompt gets its own JSON-RPC response when it finishes.
   This is `queue-next-turn` natively, with no `SdkHandle.continue` emulation needed.
2. **`session/cancel` ended the running prompt in 21 ms** (`stopReason:"cancelled"`), and the session stayed usable.
   This is `interrupt` (abort current turn, keep the session).
3. **Queued prompts survive a cancel and start immediately.** Prompt #2 ran as soon as #1 was cancelled. An adapter
   that wants "interrupt, then deliver this message" can send `session/cancel` then `session/prompt`; an adapter
   that wants "interrupt and discard what was queued" has no measured primitive. The queue entries have ids, which
   suggests an extension method to remove an entry; I did not find or test it (not established).
4. The model, on #2, knew about the cancelled command ("The earlier run was cancelled before it started") and
   re-ran it. Whether the cancelled shell child (`node setTimeout 45000`) was killed at cancel time was **not
   measured** (the re-run masks it).
5. No mid-turn **steer** (insert a message into the running turn at the next step boundary) was observed. The
   only mid-turn delivery path measured is the queue. Whether `x.ai/*` offers one is not established.

### `session/load`, `session/resume`, and method probe

- Fresh process, `session/load {sessionId:<id from the headless run>, cwd, mcpServers:[]}` -> response with `models`,
  `configOptions`; **history was replayed as notifications first** (2 `user_message_chunk`, 7 `agent_message_chunk`
  including the earlier `OK` and `ZEBRA-4471`). A following `session/prompt` "What was the token?" answered
  `ZEBRA-4471` (4.5 s). So a headless-created session is loadable over ACP, and `load` costs a replay the parser
  must discard.
- `session/list` -> `{sessions:[{sessionId,cwd,title,updatedAt,...}]}`; `session/resume` -> success with the same
  result shape as `load` (no replay was checked); `session/close` advertised, not called.
- `session/fork` and `x.ai/session/fork` -> `-32601 Method not found`. `session/set_mode` -> `-32602` (needs
  `modeId`), so it exists. An unknown method -> `-32601`.
- `session/set_config_option` (model, `reasoning_effort`) and `_meta` options (`rules`, `systemPromptOverride`,
  `agentProfile`, `yoloMode`) are documented in `15-agent-mode.md`; not run (not established).

## 6. `grok models`

`grok models` has no `--json` (`error: unexpected argument '--json' found`). Output on this machine:

```
You are logged in with grok.com.

Default model: grok-4.7

Available models:
  * grok-4.7 (default)
```

Exit 0, took under 3 s. Parsing is line-based: the default after `Default model: `; models are the lines after
`Available models:`, each `  <marker> <id>[ (default)]` where `*` marks the default (marker/format for non-default
rows is not established; only one model is listed). ACP `initialize._meta.modelState.availableModels[]` returns a
structured list (`modelId`, `name`, `description`, `totalContextTokens`, `supportsReasoningEffort`,
`reasoningEfforts`) in 111 ms and is the better source when an ACP session is open. `~/.grok/models_cache.json`
exists (not read).

## Mapping: Grok features to Ptah needs

| Ptah need | `grok -p` (one-shot) | `grok agent stdio` (ACP) |
| --- | --- | --- |
| Spawn | `grok -p <prompt> --output-format streaming-json --always-approve --no-alt-screen`; ~1 s cold start; one process per turn | `grok agent --always-approve --no-leader stdio`; one long-lived process; `initialize` 111 ms, `session/new` ~300 ms |
| Stream parse | NDJSON `{type,data}`: `thought`, `text` deltas, `tool_call`, `tool_call_update`, `usage`, `end` | NDJSON JSON-RPC: standard `session/update` (`agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`); ignore `_x.ai/*` |
| Session id | Only in the final `end.sessionId` (`streaming-json`); first line `system/init.session_id` in `streaming-messages-json`; or pre-assign with `-s <uuid>` (positive case not run) | `session/new` result `sessionId`, known before the first prompt |
| Resume | `-r <id>` continues the same conversation (token recalled) | Keep the process; or `session/load` / `session/resume` after a restart (load replays history) |
| MCP injection (per lane) | No per-process MCP flag; project `.grok/config.toml` needs folder trust; `--plugin-dir` is an `agent` flag (not on the top-level command) | `session/new.mcpServers` with http `url` + `headers` works, and so does stdio with `env`; tools called as `server__tool` via `use_tool` |
| Models | `grok models` (text, no JSON) | `initialize._meta.modelState` (structured); `-m` flag; `session/set_config_option` documented, not run |
| Steer (inject mid-turn) | None: no live input channel | Not observed (second prompt is queued) |
| Queue-next-turn | Spawn a new process with `-r <id>` after exit | Native: second `session/prompt` mid-turn is queued FIFO and answered separately |
| Interrupt-resume | Kill the process, then `-r <id>`; partial-turn handling not measured | Native: `session/cancel` -> `stopReason:"cancelled"` in 21 ms; session stays usable; queued prompts auto-start |
| Completion signal | `end` event, then process exit 0 | `session/prompt` response `stopReason`; independent of process exit |
| Error signal | Invalid `-m`: exit 1 + `{"type":"error"}` line; tool failure: exit 0 with a failed `tool_call_update` | Not measured for provider errors; permission: `session/request_permission` unless `--always-approve` |
| Permission handling | `--always-approve` | `--always-approve` (flag) or `_meta.yoloMode`; otherwise a JSON-RPC request the client must answer |
| Leader | Not used by default | Pass `--no-leader`: with `--leader` the MCP child got the leader's env and cwd |

Mapping to `AgentMessagingCapabilities` (`cli-adapter.interface.ts:155`): `steer: false` (not observed),
`interrupt: true` (`session/cancel`), `continuation: true` (queued `session/prompt`). `SdkHandle.steer` would not be
implemented; `SdkHandle.interrupt()` maps to `session/cancel` and resolves on the `session/prompt` response;
`SdkHandle.continue(message)` maps to a further `session/prompt`; `SdkHandle.getSessionId()` is available right after
`session/new`; `done` resolves with 0 on `stopReason: "end_turn"`.

## Recommendation: ACP stdio over one-shot `-p`

Choose `grok agent --always-approve --no-leader stdio`, driven by a small in-adapter JSON-RPC client. Reasons, each
measured above:

1. MCP injection per lane works only here (`session/new.mcpServers`, http + headers, no trust step). With `-p` the
   only per-process route is project config, which the temp dir rejected as untrusted.
2. Two of Ptah's three modes are native: queue (second prompt queued) and interrupt (`session/cancel`, 21 ms, session
   kept). With `-p` both would be process kill and respawn with `-r`.
3. The session id is known before the first prompt, and completion is a response with `stopReason`, not process exit.
4. Cost: one process stays warm, so later turns skip process start-up. The first-turn extra model call for
   `search_tool` is the same either way.

What ACP costs: Ptah needs a JSON-RPC client (request ids, an agent->client request handler for
`session/request_permission` when not always-approving), `session/load` replay must be discarded, and the
`_x.ai/*` notifications must be ignored rather than rejected. A queued prompt starts by itself after a cancel,
so "interrupt then send" and "interrupt and drop the queue" need different handling. Keep `grok -p` as the
fallback and for `detect()`-time checks (`grok --version`, `grok models`) because its output is simple to parse.
The architect decides; this is evidence, not a design.

## Not established

- Provider-side errors (auth expired, quota, 5xx, rate limit) in either transport: no exit code or error event was
  captured. The leader log hinted at 402 and 429 responses from a tokenizer endpoint that did not fail turns.
- Whether the cancelled shell child was killed at `session/cancel` (the model re-ran it).
- Any queue-management method (remove or reorder a queued prompt) and any `kind` other than `"prompt"`; any true mid-turn
  steer. Not found in `initialize`; the docs list `x.ai/*` methods but I did not probe them.
- `session/prompt` behaviour for `session/cancel` sent while only queued prompts exist; cancelling a queued prompt.
- `_meta.pluginDirs` on `session/new` (no effect in my run), `--plugin-dir` in combination with `session/new.mcpServers`
  for the same server name, and merging when both a plugin and `mcpServers` declare one.
- Folder trust granted for a real project (the Ptah repo): not tried, because it writes `~/.grok`. In a trusted
  folder, `./.grok/config.toml` MCP servers would presumably load; that is inferred from the doctor message, not measured.
- `-s <new uuid>` positive case; `--fork-session`; `-c`; `-r` from a different cwd; resuming a session created by
  ACP with `-r`; `session/resume` replay behaviour.
- `streaming-messages-json` with a tool failure, with `--include-partial-messages`, and its exit code on invalid model.
- `--max-turns`, `--permission-mode`, `--prompt-file`, `--prompt-json`, `--reasoning-effort`, `--sandbox`, `--cwd`.
- Whether `Authorization` headers and OAuth http MCP servers work; whether a many-tool Ptah MCP server works
  through `search_tool` / `use_tool`.
- Unauthenticated / expired login behaviour (`authenticate`, `x.ai/auth/*`), and `XAI_API_KEY` mode.
- Behaviour on non-Windows platforms and with other grok versions; only 1.0.46 on win32 was probed.
- `grok models` rows when more than one model exists, and non-default markers.
- Process hygiene: a failing or hung `grok agent stdio` child on parent exit (the harness closed stdin and killed the
  process; exit code 0 was recorded in the log each time).

## Cleanup performed

- All 7 probe sessions that grok persisted were deleted with `grok sessions delete <id>` (verified: `No sessions found.`).
  Sessions created by `session/new` without a prompt did not appear in `grok sessions list`.
- The leader process I spawned (PID 45376) and the MCP HTTP stub were stopped. `~/.grok/leader.lock` and
  `~/.grok/leader.log` were created by the probe's `--leader` runs and left in place. No `~/.grok` setting or
  `config.toml` was edited; no `grok mcp add` was run. Probe files remain under `%TEMP%\grok-probe`.
