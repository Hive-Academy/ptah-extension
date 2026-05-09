# Ptah CLI JSON-RPC 2.0 Schema

Protocol reference for the `ptah` CLI's JSON-RPC 2.0 surface. Every notification, outbound request, inbound request, and error code is enumerated here with payload shape and example.

The authoritative source is `apps/ptah-cli/src/cli/jsonrpc/types.ts` (`PtahNotification`, `PtahOutboundRequest`, `PtahInboundRequest`, `PtahErrorCode`, `ExitCode` enums) and the matching `task-description.md` § 4.

## Transport

- **Wire format**: JSON-RPC 2.0, newline-delimited (NDJSON). One JSON object per line, terminated by `\n`.
- **Direction**: Bidirectional over stdio. CLI → client uses **stdout**; errors use **stderr**. Client → CLI uses **stdin**.
- **Envelope**: Strict JSON-RPC 2.0 — `jsonrpc: "2.0"`, notifications omit `id`, requests carry a string or number `id`, responses match by `id` and contain exactly one of `result` or `error`.
- **Capability negotiation**: At startup of `interact` mode, the CLI emits exactly one `session.ready` notification (see § Session lifecycle) advertising `protocol_version: "2.0"` and a `capabilities` array.
- **Streaming subcommands**: `session start`, `session resume`, `session send`, `setup`, `analyze`, `execute-spec`, `interact` stream interim notifications and emit a single terminal `task.complete` or `task.error`.

## Lifecycle

```
client                                     CLI
  |                                         |
  |  spawn `ptah interact`                  |
  |---------------------------------------->|
  |                                         |  (DI bootstrap, bridges attach)
  |    <-- session.ready                    |
  |                                         |
  |  task.submit  { task: "..." }  -->      |
  |                                         |
  |    <-- agent.thought                    |
  |    <-- agent.tool_use                   |
  |    <-- (if approval)                    |
  |        permission.request { id: ... } --|
  |  permission.response { id: ..., decision: "allow" } -->
  |    <-- agent.tool_result                |
  |    <-- agent.message                    |
  |    <-- session.cost / token_usage       |
  |  --> response { id, result: { turn_id, complete: true } }
  |                                         |
  |  session.shutdown { } -->               |
  |  <-- response { id, result: { shutdown: true } }
  |                                         |  (drain, exit 0)
```

## 1. Notifications (CLI → client)

Notifications carry no `id` and require no response. Each `params` includes a baseline envelope (`session_id?`, `command?`, `timestamp` ISO-8601) plus capability-specific fields. Only the load-bearing fields are documented below.

### 1.1 Session lifecycle (`session.*`)

| Method                | Trigger                                            | Key params                                                                                         |
| --------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `session.ready`       | `interact` startup post-DI, post-bridge attach     | `{ session_id, version, capabilities: string[], protocol_version: '2.0' }`                         |
| `session.created`     | `session start` succeeded                          | `{ session_id, profile?, cwd, created_at }`                                                        |
| `session.list`        | `session list` result                              | `{ entries: Array<{ id, name?, profile?, cwd, last_active, status }> }`                            |
| `session.history`     | `session load` / inbound `session.history` request | `{ session_id, messages: Array<{ role, text, timestamp, tool_calls?, cost? }> }`                   |
| `session.stats`       | `session stats` result                             | `{ entries: Array<{ session_id, turns, total_cost_usd, total_tokens, last_active }> }`             |
| `session.valid`       | `session validate` result                          | `{ session_id, valid: bool, issues?: string[] }`                                                   |
| `session.stopped`     | `session stop` succeeded                           | `{ session_id, stopped_at }`                                                                       |
| `session.deleted`     | `session delete` succeeded                         | `{ session_id }`                                                                                   |
| `session.renamed`     | `session rename` succeeded                         | `{ session_id, name }`                                                                             |
| `session.id_resolved` | Internal — resolves a tabId to an SDK session id   | `{ tab_id, session_id }`                                                                           |
| `session.cost`        | After each agent turn                              | `{ session_id, turn_id, delta_usd, total_usd }`                                                    |
| `session.token_usage` | After each agent turn                              | `{ session_id, turn_id, input_tokens, output_tokens, cache_read_tokens?, cache_creation_tokens? }` |

