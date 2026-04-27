# Ptah CLI

Headless agent-to-agent (A2A) bridge over JSON-RPC 2.0 stdio.

## What it is

`ptah` is the headless command-line surface for the Ptah agent backend — the same engine that powers the Ptah VS Code extension and Electron desktop app, surfaced as a single Node.js binary suitable for driving programmatically from external coding agents (OpenClaw, NemoClaw, CI runners, IDE plugins). It speaks JSON-RPC 2.0 newline-delimited JSON on stdin/stdout and exposes ~20 first-class commands and ~70 sub-subcommands that map 1:1 to the backend RPC handler graph.

The CLI works standalone — there is no requirement to install VS Code or the Electron app. The shared agent SDK, plugin loader, license manager, and workspace intelligence libraries run in-process inside the `ptah` binary.

## Install

```bash
# Global install from npm.
npm i -g @hive-academy/ptah-cli

# Development install from a checkout of the monorepo:
nx build ptah-cli
cd dist/apps/ptah-cli
npm link            # exposes `ptah` on PATH
```

The binary lives at `dist/apps/ptah-cli/main.mjs`. The package's `bin` entry declares `ptah`, so `npm link` (or a published install) yields a `ptah` command.

The package is published with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) — verify the attestation links back to this repo with:

```bash
npm view @hive-academy/ptah-cli --json | jq '.dist.attestations'
```

## Quick start

```bash
# Single-turn agent invocation, streams JSON-RPC notifications on stdout.
ptah session start --task "explain this repo"

# Run the 5-phase Setup Wizard (analyze → recommend → install_pack →
# generate → apply_harness) end-to-end, with pretty output.
ptah setup --human

# Persistent bidirectional A2A bridge — speaks JSON-RPC 2.0 on stdio.
ptah interact --session main
```

## Command reference

