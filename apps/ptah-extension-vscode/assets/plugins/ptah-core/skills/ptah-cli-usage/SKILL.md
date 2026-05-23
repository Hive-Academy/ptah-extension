---
name: ptah-cli-usage
description: How to drive the Ptah CLI (`@hive-academy/ptah-cli`) for headless agent workflows, A2A bridges, CI pipelines, and scripted refactors. Triggers on user mentions of "ptah cli", "ptah session start", "ptah interact", "ptah auth", "ptah provider", "JSON-RPC stdio", or any headless Ptah usage including openclaw/nemoclaw bridges.
---

# Ptah CLI Usage

`@hive-academy/ptah-cli` ships the same DI graph used by the Ptah VS Code
extension and Electron app, exposed as a single `ptah` binary that speaks
JSON-RPC 2.0 NDJSON over stdio. It is the right tool for **headless** Ptah
usage: agent-to-agent bridges, CI pipelines, scripted refactors, batch
operations, daemon integrations.

Authoritative sources (verify behavior here when in doubt):

- `apps/ptah-cli/CLAUDE.md` — architecture overview
- `apps/ptah-cli/README.md` — full command reference, flags, env vars, exit codes
- `apps/ptah-cli/docs/jsonrpc-schema.md` — wire schema for every notification + request
- `apps/ptah-cli/docs/migration.md` — migration from the legacy Ink TUI
- `apps/ptah-cli/src/cli/router.ts` — commander wiring (source of truth)
- `apps/ptah-cli/src/cli/commands/*.ts` — per-command handlers
- `apps/ptah-cli/src/cli/bootstrap/with-engine.ts` — DI bootstrap modes
- `apps/ptah-cli/src/cli/jsonrpc/types.ts` — `ExitCode`, `PtahErrorCode` enums

---

## 1. CLI vs Extension vs Electron — when to use which

| Need                                                     | Use                          |
| -------------------------------------------------------- | ---------------------------- |
| Interactive coding inside an editor                      | VS Code ext                  |
| Standalone desktop app with chat UI                      | Electron                     |
| Headless agent driving Ptah from another process         | **CLI**                      |
| CI / GitHub Actions / scheduled jobs                     | **CLI**                      |
| A2A bridge (OpenClaw / NemoClaw / external orchestrator) | **CLI**                      |
| Scripted refactor or bulk task execution                 | **CLI**                      |
| Anthropic-compatible HTTP proxy in front of Ptah         | **CLI** (`ptah proxy start`) |
| TTY UI, keyboard navigation, mouse                       | NOT the CLI                  |

The CLI runs the agent backend **in-process** — there is no IPC boundary,
just `stdin`/`stdout` carrying JSON-RPC 2.0 envelopes and `stderr`
carrying logger output and OAuth URLs.

---

## 2. One-shot vs `ptah interact`

**One-shot commands** (`ptah session start --task "..."`, `ptah analyze`,
`ptah setup`, `ptah execute-spec --id ...`) bootstrap DI, run the work,
emit notifications + a terminal `task.complete`/`task.error`, drain
stdout, and exit. Use these for fire-and-forget invocations and scripted
batch jobs.

**`ptah interact`** opens a persistent JSON-RPC 2.0 stdio loop. The
process stays alive across many `task.submit` requests, supports
permission round-trips, and is the right entry point for any A2A bridge
or daemon. Capabilities are advertised via `session.ready` at startup.

Canonical machine-mode invocation (single turn through the persistent loop):

```bash
echo '{"jsonrpc":"2.0","id":"1","method":"task.submit","params":{"task":"explain this repo"}}' \
  | ptah interact
```

For a batch script that wants the simpler one-shot semantics:

```bash
ptah session start --task "explain this repo" --once
```

`--once` makes `session start` exit at the end of the turn instead of
keeping the session alive.

---

## 3. Auth bootstrap recipes

The agent SDK supports five auth strategies (`libs/backend/agent-sdk/src/lib/auth/strategies/`):
`api-key`, `cli`, `oauth-proxy`, `local-native`, `local-proxy`. Each
provider in the registry (`libs/backend/agent-sdk/src/lib/providers/_shared/provider-registry.ts`)
is bound to one. Pre-seed credentials before invoking any streaming
command — `session start`, `setup`, `analyze`, and `execute-spec` will
exit `3` (`auth_required`) otherwise.

### 3.1 Anthropic direct (API key)

```bash
ptah provider set-key --provider anthropic --key sk-ant-api03-...
ptah provider default set anthropic
ptah auth status   # verify authenticated:true
```

Or via env (read once on bootstrap, persisted only if you call
`set-key`):

```bash
export ANTHROPIC_API_KEY=sk-ant-api03-...
```

### 3.2 Claude CLI subscription

The Claude CLI's own login flow handles OAuth; Ptah picks up the
existing session via the `cli` strategy.

```bash
claude   # do the OAuth dance once in your shell
ptah config set authMethod claude-cli
ptah auth status
```

### 3.3 GitHub Copilot (device-code)

```bash
ptah auth login copilot
# stderr prints the verification URL + user code; visit it in any browser
# ptah auth status reflects authenticated:true once the device flow lands
```

In `interact` mode, the URL is delivered as an `oauth.url.open` outbound
JSON-RPC request instead of stderr — the peer is expected to open it
(see `apps/ptah-cli/src/cli/oauth/jsonrpc-oauth-url-opener.ts`).

### 3.4 OpenAI Codex

```bash
codex login --device-auth
ptah auth status
# auth login codex is supported but only prints the manual instructions —
# Codex's own CLI owns the device-code flow, Ptah just verifies.
```

See `apps/ptah-cli/src/cli/commands/auth.ts:217-237` for the codex
handler.

### 3.5 Z.AI (GLM) and Moonshot (Kimi)

Both are Anthropic-compatible vendors using the `api-key` strategy with
a custom base URL.

```bash
ptah provider set-key --provider z-ai --key <ZAI_KEY>
ptah provider set-key --provider moonshot --key <MOONSHOT_KEY>
ptah provider default set z-ai
```

Env-var fallback (when running in CI without `set-key`):

```bash
export ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic
export ANTHROPIC_AUTH_TOKEN=<ZAI_KEY>
```

The api-key strategy honors `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`
when no provider key is stored — see
`libs/backend/agent-sdk/src/lib/auth/strategies/api-key.strategy.ts`.

### 3.6 OpenRouter (local translation proxy)

OpenRouter uses the `local-proxy` strategy: Ptah spins up a small
in-process translation proxy that exposes an Anthropic-compatible
endpoint to the SDK while routing to OpenRouter's OpenAI-compatible API.

```bash
ptah provider set-key --provider openrouter --key sk-or-...
ptah provider default set openrouter
# Bootstrap of any streaming command will start the proxy automatically;
# ANTHROPIC_BASE_URL is set to 127.0.0.1:<port> internally.
```

### 3.7 Ollama (local + cloud)

Local Ollama uses the `local-native` strategy and assumes a daemon at
`http://localhost:11434`. Cloud Ollama uses `api-key`.

