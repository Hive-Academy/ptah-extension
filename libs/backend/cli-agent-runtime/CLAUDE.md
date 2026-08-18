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
- Writing any harness artifact, MCP config files included (`harness-sync`)
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

## Guidelines

- Depend on `agent-sdk` only via its public barrel — no deep imports.
- **Every spawn carries the user's output style.** `PtahCliSpawnOptions` resolves it through `OutputStyleSessionActivationService` and `PtahCliRegistry` sends it as `settings: buildFlagSettings(...)`. Two rules hold it together: pass `userSettingSourceIncluded: true` (this path hardcodes `settingSources: ['user', 'project', 'local']`, so deriving it would take the inject fallback and apply the style twice), and never hand-roll `{ outputStyle: name }` — `buildFlagSettings` is the one builder and it owns the key-absent rule that stops a spawn clobbering a style chosen for the user's own CLI sessions.
- No imports from `platform-{cli,electron,vscode}` adapter libs.
- `catch (error: unknown)`; narrow with `instanceof Error`.
- Boundary inputs validated via zod.

## Cross-Lib Rules

Used by `rpc-handlers` and app layers. Forbidden imports: `platform-{cli,electron,vscode}`.
