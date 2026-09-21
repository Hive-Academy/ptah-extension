# @ptah-extension/cli-agent-runtime

[Back to Main](../../../CLAUDE.md)

## Purpose

Hosts rival CLI orchestration (`cli-agents/`), user-configured Anthropic-compatible CLI adapters (`ptah-cli/`), and the MCP discovery + install SURFACE (`mcp-directory/`). Consumes `SdkMessageTransformer` and `SdkPermissionHandler` from `@ptah-extension/agent-sdk` via its public API only.

**Skill/command/agent propagation to rival CLIs is NOT here.** `CliPluginSyncService`, the four workspace skill installers and `CliSkillManifestTracker` were deleted in TASK_2026_278 Batch 2; that fan-out is now `@ptah-extension/harness-sync`. What remains is `createHarnessCliDetector`, the adapter that tells the reconciler which rival CLIs are installed.

## Boundaries

**Belongs here**:

- CLI agent process supervision (Codex, Copilot, Cursor)
- `PtahCliAdapter` + `PtahCliRegistry` (user-configured Anthropic-compatible CLIs)
- MCP registry discovery (official, Smithery) + OAuth. PulseMCP was removed in
  TASK_2026_367 Batch B3: its `v0beta` endpoint (`https://api.pulsemcp.com/v0beta`)
  returned `410 Gone` permanently, and the replacement `v0.1` API is a paid,
  key-gated business API, so the source was removed rather than repointed.
- `McpInstallService` — the install RPC surface, a thin wrapper that records
  intent in `~/.ptah/mcp-installed.json` and calls `HarnessReconciler`
- `createHarnessCliDetector` — `CliDetectionService` adapted to the
  reconciler's `IHarnessCliDetector` port
- DI registration for the above (`registerCliAgentRuntimeServices`)

**Does NOT belong**:

- Claude/Codex SDK adapter (`agent-sdk`)
- Writing any harness artifact, MCP config files included (`harness-sync`).
  `AntigravityCliAdapter` looks like an exception and is not: see
  "Ptah's own MCP server at spawn time" below.
- Platform-specific code (must go through `platform-core` ports)
- RPC surface (`rpc-handlers`)
- Persistence beyond what SDK writes to `~/.claude/projects/`

## Public API

The root barrel (`src/index.ts`) re-exports five sub-barrels in full, plus a
short named list:

- `cli-agents` — `CliDetectionService`, `AgentProcessManager` (+
  `AgentContinueError`, `MIN/MAX/DEFAULT_CONCURRENT_AGENTS`, the
  `AgentRoleStamp` type), `AgentMessageError`/`AgentMessageRouter`,
  `AgentReportRouter`, every `cli-adapters/**` export (`CliAdapter`,
  `renderRoleBlock`, `assertCommandLineWithinLimit`,
  `CliCommandLineTooLongError`, `spawnCli`, …), `createHarnessCliDetector`.
- `ptah-cli` — `PtahCliRegistry`, `PtahCliSpawnOptions`,
  `PtahCliConfigPersistence`, `PtahCliStreamLoop`, `PTAH_CLI_ROLE_DELIVERY`
  and other constants.
- `mcp-directory` — MCP registry discovery/install surface (`McpRegistryProvider`,
  Smithery + OAuth clients, `McpInstallService`, the read-only
  `~/.claude.json` reader).
- `skills-directory` — the skills.sh marketplace client.
- `roles` — `AgentRoleResolver`, `AgentRoleError`, `AgentRoleErrorCode`,
  `MAX_ROLE_BYTES` (see "Role-addressed lanes" below).
- Plus `CLI_AGENT_RUNTIME_TOKENS`, `registerCliAgentRuntimeServices`, and the
  `wiring/` helpers (`wireSdkCallbacks`, `wireAgentEventListeners`,
  `persistCliSessionReference`).

DI: `CLI_AGENT_RUNTIME_TOKENS`, `registerCliAgentRuntimeServices`.

## Internal Structure

- `src/lib/di/tokens.ts` — `CLI_AGENT_RUNTIME_TOKENS` (e.g. `AGENT_ROLE_RESOLVER`)
- `src/lib/di/register.ts` — `registerCliAgentRuntimeServices`: registers the
  runtime's singletons, including `AgentSpawnEnvironment` and `AgentOutputBuffer`
  before the process manager; `register.agent-process-manager.smoke.spec.ts`
  resolves the manager through the real container
