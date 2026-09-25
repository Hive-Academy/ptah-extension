# Research Report - TASK_2026_560

## Question

- Decision this supports: how to implement per-workspace/global on-off enforcement
  for MCP servers, skills and plugins across every session build path (Claude SDK
  direct, proxied, Codex, OpenCode, Antigravity, Ptah CLI, one-shots).
- Question: where is the MCP/skill/plugin set built today per provider, what pin
  mechanism already exists to enforce an explicit subset, and what already exists
  in Ptah for scope resolution, schema-size measurement and Marketplace UI.
- Bounds: no design proposal, no code changes. Copilot/Cursor/GLM/pi-cli adapters
  were located but not read in depth (out of the named provider list).

## Answer

Every non-Claude-SDK path already builds MCP config as `{ ptah: {...} }` only, in
code Ptah owns; the gap is that none of them read an explicit allow/deny list —
they either omit third-party servers entirely (Codex/OpenCode/one-shots, but Codex
still inherits `~/.codex/config.toml`'s own `mcp_servers`/plugins because it never
sets `CODEX_HOME`) or let the CLI's own file resolution decide (Claude SDK direct,
which relies on `.mcp.json` + `enableAllProjectMcpServers`/`enabledMcpjsonServers`
in `.claude/settings*.json`, files Ptah does not read or write). The Claude SDK
`disabledMcpServers` pin mechanism (`sdk-query-options-builder.ts:373-411`) is
already wired end-to-end but only fed from MCP back-off, never from a user
toggle. Skills/plugins already have a full per-workspace enable/disable model
(`PluginLoaderService`, `disabledSkillIds`/`disabledPluginIds`/`enabledPluginIds`)
but it is VS Code `workspaceState`-only (no global scope) and gates only the
harness-sync file copies, not the Claude SDK `skills`/`plugins` options, which
Ptah never populates.

## Evidence

