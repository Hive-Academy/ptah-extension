---
title: CLI Command Reference
description: Every ptah subcommand group, grouped by what it manages.
---

Run `ptah --help` for the live list, and `ptah <command> --help` for one group.
This page is the map.

Every command accepts the [global options](/cli/#global-options). Every command
emits NDJSON by default — add `--human` for readable output.

## Setup and diagnosis

| Command         | What it does                                                                            |
| --------------- | --------------------------------------------------------------------------------------- |
| `ptah init`     | First-run setup. Interactive on a TTY, emits an `init.plan` in machine mode.            |
| `ptah doctor`   | License, auth, providers, and the effective route, in one snapshot.                     |
| `ptah diagnose` | Alias for `doctor`.                                                                     |
| `ptah analyze`  | Multi-phase workspace analysis.                                                         |
| `ptah setup`    | The Setup Wizard end to end: analyze, recommend, install pack, generate, apply harness. |
| `ptah wizard`   | Low-level wizard steps: `submit-selection`, `cancel`, `retry-item`, `status`.           |

## Sessions

`ptah session` manages chat sessions.

| Subcommand | Purpose                                                                    |
| ---------- | -------------------------------------------------------------------------- |
| `start`    | Begin a session. `--task` submits work, `--once` exits when the turn ends. |
| `resume`   | Continue an existing session.                                              |
| `send`     | Send a message to a running session.                                       |
| `list`     | List sessions.                                                             |
| `stop`     | Stop a running session.                                                    |
| `delete`   | Delete a session.                                                          |
| `rename`   | Rename a session.                                                          |
| `load`     | Load a session's transcript.                                               |
| `stats`    | Token and cost totals.                                                     |
| `validate` | Check a session's integrity.                                               |

```bash
ptah session start --task "Add a health check endpoint" --once --human
```

:::note[`ptah run` is deprecated]
`ptah run` still works and still submits a one-off task. Use
`ptah session start --task` instead.
:::

## Providers and authentication

`ptah provider` manages LLM providers.

| Subcommand                           | Purpose                                                |
| ------------------------------------ | ------------------------------------------------------ |
| `status`                             | Configured providers. Keys redacted unless `--reveal`. |
| `set-key` / `remove-key`             | Store or clear an API key.                             |
| `default get` / `set`                | Which provider new sessions use.                       |
| `models list`                        | The live model catalog for a provider.                 |
| `tier set/get/clear`                 | Map `opus`, `sonnet`, and `haiku` onto real model ids. |
| `base-url set/get/clear`             | Override a provider's endpoint.                        |
| `ollama set-endpoint`                | Point at a non-default Ollama daemon.                  |
| `custom list/add/update/remove/test` | Manage your own Anthropic-compatible endpoints.        |

`ptah auth` manages the credential side.

| Subcommand                 | Purpose                                        |
| -------------------------- | ---------------------------------------------- |
| `status`                   | Which providers are authenticated.             |
| `login <provider>`         | Start a login flow.                            |
| `logout <provider>`        | Log out. Codex requires `--force`.             |
| `test <provider>`          | Issue a live connection test.                  |
| `use <providerId>`         | Select the active provider.                    |
| `set-anthropic-route <id>` | Route Claude traffic through another provider. |

```bash
ptah provider set-key --provider anthropic --key sk-ant-...
ptah provider default set anthropic
ptah doctor --human
```

:::tip[The bootstrap sequence]
`set-key` → `default set` → `session start` is the whole pure-CLI bootstrap. A
fresh install ships with no default provider, so you must select one explicitly.
:::

## Agents

`ptah agent` handles agent packs and rosters.

| Subcommand           | Purpose                          |
| -------------------- | -------------------------------- |
| `packs list`         | Curated agent packs available.   |
| `packs install <id>` | Install a pack.                  |
| `list`               | Agents in this workspace.        |
| `apply <name>`       | Apply an agent to the workspace. |

`ptah agent-cli` drives external CLI agents.

| Subcommand           | Purpose                                         |
| -------------------- | ----------------------------------------------- |
| `detect`             | Which agent CLIs are installed on this machine. |
| `config get` / `set` | Read or write the orchestration config.         |
| `models list`        | Models available per CLI.                       |
| `stop`               | Stop a running CLI agent.                       |
| `resume`             | Resume a CLI session and hand it work.          |

`--cli` names a target. The accepted values are the six spawnable CLIs — `codex`,
`copilot`, `cursor`, `antigravity`, `opencode`, `pi` — plus `ptah-cli`.
`--ptah-cli-id` is meaningful only for a `ptah-cli` target and is refused against
a system CLI.

## Task specs

`ptah spec` manages the `.ptah/specs/` tree that backs the [Tasks board](/tasks/).

| Subcommand    | Purpose                                                  |
| ------------- | -------------------------------------------------------- |
| `new`         | Create a task folder and carrier.                        |
| `status <id>` | Move a task to a new status with `--to`.                 |
| `show <id>`   | Detail for one task.                                     |
| `list`        | Filter by `--status`, `--type`, `--label`, `--estimate`. |
| `check`       | Validate carriers.                                       |
| `doctor`      | Report problems across the whole tree.                   |

`ptah execute-spec --id <task-id>` hands a stored spec to the Team Leader agent.

```bash
ptah spec new --title "Add a health check endpoint" --type FEATURE
ptah spec list --status backlog,in_progress --human
ptah execute-spec --id TASK_2026_104
```

## Harness

`ptah harness` builds and applies agent configurations.

| Subcommand             | Purpose                                            |
| ---------------------- | -------------------------------------------------- |
| `init`                 | Scaffold a harness.                                |
| `status`               | Current harness state.                             |
| `scan`                 | Scan the workspace for what a harness should hold. |
| `apply`                | Apply a stored preset.                             |
| `preset save` / `load` | Manage reusable presets.                           |
| `chat`                 | Alias for `session start --scope harness-skill`.   |
| `analyze-intent`       | Turn a description into harness intent.            |
| `design-agents`        | Design an agent roster.                            |
| `generate-document`    | Generate a harness document.                       |
| `doctor`               | Verify every harness copy against the manifest.    |
| `remove`               | Delete every manifest-owned harness copy.          |

`ptah harness doctor` is built to work as a **CI gate**. It exits `1` when the
harness is degraded — a detected tool missing entries, a source failure, or a
failed write. Add `--fix` to reconcile instead of only reporting.

```bash
ptah harness doctor --json    # exits 1 on drift
ptah harness doctor --fix
ptah harness remove --yes
```

`remove` requires `--yes`. There is no prompt, because the CLI's default mode is
machine output on a pipe.

## Skills, plugins, and MCP

`ptah skill` — `search`, `installed`, `install`, `remove`, `popular`,
`recommended`, `create`, plus `select` and `selection` for the per-workspace
skill choice.

`ptah plugin` — `list`, `enable`, `disable`, `config`, `skills`. Install is
enable.

`ptah mcp` — `search`, `details`, `install`, `uninstall`, `list`, `popular`.

`ptah prompts` — Enhanced Prompts: `status`, `enable`, `disable`, `regenerate`,
`show`, `download`.

## Thoth subsystems

These four groups drive the same subsystems as the desktop app's Thoth tabs.
They share `~/.ptah/ptah.db`.

| Group                  | Subcommands                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `ptah memory`          | `list`, `search`, `get`, `stats`, `pin`, `unpin`, `forget`                                 |
| `ptah skill-synthesis` | `list`, `get`, `promote`, `reject`, `invocations`, `stats`                                 |
| `ptah cron`            | `list`, `get`, `create`, `update`, `delete`, `toggle`, `run-now`, `runs`, `next-fire`      |
| `ptah gateway`         | `status`, `start`, `stop`, `set-token`, `bindings`, `approve`, `block`, `messages`, `test` |

## Git

`ptah git` — `info`, `worktrees`, `add-worktree`, `remove-worktree`, `stage`,
`unstage`, `discard`, `commit`, `show-file`.

## Workspace, settings, and license

`ptah workspace` — `info`, `add`, `remove`, `switch`.

`ptah config` — `get`, `set`, `list`, `reset`, plus `model-switch`, `model-get`,
`models list`, `autopilot get/set`, and `effort get/set`.

`ptah settings` — `export` and `import` for portable settings bundles. An export
written with `--out` is created with `0o600` permissions.

`ptah license` — `status`, `set`, `clear`.

`ptah websearch` — web-search provider settings and a connectivity test.

`ptah quality` — `assessment`, `history`, `export`.

## Long-running surfaces

| Command          | What it does                                                       |
| ---------------- | ------------------------------------------------------------------ |
| `ptah interact`  | Persistent JSON-RPC 2.0 stdio session. Blocks until EOF or SIGINT. |
| `ptah mcp-serve` | Serve Ptah as a stdio MCP server for an external host.             |
| `ptah proxy`     | Anthropic-compatible HTTP proxy over the Messages API.             |
| `ptah tui`       | Interactive terminal UI. Needs a real TTY.                         |

See [CLI Flags](/reference/cli-flags/) for the `ptah interact` proxy flags.

## Next steps

- [CLI overview](/cli/) — install, output modes, exit codes
- [Driving Ptah via MCP](/mcp-and-skills/driving-ptah-via-mcp/)
- [Tasks board](/tasks/) — the UI over `ptah spec`