All commands accept the [global flags](#global-flags). Most commands emit JSON-RPC notifications on stdout (one JSON object per line) and exit with one of the [documented exit codes](#exit-codes).

### Top-level commands

| Command                       | Description                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `--version` / `-V`            | Print package version and exit.                                                 |
| `--help` / `-h`               | Print usage and exit.                                                           |
| `analyze`                     | Run multi-phase workspace analysis (`wizard:deep-analyze`). Premium-gated.      |
| `setup`                       | Run the 5-phase Setup Wizard end-to-end.                                        |
| `run --task <text>`           | DEPRECATED alias for `session start --task`. Emits a stderr deprecation notice. |
| `execute-spec --id <task-id>` | Execute a stored spec via the Team Leader agent.                                |
| `interact`                    | Persistent bidirectional JSON-RPC 2.0 stdio session.                            |

### `session *` — chat sessions

| Sub-subcommand          | Args / flags                                                 | Description                                                |
| ----------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| `session start`         | `[--profile <id>] [--task <text>] [--once] [--scope <name>]` | Start a new chat session; with `--task`, streams the turn. |
| `session resume <id>`   | `[--task <text>]`                                            | Resume an existing session by tabId or SDK session id.     |
| `session send <id>`     | `--task <text>` (required)                                   | Send a follow-up turn and stream it.                       |
| `session list`          | —                                                            | List sessions for the active workspace.                    |
| `session stop <id>`     | —                                                            | Abort an in-flight session via `chat:abort`.               |
| `session delete <id>`   | —                                                            | Delete a session and its persisted entry.                  |
| `session rename <id>`   | `--to <name>` (required)                                     | Rename a session.                                          |
| `session load <id>`     | `[--out <path>]`                                             | Emit full session history; optionally write JSON to disk.  |
| `session stats`         | `[--ids <csv>]`                                              | Emit per-session stats (empty `--ids` = all).              |
| `session validate <id>` | —                                                            | Check whether a session id has an on-disk record.          |

### `harness *` — Harness Setup Builder

| Sub-subcommand               | Args / flags                                                           | Description                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `harness init`               | `[--dir <path>]`                                                       | Create the `.ptah/` scaffolding (idempotent — emits `changed:false` on second run).                           |
| `harness status`             | `[--dir <path>]`                                                       | Inspect `.ptah/` contents (no DI).                                                                            |
| `harness scan`               | —                                                                      | Run `harness:initialize` and emit workspace_context / available_agents / available_skills / existing_presets. |
| `harness apply`              | `--preset <id>` (required)                                             | Apply a stored harness preset.                                                                                |
| `harness preset save <name>` | `--from <path>` (required), `[--description <text>]`                   | Persist a HarnessConfig from a JSON file.                                                                     |
| `harness preset load`        | —                                                                      | List presets via `harness:load-presets`.                                                                      |
| `harness chat`               | `[--task <text>] [--profile <name>] [--session <id>] [--auto-approve]` | Alias for `session start --scope harness-skill`.                                                              |
| `harness analyze-intent`     | `--intent <text>` (required, min 10 chars)                             | Analyze a free-form intent.                                                                                   |
| `harness design-agents`      | `[--workspace]`                                                        | Design sub-agents via `harness:design-agents`.                                                                |
| `harness generate-document`  | `--kind <prd\|spec>` (required)                                        | Generate a project document.                                                                                  |

### `agent *` — workspace sub-agent profiles

| Sub-subcommand                  | Args / flags | Description                                                                |
| ------------------------------- | ------------ | -------------------------------------------------------------------------- |
| `agent packs list`              | —            | Emit `agent.packs.list` via `wizard:list-agent-packs`.                     |
| `agent packs install <pack-id>` | —            | Install an agent pack (idempotent — `changed:false` on re-run).            |
| `agent list`                    | —            | List locally-applied agents in `.ptah/agents/`.                            |
| `agent apply <name>`            | —            | Write the named agent template into `.ptah/agents/<name>.md` (idempotent). |

### `agent-cli *` — CLI agent process management

> Allowlist enforced: only `glm` and `gemini` are accepted for `--cli`. Rejection emits `ptah_code: cli_agent_unavailable` and exits 3. NEVER bypassable via env vars.

| Sub-subcommand          | Args / flags                                        | Description                                        |
| ----------------------- | --------------------------------------------------- | -------------------------------------------------- |
| `agent-cli detect`      | —                                                   | Emit `agent_cli.detection` via `agent:detectClis`. |
| `agent-cli config get`  | —                                                   | Read the agent orchestration config.               |
| `agent-cli config set`  | `--key <k>` `--value <v>` (both required)           | Write a single config entry.                       |
| `agent-cli models list` | `[--cli <glm\|gemini>]`                             | List available models per CLI agent.               |
| `agent-cli stop <id>`   | `--cli <glm\|gemini>` (required)                    | Stop a running CLI agent.                          |
| `agent-cli resume <id>` | `--cli <glm\|gemini>` (required), `[--task <text>]` | Resume a CLI agent session.                        |

### `auth *` — provider authentication

| Sub-subcommand           | Args / flags                   | Description                                                                                |
| ------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------ |
| `auth status`            | —                              | Emit `auth.status`, `auth.health`, `auth.api_key.status`.                                  |
| `auth login <provider>`  | provider: `copilot` \| `codex` | Start an OAuth or out-of-band login flow.                                                  |
| `auth logout <provider>` | `[--force]` (codex only)       | Log out of a provider. `codex` requires `--force` because it deletes `~/.codex/auth.json`. |
| `auth test <provider>`   | —                              | Issue a connection test.                                                                   |

### `provider *` — LLM provider management

| Sub-subcommand              | Args / flags                                      | Description                                                   |
| --------------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| `provider status`           | —                                                 | Emit `provider.status` (api keys redacted unless `--reveal`). |
| `provider set-key`          | `--provider <id>` `--key <value>` (both required) | Store an API key.                                             |
| `provider remove-key`       | `--provider <id>` (required)                      | Delete the stored API key.                                    |
| `provider default get`      | —                                                 | Emit the current default provider.                            |
| `provider default set <id>` | —                                                 | Set the default provider id.                                  |
| `provider models list`      | `--provider <id>` (required)                      | List available models for a provider.                         |
| `provider tier set`         | `--tier <sonnet\|opus\|haiku>` `--model <id>`     | Map a tier slot to a model id.                                |
| `provider tier get`         | —                                                 | Emit the current tier mapping.                                |
| `provider tier clear`       | `--tier <sonnet\|opus\|haiku>` (required)         | Clear a tier override.                                        |

### `config *` — settings + model config

| Sub-subcommand                                           | Args / flags | Description                                                     |
| -------------------------------------------------------- | ------------ | --------------------------------------------------------------- |
| `config get <key>`                                       | —            | Read a value from `settings.json` (file-backed).                |
| `config set <key> <value>`                               | —            | Write a value to `settings.json`.                               |
| `config list`                                            | `[--reveal]` | List all entries (sensitive values redacted unless `--reveal`). |
| `config reset <key>`                                     | —            | Reset a key to its file-backed default.                         |
| `config model-switch <model>`                            | —            | Switch the active agent model.                                  |
| `config model-get`                                       | —            | Emit the active agent model.                                    |
| `config models list`                                     | —            | List available agent models.                                    |
| `config autopilot get` / `set <bool>`                    | —            | Read or toggle autopilot.                                       |
| `config effort get` / `set <minimal\|low\|medium\|high>` | —            | Read or set the reasoning-effort tier.                          |

### `plugin *` — workspace plugins

> Discovery D8 lock: there is no separate `install` verb. `plugin enable` IS the install verb.

| Sub-subcommand        | Args / flags                                  | Description                                   |
| --------------------- | --------------------------------------------- | --------------------------------------------- |
| `plugin list`         | —                                             | List available plugins.                       |
| `plugin enable <id>`  | —                                             | Enable (= install) a plugin. Idempotent.      |
| `plugin disable <id>` | —                                             | Disable a plugin. Idempotent.                 |
| `plugin config get`   | —                                             | Read enabled plugin ids + disabled skill ids. |
| `plugin config set`   | `[--enabled <csv>] [--disabled-skills <csv>]` | Replace the plugin config.                    |
| `plugin skills list`  | `[--plugins <csv>]`                           | List skills exposed by enabled plugins.       |

### `skill *` — skills.sh marketplace

| Sub-subcommand           | Args / flags                                    | Description                                                 |
| ------------------------ | ----------------------------------------------- | ----------------------------------------------------------- |
| `skill search <query>`   | —                                               | Search the skills.sh registry.                              |
| `skill installed`        | —                                               | List locally-installed skills.                              |
| `skill install <source>` | `[--skill-id <id>] [--scope <project\|global>]` | Install a skill. Idempotent.                                |
| `skill remove <name>`    | `[--scope <project\|global>]`                   | Uninstall a skill. Idempotent.                              |
| `skill popular`          | —                                               | Emit the curated popular skills list.                       |
| `skill recommended`      | —                                               | Detect workspace tech and emit recommended skills.          |
| `skill create`           | `--from-spec <path>` (required)                 | Create a skill from a JSON spec via `harness:create-skill`. |

### `mcp *` — MCP server registry

| Sub-subcommand        | Args / flags                                                    | Description                                   |
| --------------------- | --------------------------------------------------------------- | --------------------------------------------- |
| `mcp search <query>`  | `[--limit <n>]`                                                 | Search the Official MCP Registry.             |
| `mcp details <name>`  | —                                                               | Fetch a single server entry.                  |
| `mcp install <name>`  | `--target <vscode\|claude\|cursor\|gemini\|copilot>` (required) | Install an MCP server. Idempotent per target. |
| `mcp uninstall <key>` | `--target <vscode\|claude\|cursor\|gemini\|copilot>` (required) | Uninstall an MCP server. Idempotent.          |
| `mcp list`            | —                                                               | List installed MCP servers across targets.    |
| `mcp popular`         | —                                                               | Emit popular / trending MCP servers.          |

### `prompts *` — Enhanced Prompts (premium-gated)

| Sub-subcommand                       | Args / flags   | Description                                                                              |
| ------------------------------------ | -------------- | ---------------------------------------------------------------------------------------- |
| `prompts status`                     | —              | Emit `prompts.status`.                                                                   |
| `prompts enable` / `prompts disable` | —              | Toggle Enhanced Prompts.                                                                 |
| `prompts regenerate`                 | `[--no-force]` | Regenerate the project prompt. Premium-gated. Streams via `setup-wizard:enhance-stream`. |
| `prompts show <name>`                | —              | Emit the combined prompt content.                                                        |
| `prompts download`                   | —              | Download the combined prompt to disk.                                                    |

### `websearch *` — web-search provider

| Sub-subcommand         | Args / flags                            | Description                                               |
| ---------------------- | --------------------------------------- | --------------------------------------------------------- |
| `websearch status`     | `[--provider <id>]`                     | Emit `websearch.status` (key redacted unless `--reveal`). |
| `websearch set-key`    | `--provider <id>` `--key <value>`       | Store a web-search API key.                               |
| `websearch remove-key` | `--provider <id>`                       | Delete a stored web-search API key.                       |
| `websearch test`       | —                                       | Issue a connectivity test.                                |
| `websearch config get` | —                                       | Read the web-search config.                               |
| `websearch config set` | `[--provider <id>] [--max-results <n>]` | Update the web-search config.                             |

### `git *` — git introspection + worktrees + source control

| Sub-subcommand              | Args / flags                                  | Description                                                 |
| --------------------------- | --------------------------------------------- | ----------------------------------------------------------- |
| `git info`                  | —                                             | Emit `git.info` (branch + dirty state).                     |
| `git worktrees`             | —                                             | Emit `git.worktrees`.                                       |
| `git add-worktree`          | `--branch <name>` `[--path <dir>] [--create]` | Add a worktree.                                             |
| `git remove-worktree`       | `--path <dir>` `[--force]`                    | Remove a worktree.                                          |
| `git stage` / `git unstage` | `--paths <csv>`                               | Stage / unstage paths.                                      |
| `git discard`               | `--paths <csv>` `--confirm`                   | Discard local changes (DESTRUCTIVE — requires `--confirm`). |
| `git commit`                | `--message <msg>`                             | Commit staged changes.                                      |
| `git show-file`             | `--path <file>`                               | Emit the HEAD content of a file.                            |

### `workspace *` — workspace folder management

| Sub-subcommand     | Args / flags   | Description                  |
| ------------------ | -------------- | ---------------------------- |
| `workspace info`   | —              | Emit `workspace.info`.       |
| `workspace add`    | `--path <dir>` | Register a workspace folder. |
| `workspace remove` | `--path <dir>` | Remove a workspace folder.   |
| `workspace switch` | `--path <dir>` | Switch the active workspace. |

### `quality *` — quality dashboard

| Sub-subcommand       | Args / flags     | Description                               |
| -------------------- | ---------------- | ----------------------------------------- |
| `quality assessment` | `[--id <id>]`    | Emit `quality.assessment`.                |
| `quality history`    | `[--limit <n>]`  | Emit `quality.history`.                   |
| `quality export`     | `[--out <path>]` | Export the latest quality report as JSON. |

### `license *` — Ptah license key

| Sub-subcommand   | Args / flags           | Description            |
| ---------------- | ---------------------- | ---------------------- |
| `license status` | —                      | Emit `license.status`. |
| `license set`    | `--key <ptah_lic_...>` | Set the license key.   |
| `license clear`  | —                      | Clear the license key. |

### `settings *` — portable settings bundles

| Sub-subcommand    | Args / flags                  | Description                                                            |
| ----------------- | ----------------------------- | ---------------------------------------------------------------------- |
| `settings export` | `[--out <path>]`              | Export a portable settings bundle (writes 0o600 on `--out`).           |
| `settings import` | `[--in <path>] [--overwrite]` | Import a settings bundle (preserves credentials unless `--overwrite`). |

### `new-project *` — New Project Wizard

| Sub-subcommand                          | Args / flags               | Description                                |
| --------------------------------------- | -------------------------- | ------------------------------------------ |
| `new-project select-type <type>`        | —                          | Fetch question groups for a project type.  |
| `new-project submit-answers`            | `--file <path>` (required) | Submit discovery answers from a JSON file. |
| `new-project get-plan <session-id>`     | —                          | Load the previously-generated master plan. |
| `new-project approve-plan <session-id>` | —                          | Approve and persist the master plan.       |

### `wizard *` — low-level Setup Wizard escape hatches

> Most users should use `ptah setup` instead — it composes these into a 5-phase orchestrator.

| Sub-subcommand                | Args / flags               | Description                                                                                |
| ----------------------------- | -------------------------- | ------------------------------------------------------------------------------------------ |
| `wizard submit-selection`     | `--file <path>` (required) | Submit a wizard selection (fire-and-forget; waits for `setup-wizard:generation-complete`). |
| `wizard cancel <session-id>`  | —                          | Cancel an in-flight wizard session. Idempotent.                                            |
| `wizard retry-item <item-id>` | —                          | Retry a single failed generation item.                                                     |
| `wizard status`               | —                          | Emit `wizard.status` with the last completed setup phase.                                  |

## Global flags

| Flag               | Default                 | Behavior                                                                                              |
| ------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `--json`           | `true`                  | Emit JSON-RPC 2.0 NDJSON on stdout (default; conflicts with `--human`).                               |
| `--human`          | `false`                 | Pretty-print events with colors and indentation (conflicts with `--json`).                            |
| `--cwd <dir>`      | `process.cwd()`         | Working directory for workspace ops. Use absolute paths with drive letter on Windows.                 |
| `--quiet`          | `false`                 | Suppress non-essential notifications (`agent.thought`, `session.cost`). Conflicts with `--verbose`.   |
| `--verbose`        | `false`                 | Emit `debug.*` notifications (`debug.di.phase`, etc.). Conflicts with `--quiet`.                      |
| `--config <path>`  | `~/.ptah/settings.json` | Override the file-backed settings path.                                                               |
| `--no-color`       | `false`                 | Disable ANSI escape codes in `--human` mode.                                                          |
| `--auto-approve`   | `false`                 | Auto-allow all permission requests (run / setup / execute-spec / session).                            |
| `--reveal`         | `false`                 | Show sensitive values verbatim (`config list`, `provider status`, `auth status`, `websearch status`). |
| `--help` / `-h`    | n/a                     | Print command-specific usage.                                                                         |
| `--version` / `-V` | n/a                     | Print package version.                                                                                |

## Environment variables

| Variable            | Purpose                                                                                  | Default                 |
| ------------------- | ---------------------------------------------------------------------------------------- | ----------------------- |
| `PTAH_CONFIG_PATH`  | Override the path to `settings.json`.                                                    | `~/.ptah/settings.json` |
| `PTAH_LOG_LEVEL`    | Logger threshold (`debug` \| `info` \| `warn` \| `error`). Output routes to stderr only. | `info`                  |
| `PTAH_NO_TTY`       | Force non-TTY mode (suppresses ANSI even in `--human` mode).                             | unset                   |
| `PTAH_AUTO_APPROVE` | Same as `--auto-approve`. Set to `'true'` to auto-allow all permission requests.         | unset                   |
| `PTAH_DI_LAZY`      | Skip DI bootstrap for read-only commands when the default would bootstrap.               | `true`                  |
| `NO_COLOR`          | Disable ANSI codes (any non-empty value). Honored by formatter.                          | unset                   |
| `FORCE_COLOR`       | Force ANSI codes on. Honored by Node.                                                    | unset                   |

> `PTAH_AGENT_CLI_OVERRIDE` is **not** consulted. The CLI agent allowlist (`glm`, `gemini`) is hard-coded at command entry-points and cannot be bypassed via env vars.

## Exit codes

| Code  | Meaning           | When                                                                                                                               |
| ----- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `0`   | Success           | Command completed.                                                                                                                 |
| `1`   | Generic error     | Recoverable failure (unknown resource, task error, network blip, wizard phase failed, generation item failed, MCP install failed). |
| `2`   | Invalid arguments | Missing required flag, malformed value, conflicting flags.                                                                         |
| `3`   | Auth required     | Missing/invalid provider credentials OR required CLI agent missing.                                                                |
| `4`   | License required  | Subscription invalid or expired.                                                                                                   |
| `5`   | Internal failure  | Unhandled exception, DI bootstrap crash, unrecoverable IO.                                                                         |
| `130` | SIGINT            | Graceful shutdown after Ctrl-C.                                                                                                    |
| `143` | SIGTERM           | Graceful shutdown after a kill signal.                                                                                             |

Errors are written to **stderr** as JSON-RPC error objects with the standard `code` (`-32700` parse error, `-32600` invalid request, `-32601` method not found, `-32602` invalid params, `-32603` internal error) and a Ptah-specific `data.ptah_code` (`auth_required`, `license_required`, `internal_failure`, `wizard_phase_failed`, `cli_agent_unavailable`, etc.). See [`docs/jsonrpc-schema.md`](docs/jsonrpc-schema.md) for the full taxonomy.

## Troubleshooting

**`license_required` on `session start` / `setup` / `analyze`** — Premium-gated commands require a valid Ptah license. Set one via `ptah license set --key ptah_lic_...`. Read-only commands (`license status`, `config list`, `auth status`) are unaffected.

**OAuth login hangs in headless / CI environments** — `auth login copilot` and `auth login codex` need a browser. In `interact` mode the CLI emits an `oauth.url.open` JSON-RPC request to the peer; in one-shot mode the URL is printed on stderr for manual paste. For CI, set `PTAH_AUTO_APPROVE=true` to skip permission prompts and pre-seed credentials via `provider set-key` instead.

**Output is mangled when piping to `jq` / a log aggregator** — Default output is JSON-RPC NDJSON on stdout (one JSON object per line). Don't use `--human` in pipelines. Logger output goes to stderr, never stdout, so `2>/dev/null` is safe.

**`agent-cli stop` rejects with `cli_agent_unavailable`** — The CLI agent allowlist accepts only `glm` and `gemini`. `copilot` and `cursor` are blocked due to Windows spawn issues. The check is at command entry-point and cannot be bypassed via env vars.

**Verbose diagnostics for DI bootstrap problems** — Pass `--verbose` to emit `debug.di.phase` notifications for each of the 5 DI phases (config, license, auth, RPC, agent-sdk). Combine with `PTAH_LOG_LEVEL=debug` for the underlying logger output on stderr.

## Architecture

The CLI runs the agent backend in-process — there is no IPC boundary. The JSON-RPC stdio loop, the in-process RPC transport, the 5-phase DI container, the agent SDK, the workspace intelligence services, the plugin loader, and the license manager all share a single Node process. See [`CLAUDE.md`](CLAUDE.md) for engineering details (entry points, DI tokens, bridge primitives, bootstrap modes).

## License

FSL-1.1-MIT.
