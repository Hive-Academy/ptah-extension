# Requirements - TASK_2026_560_2ae5

## Context

The Marketplace "Installed servers" page lists MCP servers with a status pill and the config file paths each one comes from
(`libs/frontend/marketplace/src/lib/pages/servers/installed-servers-page.component.ts:39-42`,
`server-detail.component.html:335-363`). It has no on/off control, it does not say whether a server is global (user scope:
`~/.claude.json`, `~/.codex/config.toml`, `~/.ptah`) or workspace (`.mcp.json`, `.claude/settings*.json`), and it shows no cost.
The only way to turn a server off today is to hand-edit those files. In this repository `.claude/settings.local.json:2` sets
`enableAllProjectMcpServers: true`, which overrides `enabledMcpjsonServers: ["ptah"]`, so firecrawl, davinci-resolve, ptah and
shopify-dev-mcp all load (research report TASK_2026_557_tokaudit, RC6 and Wave 0 item 0.5).

The cost is measured. Proxied sessions (custom base URL) lose Claude Code tool deferral (40/40 streams), so every request carries
every schema: davinci-resolve about 28k, ptah about 15.9k, firecrawl about 13k, shopify about 8.5k tokens. The first request is
83.5k tokens, about 49k of it unused servers (RC6; Wave 2 item 2.1). Codex lanes inherit 12 desktop plugins and a 17.9k-char skills
catalog from the global Codex config (RC6; Wave 2 item 2.2). Some plumbing exists: the Claude SDK flag tier can already deny
servers by name (`libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:373-410`, used today only by the failure
back-off in `mcp-server-backoff.service.ts:16`), and plugins and skills already have a per-workspace `PluginConfigState`
(`libs/shared/src/lib/types/rpc/rpc-misc.types.ts:482-500`: `enabledPluginIds`, `disabledSkillIds`, plugin denylist).

The user asked for five things: per-workspace on/off for each MCP server; a visible global-versus-workspace distinction where a
workspace override never changes the global entry; the same on/off for skills and plugins; enforcement of the effective set by
Ptah at every session build, with ptah on by default and independent of user files; and the schema-size token cost of each
enabled server. This matters because it is the user-controlled half of the token fix: the audit's Wave 0 item 0.5 asks the user
to hand-edit a file, and this task replaces that with a Ptah setting that Ptah enforces.

## Classification

- Type: FEATURE — adds a setting contract, UI controls and enforcement that do not exist today.
- Estimate: L — it spans `libs/shared`, the Marketplace UI, the Claude SDK option builder and four CLI-lane adapters, plus e2e
  specs; the 100-file PR cap is the binding constraint on size.
- Priority: not defined here.

## Scope

In scope:

- A shared (`libs/shared`) contract for per-scope on/off state of MCP servers, skills and plugins, and for the resolved effective
  set with the source scope of each entry.
- Marketplace controls: scope label, per-workspace toggle and scope-of-write indicator for servers, skills and plugins; schema-size
  figure per enabled server.
- Resolution of the effective set (global state, workspace override, ptah default) independent of user settings files.
- Enforcement at every session build path: Claude SDK direct, Claude SDK proxied (custom base URL), Codex, OpenCode, Antigravity,
  Ptah CLI lanes.
- A consumable statement of the effective set that TASK_2026_559_8ca9 can read for per-caller profiles (see Dependencies).

Out of scope:

- Editing `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` (handleToolsList, per-caller tool
  profiles) — owned by TASK_2026_559_8ca9. This task only publishes the contract 559 consumes.
- Toggling individual tools inside a server (a tool-level allowlist) — belongs to TASK_2026_559_8ca9's profiles.
- Writing to or rewriting user-owned files (`.claude/settings.local.json`, `.mcp.json`, `~/.claude.json`, `~/.codex/config.toml`)
  to achieve enforcement — the requirement is that enforcement does not depend on them; the user may still edit them.
- The other audit fixes (Codex compaction and output limits, effort precedence, result budgets, prompt trimming, isolated
  `CODEX_HOME`) — tracked in the research report's other waves.
- Installing, uninstalling or adding servers — the Marketplace already does this; unchanged here.
- Migrating existing `PluginConfigState` data to a new shape — existing configs must keep loading (see NFR).

## Dependencies

- TASK_2026_559_8ca9 consumes the effective-set contract from `libs/shared` to pick tools per caller. This task must land the
  contract (type and how to read it) without depending on 559; 559 depends on this task, not the reverse.

## Requirements

### 1. Per-workspace on/off for MCP servers

Requirement: a workspace user can turn each discovered MCP server on or off for the current workspace from the Marketplace, and
the choice persists in Ptah's own settings.

Acceptance criteria:

