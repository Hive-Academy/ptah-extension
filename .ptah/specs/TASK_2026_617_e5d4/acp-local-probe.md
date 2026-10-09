# ACP local probe — TASK_2026_617_e5d4

**Date:** 2026-10-06 · **Machine:** Windows (win32), PowerShell, Node v24.15.0
**Method:** measured, not inferred — each installed CLI was spawned in its ACP mode (cwd = temp dir) and sent a real ACP handshake over stdio: newline-delimited JSON-RPC 2.0 `initialize`, then `session/new`. Responses were captured verbatim, then the whole process tree was killed (`taskkill /PID <pid> /T /F`). Hard timeout: 15 s per CLI (none hit it). No `session/prompt` was ever sent (no model spend). No logins were performed and no CLI config was changed by the probe; agents that succeeded at `session/new` did so against pre-existing credential state on this machine.

**Probe scripts** (outside the repository): `C:\Users\abdal\AppData\Local\Temp\opencode\acp-probe\` — harness-approved user temp area, used in place of `%TEMP%\acp-probe`. One shared `probe.mjs` (5 541 B) + one tiny entry script per ACP CLI (`probe-grok.mjs`, `probe-opencode.mjs`, `probe-gemini.mjs`, `probe-copilot.mjs`, `probe-codex.mjs`, 52–56 B each). Probe prints `RESULT <reason>`; all five probes finished with `RESULT HANDSHAKE-COMPLETE` (both responses received) and then killed their tree. (Node prints a harmless `DEP0190` warning about `spawn(..., {shell:true})` — needed for npm `.cmd` shims on Windows — it comes from the probe, not the agents.)

**Exact payloads sent to every CLI:**

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{"fs":{"readTextFile":false,"writeTextFile":false},"terminal":false}}}
{"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"C:\\Users\\abdal\\AppData\\Local\\Temp\\opencode\\acp-probe","mcpServers":[]}}
```

## Summary

| CLI | installed | ACP command | protocolVersion | loadSession | MCP http/sse | auth needed | session/new result |
|---|---|---|---|---|---|---|---|
| grok | yes — `C:\Users\abdal\.grok\bin\grok.exe` (agent 1.0.46) | `grok agent stdio` | 1 | true | http ✓ / sse ✓ | no demand — existing cached token satisfied it (`cached_token` default, `grok.com` offered) | **OK** — UUIDv7-shaped `sessionId` + `models` + `configOptions` |
| opencode | yes — npm shim, agent 2.0.12 | `opencode acp` | 1 | true | http ✓ / sse ✗ | no demand (`opencode-login` offered) | **OK** — `ses_`-prefixed 26-char opaque `sessionId` + `configOptions` |
| gemini | yes — npm shim, gemini-cli 0.42.0 | `gemini --acp` (`--experimental-acp` = deprecated alias, per its `--help`) | 1 | true | http ✓ / sse ✓ | policy-blocked (not a login prompt) | **ERROR -32000** — "This client is no longer supported for Gemini Code Assist for individuals. To continue using Gemini, please migrate to the Antigravity suite of products: https://antigravity.google" |
| codex | yes — npm shim, codex-cli 0.160.0 | `npx -y @zed-industries/codex-acp` (adapter codex-acp 0.16.0; resolves via npx cache, **no global install**) | 1 | true | http ✓ / sse ✗ (plus non-standard `acp:false`) | no demand (`chatgpt`, `codex-api-key`, `openai-api-key` offered) | **OK** — UUIDv7-shaped `sessionId` + `modes` (read-only/auto/full-access) + `configOptions` |
| copilot | yes — npm shim, Copilot 1.0.83 | `copilot --acp` | 1 | true | http ✓ / sse ✓ | no demand (`copilot-login` offered, with `terminal-auth` `_meta`) | **OK** — UUIDv4-shaped `sessionId` + `modes` (agent/plan/autopilot, ACP session-mode URIs) + `configOptions` |
| claude | yes — `C:\Users\abdal\.local\bin\claude.exe` (Claude Code 2.1.288) | none native — 0 `acp` mentions in `claude --help`; ACP requires a separate adapter (out of scope per task) | — | — | — | — | not probed (per task: note only) |
| antigravity / agy | `antigravity` not on PATH; `agy` yes — `C:\Users\abdal\AppData\Local\agy\bin\agy.exe` (1.2.17) | none found — 0 `acp` matches in `agy --help`, `agy agent --help`, and the `agy --acp --help` usage dump | — | — | — | — | not probed — no ACP mode identified |
| cursor-agent | no (`Get-Command` → not found) | — | — | — | — | — | — |
| qwen | no | — | — | — | — | — | — |
| goose | no | — | — | — | — | — | — |

