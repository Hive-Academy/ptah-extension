# Task report: CodeRabbit findings on PR #881

Worktree: `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a` (branch
`feat/codex-removal-a`). All four findings were verified against the code before
any change. No npm/nx/jest/lint/typecheck/build/verify commands were run and no
git write commands were issued (the coordinator runs checks and git).

## Finding 1 — malformedPage mapping (codex-runtime-composition.ts:~671)

**Verdict: fixed (real defect).**

Verified chain before the fix:

- `CodexSessionHistoryError` carries `malformedPage`
  (libs/backend/codex-runtime/src/lib/codex-session-history.ts:16-18, thrown from
  many read paths).
- The Electron history port collapsed every `CodexSessionHistoryError` except
  `threadNotFound` and `homeMismatch` into `runtimeFailed`
  (apps/ptah-electron/src/di/codex-runtime-composition.ts:665-672).
- The router passes `ElectronCodexHistoryError` through unchanged
  (libs/backend/agent-sdk/src/lib/codex-app-server/session-history-router.ts:103-104).
- `nativeHistoryRpcError` maps `malformedPage` to `HISTORY_MALFORMED`
  (libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.ts:55-58),
  but it never received that code from Electron, so the client always got
  `HISTORY_FAILED` from the generic `runtimeFailed` path.

Change:

- `apps/ptah-electron/src/di/codex-runtime-composition.ts:506` — added
  `'malformedPage'` to `ElectronCodexHistoryErrorCode`.
- `apps/ptah-electron/src/di/codex-runtime-composition.ts:521` — added its fixed
  message (`Record<ElectronCodexHistoryErrorCode, string>` is the only exhaustive
  consumer of the union; no other switch/Record needed updating).
- `apps/ptah-electron/src/di/codex-runtime-composition.ts:673-674` — forwards
  `error.code === 'malformedPage'` as `ElectronCodexHistoryError('malformedPage')`
  before the `runtimeFailed` fallback, so the router and
  `nativeHistoryRpcError` deliver `HISTORY_MALFORMED` to the client.

Spec:

- `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts:256-263` — new
  test pins `CodexSessionHistoryError('malformedPage')` →
  `ElectronCodexHistoryError('malformedPage')` with scope disposal. The RPC leg
  (`malformedPage` → `HISTORY_MALFORMED`) was already pinned in
  libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.spec.ts:195-218.

## Finding 2 — Codex refusal keyed on the proxy token (ptah-cli-registry.ts:~821)