- `src/lib/cli-agents/` — detection, `AgentProcessManager` and its collaborators,
  message/report routers, `cli-adapters/`
- `src/lib/ptah-cli/`, `src/lib/roles/`, `src/lib/mcp-directory/`,
  `src/lib/skills-directory/`, `src/lib/spawn/`, `src/lib/wiring/`

## Dependencies

**Internal**: `@ptah-extension/agent-sdk` (public API only), `@ptah-extension/harness-sync` (reconciler + MCP facets, one-way — harness-sync must never import this lib), `@ptah-extension/vscode-core` (Logger), `@ptah-extension/platform-core` (ports), `@ptah-extension/output-styles` (`OutputStyleSessionActivationService`)
**External**: `tsyringe`, `eventemitter3`, `rxjs`

## Ptah's own MCP server at spawn time

Each adapter hands the spawned CLI a localhost URL for Ptah's in-process MCP
server. Most do it without touching disk — Codex via SDK config, Copilot via
`--additional-mcp-config`, Cursor via `agentOptions.mcpServers`, opencode via
`OPENCODE_CONFIG_CONTENT`. **Antigravity is the one that has to write a file**:
`agy` reads MCP servers only from `~/.gemini/config/mcp_config.json`.

**None of this reaches a CLI the USER launches, and that is not what it is
for.** An in-process config, an argv flag and an env var all die with the
process. Persisting Ptah's server so a bare `codex` or `agy` in a terminal can
see it is `CodeExecutionMCP`'s job (`vscode-lm-tools`, `ptah-mcp-slots.ts`),
which writes the same `PTAH_SPAWN_MCP_KEY` into every detected CLI's config for
as long as its HTTP server is up. The two overlap on exactly one file — see the
restore rule below.

Since TASK_2026_285 that file is also a user-installable MCP target, so the
reconciler writes it too. Rather than become a second writer, the adapter goes
through `harness-sync`'s facet:

```ts
createMcpFacet('antigravity', { homeDir }).write('', PTAH_SPAWN_MCP_KEY, {
  type: 'sse',
  url: `http://localhost:${port}`,
});
```

Three rules hold it together, and all three are pinned by
`antigravity-cli.adapter.mcp.spec.ts`:

- **The facet owns the format.** `agy` spells a remote endpoint `serverUrl`, not
  `url`. Hand-rolling the JSON here is how that detail drifts.
- **Cleanup RESTORES `PTAH_SPAWN_MCP_KEY`, it does not delete it.** Deleting was
  right while this adapter was the only thing that ever wrote the key. It is not
  any more: `CodeExecutionMCP` keeps a PERSISTENT `ptah` entry in this file for
  as long as its HTTP server is up, so that `agy` sessions the USER starts have
  Ptah tools too, and an unconditional delete silently revoked that every time a
  Ptah-spawned agent finished. `configureMcpServer` therefore returns whatever
  entry it found and `cleanupMcpEntry` writes it back; `undefined` means nobody
  owned the key and it is removed, which is exactly the old behaviour. The
  snapshot is a LOCAL in `runSdk`, never a field — two `agy` agents can be in
  flight at once and a shared slot would let one run's cleanup restore the
  other's. Either way it touches that one key and nothing else: an older version
  also deleted the whole `mcpServers` map once it looked empty, which was safe
  only while Ptah was its sole writer and is a way to delete a user's installed
  server now.
- **The facet holds a per-config-file lock.** Two unserialized
  read-modify-writes on one file lose an entry with no error and no torn file.

`homeDir` is resolved env-first (`HOME` / `USERPROFILE` / `os.homedir()`) to
match `geminiRoot()`, so a test that reassigns `HOME` cannot reach the
developer's real `~/.gemini`.

**Codex connects to that server and then hides its tools.** Measured on
codex-cli 0.150.1: with only `mcp_servers.ptah.url` set, `rmcp` logs
`Service initialized as client … server_info: Implementation { name: "ptah" }`
— the handshake succeeds — and a spawned agent asked to list the `ptah` tools
answers **NONE**, then does the whole task with `powershell.exe` calls. The
cause is the `ToolSearchAlwaysDeferMcpTools` feature: MCP tools stay out of the
model's tool list until the model runs a tool search, which it has no reason to
do. `CodexCliAdapter` therefore sends
`features.tool_search_always_defer_mcp_tools = false` alongside the server
entry; with it, the same prompt lists all 40+ `ptah_*` tools. A successful
connection is NOT evidence that the tools arrived — only a tool listing is.

## Role-addressed lanes (`role`, TASK_2026_433)

`AgentRoleResolver` (`roles/agent-role-resolver.service.ts`) turns a
caller-supplied `role` name into an `AgentRoleDefinition` read from
`{harnessRoot}/.claude/agents/<role>.md` — the source-managed directory Claude
subagents read directly, **not** the consent-gated `~/.ptah/user` mirror, which
can be absent whenever the setup wizard's consent gate is closed. `listRoles`
and `resolve` reject a `workspaceRoot` that is empty or not `path.isAbsolute`
with `AgentRoleError('no_workspace', …)` before `resolveHarnessWorkspaceRoot`
runs or any filesystem call happens — an unguarded empty root used to resolve
to `process.cwd()/.claude/agents` (the install dir in Electron, the shell cwd
in the CLI). Every failure is `AgentRoleError`, never a role-less fallback:
`invalid_role_name` (name regex checked first, before any FS call), `no_roles`
(empty `.claude/agents` — spawning without `role` is still valid),
`unknown_role`, `empty_role` (blank after the frontmatter strip),
`role_too_large` (over `MAX_ROLE_BYTES` = 64 KiB), `role_read_failed`
(narrowed `instanceof Error`), `no_workspace`.

**Delivery is a required `CliAdapter.roleChannel`, one per adapter, and v1
always delivers as a preamble** — `AgentRoleDelivery` is `'preamble' | 'native'`
but every lane reports `'preamble'` today; `'native'`/`'agent-selection'` is
reserved for the deferred native-role probe (nothing sets it yet):

| Adapter | `roleChannel` | Delivery |
| --- | --- | --- |
| codex | `developer-instructions` | `config.developer_instructions = renderRoleBlock(...)`; stripped from the task-prompt input (`buildTaskPrompt({ ...options, role: undefined })`) so it is never duplicated |
| copilot, antigravity, opencode, cursor, pi | `task-prompt` | `buildTaskPrompt(options, cli)` folds the role in as its own `---`-delimited section |
| ptah-cli | `system-prompt` | `renderRoleBlock(role, 'ptah-cli')` appended to `fullSystemPromptContent` after `## Project Guidance`, delivered over stdin `initialize` — no argv, no command-line budget |

