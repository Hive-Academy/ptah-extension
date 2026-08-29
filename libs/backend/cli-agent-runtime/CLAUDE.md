# @ptah-extension/cli-agent-runtime

[Back to Main](../../../CLAUDE.md)

## Purpose

Hosts rival CLI orchestration (`cli-agents/`), user-configured Anthropic-compatible CLI adapters (`ptah-cli/`), and the MCP discovery + install SURFACE (`mcp-directory/`). Consumes `SdkMessageTransformer` and `SdkPermissionHandler` from `@ptah-extension/agent-sdk` via its public API only.

**Skill/command/agent propagation to rival CLIs is NOT here.** `CliPluginSyncService`, the four workspace skill installers and `CliSkillManifestTracker` were deleted in TASK_2026_278 Batch 2; that fan-out is now `@ptah-extension/harness-sync`. What remains is `createHarnessCliDetector`, the adapter that tells the reconciler which rival CLIs are installed.

## Boundaries

**Belongs here**:

- CLI agent process supervision (Codex, Copilot, Cursor)
- `PtahCliAdapter` + `PtahCliRegistry` (user-configured Anthropic-compatible CLIs)
- MCP registry discovery (Smithery, PulseMCP, official) + OAuth
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

Batch 1 scaffold — surface is intentionally empty (`export {}`). Subsequent batches in Win 1 of TASK_2026_123 will export the CLI agent, `ptah-cli`, and `mcp-directory` subsystems.

DI: `CLI_AGENT_RUNTIME_TOKENS`, `registerCliAgentRuntimeServices`.

## Internal Structure

- `src/lib/di/tokens.ts` — `CLI_AGENT_RUNTIME_TOKENS` (empty placeholder in Batch 1)
- `src/lib/di/register.ts` — `registerCliAgentRuntimeServices` (no-op in Batch 1)

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

## Guidelines

- **The official MCP registry's search parameter is `search`, and it needs `version=latest`.** An unrecognized parameter is ignored rather than rejected, so the old `q=` returned HTTP 200 with the alphabetical head of the entire catalogue — a search that looked like it worked and matched nothing anyone asked for. Without `version=latest` the registry returns every published version of every server, so one server occupies four rows of a scarce result window. Both are pinned by `mcp-registry.provider.spec.ts`.
- **`SkillsShApiClient.search` THROWS on failure and must keep throwing.** An empty array from it is a real "the marketplace has nothing" answer that callers are entitled to read that way. Idempotent reads retry three times (network faults, 429, 5xx — never other 4xx) before the failure is surfaced. Descriptions are best-effort: the public search API returns none, so `SkillsShDescriptionEnricher` probes each skill's `SKILL.md` frontmatter on GitHub, bounded and cached (negatives included), and every failure leaves the description empty rather than failing the search.
- **skills.sh paging is client-side over an over-fetch, and that is not a workaround.** Measured 2026-08-24: `/api/search` ACCEPTS AND IGNORES `offset`, `page` and `cursor` (all three return the same first window), honours an arbitrary `limit`, and caps a single query at 200 rows (`limit=500` and `limit=1000` both return 200). Its ranking is prefix-stable, so `searchPage` requests `offset + limit + 1` and slices — the extra row makes `hasMore` observed rather than inferred. `total` is reported ONLY when the upstream returned fewer rows than asked, which is the one condition proving the set is exhausted; at the 200 ceiling `limitedByUpstream` is set and `total` stays absent rather than being guessed. The old `MAX_LIMIT = 50` was OURS and indistinguishable from the API's, so every response looked like a complete answer of exactly 50.
- Depend on `agent-sdk` only via its public barrel — no deep imports.
- Same for `harness-sync`: public barrel only, and the dependency is ONE-WAY.
  `harness-sync` must never import this lib.
- **Every spawn carries the user's output style.** `PtahCliSpawnOptions` resolves it through `OutputStyleSessionActivationService` and `PtahCliRegistry` sends it as `settings: buildFlagSettings(...)`. Two rules hold it together: pass `userSettingSourceIncluded: true` (this path hardcodes `settingSources: ['user', 'project', 'local']`, so deriving it would take the inject fallback and apply the style twice), and never hand-roll `{ outputStyle: name }` — `buildFlagSettings` is the one builder and it owns the key-absent rule that stops a spawn clobbering a style chosen for the user's own CLI sessions.
- No imports from `platform-{cli,electron,vscode}` adapter libs.
- `catch (error: unknown)`; narrow with `instanceof Error`.
- Boundary inputs validated via zod.

## Cross-Lib Rules

Used by `rpc-handlers` and app layers. Forbidden imports: `platform-{cli,electron,vscode}`.
