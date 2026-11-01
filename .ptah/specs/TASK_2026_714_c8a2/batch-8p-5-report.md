# Batch 8p-5 report — Codex Ptah MCP constants into codex-runtime

Style S2. `CODEX_PTAH_TOOL_TIMEOUT_SEC` and `ptahMcpSessionUrl` now live in `@ptah-extension/codex-runtime`. `cli-agent-runtime` does not re-export either symbol. Behaviour of both symbols is unchanged.

## Dependents

`ptah_get_dependents` was not available. `search_tool` returned status `ready` with only the `tasks` server (10 tools). No `ptah_get_dependents` schema. Dependents were listed with a workspace ripgrep for both names (`*.ts`, `*.tsx`, `*.mjs`, `*.cjs`, `*.json` under `W`), before the edits.

Importers found (every one updated, or left as a comment that now names the new home):

| Symbol | File | Role |
| --- | --- | --- |
| `ptahMcpSessionUrl` | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/ptah-mcp-url.ts` | definition (removed) |
| `ptahMcpSessionUrl` | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/ptah-mcp-url.spec.ts` | unit spec (cases moved) |
| both | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/index.ts` | public barrel lines 21–22 (exports removed) |
| both | `libs/backend/cli-agent-runtime/src/lib/cli-agents/index.ts` | `export * from './cli-adapters'` — no edit; the names left with that star |
| both | `libs/backend/cli-agent-runtime/src/index.ts` | `export * from './lib/cli-agents'` — no edit; same |
| `CODEX_PTAH_TOOL_TIMEOUT_SEC` | `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-lane-config.builder.ts` | definition and config emission |
| `CODEX_PTAH_TOOL_TIMEOUT_SEC` | `.../codex/codex-lane-config.builder.spec.ts` | `toBe(960)` assertion (moved) |
| `CODEX_PTAH_TOOL_TIMEOUT_SEC` | `.../codex/codex-lane-profile.ts` | lane requirements field |
| both | `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts` | chat host import from `@ptah-extension/cli-agent-runtime` |
| both | `.../codex-chat-host-ports.spec.ts` | `jest.mock` + `requireActual` of the old leaves |
| both | `.../codex-chat-native-contract.spec.ts` | same mock |

`W/apps` had no importer. `gateway-chat-bridge` does not import either name (the P8 note about `codex-gateway-adapter.ts` does not match this tree). No other `libs` hit.

`ptahMcpServerUrl` stays in `ptah-mcp-url.ts`. It does not call `ptahMcpSessionUrl`. The two functions do not share a private helper. Each inlines the same two statements for an empty working directory versus `/workspace/${encodeURIComponent(...)}`. Those statements were not extracted. Moving only a shared helper was the rule, and there was none to move. `ptahMcpServerUrl`'s body is unchanged.

## Dependency direction

No `project.json`, `tsconfig`, or eslint tag change. `@ptah-extension/codex-runtime` stays `scope:extension`, `type:feature`. The new module imports nothing (no `cli-agent-runtime`, no `vscode`, no `electron`, no platform-specific lib). `cli-agent-runtime` and `rpc-handlers` are the same tags and already imported `@ptah-extension/codex-runtime`. `type:feature` may depend on `type:feature` (`eslint.config.mjs` depConstraints). A grep of `libs/backend/codex-runtime` for `cli-agent-runtime` is empty.

Doc comments that name the file-writer twin `ptahMcpUrl` (`vscode-lm-tools/.../mcp-http/ptah-mcp-slots.ts`) now also name `codex-ptah-mcp.ts` and `ptah-mcp-url.ts`, so the three grammar sites still point at each other.

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-ptah-mcp.ts` (new)
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-ptah-mcp.spec.ts` (new; session cases and `expect(CODEX_PTAH_TOOL_TIMEOUT_SEC).toBe(960)` copied)
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\ptah-mcp-url.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\ptah-mcp-url.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-lane-config.builder.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-lane-config.builder.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-lane-profile.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\codex-host\codex-chat-host-ports.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\codex-host\codex-chat-host-ports.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\rpc-handlers\src\lib\chat\codex-host\codex-chat-native-contract.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8p-5-report.md`

The two host specs dropped the `@ptah-extension/cli-agent-runtime` mock. Host ports no longer import that package, and they already load the real `@ptah-extension/codex-runtime` barrel.

## No shim remains

Grep of `export {` containing either name under `cli-agent-runtime`: no matches.

Grep of both names across `W` (`*.ts`, `*.tsx`, `*.mjs`, `*.cjs`, `*.json`) after the move:

```
libs/backend/codex-runtime/src/lib/codex-ptah-mcp.ts
  20: export const CODEX_PTAH_TOOL_TIMEOUT_SEC = 960;
  41: export function ptahMcpSessionUrl(
libs/backend/codex-runtime/src/lib/codex-ptah-mcp.spec.ts
  13:   CODEX_PTAH_TOOL_TIMEOUT_SEC,
  14:   ptahMcpSessionUrl,
  17: describe('CODEX_PTAH_TOOL_TIMEOUT_SEC', () => {
  19:     expect(CODEX_PTAH_TOOL_TIMEOUT_SEC).toBe(960);
  23: describe('ptahMcpSessionUrl', () => {
  26:       ptahMcpSessionUrl(51820, 'tab-1', 'D:\\projects\\ptah-extension'),
  33:     expect(ptahMcpSessionUrl(51820, 'a/b?c', '/tmp/ws-a')).toBe(
  39:     expect(ptahMcpSessionUrl(51820, 'tab-1', '')).toBe(
  45:     expect(() => ptahMcpSessionUrl(51820, routingId, '/tmp/ws-a')).toThrow(
libs/backend/codex-runtime/src/index.ts
  83:   CODEX_PTAH_TOOL_TIMEOUT_SEC,
  84:   ptahMcpSessionUrl,
libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/ptah-mcp-url.ts
  16:  * builder is `ptahMcpSessionUrl` in `@ptah-extension/codex-runtime`
libs/backend/cli-agent-runtime/.../codex/codex-lane-config.builder.ts
  35: import { CODEX_PTAH_TOOL_TIMEOUT_SEC } from '@ptah-extension/codex-runtime';
  151:         `mcp_servers.${PTAH_SERVER_NAME}.tool_timeout_sec=${CODEX_PTAH_TOOL_TIMEOUT_SEC}`,
libs/backend/cli-agent-runtime/.../codex/codex-lane-profile.ts
  2:   CODEX_PTAH_TOOL_TIMEOUT_SEC,
  147:     ...(attach ? { ptahToolTimeoutSeconds: CODEX_PTAH_TOOL_TIMEOUT_SEC } : {}),
libs/backend/rpc-handlers/.../codex-chat-host-ports.ts
  17:   CODEX_PTAH_TOOL_TIMEOUT_SEC,
  19:   ptahMcpSessionUrl,
  329:           ? ptahMcpSessionUrl(PTAH_MCP_PORT, routingId, cwd)
  338:           toolTimeoutSec: CODEX_PTAH_TOOL_TIMEOUT_SEC,
```

The only `cli-agent-runtime` hits are a doc comment and two imports from `@ptah-extension/codex-runtime`. The adapters barrel now exports `ptahMcpServerUrl` only.

## Not done

- `ptah_get_dependents` (MCP tool not connected). Grep used instead.
- No test, lint, typecheck, or build. Lane rule: the team-leader verifies.
- No git commit.
