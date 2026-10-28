# Backend implementation — `TASK_2026_719_4f64`, batch 12, WP-a

**Status**: WP-a COMPLETE. Lib and spec typecheck are clean. ESLint has 0 errors. Both WP-a specs pass (91/91). WP-b (`register.ts` and the smoke spec) was not touched.

**Tasks completed**: Task 12.1, WP-a (5 files).

## Files (all MODIFIED)

- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-options.ts`
  - `buildClaudeLaneEnv(authEnv, route?, launch?)`: a named route uses `certifiedNamedEnv` (throws `identity-unproved` when there is no launch); an ambient route uses `buildSafeEnv`.
  - New `claudeActualLaunch(options)`: maps SDK `Options` to `ClaudeActualLaunch`.
  - `buildClaudeLaneBootstrapOptions(route, launch, abort, spawner, executable?)`: refuses when there is no launch and ends with `assertCertifiedLaunch(..., 'bootstrap')`.
  - `ClaudeSdkLaneOptionsInput.launch?`: the named final run builds its env first, then uses `launch.cwd` and `[...launch.settingSources]` instead of `[]`.
- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts`
  - `ClaudeLaneAccountPersistence.checkLaunchBoundary(route, launch, boundary, signal)`.
  - `claudeLaneRefusal(code = 'release-held', message = <fixed>)` and the new `claudeLaneRefusalCode(error)`.
  - The post-init tripwire.
  - `ClaudeNamedLaneAdmission` gains `readonly certified` as its 2nd constructor parameter, a private `checkBoundary`, a version check at init, and the `boundaryUnproved` settlement rule.
  - The stale D7 comment is updated.
- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.spec.ts`
  - Fixtures now carry a launch.
  - The bootstrap fixture is extended.
  - 22 new cases.
- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts`
  - The launch is passed to the admission and to both option builders.
  - The real code is carried in the `runSdk` catch and the `prepareNamed` catch. In `prepareNamed`, the admission port's own code wins.
- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.spec.ts`
  - The fixture now has a launch, a personal `accountInfo`, `claude_code_version` and `checkLaunchBoundary`.
  - 3 identity expectations changed from `release-held` to `identity-unproved`.
  - New describe block with 12 cases.

## Acceptance evidence

| Bullet | Evidence |
| --- | --- |
| Named without a launch throws `identity-unproved` and makes no SDK call | Runner spec "refuses a named route without a certified launch before any SDK call" covers both builders throwing, plus admission `bootstrap` with `queryMock` and `checkLaunchBoundary` never called. Adapter spec "refuses a named lane without a certified launch before any SDK call" checks that `query` is not called and the reservation is released once. |
| Bootstrap uses `assertCertifiedLaunch(...,'bootstrap')` | `buildClaudeLaneBootstrapOptions` ends with the assert, and `ClaudeNamedLaneAdmission.checkBoundary` asserts again before `open`. Runner spec "builds a bootstrap that passes the bootstrap check and nothing else" also shows that executable drift gives `route-changed`. |
| Named final uses `launch.cwd` and `launch.settingSources` | Runner spec "uses the certified cwd and sources ..." checks that `assertCertifiedLaunch(launch, claudeActualLaunch(options), 'final')` does not throw. Adapter spec "awaits both boundary checks ..." checks the final query's `cwd`, `settingSources` and `env` against the launch. |
| `claudeLaneRefusal(code)` carries the real code | Runner spec "keeps the real refusal code and maps foreign errors to release-held". A foreign `{code:'busy'}` error maps to `release-held`, so no foreign field leaks. |
| `checkLaunchBoundary` is awaited before both `this.open(...)` calls | Runner spec "awaits the bootstrap boundary check before the child opens": the check stays pending and `queryMock` is not called. Adapter spec "awaits both boundary checks, each before its own child opens" checks the order with `invocationCallOrder`: check(bootstrap) < query#1 < check(final) < query#2. |
| A boundary refusal at bootstrap, or between bootstrap and final, gives `unsupported-source` with no `queryFn` call and no task text, then releases once or retains (from `terminated`) | Runner spec, `it.each` terminated true/false: `dispose()` is called twice and settles once. Adapter spec, two `it.each` blocks (bootstrap; and between bootstrap and final): only the bootstrap query ran, it closed with an exit proof, `commitRunBinding`, callbacks and runner are not called, and the reservation is released (`terminated:true`) or retained (`terminated:false`) exactly once. |
| Tripwire refuses `identity-unproved` before the gate: `tokenSource` not `claude.ai`, `apiKeySource:'apiKeyHelper'`, `subscriptionType:'team'` | Runner spec `it.each`, 6 cases at bootstrap: console token, apiKeyHelper, team, an unknown word, no subscription, bedrock. Adapter spec `it.each`, 3 cases on the final child: the gate yields `done` and `commitRunBinding` is not called. |
| Drift is refused before task text | Runner spec drift `it.each` (6 cases): cwd, executable, sources and env give `route-changed`; `managedSettings` and `--managed-settings=x` give `identity-unproved`; the boundary check and the query are never called. Adapter spec: executable drift gives `route-changed` with no query; an init `claude_code_version` mismatch gives `identity-unproved` (plan 428-437), with no binding and the gate `done`. |
| Resume without a second binding or lease | Adapter spec "resumes a bound lane on the stored run without a second binding": one `admitClaudeRoute` call with the stored `runId` and selection, and `commitRunBinding` is not called. The existing test "rejects unknown resume evidence ..." still passes. |
| Cancellation during commit is settled once | Adapter spec "settles once when cancelled during commitRunBinding, even if the commit lands late": release plus retain equals 1, and attach and callbacks are not called. |
| Options carry no `managedSettings` key and no `managed-settings` extra argument | Runner spec "uses the certified cwd and sources ..." and the adapter final-options assertions. |
| Read-only bindings return `unavailable-storage` | WP-b (`register.ts`); see "Contract for WP-b" below. |
| Stale D7 comment updated | `claude-sdk-lane-runner.ts` doc comment on `ClaudeLaneAccountPersistence`. The D7 comments at `register.ts:101,201` are WP-b's. |

## Stack observed

- Plain classes and functions with no DI in these files. The adapter receives its dependencies as factories through `ClaudeCliAdapterDependencies` (`claude-cli.adapter.ts:41-68`).
- Certified helpers come from the `@ptah-extension/agent-sdk` barrel (`src/index.ts:453-468`). Types come from `@ptah-extension/auth-providers-tokens` (`index.ts:31-35`).
- There is no `auth-providers` import, so `ClaudeLaneAccountPersistence` stays a structural interface.

## Verification (run from the worktree)

| Command | Result |
| --- | --- |
| `npx tsc --noEmit -p libs/backend/cli-agent-runtime/tsconfig.lib.json` | exit 0, no output |
| `npx tsc --noEmit -p libs/backend/cli-agent-runtime/tsconfig.spec.json` | exit 0, no output. WP-b's pending files show no errors, because `register.ts` builds no `ClaudeLaneAccountPersistence` object. |
| `npx eslint <5 files>` | exit 0: 0 errors, 5 `no-non-null-assertion` warnings. Four are pre-existing (`runner.ts:700`, `adapter.spec.ts:866,888,907`). One is new in `adapter.spec.ts:1111` and copies the spec's existing `getMockImplementation()!` pattern. |
| `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts <runner spec> <adapter spec> --maxWorkers=2` | 2 suites passed, 91/91 tests |

- `ptah_get_diagnostics` was not used; the scoped `tsc` runs replace it, as in B9.
- `npm run verify` was not run (rule 12).
- `session-spawner.accounts.spec.ts` and `account-binding.spec` were not run. They pass codes through and do not import changed members.

## Specs that mock or pin changed members (rule 5)

- The only fakes of `ClaudeLaneAccountPersistence` are in `claude-sdk-lane-runner.spec.ts` (bootstrap fixture) and `claude-cli.adapter.spec.ts` (`namedFixture`). Both gained `checkLaunchBoundary`. A grep for `assertRouteCurrent` finds no other fake.
- `ClaudeNamedLaneAdmission` is constructed only in `claude-cli.adapter.ts` and in the runner spec.
- `buildClaudeLaneEnv` and `buildClaudeLaneBootstrapOptions` have no other callers.
- `claudeLaneRefusal` is used only in the runner and the adapter. The two fixed messages pinned at `adapter.spec.ts:391,400` are kept.
- `ptah-cli-registry.ts:743` calls `buildClaudeSdkLaneOptions` for ambient lanes only. `launch` is optional, so the ambient output does not change. The ambient pins in runner spec lines 83-157 pass unchanged.

## Risks

| Risk | How it was handled |
| --- | --- |
| A named path could start a child without the checks | The launch is required by both builders and by the admission. The assert and the boundary check both run before each `open`. |
| Unproved close on an interrupted boundary check | `boundaryUnproved` is set while a check is pending. An abort or the deadline during the check therefore retains the reservation (fails safe). It is cleared only on `ok`, and on refusal it is set to `!terminated`. |
| Leaking a value through a refusal | Refusals have fixed messages. `claudeLaneRefusalCode` passes on only a lane refusal's code or a certified-launch refusal's code; any other error becomes `release-held`. |
| Unknown subscription words (A-T1) | Fails closed: only `pro` and `max` pass (`CLAUDE_PERSONAL_SUBSCRIPTIONS`). An absent value, an `apiKeySource`, or a provider other than `firstParty` also refuses. |
| Ambient drift | Ambient env, sources and cwd are unchanged (`buildSafeEnv`, `['user','project','local']`, `input.cwd`). |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| A tripwire hit refuses with `identity-unproved` (coordinator correction) | — | implementation-plan.md:428-437: "Any mismatch closes the child before the gate opens and refuses `identity-unproved`". `unsupported-source` stays only for a `checkLaunchBoundary` refusal, or the certifier's own code passed through. B13's executor tripwire should use the same code. | yes |
| An identity that differs from `launch.identityReference` or from the bootstrap refuses with `identity-unproved` (the 3 existing adapter expectations changed from `release-held`) | Keep `release-held`, or use the real code | Batch acceptance: "carries the real code". `identity-unproved` is in `ClaudeCertifiedLaunchRefusalCode`. | yes |
| An init `claude_code_version` that differs from `launch.executable.version` refuses with `identity-unproved` (coordinator correction) | — | implementation-plan.md:428-437. | yes |
| The admission field is named `certified`, not `launch` | — | `launch` collides with the existing `launch()` method (TS2300). | yes |
| `claudeLaneRefusal` keeps an optional fixed `message` as its second parameter | Code only | `adapter.spec.ts:391,400` pin two distinct fixed messages. | yes |
| A boundary check interrupted by abort or deadline retains the reservation | Release, or await the outcome | The plan's "unproved child close → retain" rule. Awaiting an unbounded promise inside settlement could hang. | yes |

## Plan deviations

None in substance. The plan's "`refusalCode` starts as the admission's code (`:291`)" is implemented as: the admission port's code wins; otherwise the code the error carries.

## Contract for WP-b

- **No token, constructor or `ClaudeCliAdapterDependencies` change.** The `accountPersistence?` and `accountBindings?` factories are unchanged. Only the `ClaudeNamedLaneAdmission` constructor changed (new 2nd parameter `certified`), and only the adapter constructs it.
- **If `register.ts` creates or types any object as `ClaudeLaneAccountPersistence`**, it must implement `checkLaunchBoundary(route, launch, boundary, signal): Promise<ClaudeLaunchBoundaryOutcome>`. Today it creates none (spec typecheck is clean). `ClaudeNamedAccountPersistence` (B9) already matches structurally; B17 binds it.
- **Read-only bindings** (`LaneAccountBindingPort` given through `accountBindings`) must stay read-only:
  - `lookupBySdkSession` keeps its read behaviour (an ambient continue of a never-bound session resumes).
  - `validateResume` and `persistReference` must answer `{ code: 'unavailable-storage' }` (or the port's equivalent refusal) instead of `release-held`.
  - They never admit or persist a named binding.
  - `accountPersistence` stays absent or `null` on hosts without certification, so named lanes refuse at `prepareNamed` (`release-held`, "prompt gate" message) before admission or SDK loading.
- **Update the stale D7 comments** at `register.ts:101` and `register.ts:201` in the same way as the runner doc comment.
- **Smoke-spec pins** (`register.agent-process-manager.smoke.spec.ts:290-305,324-330,360-370`) are WP-b's to adjust, for the `unavailable-storage` answers only.

## Correction round (coordinator)

- `claude-sdk-lane-runner.ts`: the tripwire refusal and the init version mismatch now refuse `identity-unproved`. A `checkLaunchBoundary` refusal still carries the outcome's own code (`unsupported-source` in the specs). Identity mismatch stays `identity-unproved`.
- Spec expectations updated: the runner spec's tripwire `it.each`; the adapter spec's tripwire `it.each` and its version case.
- Re-run results:
  - lib `tsc`: exit 0.
  - spec `tsc`: exit 0.
  - ESLint on the 5 files: 0 errors, the same 5 warnings.
  - Jest on the 2 specs (`--maxWorkers=2`): 2 suites passed, 91/91 tests.

## Out-of-scope observations

- `prepareNamed`'s 15 s timeout race does not dispose an admission that `pending` resolves after the timeout. This is pre-existing and unchanged.
- The Bash heredoc append failed once (shell quoting); the same text was applied with the Edit tool instead.