Example:

```json
{ "jsonrpc": "2.0", "method": "session.ready", "params": { "session_id": "tab-abc", "version": "0.1.0", "capabilities": ["chat", "session", "permission", "question"], "protocol_version": "2.0" } }
```

### 1.2 Agent execution (`agent.*`)

| Method              | Trigger                                            | Key params                                               |
| ------------------- | -------------------------------------------------- | -------------------------------------------------------- |
| `agent.thought`     | Internal reasoning chunk (suppressed by `--quiet`) | `{ session_id, turn_id, text }`                          |
| `agent.tool_use`    | Tool invocation                                    | `{ session_id, turn_id, tool_use_id, tool_name, input }` |
| `agent.tool_result` | Tool returns                                       | `{ session_id, turn_id, tool_use_id, output, is_error }` |
| `agent.message`     | Final assistant message chunk                      | `{ session_id, turn_id, text, role: 'assistant' }`       |

Example:

```json
{ "jsonrpc": "2.0", "method": "agent.tool_use", "params": { "session_id": "tab-abc", "turn_id": "turn-1", "tool_use_id": "tu-7", "tool_name": "Read", "input": { "file_path": "/repo/README.md" } } }
```

### 1.3 Agent surface — packs + applied (`agent.*`, `agent_cli.*`)

| Method                        | Trigger                          | Key params                                                           |
| ----------------------------- | -------------------------------- | -------------------------------------------------------------------- |
| `agent.packs.list`            | `agent packs list`               | `{ packs: AgentPackInfo[] }`                                         |
| `agent.pack.install.start`    | `agent packs install <id>` start | `{ pack_id }`                                                        |
| `agent.pack.install.progress` | Mid-install                      | `{ pack_id, progress: number, current_agent? }`                      |
| `agent.pack.install.complete` | Install complete                 | `{ pack_id, installed: string[], skipped: string[], changed: bool }` |
| `agent.list`                  | `agent list`                     | `{ entries: Array<{ name, path }> }`                                 |
| `agent.applied`               | `agent apply <name>`             | `{ name, path, changed: bool }`                                      |
| `agent_cli.detection`         | `agent-cli detect`               | `{ entries: Array<{ id, available, path?, version? }> }`             |
| `agent_cli.config`            | `agent-cli config get`           | `{ config: AgentOrchestrationConfig }`                               |
| `agent_cli.config.updated`    | `agent-cli config set`           | `{ key, value, changed: bool }`                                      |
| `agent_cli.models`            | `agent-cli models list`          | `{ entries: Array<{ cli, model_id }> }`                              |
| `agent_cli.stopped`           | `agent-cli stop <id>`            | `{ agent_id }`                                                       |
| `agent_cli.resumed`           | `agent-cli resume <id>`          | `{ agent_id, session_id? }` (then `agent.*` chat notifications)      |

### 1.4 Setup wizard + analyze (`wizard.*`, `analyze.*`)

| Method                        | Trigger                  | Key params                                                                          |
| ----------------------------- | ------------------------ | ----------------------------------------------------------------------------------- |
| `wizard.generation.progress`  | Mid-generation           | `{ phase, percent_complete, current_operation?, agents_processed?, total_agents? }` |
| `wizard.generation.stream`    | Per chunk                | `{ stream_id, chunk: string }`                                                      |
| `wizard.generation.complete`  | After generation         | `{ generation_id, summary }`                                                        |
| `analyze.start`               | `analyze` start          | `{ workspace_path }`                                                                |
| `analyze.framework_detected`  | Per framework            | `{ name, confidence, evidence }`                                                    |
| `analyze.dependency_detected` | Per dependency           | `{ name, version, role }`                                                           |
| `analyze.recommendation`      | Per agent recommendation | `{ agent_id, score, rationale }`                                                    |
| `analyze.complete`            | `analyze` end            | `{ workspace_path, frameworks, deps, recommendations }`                             |

