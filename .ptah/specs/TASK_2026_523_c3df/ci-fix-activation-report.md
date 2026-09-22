## Root cause

The fatal missing registration is `AUTH_PROVIDERS_TOKENS.SDK_CURATOR_PROXY_MANAGER` (`Symbol(SdkCuratorProxyManager)`). It is required by `ProviderAuthResolver`; the earlier defensive registration registered the resolver alone, without its proxy-manager graph.

The complete CI log (`gh run view --job 106765418882 --log-failed`) and a locally built production bundle reproduce the same chain. Inspection of the actual minified constructor assignments confirms:

| Bundle name | Source constructor | Zero-based parameter | Injection |
| --- | --- | --- | --- |
| `Zv` | `ConfigScopeRpcHandlers` | `#4`, `authHandlers` | concrete `AuthRpcHandlers` |
| `Ib` | `AuthRpcHandlers` | `#14`, `draftVerification` | `SDK_DRAFT_VERIFICATION` |
| `vM` | `DraftVerificationService` | `#2`, `resolver` | `SDK_PROVIDER_AUTH_RESOLVER` |
| `NM` | `ProviderAuthResolver` | `#4`, `curatorProxyManager` | `SDK_CURATOR_PROXY_MANAGER` ? missing |

Tsyringe 4.10 uses `paramInfo.map(this.resolveParams(...))` and passes the array index unchanged into `formatErrorCtor`; `error-helpers.js` prints that index. Positions are **zero-based**. The new draft-verification parameter is the fifteenth parameter, index 14.

VS Code's actual `DIContainer.setup` calls phases 0, 1, 2, 3, 4 in that order. Phase 2 calls `registerAuthProvidersServices`; phase 3 registers handlers lazily. Resolution happens when activation registers the RPC surface. VS Code deliberately does **not** register Thoth, SQLite, or memory curator services. The previous defensive-registration comment claiming VS Code reached `registerThothLibraries` was wrong. Electron does call `registerCuratorAuthServices` in phase 2 before its phase-4 handlers; CLI calls it within optional curator setup. Thus this is an incomplete required auth graph, not a handler cycle or an injection that should be optional.

