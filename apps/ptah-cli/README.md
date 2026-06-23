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

## First-time setup

A fresh `ptah` install needs a provider, credentials for it, and (for premium features) a license. A fresh install has **no default provider** (`llm.defaultProvider: ""`), so you must pick one before turns will start. Pick one of the paths below.

`ptah doctor` is the source of truth on whether the CLI is ready. When `effective.ready` is `false` it emits a `hints` array of the exact commands needed to get green — read it after every setup step. `doctor` reflects the exact secret slot the SDK reads, so `doctor` and `session start` always agree.

### Guided setup with `ptah init`

```bash
ptah init --human                                 # interactive wizard on a TTY
```

`ptah init` walks license → provider → credentials → optional tier mapping → verify → optional smoke turn. On a TTY with `--human` it uses interactive prompts; in machine mode (the default when stdout is not a TTY, or with `--json` / `--quiet`) it never prompts — it emits an ordered `init.plan` describing exactly which commands to run. See [`### init`](#init) below.

### Bootstrapping a new machine from scratch (pure CLI)

```bash
ptah provider set-key --provider anthropic --key sk-ant-...   # writes the slot the SDK reads
ptah provider default set anthropic                           # pick a provider (required)
ptah license set --key ptah_lic_...                           # optional — Community works without
ptah doctor                                                   # confirm effective.ready: true
```

`provider set-key` validates the key and reports `verified:true/false`; a malformed key is rejected with exit `3`. `license set` rejects a server-rejected key with exit `4`. Trust the exit code and `verified`, not a bare `success`. The old "`ANTHROPIC_API_KEY` env var is the only working path" workaround is no longer required — `set-key` now reaches the SDK directly (the env var still works as an alternative).

To bootstrap with an OAuth provider instead of an API key:

```bash
ptah auth login github-copilot                    # or codex (codex login --device-auth)
ptah auth use github-copilot                      # switch active strategy
ptah provider default set github-copilot
ptah doctor
```

### Copying setup from a machine where Ptah is already configured

```bash
# On the source machine:
ptah settings export --out ptah-bundle.json       # written with mode 0o600

# Transfer ptah-bundle.json over a secure channel.

# On the new machine:
ptah settings import --in ptah-bundle.json
ptah doctor
```

The bundle ships the license key, the Anthropic API key, the OpenRouter / Moonshot / Z.AI API keys, and 40+ config entries (active auth method, tier mappings, agent-orchestration prefs). GitHub Copilot and OpenAI Codex OAuth tokens are **not** included — rerun `ptah auth login` for those after import.

### CLI ↔ desktop app on the same machine

The CLI and the Electron desktop app share `~/.ptah/settings.json` for configuration (tier mappings, active auth method, orchestration prefs) but **store secrets separately** — Electron uses the OS-native keychain via `safeStorage`, the CLI uses an encrypted file under `~/.ptah/`. License keys and OAuth tokens do not currently roundtrip between the two; run `ptah settings export` from one and `ptah settings import` into the other if you need parity on the same box.

## Quick start

```bash
# First-run setup. On a TTY use the interactive wizard; in scripts/agents
# drop --human to get a machine-readable init.plan instead.
ptah init --human

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

| Command                       | Description                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `--version` / `-V`            | Print package version and exit.                                                                             |
| `--help` / `-h`               | Print usage and exit.                                                                                       |
| `init`                        | First-run setup wizard. Interactive on a TTY with `--human`; otherwise emits a non-interactive `init.plan`. |
| `doctor` / `diagnose`         | Readiness oracle — emits `doctor.report` (`effective.ready` + `hints[]`).                                   |
| `analyze`                     | Run multi-phase workspace analysis (`wizard:deep-analyze`). Premium-gated.                                  |
| `setup`                       | Run the 5-phase Setup Wizard end-to-end.                                                                    |
| `run --task <text>`           | DEPRECATED alias for `session start --task`. Emits a stderr deprecation notice.                             |
| `execute-spec --id <task-id>` | Execute a stored spec via the Team Leader agent.                                                            |
| `interact`                    | Persistent bidirectional JSON-RPC 2.0 stdio session.                                                        |
| `mcp-serve`                   | Serve Ptah as a stdio Model Context Protocol server for external hosts.                                     |
| `tui`                         | Launch the interactive Ink/React terminal UI (requires a real TTY).                                         |

### init

First-run setup. Walks license → provider → credentials → optional tier mapping → verify (doctor) → optional smoke turn → next steps.

| Flag     | Description                                                                            |
| -------- | -------------------------------------------------------------------------------------- |
| _(none)_ | Uses the [global flags](#global-flags) only. `--human` on a TTY → interactive prompts. |

**Interactive mode** (fancy [@clack](https://github.com/bombshell-dev/clack) prompts) runs only when stdout is a real TTY **and** `--json` was not requested — in practice, pass `--human` from an interactive terminal:

```bash
ptah init --human
```

**Machine mode** is the default everywhere else (non-TTY, or `--json`, or `--quiet`) and **never prompts**. It emits a single `init.plan` notification and exits `0`. This is the path AI agents and scripts should use: spawn `ptah init`, read `init.plan`, then run each unsatisfied `command`.

```bash
ptah init   # → one init.plan notification on stdout, exit 0
```

`init.plan.params` carries:

| Field      | Shape                                                  | Meaning                                                           |
| ---------- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| `ready`    | `boolean`                                              | Mirror of `doctor`'s `effective.ready` — true when turns can run. |
| `route`    | `string`                                               | The resolved auth route (e.g. `api-key`, `oauth`, `cli`).         |
| `blockers` | `string[]`                                             | Human-readable reasons setup is not ready (empty when `ready`).   |
| `license`  | `{ tier, valid, daysRemaining }`                       | License snapshot.                                                 |
| `auth`     | `{ authMethod, defaultProvider, anthropicProviderId }` | Auth/provider snapshot.                                           |
| `steps`    | `Array<{ id, description, command, satisfied }>`       | Ordered setup steps; run the `command` of each `satisfied:false`. |

Step ids are `license`, `provider.default`, `provider.credential`, and `verify`. Have the user run the credential/license `command`s themselves so raw secrets never pass through an agent; never invent keys. After running the steps, verify with `ptah doctor` and proceed only when `effective.ready:true`.

```json
{
  "jsonrpc": "2.0",
  "method": "init.plan",
  "params": {
    "ready": true,
    "route": "api-key",
    "blockers": [],
    "license": { "tier": "community", "valid": true, "daysRemaining": null },
    "auth": { "authMethod": "anthropic-api-key", "defaultProvider": "anthropic", "anthropicProviderId": "anthropic" },
    "steps": [
      { "id": "license", "description": "Set a Ptah license key (optional — Community tier works without one)", "command": "ptah license set --key ptah_lic_...", "satisfied": true },
      { "id": "provider.default", "description": "Choose a default provider", "command": "ptah provider default set <provider-id>", "satisfied": true },
      { "id": "provider.credential", "description": "Store an API key for anthropic", "command": "ptah provider set-key --provider anthropic --key <KEY>", "satisfied": true },
      { "id": "verify", "description": "Verify readiness", "command": "ptah doctor", "satisfied": true }
    ]
  }
}
```

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

> Allowlist enforced: only `glm` is accepted for `--cli`. Rejection emits `ptah_code: cli_agent_unavailable` and exits 3. NEVER bypassable via env vars.

| Sub-subcommand          | Args / flags                                | Description                                        |
| ----------------------- | ------------------------------------------- | -------------------------------------------------- |
| `agent-cli detect`      | —                                           | Emit `agent_cli.detection` via `agent:detectClis`. |
| `agent-cli config get`  | —                                           | Read the agent orchestration config.               |
| `agent-cli config set`  | `--key <k>` `--value <v>` (both required)   | Write a single config entry.                       |
| `agent-cli models list` | `[--cli <glm>]`                             | List available models per CLI agent.               |
| `agent-cli stop <id>`   | `--cli <glm>` (required)                    | Stop a running CLI agent.                          |
| `agent-cli resume <id>` | `--cli <glm>` (required), `[--task <text>]` | Resume a CLI agent session.                        |

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

| Sub-subcommand        | Args / flags                                            | Description                                   |
| --------------------- | ------------------------------------------------------- | --------------------------------------------- |
| `mcp search <query>`  | `[--limit <n>]`                                         | Search the Official MCP Registry.             |
| `mcp details <name>`  | —                                                       | Fetch a single server entry.                  |
| `mcp install <name>`  | `--target <vscode\|claude\|cursor\|copilot>` (required) | Install an MCP server. Idempotent per target. |
| `mcp uninstall <key>` | `--target <vscode\|claude\|cursor\|copilot>` (required) | Uninstall an MCP server. Idempotent.          |
| `mcp list`            | —                                                       | List installed MCP servers across targets.    |
| `mcp popular`         | —                                                       | Emit popular / trending MCP servers.          |

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

### `wizard *` — low-level Setup Wizard escape hatches

> Most users should use `ptah setup` instead — it composes these into a 5-phase orchestrator.

| Sub-subcommand                | Args / flags               | Description                                                                                |
| ----------------------------- | -------------------------- | ------------------------------------------------------------------------------------------ |
| `wizard submit-selection`     | `--file <path>` (required) | Submit a wizard selection (fire-and-forget; waits for `setup-wizard:generation-complete`). |
| `wizard cancel <session-id>`  | —                          | Cancel an in-flight wizard session. Idempotent.                                            |
| `wizard retry-item <item-id>` | —                          | Retry a single failed generation item.                                                     |
| `wizard status`               | —                          | Emit `wizard.status` with the last completed setup phase.                                  |

### `mcp-serve` — stdio Model Context Protocol server

| Flag                  | Description                                                               |
| --------------------- | ------------------------------------------------------------------------- |
| `--allow-tools <csv>` | Comma-separated tool allowlist override. Defaults to the full 7-tool MVP. |

`ptah mcp-serve` exposes Ptah as a stdio MCP server so external
MCP-compliant hosts can drive Ptah's agent-spawn surface and the
`session_submit` Team Leader harness without bespoke integration. The
wire framing matches `ptah interact` (NDJSON JSON-RPC 2.0); the method
namespace is the MCP standard (`initialize`, `tools/list`, `tools/call`,
`notifications/cancelled`). Boot/teardown messages go to stderr with
the `[ptah-mcp]` prefix; stdout is reserved for the MCP wire.

Typical `.mcp.json` entry for an external host:

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

`--auto-approve` (the global flag) is recommended because external MCP
hosts have no UI surface to render Ptah's permission prompts; without
it, any approval-gated `tools/call` will hang for 5 minutes and exit
`3` (`auth_required`).

Full reference — MVP tool catalog, premium-gate behavior, cost
attribution, cancellation/drain semantics, and troubleshooting — lives
in the `ptah-cli-usage` skill, section 16 ("MCP-serve — Drive Ptah
from external agents") at
`apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-cli-usage/SKILL.md`.

### `tui` — interactive terminal UI

`ptah tui` launches a chat-first Ink/React terminal interface over the same
in-process agent backend that powers `interact`. It is a second bundle
(`tui.mjs`) shipped inside this package and dynamic-imported next to
`main.mjs`.

```bash
ptah tui
```

| Flag     | Description                                                                     |
| -------- | ------------------------------------------------------------------------------- |
| _(none)_ | Uses the [global flags](#global-flags) only (`--cwd`, `--config`, `--verbose`). |

The TUI requires an interactive terminal with raw-mode support. Under piped
or redirected stdin (CI, `ptah tui < file`, pipelines) it writes a short
explanation to stderr, emits nothing on stdout, and exits non-zero — it
never hangs and never produces JSON-RPC frames. Respects `NO_COLOR` /
`FORCE_COLOR`.

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

> `PTAH_AGENT_CLI_OVERRIDE` is **not** consulted. The CLI agent allowlist (`glm`) is hard-coded at command entry-points and cannot be bypassed via env vars.

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

**`session start` exits `3` (`auth_required`) on a fresh install** — A fresh install has no default provider (`llm.defaultProvider: ""`), so nothing can resolve headlessly. Run `ptah doctor` (or `ptah init`) to see the blocker, then `ptah provider default set <id>` plus `ptah provider set-key`. The bootstrap auth error is runtime-neutral: "No authentication configured. Set a provider API key or sign in to a provider, then retry." (there is no GUI settings tab in the CLI).

**`provider set-key` reported `success` but turns still fail** — Trust `verified` and the exit code, not a bare `success`. A malformed key is rejected with `verified:false` and exit `3`. A good key returns `{ success:true, verified:true }` and exit `0`, writes the exact slot the SDK reads, and persists `authMethod`. After it, `ptah doctor` should show `effective.ready:true` — `doctor` and `session start` now agree.

**`license set` accepted a bad key on Community tier** — It no longer does. A server-rejected key fails with exit `4` (`license_required`) and a `task.error` like "License key was not accepted (not_found)" instead of silently downgrading to `tier:community`. Read the exit code.

**`license_required` on `session start` / `setup` / `analyze`** — Premium-gated commands require a valid Ptah license. Set one via `ptah license set --key ptah_lic_...`. Read-only commands (`license status`, `config list`, `auth status`) are unaffected.

**OAuth login hangs in headless / CI environments** — `auth login copilot` and `auth login codex` need a browser. In `interact` mode the CLI emits an `oauth.url.open` JSON-RPC request to the peer; in one-shot mode the URL is printed on stderr for manual paste. For CI, set `PTAH_AUTO_APPROVE=true` to skip permission prompts and pre-seed credentials via `provider set-key` instead.

**Output is mangled when piping to `jq` / a log aggregator** — Default output is JSON-RPC NDJSON on stdout (one JSON object per line). Don't use `--human` in pipelines. Logger output goes to stderr, never stdout, so `2>/dev/null` is safe.

**`agent-cli stop` rejects with `cli_agent_unavailable`** — The CLI agent allowlist accepts only `glm`. `copilot` and `cursor` are blocked due to Windows spawn issues. The check is at command entry-point and cannot be bypassed via env vars.

**Verbose diagnostics for DI bootstrap problems** — Pass `--verbose` to emit `debug.di.phase` notifications for each of the 5 DI phases (config, license, auth, RPC, agent-sdk). Combine with `PTAH_LOG_LEVEL=debug` for the underlying logger output on stderr.

## Architecture

The CLI runs the agent backend in-process — there is no IPC boundary. The JSON-RPC stdio loop, the in-process RPC transport, the 5-phase DI container, the agent SDK, the workspace intelligence services, the plugin loader, and the license manager all share a single Node process. See [`CLAUDE.md`](CLAUDE.md) for engineering details (entry points, DI tokens, bridge primitives, bootstrap modes).

## License

FSL-1.1-MIT.
