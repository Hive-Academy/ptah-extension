# Batch 56 Code Logic Review - TASK_2026_555

Disclosure: the implementation was authored by a codex CLI lane; this review is by the in-process Claude reviewer (cross-side). Read-only; no source edits, no git writes.

Verdict: APPROVED WITH NOTES. Score: 7.5/10.

Evidence: `npx nx test @ptah-extension/rpc-handlers --testPathPattern=...` ran green (132 suites, 3770 passed, 4 skipped; Nx ran all suites in the project).

## Findings

1. MODERATE - shared type no longer matches the handler. `libs/shared/src/lib/types/rpc/rpc-auth.types.ts:50-60` declares `health` as non-null, but `auth-rpc.handlers.ts` (catch branch, ~1199) now returns `health: null`. The handler is typed `health: unknown`, so the compiler does not catch it. Today no consumer reads `.health` (auth-state.service.ts:~714 uses only `data.success` and `data.errorMessage`; init.ts:~495 uses `success`). Any future reader will hit a null dereference. Fix: make `health` `... | null` in `AuthTestConnectionResponse`.

2. MODERATE - CLI JSON consumers see a shape change. `apps/ptah-cli/src/cli/commands/auth.ts:681-693` spreads the result into `auth.test.result` and always returns `ExitCode.Success`. This was already true for `success:false`, so exit codes are unchanged. Previously a thrown error aborted `callRpc` (probably a non-zero exit), and now it emits `success:false, health:null` and exits 0. A script gating on exit code will no longer notice a thrown failure. Pre-existing semantics for failure results, but this batch widens it. Fix: return a non-success exit code when `result.success === false`, or record it as a deliberate decision.

3. MODERATE - lost actionable distinction. The user-facing message for a real SDK auth failure (previously the SDK's `errorMessage`, which auth-state.service.ts shows verbatim) is now always "Could not test the connection." (final-read path, ~1178-1187). This is required by the no-raw-text rule, but the UI loses the hint. Also, `status:'error'` with no `errorMessage` still yields "Connection test timed out", which is misleading. Fix: map `health.status` ('error' vs 'initializing') to two fixed strings (for example "The provider rejected the connection." / "Connection test timed out") without using SDK text.

4. MINOR - `ptahCli:list` (ptah-cli-rpc.handlers.ts, catch ~112-118) uses `PERSISTENCE_UNAVAILABLE` for any registry failure. It is only semantically accurate when the registry reads from SQLite or settings; a bad config shape would also surface under that code. Also, an `RpcUserError` thrown by the registry or its persistence layer with a more specific code or text is now masked by the generic one. Acceptable, since no consumer branches on the code and the text is fixed. Consider rethrowing `RpcUserError` instances unchanged. Frontend consumers are fine: `ptah-cli-state.service.ts:~106` swallows with fixed console text, and `providers-settings-sections.ts:129` replaces the error with the fixed "Settings request failed".

5. OK - `auth:setApiKey`. The blank detection `params.apiKey?.trim()` in the catch is the same expression the try block uses to choose store versus delete (~1366), so it is consistent and null/undefined-safe. A missing `params` cannot reach the catch with an undefined deref, because the `!params?.provider` guard returns first. The `error` message for `'   '` is correctly "Could not delete the stored key." A tiny duplication risk exists if the branch changes; hoisting `const hasKey = Boolean(params.apiKey?.trim())` would remove it.

6. OK - leak surface. `logger.info(..., { result })` now holds only fixed text plus status and lastCheck. The `available` path clears `health.errorMessage` correctly (and `success:true` carries none). Catch blocks log `{ errorType }` only and Sentry gets a fixed-text Error with `catch (error: unknown)`. `error.name` is a developer-controlled class name, not user text.

7. OK - spec honesty and strength.
   - testConnection tests use a secret inside the SDK error for the throw, error, available and final-read paths and assert against both the RPC result and a JSON-serialized dump of logger, Sentry and Error message/stack (`diagnosticText`). Reverting to the old `throw error`, `logger.error(error)` or `health: finalHealth` would fail them.
   - The timeout test was tightened (`getHealth` mocked to 'initializing' and the exact text asserted), which is an honest correction because it would otherwise take the error branch.
   - setApiKey tests now cover the blank-key case and assert the exact log and Sentry call arguments.
   - ptahCli:list spec asserts no leak of the message or the key in the response.
   - Weak spot: `diagnosticText` serializes `logger.error` arguments, so a leak via a stringified second argument is covered; it does not cover a nested Sentry context object, but those mock calls are included in the dump. No gap found.

8. OK - harness spec. The root cause was `resolveHarnessWorkspaceRoot` trying every ancestor for `.ptah` (higher priority) before `.git`, so a stray `%TEMP%\.ptah` captured the temp workspace. The fix places a `.ptah` marker at depth zero (`workspace-root.ts:49,79-82`), and the test asserts `resolveHarnessWorkspaceRoot(root) === root`. This is honest: it does not mask a product bug, because the product walk-up behaviour is intended and documented. It does not delete anything under `%TEMP%\.ptah`. Other `mkdtempSync` fixtures in the file (user and overlay roots, lines ~317-399) are unrelated to workspace-root resolution. Minor residual: `track(makeWorkspace())` now returns the raw path, and the `expect` runs inside the test, which is fine.

9. MINOR - unrelated reformat noise in `auth-rpc.handlers.spec.ts` (the `routeHarness` block, ~2182-2250) is prettier-only churn that widens the diff. Not a logic issue.

## Five questions (brief)

- Silent failure: the testConnection catch converts an exception into `success:false` with fixed text. This is visible to the UI (error status), but is exit-0 for the CLI (finding 2).
- Unexpected user action: none new.
- Wrong answer: the "timed out" message can be shown when the SDK reports `error` with no message (finding 3).
- Dependency failure: `getHealth()` throwing mid-poll is handled; `listAgents` rejection is handled with fixed text.
- Missing: the type update (finding 1) and a CLI exit code for failed `auth test`.

No blocking or serious issues. Fix findings 1 and 3 before merge if cheap; 2 can be a follow-up.
