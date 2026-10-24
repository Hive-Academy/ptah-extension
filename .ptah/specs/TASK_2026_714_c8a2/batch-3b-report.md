# Batch 3b report

Partial implementation: 3b.2 and the requested F-B/model-discovery fixes are complete. The core DTO re-export portion of 3b.1 is complete; replacing the usage service is blocked on #808. Production routing remains disabled. No git commands were run.

## Files

Workspace: `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat`.

Modified files, relative to that workspace:

- `libs/backend/auth-providers/src/lib/providers/codex/codex-provider.types.ts`
- `libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.ts`
- `libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.spec.ts`
- `libs/backend/auth-providers/src/lib/quota/readers/codex-plan-usage.reader.ts`
- `libs/backend/auth-providers/src/lib/quota/readers/codex-plan-usage.reader.spec.ts`
- `.ptah/specs/TASK_2026_714_c8a2/batch-3b-report.md` (this deliverable)

No other files were written. In particular, the existing usage service/spec and every #808-owned file remain untouched by this lane.

## Design and evidence

- `codex-provider.types.ts:90` re-exports the usage status/result DTO from the public `@ptah-extension/codex-runtime` entry point. Existing consumer import paths remain valid. `:95` adds the optional home field to the usage-read contract for the reader seam.
- `quota/readers/codex-plan-usage.reader.ts:51` preserves the second clock parameter and adds an optional third home supplier. `:61` evaluates it on every read and forwards the result with refresh and cancellation. The quota mapping is unchanged.
- `codex-home-auth.service.ts:55` resolves environment homes to case-preserving absolute filesystem paths. `:159-170` separately normalizes the auth-owner map key while passing the resolved path to the credential state. Windows case aliases and trailing separators share the core identity key without changing filesystem spelling (corrected in the follow-up below).
- `codex-home-auth.service.ts:467` and `:510` emit constant debug messages for failed HTTP model discovery and caught exceptions. Neither raw exceptions, URLs, response bodies nor credentials are logged by these additions.
- The existing tsyringe constructor-injection pattern and core composition API were checked in the current usage service, `providers/register-providers.ts:93`, and `codex-runtime/src/lib/di/registration.ts:99`. The core client's process factory is composition-owned; this lane does not construct private core process classes.

## Current-user behavior

The existing default-home usage implementation and registration are unchanged. Readers without a third argument still call usage with precisely the previous refresh/signal shape; the existing F29 spec verifies this. Clock handling, window ordering, reset conversion, plan/activity pass-through and stale behavior retain their existing mapping and tests. No Claude implementation, quota owner resolver, UI or production routing switch was changed.

The new home supplier is an additive seam, not activated for any current consumer. It must not be wired to an alternate-home production context until the blocked service delegation and same-home owner resolution are complete: the retained legacy usage implementation does not yet honor the optional home field. This batch does NOT claim multi-home usage/cache isolation is delivered.

Auth aliases now intentionally share the core's normalized key. Existing 3a home-auth specs pass, including per-home credential/refresh isolation and watcher disposal. Unknown quota/account/activity values remain absent; a new reader test verifies that no zero-valued data is invented.

## Specs

- `codex-home-auth.service.spec.ts`: existing per-home auth tests plus shared core-key aliases (`:73`), both sanitized model-discovery failure branches (`:82`), and normalized event-home expectations.
- `codex-plan-usage.reader.spec.ts`: existing quota mapping tests plus per-read home supplier/clock/cancellation (`:47`) and absent-value preservation (`:69`).

## Exact verification

Commands ran from the workspace above. PowerShell `Select-Object`/`Select-String` replace tail/grep. No install, build, e2e, workspace-wide test or translation-proxy SDK integration spec was run.

```powershell
npx prettier --write libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.ts libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.spec.ts libs/backend/auth-providers/src/lib/providers/codex/codex-provider.types.ts libs/backend/auth-providers/src/lib/quota/readers/codex-plan-usage.reader.ts libs/backend/auth-providers/src/lib/quota/readers/codex-plan-usage.reader.spec.ts

npx jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.spec.ts libs/backend/auth-providers/src/lib/quota/readers/codex-plan-usage.reader.spec.ts --coverage=false --maxWorkers=2 2>&1 | Select-Object -Last 20

npx nx run-many -t typecheck lint -p @ptah-extension/auth-providers --parallel=1 --output-style=static 2>&1 | Select-String -Pattern 'problems|Successfully|Failed| error ' | Select-Object -Last 10

npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts 2>&1 | Select-String -Pattern 'auth-providers|TOTAL'
```

- Prettier succeeded. The home-auth spec was formatted again after correcting its event expectation.
- Initial Jest run: 36 passed, 1 failed because an existing watcher expectation used the unnormalized Windows path. Corrected the expectation to the core key; final run: **2 suites, 37 tests passed**, exit 0. Node emitted its existing Jest-config module-loading warning.
- Nx: **successfully ran typecheck and lint**, exit 0; **0 errors, 9 warnings**.
- Audit: **auth-providers 19 ok (baseline 24)**; **TOTAL 276 unsuppressed sites**; exit 0, no FAIL in the requested output.
- Scoped `ptah_get_diagnostics` after edits reported no diagnostics in the five requested files. It reported a sibling error TS7053 in `codex-runtime.ts:390` concerning `threadId`. That file belongs to another lane and was not modified here. The subsequent required Nx typecheck/lint run passed; the earlier diagnostic observation is retained for transparency.

