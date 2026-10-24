# Batch 2j — account usage client

Implemented the account usage client and the authorized minimal Batch 2d home-verification extension. Focused tests pass. Scoped compiler diagnostics are clean. The required Nx typecheck/lint invocation terminated without reporting results, so those Nx targets are **not verified**. Production Codex routing remains disabled; no registrations or public index files were changed.

## Files

All paths are under `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat`.

| Action | File |
| --- | --- |
| Created | `libs/backend/codex-runtime/src/lib/codex-account-usage-client.ts` |
| Created | `libs/backend/codex-runtime/src/lib/codex-account-usage-client.spec.ts` |
| Modified, explicitly authorized 2d extension | `libs/backend/codex-runtime/src/lib/codex-app-server-process.ts` |
| Modified, explicitly authorized 2d extension | `libs/backend/codex-runtime/src/lib/codex-app-server-process.spec.ts` |
| Replaced earlier blocker report | `.ptah/specs/TASK_2026_714_c8a2/batch-2j-report.md` |

No other files were written by this lane. No git commands were run.

## Requirement mapping

Source paths below are relative to `libs/backend/codex-runtime/src/lib/`.

| Requirement | Implementation/evidence |
| --- | --- |
| `read(home, {refresh?, signal?})` and short-lived shared process | `codex-account-usage-client.ts:114`, `:202`; composition supplies a fresh `CodexAppServerProcess` for the normalized home. The client calls start, account/rateLimits/read and close; no thread or turn requests. |
| Home-scoped cache, eligibility, misses, flights and invalidation | `codex-account-usage-client.ts:31`, `:114`, `:159`, `:186`, `:202`; normalized-home map, 30-second cache/miss lifetime, eligibility rechecked before cached data, home-scoped auth watcher. |
| Drop old-generation results | `codex-account-usage-client.ts:132`, `:159`, `:202`; invalidate clears cached data/identity/misses, detaches and aborts old flight; completion checks generation and abort state, including after process cleanup. |
| Preserve only returned usage data | `codex-account-usage-client.ts:68`; codex-specific limit bucket preferred, nullable window fields preserved, absent windows/plan/activity remain absent, no invented zeroes. Immutable result snapshots protect caches from caller mutation. |
| No raw account identifier or credentials in DTO/errors | `codex-account-usage-client.ts:172`, `:202`; accountId is retained only as a SHA-256 owner key scoped with normalized home. DTO includes no accountId, raw errors or credentials. All operational errors return a sanitized status. |
| Independent caller cancellation and cleanup | `codex-account-usage-client.ts:48`, `:176`, `:271`; one caller can abort its own wait; last waiter aborts the flight. All process exits await close. Client close aborts active work and disposes home watchers, including when eligibility remains unresolved. |
| Typed home mismatch and verified-home getter | `codex-app-server-process.ts:53`, `:65`, `:136`; validate initialize response, normalize path components/separators, compare case-insensitively on win32, reject mismatch with CodexHomeMismatchError and initiate child close. Getter is populated only after successful handshake. |
| Actual notification evidence | `codex-account-usage-client.spec.ts:292`; the shared validator now accepts account/rateLimits/updated, supplied by another lane. This lane did not modify the validator. |

Composition contract: constructor accepts `CodexHomeAuthReader`, a factory returning a fresh usage-profile `CodexAppServerProcess` for the supplied normalized home, and an optional clock function. `clearCache(home)`, `currentOwnerKey(home)` and `close()` support consumer delegation. Filesystem aliases must already be resolved by composition, as for the execution profile; the client additionally resolves lexical aliases and folds Windows path case. Neither account/read nor account/usage/read was added.

## Spec list

The new client spec uses the real shared process with fake child streams, exercising protocol validation and cleanup rather than mocking the client boundary:

- Concurrent homes with distinct quota caches and home-scoped hashed identities.
- Lexical home alias coalescing; only initialize/initialized/account/rateLimits/read sent.
- Missing quota, plan, activity and identity fields remain absent.
- Codex limit-bucket preference, reported zeroes and null values.
- Observed account/rateLimits/updated notification handling.
- Unsupported-auth and unsupported-config eligibility isolation.
- Eligibility recheck clears cached identity before returning unsupported status.
- Refresh, TTL expiry and immutable quota snapshots.
- Sanitized failures, miss backoff and refresh bypass.
- Same-home stale fallback, no fallback across homes or auth invalidation.
- In-flight invalidation drops old-generation quota/identity and preserves new cache.
- Invalidation while eligibility awaits prevents spawning.
- Independent waiter cancellation and last-waiter child closure.
- Remaining joiner receives the shared response after another caller cancels.
- Pre-aborted callers create no watcher or process.
- Mismatched server home prevents the usage request.
- Malformed provider results are sanitized.
- Close succeeds while eligibility is unresolved.
- Close releases watchers/active children and prevents subsequent reads.

