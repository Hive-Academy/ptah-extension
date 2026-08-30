---
title: Ptah Tools
description: Catalog of ptah_* tools exposed by the built-in MCP server.
---

The built-in MCP server exposes a curated family of `ptah_*` tools. This page is the quick-reference catalog — grouped by purpose, with the "when to use" for each.

## Workspace intelligence

| Tool                     | Purpose                                                                                               | Typical use case                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `ptah_workspace_analyze` | Produce a structured analysis of the active workspace (frameworks, entry points, build system, tests) | "What kind of project is this?" at the start of a new session |
| `ptah_search_files`      | Fast file search across the workspace with glob + content filters                                     | Locate files by name or content without shelling out          |
| `ptah_get_diagnostics`   | Pull current diagnostics (TS errors, linter warnings). Pass `files` to scope it                       | "What's broken right now?" before proposing fixes             |
| `ptah_get_dirty_files`   | List unsaved or modified files                                                                        | Sync model context with the user's in-flight edits            |
| `ptah_count_tokens`      | Count tokens for a string or file against the active model's tokenizer                                | Budget prompt size before a large call                        |

## Code navigation (LSP-backed)

| Tool                   | Purpose                         | Typical use case                           |
| ---------------------- | ------------------------------- | ------------------------------------------ |
| `ptah_lsp_references`  | Find all references to a symbol | Refactoring impact analysis                |
| `ptah_lsp_definitions` | Jump to a symbol's definition   | Trace where a function or type is declared |

## Web & search

| Tool              | Purpose                                      | Typical use case                          |
| ----------------- | -------------------------------------------- | ----------------------------------------- |
| `ptah_web_search` | Query the web through Ptah's search provider | "What's the current best practice for X?" |

## Browser automation

A Playwright-backed browser the model can drive. Useful for scraping docs, verifying live pages, or end-to-end testing.

| Tool                                                     | Purpose                                  | Typical use case                          |
| -------------------------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| `ptah_browser_navigate`                                  | Open a URL in the managed browser        | Start a browsing session                  |
| `ptah_browser_content`                                   | Extract the page's rendered text or HTML | Read documentation, forum posts           |
| `ptah_browser_click`                                     | Click an element by selector or text     | Drive a UI to a specific state            |
| `ptah_browser_type`                                      | Type into an input                       | Fill forms, search boxes                  |
| `ptah_browser_screenshot`                                | Capture a screenshot                     | Visual debugging, design review           |
| `ptah_browser_evaluate`                                  | Run JavaScript in page context           | Read computed values, inspect the DOM     |
| `ptah_browser_network`                                   | Inspect recent network requests          | Debug API calls                           |
| `ptah_browser_record_start` / `ptah_browser_record_stop` | Record a browser session to video        | Produce repro clips for bugs              |
| `ptah_browser_status`                                    | Query browser state                      | Check whether a page has finished loading |
| `ptah_browser_close`                                     | Close the browser                        | Release resources                         |

See [Browser Automation](/browser-automation/) for the full workflow.

## Agent orchestration

Spawn, monitor, and control sub-agents from within a session.

| Tool                | Purpose                                          | Typical use case                                        |
| ------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| `ptah_agent_list`   | List available agents                            | Discover which specialists are installed                |
| `ptah_agent_read`   | Read an agent's definition                       | Inspect the prompt before spawning                      |
| `ptah_agent_spawn`  | Spawn a sub-agent with a task                    | Parallelize multi-file work or delegate to a specialist |
| `ptah_agent_status` | Check a running agent's status                   | Poll for completion                                     |
| `ptah_agent_steer`  | Send a mid-flight instruction to a running agent | Nudge a long-running task                               |
| `ptah_agent_stop`   | Terminate a running agent                        | Abort runaway work                                      |

:::tip
Best practice: cap concurrent `ptah_agent_spawn` at **3** to avoid token-budget churn.
:::

## Git worktree management

Keep experiments isolated without cluttering your main checkout.