Framing (all five probed agents): standard newline-delimited single-line JSON-RPC 2.0 messages on stdout — no LSP-style `Content-Length:` framing, no BOM/line prefixes; stderr carried only logs (codex). No probe hit the 15 s timeout; every spawned process tree was killed.

## Evidence — grok (`grok agent stdio`)

- command used: `C:\Users\abdal\.grok\bin\grok.exe agent stdio` · exit: `RESULT HANDSHAKE-COMPLETE` in <15 s, tree killed (no timeout)
- `agentCapabilities`: `loadSession:true`; `promptCapabilities:{image:false,audio:false,embeddedContext:true}`; `mcpCapabilities:{http:true,sse:true}`; `sessionCapabilities:{list,resume,close}`; `auth:{}`
- trimmed raw `initialize` response (probe cut at 1500 chars inside `modelState.availableModels`; the remainder is the grok-4.7 model entry — reasoning efforts xhigh/high/medium/low, `contextWindows:[256000,500000]`, shown in full in the `session/new` result below):

```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true,"promptCapabilities":{"image":false,"audio":false,"embeddedContext":true},"mcpCapabilities":{"http":true,"sse":true},"sessionCapabilities":{"list":{},"resume":{},"close":{}},"auth":{},"_meta":{"x.ai/fs_notify":true,"x.ai/hooks":{"blockingEvents":["pre_tool_use","stop","subagent_stop"],"decisions":["deny","block"],"stopSignals":["continue","stopReason","additionalContext"]},"x.ai/capabilities":{"toolOverrides":{"x_keyword_search":true,"x_semantic_search":true,"x_user_search":false,"x_thread_fetch":false}}}},"authMethods":[{"id":"cached_token","name":"cached_token","description":"Cached token from ~/.grok/auth.json"},{"id":"grok.com","name":"Grok","description":"Sign in with Grok"}],"_meta":{"grokShell":true,"defaultAuthMethodId":"cached_token","x.ai/mcp/sdk":true,"x.ai/pluginDirs":true,"currentWorkingDirectory":"C:\\Users\\abdal\\AppData\\Local\\Temp\\opencode\\acp-probe","agentVersion":"1.0.46","agentId":"ea5b572a-bf7b-583b-b800-87cb8cc92169","agentInstanceId":"0d70b13d-b99a-49ef-bee1-049809df3a3c","hostname":"Abdo","modelState":{"currentModelId":"grok-4.7","availableModels":[{"modelId":"grok-4.7","name":"Grok 4.7","description":"SpaceXAI's latest frontier model","_meta":{"totalContextTokens":256000,"agentType":"grok-build-plan","supportsReasoningEffort":true,"reasoningEffort":"medium","reasoningEfforts":[{"id":"xhigh", … [+1556ch trimmed: xhigh/high/medium/low effort descriptors, contextWindows [256000,500000]]}]},"agentVersion":"1.0.46"}}}}
```