> `setup.phase.start` / `setup.phase.complete` / `setup.complete` (Phase 2 / not yet implemented as discrete notifications). The `setup` orchestrator currently surfaces the underlying `analyze.*`, `wizard.generation.*`, and `harness.applied` events end-to-end. The dedicated `setup.*` cluster is reserved for a future Phase 2 enhancement.

> `wizard.recommendations`, `wizard.cancelled`, `wizard.retry.start`, `wizard.retry.complete` (Phase 2 / not yet wired through the event-pipe). `analyze.cancelled` is also reserved.

> The legacy `new_project.*` notifications were retired alongside the static New Project Wizard. New projects now hand off to the chat view via `wizard:start-new-project-chat` (no notifications emitted).

Example:

```json
{ "jsonrpc": "2.0", "method": "wizard.generation.progress", "params": { "phase": "generate", "percent_complete": 42, "current_operation": "writing senior-tester.md", "agents_processed": 3, "total_agents": 7 } }
```

### 1.5 Harness (`harness.*`)

| Method                          | Trigger                           | Key params                                                               |
| ------------------------------- | --------------------------------- | ------------------------------------------------------------------------ |
| `harness.initialized`           | `harness init`                    | `{ path, created: string[], skipped: string[] }`                         |
| `harness.status`                | `harness status`                  | `{ path, has_skills, has_agents, has_specs, plugins_enabled: string[] }` |
| `harness.workspace_context`     | After `harness:initialize` RPC    | `{ workspace_path, git_branch?, ... }`                                   |
| `harness.available_agents`      | After `harness:initialize`        | `{ entries }`                                                            |
| `harness.available_skills`      | After `harness:initialize`        | `{ entries }`                                                            |
| `harness.existing_presets`      | After `harness:initialize`        | `{ entries }`                                                            |
| `harness.applied`               | After `harness:apply`             | `{ preset_name, files_written: string[], changed: bool }`                |
| `harness.preset.saved`          | `harness preset save`             | `{ name, changed: bool }`                                                |
| `harness.preset.list`           | `harness preset load`             | `{ presets }`                                                            |
| `harness.intent.analysis`       | `harness analyze-intent`          | `{ intent, suggested_config }`                                           |
| `harness.agent_design.start`    | `harness design-agents` start     | `{ stream_id }`                                                          |
| `harness.agent_design.complete` | `harness design-agents` end       | `{ stream_id, output }`                                                  |
| `harness.document.start`        | `harness generate-document` start | `{ stream_id, kind }`                                                    |
| `harness.document.stream`       | Per chunk                         | `{ stream_id, chunk: string }`                                           |
| `harness.document.complete`     | `harness generate-document` end   | `{ stream_id, output }`                                                  |

> `harness.chat.message` / `harness.chat.complete` (Phase 2 / not yet implemented as a separate cluster — `harness chat` is currently an alias for `session start --scope harness-skill` and emits `agent.*` notifications).

### 1.6 Plugin / MCP / Skill (`plugin.*`, `mcp.*`, `skill.*`)

| Method                  | Trigger                            | Key params                                                  |
| ----------------------- | ---------------------------------- | ----------------------------------------------------------- |
| `plugin.list`           | `plugin list`                      | `{ entries: PluginInfo[] }`                                 |
| `plugin.config.value`   | `plugin config get`                | `{ enabled_plugin_ids, disabled_skill_ids }`                |
| `plugin.config.updated` | `plugin enable/disable/config set` | `{ enabled_plugin_ids, disabled_skill_ids, changed: bool }` |
| `plugin.skills.list`    | `plugin skills list`               | `{ entries: PluginSkillEntry[] }`                           |
| `mcp.search`            | `mcp search`                       | `{ query, results: McpServerEntry[] }`                      |
| `mcp.details`           | `mcp details`                      | `{ name, server: McpServerDetail }`                         |
| `mcp.installed`         | `mcp install`                      | `{ name, target, changed: bool }`                           |
| `mcp.uninstalled`       | `mcp uninstall`                    | `{ key, target, changed: bool }`                            |
| `mcp.list`              | `mcp list`                         | `{ entries: Array<{ name, target }> }`                      |
| `mcp.popular`           | `mcp popular`                      | `{ entries: McpServerEntry[] }`                             |
| `skill.search`          | `skill search`                     | `{ query, results }`                                        |
| `skill.list`            | `skill installed`                  | `{ entries }`                                               |
| `skill.installed`       | `skill install`                    | `{ skill_id, scope, changed: bool }`                        |
| `skill.removed`         | `skill remove`                     | `{ name, scope, changed: bool }`                            |
| `skill.popular`         | `skill popular`                    | `{ entries }`                                               |
| `skill.recommended`     | `skill recommended`                | `{ entries }`                                               |
| `skill.created`         | `skill create`                     | `{ skill_id, path }`                                        |