1. AC-1.1 When the user toggles a server off on the Installed servers page (or its detail view), the system shall persist the
   choice for the current workspace and show the server as off after a reload of the webview and after an app restart.
2. AC-1.2 When a server is off in workspace A, the system shall show it with its unchanged state in workspace B.
3. AC-1.3 When the user toggles a server back on, the system shall remove the workspace override so the server follows its
   global state again, and the UI shall show that it is inheriting.
4. AC-1.4 When a toggle cannot be persisted (write fails), the system shall revert the control to its prior state and show an
   error message naming the server; no partial state shall be saved.
5. AC-1.5 When the new controls render, each shall have an accessible name that includes the server name and its on/off state,
   and shall be operable by keyboard.

### 2. Global versus workspace scope

Requirement: for every server, skill and plugin the UI shows where it is declared and which scope a toggle writes to; workspace
overrides never alter global state.

Acceptance criteria:

1. AC-2.1 When a server is declared only in a user-scope source (`~/.claude.json`, `~/.codex/config.toml`, `~/.ptah`), the system
   shall label it "Global" and list that source path; when declared only in `.mcp.json` or `.claude/settings*.json`, it shall label
   it "Workspace" and list that path; when declared in both, it shall show both scopes and paths.
2. AC-2.2 When a toggle control is shown, the system shall state next to it which scope the toggle writes to (for example "This
   workspace only").
3. AC-2.3 When the user turns a global server off in a workspace, the system shall leave the global entry byte-for-byte unchanged:
   the user-scope files and Ptah's global state are identical before and after (verified by a unit test that snapshots them).
4. AC-2.4 When a workspace override and the global state disagree, the system shall show the effective state and indicate that it
   comes from a workspace override.
5. AC-2.5 When the same server name is declared in both scopes with different definitions, the system shall show which
   definition is in effect (per the resolution rule the architect documents) and a unit test shall pin that rule.

### 3. Per-workspace on/off for skills and plugins

Requirement: skills and plugins get the same per-workspace toggle, scope label and scope-of-write indicator as servers.

Acceptance criteria:

1. AC-3.1 When the user turns a skill or plugin off for a workspace in the Marketplace, the system shall persist it for that
   workspace only and show the same scope label and scope-of-write indicator defined in AC-2.1 and AC-2.2.
2. AC-3.2 When a `PluginConfigState` saved before this task is loaded, the system shall read it without error and produce the same
   enabled plugins and skills as before (existing `enabledPluginIds`, `disabledSkillIds` and denylist semantics preserved).
3. AC-3.3 When the Ptah CLI `plugin` command (`apps/ptah-cli/src/cli/commands/plugin.ts:53,266-286`) changes enabled plugins or
   disabled skills, the Marketplace shall show the same state after refresh, and the reverse shall hold.
4. AC-3.4 When a skill or plugin is off for a workspace, the system shall not include it in any session built for that workspace
   (checked through Requirement 4's criteria) on providers that accept an explicit skill set; for providers that do not, see AC-4.8.

### 4. Enforcement of the effective set at every session build

Requirement: Ptah computes the effective set of servers, skills and plugins for a workspace and applies it when it builds every
session, whatever user settings files say. The ptah server is on by default.

Acceptance criteria:

1. AC-4.1 When no Ptah toggle state exists for a workspace, the system shall treat ptah as on and every other server as its global
   state, and the effective set shall be the same whether `.claude/settings.local.json` contains
   `enableAllProjectMcpServers: true`, `false`, or does not exist (unit test with the three fixtures).
2. AC-4.2 When a Claude SDK session is built without a custom base URL, the options passed to the SDK shall contain exactly the
   enabled servers and shall deny every disabled one (asserted on the built options object).
3. AC-4.3 When a Claude SDK session is built with a custom base URL (proxied), the same holds, and a proxied session in this
   repository with only ptah enabled shall send no davinci-resolve, firecrawl or shopify-dev-mcp tool schemas in its first request
   (asserted on the captured request body or the built options).
4. AC-4.4 When a Codex lane is spawned, the lane's MCP configuration shall contain only enabled servers and shall not load disabled
   plugins or skills, regardless of `~/.codex/config.toml` (asserted on the spawn arguments or generated config).
5. AC-4.5 When an OpenCode, Antigravity or Ptah CLI lane is spawned, the same restriction shall apply (one test per adapter
   asserting the servers passed or configured).
6. AC-4.6 When the user turns ptah off explicitly, the system shall honour it and show a warning in the UI that Ptah tools
   (agent lanes, memory, browser) will be unavailable in that workspace's sessions.
7. AC-4.7 When a server is in failure back-off (`mcp-server-backoff.service.ts`), the system shall still suppress it even if the
   user toggled it on; when the back-off ends, the toggle state shall apply again.
8. AC-4.8 When a provider cannot accept an explicit server, skill or plugin set, the system shall log a warning naming the
   provider and the item that could not be enforced, and the UI shall mark that provider as "not enforced" for that item type.
9. AC-4.9 When a toggle changes, the system shall apply it to the next session built; sessions already running are not required to
   change, and the UI shall say so.

### 5. Schema-size token cost per enabled server

Requirement: the Marketplace shows how many tokens each enabled server's tool schemas cost per request.

Acceptance criteria:

1. AC-5.1 When a server is enabled and its tool list has been obtained, the system shall show a token figure for its schemas on
   the Installed servers row and in the detail view, labelled as an estimate with the method named (for example "about 13k tokens
   of tool schemas per request").
2. AC-5.2 When the tool list has not been obtained (server not yet connected or failed), the system shall show "size unknown"
   rather than zero or a stale number, and a failed server shall not block the rest of the page.
3. AC-5.3 When the ptah server is measured, the figure shall be within 10% of a direct count of its `tools/list` payload using the
   same method (unit test against a fixture).
4. AC-5.4 When a server is disabled, the system shall not show it as contributing to the workspace total, and when a total is
   shown it shall equal the sum of the enabled servers' figures.

## Non-functional requirements

- Compatibility: `PluginConfigState` configs persisted before this task load unchanged (AC-3.2); both the VS Code extension and
  the Electron app surface the same controls, since both host the Marketplace webview.
- Architecture: shared types live in `libs/shared`, which remains the only bridge between frontend and backend; no frontend lib
  imports a backend lib.
- Frontend: new or changed components use `ChangeDetectionStrategy.OnPush` and signal-based state, as the existing Marketplace
  components do.
- Testing: each new Marketplace control (server toggle, skill/plugin toggle, scope label, schema-size figure) has a webview e2e
  spec in `apps/ptah-electron-e2e/src/specs/marketplace/`.
- Delivery: the pull request changes fewer than 100 files (counted by `git diff --stat origin/main`); split into follow-ups if it
  would not.

## Stakeholders

| Stakeholder | What they need from this change | How they will judge it |
| --- | --- | --- |
| Workspace user | Turn unused servers, skills and plugins off without editing files | Toggle persists; proxied first request drops by about the disabled servers' schema size |
| User with global servers | Workspace choices do not leak into other workspaces or global config | Global files unchanged; other workspaces unaffected |
| TASK_2026_559_8ca9 owner | A stable effective-set contract to build per-caller profiles on | Can read the effective set from `libs/shared` without editing this task's code |
| Lane users (Codex, OpenCode, Antigravity, Ptah CLI) | Lanes carry only what is enabled | Lane first-request size falls; no missing ptah tools |

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| A provider (Codex desktop plugins, Antigravity, OpenCode) has no way to receive an explicit skill or plugin set | HIGH | MEDIUM | Architect verifies each adapter's config surface first and records per-provider capability; AC-4.8 makes gaps visible rather than silent |
| Schema size needs a live `tools/list`, so disconnected or slow servers have no figure, and measuring could spawn servers the user turned off | MEDIUM | MEDIUM | Architect decides when the list is obtained (reuse of a running session's list vs. an explicit measure action); AC-5.2 forbids fake zeros; never spawn a disabled server to measure it |
| Scope resolution is ambiguous: same name in both scopes, `.claude/settings.json` vs `settings.local.json`, Codex vs Claude global files | MEDIUM | HIGH | Architect writes the resolution table in the plan; AC-2.5 pins it with a unit test |
| Turning ptah off, or a denial reaching the ptah server by mistake, breaks lanes and memory | LOW | HIGH | AC-4.6 warning; a test asserts ptah is present in every built session when no override exists |
| Contract drift with TASK_2026_559_8ca9 | MEDIUM | MEDIUM | Land the shared contract in the first batch and notify the 559 owner before UI work proceeds |
| Scope grows past the 100-file cap across six session paths | MEDIUM | MEDIUM | Team-leader sizes batches against the cap; lane enforcement can split into a follow-up PR if needed |

## Open questions

- Should Ptah also offer a global (all-workspaces) toggle, or only per-workspace overrides of the files' global state? The request
  names per-workspace only; the user decides.
- Should skills and plugins get a Ptah-level global scope, given `PluginConfigState` is per-workspace today? User decides.
- Is an explicit "off" for ptah allowed at all, or should ptah be locked on? AC-4.6 assumes allowed with a warning; user decides.

## Handoff

- Next specialist: software-architect.
- Why: the requirements are fixed, but the resolution rule across six config sources and the per-provider enforcement mechanism
  (including what each CLI can accept) are design questions that need evidence from the adapters.
