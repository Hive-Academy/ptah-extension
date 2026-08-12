# @ptah-extension/cli-agent-runtime

[Back to Main](../../../CLAUDE.md)

## Purpose

Hosts rival CLI orchestration (`cli-agents/`), user-configured Anthropic-compatible CLI adapters (`ptah-cli/`), and cross-CLI MCP installation (`mcp-directory/`). Consumes `SdkMessageTransformer` and `SdkPermissionHandler` from `@ptah-extension/agent-sdk` via its public API only.

## Boundaries

**Belongs here**:

- CLI agent process supervision (Codex, Copilot, Cursor)
- `PtahCliAdapter` + `PtahCliRegistry` (user-configured Anthropic-compatible CLIs)
- Cross-CLI MCP installation surface (`mcp-directory/`)
- DI registration for the above (`registerCliAgentRuntimeServices`)

**Does NOT belong**:

- Claude/Codex SDK adapter (`agent-sdk`)
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

**Internal**: `@ptah-extension/agent-sdk` (public API only), `@ptah-extension/vscode-core` (Logger), `@ptah-extension/platform-core` (ports), `@ptah-extension/output-styles` (`OutputStyleSessionActivationService`)
**External**: `tsyringe`, `eventemitter3`, `rxjs`

## Guidelines

- Depend on `agent-sdk` only via its public barrel — no deep imports.
- **Every spawn carries the user's output style.** `PtahCliSpawnOptions` resolves it through `OutputStyleSessionActivationService` and `PtahCliRegistry` sends it as `settings: buildFlagSettings(...)`. Two rules hold it together: pass `userSettingSourceIncluded: true` (this path hardcodes `settingSources: ['user', 'project', 'local']`, so deriving it would take the inject fallback and apply the style twice), and never hand-roll `{ outputStyle: name }` — `buildFlagSettings` is the one builder and it owns the key-absent rule that stops a spawn clobbering a style chosen for the user's own CLI sessions.
- No imports from `platform-{cli,electron,vscode}` adapter libs.
- `catch (error: unknown)`; narrow with `instanceof Error`.
- Boundary inputs validated via zod.

## Cross-Lib Rules

Used by `rpc-handlers` and app layers. Forbidden imports: `platform-{cli,electron,vscode}`.