```bash
# Local
ollama serve &
ptah provider default set ollama

# Cloud
ptah provider set-key --provider ollama-cloud --key <KEY>
ptah provider default set ollama-cloud
```

---

## 4. Tier mapping (`sonnet` / `opus` / `haiku`)

Ptah uses a three-slot tier abstraction so harness configs can request
a model by capability rather than vendor-specific id. Set the slot
to a concrete model id for the active provider:

```bash
ptah provider tier set --tier sonnet --model glm-5.1
ptah provider tier set --tier opus   --model glm-5
ptah provider tier set --tier haiku  --model glm-4.5-air
ptah provider tier get
ptah provider tier clear --tier opus
```

Slots:

| Slot     | Intended use                                     |
| -------- | ------------------------------------------------ |
| `sonnet` | Default workhorse — most agent turns map here    |
| `opus`   | Heavy reasoning — Team Leader, deep analysis     |
| `haiku`  | Cheap classification, intent parsing, retrievals |

Each provider in `provider-registry.ts` ships a default tier mapping;
`provider tier set` overrides it.

---

## 5. JSON-RPC interact-mode protocol cookbook

Wire format: NDJSON, one JSON object per line, `\n`-terminated.

### 5.1 Inbound requests (client → CLI, in `interact` mode)

| Method                | Params                                                      | Result                                                   |
| --------------------- | ----------------------------------------------------------- | -------------------------------------------------------- |
| `task.submit`         | `{ task, cwd?, profile? }`                                  | `{ turn_id, complete, cancelled?, error?, session_id? }` |
| `task.cancel`         | `{ turn_id }`                                               | `{ cancelled, turn_id?, reason? }`                       |
| `session.shutdown`    | `{}`                                                        | `{ shutdown: true }` then drain + exit 0                 |
| `session.history`     | `{ limit? }`                                                | `{ messages, session_id }`                               |
| `permission.response` | `{ id, decision: 'allow'\|'deny'\|'always_allow', scope? }` | (fire-and-forget, no response)                           |
| `question.response`   | `{ id, answer, custom? }`                                   | (fire-and-forget, no response)                           |
| `proxy.shutdown`      | `{}`                                                        | `{ stopped, port?, reason? }` (only when proxy embedded) |

Only one `task.submit` may be in flight; concurrent submit returns
`-32603 'turn already in flight'`.

### 5.2 Outbound notifications (CLI → client)

~80 methods across 11 clusters: `session.*`, `agent.*`, `agent_cli.*`,
`wizard.*`, `analyze.*`, `harness.*`, `plugin.*`, `mcp.*`, `skill.*`,
`auth.*` / `provider.*`, `config.*`, `workspace.*`, `git.*`, `license.*`,
`websearch.*`, `settings.*`, `task.*`, `debug.*`, `proxy.*`. Full taxonomy:
`apps/ptah-cli/docs/jsonrpc-schema.md` § 1.

The streaming spine for any agent turn:

```
agent.thought → agent.tool_use → (permission.request ↔ permission.response)
              → agent.tool_result → agent.message → session.cost
              → session.token_usage → task.complete
```

### 5.3 Outbound requests (CLI → client, response REQUIRED)

| Method               | Trigger                                      | Expected reply         |
| -------------------- | -------------------------------------------- | ---------------------- |
| `permission.request` | Tool gated and `--auto-approve` not set      | `{ decision, scope? }` |
| `question.ask`       | Agent needs a user choice                    | `{ answer, custom? }`  |
| `oauth.url.open`     | OAuth needs a browser (headless device-code) | `{ opened, code? }`    |

### 5.4 End-to-end NDJSON dialogue

Stdin (client → CLI):

```
{"jsonrpc":"2.0","id":"sub-1","method":"task.submit","params":{"task":"add a unit test for utils.ts"}}
{"jsonrpc":"2.0","id":"req-7","result":{"decision":"allow","scope":"session"}}
{"jsonrpc":"2.0","id":"shut","method":"session.shutdown","params":{}}
```

Stdout (CLI → client), one line per JSON object:

```
{"jsonrpc":"2.0","method":"session.ready","params":{"session_id":"tab-abc","version":"0.1.0","capabilities":["chat","session","permission","question"],"protocol_version":"2.0"}}
{"jsonrpc":"2.0","method":"task.start","params":{"command":"task.submit","turn_id":"turn-1"}}
{"jsonrpc":"2.0","method":"agent.thought","params":{"session_id":"tab-abc","turn_id":"turn-1","text":"I'll read utils.ts first"}}
{"jsonrpc":"2.0","method":"agent.tool_use","params":{"session_id":"tab-abc","turn_id":"turn-1","tool_use_id":"tu-1","tool_name":"Read","input":{"file_path":"utils.ts"}}}
{"jsonrpc":"2.0","method":"agent.tool_result","params":{"session_id":"tab-abc","turn_id":"turn-1","tool_use_id":"tu-1","output":"...","is_error":false}}
{"jsonrpc":"2.0","id":"req-7","method":"permission.request","params":{"session_id":"tab-abc","turn_id":"turn-1","tool_use_id":"tu-2","tool_name":"Write","tool_input":{"file_path":"utils.spec.ts"}}}
{"jsonrpc":"2.0","method":"agent.tool_result","params":{"session_id":"tab-abc","turn_id":"turn-1","tool_use_id":"tu-2","output":"wrote 42 lines","is_error":false}}
{"jsonrpc":"2.0","method":"agent.message","params":{"session_id":"tab-abc","turn_id":"turn-1","text":"Added utils.spec.ts","role":"assistant"}}
{"jsonrpc":"2.0","method":"session.cost","params":{"session_id":"tab-abc","turn_id":"turn-1","delta_usd":0.0042,"total_usd":0.0042}}
{"jsonrpc":"2.0","method":"task.complete","params":{"command":"task.submit","duration_ms":4271}}
{"jsonrpc":"2.0","id":"sub-1","result":{"turn_id":"turn-1","complete":true}}
{"jsonrpc":"2.0","id":"shut","result":{"shutdown":true}}
```

Notes:

- `permission.request` carries an `id`; the client replies with a
  matching JSON-RPC response (note: the schema also accepts a fire-and-forget
  `permission.response` notification keyed by the same id — see
  `apps/ptah-cli/src/cli/session/approval-bridge.ts`).
- `task.complete` is the terminal notification for the turn; the
  `task.submit` response immediately follows.
- Always `\n`-terminate every line written to stdin.

---

## 6. Headless / unattended runs — env vars

