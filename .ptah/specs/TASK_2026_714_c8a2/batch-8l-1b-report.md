# Batch 8l-1b report — runtime applies MCP config; adapter passes secrets

Written 2026-10-28 by the team-leader. W = `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration`.

## Result

COMPLETE, commit `f3d9e950c` (`feat(codex-runtime,agent-sdk): apply MCP config on thread open (8l-1b)`).

## Lanes (all Glm, ptah-cli / Ollama Cloud)

- Implementation: agent `6f7c2204-c898-437f-82b7-baadf9e89a18`, CLI session `d9597c1b-df4c-4932-85b2-180f97eed1cf`.
- TS4111 fix in codex-mcp-config.ts (an 8l-1a file, found when agent-sdk compiled it with
  `noPropertyAccessFromIndexSignature`): agent `8931360c-5ccf-419e-84f2-6d0a0d8634e8`, CLI session
  `fe2b22b9-ceaf-40a6-92d1-3f5c4cc9d4ab`.
- Adapter spec fix (disposed shared scope on resume): agent `7c82e1ba-8669-4b27-8506-bbe884a5da23`,
  CLI session `f4ce4abf-0f5a-495c-a345-49b27697263f`.
- `git status` after each lane: only declared files.

## Files

- `libs/backend/codex-runtime/src/lib/codex-runtime.ts`: `open(profile, resume?, secrets?)`; the
  `mcpServers.length` refusal is gone, lane refusals stay first (codex-lane-profile.spec.ts still
  refused before any process dependency); `buildCodexMcpConfigOverrides` runs before the generation
  bump and spawn; `config` added to thread/start params only when non-empty and reused by
  thread/resume; the context drops the config after the request is sent. Nothing logged.
- `libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts`: 5 specs — start frame config for a
  `ptah` http server (`tool_timeout_sec` 960, no top-level `mcp_servers`), the same on resume,
  resolved Authorization header in `http_headers` with no secret in any logger call, persisted
  identity, profile JSON or fingerprint, unresolved reference refused before spawn, empty servers
  produce no `config` key.
- `libs/backend/codex-runtime/src/lib/codex-mcp-config.ts`: table builders as object literals with
  conditional spreads (behaviour and key order unchanged).
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts`: port `profile()` may
  return `secrets?: CodexMcpSecrets`; `openContext` passes it to `runtime.open`; stored nowhere.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts`: secrets reach
  `open` on start and resume; follow-up turn carries only its input; metadata saves never get it.

## Verify (FIFO lock, scoped)

`npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/agent-sdk` ("Running targets
lint, test, typecheck for 2 projects").

- Run 1: agent-sdk test/typecheck FAIL — TS4111 at codex-mcp-config.ts:119,122,150,153 (26 suites
  did not compile). Fixed (lane 8931360c).
- Run 2: agent-sdk 1 test FAIL — the new adapter spec resumed through a disposed shared scope.
  Fixed (lane 7c82e1ba).
- Run 3: codex-runtime lint/test/typecheck PASS (20 suites, 909 tests; 7 pre-existing lint
  warnings). agent-sdk test PASS (196 suites passed, 2 skipped; 4266 passed, 3 skipped),
  typecheck PASS, lint FAIL with ONLY the known pre-existing errors
  `session-query-executor.accounts.spec.ts:174,183` (no-unexpected-multiline; do not fix).

## Open / residual

- The App Server applying thread `config` dotted keys is proven only by the coordinator probe.
- A rejected thread/start logs `stderrTail(2048)` (redacted by `redactCodexDiagnostics`); if Codex
  ever echoed a header value to stderr the redaction is the only guard. Record for live test p8f.
- `codex-runtime.ts` stays over the 700-line lint warning (pre-existing).
- Dependents not yet run after 8l-1a/8l-1b: cli-agent-runtime, rpc-handlers, ptah-electron,
  gateway-chat-bridge (open signature is additive; fingerprint change is internal).
