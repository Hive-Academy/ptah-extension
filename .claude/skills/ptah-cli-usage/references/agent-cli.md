# Ptah CLI — `ptah agent-cli` and rival-CLI orchestration

Covers the `ptah agent-cli` subcommands (detect, config, models, stop,
resume), the `--cli` selector vocabulary, and where the spawn / read /
steer verbs actually live.

---

## 1. What `agent-cli` is

`ptah agent-cli` manages the CLI agents the SDK can spawn into agent
sessions. See `CLI_AGENT_SELECTORS` and `resolveCliAgentSelector` in
`apps/ptah-cli/src/cli/commands/agent-cli.ts`.

**CLI agents are DISCOVERED at runtime, never hardcoded.** Ask the
machine what it has — `ptah agent-cli detect` from the shell, or the
`ptah_agent_list` MCP tool from inside an agent. Do not assume a fixed
roster.

**`--cli` accepts every CLI agent target Ptah has an adapter for:**

| Selector                                                      | Wire `cli` | Notes                                            |
| ------------------------------------------------------------- | ---------- | ------------------------------------------------ |
| `codex`, `copilot`, `cursor`, `antigravity`, `opencode`, `pi` | itself     | System CLIs — binaries Ptah spawns.              |
| `ptah-cli`                                                    | `ptah-cli` | A configured provider, addressed by `ptahCliId`. |
| `glm`                                                         | `ptah-cli` | **Deprecated alias.** Warns on stderr.           |

The set is derived from `SYSTEM_CLI_TYPES`, so read it from there rather
than from any list written down here — adapters are added between
releases. A value naming no target emits `task.error` with
`ptah_code: 'cli_agent_unavailable'` and exits `3` (`AuthRequired`).
`PTAH_AGENT_CLI_OVERRIDE` is **never** consulted, and there is nothing
left for it to override.

> **Nothing is blocked.** Earlier versions of this skill said only `glm`
> was accepted and that `copilot` and `cursor` were unavailable for
> Windows-spawn reasons. Both claims were false: `CliDetectionService`
> registers all six system CLIs, Copilot with a dedicated permission
> bridge. `glm`, the one value that WAS accepted, is the one that could
> never route.

> **`ptah-cli` is a provider, not a binary — read this before using
> `resume`.** `--cli ptah-cli` selects an Anthropic-compatible provider
> (for example Z.AI GLM) addressed by `ptahCliId`. There is no `ptah-cli`
> executable, and `agent-cli detect` reports these as entries with
> `cli: "ptah-cli"` rather than as system CLIs. Two consequences for you
> as a caller:
>
> 1. **The user must have a Ptah CLI provider configured.** If none is,
>    `resume` fails with `No Ptah CLI agents configured. Add one in Agent
Orchestration settings.` That is the real, actionable error — do not
>    retry, and do not tell the user to install a binary. Run
>    `ptah agent-cli detect` and read the entries with `cli: "ptah-cli"`
>    to see what they have.
> 2. **Do not pass `--ptah-cli-id` unless you have a real id** from that
>    detect output. Omitting it makes the backend pick the first enabled
>    provider that has an API key, which is the right default. Passing it
>    with a system CLI exits `2`.

---

## 2. Where spawn / status / read / steer live

`ptah agent-cli` covers detection, config, model listing, `stop` and
`resume`. The full agent lifecycle — spawn, status, read, steer, stop —
is exposed as MCP tools (`ptah_agent_spawn`, `ptah_agent_status`,
`ptah_agent_read`, `ptah_agent_steer`, `ptah_agent_stop`,
`ptah_agent_list`) on both the internal tool surface
(`references/internal-mcp.md`) and the `mcp-serve` wire
(`references/mcp-serve.md`, where the names drop the `ptah_` prefix).

---

## 3. `ptah agent-cli detect`

Detect installed CLI agents in the user's environment.

| Flag     | Required | Default | Notes                       |
| -------- | -------- | ------- | --------------------------- |
| _(none)_ | —        | —       | Pure read; no `--cli` flag. |

- **RPC**: `agent:detectClis`.
- **Notification**: `agent_cli.detection { clis: CliDetectionResult[] }`.
- **Exit codes**: `0` on success; `5` (`InternalFailure`) on RPC error;
  never emits `cli_agent_unavailable` (no `--cli` flag).

---

## 4. `ptah agent-cli config get`

Read the current agent orchestration config.

| Flag     | Required | Default | Notes                                        |
| -------- | -------- | ------- | -------------------------------------------- |
| _(none)_ | —        | —       | Returns the full `AgentOrchestrationConfig`. |

- **RPC**: `agent:getConfig`.
- **Notification**: `agent_cli.config { config: AgentOrchestrationConfig }`.
- **Exit codes**: `0`, `5`.

---

## 5. `ptah agent-cli config set`

Write a single config entry. Coercion rules (`agent-cli.ts`): boolean
keys (`codexAutoApprove`, `copilotAutoApprove`, `browserAllowLocalhost`)
parse `true`/`1` as `true`; numeric keys (`maxConcurrentAgents`,
`mcpPort`) parse with `parseInt`; CSV keys (`preferredAgentOrder`,
`disabledClis`, `disabledMcpNamespaces`) split on commas; everything else
passes through as a string.

| Flag      | Required | Default | Notes                               |
| --------- | -------- | ------- | ----------------------------------- |
| `--key`   | yes      | —       | Settings key (see coercion table).  |
| `--value` | yes      | —       | Raw string; coerced for known keys. |