| Env var                | When to set                                       | Effect                                                                                                              |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `PTAH_AUTO_APPROVE`    | CI, daemons, `proxy start` w/o JSON-RPC peer      | Auto-allow every `permission.request` (same as `--auto-approve`).                                                   |
| `PTAH_NO_TTY`          | Containers, CI, anything where `isTTY` may lie    | Force non-TTY mode; suppresses ANSI even with `--human`.                                                            |
| `NO_COLOR`             | Pipelines, log aggregators                        | Any non-empty value disables ANSI in `--human` mode.                                                                |
| `FORCE_COLOR=0`        | Bridge spawning the CLI from another process      | Disables color in deps that read it (matches Windows spawn pattern). Combine with `setEncoding('utf8')` on streams. |
| `PTAH_LOG_LEVEL`       | Debugging                                         | `debug` \| `info` \| `warn` \| `error`. `debug` writes to **stderr only**; never poisons stdout.                    |
| `PTAH_CONFIG_PATH`     | Sandboxed runs / multi-tenant CI                  | Override `~/.ptah/settings.json` location.                                                                          |
| `PTAH_DI_LAZY`         | Fast read-only commands                           | Default `true`. Skips DI bootstrap when only metadata is needed.                                                    |
| `ANTHROPIC_API_KEY`    | Anthropic direct without `set-key`                | Picked up by `api-key.strategy.ts`.                                                                                 |
| `ANTHROPIC_AUTH_TOKEN` | Z.AI / Moonshot / any Anthropic-compatible vendor | Used together with `ANTHROPIC_BASE_URL` to point the SDK at a non-Anthropic endpoint.                               |
| `ANTHROPIC_BASE_URL`   | Custom Anthropic-compatible endpoint              | Overrides the SDK's default base URL.                                                                               |

Reminder: `PTAH_AGENT_CLI_OVERRIDE` is **not** consulted. The
`agent-cli` allowlist (`glm`, `gemini` only) is hard-coded at command
entry points — see
`apps/ptah-cli/src/cli/commands/agent-cli.ts`.

---

## 7. Common pipelines and patterns

### 7.1 Spawn-and-stream from another process (Node.js)

```js
import { spawn } from 'node:child_process';

const child = spawn('ptah', ['interact'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, PTAH_AUTO_APPROVE: 'true', NO_COLOR: '1', FORCE_COLOR: '0' },
  shell: process.platform === 'win32', // .cmd shim on Windows
});

child.stdout.setEncoding('utf8');
let buf = '';
child.stdout.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (line.trim()) handleEnvelope(JSON.parse(line));
  }
});

child.stdin.write(
  JSON.stringify({
    jsonrpc: '2.0',
    id: '1',
    method: 'task.submit',
    params: { task: 'refactor utils.ts' },
  }) + '\n',
);
```

The Windows `shell: true` flag is required because `ptah` resolves to a
`.cmd` shim under `npm i -g`; `spawn` with `shell: false` errors with
ENOENT on Windows. The same pattern was learned in the `llm-abstraction`
CLI adapters — see `cli-adapter.utils.ts`'s `needsShellExecution`.

### 7.2 Pre-seed credentials in CI (GitHub Actions)

```yaml
- name: Configure Ptah
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    PTAH_AUTO_APPROVE: 'true'
    NO_COLOR: '1'
  run: |
    npm i -g @hive-academy/ptah-cli
    ptah license set --key ${{ secrets.PTAH_LICENSE_KEY }}
    ptah provider set-key --provider anthropic --key "$ANTHROPIC_API_KEY"
    ptah provider default set anthropic
    ptah provider tier set --tier sonnet --model claude-3-5-sonnet-20241022
    ptah auth status
```

### 7.3 Daemon bridging (HTTP → JSON-RPC stdio)

The `openclaw-control` pattern: a long-running HTTP server (the
"ptah-bridge") spawns one `ptah interact` process per session, multiplexes
JSON-RPC envelopes between HTTP clients and the child's stdio, and tears
the child down on `session.shutdown`. Key invariants:

- One `ptah interact` per session (turns are serialized per-process).
- Always wait for the `task.submit` response (or `task.error`) before
  issuing the next `task.submit` on the same session.
- Drain stdout for ≤ 5s after sending `session.shutdown` — see
  `InteractExecuteHooks.drainTimeoutMs` in
  `apps/ptah-cli/src/cli/commands/interact.ts`.
- Forward `permission.request` / `question.ask` to the HTTP client and
  return the response on stdin.

### 7.4 Scripted multi-task batch (one session per task)

```bash
for task in "lint" "test" "build"; do
  ptah session start --task "run npm $task and report" --once \
    --auto-approve --quiet --json > "logs/$task.ndjson" || exit $?
done
```

For a single persistent session running N tasks sequentially, use
`interact` and serialize `task.submit` envelopes (next one only after
the previous response lands).

### 7.5 Anthropic-compatible HTTP proxy

```bash
# Standalone (requires --auto-approve; emits proxy.* on stderr):
ptah proxy start --port 51234 --auto-approve

# Embedded inside interact (proxy.* notifications stream on stdout JSON-RPC):
ptah interact   # then: emit proxy.start as an outbound request (see schema § 1.12)
```