> `mcp.install.start` / `mcp.install.progress` / `mcp.install.complete` / `mcp.uninstall.complete` (Phase 2 / not yet implemented as discrete sub-events — current `mcp.installed` / `mcp.uninstalled` are single-shot terminal notifications).

> `skill.install.start` / `skill.install.complete` / `skill.remove.complete` / `skill.create.complete` (Phase 2 / not yet implemented as discrete sub-events — current `skill.installed` / `skill.removed` / `skill.created` are single-shot terminal notifications).

Example:

```json
{ "jsonrpc": "2.0", "method": "plugin.config.updated", "params": { "enabled_plugin_ids": ["typescript", "react"], "disabled_skill_ids": [], "changed": true } }
```

### 1.7 Auth / Provider (`auth.*`, `provider.*`)

| Method                     | Trigger                | Key params                                                   |
| -------------------------- | ---------------------- | ------------------------------------------------------------ |
| `auth.status`              | `auth status`          | `{ providers: Array<{ id, authenticated, ... }> }`           |
| `auth.health`              | `auth status`          | `{ providers: Array<{ id, healthy }> }`                      |
| `auth.api_key.status`      | `auth status`          | `{ providers: Array<{ id, has_api_key }> }`                  |
| `auth.login.start`         | `auth login`           | `{ provider }`                                               |
| `auth.login.url`           | `auth login` (OAuth)   | `{ provider, url }`                                          |
| `auth.login.complete`      | `auth login`           | `{ provider, success: bool }`                                |
| `auth.logout.complete`     | `auth logout`          | `{ provider, success: bool }`                                |
| `auth.test.result`         | `auth test`            | `{ provider, success: bool, message? }`                      |
| `provider.status`          | `provider status`      | `{ providers: Array<{ id, has_api_key, ... }> }`             |
| `provider.default`         | `provider default get` | `{ provider }`                                               |
| `provider.default.updated` | `provider default set` | `{ provider, changed: bool }`                                |
| `provider.models`          | `provider models list` | `{ provider, models: ModelInfo[] }`                          |
| `provider.tiers`           | `provider tier get`    | `{ tiers: Record<'sonnet'\|'opus'\|'haiku', string\|null> }` |
| `provider.tier.updated`    | `provider tier set`    | `{ tier, model, changed: bool }`                             |
| `provider.tier.cleared`    | `provider tier clear`  | `{ tier }`                                                   |
| `provider.key.set`         | `provider set-key`     | `{ provider, changed: bool }`                                |
| `provider.key.removed`     | `provider remove-key`  | `{ provider, changed: bool }`                                |

### 1.8 Config (`config.*`)

| Method             | Trigger                             | Key params                             |
| ------------------ | ----------------------------------- | -------------------------------------- |
| `config.value`     | `config get`                        | `{ key, value }`                       |
| `config.updated`   | `config set` / `config reset`       | `{ key, value, changed: bool }`        |
| `config.list`      | `config list`                       | `{ entries: Record<string, unknown> }` |
| `config.model`     | `config model-get` / `model-switch` | `{ current, available? }`              |
| `config.models`    | `config models list`                | `{ models: ModelInfo[] }`              |
| `config.autopilot` | `config autopilot get` / `set`      | `{ enabled: bool }`                    |
| `config.effort`    | `config effort get` / `set`         | `{ effort_level }`                     |

