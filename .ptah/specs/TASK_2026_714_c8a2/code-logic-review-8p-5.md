# Code Logic Review - Batch 8p-5 (TASK_2026_714_c8a2)

| Metric | Value |
| --- | --- |
| Score | 9/10 |
| Verdict | APPROVED |
| Blocking / Serious | 0 / 0 |
| Moderate / Minor | 0 / 2 |

## Checks

1. URL byte-identity: PASS. `ptahMcpSessionUrl` body in `codex-ptah-mcp.ts:41-53` is character-identical to HEAD (routing-id `trim()===''` throw with the same message, `encodeURIComponent(routingId)`, empty working directory returns the scoped URL, `/workspace/` + `encodeURIComponent(wd)` terminal). `ptahMcpServerUrl` was diffed against HEAD with `diff` on the extracted function: identical (agent segment, empty agent id, empty wd unchanged). Only the doc comment changed (names the new location of the session twin).
2. No duplication or shim: PASS. `cli-adapters/index.ts` drops both `ptahMcpSessionUrl` and the `CODEX_PTAH_TOOL_TIMEOUT_SEC` re-export; the old definitions are deleted from `ptah-mcp-url.ts` and `codex-lane-config.builder.ts`. A grep of libs and apps (.ts) finds only: the definition in codex-runtime, the codex-runtime barrel (`index.ts:82-85`), and importers `codex-lane-config.builder.ts:35,151`, `codex-lane-profile.ts:2,147`, `codex-chat-host-ports.ts:17,19,329,338`. No stale importer.
3. Dependency direction: PASS. `codex-ptah-mcp.ts` has no imports at all (only comments mention cli-agent-runtime). codex-runtime has no import of cli-agent-runtime (grep), so no cycle. cli-agent-runtime already declares `@ptah-extension/codex-runtime` in its package.json and imported it before; rpc-handlers also declares it. Both libs are `scope:extension`/`type:feature`-compatible (codex-runtime tags `scope:extension`, `type:feature`).
4. MCP attachment: PASS. Chat: `codex-chat-host-ports.ts:329` builds `ptahMcpSessionUrl(PTAH_MCP_PORT, routingId, cwd)` and `:338` sets `toolTimeoutSec: CODEX_PTAH_TOOL_TIMEOUT_SEC` (=960); the attach condition around them is untouched in the diff. Lanes: `codex-lane-config.builder.ts:151` still emits `mcp_servers.ptah.tool_timeout_sec=960`; `codex-lane-profile.ts:147` still passes `ptahToolTimeoutSeconds`. Nothing stripped. Specs still pin the literal `960` (`codex-chat-host-ports.spec.ts:362`, `codex-lane-config.builder.spec.ts:61,558`, `codex-config-rejection.spec.ts:142-174`, `codex-lane-profile.spec.ts:203`).
5. Moved specs: PASS. The four `ptahMcpSessionUrl` cases in `codex-ptah-mcp.spec.ts` match the removed cases verbatim (same inputs, expected strings, `/routing id/` regex). The `960` assertion moved from the builder spec to `codex-ptah-mcp.spec.ts`. The two `jest.mock('@ptah-extension/cli-agent-runtime')` shims in rpc-handlers specs were removed; both specs import real `@ptah-extension/codex-runtime`, so the real constants flow into the `960` assertion (a stronger test, no mock drift).

## Findings

- Minor 1 - `codex-lane-config.builder.ts:35`: the builder was a pure leaf (previous codex-runtime imports in this lib were type-only, or in `codex-lane-events.ts`/`codex-lane-profile.ts` which already load the barrel). It now takes a runtime value import of the whole codex-runtime barrel. Functionally fine and consistent with the dependency direction; just confirm the cli-agent-runtime jest resolves the path alias at runtime (profile/events specs already depend on it, so expected OK; not run per instructions).
- Minor 2 - the builder spec no longer asserts the timeout constant locally, but equivalent coverage exists in codex-runtime and in the emitted-arg assertions above. No action needed.

## Five logic questions
1. Silent failure: none introduced; the empty-routing-id throw is preserved (`codex-ptah-mcp.ts:46-50`).
2. User action: none changed.
3. Wrong-answer input: identical function bodies, so encoding behaviour (Windows roots, `/sse`) is unchanged.
4. Dependency failure: no new runtime dependencies.
5. Missing: nothing; the three-twin grammar comments were updated consistently in all three places (the vscode-lm-tools `ptah-mcp-slots.ts` reference was not changed and still correct).

Verification note: static review only; no tests/builds run as instructed.