The proxy exposes Anthropic Messages API on `127.0.0.1:<port>`, mints a
bearer token in `~/.ptah/proxy/<port>.token`, and forwards through Ptah's
active model resolution (caller's `model` field is ignored). Use this
to put any Anthropic-SDK-aware client in front of Ptah's harness.

---

## 8. Exit codes

From `apps/ptah-cli/src/cli/jsonrpc/types.ts` `ExitCode`:

| Code  | Name              | Cause                                                                                              |
| ----- | ----------------- | -------------------------------------------------------------------------------------------------- |
| `0`   | `Success`         | Command completed.                                                                                 |
| `1`   | `GeneralError`    | Recoverable — unknown resource, task error, network blip, wizard phase failed, MCP install failed. |
| `2`   | `UsageError`      | Missing required flag, malformed value, conflicting flags.                                         |
| `3`   | `AuthRequired`    | Missing/invalid provider credentials OR required CLI agent missing.                                |
| `4`   | `LicenseRequired` | Subscription invalid or expired.                                                                   |
| `5`   | `InternalFailure` | Unhandled exception, DI bootstrap crash, unrecoverable IO.                                         |
| `130` | SIGINT            | Graceful shutdown after Ctrl-C.                                                                    |
| `143` | SIGTERM           | Graceful shutdown after kill signal.                                                               |

Map `task.error.params.ptah_code` to a recovery strategy via
`docs/jsonrpc-schema.md` § 4.2.

---

## 9. Troubleshooting

### `sdk_init_failed`

The `agent-sdk` adapter failed to initialize during the `'full'`
bootstrap. Most common causes: missing API key, unreachable provider,
broken `~/.ptah/settings.json`. Recovery:

```bash
ptah --verbose auth status         # see debug.di.phase events
ptah provider status --reveal      # confirm the right key is stored
ptah provider default get          # confirm the active provider
PTAH_LOG_LEVEL=debug ptah session start --task "ping" --once 2> ptah.log
```

If `requireSdk` was invoked from a metadata-only path (e.g. listing
providers), drop to `mode: 'minimal'` — see
`apps/ptah-cli/src/cli/bootstrap/with-engine.ts:117-145`. The full bootstrap
only runs for chat / setup / wizard / generation commands.

### `auth_required` from a streaming command

A premium-gated streaming command (`session start`, `setup`, `analyze`,
`execute-spec`) ran with no usable credentials. Recovery:

```bash
ptah auth status                                        # which providers are healthy?
ptah provider set-key --provider anthropic --key sk-... # or relevant provider
ptah provider default set anthropic
```

Exit code `3`. In CI, also set `PTAH_AUTO_APPROVE=true` so subsequent
permission gates don't block.

### `license_required`

Premium-gated commands check the Ptah license. Recovery:

```bash
ptah license status
ptah license set --key ptah_lic_...
```

Exit code `4`. Read-only commands (`license status`, `config list`,
`auth status`, `provider status`) are unaffected.

### Bridge / spawn issues on Windows

- `spawn('ptah', ...)` with `shell: false` → ENOENT (the `.cmd` shim).
  Fix: `shell: true` on `process.platform === 'win32'`.
- Stale ANSI / mojibake in captured output: set `FORCE_COLOR=0`,
  `NO_COLOR=1`, `PTAH_NO_TTY=1`; `setEncoding('utf8')` on the child's
  stdout.
- Truncated tail of the JSON-RPC stream: `process.stdout.write` is
  async on Windows pipes. Wait for the `task.submit` response and drain
  before tearing down — see "stdout drain" note in
  `apps/ptah-cli/CLAUDE.md`.

### Logs / verbose mode

- Logger output: **stderr only**. Pipe stdout through `jq` safely.
- `PTAH_LOG_LEVEL=debug` enables noisy backend logs (still stderr).
- `--verbose` enables `debug.di.phase` notifications on stdout (one per
  DI phase).
- Persistent settings: `~/.ptah/settings.json` (override with
  `--config <path>` or `PTAH_CONFIG_PATH`).
- Secrets: `~/.ptah/.secrets` (file-backed, 0o600).

---

## 10. Don'ts

- **Don't** use `ptah` for interactive UI — that's the VS Code extension
  or Electron app. The CLI exits when stdin closes.
- **Don't** assume `process.stdout.isTTY`. Default output is JSON-RPC
  NDJSON. Set `PTAH_NO_TTY=1` if a downstream library tries to detect
  TTYs.
- **Don't** pipe non-NDJSON to `interact` mode. One JSON object per
  line, `\n`-terminated. Malformed lines emit `-32700 parse error` on
  stderr.
- **Don't** mix `--human` with pipelines or `jq`. `--human` is for
  terminal debugging only.
- **Don't** manually edit `~/.ptah/.secrets`. Use
  `ptah provider set-key` / `ptah license set` / `ptah websearch set-key`.
- **Don't** issue concurrent `task.submit` on the same session — the
  second returns `-32603 'turn already in flight'`. Serialize, or open a
  second `interact` process.
- **Don't** rely on `PTAH_AGENT_CLI_OVERRIDE`. The `agent-cli` allowlist
  (`glm`, `gemini`) is hard-coded; `copilot` and `cursor` are blocked
  for Windows-spawn reasons.
- **Don't** re-add `ptah run` calls. It's a deprecated alias for
  `session start --task` and emits a stderr deprecation notice.

---

## 11. `ptah agent-cli` reference

`ptah agent-cli` manages user-installed CLI agents (model-vendor binaries
the SDK can spawn into agent sessions). The surface is locked to a
hard-coded allowlist enforced inside the command handler — see
`apps/ptah-cli/src/cli/commands/agent-cli.ts:48` (`CLI_AGENT_ALLOWLIST`)
and the per-subcommand validation in `validateCliAgent` at
`agent-cli.ts:131-142`.

**Allowlist**: only `glm` and `gemini` are accepted for `--cli`.
`PTAH_AGENT_CLI_OVERRIDE` is **never** consulted (verified at
`agent-cli.ts:22-23` and reinforced by the router comment at
`router.ts:597-599`). Any other value emits `task.error` with
`ptah_code: 'cli_agent_unavailable'` and exits `3` (`AuthRequired`).

### 11.1 `ptah agent-cli detect`

Detect installed CLI agents in the user's environment.

| Flag     | Required | Default | Notes                       |
| -------- | -------- | ------- | --------------------------- |
| _(none)_ | —        | —       | Pure read; no `--cli` flag. |

- **RPC**: `agent:detectClis` (`agent-cli.ts:163-178`).
- **Notification**: `agent_cli.detection { clis: CliDetectionResult[] }`.
- **Exit codes**: `0` on success; `5` (`InternalFailure`) on RPC error;
  never emits `cli_agent_unavailable` (no `--cli` flag).

### 11.2 `ptah agent-cli config get`

Read the current agent orchestration config.

| Flag     | Required | Default | Notes                                        |
| -------- | -------- | ------- | -------------------------------------------- |
| _(none)_ | —        | —       | Returns the full `AgentOrchestrationConfig`. |

- **RPC**: `agent:getConfig` (`agent-cli.ts:181-197`).
- **Notification**: `agent_cli.config { config: AgentOrchestrationConfig }`.
- **Exit codes**: `0`, `5`.

### 11.3 `ptah agent-cli config set`

Write a single config entry. Coercion rules (`agent-cli.ts:358-399`):
boolean keys (`codexAutoApprove`, `copilotAutoApprove`,
`browserAllowLocalhost`) parse `true`/`1` as `true`; numeric keys
(`maxConcurrentAgents`, `mcpPort`) parse with `parseInt`; CSV keys
(`preferredAgentOrder`, `disabledClis`, `disabledMcpNamespaces`) split on
commas; everything else passes through as a string.

| Flag      | Required | Default | Notes                               |
| --------- | -------- | ------- | ----------------------------------- |
| `--key`   | yes      | —       | Settings key (see coercion table).  |
| `--value` | yes      | —       | Raw string; coerced for known keys. |

- **RPC**: `agent:setConfig` (`agent-cli.ts:199-231`).
- **Notification**: `agent_cli.config.updated { key, value }`.
- **Exit codes**: `0`; `2` (`UsageError`) when `--key` or `--value` is
  missing/empty; `5` on RPC failure.

### 11.4 `ptah agent-cli models list`

Enumerate available models per CLI agent. With `--cli`, scopes the
response to one allowlisted CLI; without, returns the full
`AgentListCliModelsResult` shape (`gemini`, `codex`, `copilot` arrays).

| Flag    | Required | Default | Notes                                         |
| ------- | -------- | ------- | --------------------------------------------- |
| `--cli` | no       | (all)   | One of `glm` \| `gemini`; rejection → exit 3. |

- **RPC**: `agent:listCliModels` (`agent-cli.ts:233-275`).
- **Notification**: `agent_cli.models { gemini, codex, copilot }` (no
  scope) or `agent_cli.models { cli, models }` (scoped to `gemini`); the
  scoped `glm` path returns an empty array today.
- **Exit codes**: `0`; `3` (`AuthRequired`) on `--cli` value outside the
  allowlist; `5` on RPC failure.

### 11.5 `ptah agent-cli stop <id> --cli <id>`

Terminate a running CLI-agent process by agent id.

| Positional | Required | Notes                 |
| ---------- | -------- | --------------------- |
| `<id>`     | yes      | The agent id to stop. |

| Flag    | Required | Default | Notes                                  |
| ------- | -------- | ------- | -------------------------------------- |
| `--cli` | yes      | —       | `glm` \| `gemini`; rejection → exit 3. |

- **RPC**: `agent:stop` (`agent-cli.ts:277-308`).
- **Notification**: `agent_cli.stopped { agentId, cli }`.
- **Exit codes**: `0`; `2` when `<id>` is missing; `3` on allowlist
  rejection; `5` on RPC failure.

### 11.6 `ptah agent-cli resume <id> --cli <id>`

Resume an existing CLI-agent session by `cliSessionId`. Optionally
seeds a new prompt with `--task`.

| Positional | Required | Notes                         |
| ---------- | -------- | ----------------------------- |
| `<id>`     | yes      | The `cliSessionId` to resume. |

| Flag     | Required | Default | Notes                                  |
| -------- | -------- | ------- | -------------------------------------- |
| `--cli`  | yes      | —       | `glm` \| `gemini`; rejection → exit 3. |
| `--task` | no       | `""`    | Free-form prompt for the resumed turn. |

- **RPC**: `agent:resumeCliSession` (`agent-cli.ts:310-346`).
- **Notification**: `agent_cli.resumed { cliSessionId, cli, agentId }`.
- **Exit codes**: `0`; `2` when `<id>` is missing; `3` on allowlist
  rejection; `5` on RPC failure.

---

## 12. `ptah license` lifecycle

`ptah license` inspects, sets, and clears the local Ptah license key.
Backed by the shared `LicenseRpcHandlers` registered under the
`license:` RPC namespace. The `license:` prefix is `LICENSE_EXEMPT`
(`libs/backend/vscode-core/src/messaging/rpc-handler.ts:132-138`), which
means all three subcommands work **without a valid license** so the
user can recover from the unlicensed state. Router wiring:
`apps/ptah-cli/src/cli/router.ts:1676-1712`.

### 12.1 State machine

```
       ┌──────────────────┐  ptah license set --key ptah_lic_…  ┌────────────┐
       │  no-license      ├────────────────────────────────────►│  community │
       │  (cachedStatus   │                                     │  (free)    │
       │   === null)      │  trial activate (auto, first run)   │            │
       └────────┬─────────┘────────────────────────────────────►└──────┬─────┘
                │                                                      │
                │  set --key ptah_lic_<paid>                            │
                │ ◄──────────────────────────────────────────────────── │
                ▼
            ┌─────────────────────┐
            │  pro                │
            │  (Pro tier)         │
            └────────┬────────────┘
                     │  clear  /  server says expired
                     ▼
            ┌─────────────────────┐
            │  expired            │
            │  (same gate as null)│
            └─────────────────────┘
```

- `no-license` / `expired` blocks Pro-only RPC prefixes (see
  `PRO_ONLY_METHOD_PREFIXES` at `rpc-handler.ts:106-112`).
- `community` permits everything except the prefixes in
  `PRO_ONLY_METHOD_PREFIXES` (`setup-wizard:`, `wizard:`,
  `enhancedPrompts:`, `ptahCli:`).
- `pro` (paid or in-trial) permits all gated namespaces.

### 12.2 Seven-day trial mechanics

On first activation, the license service can auto-mint a seven-day
trial that maps onto the same Pro-tier rules above. The trial is
single-use per machine fingerprint; the server enforces uniqueness.
Verify the active trial / expiry via:

```bash
ptah license status
```

The emitted `license.status` notification carries the absolute expiry
timestamp; the CLI does not poll it — the host should re-check before
issuing a Pro-only command.

### 12.3 Subcommands

#### `ptah license status`

Inspect the current license state.

| Flag     | Required | Notes      |
| -------- | -------- | ---------- |
| _(none)_ | —        | Read-only. |

- **RPC**: `license:getStatus`.
- **Notification**: `license.status { tier, valid, expiresAt?, …}`.
- **License-exempt**: yes (works in `no-license` and `expired` states).
- **Exit codes**: `0` on success; `5` on RPC failure.

#### `ptah license set --key <ptah_lic_…>`

Persist a new license key. The key format is
`ptah_lic_<64-hex>` — enforced by the server, not the CLI.

| Flag    | Required | Default | Notes                                              |
| ------- | -------- | ------- | -------------------------------------------------- |
| `--key` | yes      | —       | `ptah_lic_<64-hex>`; commander validates the flag. |

- **RPC**: `license:setKey`.
- **Notification**: `license.status` (refreshed).
- **License-exempt**: yes — this is the recovery path.
- **Exit codes**: `0`; `2` when `--key` is missing (commander
  enforces); `4` (`LicenseRequired`) when the server rejects the key;
  `5` on transport failure.

#### `ptah license clear`

Remove the locally-stored key (returns to `no-license`).

| Flag     | Required | Notes         |
| -------- | -------- | ------------- |
| _(none)_ | —        | Irreversible. |

- **RPC**: `license:clearKey`.
- **Notification**: `license.status` (refreshed; tier→null).
- **License-exempt**: yes.
- **Exit codes**: `0`; `5` on RPC failure.

---

## 13. `ptah harness` walkthrough

`ptah harness` scaffolds and applies project harness presets — the
configuration bundle that drives sub-agent fan-out, skill activation,
and document generation. Router wiring:
`apps/ptah-cli/src/cli/router.ts:353-532`. All subcommands dispatch
through shared `HarnessRpcHandlers`, so VS Code, Electron, and the CLI
behave identically.

### 13.1 Subcommand summary

| Subcommand            | Purpose                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- | ------- |
| `init`                | Create the `.ptah/` scaffolding (pure mkdir, no DI; idempotent — emits `changed:false`).                         |
| `status`              | Inspect `.ptah/` contents (pure fs.readdir, no DI). Emits `harness.status`.                                      |
| `scan`                | Run `harness:initialize`. Emits `workspace_context`, `available_agents`, `available_skills`, `existing_presets`. |
| `apply --preset <id>` | Apply a stored harness preset via `harness:apply`.                                                               |
| `preset save <name>`  | Persist a `HarnessConfig` (read from `--from <path>`) via `harness:save-preset`.                                 |
| `preset load`         | Emit `harness.preset.list` via `harness:load-presets`.                                                           |
| `chat`                | Alias for `ptah session start --scope harness-skill` (full streaming surface).                                   |
| `analyze-intent`      | Analyze a free-form intent via `harness:analyze-intent`; emits `harness.intent.analysis`.                        |
| `design-agents`       | Design sub-agents via `harness:design-agents`.                                                                   |
| `generate-document`   | Generate a project document via `harness:generate-document` (`--kind prd                                         | spec`). |

### 13.2 End-to-end walkthrough

The canonical onboarding flow — bootstrap a workspace, design agents,
apply a preset, then run a Team-Leader-flavored chat session:

```bash
# 1. Scaffold the .ptah/ tree (idempotent).
ptah harness init --dir .

# 2. Inspect what was created.
ptah harness status
# stdout: harness.status { dirs: [...], files: [...] }

# 3. Run a full workspace scan — emits four notifications:
#      workspace_context, available_agents, available_skills, existing_presets
ptah harness scan

# 4. (Optional) Generate a PRD from the current workspace.
ptah harness generate-document --kind prd
# stdout: harness.document.stream { chunk: "..." } × N
# stdout: harness.document.complete { path: ".ptah/specs/<id>/prd.md" }

# 5. Analyze a free-form intent (used for downstream design-agents).
ptah harness analyze-intent --intent "add a CSV importer with progress UI"
# stdout: harness.intent.analysis { task_type, complexity, suggested_agents, ... }

# 6. Design sub-agents from the analyzed intent + workspace context.
ptah harness design-agents --workspace
# stdout: harness.agent.designed { name, role, model_tier } × N

# 7. Persist the resulting HarnessConfig as a named preset.
ptah harness preset save my-importer --from ./harness-config.json \
  --description "CSV importer w/ progress"

# 8. Apply the preset to the workspace (writes .ptah/agents/*.md).
ptah harness apply --preset my-importer

# 9. Drive the actual Team-Leader-flavored session, auto-approving every
#    permission gate (mandatory for unattended runs — see §6).
ptah harness chat --task "implement the importer per the preset" \
  --auto-approve --profile harness-skill
```

### 13.3 Resulting JSON-RPC trail

`harness chat` is a streaming command — it tunnels through the same
`session start` machinery, so the spine in §5.2 applies. The
notifications unique to the harness lifecycle:

```
harness.initialized       (scan complete; workspace_context + agents + skills loaded)
harness.intent.analysis   (analyze-intent result)
harness.agent.designed    (per designed sub-agent)
harness.preset.saved      (preset save complete)
harness.preset.list       (preset load result)
harness.applied           (apply complete; written file list)
harness.document.stream   (generate-document streaming chunks)
harness.document.complete (generate-document final path + summary)
```

`harness chat` overlays these on top of the standard
`agent.thought → agent.tool_use → agent.tool_result → agent.message`
stream from §5.2 — every chat turn the Team Leader prompt invokes the
SDK's built-in `Task` tool to fan out to designed sub-agents, and each
sub-agent emits its own nested stream prefixed with the parent
turn id.

---

## 14. `ptah_*` MCP tool catalog (35 tools)

The in-process MCP server (`CodeExecutionMCP`) exposes a 35-tool
surface that internal sub-agents and the runtime self-introspection
layer hit over HTTP. Source of truth:
`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/protocol-handlers.ts:213-282`
(`handleToolsList`). Tools are grouped by **namespace toggle** —
disabling a namespace via the `ptah.agentOrchestration.disabledMcpNamespaces`
setting (string array) drops the entire group from `tools/list`. The
`ide` namespace additionally requires `hasIDECapabilities === true` (set
by the host adapter; Electron does not provide IDE capabilities).

> The `mcp-serve` subcommand (Phase 7 of TASK_2026_128) will surface a
> separate, narrower MCP wire for external hosts. This catalog
> describes the **internal** HTTP surface only.

### 14.1 Toggle table

| Namespace key | Toggle value                         | Tools | Extra requirement    |
| ------------- | ------------------------------------ | ----- | -------------------- |
| _(always-on)_ | — (cannot be disabled)               | 7     | —                    |
| `ide`         | `disabledMcpNamespaces: ['ide']`     | 3     | `hasIDECapabilities` |
| `agent`       | `disabledMcpNamespaces: ['agent']`   | 6     | —                    |
| `git`         | `disabledMcpNamespaces: ['git']`     | 3     | —                    |
| `json`        | `disabledMcpNamespaces: ['json']`    | 1     | —                    |
| `browser`     | `disabledMcpNamespaces: ['browser']` | 11    | —                    |
| `harness`     | `disabledMcpNamespaces: ['harness']` | 4     | —                    |

### 14.2 Always-on tools (7)

| Name                     | Namespace  | Returns                                       |
| ------------------------ | ---------- | --------------------------------------------- |
| `ptah_workspace_analyze` | _(always)_ | Workspace metadata + structure overview.      |
| `ptah_search_files`      | _(always)_ | Path list of matching files (glob + content). |
| `ptah_get_diagnostics`   | _(always)_ | Diagnostics via `IDiagnosticsProvider` port.  |
| `ptah_count_tokens`      | _(always)_ | Token-count estimate for given text/files.    |
| `ptah_web_search`        | _(always)_ | Web-search result set (provider-routed).      |
| `execute_code`           | _(always)_ | Bash / shell execution result.                |
| `approval_prompt`        | _(always)_ | Permission-prompt round trip.                 |

### 14.3 `ide` namespace (3)

| Name                   | Returns                                         |
| ---------------------- | ----------------------------------------------- |
| `ptah_lsp_references`  | LSP references at a position.                   |
| `ptah_lsp_definitions` | LSP definitions at a position.                  |
| `ptah_get_dirty_files` | List of files with unsaved edits in the editor. |

### 14.4 `agent` namespace (6)

| Name                | Returns                                         |
| ------------------- | ----------------------------------------------- |
| `ptah_agent_spawn`  | `SpawnAgentResult { agentId, cli, status, … }`. |
| `ptah_agent_status` | `AgentProcessInfo` (or array of all agents).    |
| `ptah_agent_read`   | Buffered stdout/stderr + exit code if finished. |
| `ptah_agent_steer`  | Push a steering message to a running agent.     |
| `ptah_agent_stop`   | Final `AgentProcessInfo` after termination.     |
| `ptah_agent_list`   | Detected CLIs + configured Ptah CLI agents.     |

### 14.5 `git` namespace (3)

| Name                       | Returns                          |
| -------------------------- | -------------------------------- |
| `ptah_git_worktree_list`   | List of git worktrees.           |
| `ptah_git_worktree_add`    | Result of `git worktree add`.    |
| `ptah_git_worktree_remove` | Result of `git worktree remove`. |

### 14.6 `json` namespace (1)

| Name                 | Returns                                 |
| -------------------- | --------------------------------------- |
| `ptah_json_validate` | Schema validation result + diagnostics. |

### 14.7 `browser` namespace (11)

| Name                        | Returns                                    |
| --------------------------- | ------------------------------------------ |
| `ptah_browser_navigate`     | Navigation result (URL, status code).      |
| `ptah_browser_screenshot`   | Base64-encoded PNG.                        |
| `ptah_browser_evaluate`     | Result of in-page JS evaluation.           |
| `ptah_browser_click`        | Click confirmation + DOM diff.             |
| `ptah_browser_type`         | Type confirmation.                         |
| `ptah_browser_content`      | Current page HTML / text content.          |
| `ptah_browser_network`      | Captured network log entries.              |
| `ptah_browser_close`        | Browser session-close confirmation.        |
| `ptah_browser_status`       | Active session status (URL, viewport, …).  |
| `ptah_browser_record_start` | Start screen-recording the active session. |
| `ptah_browser_record_stop`  | Stop recording; returns artifact path.     |

### 14.8 `harness` namespace (4)

| Name                               | Returns                                          |
| ---------------------------------- | ------------------------------------------------ |
| `ptah_harness_search_skills`       | Matching skills from the harness skill registry. |
| `ptah_harness_create_skill`        | Newly created skill descriptor.                  |
| `ptah_harness_search_mcp_registry` | Matching MCP servers from the registry.          |
| `ptah_harness_list_installed_mcp`  | List of installed MCP servers in the workspace.  |

**Total**: 7 + 3 + 6 + 3 + 1 + 11 + 4 = **35 tools**.

---

## 15. `session.ready.capabilities` enumeration

At the top of every `ptah interact` session the CLI emits a
`session.ready` notification advertising the negotiated capability
set. Source: `apps/ptah-cli/src/cli/commands/interact.ts:400-405`.

### 15.1 Current capability set

```jsonc
{
  "method": "session.ready",
  "params": {
    "session_id": "<tabId>",
    "version": "<package.json version>",
    "capabilities": ["chat", "session", "permission", "question"],
    "protocol_version": "2.0",
  },
}
```

| Capability   | Means                                                                              |
| ------------ | ---------------------------------------------------------------------------------- |
| `chat`       | Inbound `task.submit` / `task.cancel` accepted; the full agent.\* stream is wired. |
| `session`    | Inbound `session.shutdown` / `session.history` accepted.                           |
| `permission` | Outbound `permission.request` may fire; client MUST respond.                       |
| `question`   | Outbound `question.ask` may fire; client MUST respond.                             |

### 15.2 Capability lifecycle

1. The CLI binds `JsonRpcServer` to stdin/stdout, attaches its
   handlers, then emits `session.ready` — this is always the first
   line on stdout.
2. Immediately after, the CLI emits `system.schema.version` with the
   active `JSONRPC_SCHEMA_VERSION` (`apps/ptah-cli/src/cli/jsonrpc/types.ts:30`,
   currently `'0.1'`) plus the CLI version.
3. The peer is free to call any inbound method gated by the
   advertised capabilities. Capabilities are static for the life of
   the `interact` process — they do not change mid-session.
4. On `session.shutdown`, the server drains and exits 0; no
   capability is re-advertised on a new spawn.

### 15.3 Schema-version negotiation

- The CLI's emitted version is **`JSONRPC_SCHEMA_VERSION = '0.1'`**
  (`apps/ptah-cli/src/cli/jsonrpc/types.ts:30`).
- Hosts that spawn the CLI MAY set `PTAH_HOST_SCHEMA_VERSION` in the
  child environment. On boot, `apps/ptah-cli/src/main.ts` calls
  `checkSchemaVersionSkew()` to compare the two; a mismatch is logged
  to stderr but does **not** abort the process. Hosts can silence the
  warning with the global `--quiet` flag.
- Backward-compatible payload additions (extra keys on a known
  notification) do not bump the schema version; only breaking changes
  do.

### 15.4 Forward-compatibility note

A future schema iteration (TASK_2026_128 Phase 5) will add a
`schema_version` field to the `session.ready` payload itself, so peers
can read the negotiated version from the first notification without
listening for `system.schema.version` separately. Existing clients
will continue to function — extra fields on JSON-RPC payloads are
ignored by spec-conformant parsers. This document will be updated when
that change lands; do not depend on the field today.

---

## 16. MCP-serve — Drive Ptah from external agents

### 16.1 What it is

`ptah mcp-serve` is a second JSON-RPC stdio surface alongside `ptah
interact`. It speaks the Model Context Protocol (`initialize`,
`tools/list`, `tools/call`, `notifications/cancelled`) instead of
Ptah-flavored `task.*` / `session.*` methods, so any MCP-compliant
host can drive Ptah's agent surface without bespoke integration. This
inverts Ptah's position: instead of Ptah calling out to other tools,
external orchestrators delegate work into Ptah's multi-CLI dispatch
and Team Leader harness.

The wire framing is the same NDJSON JSON-RPC 2.0 as `interact`. The
command file is `apps/ptah-cli/src/cli/commands/mcp-serve.ts`; the
transport lib is `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/`.

### 16.2 `.mcp.json` example

External MCP hosts add a server block like this:

```json
{
  "mcpServers": {
    "ptah": {
      "command": "npx",
      "args": ["-y", "@hive-academy/ptah-cli", "mcp-serve", "--auto-approve"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

`--auto-approve` is recommended because the host has no UI surface to
render Ptah's permission prompts. Without it, any `tools/call` that
triggers an approval-gated operation will hang for 5 minutes and then
exit `auth_required` (`3`). `--auto-approve` is a global flag (see
section 16.7); equivalent to `PTAH_AUTO_APPROVE=true` in the child env.

### 16.3 7 MVP tools (advertised on `tools/list`)

Source of truth:
`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/tool-builders.ts:32-40`.
The MCP-wire names drop the `ptah_` prefix the internal HTTP server
uses, because MCP hosts namespace tools by server name on the wire
(`ptah:agent_spawn`), so the prefix would be redundant.

| Tool             | Required input keys      | Optional input keys                                         | Returns                                                       | Pro?                |
| ---------------- | ------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------- | ------------------- |
| `agent_spawn`    | `task` (string)          | `cli`, `ptahCliId`, `workingDirectory`, `model`, plus a few | `SpawnAgentResult { agentId, cli, status, … }`                | Pro iff `ptahCliId` |
| `agent_status`   | —                        | `agentId`                                                   | `AgentProcessInfo` (single) or full list                      | Pro iff Ptah CLI    |
| `agent_read`     | `agentId`                | `tail` (number)                                             | Buffered stdout/stderr + exit code if finished                | Pro iff Ptah CLI    |
| `agent_steer`    | `agentId`, `instruction` | —                                                           | `{ steered: true }` once the steering message is forwarded    | Pro iff Ptah CLI    |
| `agent_stop`     | `agentId`                | —                                                           | Final `AgentProcessInfo` after termination                    | Pro iff Ptah CLI    |
| `agent_list`     | —                        | —                                                           | Detected CLIs + configured Ptah CLI agents                    | Free                |
| `session_submit` | `task` (string)          | `cwd`, `allowSubagents` (default `true`), `profile`         | Aggregated text + `structuredContent { tabId, sessionId, … }` | Pro                 |

Notes:

- `session_submit` is unique to the stdio surface — it builds a Team
  Leader prompt from the supplied `task`, runs it through the agent
  SDK session, and aggregates the result. Mid-flight progress streams
  as `notifications/message` / `notifications/progress` frames keyed
  off `_meta.progressToken` when supplied. Source:
  `apps/ptah-cli/src/services/mcp/session-submit.service.ts`.
- The tools are advertised in the order listed above; external hosts
  that fingerprint the catalog see stable output across boots
  (`buildMcpMvpTools()`, `tool-builders.ts:130`).
- `--allow-tools <csv>` narrows the advertised set. Tools omitted from
  the allowlist are NOT visible to `tools/list` and return
  `mcp_tool_not_found` on `tools/call`.

### 16.4 Premium gate behavior

Source of truth: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-stdio/mcp-license-gate.ts`.
Six tool names are candidates for the premium gate (`PRO_ONLY_MCP_TOOLS`
at `mcp-license-gate.ts:219-226`):

```
session_submit
agent_spawn      (only when args.ptahCliId is set)
agent_status     (only when args.agentId targets a Ptah CLI agent)
agent_read       (    "                                          )
agent_stop       (    "                                          )
agent_steer      (    "                                          )
```

`agent_list` is always free. `agent_spawn` with `cli=gemini` (or any
rival CLI that runs on the user's own binary) is always free. The
gate fails CLOSED: license lookup throws, cache miss, or expired
status all return `license_required`.

On denial the dispatcher returns an MCP `result.isError: true`
envelope inline (NOT a JSON-RPC error object — MCP tool-level errors
travel inside `result` per spec). Shape
(`stdio-mcp-server.service.ts:298-313`):

```json
{
  "jsonrpc": "2.0",
  "id": "<request id>",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "License required: session_submit requires a verified Ptah license. Run `ptah license set --key ptah_lic_…` to upgrade. Pricing details: https://ptah.live/pricing"
      }
    ],
    "isError": true,
    "structuredContent": {
      "ptah_code": "license_required",
      "mcpCode": "mcp_tool_denied",
      "tool": "session_submit",
      "requiredTier": "pro",
      "reason": "license_required",
      "helpUrl": "https://ptah.live/pricing"
    }
  }
}
```

`ptah_code` stays `'license_required'` for backward compatibility with
host code that already handles the desktop wire policy; `mcpCode`
adds the MCP-specific `'mcp_tool_denied'` for hosts that opt into the
new taxonomy. Both fields are present on every gate-denied call;
neither will be removed under the `0.1` schema version.

### 16.5 Cost attribution

Every `ptah mcp-serve` boot mints a `mcp_host_session_id = ulid()`
(`mcp-serve.ts:161`) and exports it via the `PTAH_MCP_HOST_SESSION_ID`
environment variable. Downstream services read the variable to tag
their notifications:

- Per-turn cost ticks emit `notifications/message` with
  `{ kind: 'session.cost', mcpHostSessionId, sessionId, turnId,
deltaUsd, totalUsd, inputTokens, outputTokens }`
  (`session-submit.service.ts:388-403`).
- At tool-call settlement the dispatcher emits ONE final
  `notifications/message` with
  `{ kind: 'mcp.session.summary', mcpHostSessionId, sessionId, tabId,
totalUsd, totalTokens, inputTokens, outputTokens, toolCallCount }`
  BEFORE the `tools/call` result lands on the wire
  (`session-submit.service.ts:453-467`).

External hosts that aggregate spend across long-running Ptah usage
should key on `mcpHostSessionId` (stable for the life of the
`mcp-serve` process) and accumulate `totalUsd` from the summary
frames. Mid-flight `session.cost` frames are for live UIs and may
duplicate the final summary.

### 16.6 Cancellation + drain

**Mid-flight cancellation**: send a `notifications/cancelled
{ requestId: <id-of-the-tools/call> }` notification. The dispatcher
matches the requestId against its in-flight map
(`session-submit.service.ts:235-255`), invokes `chat:abort` on the
in-process transport, and resolves the original `tools/call` with
`isError: true, structuredContent.ptah_code: 'mcp_tool_cancelled'`
within ~1 second.

**Process drain**: `mcp-serve` exits on three triggers
(`mcp-serve.ts:213-223`):

- `stdin` EOF → exit `0` (normal MCP host disconnect)
- `SIGINT` → exit `130`
- `SIGTERM` → exit `143`

All three race against a 5-second drain cap
(`mcp-serve.ts:158, 367-382`): outstanding `tools/call` AbortControllers
fire, the stdio transport stops, the formatter closes, and stdout
fully flushes. Hosts that re-launch `ptah mcp-serve` on every
`.mcp.json` reload do NOT need to send an explicit shutdown — closing
stdin is sufficient.

### 16.7 `session.describe` introspection

Both `interact` and `mcp-serve` register `session.describe` and
`session.methods` (Phase 5). Use the former to discover the live tool
catalog without parsing `tools/list`:

```jsonc
// → request
{ "jsonrpc": "2.0", "id": 1, "method": "session.describe" }

// ← response (mcp-serve mode)
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "serverName": "ptah",
    "version": "0.1.5",
    "schemaVersion": "0.1",
    "mode": "mcp-serve",
    "catalog": {
      "methods": [
        "initialize", "tools/list", "tools/call",
        "notifications/cancelled", "session.describe", "session.methods"
      ],
      "tools": [
        { "name": "agent_spawn",    "description": "…" },
        { "name": "agent_status",   "description": "…" },
        { "name": "agent_read",     "description": "…" },
        { "name": "agent_steer",    "description": "…" },
        { "name": "agent_stop",     "description": "…" },
        { "name": "agent_list",     "description": "…" },
        { "name": "session_submit", "description": "…" }
      ]
    },
    "errorCodes": ["db_lock", "provider_unavailable", "auth_required", "…",
                   "mcp_handshake_failed", "mcp_tool_not_found",
                   "mcp_invalid_tool_args", "mcp_tool_denied"],
    "capabilities": ["mcp"]
  }
}
```

`session.methods` is the lightweight variant — returns just
`{ methods: string[] }`. Both are documented in
`apps/ptah-cli/docs/jsonrpc-schema.md:374-422`.

### 16.8 Troubleshooting

| Symptom                                                       | Likely cause                                                                                     | Fix                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `tools/call` returns `license_required` / `mcp_tool_denied`   | Tool is Pro-gated and the cached license is missing, invalid, or community-tier.                 | `ptah license set --key ptah_lic_…`; recheck with `ptah license status`.           |
| Host hangs on `tools/call` for ~5 minutes, then exit code `3` | Missing `--auto-approve`; an approval-gated operation is blocked because hosts have no UI.       | Add `--auto-approve` to the `args` list (or `PTAH_AUTO_APPROVE=true` to the env).  |
| `tools/list` returns fewer than 7 tools                       | `--allow-tools <csv>` narrowed the advertised set.                                               | Drop the flag or expand the CSV to include the missing names.                      |
| `tools/call` returns `mcp_tool_not_found`                     | Tool name typo, or the name was excluded by `--allow-tools`.                                     | Check `tools/list` output OR `session.describe` to see the live catalog.           |
| `tools/call` returns `mcp_invalid_tool_args`                  | Zod validation failed; `structuredContent.issues` carries the field-level diagnostics.           | Inspect `issues.fieldErrors` and fix the offending key.                            |
| `tools/call` returns `sdk_init_failed`                        | `tools/call` arrived while `withEngine` was still bootstrapping. Rare; happens during cold boot. | Retry after `notifications/initialized` lands. The handshake completes in < 3s.    |
| First `tools/call` is slow (~1-3s)                            | Lazy `PtahAPIBuilder` walk on first dispatch; subsequent calls reuse the cached dispatcher.      | Expected. Send a no-op `tools/list` after `initialized` if predictability matters. |
| `mcp.session.summary` never arrives                           | The `tools/call` errored before listeners attached, OR the host disconnected mid-flight.         | Check stderr for `[ptah-mcp] drain error: …` lines.                                |
