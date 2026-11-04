# Fix 1 report: TASK_2026_865_2a1d (code-logic-review Finding 1, Serious)

## Finding

Every eligibility check (`chat:carry-over-check`, which drives the banner offer and the /compact
check) ran `newSessionReady`. That calls `prepare(..., undefined, true)`, then
`resolveExecutionProfile`, then `resolveProviderProfileForWorkspace`, then `buildProfile`, then
`buildProxyProviderProfile`, then `proxyPool.acquire`. The pool has no idle TTL and no
per-acquire release. It stops a proxy only through `disposeForScope` (when the workspace is removed)
or `disposeAll` (at shutdown). So a check that the user never clicked started a
credential-bearing proxy and kept it running.

## Files changed

- MODIFIED `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over.service.ts`
- MODIFIED `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over.service.spec.ts`

Only files in `libs/backend/rpc-handlers` changed. I made no edit in `agent-sdk`, `auth-providers`,
`codex-runtime` or any frontend lib.

## The fix

- `evaluate` now takes a `ProbePurpose`: `'offer'` from `check()` and `'launch'` from
  `carryOver()`.
- `newSessionReady(folder, probeTabId, activeId, purpose)` returns `true` without resolving a
  profile when the purpose is `'offer'` and `acquiresProxyOnProbe(activeId)` is true. That helper
  is true when `providerId !== 'openai-codex'` and `getAnthropicProvider(providerId)?.requiresProxy === true`.
  This is the same registry flag that `WorkspaceProviderProfileResolver.buildProfile`
  (`workspace-provider-profile-resolver.ts:509`) uses to route to `buildProxyProviderProfile`. It
  covers built-in entries (openrouter, github-copilot, lm-studio, sakana, kimi-code,
  opencode-zen/go) and custom `lane: 'openai'` entries.
- Codex is excluded from the skip. Its native path never reaches the pool. Its legacy path is
  refused by `rejectLegacyCodexProfile()` (`:274-276`) before any acquisition, and the pool itself
  throws for `openai-codex`. So the Codex probe, including `codexAuth.isAuthenticated()`, still
  runs on every check.
- Direct providers (claudeCli, apiKey, direct third-party providers such as requesty or ollama)
  build an in-memory profile only (batch-4 note A3). The check still probes them fully.
- The order of the earlier checks is unchanged (K22): folder, stored identity, provider
  comparison, then the probe. The probe still never calls the old provider. It receives no stored
  identity, and the skip short-circuits before any resolver call.
- The launch path is unchanged. `carryOver` uses `'launch'`, so it runs the full `prepare`
  readiness and then the F1 re-check of the active provider (`resolveActiveAuthForPath`) and
  `startSession(..., { expectedProviderId })`. The proxy that the click acquires is reused by the
  real start, as before.
- `chat:continue`, `continueSession` and the AUTH_REQUIRED refusal contract are not touched.

Behaviour change: for a proxy-backed active provider, the offer is now decided by the folder,
stored-identity and provider-mismatch checks only. If that provider is not ready (missing
credential or proxy start failure), the click fails through the full launch probe. It returns
`NOT_ELIGIBLE` from the probe, or `START_FAILED` with the start's `errorCode` (for example
AUTH_REQUIRED) from `startSession`. It no longer hides the button ahead of time. The offer also
skips `prepare`'s workspace-authorization check for these providers. The launch path still runs
that check, and the folder must already equal the session's own folder.

## Tests

I added `describe('check: no lasting side effect (review fix 1)')` to
`chat-carry-over.service.spec.ts`:

- `it.each(['openrouter','github-copilot','lm-studio'])`: a check without a click acquires no
  proxy. The result is eligible, and `prepare`, `resolveProviderProfileForWorkspace` and
  `startSession` are not called.
- With no runtime profile bound, the check acquires no proxy: the no-runtime-profile branch does
  not call `resolveProviderProfileForWorkspace`.
- A provider switch after a check leaves no retained probe proxy. A check on openrouter, then a
  switch to github-copilot, then a second check: neither check resolves a profile. The click then
  runs `prepare` exactly once and starts with `expectedProviderId: 'github-copilot'`.
- A direct (non-proxy) provider is still probed by the check. With requesty and a throwing
  `prepare`, the result is `{ eligible: false }` and `prepare` is called once.

The existing test "a third-party target is named from the provider registry" (openrouter) still
passes.

## Verification

- Jest, changed spec only, under the lock:
  `node scripts/verify.mjs --exec --task fix1-jest -- npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over.service.spec.ts`
  Result: `Test Suites: 1 passed, 1 total`, `Tests: 36 passed, 36 total`, exit code 0.
  The run printed an ESM-loading warning for `jest.config.ts`; it did not affect the result.
- `ptah_get_diagnostics`, scoped to the 2 changed files and called 3 times: unavailable each
  time. The result was "TypeScript check still running after 45s", so both files are unchecked.
  No typecheck result is claimed. ts-jest compiled both files during the passing run above.
- As instructed, I did not run `npm run verify`, lint, typecheck, build or any workspace-wide
  check. CI runs them.

## Decisions

- **Decision**: the offer check skips the readiness probe for proxy-backed providers. It does not
  lease and release a probe proxy.
  - **Options**: (a) a read-only readiness query that does not acquire; (b) a probe lease/release
    on the pool; (c) skip the proxy acquisition in the offer and let the click's full probe and
    start decide.
  - **Evidence**: `ProviderProxyPool` (`libs/backend/auth-providers/src/lib/auth/provider-proxy-pool.ts`)
    exposes only `acquire`, `disposeForScope` and `disposeAll`. It has no per-acquire release, and
    `disposeForScope(workspacePath)` releases every holder in that workspace, which would stop a
    proxy that an active session holds. The proxy's readiness (credentials per provider, Copilot
    and Kimi restore, Sakana key, custom base URL, port start) lives inside the pool's private
    builders. Re-checking it in rpc-handlers would duplicate those rules. Options (a) and (b) both
    need changes in `auth-providers`, which is outside this fix's allowed scope (rpc-handlers, plus
    agent-sdk for a read-only method only). Option (c) uses the same registry flag
    (`requiresProxy`) that the resolver uses to decide whether to acquire.
  - **Reversible**: yes. If `auth-providers` later gains a side-effect-free
    `isProviderReadyForWorkspace` (or a lease API), `newSessionReady`'s `'offer'` branch can call
    it in place of `return true`.
- **Decision**: Codex stays fully probed in the offer. Its registry entry has
  `requiresProxy: true`, but neither the native path nor the refused legacy path acquires a pooled
  proxy (`workspace-provider-profile-resolver.ts:197-276`).