### 1.9 Workspace / Git / License / Web search / Settings / Quality / Prompts

| Method                 | Trigger                                   | Key params                                   |
| ---------------------- | ----------------------------------------- | -------------------------------------------- |
| `workspace.info`       | `workspace info`                          | `{ folders, active }`                        |
| `workspace.added`      | `workspace add`                           | `{ path, changed: bool }`                    |
| `workspace.removed`    | `workspace remove`                        | `{ path, changed: bool }`                    |
| `workspace.switched`   | `workspace switch`                        | `{ path }`                                   |
| `git.info`             | `git info`                                | `{ branch, dirty, ahead, behind }`           |
| `git.worktrees`        | `git worktrees`                           | `{ entries }`                                |
| `git.worktree.added`   | `git add-worktree`                        | `{ path, branch, changed: bool }`            |
| `git.worktree.removed` | `git remove-worktree`                     | `{ path, changed: bool }`                    |
| `git.staged`           | `git stage`                               | `{ paths }`                                  |
| `git.unstaged`         | `git unstage`                             | `{ paths }`                                  |
| `git.discarded`        | `git discard --confirm`                   | `{ paths }`                                  |
| `git.committed`        | `git commit`                              | `{ sha, message }`                           |
| `git.file`             | `git show-file`                           | `{ path, content }`                          |
| `license.status`       | `license status`                          | `{ valid: bool, tier?, expires_at? }`        |
| `license.updated`      | `license set`                             | `{ valid: bool, changed: bool }`             |
| `license.cleared`      | `license clear`                           | `{ changed: bool }`                          |
| `websearch.status`     | `websearch status`                        | `{ provider, has_api_key }`                  |
| `websearch.config`     | `websearch config get`                    | `{ provider, max_results }`                  |
| `websearch.test`       | `websearch test`                          | `{ success: bool, message? }`                |
| `websearch.updated`    | `websearch set-key/remove-key/config set` | `{ key, value?, changed: bool }`             |
| `settings.exported`    | `settings export`                         | `{ path?, size_bytes }`                      |
| `settings.imported`    | `settings import`                         | `{ keys_imported: string[], changed: bool }` |

> `quality.assessment` / `quality.history` / `quality.export.complete` are emitted by the `quality *` commands per the underlying `quality:*` RPC handler payloads (Phase 2 / dedicated wire schema documentation deferred).

> `prompts.status` / `prompts.enabled` / `prompts.disabled` / `prompts.regenerate.start` / `prompts.regenerate.complete` / `prompts.content` / `prompts.download.complete` track the underlying `enhancedPrompts:*` payloads.

### 1.10 Task lifecycle (`task.*`)

| Method          | Trigger                               | Key params                                                           |
| --------------- | ------------------------------------- | -------------------------------------------------------------------- |
| `task.start`    | Streaming command begins a turn       | `{ command, turn_id }`                                               |
| `task.complete` | Any non-interactive command succeeded | `{ command, duration_ms, summary?: object }`                         |
| `task.error`    | Any command failed (non-recoverable)  | `{ command, code, message, recoverable: bool, ptah_code, details? }` |

Example:

```json
{ "jsonrpc": "2.0", "method": "task.error", "params": { "command": "session start", "code": -32603, "message": "license invalid", "recoverable": false, "ptah_code": "license_required" } }
```

### 1.11 Diagnostics (`debug.*`, only with `--verbose`)

| Method           | Trigger                | Key params                      |
| ---------------- | ---------------------- | ------------------------------- |
| `debug.di.phase` | Per DI bootstrap phase | `{ phase: string, ms: number }` |

> `debug.rpc.routing`, `debug.cli_agent.spawn` (Phase 2 / not yet implemented).

### 1.12 Anthropic-compatible HTTP proxy (`proxy.*`)

