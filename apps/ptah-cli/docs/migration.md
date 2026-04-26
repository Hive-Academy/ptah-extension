# Migration Guide — Ptah CLI

This guide covers migrations for users upgrading from earlier `ptah` releases — primarily the legacy React/Ink TUI shell and the deprecated `ptah run` and `ptah profile` surfaces.

## From the React/Ink TUI

Earlier `ptah` releases (Batches 1-3 of `TASK_2026_104`, distributed under `apps/ptah-tui`) shipped an Ink/React-based interactive terminal UI. Running plain `ptah` opened a colorful TUI with text-input widgets, spinners, and a live agent stream rendered through `marked-terminal` and `cli-highlight`. That UI has been deleted.

The CLI is now headless. The default action of running `ptah` with no subcommand is to print `--help`. If you previously typed:

```bash
# Old (TUI):
ptah                    # dropped into an interactive Ink session
```

Use one of the new entry points:

```bash
# New — for a single one-off task:
ptah session start --task "explain this repo"

# New — for a persistent bidirectional A2A session over JSON-RPC 2.0 stdio:
ptah interact --session main

# New — for the multi-phase setup wizard:
ptah setup --human
```

The TUI's React shell, hooks, contexts, themes, and `marked-terminal` / `cli-highlight` rendering are all removed. The bundle is ~2 MB smaller. There is no opt-in for the legacy TUI — it is gone. If you depended on Ink-rendered output for human consumption, use `--human` mode (pretty-prints events with colors and indentation) or pipe the JSON-RPC NDJSON output through your own formatter.

## `ptah run` → `ptah session start`

`ptah run` is now a deprecation alias. It prints a single-line stderr deprecation notice, delegates to `executeSessionStart`, and will be removed in the next minor release.

```bash
# Old:
ptah run --task "..."

# New (preferred):
ptah session start --task "..."

# New — multi-turn session:
ptah session start --profile claude_code --task "fix the failing test"
ptah session resume <session-id> --task "now add a regression test"
ptah session send <session-id> --task "and update the README"
```

`session start` is a strict superset of `run`. It supports `--profile`, `--once`, `--scope`, and synthesizes a `tabId` you can pass to `session resume` / `session send` / `session stop` / `session delete`.

## `ptah profile *` → `ptah agent *`

The `profile` surface (`profile apply`, `profile list`) was kept as a one-release deprecation shim in B7 and is deleted in B11. Use the `agent` surface instead.

```bash
# Old:
ptah profile apply senior-tester
ptah profile list

# New:
ptah agent apply senior-tester
ptah agent list
```

The `agent` surface is broader — it also covers agent packs:

```bash
ptah agent packs list
ptah agent packs install web-app-essentials
```

`agent apply <name>` writes the named agent template into `.ptah/agents/<name>.md` and is idempotent (emits `agent.applied` with `changed: false` when the file content is identical). `agent list` is a pure `fs.readdir` of `.ptah/agents/` with no DI bootstrap.

The agent template registry resolves through `ContentDownloadService.getPluginsPath()` — the same `~/.ptah/plugins/` path the VS Code and Electron apps use. Agent packs install through the shared `wizard:install-pack-agents` RPC.

## Phase 1 vs Phase 2

This release is **Phase 1** — JSON-RPC 2.0 over stdio. The full backend RPC handler graph (~94 methods) is reachable through ~20 first-class commands and ~70 sub-subcommands. No HTTP, no proxy, no remote transport.

**Phase 2** (deferred, no timeline commitment) will add:

- An Anthropic-compatible HTTP proxy (`ptah config proxy --port N`) for remote / containerized deployments.
- MCP server passthrough through the HTTP proxy.
- NemoClaw Docker bootstrap scripts (handled outside the CLI binary).
- Extended notification clusters (e.g. `setup.phase.start` / `setup.phase.complete` as discrete events, granular `mcp.install.*` / `skill.install.*` sub-events, `wizard.recommendations`, `wizard.cancelled`, `wizard.retry.*`, `analyze.cancelled`, `debug.rpc.routing`, `debug.cli_agent.spawn`).
- `harness.chat.*` as a dedicated cluster (today, `harness chat` aliases `session start --scope harness-skill` and emits `agent.*`).

Phase 1 commands and notifications listed in [`jsonrpc-schema.md`](jsonrpc-schema.md) are stable. Phase 2 additions will be additive and version-gated through the `session.ready` `capabilities` array.

## Breaking changes

- **TUI removed.** No interactive Ink/React shell. `ptah` with no subcommand prints help.
- **`profile` command removed.** Use `agent apply` / `agent list` / `agent packs *`.
- **React/Ink dependency tree removed.** `react`, `ink`, `@inkjs/ui`, `ink-text-input`, `ink-select-input`, `ink-spinner`, `marked-terminal`, `cli-highlight`, `react-devtools-core`, and `@types/react` are gone from the workspace `package.json`. If you imported `apps/ptah-cli` from another package (you shouldn't have — it's an `apps/` workspace, not a published lib), those imports break.
- **TUI-only subcommands removed.** Anything that lived under `src/components/`, `src/hooks/`, `src/context/`, `src/lib/themes.ts`, `src/lib/diff-parser.ts` is deleted.
- **Webview-only RPCs explicitly excluded.** `editor:*`, `file:open|pick|read|exists|save-dialog`, `command:execute`, `layout:*`, `terminal:*`, `setup-wizard:launch`, `llm:listVsCodeModels` are not reachable from the CLI by design — CLI users have a real terminal, a real editor, and a real file picker.

## Compatibility additions

- **New exit codes.** `4` (license required), `130` (SIGINT), `143` (SIGTERM) are explicit. Existing `0` / `1` / `2` / `3` / `5` are preserved.
- **New global flags.** `--profile <id>`, `--out <path>`, `--in <path>`, `--target <cli>`. See [`../README.md#global-flags`](../README.md#global-flags) for the full list.
- **New env var.** `PTAH_AUTO_APPROVE` — set to `'true'` to behave as if `--auto-approve` were passed. Useful in CI. Existing `PTAH_CONFIG_PATH`, `PTAH_LOG_LEVEL`, `PTAH_NO_TTY`, `PTAH_DI_LAZY`, `NO_COLOR`, `FORCE_COLOR` are preserved.
- **CLI agent allowlist.** `agent-cli stop` and `agent-cli resume` only accept `--cli glm` and `--cli gemini`. `copilot` and `cursor` are blocked at the command entry-point and cannot be bypassed via `PTAH_AGENT_CLI_OVERRIDE` (the env var is documented but ignored — the check is hard-coded).
- **JSON-RPC 2.0 strict mode.** Every notification, request, and response conforms to JSON-RPC 2.0. Stdout is reserved for protocol messages; logger output goes to stderr only.

## See also

- [`../README.md`](../README.md) — full command reference, global flags, env vars, exit codes, troubleshooting.
- [`jsonrpc-schema.md`](jsonrpc-schema.md) — every notification, outbound request, inbound request, and error code with payload examples.
- [`../CLAUDE.md`](../CLAUDE.md) — engineering details (DI tokens, `withEngine` bootstrap modes, bridge primitives).