| Claim | Source | Date | Verified how |
|---|---|---|---|
| Claude SDK direct: `buildMcpServers` returns only `{ ptah: {...} }`; other servers reach the session through `.mcp.json`/`.claude/settings*.json` read by the CLI itself via `settingSources` | `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1508-1539` | current HEAD | read |
| `disabledMcpServers` pin mechanism exists: `buildFlagSettings` turns a name list into `disabledMcpjsonServers`/`deniedMcpServers` in the flag-tier `settings` string | `sdk-query-options-builder.ts:373-411` | current | read |
| That pin is fed only from `mcpBackoffService.getBackingOffServers()`, not from any user/workspace toggle | `sdk-query-options-builder.ts:914-920, 956-962` | current | read |
| `settingSources` is `['user','project','local']` when the base URL implies a user-tier style is visible, else `['project','local']` — no `skills`/`plugins`/`strictMcpConfig` set anywhere in this builder | `sdk-query-options-builder.ts:988-992`, grep for `strictMcpConfig`/`plugins?:`/`skills?:` in this file returned 0 hits | current | read + grep |
| SDK type defs confirm `skills?: string[] \| 'all'`, `plugins?: SdkPluginConfig[]`, `strictMcpConfig?: boolean`, `settings.enabledPlugins` exist as real options | `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1939,2174,2200,6964` | installed pkg | read |
| Ptah never passes `skills` or `plugins` to the SDK; `ptah-cli-spawn-options.service.ts` deliberately assembles no `plugins` entry, relying on file copies the harness reconciler writes, because double-loading (bare + `plugin:skill`) breaks unqualified slash commands | `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts:1-17` | current | read |
| Codex lanes: `mcp_servers` set to `{ ptah: {...} }` only; `features.tool_search_always_defer_mcp_tools: false`; no `CODEX_HOME` override, so the process inherits the user's `~/.codex/config.toml` (its own `mcp_servers`, plugins, skills catalog) via `process.env` | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts:592-643` | current | read |
| No `enabled_tools` allowlist or isolated `CODEX_HOME` is set — matches Wave 2 item 2.2 of the prior audit, marked not-yet-shipped | `codex-cli.adapter.ts:592-643` vs `research-report.md` (TASK_2026_557) §Wave 2 item 2 | 2026-09-25 | read + cross-check |
| OpenCode lane: builds an inline `mcp: { ptah: {...} }` JSON string; no read of any global OpenCode config for scoping | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/opencode-cli.adapter.ts:33,534,605-607` | current | read |
| Antigravity lane: writes `~/.gemini/config/mcp_config.json` (a GLOBAL, cross-workspace file) before each spawn via `mcpFacet()`; a prior version "deleted the whole `mcpServers` map once it looked empty" (fixed) | `antigravity-cli.adapter.ts:481-575` | current | read |
| Ptah CLI lanes (`ptah-cli-registry.ts`): `mcpServers: assembly.mcpServers` (from `PtahSpawnAssembly`, itself `{ ptah: {...} }` only) and `settingSources: ['user','project','local']` always | `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:696,787,822` | current | read |
| Background one-shots (curator, sdk-query-runner): `buildOneShotMcpServers` returns `{ ptah: {...} }` only, keyed to `/workspace/{cwd}` not `/session/{id}` | `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:394-398,529-544` | current | read |
| Skills/plugins already have a full per-workspace enable/disable state: `enabledPluginIds`, `disabledSkillIds`, `disabledPluginIds`, `disabledAgentIds`, persisted via VS Code `workspaceState` keyed `ptah.plugins.config`, resolved per explicit `workspaceRoot` | `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:68,683-727,753-796` | current | read |
| That config store has no global/user scope — `storageFor(workspaceRoot)` only resolves VS Code's per-workspace storage; a workspace with no registered storage reads the empty default | `plugin-loader.service.ts:670-714` | current | read |
| `WorkspaceScopeResolver` (settings-core) is a generic global/app/workspace key-hash resolver already used elsewhere in Ptah, with `read`, `write(target: 'global'\|'app'\|'workspace')`, `hasOverride`, `clearMoreSpecific` — a ready-made scope primitive not yet applied to MCP/skills/plugins | `libs/backend/settings-core/src/scope/workspace-scope-resolver.ts:1-283` | current | read |
| `harnessNamespace.listInstalledMcpServers()` reads only `.vscode/mcp.json` and `.mcp.json` in the workspace root — no `~/.claude.json`, no `.claude/settings.json`/`settings.local.json` (`enableAllProjectMcpServers`/`enabledMcpjsonServers`/`disabledMcpjsonServers`), no `~/.codex/config.toml`, no `~/.ptah` | `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts:785-846` | current | read |
| `enableAllProjectMcpServers`/`enabledMcpjsonServers`/`disabledMcpjsonServers` appear nowhere in the repo except as the user-owned `.claude/settings.local.json:2` key Ptah never reads/writes | grep for those 3 identifiers across `libs/` returned 0 hits | current | grep |
| `installed-servers-page.component.ts` already distinguishes a row's `statusSource === 'session'` (live) vs other sources, and `mcpConnectorRows`/`marketplace-inventory.store.ts` are workspace-scoped (`WorkspaceScopeService`, `scope.generation()`) but carry no "global vs workspace config file" scope label | `libs/frontend/marketplace/src/lib/pages/servers/installed-servers-page.component.ts:18-25,97`, `libs/frontend/marketplace/src/lib/data/marketplace-inventory.store.ts:264,361-430` | current | read |
| `ptah_count_tokens` MCP tool exists and calls `ptahAPI.context.countTokens` — a reusable char/token estimator, but for arbitrary file content, not for a live `tools/list` payload | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:44,114,749-756` | current | read |
| No code in `libs/` calls a third-party MCP server's `tools/list` and measures its response size; the 63.0k-char/53-tool figure in the prior audit came from external scripts (`proxy_defer.py`) against recorded proxy transcripts, not from repo code | grep for `tools/list\|listTools\|toolsList\|McpClient` in `libs/` (71 files, none is a generic tools/list-size measurer) + TASK_2026_557 report §RC6, §5 | 2026-09-25 | grep + cross-check |

## Options

Not applicable in the usual sense — this report answers "what exists," not "which
of several designs to pick." Below are the reusable primitives found, with fit.