Emitted by `apps/ptah-cli/src/services/proxy/anthropic-proxy.service.ts` while
the `ptah proxy start` command is running. When the proxy is launched embedded
inside `ptah interact`, these notifications are streamed on stdout via the
parent JSON-RPC server. When launched standalone (`--auto-approve`), they are
emitted via the structured stderr formatter only — there is no JSON-RPC peer.

The proxy itself exposes an Anthropic Messages API on a TCP port and accepts
both `stream: true` (SSE) and `stream: false` (JSON) requests. The caller's
`model` field is **ignored** in MVP — Ptah's active model resolution wins
(provider tier). Treat the Anthropic API as **transport-only**. The caller's
`system` prompt is **appended** to Ptah's core system prompt (Ptah harness
wins on conflict).

| Method               | Trigger                                                | Key params                                                                                                |
| -------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `proxy.started`      | HTTP server bound + token issued                       | `{ host, port, token_path, expose_workspace_tools: bool }`                                                |
| `proxy.token.issued` | Bearer-token mint event (also written 0o600 to disk)   | `{ token, port }` — caller-side notification mirrors `~/.ptah/proxy/<port>.token`. Treat token as secret. |
| `proxy.request`      | Per-request lifecycle (start + complete)               | `{ request_id, model, tool_count, stream: bool, phase: 'start' \| 'complete', duration_ms? }`             |
| `proxy.tool_invoked` | Workspace MCP tool surfaced in caller `tools[]`        | `{ request_id, tool_name, source: 'caller' \| 'workspace' }`                                              |
| `proxy.warning`      | Non-fatal soft-fails (e.g. caller/workspace collision) | `{ request_id?, kind, message, details? }`                                                                |
| `proxy.error`        | Per-request fatal (HTTP 4xx/5xx surfaced as SSE error) | `{ request_id?, code, message }`                                                                          |
| `proxy.stopped`      | HTTP server closed (idempotent)                        | `{ port, reason: 'shutdown' \| 'sigint' \| 'rpc' }`                                                       |

Example — proxy startup:

```json
{ "jsonrpc": "2.0", "method": "proxy.started", "params": { "host": "127.0.0.1", "port": 51234, "token_path": "~/.ptah/proxy/51234.token", "expose_workspace_tools": true } }
```

Example — token issuance (literal secret — never log):

```json
{ "jsonrpc": "2.0", "method": "proxy.token.issued", "params": { "token": "1f4d3e...redacted...c7a9", "port": 51234 } }
```

Example — request lifecycle:

```json
{ "jsonrpc": "2.0", "method": "proxy.request", "params": { "request_id": "req-9c4e", "model": "claude-3-5-sonnet-20241022", "tool_count": 3, "stream": true, "phase": "start" } }
{ "jsonrpc": "2.0", "method": "proxy.request", "params": { "request_id": "req-9c4e", "model": "claude-3-5-sonnet-20241022", "tool_count": 3, "stream": true, "phase": "complete", "duration_ms": 4271 } }
```

Example — tool collision warning (caller-supplied + workspace `Read` collide):

```json
{ "jsonrpc": "2.0", "method": "proxy.warning", "params": { "request_id": "req-9c4e", "kind": "tool_collision", "message": "1 caller tool name collided with a workspace tool — caller tool wins", "details": { "collisions": ["Read"] } } }
```

> The proxy listens on `127.0.0.1:<port>` by default and accepts `--host` /
> `--port` overrides. `GET /healthz` returns `{ ok: true, port, uptime_ms }`
> with no auth; all other paths require `x-api-key: <token>` (timing-safe
> compare). `?expose_workspace_tools=false` opts out of workspace MCP +
> skill injection on a per-request basis.

The peer can also send `proxy.shutdown` as an inbound JSON-RPC request (see § 3) to close the proxy gracefully when running embedded.

## 2. Outbound requests (CLI → client, response REQUIRED)

These are JSON-RPC requests carrying an `id`. The client MUST reply with a matching response on stdin.

