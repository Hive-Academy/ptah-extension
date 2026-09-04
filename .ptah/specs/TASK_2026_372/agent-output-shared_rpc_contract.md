# Shared RPC contract — TASK_2026_372

## Headline

The shared web-search RPC registry now matches the implemented multi-provider handlers. Shared typecheck and tests pass; the four-project typecheck remains blocked only by an out-of-scope MCP OAuth compile error.

## Handler-contract comparison

`web-search-rpc.handlers.ts` already registers these shapes:

- `webSearch:test` returns `{ success: boolean; results: Array<{ provider: string; success: boolean; error?: string }> }`.
- `webSearch:getConfig` returns `{ providers: string[]; maxResults: number }`.
- `webSearch:setConfig` accepts `{ providers?: string[]; maxResults?: number }`.

The three corresponding `RpcMethodRegistry` entries used the legacy single-provider shapes before this change.

## Exact changes

Modified only `libs/shared/src/lib/types/rpc.types.ts`:

- Replaced `webSearch:test.result.provider/error` with the per-provider `results` array.
- Replaced `webSearch:getConfig.result.provider` with `providers: string[]`.
- Replaced `webSearch:setConfig.params.provider` with `providers?: string[]`.
- Left every other web-search entry and the method allowlist unchanged.
- Preserved the already-present MCP Directory OAuth additions without reformatting them.

## Verification

1. `npx nx run-many -t typecheck -p @ptah-extension/shared`
   - Header: 1 project (`@ptah-extension/shared`).
   - Outcome: PASS (exit 0).
2. `npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/vscode-lm-tools @ptah-extension/chat`
   - Header: 4 projects.
   - Outcome: FAIL (exit 1). Nx listed only `@ptah-extension/vscode-lm-tools:typecheck` and `@ptah-extension/rpc-handlers:typecheck` as failed; shared and chat were not failed tasks.
   - Remaining out-of-scope error, reported by both failed checks: `libs/backend/cli-agent-runtime/src/lib/mcp-directory/oauth/mcp-oauth.service.ts(140,27): error TS2339: Property 'resolveListener' does not exist on type 'McpOAuthService'.`
3. `npx nx run-many -t test -p @ptah-extension/shared`
   - Header: 1 project (`@ptah-extension/shared`).
   - Outcome: PASS (exit 0): 51 suites and 1,231 tests passed.

Post-edit scoped diagnostics for `rpc.types.ts`: 0 errors, 0 warnings. `git diff --check` for the owned source file passed.

## Plan deviations

None. The out-of-scope OAuth error was reported and not edited.
