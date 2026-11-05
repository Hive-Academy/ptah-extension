# Review fix report

## Finding 1: persisted null

- Change: `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:1998` reads the setting as `unknown`, uses a sentinel only for an absent key, and validates present values. Persisted `null` now fails the RPC read.
- Test: `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.spec.ts:689` checks the absent default and persisted-null rejection.

## Finding 2: failed read-back after write

- Change: `libs/frontend/chat/src/lib/settings/advanced/codex-sandbox-setting.component.ts:271,432` clears the confirmed mode after failed read-back, displays “Effective policy unknown,” and offers reload. Successful reload restores the confirmed mode.
- Tests: `libs/frontend/chat/src/lib/settings/advanced/codex-sandbox-setting.component.spec.ts:274,282` check indeterminate and acknowledged writes and reload recovery.

## Finding 3: Windows network wording

- Change: `libs/frontend/chat/src/lib/settings/advanced/codex-sandbox-setting.component.ts:57` says Windows network blocking is incomplete and Codex may still connect.
- Test: `libs/frontend/chat/src/lib/settings/advanced/codex-sandbox-setting.component.spec.ts:133` checks the option text.

## Finding 4: stale pending messages

- Change: `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-message-router.service.ts:324` marks every remaining entry from the superseded session failed and removes it from the queue.
- Test: `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-message-router.service.spec.ts:262` checks both queued messages become terminal and neither is forwarded.

## Verification

- Called `ptah_get_diagnostics` twice, scoped to the six changed TypeScript files. Both calls returned unavailable because the TypeScript check was still running after 45 seconds.
- Started the permitted single CLI runtime Jest spec in process. Jest warned that it could not load the TypeScript Jest config as an ES module and produced no test result; the process was stopped after it remained idle.
- Did not run Nx, build, serve, e2e, or workspace wide checks.

## Decisions

- Used an absence sentinel for the RPC read so only a missing key receives the default; persisted null and other invalid values remain subject to schema validation. Reversible.
- Kept the Windows limitation in the option description itself so it is visible at the choice. Reversible.