- `authMethods`: `cached_token` ("Cached token from ~/.grok/auth.json"), `grok.com` ("Sign in with Grok"); initialize `_meta.defaultAuthMethodId` = `cached_token`. `session/new` passed its `auth` setup phase on the pre-existing cached token — the probe did not log in.
- `session/new` (trimmed): `{"jsonrpc":"2.0","id":2,"result":{"sessionId":"01a10ea6-31ce-7dd1-afd8-1cfafb2d95b1","models":{"currentModelId":"grok-4.7","availableModels":[{"modelId":"grok-4.7", …full grok-4.7 entry… }]},"configOptions":[{"id":"model","name":"Model","category":"model","type":"select","currentValue":"grok-4… [+1568ch trimmed: model selector options]}}` — succeeded, no auth demand.
- `sessionId` shape: `01a10ea6-31ce-7dd1-afd8-1cfafb2d95b1` — 36-char UUIDv7-shaped string (time-ordered, third group starts with `7`).
- `_meta` / vendor extensions: heavy — top-level `_meta` (`grokShell`, `defaultAuthMethodId`, `x.ai/mcp/sdk`, `x.ai/pluginDirs`, `currentWorkingDirectory`, `agentVersion`, `agentId`, `agentInstanceId`, `hostname`, `modelState`) and `agentCapabilities._meta` (`x.ai/fs_notify`, `x.ai/hooks`, `x.ai/capabilities.toolOverrides`).
- non-standard traffic: vendor **notifications** `_x.ai/session/setup` (phases: `auth` → `resolve_workspace` → `folder_trust` → `plugin_registry` → `mcp_merge` → `persistence_init` → `spawn_session_actor` → `agent_build`), `_x.ai/mcp/servers_updated`, `_x.ai/models/update`. Probe never replied; they are ignore-safe notifications, framing stayed standard.

## Evidence — opencode (`opencode acp`)

- command used: `C:\Users\abdal\AppData\Roaming\npm\opencode.cmd acp` · exit: `RESULT HANDSHAKE-COMPLETE` in <15 s, tree killed (no timeout)
- `agentCapabilities`: `loadSession:true`; `mcpCapabilities:{http:true,sse:false}`; `promptCapabilities:{embeddedContext:true,image:true}`; `sessionCapabilities:{close,delete,fork,list,resume}`
- raw `initialize` response (complete, untrimmed):

```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true,"mcpCapabilities":{"http":true,"sse":false},"promptCapabilities":{"embeddedContext":true,"image":true},"sessionCapabilities":{"close":{},"delete":{},"fork":{},"list":{},"resume":{}},"_meta":{"opencode/child-session-updates":true}},"authMethods":[{"description":"Run `opencode auth login` in the terminal","name":"Login with opencode","id":"opencode-login"}],"agentInfo":{"name":"OpenCode","version":"2.0.12"}}}
```

- `authMethods`: `opencode-login` ("Run `opencode auth login` in the terminal"). `session/new` succeeded against the machine's existing opencode auth state — the probe did not log in.
- `session/new` (trimmed): `{"jsonrpc":"2.0","id":2,"result":{"sessionId":"ses_ef159c5bdffem0l9jOUcdZphp1","configOptions":[{"id":"model","name":"Model","category":"model","type":"select","currentValue":"opencode/fledge-alpha-free","options":[{"value":"opencode/big-pickle","name":"opencode/Big Pickle"},{"value":"opencode/claude-fable-5", … [+5403ch trimmed: remaining model options]}}` — succeeded, no auth demand.
- `sessionId` shape: `ses_ef159c5bdffem0l9jOUcdZphp1` — `ses_`-prefixed 26-char `[0-9a-z]` opaque id (same scheme this harness uses for its own sessions).
- `_meta` / vendor extensions: `agentCapabilities._meta{"opencode/child-session-updates":true}`; `agentInfo{name:"OpenCode",version:"2.0.12"}`.
- non-standard traffic: one standard ACP `session/update` **notification** (`available_commands_update` with an `init`/`rev…` command list) — standard, framing stayed newline-delimited JSON-RPC 2.0.

## Evidence — gemini (`gemini --acp`)

