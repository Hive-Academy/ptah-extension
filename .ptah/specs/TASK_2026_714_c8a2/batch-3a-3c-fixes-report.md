# Batch 3a/3c fix round 1

Implemented the six requested fixes and both minor review findings within the permitted source/spec files. Production App Server routing remains disabled; the facade public API is unchanged.

## Findings and regression coverage

1. **Real auth.json compatibility (review 1, 4, 9):** The local Zod boundary accepts string/null/absent auth_mode, nullable optional token fields, null tokens, last_refresh and api_base_url. Both object levels preserve unknown fields. Specs use synthetic credentials in lowercase ChatGPT, API-key with null tokens, nullable account metadata, and fully null file shapes. A facade regression verifies authentication, headers, status, freshness and endpoint without operation context. Unknown file/token metadata survives rotation.
2. **Transient refresh failure (review 2):** Only HTTP 401 or HTTP 4xx with invalid_grant latches the rejected refresh token. Network errors, timeouts and 503 responses allow the next call to retry. Specs cover those failures, both definitive rejection forms, and external login replacing a rejected token. Logs omit error payloads and credentials.
3. **Rotated-token persistence (review 3):** Each home retains the successful rotation independently of its disk cache. Persistence retries once after 25 ms, then on later ensureTokensFresh calls. Headers use retained tokens even after cache invalidation. A sanitized persistence-specific warning distinguishes disk failure from OAuth rejection. A different readable external login takes precedence. Specs cover rename failure, partial JSON, recovery without another OAuth request, metadata preservation, home isolation and concurrent external login.
4. **Provider intent ordering (review 5):** Native policy is evaluated before the non-thirdParty provider consistency check. Legacy mismatches throw typed SdkError; native intent returns without configuring the stale strategy. Specs cover both outcomes.
5. **Native switch teardown (review 6):** With an active managed strategy, native intent uses the existing serialized cleanup path before returning: clear configured auth, clear shared/process Claude environment and model-tier environment, await teardown, then clear the active strategy. Specs cover legacy Codex proxy -> native -> legacy and managed Claude -> native for all native reasons.
6. **Host logging (review 7):** The shared owner uses a host-level fan-out sink over a deduplicated set of injected loggers. Homes created before another facade registers also send diagnostics to the new sink. The spec verifies shared identity and exactly one diagnostic per logger even after duplicate registration.
7. **Sanitized context errors (minor review 8):** Context safeParse failures become SdkError with a fixed message, without raw Zod details or input paths. The invalid-context test checks the fixed message and that environment mutation never begins.

## File references

Paths below are relative to `libs/backend/auth-providers/src/lib/`.

| Finding | Implementation | Regression specs |
| --- | --- | --- |
| Real auth shapes, null tolerance, real fixtures | `providers/codex/codex-home-auth.service.ts:21` | `providers/codex/codex-home-auth.service.spec.ts:140`, `:150`; `providers/codex/codex-auth.service.spec.ts:153` |
| Transient vs definitive refresh rejection | `providers/codex/codex-home-auth.service.ts:566`, `:592` | `providers/codex/codex-home-auth.service.spec.ts:167`, `:184` |
| Retained rotation, persistence recovery and external-login precedence | `providers/codex/codex-home-auth.service.ts:624`, `:674`, `:778` | `providers/codex/codex-home-auth.service.spec.ts:198`, `:232`, `:282` |
| Typed provider validation after native policy | `auth/auth-manager.ts:142` | `auth/auth-manager.spec.ts:953`, `:982` |
| Serialized native teardown | `auth/auth-manager.ts:222`; documentation `auth/codex-proxy-policy.ts:5` | `auth/auth-manager.spec.ts:808`, `:961` |
| Shared logger registration | `providers/codex/codex-home-auth.service.ts:71` | `providers/codex/codex-home-auth.service.spec.ts:267` |
| Sanitized invalid context | `auth/auth-manager.ts:189` | `auth/auth-manager.spec.ts:942` |

Changed files: the six source/spec files in this table, plus this report. `codex-auth.service.ts` and `auth-strategy.types.ts` required no edits.

## Verification

Required sequence was run using PowerShell equivalents of the requested `tail`/`grep` filters (capture command output, `Get-Content -Tail 20`, or `Select-String` followed by `Select-Object -Last 10`).

```text
npx jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.spec.ts libs/backend/auth-providers/src/lib/providers/codex/codex-auth.service.spec.ts libs/backend/auth-providers/src/lib/auth/auth-manager.spec.ts --coverage=false --maxWorkers=2
```