The extended process spec adds successful normalized home matching/getter-before-start, typed sanitized mismatch plus child shutdown, and Windows case/separator matching. Existing process regression specs were included in the same focused run.

## Exact verification results

PowerShell equivalents of tail/grep were used to limit output. Both changed specs were included because the orchestrator extended ownership to the process spec.

1. `npx jest -c libs/backend/codex-runtime/jest.config.ts libs/backend/codex-runtime/src/lib/codex-account-usage-client.spec.ts libs/backend/codex-runtime/src/lib/codex-app-server-process.spec.ts --coverage=false --maxWorkers=2 2>&1 | Select-Object -Last 20; exit $LASTEXITCODE`
   - Initial run: exit 1; 45 passed, 1 failed. The fixture checked child exit after microtasks without awaiting the stream close event.
   - Corrected the test to await the actual child close event, then reran the same scoped command: **exit 0, 2 suites passed, 46 tests passed, 0 snapshots**, 8.882 seconds.
   - Nonfatal Node warning about loading the TypeScript Jest configuration as an ES module appeared; the command completed successfully.
2. `npx nx run-many -t typecheck lint -p @ptah-extension/codex-runtime --parallel=1 --output-style=static 2>&1 | Select-String 'problems|Successfully|Failed| error ' | Select-Object -Last 10; exit $LASTEXITCODE`
   - **Exit -1073740791**, no matching output. No successful target result was reported. Cause was not established. Not rerun, per the once-at-end verification instruction. Typecheck/lint through Nx remain unverified; no sibling-file failure can be attributed from this output.
3. `npx prettier --write libs/backend/codex-runtime/src/lib/codex-account-usage-client.ts libs/backend/codex-runtime/src/lib/codex-account-usage-client.spec.ts libs/backend/codex-runtime/src/lib/codex-app-server-process.ts libs/backend/codex-runtime/src/lib/codex-app-server-process.spec.ts`
   - **Exit 0**, all four files formatted.
4. Required `ptah_get_diagnostics`, scoped to these four absolute source paths:
   - Before focused verification: **0 errors, 0 warnings, clean coverage**, source typescript-compiler.
   - After final edits/formatting: **0 errors, 0 warnings, clean coverage**, source typescript-compiler; no sibling diagnostics reported.

No workspace-wide checks, build, e2e, install, or edits to the approval-bridge lane were performed.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Extend 2d minimally in this lane to verify home and expose read-only verifiedCodexHome | Process verifies echo (chosen); client duplicates wire parsing; ignore echo | Explicit orchestrator follow-up authorized both process files. Existing initialize response includes codexHome, while prior start discarded it. | Yes; additive getter and typed error preserve existing start/request signatures. |
| Normalize handshake paths using the profile platform's path semantics and case-fold win32 | Lexical normalized comparison (chosen); byte comparison; additional filesystem reads | Profile builder already resolves its filesystem snapshot; orchestrator explicitly required normalization and Windows case insensitivity. | Yes. |
| Inject a fresh-process factory at the I/O composition boundary | Factory using committed process (chosen); duplicate process implementation; import auth-providers | Batch requires shared process and forbids auth-providers imports. The factory keeps executable/profile construction with composition and makes per-home process creation explicit. | Yes. |
| Use only rate-limit response accountId for an opaque home-scoped hash; eligibility comes from the auth reader | Hash returned accountId (chosen); add account/read; reuse raw identifiers | Explicit orchestrator identity decision and existing DTO allowlist. Raw identity never enters the usage result. | Yes; hash is in-memory only. |
| Preserve absent data and omit activity entirely when it was not returned | Report only available fields (chosen); fabricate zeroes; invoke unsupported extra methods | Batch safety contract and committed rate-limit schema. | Yes, if future supported response contracts supply activity. |
| Shared flights survive an individual caller cancellation while other waiters remain | Reference-count caller waits (chosen); initiator cancels every joiner | Same-home concurrent callers must not interfere; last-waiter abort and close release process resources. | Yes. |
| Keep 30-second cache and miss backoff, but recheck home eligibility before serving data | Existing service TTL/backoff (chosen); configurable tuning | Existing CodexAccountUsageService constants are 30,000ms; no new configuration needed. | Yes. |
| Treat the Nx termination as unverified, not as a clean check | Report exact exit (chosen); infer success from diagnostics; rerun despite instruction | Nx exited -1073740791 without target summaries. Scoped diagnostics and Jest passed independently. | Yes; invoking workflow can rerun Nx when appropriate. |

No clarification remains for implementation. Remaining verification limitation: the required Nx typecheck/lint run did not produce results.