`renderRoleBlock` (`cli-agents/cli-adapters/cli-adapter.utils.ts`) runs the
body through harness-sync's `transformAgentBody` only on the harness
`CliTarget` lanes (codex, copilot, cursor, antigravity); opencode, pi and
ptah-cli get the stripped body unchanged. **A role body that itself starts
with a `---` block used to lose that block on the four transform lanes**,
because `AgentRoleDefinition.body` is already frontmatter-stripped by the
resolver and `transformAgentBody` strips again. Fixed by prepending a sentinel
before the second strip only on transform lanes — `EMPTY_FRONTMATTER =
'---\n\n---\n'` — whose lazy `^---\n[\s\S]*?\n---\n?` match consumes just the
sentinel and never the body's own `---` pair. Continuation turns never re-send
the role; a resume spawn that carries `role` delivers it again (accepted
duplication on task-prompt lanes — persisting the recorded role for UI-resume
is a follow-up, blocked on sibling WIP in `wiring/agent-events.ts`).

**Read-only intent is never mapped to a sandbox, and role frontmatter
`model`/`tools` are never read.** Every role's own contract writes a
deliverable file, so narrowing a root lane's sandbox from a role would break
that contract — codex keeps `sandboxMode: 'danger-full-access'` regardless of
role. `model`/`tools` frontmatter is generation metadata for delegated Claude
subagents (whose model aliases are not codex models), not something a spawned
root lane's tier or permissions read from.

**Command-line budget guard**, `assertCommandLineWithinLimit` (same file),
runs first inside `spawnCli`, and separately for codex on the serialized
`--config developer_instructions=<JSON>` before `new sdk.Codex` (a codex-sdk
spawn bypasses `spawnCli` entirely):

- win32: libuv-quoted length of `command + args` ≤ 32,767 UTF-16 units —
  EXCEPT when `command` ends `.cmd`/`.bat` (case-insensitive), where the limit
  is 8,191, because `resolveDirectSpawn` can fall back to the unchanged `.cmd`
  wrapper and `cross-spawn` then runs it through `cmd.exe`.