| Method               | When                                                   | Params                                                                 | Expected result                                                                      |
| -------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `permission.request` | Tool requires approval and `--auto-approve` is unset   | `{ session_id, turn_id, tool_use_id, tool_name, tool_input, reason? }` | `{ decision: 'allow'\|'deny'\|'always_allow', scope?: 'session'\|'global' }`         |
| `question.ask`       | Agent needs a user choice                              | `{ session_id, turn_id, question, options: string[], allow_custom? }`  | `{ answer: string, custom?: bool }`                                                  |
| `oauth.url.open`     | OAuth flow needs a browser (headless device-code flow) | `{ provider, url }`                                                    | `{ opened: bool, code?: string }` (client opens URL and may return device-flow code) |

Example:

```json
{ "jsonrpc": "2.0", "id": "req-7", "method": "permission.request", "params": { "session_id": "tab-abc", "turn_id": "turn-1", "tool_use_id": "tu-9", "tool_name": "Bash", "tool_input": { "command": "npm test" } } }
```

Client reply:

```json
{ "jsonrpc": "2.0", "id": "req-7", "result": { "decision": "allow", "scope": "session" } }
```

## 3. Inbound requests (client → CLI, in `interact` mode)

Wired by `apps/ptah-cli/src/cli/commands/interact.ts` after `session.ready` is emitted.

| Method                | Behavior                                                                                                                                                                                             | Params                                                                                           | Result                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `task.submit`         | Submit a new turn (or first turn — `chat:start` for the first turn, `chat:continue` thereafter). Only ONE turn may be in flight; concurrent submit returns `-32603 'turn already in flight'`.        | `{ task: string, cwd?: string, profile?: 'claude_code'\|'enhanced' }`                            | `{ turn_id: string, complete: bool, cancelled?: bool, error?: string, session_id?: string }` |
| `task.cancel`         | Cancel an in-flight turn (races the in-flight `runTurn` with `chat:abort` via an `AbortController`). Idempotent — non-matching `turn_id` returns `{ cancelled: false, reason: 'no matching turn' }`. | `{ turn_id: string }`                                                                            | `{ cancelled: bool, turn_id?: string, reason?: string }`                                     |
| `session.shutdown`    | Graceful shutdown. CLI responds immediately, then drains (≤ 5s) and exits 0.                                                                                                                         | `{}`                                                                                             | `{ shutdown: true }`                                                                         |
| `session.history`     | Retrieve full conversation history; proxies `session:load`.                                                                                                                                          | `{ limit?: number }`                                                                             | `{ messages: unknown[], session_id: string }`                                                |
| `permission.response` | Reply to a `permission.request` (handled by `ApprovalBridge`). Fire-and-forget — no response.                                                                                                        | `{ id: string\|number, decision: 'allow'\|'deny'\|'always_allow', scope?: 'session'\|'global' }` | (no response)                                                                                |
| `question.response`   | Reply to a `question.ask` (handled by `ApprovalBridge`). Fire-and-forget — no response.                                                                                                              | `{ id: string\|number, answer: string, custom?: bool }`                                          | (no response)                                                                                |
| `proxy.shutdown`      | Close the embedded Anthropic-compatible HTTP proxy gracefully. Only registered when `ptah proxy start` is launched inside `ptah interact`. Idempotent — second call returns `{ stopped: false }`.    | `{}`                                                                                             | `{ stopped: bool, port?: number, reason?: string }`                                          |

Example — submit a turn:

```json
{ "jsonrpc": "2.0", "id": "sub-1", "method": "task.submit", "params": { "task": "explain this repo" } }
```

CLI reply (after streaming intermediate notifications):

```json
{ "jsonrpc": "2.0", "id": "sub-1", "result": { "turn_id": "turn-abc", "complete": true } }
```

## 4. Errors (CLI → client, written to stderr)

Errors are emitted as JSON-RPC error responses on stderr. Notifications never carry errors — they're written silently or omitted.

```json
{"jsonrpc":"2.0","id":<id-or-null>,"error":{"code":<int>,"message":<string>,"data":{"ptah_code":<string>,"command"?:<string>,...details}}}
```

### 4.1 Standard JSON-RPC codes

