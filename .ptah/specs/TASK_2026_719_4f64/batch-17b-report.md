# Backend implementation — `TASK_2026_719_4f64`, batch 17b (Electron half of Batch 17)

**Verdict**: DONE. The Electron named-account persistence bindings and their smoke assertions are in place. All checks are green. The handler half from batch-17-report.md is untouched.

**Tasks completed**: Task 17.1, Electron part (acceptance items 8-10) and the Smoke part. D22 style item (`implements NamedAccountPersistencePort`).

## Files (6, all absolute under the worktree `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts`)

- MODIFIED `libs/backend/agent-sdk/src/index.ts:469-477`: exports `SDK_NAMED_ACCOUNT_PERSISTENCE`, `SDK_SESSION_IMPORT_BINDING_LOOKUP`, `type NamedAccountPersistencePort` and `type SessionImportBindingLookup`. The last one was added beyond the brief so the import-lookup binding gets a compile-time `satisfies` check.
- MODIFIED `libs/backend/cli-agent-runtime/src/index.ts:49-51`: exports `CLAUDE_LANE_ACCOUNT_PERSISTENCE` and `type ClaudeLaneAccountPersistence`.
- CREATED `apps/ptah-electron/src/di/claude-named-account-bindings.ts`: `registerClaudeNamedAccountBindings(container): boolean` (see Decisions).
- MODIFIED `apps/ptah-electron/src/di/phase-2-libraries.ts:123` (import) and `:399-405`: calls the helper right after the SQLite/memory-curator try block and before `startAndRegisterLaneOutcomes`. It logs `{ bound }` only.
- MODIFIED `apps/ptah-electron/src/di/container.smoke.spec.ts`: imports (`:21-31`, `:67`, `:105`) and a new describe at `:399` "named Claude account persistence (TASK_2026_719 B17)" with 3 tests.
- MODIFIED `libs/backend/auth-providers/src/lib/accounts/claude-named-account-persistence.ts:2-3,45`: `implements NamedAccountPersistencePort` (type-only import from `@ptah-extension/agent-sdk`).

## Acceptance evidence

| Criterion | Evidence |
| --- | --- |
| Only when `SQLITE_CONNECTION` is registered | The helper returns `false` and registers nothing unless `container.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION, true)`. Spec "keeps the null defaults when SQLITE_CONNECTION is not registered": `SDK_NAMED_ACCOUNT_PERSISTENCE` and `SDK_SESSION_IMPORT_BINDING_LOOKUP` resolve `null`, the lane token is unregistered, and `SdkQueryRunner.accountPersistence` is `null`. |
| `registerSingleton(ClaudeNamedAccountPersistence)` and three tokens bound to it | `claude-named-account-bindings.ts:31-41`. Each token is bound with a `useFactory` that resolves the singleton and is checked with `satisfies NamedAccountPersistencePort`, `SessionImportBindingLookup` or `ClaudeLaneAccountPersistence`. tsc passes, so the adapter structurally satisfies the lane port. Spec: all three tokens resolve to the same instance (`toBe(adapter)`). |
| `SdkQueryRunner.accountPersistence` non-null | Spec: it resolves `SDK_TOKENS.SDK_QUERY_RUNNER` and checks that `accountPersistence` is not null and is the adapter. |
| Selection reader non-null | Spec: `AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_SELECTION_READER` resolves not null through the real `registerAuthProvidersServices`. |
| Handler resolves with the actions token | Already covered by the B17 handler-half test "resolves ProviderAccountRpcHandlers once…" (`container.smoke.spec.ts:~357`), which still passes. |
| Registration order and override | `registerSdkServices` (phase 2, earlier) binds both SDK tokens to `useFactory: () => null`. tsyringe resolves the last registration, so the later helper registrations override them. The spec runs the real `registerAuthProvidersServices` and `registerSdkServices` first, as phase 2 does. No phase-2 code resolves `SdkQueryRunner` or `SessionImporterService` before the helper call (checked every `.resolve(` in phase-2-libraries.ts). `ClaudeCliAdapter` reads the lane token lazily per run (`cli-agent-runtime/src/lib/di/register.ts:208-213`). Spec "phase 2 calls the binding helper after the SQLite block" pins that the call comes after both `registerPersistenceSqliteServices` and `registerSdkServices`. |
| `expected-resolvable.ts` unchanged; VS Code/CLI/TUI null | Neither the file nor any other composition root was edited. Those roots never call the helper, so they keep the null defaults from `registerSdkServices` and leave the lane token unregistered. |
| Module boundaries | auth-providers already depends on agent-sdk (`libs/backend/auth-providers/package.json:15`). The class gains only a type import and no cli-agent-runtime import. The app already imports agent-sdk, cli-agent-runtime, auth-providers and persistence-sqlite. eslint (`@nx/enforce-module-boundaries`) reports 0 errors. |