| Tool                       | Purpose                            | Typical use case                           |
| -------------------------- | ---------------------------------- | ------------------------------------------ |
| `ptah_git_worktree_add`    | Create a new worktree for a branch | Spin up an isolated sandbox for a refactor |
| `ptah_git_worktree_list`   | List existing worktrees            | Audit active experiments                   |
| `ptah_git_worktree_remove` | Remove a worktree                  | Clean up after merging                     |

## Validation & harness

| Tool                               | Purpose                                                                                                                                                 | Typical use case                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `ptah_json_validate`               | Validate JSON against a schema                                                                                                                          | Check config files before writing        |
| `ptah_harness_create_skill`        | Create a new skill as its own plugin at `~/.ptah/plugins/ptah-harness-<slug>/skills/<slug>/SKILL.md` — see [Harness plugins](/plugins/harness-plugins/) | Capture a reusable workflow on the fly   |
| `ptah_harness_search_skills`       | Search local plugin skills and the skills.sh marketplace by keyword                                                                                     | Find a skill by intent rather than name  |
| `ptah_harness_search_mcp_registry` | Search the official MCP registry, PulseMCP and Smithery                                                                                                 | Discover third-party tools to plug in    |
| `ptah_harness_list_installed_mcp`  | List every MCP server configured in the harness                                                                                                         | Audit what's connected                   |
| `ptah_harness_install_mcp_server`  | Write a server's transport config into the target config files                                                                                          | Add a discovered server to the workspace |
| `ptah_harness_propose_config`      | Hand a partial harness config to the surface for the user to review                                                                                     | Finish a harness build for approval      |

### Reading a harness search result

Both searches return three states, not two:

| `status`   | Meaning                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------- |
| `ok`       | Every source answered. An empty list means the catalogue genuinely has nothing.              |
| `degraded` | At least one source failed. The list is incomplete and the tool call is flagged as an error. |

The per-source detail is in `sources`: `[{ source, status, count, error? }]`, where a source's
`status` is `ok`, `unavailable` (not configured on this machine) or `failed`. An empty result is
only a true negative while the top-level `status` is `ok`.

`limit` on `ptah_harness_search_mcp_registry` bounds the **merged** list. Results are drawn
round-robin across the three registries, so raising the limit never lets one source crowd out
the others.

### Paging skill search

`ptah_harness_search_skills` takes `limit` and `offset`, which page the **skills.sh** half —
local plugin results are a complete on-disk inventory and are never paged. The result echoes
the window and adds:

- `hasMore` — fetch the next page with `offset += limit`.
- `total` — present **only** when the whole marketplace result set was seen. It is never estimated.
- `limitedByUpstream` (on the `skills.sh` source entry) — the marketplace caps a single query at
  200 rows. Past that no further page exists; narrow the query instead.

### Skill scope

`ptah_harness_create_skill` takes `scope`:

| `scope`          | Written to                  | Loads in                                                   |
| ---------------- | --------------------------- | ---------------------------------------------------------- |
| `user` (default) | `~/.ptah/plugins`           | every workspace on this machine                            |
| `workspace`      | `{workspace}/.ptah/plugins` | this project only — commit it and it travels with the repo |

A workspace-scoped skill sits beside `.ptah/specs`, so it can be checked in and shared with the
team. Both scopes produce the same plugin id, so the same name cannot be used in both — the call
is refused rather than letting the workspace copy silently shadow the global one.

## Code Execution

| Tool              | Purpose                                                               | Typical use case                                    |
| ----------------- | --------------------------------------------------------------------- | --------------------------------------------------- |
| `execute_code`    | Run code in the sandboxed runtime with scoped file and network access | Transform data, verify a snippet, run quick scripts |
| `approval_prompt` | Request explicit user approval mid-execution                          | Gate side-effectful steps                           |

## Next steps

- [Understand skills](/mcp-and-skills/skills/)
- [Connect third-party MCP servers](/mcp-and-skills/third-party-mcp/)
