# Batch 8l-1a report — core MCP config builder and profile fields

Written 2026-10-28 by the team-leader. W = `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration`.

## Result

COMPLETE, commit `4f12d4c04` (`feat(codex-runtime): build native MCP config overrides (8l-1a)`).

## Lanes

- Glm (ptah-cli, Ollama Cloud), agent `b178fcd0-fb65-4667-b9e6-3633ac612cb5`, CLI session
  `f2770d18-7a83-4317-8d5d-efe0b1f006ca`: implementation.
- Glm fix round, agent `d53b0db6-ef22-4468-9257-37c89c5e4f80`, CLI session
  `3ac1957e-67a4-4298-a91e-55e27fe2789a` (fresh lane with a handoff brief; the resume context was
  too large): two spec-only type errors.
- `git status` after each lane: only the declared files (plus the team-leader's docs).

## Files (W/libs/backend/codex-runtime/src/)

- NEW `lib/codex-mcp-config.ts`: `CodexMcpConfigError` (codes `unresolved-reference`,
  `invalid-reference-value`, `duplicate-authorization`, `invalid-server-name`; message names the
  server only, never a value; an unsafe name is not echoed) and the pure
  `buildCodexMcpConfigOverrides(servers, secrets)`: one `mcp_servers.<name>` whole-table key per
  server; stdio `command`/`args`/`env`; http and sse `url`/`http_headers`/`tool_timeout_sec`;
  `urlReference` must resolve to the same origin and path over http(s); `authReference` ->
  `Authorization: Bearer`.
- NEW `lib/codex-mcp-config.spec.ts`: per transport, the exact `ptah` entry, urlReference checks,
  authReference, duplicate Authorization, unresolved/empty reference, unsafe name; every error
  case asserts no sentinel secret in `message` or `JSON.stringify(error)`.
- `lib/codex-runtime.types.ts`: `toolTimeoutSec`, `urlReference`, `CodexMcpSecrets`, port
  `open(profile, resume?, secrets?)`.
- `lib/codex-execution-profile.ts`: schema fields, safe server names, `mcpServers` removed from
  the fingerprint identity (DL3).
- `lib/codex-execution-profile.spec.ts`: fingerprint stable across servers/references/urls,
  contextId still changes it; unsafe names rejected with the sanitized error; new fields frozen.
- `index.ts`: exports.

## Verify (FIFO lock, scoped)

- Run 1 `npm run verify -- -p @ptah-extension/codex-runtime`: lint and typecheck PASS; test FAIL
  (2 suites did not compile: codex-mcp-config.spec.ts:21 TS2322 readonly-array narrowing;
  codex-execution-profile.spec.ts:262 TS2554 missing argument). Fixed by the lane (type guard;
  default parameter).
- Run 2 `npm run verify -- -p @ptah-extension/codex-runtime`: "Running targets lint, test,
  typecheck for project @ptah-extension/codex-runtime" (1 project) — all PASS. Test 20 suites,
  904 tests passed. Lint 0 errors, 7 pre-existing warnings (codex-runtime.ts, evidence-harness.ts;
  none in the batch files).
- Dependents (cli-agent-runtime, agent-sdk, rpc-handlers, ptah-electron) run at the end of the
  round. No other spec pins a literal fingerprint (grep).

## Open

- The thread `config` dotted-key grammar is applied by the runtime in 8l-1b and proven only by the
  coordinator probe (HANDOFF step 7).
