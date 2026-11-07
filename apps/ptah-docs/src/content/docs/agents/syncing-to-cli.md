---
title: Syncing Agents to CLIs
description: How PtahCode copies your agents, skills, commands, and MCP servers into other CLIs.
---

# Syncing Agents to CLIs

PtahCode copies your agents, skills, commands, and MCP servers into the folders that each CLI reads. The same agents are then available when PtahCode runs that CLI as a lane, and when you run the CLI yourself.

## When sync runs

PtahCode reconciles the harness folders when it activates a workspace. Each copy is owned by a manifest. PtahCode updates or removes only the files that it wrote.

## Targets

| Target      | Skills                  | Commands                | Agents                           | MCP servers                        |
| ----------- | ----------------------- | ----------------------- | -------------------------------- | ---------------------------------- |
| Codex       | `{ws}/.agents/skills`   | not supported           | `{ws}/.codex/agents/*.toml`      | `~/.codex/config.toml`             |
| Copilot     | `{ws}/.github/skills`   | not supported           | `{ws}/.github/agents/*.agent.md` | `~/.copilot/mcp-config.json`       |
| Cursor      | `{ws}/.cursor/skills`   | `{ws}/.cursor/commands` | `{ws}/.cursor/agents/*.md`       | `{ws}/.cursor/mcp.json`            |
| Antigravity | `{ws}/.agents/skills`   | not supported           | not supported                    | `~/.gemini/config/mcp_config.json` |
| OpenCode    | not supported           | not supported           | `{ws}/.opencode/agent/*.md`      | `{ws}/opencode.json`               |

`{ws}` is the workspace root. A "not supported" cell is a facet that the CLI does not read from the workspace.

## Agent format

Each CLI expects a different agent format. PtahCode converts each agent file for the target, for example to TOML for Codex.

## Git ignore

When `harness.manageGitignore` is `true` (the default), PtahCode adds the copied harness files to `.gitignore`. PtahCode does not ignore MCP config files.

## Troubleshooting

| Symptom                        | Fix                                                             |
| ------------------------------ | --------------------------------------------------------------- |
| An agent is absent in a CLI    | Make sure that the CLI supports agents. Refer to the table above. |
| A copied file is out of date   | Open the workspace again so that PtahCode reconciles the folders. |
