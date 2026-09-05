# Ptah CLI — the JSON-RPC 2.0 stdio wire protocol

Covers the NDJSON envelope shapes `ptah interact` speaks, schema version
`0.2` and its negotiation, `session.ready` capabilities, exit codes,
error codes, and the integration patterns (spawn-and-stream, daemon
bridge, HTTP proxy) built on top of them.

Human-facing schema doc: `apps/ptah-cli/docs/jsonrpc-schema.md`.
Canonical types: `apps/ptah-cli/src/cli/jsonrpc/types.ts`.

---

## 1. Wire format

NDJSON, one JSON object per line, `\n`-terminated. JSON-RPC 2.0
envelopes on stdout; logger output, OAuth URLs and deprecation notices on
stderr. Never parse stderr as protocol.

### 1.1 Inbound requests (client → CLI, in `interact` mode)

| Method                | Params                                                      | Result                                                   |
| --------------------- | ----------------------------------------------------------- | -------------------------------------------------------- |
| `task.submit`         | `{ task, cwd?, profile? }`                                  | `{ turn_id, complete, cancelled?, error?, session_id? }` |
| `task.cancel`         | `{ turn_id }`                                               | `{ cancelled, turn_id?, reason? }`                       |
| `session.shutdown`    | `{}`                                                        | `{ shutdown: true }` then drain + exit 0                 |
| `session.history`     | `{ limit? }`                                                | `{ messages, session_id }`                               |
| `permission.response` | `{ id, decision: 'allow'\|'deny'\|'always_allow', scope? }` | (fire-and-forget, no response)                           |
| `question.response`   | `{ id, answer, custom? }`                                   | (fire-and-forget, no response)                           |
| `proxy.shutdown`      | `{}`                                                        | `{ stopped, port?, reason? }` (only when proxy embedded) |

Only one `task.submit` may be in flight; a concurrent submit returns
`-32603 'turn already in flight'`.

### 1.2 Outbound notifications (CLI → client)

~80 methods across clusters: `session.*`, `agent.*`, `agent_cli.*`,
`wizard.*`, `analyze.*`, `harness.*`, `plugin.*`, `mcp.*`, `skill.*`,
`auth.*` / `provider.*`, `config.*`, `workspace.*`, `git.*`, `license.*`,
`websearch.*`, `settings.*`, `task.*`, `debug.*`, `proxy.*`. Full
taxonomy: `apps/ptah-cli/docs/jsonrpc-schema.md` § 1.

The streaming spine for any agent turn:

```
agent.thought → agent.tool_use → (permission.request ↔ permission.response)
              → agent.tool_result → agent.message → session.cost
              → session.token_usage → task.complete
```

### 1.3 Outbound requests (CLI → client, response REQUIRED)

| Method               | Trigger                                      | Expected reply         |
| -------------------- | -------------------------------------------- | ---------------------- |
| `permission.request` | Tool gated and `--auto-approve` not set      | `{ decision, scope? }` |
| `question.ask`       | Agent needs a user choice                    | `{ answer, custom? }`  |
| `oauth.url.open`     | OAuth needs a browser (headless device-code) | `{ opened, code? }`    |

---

## 2. End-to-end NDJSON dialogue

Stdin (client → CLI):

```
{"jsonrpc":"2.0","id":"sub-1","method":"task.submit","params":{"task":"add a unit test for utils.ts"}}
{"jsonrpc":"2.0","id":"req-7","result":{"decision":"allow","scope":"session"}}
{"jsonrpc":"2.0","id":"shut","method":"session.shutdown","params":{}}
```

Stdout (CLI → client), one line per JSON object:

```
{"jsonrpc":"2.0","method":"session.ready","params":{"session_id":"tab-abc","version":"0.1.0","schema_version":"0.2","capabilities":["chat","session","permission","question"],"protocol_version":"2.0"}}
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
  matching JSON-RPC response (the schema also accepts a fire-and-forget
  `permission.response` notification keyed by the same id — see
  `apps/ptah-cli/src/cli/session/approval-bridge.ts`).
- `task.complete` is the terminal notification for the turn; the
  `task.submit` response immediately follows.
- Always `\n`-terminate every line written to stdin.

---

## 3. `session.ready` capabilities

At the top of every `ptah interact` session the CLI emits a
`session.ready` notification advertising the negotiated capability set.
Source: `apps/ptah-cli/src/cli/commands/interact.ts`.

```jsonc
{
  "method": "session.ready",
  "params": {
    "session_id": "<tabId>",
    "version": "<package.json version>",
    "schema_version": "0.2",
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

Lifecycle:

1. The CLI binds `JsonRpcServer` to stdin/stdout, attaches its handlers,
   then emits `session.ready` — this is always the first line on stdout.
2. Immediately after, the CLI emits `system.schema.version` with the
   active `JSONRPC_SCHEMA_VERSION` plus the CLI version.
3. The peer is free to call any inbound method gated by the advertised
   capabilities. Capabilities are static for the life of the `interact`
   process — they do not change mid-session.
4. On `session.shutdown`, the server drains and exits 0; no capability is
   re-advertised on a new spawn.

---

## 4. Schema-version negotiation

- The CLI's emitted version is **`JSONRPC_SCHEMA_VERSION = '0.2'`**
  (`apps/ptah-cli/src/cli/jsonrpc/types.ts`).
- It appears in three places: the `system.schema.version` notification,
  the `schema_version` field on `session.ready`, and `schemaVersion` in
  the `session.describe` result.
- Hosts that spawn the CLI MAY set `PTAH_HOST_SCHEMA_VERSION` in the
  child environment. On boot, `apps/ptah-cli/src/main.ts` calls
  `checkSchemaVersionSkew()` to compare the two; a mismatch is logged to
  stderr but does **not** abort the process. Hosts can silence the
  warning with the global `--quiet` flag.
- Backward-compatible payload additions (extra keys on a known
  notification) do not bump the schema version; only breaking changes do.

---

## 5. `session.describe` / `session.methods`

Both `interact` and `mcp-serve` register `session.describe` and
`session.methods`. Use the former to discover the live method and tool
catalog without parsing `tools/list`:

```jsonc
// → request
{ "jsonrpc": "2.0", "id": 1, "method": "session.describe" }
```

The result carries `serverName`, `version`, `schemaVersion`, `mode`,
`catalog { methods, tools }`, `errorCodes` and `capabilities`.
`session.methods` is the lightweight variant — it returns just
`{ methods: string[] }`. Both are documented in
`apps/ptah-cli/docs/jsonrpc-schema.md`.

---

## 6. Exit codes

From `apps/ptah-cli/src/cli/jsonrpc/types.ts` `ExitCode`:

| Code  | Name              | Cause                                                                                              |
| ----- | ----------------- | -------------------------------------------------------------------------------------------------- |
| `0`   | `Success`         | Command completed.                                                                                 |
| `1`   | `GeneralError`    | Recoverable — unknown resource, task error, network blip, wizard phase failed, MCP install failed. |
| `2`   | `UsageError`      | Missing required flag, malformed value, conflicting flags.                                         |
| `3`   | `AuthRequired`    | Missing/invalid provider credentials OR required CLI agent missing.                                |
| `4`   | `LicenseRequired` | The license server rejected the key.                                                               |
| `5`   | `InternalFailure` | Unhandled exception, DI bootstrap crash, unrecoverable IO.                                         |
| `130` | SIGINT            | Graceful shutdown after Ctrl-C.                                                                    |
| `143` | SIGTERM           | Graceful shutdown after kill signal.                                                               |

## 7. `ptah_code` error codes

Carried in `error.data.ptah_code` and in `task.error.params.ptah_code`.
The full enumeration (`PTAH_ERROR_CODES`, also advertised by
`session.describe`):

```
db_lock  provider_unavailable  auth_required  rate_limited  license_required
unknown  internal_failure  cli_agent_unavailable  sdk_init_failed
workspace_missing  proxy_bind_failed  proxy_invalid_request
permission_gate_unavailable  claude_cli_not_found  mcp_handshake_failed
mcp_tool_not_found  mcp_invalid_tool_args  mcp_tool_denied
session_submit_timeout
```

Map each to a recovery strategy via `docs/jsonrpc-schema.md` § 4.2.

---

## 8. Integration patterns

### 8.1 Spawn-and-stream from another process (Node.js)

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
ENOENT on Windows.

### 8.2 Daemon bridging (HTTP → JSON-RPC stdio)

The `openclaw-control` pattern: a long-running HTTP server (the
"ptah-bridge") spawns one `ptah interact` process per session,
multiplexes JSON-RPC envelopes between HTTP clients and the child's
stdio, and tears the child down on `session.shutdown`. Key invariants:

- One `ptah interact` per session (turns are serialized per-process).
- Always wait for the `task.submit` response (or `task.error`) before
  issuing the next `task.submit` on the same session.
- Drain stdout for ≤ 5s after sending `session.shutdown` — see
  `InteractExecuteHooks.drainTimeoutMs` in
  `apps/ptah-cli/src/cli/commands/interact.ts`.
- Forward `permission.request` / `question.ask` to the HTTP client and
  return the response on stdin.

### 8.3 Scripted multi-task batch (one session per task)

```bash
for task in "lint" "test" "build"; do
  ptah --quiet --json --auto-approve session start \
    --task "run npm $task and report" --once > "logs/$task.ndjson" || exit $?
done
```

Global flags (`--quiet`, `--json`, `--auto-approve`) go before
`session`; subcommand options (`--task`, `--once`) go after `start`.

For a single persistent session running N tasks sequentially, use
`interact` and serialize `task.submit` envelopes (next one only after the
previous response lands).

### 8.4 Anthropic-compatible HTTP proxy

```bash
# Standalone (requires --auto-approve; emits proxy.* on stderr):
ptah --auto-approve proxy start --port 51234

# Embedded inside interact (proxy.* notifications stream on stdout JSON-RPC):
ptah interact   # then: emit proxy.start as an outbound request (see schema § 1.12)
```

`ptah proxy` also offers `stop --port <n>` and `status` (which lists
running proxies registered in `~/.ptah/proxies/`).

The proxy exposes the Anthropic Messages API on `127.0.0.1:<port>`
(bind address overridable with `--host`), mints a bearer token in
`~/.ptah/proxy/<port>.token`, and forwards through Ptah's active model
resolution (the caller's `model` field is ignored). Use this to put any
Anthropic-SDK-aware client in front of Ptah's harness.