Final result: exit 0; **3 suites passed, 126 tests passed, 0 snapshots**, 20.583 seconds. Node emitted the existing Jest-config ES-module-loading warning; it did not fail the run. The initial two-suite run found a test-only read-only fs export spy failure (68 passed, 1 failed); the partial module mock fixed it. The first expanded run passed all 126 tests in 25.289 seconds. The final run above followed the concurrent pending-state read guard.

```text
npx nx run-many -t typecheck lint -p @ptah-extension/auth-providers --parallel=1 --output-style=static
```

Final result: exit 0. `NX Successfully ran targets typecheck, lint for project @ptah-extension/auth-providers`. ESLint: **9 problems (0 errors, 9 warnings)**. The earlier pre-guard Nx run also passed both targets with the same warning count.

```text
npx prettier --write libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.ts libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.spec.ts libs/backend/auth-providers/src/lib/providers/codex/codex-auth.service.spec.ts libs/backend/auth-providers/src/lib/auth/auth-manager.ts libs/backend/auth-providers/src/lib/auth/auth-manager.spec.ts libs/backend/auth-providers/src/lib/auth/codex-proxy-policy.ts
```

Final result: exit 0; all six changed source/spec files formatted successfully after the final Jest and Nx runs.

No integration test (including translation-proxy.sdk.integration.spec.ts), build, workspace-wide verification or dependency install was run. No source outside the permitted files was edited. No required verification is deferred.

## Decisions

- Keep the external auth-file type local to the validated schema: the legacy exported CodexAuthFile declaration is outside this fix scope. No casts bypass the Zod boundary.
- Retained rotated tokens are process-memory only, scoped to the canonical home, never returned through the credential-free runtime port or included in diagnostics/events. A process exit during continuing disk failure cannot make these credentials durable.
- Retry persistence once immediately and on subsequent freshness checks; preserve the original on-disk refresh-token expectation across subsequent in-memory rotations. An external login wins over pending persistence. Readers recheck pending-state identity after disk I/O so a concurrent successful save or newer rotation cannot leave them dereferencing cleared state.
- Register all injected host logger sinks, deduplicated by identity, for the workspace provider lifetime. Directly constructed owners still use their explicitly injected logger. This avoids choosing an arbitrary first facade as the sole logger while preserving a single credential owner per host/home.
- Native intent with no active manager-owned strategy leaves unrelated host environment untouched. Switching an active managed strategy uses the established provider-switch cleanup. Context-free Claude/provider strategy routing is unchanged.
- Respect the explicit no-git instruction: no baseline git show, diff, commit, reset or push was run. Compatibility evidence is the facade regression and existing targeted tests, plus the review's existing call-surface analysis; no claim of a fresh historical source comparison is made.
- No changes to the 3d OAuth strategy files, package.json, public index, DI registration, or runtime routing.

## Additional CI fix: degradation-audit ratchet

Only comments changed in `libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.ts`; runtime behavior and baselines are unchanged. Reviewed the AST rule and its accepted `optional-capability` / `reported` annotations in `tools/degradation-audit/check-degradation.ts`.

The seven newly annotated catch sites have deliberate fallback contracts:

- Line 384: authentication status is a fail-closed probe; return unauthenticated on failure.
- Line 501: live model discovery is optional; unavailable discovery returns an empty list.
- Line 553: unexpected freshness failure already emits a sanitized warning and returns false.
- Line 640: OAuth refresh failure already reports HTTP status; definitive rejection and retry handling remain intact.
- Line 720: temporary-file cleanup is best effort after rename or a failed write; it must not replace the original persistence outcome.
- Line 811: missing auth files are debug-logged; invalid/unreadable files warn and return no credentials.
- Line 860: an unavailable/partial disk snapshot prevents persistence; pending rotated tokens remain usable, and the persistence caller retries then warns.

Raw auth/parser/Axios errors are intentionally excluded from logs because they can carry credentials or token-bearing payloads. The existing model-cache fallback annotation remains unchanged. These are explicit intentional degradations or already-reported failures, not baseline increases.

Verification: `npx prettier --write libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.ts` passed. Ran the requested `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` with PowerShell `Select-String 'auth-providers:|TOTAL'` (equivalent to the requested grep filter).

Exact filtered output:

```text
degradation-audit: per-directory totals
  libs/backend/auth-providers: 19 ok (baseline 24)
degradation-audit: TOTAL 278 unsuppressed site(s)
```

The required auth-providers ratchet passes: **19 <= 24**, with no baseline edits. The overall audit process exited **1** despite the local pass. The requested filtered output does not identify the remaining failing directory or diagnostic; this report does not claim the global audit passed. Out-of-scope sites were not changed.

The prior 126-test, typecheck and lint results above cover the unchanged executable code; those checks were not rerun for comment-only annotations.
