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

| Need                                                 | Use            |
| ---------------------------------------------------- | -------------- |
| Interactive coding inside an editor                  | VS Code ext    |
| Standalone desktop app with chat UI                  | Electron       |
| Headless agent driving Ptah from another process     | **CLI**        |
| CI / GitHub Actions / scheduled jobs                 | **CLI**        |
| A2A bridge (OpenClaw / NemoClaw / external orchestrator) | **CLI**    |
| Scripted refactor or bulk task execution             | **CLI**        |
| Anthropic-compatible HTTP proxy in front of Ptah     | **CLI** (`ptah proxy start`) |
| TTY UI, keyboard navigation, mouse                   | NOT the CLI    |

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

| Slot     | Intended use                                            |
| -------- | ------------------------------------------------------- |
| `sonnet` | Default workhorse — most agent turns map here           |
| `opus`   | Heavy reasoning — Team Leader, deep analysis            |
| `haiku`  | Cheap classification, intent parsing, retrievals        |

Each provider in `provider-registry.ts` ships a default tier mapping;
`provider tier set` overrides it.

---

## 5. JSON-RPC interact-mode protocol cookbook

Wire format: NDJSON, one JSON object per line, `\n`-terminated.

### 5.1 Inbound requests (client → CLI, in `interact` mode)

| Method                | Params                                                              | Result                                                           |
| --------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `task.submit`         | `{ task, cwd?, profile? }`                                          | `{ turn_id, complete, cancelled?, error?, session_id? }`         |
| `task.cancel`         | `{ turn_id }`                                                       | `{ cancelled, turn_id?, reason? }`                               |
| `session.shutdown`    | `{}`                                                                | `{ shutdown: true }` then drain + exit 0                         |
| `session.history`     | `{ limit? }`                                                        | `{ messages, session_id }`                                       |
| `permission.response` | `{ id, decision: 'allow'\|'deny'\|'always_allow', scope? }`         | (fire-and-forget, no response)                                   |
| `question.response`   | `{ id, answer, custom? }`                                           | (fire-and-forget, no response)                                   |
| `proxy.shutdown`      | `{}`                                                                | `{ stopped, port?, reason? }` (only when proxy embedded)         |

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

| Method               | Trigger                                       | Expected reply                                                   |
| -------------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| `permission.request` | Tool gated and `--auto-approve` not set       | `{ decision, scope? }`                                           |
| `question.ask`       | Agent needs a user choice                     | `{ answer, custom? }`                                            |
| `oauth.url.open`     | OAuth needs a browser (headless device-code)  | `{ opened, code? }`                                              |

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

| Env var               | When to set                                           | Effect                                                                                                                |
| --------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `PTAH_AUTO_APPROVE`   | CI, daemons, `proxy start` w/o JSON-RPC peer          | Auto-allow every `permission.request` (same as `--auto-approve`).                                                     |
| `PTAH_NO_TTY`         | Containers, CI, anything where `isTTY` may lie        | Force non-TTY mode; suppresses ANSI even with `--human`.                                                              |
| `NO_COLOR`            | Pipelines, log aggregators                            | Any non-empty value disables ANSI in `--human` mode.                                                                  |
| `FORCE_COLOR=0`       | Bridge spawning the CLI from another process          | Disables color in deps that read it (matches Windows spawn pattern). Combine with `setEncoding('utf8')` on streams.   |
| `PTAH_LOG_LEVEL`      | Debugging                                             | `debug` \| `info` \| `warn` \| `error`. `debug` writes to **stderr only**; never poisons stdout.                      |
| `PTAH_CONFIG_PATH`    | Sandboxed runs / multi-tenant CI                      | Override `~/.ptah/settings.json` location.                                                                            |
| `PTAH_DI_LAZY`        | Fast read-only commands                               | Default `true`. Skips DI bootstrap when only metadata is needed.                                                      |
| `ANTHROPIC_API_KEY`   | Anthropic direct without `set-key`                    | Picked up by `api-key.strategy.ts`.                                                                                   |
| `ANTHROPIC_AUTH_TOKEN`| Z.AI / Moonshot / any Anthropic-compatible vendor     | Used together with `ANTHROPIC_BASE_URL` to point the SDK at a non-Anthropic endpoint.                                 |
| `ANTHROPIC_BASE_URL`  | Custom Anthropic-compatible endpoint                  | Overrides the SDK's default base URL.                                                                                 |

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
  shell: process.platform === 'win32',  // .cmd shim on Windows
});

child.stdout.setEncoding('utf8');
let buf = '';
child.stdout.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
    if (line.trim()) handleEnvelope(JSON.parse(line));
  }
});

child.stdin.write(JSON.stringify({
  jsonrpc: '2.0', id: '1', method: 'task.submit',
  params: { task: 'refactor utils.ts' }
}) + '\n');
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