- linux: each arg ≤ 131,071 bytes.
- darwin: sum of arg bytes ≤ 1,048,576 − 4,096 reserve.
- Throws `CliCommandLineTooLongError { measured, limit, largestArgIndex }`
  before any process exists or side effect runs (antigravity resolves the
  spawn descriptor and runs the guard BEFORE `configureMcpServer`, so a
  rejected spawn never writes the HOME MCP entry). Nothing is ever truncated.

**What the guard does not model** (accepted gaps, not bugs):

- The `.cmd`-fallback 8,191 win32 limit still under-measures the real cmd.exe
  line: `cross-spawn` escapes cmd.exe metacharacters — space included — with
  `^`, doubled for a `node_modules/.bin` shim, so the actual line can run well
  past what the guard computed. Past the true cap the spawn still fails
  loudly with the OS's own "command line is too long" — no truncation, the
  same failure mode as before this guard existed — it just does not get the
  named `CliCommandLineTooLongError`.
- Linux's TOTAL `ARG_MAX` (argv + environment combined) is not checked, only
  the per-argument 131,071-byte limit — the contract here is per-arg, not
  aggregate.
- darwin's environment-variable byte cost is not subtracted from the
  1,048,576-byte budget; only argv bytes are counted.

**A codex role REPLACES the user's own `developer_instructions`.** Ptah's
per-run `--config developer_instructions=<role block>` overrides any value set
in `~/.codex/config.toml`; the two are not merged. Measured on a real spawn with
a sentinel in a throwaway `CODEX_HOME` (TASK_2026_433 `test-report.md` E2/A2):
the lane reported the sentinel absent. A role-less codex spawn sends no
`developer_instructions`, so the user's value applies there.

### Facade split of `AgentProcessManager`

`AgentSpawnEnvironment` (`cli-agents/agent-spawn-environment.service.ts`) and
`AgentOutputBuffer` (`cli-agents/agent-output-buffer.service.ts`) are injected
collaborators split out of `agent-process-manager.service.ts` under the root
`CLAUDE.md` facade rule — launch-settings resolution (model/effort/CLI
preference, concurrency cap, idle-release window, workspace scoping, MCP
port, harness preflight) and throttled output-delta buffering, respectively.
`AgentProcessManager` keeps its name, `TOKENS.AGENT_PROCESS_MANAGER`,
`events`, and every public method signature — no caller changes. Both
collaborators register as singletons in `di/register.ts` before
`TOKENS.AGENT_PROCESS_MANAGER` and are injected by class token, the way
`AgentMessageRouter` is; `di/register.agent-process-manager.smoke.spec.ts`
resolves the manager through the real container and asserts both are wired in
as singletons (it fails if either `registerSingleton` line is removed).

## Guidelines