| Code     | Meaning          | Use                                                             |
| -------- | ---------------- | --------------------------------------------------------------- |
| `-32700` | Parse error      | Malformed JSON received on stdin.                               |
| `-32600` | Invalid request  | Missing `jsonrpc` / `method` fields, or schema-level violation. |
| `-32601` | Method not found | Unknown JSON-RPC method.                                        |
| `-32602` | Invalid params   | Schema validation failure on params.                            |
| `-32603` | Internal error   | Unhandled exception, concurrent submit, transport failure.      |

### 4.2 Ptah-specific codes (`error.data.ptah_code`)

| `ptah_code`                   | Meaning                                                                                           | Process Exit | Recoverable                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------- | ------------ | -------------------------------- |
| `db_lock`                     | Prisma DB locked / contention                                                                     | `1`          | Yes (retry)                      |
| `provider_unavailable`        | Provider endpoint unreachable                                                                     | `1`          | Yes (retry)                      |
| `auth_required`               | No valid credentials                                                                              | `3`          | No (user action)                 |
| `rate_limited`                | Provider rate limit                                                                               | `1`          | Yes (backoff)                    |
| `license_required`            | Subscription invalid                                                                              | `4`          | No                               |
| `unknown`                     | Unrecognized resource                                                                             | `1`          | No                               |
| `internal_failure`            | Unrecoverable internal error                                                                      | `5`          | No                               |
| `wizard_phase_failed`         | Setup wizard phase did not complete (`data.phase` carries the phase name)                         | `1`          | Sometimes                        |
| `generation_failed`           | Agent-generation pipeline failed (`data.item_id` carries the failed item)                         | `1`          | Sometimes (retry-item)           |
| `harness_invalid`             | `.ptah/` directory in invalid state                                                               | `1`          | Yes (re-run init)                |
| `mcp_install_failed`          | MCP server install rejected by target CLI (`data.target` carries the target id)                   | `1`          | Sometimes                        |
| `cli_agent_unavailable`       | Required CLI agent (gemini/glm) not on PATH OR rejected by allowlist                              | `3`          | No (user install)                |
| `proxy_bind_failed`           | Anthropic proxy could not bind requested host/port (`data.host`/`data.port`/`data.cause`)         | `1`          | Sometimes (try a different port) |
| `proxy_invalid_request`       | Proxy received a malformed Anthropic Messages request (HTTP 400; `data.detail` carries the cause) | `1`          | Yes (caller fix)                 |
| `permission_gate_unavailable` | `ptah proxy start` invoked without `--auto-approve` and not embedded in `ptah interact`           | `3`          | No (user action)                 |

Example — invalid params on `task.submit`:

```json
{ "jsonrpc": "2.0", "id": "sub-1", "error": { "code": -32602, "message": "task.submit: 'task' (non-empty string) required" } }
```

Example — license required on `session start`:

```json
{ "jsonrpc": "2.0", "id": null, "error": { "code": -32603, "message": "license invalid", "data": { "ptah_code": "license_required", "command": "session start" } } }
```

## 5. Source references

- Type definitions: `apps/ptah-cli/src/cli/jsonrpc/types.ts` (`PtahNotification`, `PtahOutboundRequest`, `PtahInboundRequest`, `PtahErrorCode`, `ExitCode`, `JsonRpcErrorCode`).
- Server: `apps/ptah-cli/src/cli/jsonrpc/server.ts`.
- Encoder: `apps/ptah-cli/src/cli/jsonrpc/encoder.ts`.
- `interact` handler wiring: `apps/ptah-cli/src/cli/commands/interact.ts`.
- Approval round-trip: `apps/ptah-cli/src/cli/session/approval-bridge.ts`.
- Chat / turn bridge: `apps/ptah-cli/src/cli/session/chat-bridge.ts`.
- Push event forwarding: `apps/ptah-cli/src/cli/output/event-pipe.ts`.

For higher-level command behavior (DI scope, idempotency, exit codes per command), see [`../README.md`](../README.md). For migration from the legacy TUI, see [`migration.md`](migration.md).