Both `expected-resolvable.ts` manifests already include `ConfigScopeRpcHandlers`. Their minimal smoke containers had not been updated, failing earlier at `WorkspaceScopeResolver` (#2) rather than exercising the real auth graph. VS Code's `expected-absent.ts` correctly keeps memory/SQLite handlers absent and does not exclude config scopes. This checkout has no Electron `expected-absent.ts` counterpart. `di-lint` passes even before the fix because the missing token is registered somewhere in the repository; it does not prove that VS Code reaches that registration.

## Fix

- Replace the resolver-only defensive registration with a call to the existing `registerCuratorAuthServices` from required auth registration. This installs the complete resolver, manager, and four proxy registrations on every host without enabling memory/SQLite services. Registration is lazy; proxy listeners are not started by this call.
- Make that existing registration function idempotent when its resolver and manager are already registered. Electron/CLI's subsequent calls retain the same live singleton graph instead of replacing it.
- Register `CuratorProxyManager` through the existing `instanceCachingFactory` pattern. The new real-container regression exposed a second issue with decorator metadata enabled: tsyringe tried to resolve the manager's defaulted numeric TTL test seam as `Number`. The factory passes its five real dependencies and preserves the default TTL.
- Add a regression that resolves the actual draft verifier/resolver/proxy graph through required auth registration without any curator setup, plus a singleton-preservation test. Host auth boundaries and the internal query boundary are test doubles; resolver and proxies are real.
- Supply the three missing config-scope dependencies in both minimal host smoke fixtures. The peer double is typed as `Pick<AuthRpcHandlers, 'invalidateAuthStatusCache'>`. The separate auth-registration regression and real bundled activation cover the deeper graph.

No injection was made optional. Decoupling the two handlers would merely move this failure to direct auth-handler resolution, so it was not used as a remedy.

## Files changed

Paths below are relative to `D:\projects\ptah-extension\.claude-worktrees\task-523-group-d`:

- MODIFIED `libs/backend/auth-providers/src/lib/di/register.ts` ? complete, idempotent required auth graph; cached manager factory.
- CREATED `libs/backend/auth-providers/src/lib/di/register.spec.ts` ? required-registration and singleton regression tests.
- MODIFIED `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts` ? config-scope fixture dependencies.
- MODIFIED `apps/ptah-electron/src/di/container.smoke.spec.ts` ? same fixture correction.
- CREATED `.ptah/specs/TASK_2026_523_c3df/ci-fix-activation-report.md` ? this report.

Stack observed: Node 24 / TypeScript 6.0.3; tsyringe 4.10 constructor injection and symbol tokens; Zod 4.6.5 RPC validation. Versions come from the workspace manifest/lockfile; registration conventions from auth-provider registration and `providers/register-providers.ts`. No new framework, token, abstraction, or external boundary was introduced.

## Verification

All Nx commands set `NX_DAEMON=false` and `NX_CACHE_DIRECTORY=D:\projects\ptah-extension\.nx\verify-ci-di`. Raw logs are saved as `activation-*.log` in this worktree root.

### Reproduction before the fix

1. `npx nx run ptah-extension-vscode:build-esbuild --configuration=production --skip-nx-cache` ? production bundle built successfully, including its 25 dependencies (`activation-build-before.log`).
2. `npx nx run ptah-extension-vscode-e2e:e2e --excludeTaskDependencies --skip-nx-cache` ? ran that exact production bundle in an isolated VS Code 1.138.0 extension host. Output (`activation-e2e-before.log`):

```text
===== PTAH ACTIVATION FAILED =====
[Activate] message: Cannot inject the dependency "a" at position #4 of "Zv" constructor. Reason:
    Cannot inject the dependency "b" at position #14 of "Ib" constructor. Reason:
        Cannot inject the dependency "r" at position #2 of "vM" constructor. Reason:
            Cannot inject the dependency "a" at position #4 of "NM" constructor. Reason:
                Attempted to resolve unregistered dependency token: "Symbol(SdkCuratorProxyManager)"
Error: 3 e2e test(s) failed
Exit code: 1
```

3. `npx nx run @ptah-extension/auth-providers:test --testPathPatterns=di/register.spec.ts --runInBand --skip-nx-cache` ? the new regression failed on the same token before production edits (`activation-regression-before.log`):

```text
Cannot inject the dependency "curatorProxyManager" at position #4 of "ProviderAuthResolver" constructor. Reason:
    Attempted to resolve unregistered dependency token: "Symbol(SdkCuratorProxyManager)"
Test Suites: 1 failed, 1 total
Tests:       2 failed, 2 total
```

4. Both initial host smoke runs failed resolving config scope at `Symbol(WorkspaceScopeResolver)` (`activation-smoke-before.log`). The fixture corrections address this separate test-harness omission.

### After the fix

- `npx nx run @ptah-extension/auth-providers:test --runInBand --skip-nx-cache` (`activation-auth-tests.log`):

```text
Test Suites: 43 passed, 43 total
Tests:       790 passed, 790 total
Snapshots:   2 passed, 2 total
NX Successfully ran target test for project @ptah-extension/auth-providers
```

- `npx nx run-many -t lint,typecheck -p @ptah-extension/auth-providers ptah-extension-vscode ptah-electron --skip-nx-cache` (`activation-checks-after.log`):

```text
NX Successfully ran targets lint, typecheck for 3 projects
```

- `npx nx run di-lint:lint --skip-nx-cache` (`activation-di-lint-after.log`):

```text
di-lint OK: 1574 @inject sites all resolve to a registered token (706 tokens); every container-constructed class names all required and non-equivalent defaulted dependencies
NX Successfully ran target lint for project di-lint
```

- `npx nx run-many -t test -p ptah-extension-vscode ptah-electron --excludeTaskDependencies --runInBand --skip-nx-cache` (`activation-host-tests-after.log`), after both apps' required build artifacts had been generated:

```text
NX Running target test for 2 projects:
- ptah-extension-vscode
- ptah-electron
? nx run ptah-extension-vscode:test --runInBand
? nx run ptah-electron:test --runInBand
NX Successfully ran target test for 2 projects
```

- `npx nx run ptah-extension-vscode:build-esbuild --configuration=production` with `NX_ISOLATE_PLUGINS=false` (`activation-build-after-retry.log`):

```text
NX Successfully ran target build-esbuild for project ptah-extension-vscode and 25 tasks it depends on
Nx read the output from the cache instead of running the command for 1 out of 26 tasks.
```

The cache hit was the shared-library dependency; the production extension bundle was rebuilt.

- `npx nx run ptah-extension-vscode-e2e:e2e --excludeTaskDependencies --skip-nx-cache` with `NX_ISOLATE_PLUGINS=false` (`activation-e2e-after.log`) ran the rebuilt production bundle in the real isolated VS Code 1.138.0 host:

```text
? activate() resolves without throwing (8232ms)
? extension activates past the license gate (community path) (0ms)
? every RPC method in the registry has a registered handler (1ms)
? no orphan RPC handlers (registered but not in the registry / wrongly excluded) (1ms)
? activation does not leave the host with pending unhandledRejections (1508ms)
10 passing, 0 failing (9751ms)
Exit code: 0
NX Successfully ran target e2e for project ptah-extension-vscode-e2e
```

The activation failure is reproduced before and absent after the fix. All requested project tests, lint/typecheck targets, di-lint, production bundle build, and real activation checks passed. The downloaded VS Code runtime also logged a TextMate worker dynamic-import fetch error; it did not fail the activation/RPC/unhandled-rejection assertions.

## Deviations

- Used the explicit production `build-esbuild` target, followed by the real e2e target with dependency rebuilding excluded, to preserve the exact before/after bundle under test. This is the target declared by the repository; it is not a custom activation harness.
- One post-fix build attempt failed before compilation because the Nx package-json plugin worker did not receive its load message within ten seconds. Retried with `NX_ISOLATE_PLUGINS=false`, a supported switch verified in installed Nx source. No Nx reset, dependency install, or shared checkout edit was performed.
- Included the defaulted-TTL factory correction because the real registration regression exposed it. An intermediate smoke-fixture compile error from an overly broad inferred class type was corrected with a typed `Pick` test double.
- No `AGENTS.md` or `CLAUDE.md` exists in this worktree; read its contribution/readme/task documents and followed the supplied project guidance. No state/carrier documents were edited.

## Not done

- No required verification remains outstanding.
- No handler decoupling, unrelated frontend fixes, native dependency installation, or release packaging was performed.
- No changes were made to the other lanes' files or task state documents. No git commands, commits, staging, pushes, or main-checkout source edits were performed. The explicitly requested shared Nx cache and existing node_modules junction were used.