- **The official MCP registry's search parameter is `search`, and it needs `version=latest`.** An unrecognized parameter is ignored rather than rejected, so the old `q=` returned HTTP 200 with the alphabetical head of the entire catalogue — a search that looked like it worked and matched nothing anyone asked for. Without `version=latest` the registry returns every published version of every server, so one server occupies four rows of a scarce result window. Both are pinned by `mcp-registry.provider.spec.ts`.
- **`SkillsShApiClient.search` THROWS on failure and must keep throwing.** An empty array from it is a real "the marketplace has nothing" answer that callers are entitled to read that way. Idempotent reads retry three times (network faults, 429, 5xx — never other 4xx) before the failure is surfaced. Descriptions are best-effort: the public search API returns none, so `SkillsShDescriptionEnricher` probes each skill's `SKILL.md` frontmatter on GitHub, bounded and cached (negatives included), and every failure leaves the description empty rather than failing the search.
- **skills.sh paging is client-side over an over-fetch, and that is not a workaround.** Measured 2026-08-24: `/api/search` ACCEPTS AND IGNORES `offset`, `page` and `cursor` (all three return the same first window), honours an arbitrary `limit`, and caps a single query at 200 rows (`limit=500` and `limit=1000` both return 200). Its ranking is prefix-stable, so `searchPage` requests `offset + limit + 1` and slices — the extra row makes `hasMore` observed rather than inferred. `total` is reported ONLY when the upstream returned fewer rows than asked, which is the one condition proving the set is exhausted; at the 200 ceiling `limitedByUpstream` is set and `total` stays absent rather than being guessed. The old `MAX_LIMIT = 50` was OURS and indistinguishable from the API's, so every response looked like a complete answer of exactly 50.
- **Every rival-CLI spawn goes through the injected `IProcessSpawner`, so the launch happens on a worker thread (TASK_2026_367 Batch B9).** `CliDetectionService` injects `SDK_TOKENS.SDK_PROCESS_SPAWNER` — the binding `agent-sdk` already owns — types it against `platform-core`'s `IProcessSpawner`, and hands it to the antigravity, opencode, pi and copilot adapters, which pass it to `spawnCli` and `probeCliVersion`. Codex and Cursor are absent on purpose: both run their vendor SDK in process and never call `spawnCli`. `spawnCli` now returns a `SpawnedProcessHandle`, not a `ChildProcess`; with no spawner it is the same inline `cross-spawn` call it always was, wrapped in a handle. Two rules follow from moving the spawn off-thread. **A tree kill must await `handle.whenSpawned`** — `pid` is `undefined` until the worker reports it, and `killProcessTree(undefined)` silently orphans the whole subtree. **Read `close`, never `exit`** — the adapters parse their last JSONL line there, and `exit` can arrive with stdout still in flight. `PTAH_SDK_INLINE_SPAWN=1` puts every launch back on the calling thread without a rebuild.
- **The MCP OAuth loopback binds a FIXED port (`MCP_OAUTH_LOOPBACK_PORT = 41739`), not `127.0.0.1:0`, and that is the whole point (TASK_2026_373).** An authorization server without RFC 7591 dynamic client registration — HubSpot is the canonical one — only accepts a redirect URL the user registered with the provider in advance, and a port chosen at bind time can never match one written down beforehand. `describeRedirectUri()` is the port-free way to ask what the next `start()` will advertise, so the UI can show the user the exact URL to register. A busy port still falls back to `0` so the dynamic-registration flows keep working, but that fallback is NOT silently acceptable on the pre-registered path: `McpOAuthService.connect` compares the armed `redirectUri` against `describeRedirectUri()` and refuses, because otherwise the authorization server rejects the flow with a message that says nothing about a busy port. Do not "simplify" this back to an ephemeral port.
- **`SmitheryInstalledManifestStore` and `McpOAuthInstalledManifestStore` re-read their file on every call, not once at construction (TASK_2026_375).** Each keeps a `loadedSignature` (`mtimeMs:size`, not mtime alone — two writes inside one Windows/tmpfs millisecond must still be seen) and a private `refresh()` that re-parses only when the signature changed. `refresh()` runs at the top of every read AND every mutating method, because a mutation built on a stale in-memory map silently clobbers a record another instance just wrote. Before this, `ChatSessionService` built its own long-lived store instance, so an install the Marketplace RPC handler wrote was invisible until Ptah restarted.
- **OAuth discovery in `mcp-oauth-metadata.ts` is path-aware, not origin-only (TASK_2026_375).** `discoverAuthorizationServer` tries the RFC 9728 §3.1 path form (`/.well-known/oauth-protected-resource<path>`) before the root document, then a live 401 probe that parses `WWW-Authenticate: … resource_metadata="<url>"`. `discoverAuthServerMetadata` tries the matching RFC 8414 §3.1 path-insert form before its own root fallback. Every Smithery-hosted server publishes its metadata only under the path form — origin-only discovery found nothing for any of them.
- **A Connections-API Smithery install collapses to ONE session override, keyed `smithery`, not one override per server.** `SmitheryOverrideResolver` emits `{ type: 'http', url: 'https://mcp.smithery.run/<namespace>', headers: { Authorization: … } }` for every record that carries `namespace` + `connectionId`, and tools from all of them arrive prefixed `<connectionId>.<tool>` on that one server. A record without `namespace` (installed before this) keeps its own legacy per-server override untouched.
- **`~/.claude.json` is READ-ONLY here and must never become a harness facet.**
  `claude-user-mcp.reader.ts` exists because `listInstalled` was reading only the
  six reconciler-owned config files, so the Installed tab reported eight servers
  on a machine running about eleven — a Smithery install, an in-app OAuth
  connection and anything added with `claude mcp add` were each real, connected
  and invisible. The reader covers the last of those: the top-level `mcpServers`
  map AND `projects[<root>].mcpServers`, which is where the servers actually
  live on this machine (there is no top-level map at all). Adding it to
  `mcp-facet.registry.ts` would put the reconciler in charge of a file the
  `claude` CLI owns and whose schema carries history, trust and onboarding state
  — so it has no `write`, and every row it produces is `removal: 'none'` with a
  reason naming `claude mcp remove`. Project-key case is folded on `win32` and
  `darwin` only, and every folded-matching key is read: this repo has TWO
  project entries differing only in drive-letter case, both live.
