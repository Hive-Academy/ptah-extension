---
title: Ptah CLI
description: The headless Ptah — the same agent backend, driven from a terminal, a script, or another agent.
---

The **Ptah CLI** is the desktop app's engine with no window attached. It hosts
the full agent backend in-process and exposes it two ways: as ordinary
subcommands you can run in a terminal, and as a JSON-RPC 2.0 session over stdio
that another program can drive.

It ships as its own npm package, separate from the desktop app.

## Install

```bash
npm install -g @hive-academy/ptah-cli
```

The package installs one binary, `ptah`.

```bash
ptah --version
ptah --help
```

## What it is for

- **CI pipelines** — run a review, a refactor, or a spec end to end on a build agent.
- **Scripted work** — drive a change across many repositories from a shell script.
- **Agent-to-agent bridges** — let another AI host delegate work to Ptah.
- **Headless machines** — a server with no desktop still gets the whole engine.

## First run

```bash
ptah init
```

On a real terminal this walks you through license, provider, credentials, and a
verification step. In machine mode it never prompts. It emits a structured
`init.plan` listing the exact commands still needed, so an agent can finish the
setup itself.

Check the result at any time:

```bash
ptah doctor
```

`doctor` reports license state, authentication, configured providers, and the
**effective route** — which provider and model a session would actually use right
now. When something does not work, start here.

## Output modes

The CLI emits **newline-delimited JSON-RPC 2.0 on stdout by default**. This is
deliberate: the primary consumer is a program, not a person.

| Flag      | Effect                                           |
| --------- | ------------------------------------------------ |
| `--json`  | NDJSON JSON-RPC 2.0 on stdout. **The default.**  |
| `--human` | Pretty-printed events with color and indentation |

Never assume the CLI detects your terminal. If you want readable output, ask for
it with `--human`.

## Global options

These apply to every subcommand.

| Option            | Purpose                                                                     |
| ----------------- | --------------------------------------------------------------------------- |
| `--json`          | NDJSON output (default). Conflicts with `--human`.                          |
| `--human`         | Pretty output. Conflicts with `--json`.                                     |
| `--cwd <dir>`     | Working directory for workspace operations. Defaults to the current folder. |
| `--config <dir>`  | Override the Ptah data directory. Default `~/.ptah`.                        |
| `--quiet`         | Suppress non-essential notifications. Conflicts with `--verbose`.           |
| `--verbose`       | Emit additional `debug.*` notifications. Conflicts with `--quiet`.          |
| `--no-color`      | Disable ANSI codes in `--human` mode.                                       |
| `--auto-approve`  | Auto-allow every permission request. `run` and `execute-spec` only.         |
| `--reveal`        | Show secrets verbatim. `config list` only.                                  |
| `-V`, `--version` | Print the version and exit.                                                 |
| `-h`, `--help`    | Print usage and exit.                                                       |

`--config` has an environment-variable twin, `PTAH_CONFIG_PATH`. The flag wins.
Settings, secrets, the SQLite database, and migrations all live under whichever
directory you choose.

## Exit codes

Scripts should branch on the exit code, not on the output text.

| Code | Name             | Meaning                                         |
| ---- | ---------------- | ----------------------------------------------- |
| `0`  | Success          | The command completed.                          |
| `1`  | General error    | The command failed.                             |
| `2`  | Usage error      | Bad arguments or a refused flag combination.    |
| `3`  | Auth required    | No usable credential, or an approval timed out. |
| `4`  | License required | The license server rejected the key.            |
| `5`  | Internal failure | An unexpected fault. Worth reporting.           |

A SIGINT exits `130`. A SIGTERM exits `143`.

## Unattended runs

An approval-gated request waits five minutes and then exits `3`. That is correct
for a person at a keyboard and wrong for a build agent. For unattended runs, set:

```bash
PTAH_AUTO_APPROVE=true ptah session start --task "Run the review pass" --once
```

:::caution
`PTAH_AUTO_APPROVE=true` approves every permission request, including file writes
and shell commands. Use it only where you control the prompt and the workspace.
:::

## Three ways to drive it

### One-shot

Run a task, stream the events, exit.

```bash
ptah session start --task "Summarize the auth module" --once --human
```

### Persistent JSON-RPC session

```bash
ptah interact
```

This **blocks**, reading newline-delimited JSON-RPC requests from stdin until EOF
(Ctrl-D) or SIGINT. It is the surface for machine hosts and A2A bridges. For a
one-off human run, prefer `session start --once --human`.

### As an MCP server

```bash
ptah mcp-serve
```

This turns Ptah into a stdio Model Context Protocol server. An external MCP host
— another coding agent, an editor — launches it as a child process and delegates
whole tasks to Ptah's Team Leader through the standard protocol. See
[Driving Ptah via MCP](/mcp-and-skills/driving-ptah-via-mcp/).

## The terminal UI

```bash
ptah tui
```

`tui` launches an interactive terminal interface on top of the same engine. It
needs a real TTY.

## Next steps

- [Command reference](/cli/commands/) — every subcommand group
- [Driving Ptah via MCP](/mcp-and-skills/driving-ptah-via-mcp/)
- [The Ptah CLI provider](/providers/ptah-cli/) — wrapping other CLI agents