**Verdict: fixed (real defect; the reviewer's reading of the fallback is correct).**

Verified against the code:

- `openai-codex` has `requiresProxy: true` and no `apiKeyFallback`
  (libs/shared/src/lib/providers/entries/codex-provider-entry.ts:78-93).
- `buildProxyAuthEnv` therefore calls `createProxyForProvider`, which has no
  Codex factory (`isOpenCodeProviderId` matches only `opencode-zen`/`opencode-go`;
  the other branches are `sakana` and `lm-studio`), so it returns `undefined` and
  the code falls back to the direct `buildAuthEnv` path
  (ptah-cli-registry.ts:1262-1281, 1323-1346 in the pre-change file).
- `buildAuthEnv` sets `ANTHROPIC_AUTH_TOKEN` to the agent's stored key, and
  reserved placeholders are rejected at input (`assertNotReservedKey`), so the
  check `authEnv.ANTHROPIC_AUTH_TOKEN === CODEX_PROXY_TOKEN_PLACEHOLDER` can never
  fire for a real Codex agent. Such an agent proceeded through proxy setup,
  harness sync and spawn-option assembly, then spawned against the provider's
  empty `baseUrl` instead of being refused.

Change (guards keyed on the provider id, placed after provider resolution and
before credential, proxy, harness or spawn work; message matches the shared
refusal text in auth-providers' `codex-native-runtime-refusal.ts`, which is not
exported from that package's public index, so it is declared as a local constant):

- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:1636-1641` —
  local `CODEX_NATIVE_RUNTIME_REQUIRED_MESSAGE` constant.
- `ptah-cli-registry.ts:735-739` — `spawnAgent` throws
  `AuthRequiredError(..., { providerId: 'openai-codex' })` before
  `resolveAgentCredential` (the same error shape the old backstop threw).
- `ptah-cli-registry.ts:508-514` — `getProfile` warns and returns `undefined`
  (its established failure mode) before credential resolution.
- `ptah-cli-registry.ts:577-583` — `testConnection` returns
  `{ success: false, error: <message> }` before credential resolution.
- The existing placeholder checks (now `ptah-cli-registry.ts:609`,
  `ptah-cli-registry.ts:841`) are kept as the stale-key backstop and now use the
  same constant. They are pinned by the existing "stale Codex placeholder" specs
  (a stored key equal to the placeholder) and remain reachable for non-Codex
  agents; removing them would send a stale placeholder key upstream as a bearer
  token.

Spec:

- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-spawn-model.spec.ts:232-243`
  — `spawnAgent` refuses an `openai-codex` agent with `AuthRequiredError` before
  the SDK query function loads.
- `ptah-cli-registry-spawn-model.spec.ts:246-267` — `testConnection` returns the
  refusal and `getProfile` returns `undefined` for an `openai-codex` agent; the
  SDK query function is never loaded.
- `ptah-cli-registry-spawn-model.spec.ts:156` — fixture `configPersistence` gained
  `ensureMigrated` (getProfile calls it first).

## Finding 3 — frame buffer shrink (codex-app-server-process.ts:~343)

**Verdict: fixed (real defect).**

Verified before the fix: `frameBuffer` starts at `OUTBOUND_FRAME_BYTES` (1 MiB,
codex-app-server-process.ts:141), grows up to `INBOUND_FRAME_BYTES` (16 MiB,
:339-343) and is reallocated only in `close()` (`Buffer.alloc(0)`). One large
`thread/resume`/history frame therefore kept up to 16 MiB allocated per open
process for its lifetime.

Change:

- `libs/backend/codex-runtime/src/lib/codex-app-server-process.ts:355-356` —
  after a completed frame is decoded (the `subarray` bytes were already consumed
  by `JSON.parse`), a buffer larger than `OUTBOUND_FRAME_BYTES` is reallocated to
  the initial size. This sits in the frame-completion path after
  `this.frameBytes = 0`, so partial-frame bytes stay correct: the next chunk
  copies at offset 0 and the existing growth logic re-grows on demand.

Spec:

- `libs/backend/codex-runtime/src/lib/codex-app-server-process.spec.ts:696-722` —
  asserts the buffer is 1 MiB
  before the frame, shrinks back to 1 MiB after a 2 MiB frame is delivered, and
  that a following frame split across two chunks still decodes (partial bytes
  survive the reallocation).

## Finding 4 — overflow log once per root turn (codex-context.ts:~513)

**Verdict: fixed (real defect).**

Verified before the fix: `bufferEarlyChild` logged `logger.error` on every
unlinked child event once `earlyChildCount >= 64` (or the 8-thread cap was hit),
and the buffer is cleared only on a root terminal event
(`codex-context.ts:542-543` pre-change) and on `close()` (`:1106-1107`
pre-change), so a long still-running child could emit one error line per event.

Change:

- `libs/backend/codex-runtime/src/lib/codex-context.ts:97` — new
  `earlyChildOverflowLogged` flag.
- `codex-context.ts:510-518` — the overflow log is emitted only the first time
  per root turn; later dropped events stay silent. The drop behavior is
  unchanged.
- `codex-context.ts:550` and `codex-context.ts:1115` — the flag resets wherever
  `earlyChildEvents.clear()` runs (root terminal in `admitEvent`, and `close()`),
  so a later root turn can report its own overflow.

Spec:

- `libs/backend/codex-runtime/src/lib/codex-context.spec.ts:115-160` — feeds 80
  unlinked child events (64 buffered, 16 dropped) and asserts exactly one error
  log; completes the root turn (buffer cleared, flag reset); feeds 80 more and
  asserts a second error log, i.e. once per root turn.

## Changed files

Production code:

1. `apps/ptah-electron/src/di/codex-runtime-composition.ts`
2. `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts`
3. `libs/backend/codex-runtime/src/lib/codex-app-server-process.ts`
4. `libs/backend/codex-runtime/src/lib/codex-context.ts`

Specs:

5. `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts`
6. `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-spawn-model.spec.ts`
7. `libs/backend/codex-runtime/src/lib/codex-app-server-process.spec.ts`
8. `libs/backend/codex-runtime/src/lib/codex-context.spec.ts`

Not touched: `tools/mcp-bench`, `task-tracking/**` (the pre-existing
`task-tracking/landing-live-demo/HANDOFF.md` modification in the worktree was
already present before this task and was left as is).

Constraints held: strict TypeScript, no `any`/`ts-ignore`/`as unknown as`
introduced, injected loggers only (`this.logger`, `this.options.logger`,
`deps.logger` — unchanged), no verification commands run (coordinator runs
`npm run verify` and the scoped project checks).