- **An uninstall that removed nothing now says so.** The reconciler deletes only
  manifest-owned keys — a hand-written entry is `foreign` and correctly left
  alone — but `McpInstallService.uninstall` used to report `success: true`
  anyway, because it fails a target only when a write for that exact key failed
  and no write was attempted. It now re-reads the config afterwards and reports
  a refusal naming the key as user-owned. `force: true` is the deliberate way
  out, and it goes through `IHarnessMcpFacet.remove` — never a hand-rolled
  read-modify-write, because the facet owns the dialect and holds the
  per-config-file lock.
- **`AgentProcessManager.sendToAgent` replaced `steer()`, and `AgentReportRouter` is the child-to-parent half (TASK_2026_402).** `sendToAgent(agentId, message)` picks ONE of four modes per call — `steer`, `interrupt-resume`, `queue-next-turn`, `unsupported` — from `caps = handleCaps ?? adapterCaps`, where `adapter.capabilities()` (replacing the deleted `supportsSteer()`) is the fallback and a live `SdkHandle`'s own predicates win when present. No branch anywhere is keyed on a CLI name; a seventh adapter that skips `capabilities()` is a compile error by design. `AgentReportRouter.deliver()` is the reverse direction: a spawned CLI calls `ptah_agent_report` with NO agent id — identity comes from the `/agent/{id}` segment `ptahMcpServerUrl` puts on that agent's own MCP URL (`ptah-mcp-url.ts`), parsed server-side into `MCPRequest._callerAgentId`. That is attribution, not authentication (see the doc comment on `extractCallerAgentId` in `vscode-lm-tools/http-server.handler.ts`): the MCP HTTP server binds localhost and checks no credential, so what it buys is that the honest path carries the right id by construction, closing the confused-deputy case, not that the id is unforgeable. A refusal (`unattributed-caller`, `no-parent-recorded`, `parent-session-not-active`, `report-too-large`, `rate-limited`, `duplicate-report`, `chat-runtime-unavailable`, `delivery-failed`) is a normal, logged answer — the router never reports a delivery it did not make.
- **The child prompt carries the two-way messaging guidance, and `TWO_WAY_MESSAGING_GUIDANCE` (`cli-adapter.utils.ts`) is its source of truth (TASK_2026_477).** `buildTaskPrompt` appends it only when the run has BOTH an `mcpPort` and an `agentId` — without a port the `ptah_*` tools it names do not exist, and without an id a `ptah_agent_report` cannot be attributed and is refused. The text names no vendor and describes no delivery mode as available, both pinned by spec; it costs a MEASURED 826 bytes of the child prompt, which is argv on the task-prompt adapters. The parent-side tool table (`vscode-lm-tools`' `ptah-system-prompt.constant.ts`) and `.claude/skills/agent-lanes/SKILL.md` reference this constant rather than restating it — do not let a third copy appear.
- **`buildTaskPrompt` substitutes the real agent id into the deliverable filename, and omits the line without one.** It used to emit `agent-output-{agentId}.md` with the braces INTACT — nothing on any path ever replaced them, and the child is not told its own id, so agents invented a value and settled on `agent-output-root.md`. The line is also worded as subordinate to a filename the task itself names; as an unconditional "convention" it competed with one, and lanes wrote both files.
- Depend on `agent-sdk` only via its public barrel — no deep imports.
- Same for `harness-sync`: public barrel only, and the dependency is ONE-WAY.
  `harness-sync` must never import this lib.
- **Every spawn carries the user's output style.** `PtahCliSpawnOptions` resolves it through `OutputStyleSessionActivationService` and `PtahCliRegistry` sends it as `settings: buildFlagSettings(...)`. Two rules hold it together: pass `userSettingSourceIncluded: true` (this path hardcodes `settingSources: ['user', 'project', 'local']`, so deriving it would take the inject fallback and apply the style twice), and never hand-roll `{ outputStyle: name }` — `buildFlagSettings` is the one builder and it owns the key-absent rule that stops a spawn clobbering a style chosen for the user's own CLI sessions.
- No imports from `platform-{cli,electron,vscode}` adapter libs.
- `catch (error: unknown)`; narrow with `instanceof Error`.
- Boundary inputs validated via zod.

## Cross-Lib Rules

Used by `rpc-handlers` and app layers. Forbidden imports: `platform-{cli,electron,vscode}`.