- command used: `C:\Users\abdal\AppData\Roaming\npm\gemini.cmd --acp` (its `--help` lists `--acp  Starts the agent in ACP mode` and `--experimental-acp … (deprecated, use --acp instead)`) · exit: both responses received in <15 s, tree killed (no timeout)
- `agentCapabilities`: `loadSession:true`; `promptCapabilities:{image:true,audio:true,embeddedContext:true}`; `mcpCapabilities:{http:true,sse:true}`
- raw `initialize` response (complete, untrimmed):

```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"authMethods":[{"id":"oauth-personal","name":"Log in with Google","description":"Log in with your Google account"},{"id":"gemini-api-key","name":"Gemini API key","description":"Use an API key with Gemini Developer API","_meta":{"api-key":{"provider":"google"}}},{"id":"vertex-ai","name":"Vertex AI","description":"Use an API key with Vertex AI GenAI API"},{"id":"gateway","name":"AI API Gateway","description":"Use a custom AI API Gateway","_meta":{"gateway":{"protocol":"google","restartRequired":"false"}}}],"agentInfo":{"name":"gemini-cli","title":"Gemini CLI","version":"0.42.0"},"agentCapabilities":{"loadSession":true,"promptCapabilities":{"image":true,"audio":true,"embeddedContext":true},"mcpCapabilities":{"http":true,"sse":true}}}}
```

- `authMethods`: `oauth-personal`, `gemini-api-key`, `vertex-ai`, `gateway`.
- raw `session/new` response (complete, untrimmed) — **rejected, JSON-RPC error, not an auth request**:

```json
{"jsonrpc":"2.0","id":2,"error":{"code":-32000,"message":"This client is no longer supported for Gemini Code Assist for individuals. To continue using Gemini, please migrate to the Antigravity suite of products: https://antigravity.google"}}
```

- `sessionId`: none returned (`session/new` failed before session creation).
- `_meta` / vendor extensions: per-authMethod `_meta` (`api-key`, `gateway`) only; no top-level `_meta`.
- framing: standard; only the two JSON-RPC messages appeared on stdout. No `authenticate` request was sent by the agent.

## Evidence — codex (via `npx -y @zed-industries/codex-acp` adapter)

- adapter resolution check: `npx -y @zed-industries/codex-acp --help` **resolved without any global install** (npx cache only; it printed `Usage: codex-acp.exe [OPTIONS]` with `-c, --config <key=value>`), so it was probed as codex's ACP mode.
- command used: `npx -y @zed-industries/codex-acp` (resolved to `C:\Program Files\nodejs\npx.cmd`; wraps codex-cli 0.160.0; adapter identifies as `agentInfo{name:"codex-acp",version:"0.16.0"}`) · exit: `RESULT HANDSHAKE-COMPLETE` in <15 s, tree killed (no timeout)
- `agentCapabilities`: `loadSession:true`; `promptCapabilities:{image:true,audio:false,embeddedContext:true}`; `mcpCapabilities:{http:true,sse:false,acp:false}` (extra non-standard `acp` member); `sessionCapabilities:{list,resume,close}`; `auth:{logout:{}}`
- raw `initialize` response (complete, untrimmed — note the `id` member arrives **after** `result`, valid JSON-RPC but unusual member order):

```json
{"jsonrpc":"2.0","result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true,"promptCapabilities":{"image":true,"audio":false,"embeddedContext":true},"mcpCapabilities":{"http":true,"sse":false,"acp":false},"sessionCapabilities":{"list":{},"resume":{},"close":{}},"auth":{"logout":{}}},"authMethods":[{"id":"chatgpt","name":"Login with ChatGPT","description":"Use your ChatGPT login with Codex CLI (requires a paid ChatGPT subscription)"},{"type":"env_var","id":"codex-api-key","name":"Use CODEX_API_KEY","description":"Requires setting the `CODEX_API_KEY` environment variable.","vars":[{"name":"CODEX_API_KEY"}]},{"type":"env_var","id":"openai-api-key","name":"Use OPENAI_API_KEY","description":"Requires setting the `OPENAI_API_KEY` environment variable.","vars":[{"name":"OPENAI_API_KEY"}]}],"agentInfo":{"name":"codex-acp","title":"Codex","version":"0.16.0"},"id":1}
```