## Decisions

1. Keep the existing usage implementation until composition can register the public core client. Options: replace immediately with an unregistered dependency; add a parallel legacy fallback; defer the replacement. Chosen: defer, following the explicit #808 stop rule. Evidence: `register-providers.ts:93-96` registers the legacy class; core `di/registration.ts:99` requires host-supplied executable, profile and auth ports. This decision is reversible when composition is authorized.
2. Preserve relative auth-home handling and filesystem casing. Resolve the filesystem path, then derive a separate normalized identity key for the owner map and events. The first path supplied for an owner remains its I/O path; aliases reuse that owner. Evidence: existing resolver/auth specs and the Windows regression added in the follow-up. No public API change.
3. Log only constant model-discovery failure messages. Options: include raw error/HTTP payload or constant diagnostics. Chosen: constants, satisfying the requested debugging visibility without exposing secrets. Reversible to structured sanitized metadata if later needed.

## Blocked on #808

**3b.1 service delegation is incomplete.** `CodexAccountUsageService` still has its existing logger/auth/default-home/spawner/events constructor. The public core `CodexAccountUsageClient` needs composition-owned process/profile/executable ports and has no self-registering/default constructor. Replacing the service dependency requires registering/providing that client through the host/auth composition path; `providers/register-providers.ts` and `di/register.ts` are explicitly excluded in this assignment. Direct imports of private core process classes would violate the public-API-only constraint, and a second legacy fallback would defeat the requested replacement.

Consequently `getAccountUsage({home})` is not implemented by the retained concrete service, and `currentOwnerKey(home?)`/`clearCache(home?)` are not implemented or advertised on their interfaces. The added optional read field supports the completed reader seam only. Do not activate alternate-home reads until these methods delegate to the core and the #808-owned owner resolver uses the identical home.

Next authorized step: supply/register the core usage client with the shared home-auth owner and usage profiles, replace the concrete usage service with a default-home resolving facade, then add facade tests for default/home selection, owner/cache delegation, cancellation and close. Keep production routing gated and verify current default-home UI data against the core's returned fields before activation.

## Follow-up

Scope confirmation: this fresh lane edited only `codex-home-auth.service.ts`, its `.spec.ts`, and this report. The broader file list above describes the previous lane's work. This lane did not edit or revert any #808-owned files, codex-runtime files, gateway-chat-bridge files, or other writers' changes. It did not run `translation-proxy.sdk.integration.spec.ts`.

Corrected the Windows filesystem-path regression identified by the orchestrator. `codex-home-auth.service.ts:55` returns a resolved, case-preserving home. At `:159`, the service retains that path for `HomeAuthState` and derives a separate `normalizeCodexHomeKey` identity for map lookup and auth events. Reads, temporary writes, rename, cleanup, and watching therefore use the first supplied owner's original-case resolved path, while differently cased Windows inputs share the same credential/cache owner. Constant model-discovery diagnostics remain intact.

Added `codex-home-auth.service.spec.ts:89`, a Windows-only regression using a real mixed-case temporary directory and filesystem mocks that call the real implementations. It asserts owner equality across upper/lowercase aliases and exact original-case paths for reads, refresh writes/rename, and the watcher. This test executed on Windows in this verification. Resolver expectations in the home-auth spec now distinguish paths from identity keys. The existing `codex-auth.service.spec.ts` and its expectations were not edited; both reported failing cases pass.

Follow-up writes are limited to `codex-home-auth.service.ts`, `codex-home-auth.service.spec.ts`, and this report. No #808-owned files or routing configuration changed. The usage delegation blocker above remains unresolved.

Exact follow-up commands (PowerShell filtering substitutes for grep/tail; temporary test/Nx logs retained outside the repository):

```powershell
npx prettier --write libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.ts libs/backend/auth-providers/src/lib/providers/codex/codex-home-auth.service.spec.ts
npx jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/providers/codex libs/backend/auth-providers/src/lib/quota/readers/codex-plan-usage.reader.spec.ts libs/backend/auth-providers/src/lib/auth --coverage=false --maxWorkers=2 2>&1 | Tee-Object -FilePath "$env:TEMP/ptah-3b-followup-jest.log" | Select-String -Pattern 'Tests:|Suites:|FAIL'
npx nx run-many -t typecheck lint -p @ptah-extension/auth-providers --parallel=1 --output-style=static 2>&1 | Tee-Object -FilePath "$env:TEMP/ptah-3b-followup-nx.log" | Select-String -Pattern 'problems|Successfully|Failed| error ' | Select-Object -Last 5
npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts 2>&1 | Select-String -Pattern 'auth-providers|TOTAL'
npx prettier --write .ptah/specs/TASK_2026_714_c8a2/batch-3b-report.md
```

- Jest: **25 suites passed, 577 tests passed**, exit 0. The initial follow-up run had 576 passing tests and one test setup failure (`Cannot redefine property: readFile`); replacing namespace spies with forwarding module mocks fixed it before the successful full requested run.
- Nx typecheck/lint: **success**, exit 0; **0 errors, 9 warnings**.
- Degradation audit: **auth-providers 19 ok (baseline 24)**; **TOTAL 276 unsuppressed sites**; exit 0, no FAIL.
- Prettier completed for both changed TypeScript files and this report.
- No translation-proxy integration test, workspace-wide checks, builds, installation, or git commands were run.