- **RPC**: `agent:setConfig`.
- **Notification**: `agent_cli.config.updated { key, value }`.
- **Exit codes**: `0`; `2` (`UsageError`) when `--key` or `--value` is
  missing/empty; `5` on RPC failure.

---

## 6. `ptah agent-cli models list`

Enumerate available models per **system** CLI. Without `--cli`, returns
the full `AgentListCliModelsResult` shape — one array keyed by each
system CLI adapter this build ships. Read the keys off the response or
off `SYSTEM_CLI_TYPES`; adapters are added between releases, so a list
written down here goes stale.

| Flag    | Required | Default | Notes                                     |
| ------- | -------- | ------- | ----------------------------------------- |
| `--cli` | no       | (all)   | Any known target; unknown value → exit 3. |

- **RPC**: `agent:listCliModels` (unscoped, and scoped to a system CLI).
- **Notification (unscoped)**: `agent_cli.models { <one key per system CLI adapter> }`.
- **Notification (`--cli <system-cli>`)**:
  `agent_cli.models { cli, models, supported: true }`.
- **Notification (`--cli ptah-cli` or `--cli glm`)**:
  `agent_cli.models { cli, models: [], supported: false, reason, hint }` —
  and **no RPC call is made**.
- **Exit codes**: `0`; `3` (`AuthRequired`) when `--cli` names no target;
  `5` on RPC failure.

> **A `ptah-cli`-scoped query cannot return models, and says so.**
> `AgentListCliModelsResult` has a field per system CLI and no `ptah-cli`
> member, so this RPC structurally cannot answer a provider-scoped query.
> Check `supported === false` — it is the difference between "cannot
> answer" and "this provider has no models". Do not conclude the user has
> no models from the empty array. Use `ptah agent-cli detect` to inspect
> configured providers instead.

---

## 7. `ptah agent-cli stop <id> [--cli <id>]`

Terminate a running CLI-agent process by agent id.

| Positional | Required | Notes                 |
| ---------- | -------- | --------------------- |
| `<id>`     | yes      | The agent id to stop. |

| Flag    | Required | Default | Notes                                                   |
| ------- | -------- | ------- | ------------------------------------------------------- |
| `--cli` | no       | —       | Any known target; unknown → exit 3. Never sent on wire. |

- **RPC**: `agent:stop`, called with `{ agentId }` only.
- **Notification**: `agent_cli.stopped { agentId, cli? }` — `cli` echoes
  the selector, and appears only when `--cli` was supplied.
- **Exit codes**: `0`; `2` when `<id>` is missing; `3` when `--cli` names
  no target; `5` on RPC failure.

> `--cli` is a client-side check only — an agent id already identifies
> one specific running agent. **Prefer `ptah agent-cli stop <id>` with no
> `--cli`.**

---

## 8. `ptah agent-cli resume <id> --cli <id> --task <text>`

Resume an existing CLI-agent session by `cliSessionId` **and give it
work**.

| Positional | Required | Notes                         |
| ---------- | -------- | ----------------------------- |
| `<id>`     | yes      | The `cliSessionId` to resume. |

| Flag            | Required | Default            | Notes                                                          |
| --------------- | -------- | ------------------ | -------------------------------------------------------------- |
| `--cli`         | yes      | —                  | Any known target; unknown → exit 3.                            |
| `--task`        | **yes**  | —                  | Non-empty. What the resumed session should do next.            |
| `--ptah-cli-id` | no       | (backend resolves) | `--cli ptah-cli` only. Pin a provider from `agent-cli detect`. |

- **RPC**: `agent:resumeCliSession`, sent as `{ cliSessionId, cli, task }`
  where `cli` is the wire value for your selector — its own name for a
  system CLI, `"ptah-cli"` for `ptah-cli` and the `glm` alias — plus
  `ptahCliId` **only** when `--ptah-cli-id` was passed.
- **Notification**: `agent_cli.resumed { cliSessionId, cli, ptahCliId?, agentId }`
  — `cli` echoes the selector you passed, not the wire value.
- **Exit codes**: `0`; `2` when `<id>` or `--task` is missing/empty, when
  `--ptah-cli-id` is passed empty, or when `--ptah-cli-id` is passed with
  a system CLI; `3` when `--cli` names no target; `5` on RPC failure
  (including "No Ptah CLI agents configured").

Working invocations:

```bash
ptah agent-cli resume cli-session-uuid --cli codex    --task "finish the migration"
ptah agent-cli resume cli-session-uuid --cli ptah-cli --task "finish the migration"
```

> **`--task` is required and must be non-empty.**
> `agent:resumeCliSession` means "resume this session AND give it this
> work"; its schema rejects `""`. The CLI used to substitute an empty
> string when `--task` was omitted — never reconstruct that behaviour by
> passing `--task ""`, which exits `2`.

---

## 9. Don'ts

- **Don't** pass `--cli glm`. It is a deprecated alias for
  `--cli ptah-cli` and prints a deprecation notice on stderr. GLM is a
  provider reached through the `ptah-cli` agent type, not a binary —
  there is nothing to install. If `resume` reports `No Ptah CLI agents
configured`, the user needs a provider in Agent Orchestration settings.
- **Don't** pass `--ptah-cli-id` with a system CLI. It only applies to
  `--cli ptah-cli`; anywhere else it exits `2`.
- **Don't** call `agent-cli resume` without `--task`, or with
  `--task ""`. It exits `2`.
- **Don't** rely on `PTAH_AGENT_CLI_OVERRIDE`. It is not consulted.