- `authMethods`: `chatgpt` (OAuth), `codex-api-key` (env var), `openai-api-key` (env var) — the latter two carry non-standard `type:"env_var"` + `vars[]` fields. `session/new` succeeded against existing codex credential state — the probe did not log in and set no env vars.
- `session/new` (trimmed): `{"jsonrpc":"2.0","result":{"sessionId":"01a10ea6-c6eb-7183-91bd-d3c0c39f3408","modes":{"currentModeId":"read-only","availableModes":[{"id":"read-only","name":"Read Only","description":"Codex can read files in the current workspace. Approval is required to edit files or access the internet."},{"id":"auto","name":"Default","description":"Codex can read and edit files in the current workspace, and run commands. Approval is required to access the internet or edit other files. (Identical to Agent mode)"},{"id":"full-access","name":"Full Access","description":"Codex can edit files outside this workspace and access the internet without asking for approval. Exercise caution when using."}]},"configOptions":[{"id":"mode","name":"Approval Preset", … [+1732ch trimmed: mode configOptions]}}` — succeeded, no auth demand.
- `sessionId` shape: `01a10ea6-c6eb-7183-91bd-d3c0c39f3408` — UUIDv7-shaped string.
- `_meta` / vendor extensions: `mcpCapabilities.acp:false` (non-standard member); `auth:{logout:{}}` in `agentCapabilities`; `type:"env_var"`/`vars[]` on authMethods; `session/new` result carries `modes` with **bare ids** (`read-only`/`auto`/`full-access`), unlike copilot's URI-qualified mode ids.
- observed stderr noise (unrelated to the handshake): `ERROR codex_models_manager::cache: failed to load models cache: unknown variant 'max', expected one of 'none','minimal','low','medium','high','xhigh'` and `failed to refresh available models: stream disconnected before completion: failed to decode models response: unknown variant 'max'` — a codex-cli 0.160.0 ↔ codex-acp 0.16.0 model-struct skew; the ACP handshake itself was unaffected.

## Evidence — copilot (`copilot --acp`)

- command used: `C:\Users\abdal\AppData\Roaming\npm\copilot.cmd --acp` (its `--help` lists `--acp  Start as Agent Client Protocol server`) · exit: `RESULT HANDSHAKE-COMPLETE` in <15 s, tree killed (no timeout)
- `agentCapabilities`: `loadSession:true`; `mcpCapabilities:{http:true,sse:true}`; `promptCapabilities:{image:true,audio:false,embeddedContext:true}`; `sessionCapabilities:{close,list}`
- raw `initialize` response (complete, untrimmed):

```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentCapabilities":{"loadSession":true,"mcpCapabilities":{"http":true,"sse":true},"promptCapabilities":{"image":true,"audio":false,"embeddedContext":true},"sessionCapabilities":{"close":{},"list":{}},"agentInfo":{"name":"Copilot","title":"Copilot","version":"1.0.83"},"authMethods":[{"id":"copilot-login","name":"Log in with Copilot CLI","description":"Run `copilot login` in the terminal","_meta":{"terminal-auth":{"command":"C:\\Users\\abdal\\AppData\\Roaming\\npm\\node_modules\\@github\\copilot\\node_modules\\@github\\copilot-win32-x64\\copilot.exe","args":["login"],"label":"Copilot Login"}}}]}}
```