| Option | Fit here | Cost to adopt | Known failure mode |
|---|---|---|---|
| Reuse `WorkspaceScopeResolver` (global/app/workspace) for the new MCP/skill/plugin toggle setting | Exact match for requirement 2's "workspace override never changes the global entry" — it already separates write targets and has `clearMoreSpecific` for override precedence | Needs a new settings-core schema entry + repository (pattern already followed by `cli-subagent-settings.ts` etc.) | None observed; it is unused by MCP/plugins today, so no migration risk |
| Feed `disabledMcpServers` (already wired at `sdk-query-options-builder.ts:373-411,956-962`) from the new toggle instead of only from `mcpBackoffService` | Lowest-cost enforcement point for the Claude SDK direct/proxied path — no new plumbing, just a second source merged into the same array | Must union backoff-disabled + user-disabled without losing either list | If the union is wrong, a user-enabled server that is mid-backoff could re-appear, or a healthy server the user disabled could stay listed by CLI-side `.mcp.json` resolution if `settingSources` still exposes it |
| Extend `PluginLoaderService`'s `disabledSkillIds`/`disabledPluginIds` model with a global scope (today workspace-only via `workspaceState`) | Skill/plugin per-workspace toggle already exists; only the global tier is missing | Needs a second storage tier (VS Code `globalState` or `~/.ptah/settings.json`) and precedence merge, mirroring `WorkspaceScopeResolver` | This config only drives harness-sync file copies today — does not touch the Claude SDK `skills`/`plugins` options, so "enforced for every session build path" for skills additionally needs a second wire into `sdk-query-options-builder.ts`/spawn options |
| Extend `harnessNamespace.listInstalledMcpServers()` to also read `~/.claude.json`, `.claude/settings.json`/`settings.local.json`, `~/.codex/config.toml`, `~/.ptah` | Needed for requirement 2 ("clear distinction between global and workspace servers... UI shows the source") | Moderate — several file formats (JSON vs TOML), several precedence rules to encode (`enableAllProjectMcpServers` overriding `enabledMcpjsonServers`, already true in the user's own `.claude/settings.local.json`) | Getting Claude Code's own precedence wrong would show the UI as authoritative when the CLI actually computes something else |

## Disagreements

- None found between sources — all evidence is first-party (repo code and
  installed `sdk.d.ts`), and the prior audit report (RC6, Wave 2 items 2.1-2.2)
  matches the current code exactly except that 2.1 (Claude SDK `disabledMcpServers`
  for proxies) and 2.2 (Codex `enabled_tools`/isolated `CODEX_HOME`) are described
  there as recommendations, and this read confirms neither has shipped yet.

## Local consequences

- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:373-411,914-962`: the `disabledMcpServers` parameter is the mechanism to reuse for Claude SDK direct and proxied enforcement; it needs a second input source (user/workspace toggle) merged with `backingOffServers`.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts:592-643`: `runSdk` has no allowlist and no `CODEX_HOME` isolation; enforcing "ptah on by default, does not depend on user files" for Codex lanes requires either an `enabled_tools` config key or spawning with an isolated `CODEX_HOME` that Ptah controls.
- `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:670-796`: the skill/plugin toggle model is workspace-only; a global tier must be added, and its consumers (harness-sync copy step, not yet located in this pass) must be identified so a toggle actually removes a skill/plugin from what gets copied into `.claude/skills`/`.claude/agents` etc.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts:785-846`: `listInstalledMcpServers` is the natural extension point for reading `~/.claude.json`/`~/.codex/config.toml`/`~/.ptah`/`.claude/settings*.json`, currently reads only `.vscode/mcp.json` and `.mcp.json`.
- `libs/frontend/marketplace/src/lib/pages/servers/installed-servers-page.component.ts` and `libs/frontend/marketplace/src/lib/data/marketplace-inventory.store.ts`: already workspace-scoped and already have a `source`/`statusSource` concept to extend with a global-vs-workspace label and a toggle write target, per task.md's anchor.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts:44,114,749-756`: `ptah_count_tokens`/`formatTokenCount` is a reusable char/token estimator for a fetched `tools/list` payload once one is obtained; it does not fetch that payload itself.

## Unknowns

- Where exactly the harness-sync reconciler reads `PluginLoaderService`'s
  `disabledSkillIds`/`disabledPluginIds` to decide what gets copied into
  `.claude/skills`, `.claude/agents`, etc. was not located in this pass (only the
  writer/reader of the config state was confirmed) — needed to know whether the
  existing per-workspace skill toggle already reaches Ptah CLI lanes, or only the
  Marketplace/harness UI.
- Whether Codex SDK lanes (`@openai/codex-sdk`, used via `runSdk`) read
  `~/.codex/config.toml` at all, versus only the native `codex` CLI binary path —
  the prior audit's "open question" (§6.2) is not settled by this read; `runSdk`
  passes `env: { ...process.env }` unchanged, which is consistent with either
  answer.
- No live mechanism to fetch a third-party MCP server's `tools/list` and measure
  its size was found; whether to build one (a session-scoped MCP client call) or
  read it from an already-connected session's cached tool list was not resolved —
  needs a decision on where such a probe would run (backend service vs. inside an
  active session) and how it avoids doubling as another connection attempt against
  flaky servers.
- Antigravity's `~/.gemini/config/mcp_config.json` is a single global file
  rewritten "before each spawn" (`antigravity-cli.adapter.ts:481-575`); whether it
  currently merges with or replaces third-party entries the user configured
  outside Ptah was not traced past the empty-map bug-fix comment, and matters for
  whether a per-workspace pin can coexist with a shared global file across
  concurrent workspaces.
