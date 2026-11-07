---
title: Ptah Tools
description: The groups of ptah_* tools that the built-in MCP server gives to agents.
---

The [built-in MCP server](/mcp-and-skills/built-in-mcp-server/) gives agents a set of `ptah_*` tools. Agents read the full description and arguments of each tool from the server. This page shows the tool groups.

## Workspace and search

| Tool                     | What it does                                                   |
| ------------------------ | -------------------------------------------------------------- |
| `ptah_workspace_analyze` | Returns the project type, frameworks, and structure            |
| `ptah_search_files`      | Finds files by glob pattern                                    |
| `ptah_get_diagnostics`   | Returns errors and warnings. Pass `files` to make it faster    |
| `ptah_count_tokens`      | Counts the tokens of a file                                    |
| `ptah_web_search`        | Searches the web                                               |

## IDE / LSP

`ptah_lsp_references`, `ptah_lsp_definitions`, `ptah_get_dirty_files`.

## Code index

`ptah_code_search_symbols`, `ptah_code_reindex`, `ptah_ast_analyze`, `ptah_context_enrich_file`, `ptah_get_dependents`, `ptah_get_dependencies`, `ptah_get_symbol_index`, `ptah_relevance_rank_files`, `ptah_project_detect_monorepo`, `ptah_memory_search`.

## CLI agents

Tools to start, watch, message, and stop CLI agent lanes: `ptah_agent_list`, `ptah_agent_spawn`, `ptah_agent_status`, `ptah_agent_wait`, `ptah_agent_read`, `ptah_agent_message`, `ptah_agent_message_status`, `ptah_agent_report`, `ptah_agent_stop`. This group also has `ptah_run_check` and the `ptah_session_*` tools.

The [agent-lanes skill](/mcp-and-skills/skills/#skill-dependencies) defines how the orchestration skills use these tools.

## Git worktrees

`ptah_git_worktree_add`, `ptah_git_worktree_list`, `ptah_git_worktree_remove`.

## Browser

The `ptah_browser_*` tools. See [Browser Automation](/browser-automation/).

## Tasks

`ptah_task_create`, `ptah_task_update`, `ptah_task_get`, `ptah_task_list`, `ptah_task_check`.

## Harness

| Tool                               | What it does                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| `ptah_harness_search_skills`       | Searches local plugin skills and the skills.sh marketplace                       |
| `ptah_harness_create_skill`        | Creates a skill as its own `ptah-harness-<name>` plugin                          |
| `ptah_harness_search_mcp_registry` | Searches the official MCP registry, and Smithery when a Smithery API key is set  |
| `ptah_harness_list_installed_mcp`  | Lists the MCP servers in `.vscode/mcp.json` and `.mcp.json` of the workspace     |
| `ptah_harness_install_mcp_server`  | Writes the config of an MCP server to the target config files                    |
| `ptah_harness_propose_config`      | Sends a proposed harness config to the user for review                           |

`ptah_harness_create_skill` takes a `scope`:

| `scope`               | Written to                  | Loads in                       |
| --------------------- | --------------------------- | ------------------------------ |
| `workspace` (default) | `{workspace}/.ptah/plugins` | This project only              |
| `user`                | `~/.ptah/plugins`           | All workspaces on this machine |

The two scopes use the same plugin ID, so you cannot use the same name in both. See [Harness plugins](/plugins/harness-plugins/).

## Code execution

| Tool              | What it does                                       |
| ----------------- | -------------------------------------------------- |
| `execute_code`    | Runs code that uses the `ptah` API                 |
| `approval_prompt` | Asks the user for approval of a tool call          |

## Turn groups on or off

In **Settings → Advanced → MCP & Browser**, you can turn off these groups: Browser Automation, CLI Agents, Git Worktree, IDE / LSP, and JSON Validation (`ptah_json_validate`).