- `authMethods`: `copilot-login` with `_meta.terminal-auth` (launches `…\copilot-win32-x64\copilot.exe login`). `session/new` succeeded against existing Copilot login state — the probe did not log in.
- `session/new` (trimmed): `{"jsonrpc":"2.0","id":2,"result":{"sessionId":"7d9f42c3-8183-49c2-ab9d-769bfb0caf2e","modes":{"availableModes":[{"id":"https://agentclientprotocol.com/protocol/session-modes#agent","name":"Agent","description":"Default agent mode for conversational interactions"},{"id":"https://agentclientprotocol.com/protocol/session-modes#plan","name":"Plan","description":"Plan mode for creating multi-step plans"},{"id":"https://agentclientprotocol.com/protocol/session-modes#autopilot","name":"Autopilot","description":"Autonomous mode that enables allow-all and runs until task completion without user interaction (experimental)"}],"currentModeId":"https://agentclientprotocol.com/protocol/session-modes#agent"},"configOptions":[{"type":"select","id":"mode","name":"Mode","currentValue":"https://agentclientprotocol.com/protocol/session-modes#agent","options":[… [+965ch trimmed: mode options]}}` — succeeded, no auth demand.
- `sessionId` shape: `7d9f42c3-8183-49c2-ab9d-769bfb0caf2e` — UUIDv4-shaped string.
- `_meta` / vendor extensions: authMethod `_meta.terminal-auth`; `session/new` result uses ACP session-mode **URI ids** (`https://agentclientprotocol.com/protocol/session-modes#agent|plan|autopilot`).

## Evidence — claude (Claude Code 2.1.288)

- installed: `C:\Users\abdal\.local\bin\claude.exe`, `claude --version` → `2.1.288 (Claude Code)`
- measured: `claude --help` contains **0** case-insensitive `acp` mentions → no native ACP mode. Per the task, ACP for Claude Code is via a separate adapter — noted, **not probed**.

## Evidence — antigravity / agy (Antigravity CLI 1.2.17)

- `antigravity`: `Get-Command` → not found. `agy`: `C:\Users\abdal\AppData\Local\agy\bin\agy.exe`, version `1.2.17`.
- measured: 0 `acp` matches in `agy --help`, in `agy agent --help`, and in the full 39-line usage dump produced by `agy --acp --help`; subcommands seen include `mcp` (MCP server management) and `mic-serve` (microphone sharing) — no ACP/stdio agent mode identified. Not probed.
- cross-reference: gemini's `session/new` error tells users to "migrate to the Antigravity suite", yet this machine's agy CLI exposes no ACP mode.

## Evidence — not installed (nothing to probe)

- `Get-Command` (Windows PATH): `antigravity`, `cursor-agent`, `qwen`, `goose` → not found. Their ACP abilities could not be measured on this machine.

## Not established

1. **claude as an ACP agent** — not established: no native ACP mode in `--help` (measured), and the adapter route (a separate `claude-code-acp`-style adapter) was out of scope per the task; never probed.
2. **agy/antigravity as an ACP agent** — not established: no ACP surface found in its help output, but absence of an undocumented/hidden flag cannot be proven from `--help` alone; probed no further.
3. **gemini usable sessions** — not established: `initialize` succeeded but `session/new` was rejected (policy error `-32000`, "migrate to Antigravity"); no login or API-key auth was attempted (scope: no logins), so whether any of its four authMethods still yields a working session is unknown.
4. **Whether a fresh/unauthenticated machine demands auth** — not established: grok, opencode, copilot and codex passed `session/new` against this machine's pre-existing credential state (grok explicitly used its `~/.grok/auth.json` cached token); the probe performed no logins, so "no auth demand" here means existing credentials satisfied them.
5. **Prompt-time behavior** (`session/prompt`, permission requests, stop reasons, tool traffic) — never measured: no prompt was sent to any agent (no model spend, per task).
6. **codex native ACP** — confirmed absent from `codex --help` on this machine, but the adapter was measured only via `npx -y` cache execution; behavior under a global/pinned install was not tested.
7. **Session resume/load and mode switching** (`session/load`, `session/resume`, `modes` changes) — out of scope; only `initialize` + `session/new` were exercised.
8. **Versions/paths of not-installed CLIs** (cursor-agent, qwen, goose, antigravity) — nothing to record; not present on this machine.
