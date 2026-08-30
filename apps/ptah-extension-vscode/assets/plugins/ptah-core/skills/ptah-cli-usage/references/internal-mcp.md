# Ptah's built-in MCP tool surface (`ptah_*`)

Covers the in-process MCP server that internal sub-agents and the runtime
self-introspection layer hit, the namespace toggles that shape it, and
the full tool catalog.

Source of truth:
`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`
(`handleToolsList`). Tool schemas live in
`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`.

---

## 1. Tool count

**51 tools with every namespace enabled.**

Namespaces can be disabled: adding a namespace key to the
`ptah.agentOrchestration.disabledMcpNamespaces` setting (a string array,
also settable with `ptah agent-cli config set --key disabledMcpNamespaces
--value <csv>`) drops that entire group from `tools/list`.

The `ide` group (3 tools) additionally requires `hasIDECapabilities ===
true`, set by the host adapter. It is **absent outside an IDE host**, so
a headless `ptah mcp-serve` or an Electron host advertises **48**.

| Namespace key | Toggle value                         | Tools | Extra requirement    |
| ------------- | ------------------------------------ | ----- | -------------------- |
| _(always-on)_ | — (cannot be disabled)               | 12    | —                    |
| `ide`         | `disabledMcpNamespaces: ['ide']`     | 3     | `hasIDECapabilities` |
| `agent`       | `disabledMcpNamespaces: ['agent']`   | 6     | —                    |
| `git`         | `disabledMcpNamespaces: ['git']`     | 3     | —                    |
| `json`        | `disabledMcpNamespaces: ['json']`    | 1     | —                    |
| `browser`     | `disabledMcpNamespaces: ['browser']` | 11    | —                    |
| `harness`     | `disabledMcpNamespaces: ['harness']` | 6     | —                    |
| `code`        | `disabledMcpNamespaces: ['code']`    | 9     | —                    |

12 + 3 + 6 + 3 + 1 + 11 + 6 + 9 = **51**.

---

## 2. Always-on tools (12)

Deliberately not wrapped in a namespace guard.

| Name                     | Returns                                          |
| ------------------------ | ------------------------------------------------ |
| `ptah_workspace_analyze` | Workspace metadata + structure overview.         |
| `ptah_search_files`      | Path list of matching files (glob + content).    |
| `ptah_get_diagnostics`   | Diagnostics via the `IDiagnosticsProvider` port. |
| `ptah_count_tokens`      | Token-count estimate for given text/files.       |
| `ptah_web_search`        | Web-search result set (provider-routed).         |
| `execute_code`           | Bash / shell execution result.                   |
| `approval_prompt`        | Permission-prompt round trip.                    |
| `ptah_task_create`       | New `.ptah/specs/` task carrier.                 |
| `ptah_task_update`       | Updated task carrier.                            |
| `ptah_task_get`          | One task carrier.                                |
| `ptah_task_list`         | Task carriers matching a filter.                 |
| `ptah_task_check`        | Validation result for a task carrier.            |

The five `ptah_task_*` tools sit in the core set on purpose: an agent
that cannot rely on them being present falls back to hand-writing task
metadata, which is exactly the failure that makes task folders vanish
from the board. There is no `set_section` tool — the carrier is
machine-owned metadata and prose is agent-owned.

---

## 3. `ide` namespace (3)

Absent unless the host reports IDE capabilities.

| Name                   | Returns                                         |
| ---------------------- | ----------------------------------------------- |
| `ptah_lsp_references`  | LSP references at a position.                   |
| `ptah_lsp_definitions` | LSP definitions at a position.                  |
| `ptah_get_dirty_files` | List of files with unsaved edits in the editor. |

---

## 4. `agent` namespace (6)

| Name                | Returns                                         |
| ------------------- | ----------------------------------------------- |
| `ptah_agent_spawn`  | `SpawnAgentResult { agentId, cli, status, … }`. |
| `ptah_agent_status` | `AgentProcessInfo` (or array of all agents).    |
| `ptah_agent_read`   | Buffered stdout/stderr + exit code if finished. |
| `ptah_agent_steer`  | Push a steering message to a running agent.     |
| `ptah_agent_stop`   | Final `AgentProcessInfo` after termination.     |
| `ptah_agent_list`   | Detected CLIs + configured Ptah CLI agents.     |

`ptah_agent_list` is how an agent DISCOVERS the available CLI vendors.
Never hardcode a roster.

---

## 5. `git` namespace (3)

| Name                       | Returns                          |
| -------------------------- | -------------------------------- |
| `ptah_git_worktree_list`   | List of git worktrees.           |
| `ptah_git_worktree_add`    | Result of `git worktree add`.    |
| `ptah_git_worktree_remove` | Result of `git worktree remove`. |

---

## 6. `json` namespace (1)

| Name                 | Returns                                 |
| -------------------- | --------------------------------------- |
| `ptah_json_validate` | Schema validation result + diagnostics. |

---

## 7. `browser` namespace (11)

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

---

## 8. `harness` namespace (6)

| Name                               | Returns                                          |
| ---------------------------------- | ------------------------------------------------ |
| `ptah_harness_search_skills`       | Matching skills from the harness skill registry. |
| `ptah_harness_create_skill`        | Newly created skill descriptor.                  |
| `ptah_harness_search_mcp_registry` | Matching MCP servers from the registry.          |
| `ptah_harness_list_installed_mcp`  | Installed MCP servers in the workspace.          |
| `ptah_harness_install_mcp_server`  | Install result for one MCP server.               |
| `ptah_harness_propose_config`      | A proposed harness configuration.                |

---

## 9. `code` namespace (9)

| Name                           | Returns                                     |
| ------------------------------ | ------------------------------------------- |
| `ptah_ast_analyze`             | Tree-sitter structure of one JS/TS file.    |
| `ptah_context_enrich_file`     | `.d.ts`-style structural summary of a file. |
| `ptah_get_dependents`          | Files that depend on the target.            |
| `ptah_get_dependencies`        | Files the target depends on.                |
| `ptah_get_symbol_index`        | Symbol index for the workspace.             |
| `ptah_code_search_symbols`     | Hybrid BM25 + vector symbol search.         |
| `ptah_memory_search`           | Hybrid search over persistent memory.       |
| `ptah_relevance_rank_files`    | Files ranked by relevance to a query.       |
| `ptah_project_detect_monorepo` | Monorepo layout detection result.           |

`ast_analyze`, `context_enrich_file`, `get_dependencies`,
`relevance_rank_files` and `project_detect_monorepo` work on every
runtime. `code_search_symbols` and `memory_search` are backed by the
SQLite index and return a graceful "unavailable" result where that index
is absent (for example inside VS Code) — fall back to
`ptah_search_files` there.

---

## 10. Eager vs deferred

Some tools are marked always-eager so they load on every runtime instead
of sitting behind the SDK's built-in tool-search tool (`markEagerTools` /
`ALWAYS_EAGER_TOOLS` in `protocol-dispatcher.ts`). This affects
discoverability, not availability — a deferred tool is still callable
once its schema is fetched.

---

## 11. Relationship to `mcp-serve`

This catalog is the **internal** surface. `ptah mcp-serve` advertises a
narrower, separately-defined MVP set to external MCP hosts with the
`ptah_` prefix dropped — see `references/mcp-serve.md`.
