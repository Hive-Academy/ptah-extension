# Batch 3c report

Implemented AuthOperationContext, CodexProxyPolicy and keyed AuthManager flights. Production routing remains disabled. Scoped specs passed; project-wide verification is not clean (see below).

## Files

All paths are relative to `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat`:

- Created `libs/backend/auth-providers/src/lib/auth/codex-proxy-policy.ts`.
- Created `libs/backend/auth-providers/src/lib/auth/codex-proxy-policy.spec.ts`.
- Modified `libs/backend/auth-providers/src/lib/auth/auth-strategy.types.ts`.
- Modified `libs/backend/auth-providers/src/lib/auth/auth-manager.ts`.
- Modified `libs/backend/auth-providers/src/lib/auth/auth-manager.spec.ts`.
- Wrote this report, `.ptah/specs/TASK_2026_714_c8a2/batch-3c-report.md`.

No index, registration, provider-owner, codex-runtime, task state, or manifest files were edited. No Git commands were run.

## Design

- `auth-strategy.types.ts:20`: Zod schema validates reason, provider, optional normalized home and host intent. Missing host intent defaults false. The inferred AuthOperationContext type is at line 33; strategy operationContext is optional at line 55.
- `codex-proxy-policy.ts:3`: CodexProxyPolicy is a two-outcome type with a pure resolver. Only explicit native Codex intent outside legacy-session-start returns native-return. All other operations retain legacy-strategy.
- `auth-manager.ts:128`: preserves the legacy raw-auth-method API and adds optional context. Captures resolved provider and validated intent at submission. Third-party context supplies the operation provider rather than relying on later mutable settings. Direct/CLI provider mismatches reject before mutation.
- `auth-manager.ts:149`: flight key includes auth method, provider, home, reason and host policy. Identical outstanding operations coalesce; incompatible operations serialize behind the tail. Rejected work does not poison subsequent work, and completed flights are removed.
- `auth-manager.ts:211`: native return occurs before configured identity reset, environment cleanup, tier cleanup or active-strategy teardown. Returns configured:false with ownership details rather than claiming credentials were configured. It does not invoke a native runtime or home service.
- `auth-manager.ts:255`: explicit intent reaches the existing strategy through operationContext. Context-free callers receive the existing context shape.

Implementation follows the existing injected logger, strategy registry, ActiveProviderResolver and typed Jest harness. No logging was added for context, homes or credentials. Existing normalization logging remains.

## Default behavior evidence

Existing tests remain intact in `auth-manager.spec.ts`:

- Strategy selection, line 232: direct Anthropic API-key and Claude CLI routes, local providers, aliases, scoped defaults, and Codex/Copilot OAuth proxy routing. In particular the existing parameterized github-copilot/openai-codex test still invokes configureAuthentication('thirdParty') with no context.
- Clean slate/delegation, line 571: auth/tier cleanup, environment snapshot and shared AuthEnv identity.
- Active-strategy tracking, line 641: teardown, failure handling and clearAuthentication.
- Concurrency guard, line 739: identical calls still coalesce and failures release the guard.
- Result propagation tests remain unchanged.

The policy spec explicitly verifies omitted context and all five reasons on native-disabled hosts. No production caller was changed to opt in. No proxy implementation was removed or changed. Full-project verification failed, so this report does not claim every existing Claude/Copilot suite passed.

## Specs

`codex-proxy-policy.spec.ts`: omitted context; all five reasons with native on/off; unaffected Copilot/Anthropic/OpenRouter; false host default; malformed boundary inputs.

`auth-manager.spec.ts:793`: native startup/selection/reauth/auth-file changes preserve active Claude auth, process environment, tier mappings and teardown ownership; explicit legacy starts and Copilot still delegate; provider/home/reason/host differences serialize; matching queued requests share results; failed predecessor recovery; defensive intent snapshot; changed settings between context-free calls; invalid context and mismatched provider rejection.

## Verification

Commands ran from the assigned worktree, one project only. PowerShell Select-Object/Select-String were used as equivalents of tail/grep.

1. Ptah scoped diagnostics for the five changed TypeScript files: unavailable after 45 seconds; all five reported unchecked. No clean diagnostics result was claimed.
2. `npx jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/auth/auth-manager.spec.ts libs/backend/auth-providers/src/lib/auth/codex-proxy-policy.spec.ts --coverage=false --maxWorkers=2 2>&1 | Select-Object -Last 20`
   - Exit 0; 2 suites passed; 66 tests passed; 0 snapshots; 30.646 seconds.
   - Node emitted a warning about loading the TypeScript Jest config as an ES module.
3. With NX_DAEMON=false and CI=true: `npx nx run-many -t test typecheck lint -p @ptah-extension/auth-providers --parallel=1 --output-style=static 2>&1 | Select-String 'Tests:|Suites:|problems|Successfully|Failed| error ' | Select-Object -Last 10`
   - Nx exit 1 (captured explicitly; the output-filtering pipeline itself exited 0).
   - Suites: 2 failed, 1 skipped, 67 passed; 69 of 70 total.
   - Tests: 6 failed, 11 skipped, 1765 passed; 1782 total.
   - Output included a failed TASK_2026_408 Batch 9 S6b streamed response.failed overflow/auto-compaction retry test and test-suite-load failures. The mandated filter did not preserve their underlying errors; no suite was rerun merely to recover output.
   - Lint: 10 problems (1 error, 9 warnings), including missing package dependencies at 8:3. The filtered output omitted the package list. The manifest already declares zod 4.6.5: the dependency error must NOT be attributed to Zod without evidence.
   - Individual typecheck outcome was not retained by the requested tail/filter; no independent typecheck pass is claimed.
4. `npx prettier --write` on the five source/spec files listed above: exit 0. auth-strategy.types.ts and codex-proxy-policy.ts unchanged by formatting; the other three formatted successfully.

Unable to establish a clean project-wide gate. Follow-up: coordinating agent should inspect the complete Nx task diagnostics and assign any out-of-scope repairs. No package install, build, e2e, or workspace-wide verification was performed.

## Decisions

- Use a pure policy resolver plus CodexProxyPolicy union rather than a DI service. Evidence: the policy is a deterministic branch with no dependencies; batch scope excludes registration files. Reversible: yes.
- Native-return reports configured:false with explicit native ownership details, rather than claiming successful credential configuration. Evidence: this batch does not own the home service or a production native consumer; shared AuthEnv remains owned by the active legacy provider. Reversible: yes, when a later consumer defines its result contract.
- Preserve the raw legacy auth-method parameter, adding explicit provider identity in context, rather than reinterpreting existing raw strings. Evidence: auth-method.utils.ts and existing alias/fallback specs; Batch 3c requires current callers unchanged. Reversible: additive future overload possible.
- Capture settings and clone/validate context at enqueue time; key additionally by auth method. Evidence: different auth methods can use the same provider but different strategies; queued provider changes must not route to later settings. Reversible: yes.
- Treat normalizedHome as already normalized identity, without filesystem canonicalization. Evidence: the contract explicitly calls it normalizedHome and this batch owns neither per-home resolution nor filesystem auth. Reversible: yes.
- Leave full-suite and dependency-lint failures unresolved rather than edit files outside batch ownership. Evidence: explicit five-source-file scope and failure output lacking root causes. Requires coordinator follow-up; no default or routing behavior was changed to hide failures.
