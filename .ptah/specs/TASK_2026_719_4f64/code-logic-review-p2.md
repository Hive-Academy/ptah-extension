# P2 Account core — independent code-logic review

Verdict: **REVISE**  
Score: **7/10**  
Review family: **reviewer codex, implementer Claude**

Scope: `ada51ea3b..f5812cb6e` under `libs/`, plus migration commit `30318803b`. The contents of `ada51ea3b` itself were excluded. Findings below concern P2. No source files were edited.

## Findings

1. **Serious — Auth children no longer enforce the reserved directory's physical identity.**

   **Locations:** `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts:287`; `libs/backend/auth-providers/src/lib/accounts/claude-route-certifier.ts:139`; `libs/backend/auth-providers/src/lib/accounts/claude-login-console.ts:97`.

   **Scenario:** Sign-out reserves profile A and validates its directory. While asynchronous policy/version checks run, that directory is moved and its old path replaced with a junction to another clean account directory B. `authContext` only passes the canonical path to `prepare`; `checkCoverage` scans settings but never compares the reserved filesystem identity. The subsequent `auth logout` has neither revalidation nor a `launchGuard`, so it operates on B's credentials under A's reservation. Sign-in and status polls have the same stale-path problem, with a much longer replacement window during pending sign-in. Comparing the status's directory string cannot establish physical identity.

   This is a regression: the removed command implementation revalidated before spawn, supplied a file-identity launch guard, and revalidated after close. The B8b deviation says the guard is unnecessary because `prepare` revalidates the route; that premise is false. Only run certification's final step revalidates, and auth actions do not call that step. This deviation therefore breaks account isolation.

   **Fix:** Carry the reserved route identity through the auth context. Restore immediate pre-spawn file-identity guards for status, logout and login-console launches, including the worker-side guard; revalidate before recording auth results. Return `route-changed` and settle according to actual child termination. Add a regression that replaces the directory after reservation/coverage and asserts zero logout/console launches against the replacement.

2. **Moderate — A late probe close can never unblock a pending auth operation.**

   **Locations:** `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts:308`; `libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.ts:67`; `libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.ts:481`.

   **Scenario:** A sign-in status child reaches its timeout and kill grace without closing. The command returns `terminated:false` and removes its close listener; the ledger increments an irreversible counter. The child then closes, and a later poll proves successful sign-in. All processes are now closed, but `allClosed()` can never become true, so completion returns `busy`, the profile remains pending, and its persisted operation requires manual recovery. Registry probes can produce the same permanent exclusion.

   The B8b report explicitly documents this deviation. However, Component 6 requires per-child tracking with listeners retained until disposal so late closes count. Accepting a permanently unproved boolean instead fails that requirement. Existing specs check retention after an unproved result and late console closure, but cannot exercise late status closure through the real command-to-ledger contract.

   **Fix:** Return an operation-owned close receipt/subscription for each probe, preserve observation after the bounded initial wait, and update a per-child ledger when close is actually seen. Keep exclusion until that proof; never reclaim by elapsed time or PID. Add a test covering timeout/grace, subsequent close, then successful completion, plus a control that never closes and remains busy.

3. **Moderate — Malformed successful registry output is treated as positive absence evidence.**

   **Location:** `libs/backend/auth-providers/src/lib/accounts/claude-auth-settings-scan.ts:140`.

   **Scenario:** Both Policies queries return exit 0 with empty stdout, or with only four-space-indented value lines and no queried-key header. `registrySubkeys` skips every line and returns an empty set. `hiveAbsent` therefore declares the policy key absent and the full scan returns `ok:true`, despite receiving no well-formed key listing. This violates the malformed-output fail-closed requirement.

   **Confirmed:** Executed the actual scan module after in-memory TypeScript transpilation, with filesystem ENOENT fakes, fake registry replies, and an inert settings classifier. Both inputs returned `ok:true` and `policy.registry:'absent'`. No real registry or Claude process was started and no source was changed.

   **Fix:** Require the normalized queried-key header in each successful listing, reject headerless/empty output, and validate the listing structure before interpreting missing subkeys as absence. Apply the same validation to the SOFTWARE parent fallback. Add empty, whitespace-only and value-only cases to the malformed-output specs.

## Style

- The explicit `ClaudeNamedAccountPersistence` export at `libs/backend/auth-providers/src/index.ts:4` is the planned host-facing adapter export. It does not accidentally export the store, certifier, command or route-resolution internals. No change requested.
- B9 avoids a `cli-agent-runtime` import and uses a local structural lane-reference shape, preserving the intended boundary. Consider explicitly implementing the available agent-sdk persistence interface so future contract changes are compiler-checked; the comment currently asserts implementation without an `implements` clause.
- The new class-token factories and injected collaborators are wired in B8. Deferring adapter registration to Electron B17 is intentional, not a missing P2 registration. The factories follow the existing library registration pattern.
- Reviewed catches generally return fixed refusal codes or preserve exclusion; no new raw error logging was found. The lifecycle loss in finding 2 is consequential even though its catch paths are annotated. Instance spies in the specs are legitimate; no new module-namespace spy or `process.cwd()` use was found in the changed specs examined.

## Decisions

- Lease acquisition and binding commit are correctly separated: acquisition creates only a lease; commit checks live ownership, run, epoch, known identity and binding absence, then inserts only the binding. Release/retain use the lease epoch rather than a missing binding's default epoch.
- Migration 0060 consistently matches run/provider/profile/fingerprint before backfilling. Inconsistent named leases and bound ambient leases remain quarantined rather than deleted; auth exclusion counts them. The migration spec covers preservation, quarantine, constraints and registration. Mechanical version pins were skimmed.
- Resume may acquire a replacement lease after the prior lease is released, returning the existing binding. The UNIQUE run constraint prevents a second simultaneous lease, and commit refuses a second binding. A newer profile epoch is intentionally permitted subject to later identity proof; that documented choice is accepted.
- Reviewed pre-commit refusal paths release on proven termination and retain otherwise. The three-route tests and stateless adapter avoid cross-profile state sharing. Class O refusal precedes run identity comparison; class O auth visibility/sign-out is intentionally allowed.
- Run-boundary checks refuse changed executable size/mtime, stat failure and uncovered versions/platforms. Command cache reuse re-stats the executable, and changed fingerprints force a new version probe. Registry invocation uses an absolute System32 path, `/reg:64`, a five-second limit, bounded stdout and close-based termination proof.
- Coverage-refusal branches precede settings-reading children and stop polling; unproved children block completion. Those properties do not resolve findings 1–3.
- Other documented parameter/shape deviations were accepted. Backend canonical-directory persistence and the explicitly authorized fallback script are intentional path-bearing surfaces, not privacy leaks. Parsed identities are opaque references; reviewed result/error paths do not forward email, organization, credential or CLI output. Production code reviewed does not mutate `process.env`.

## Not checked

- No Jest suite, build, install, workspace verification or e2e run was performed. Existing specs were inspected; only the isolated registry-parser reproduction described above was executed. Findings 1 and 2 are source-traced scenarios, not live reproductions.
- No real `claude`, `conhost.exe` or `reg.exe` was run. Live console behavior, OAuth, actual installed CLI output and unsupported platforms were not independently exercised.
- Later-phase Electron wiring, SDK/lane prompt-release integration and complete end-to-end resume behavior remain outside this P2 review. This report does not certify those future integrations.
- The unrelated working-tree modification to `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts` was left untouched and excluded. Known pre-existing integration-test, dependency-check and migration-lint failures were not reported as P2 defects.