## Specs that mock or pin changed members (rule 5)

- `apps/ptah-electron/src/di/container.smoke.spec.ts`: edited (above).
- `libs/backend/cli-agent-runtime/src/lib/di/register.agent-process-manager.smoke.spec.ts:34,296,314,385` imports `CLAUDE_LANE_ACCOUNT_PERSISTENCE` from `./tokens`. The token is unchanged, and so is this spec.
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.accounts.spec.ts:15,109` uses `NamedAccountPersistencePort` from its source path. Unchanged.
- `libs/backend/auth-providers/src/lib/accounts/claude-named-account-persistence.spec.ts`: ran, and it passes.

## Verification (all from the worktree)

- `npx tsc --noEmit -p libs/backend/agent-sdk/tsconfig.lib.json`: 0 errors.
- `npx tsc --noEmit -p libs/backend/cli-agent-runtime/tsconfig.lib.json`: 0 errors.
- `npx tsc --noEmit -p libs/backend/auth-providers/tsconfig.lib.json`: 0 errors.
- `npx tsc --noEmit -p apps/ptah-electron/tsconfig.app.json`: 0 errors.
- `npx tsc --noEmit -p apps/ptah-electron/tsconfig.spec.json`: 0 errors.
- `npx eslint` on the 6 files: 0 errors, 1 warning. The warning is the existing `SetupRpcHandlers` unused import, now at `container.smoke.spec.ts:89` and not introduced here.
- `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/di --maxWorkers=2`: 7 suites, 72 of 72 passed (69 before plus 3 new).
- `npx jest -c libs/backend/auth-providers/jest.config.ts …/claude-named-account-persistence.spec.ts libs/backend/auth-providers/src/lib/di --maxWorkers=2`: 2 suites, 29 of 29 passed.
- `ptah_get_diagnostics`: not run. The scoped tsc runs above cover the same files.
- Not run, per the brief: `npm run verify`, builds, git.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Put the bindings in a new 6th file, `claude-named-account-bindings.ts`, called from phase 2 | (a) inline in phase-2 plus a hand-copied registration in the smoke spec; (b) helper file, run for real in the spec and call site pinned by source read | `phase-2-libraries.ts` cannot load under Jest (`phase-2-diagnostics-override.spec.ts:12-18`), and that spec already uses the source-pin plus real-logic pattern. A copy in the spec would keep passing if production drifted. The brief allowed max 6 files. | yes |
| Bind with `useFactory` + `satisfies` rather than `useToken` | `useToken` gives no type check | The brief asks for lane `satisfies`, and the same check is applied to all three | yes |
| Also export `type SessionImportBindingLookup` | leave it unchecked | It gives a compile-time check for the import-lookup binding at no runtime cost | yes |
| The smoke harness stubs leaf SDK collaborators (runtime state, module loader, subagent hook handler, compaction config, model service, auth env, platform info, metadata store) | bind their full graphs | The assertions cover only the account persistence slots, and those graphs are covered by other suites | yes |

## Plan deviations

- One extra file, the helper (Decisions row 1).
- One extra type export, `SessionImportBindingLookup`.

## Out-of-scope observations

- The unused `SetupRpcHandlers` import in `container.smoke.spec.ts` predates this batch.
