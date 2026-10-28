# Backend implementation: `TASK_2026_719_4f64`, batch 13

**Verdict**: COMPLETE. Task 13.1 is implemented in all 6 files. Every check passes:

- lib `tsc` and spec `tsc`: exit 0;
- ESLint: 0 errors;
- helpers Jest: 120 suites, 2609 tests passed.

This took two runs. Run 1 made the source edits and stopped at the call ceiling; run 2 (the continuation) updated the accounts spec, ran the checks and wrote this report.

## Files (all MODIFIED)

- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts`: the D21 runner deletion.
  - Removes the `OneShotRunInput.accountRoute` field, the `ClaudeAccountRoute` import, the `applyClaudeAccountRouteEnv` import and the wrapper.
  - The env literal is restored to its pre-`697b7e31a` form, including `} as Record<string, string | undefined>,`. I checked it line by line against `git show 697b7e31a^` (lines 600-615).
- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/agent-sdk/src/lib/helpers/claude-account-route-env.ts`:
  - The named branch throws `ClaudeCertifiedLaunchRefusal('identity-unproved')`.
  - The ambient early return is byte-identical.
  - The selector list is deleted because nothing uses it any more.
- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`:
  - New `accountLaunch?` input field and new exported `namedActualLaunch(options)`.
  - `buildNamedAccountBootstrapOptions(route, abort, launch)` is certified.
  - The named final run uses the launch's executable, `cwd`, setting sources and `certifiedNamedEnv(route, launch, runPolicy)`.
  - `effectiveAuthEnv` is `certifiedNamedEnv` (replaces `:1083-1084`).
  - Model discovery passes the launch.
  - The ambient env literal is unchanged, now in the `else` arm.
- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/agent-sdk/src/lib/helpers/claude-account-route-env.spec.ts`: rewritten.
  - Removed: the one-shot cases (`oneShotOptions`, the `'one-shot'` row, the A2 loop call) and the obsolete named-selector cases.
  - Added: the ambient pins, the named refusal, and the builder named, A-S12 and bootstrap pins.
- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`: the port gains `checkLaunchBoundary`. Admission, tripwire, init check, boundary checks, refusal codes and settlement are changed (see below).
- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.accounts.spec.ts`:
  - Fixtures gain `launch`, a `checkLaunchBoundary` fake, a personal `accountInfo` (`tokenSource:'claude.ai'`, `subscriptionType:'max'`), and init `claude_code_version`/`apiKeySource`.
  - Final options carry the certified executable, env, cwd and sources.
  - New B13 cases were added; expectations follow D23.

## Acceptance evidence

| Bullet | Code | Spec evidence |
| --- | --- | --- |
| Missing launch refuses `identity-unproved` before bootstrap; the factory is never called | `bootstrap()`: `const launch = admitted.resources.launch; if (!launch) throw namedAccountRefusal('identity-unproved')`, before any options or child. The builder's `namedInputLaunch` refuses a named input without `accountLaunch` | executor "refuses a named route without a certified launch before any child or boundary check": `invokeNamedQuery` and `checkLaunchBoundary` are not called, and the lease is released once. route-env "refuses a named route without a certified launch before model discovery" |
| `certifiedNamedEnv` is used | bootstrap builder, final `env`, builder `effectiveAuthEnv` | executor "bootstraps with the certified env and executable ..."; route-env "uses the certified env, cwd, sources and executable only (A-S12 pin)": env equals `launch.env` plus `CLAUDE_CODE_DISABLE_WORKFLOWS`; and "keeps simultaneous distinct routes independent" |
| The named branch of `applyClaudeAccountRouteEnv` throws `ClaudeCertifiedLaunchRefusal`; the ambient early return is unchanged | `claude-account-route-env.ts` | route-env "refuses a named route without deriving an env from the parent"; "returns the ambient env object unchanged" (`toBe(base)`) |
| The final options' `settings` are checked as `flagSettings`; a flag-tier override refuses before invoke | `launch()` calls `checkBoundary(options, 'final')`, which calls `assertCertifiedLaunch(launch, namedActualLaunch(options), 'final')` | executor `it.each` "refuses %s in the final options before invoke": `settings` object and JSON string are `identity-unproved`; `managedSettings` and the `managed-settings` extra arg are `identity-unproved`; env drift and another cwd are `route-changed`. Only the bootstrap child ran. route-env A-S12: the builder's own final options pass `assertCertifiedLaunch(..., 'final')` |
| Init requires `claude_code_version === launch.executable.version` and `apiKeySource` in `{none, oauth}` | init branch of the `launch()` loop: `identity-unproved` | "refuses an init message with another CLI version / an API key source before any binding"; "accepts an oauth init key source" |
| `checkLaunchBoundary` is awaited at bootstrap (after `assertRouteCurrent`, before `invokeNamedQuery`) and at the top of `launch()` | `checkBoundary()` through `this.wait(...)`, called in both places | "awaits each boundary check after route revalidation and before its own child": `current` < `boundary` < `bootstrap`, then `bootstrap-close` < 2nd `boundary` < `final`, with arguments `(route, launch, 'bootstrap'/'final', signal)`. "holds the bootstrap child until its boundary check resolves" |
| A refusal starts no query for that child; the lease is released once when everything is closed and retained when `terminated:false` | `ok:false` sets `boundaryUnproved = !terminated` and throws `namedAccountRefusal(outcome.code)`. `dispose()` releases only when `terminated && !boundaryUnproved`; the single `settlement` promise settles once | `it.each` with bootstrap/final and terminated true/false: `unsupported-source`, 0 or 1 children, no commit, exactly one release or retain, even after a second `dispose()`. "retains when a boundary check is cancelled ..." and "retains when the boundary check itself fails ..." (foreign error is `release-held`) |
| Tripwire refuses before the gate (`identity-unproved`, D23) | `namedIdentity(account, launch)` at bootstrap and in `verifyIdentity`. It requires `tokenSource 'claude.ai'`, `apiKeySource` absent or `'none'`, `apiProvider` absent or `firstParty`, `subscriptionType` in `CLAUDE_PERSONAL_SUBSCRIPTIONS`, and `claudeIdentityReference(...) === launch.identityReference` | `it.each`, 6 cases: console token, `apiKeyHelper`, team, unknown word, no subscription, bedrock. Each gives `identity-unproved`, the bootstrap gate yields `done`, and there is no commit. "accepts an explicit apiKeySource of none". Identity mismatch, unknown and changed-identity cases give `identity-unproved` |
| `namedAccountRefusal` defaults to `identity-unproved` | default changed; catch blocks keep the code through `namedRefusalCode` (issued refusals tracked in a `WeakSet`; a foreign error becomes `release-held`) | the unknown-resume cases (bare default) give `identity-unproved`; the held admission keeps `release-held`; the foreign-failure `it.each` gives `release-held` |
| Options carry no `managedSettings` / `managed-settings` | not added anywhere | executor "bootstraps with ... no managed settings" (both children); route-env A-S12 and bootstrap cases |
| Resume without a second binding or lease | existing `storedBinding` path | "reuses the durable binding ...": one `admitClaudeRoute` call with the stored `runId`, and `commitRunBinding` is not called. The re-auth resume case also passes |
| Cancellation during commit settles once | single settlement promise | the "cancels at %s" `it.each` (commit included; boundary added) asserts release + retain ≤ 1. The A2 "ignores late commit completion ... settles once" case passes |

## Decisions

- **Plumbing refusals stay `release-held`.** This covers cancel, deadline, `aborted`, `next.done`, more than 64 buffered messages, a registry bind failure, a resume id mismatch, attach status, a missing child or baseline, and a missing port. They are explicit `'release-held'`, as in the lane's `claudeLaneRefusal()` default. Identity refusals use the new default. Reversible.
- **A boundary check that rejects or is cancelled retains the lease.** Its probes are not proved closed. This mirrors the lane's `boundaryUnproved`.
- **A named run uses `launch.cwd` throughout `build()`,** not only in the options field.
- **`bootstrap()` no longer takes `executable`.** It uses `launch.executable`. Its only caller is in the same file.

## Specs that mock or pin changed members

- `session-query-executor.accounts.spec.ts` holds the only `NamedAccountPersistencePort` fake. Updated.
- `claude-account-route-env.spec.ts`: rewritten.
- `sdk-query-options-builder*.spec.ts` and `sdk-query-runner.service.spec.ts` are the ambient pins. Not touched; they pass in the helpers run.
- Callers grep (`libs/`, `apps/`):
  - `applyClaudeAccountRouteEnv` is used only in the agent-sdk barrels and the builder.
  - `buildNamedAccountBootstrapOptions`, `NamedAccountQueryAdmission.bootstrap` and `NamedAccountPersistencePort` are used only by the executor and its spec.
  - The B9 adapter's `checkLaunchBoundary` has the same four-argument signature.
  - Nothing outside my 6 files needed an edit.

## Risks

| Risk | How it was handled |
| --- | --- |
| Ambient drift | The ambient builder and runner env literals are unchanged; the runner literal matches the pre-`697b7e31a` source. The ambient pins pass |
| No `process.env` mutation, no `process.cwd()` | Neither appears in source or specs. The route-env spec checks that the base env is not mutated |
| No namespace spies | None. Fakes are injected |
| No real `claude` | The runner fake only |
| No secret, path or CLI text in logs or refusals | Refusals carry a fixed summary or `ClaudeCertifiedLaunchRefusal`'s fixed message |

## Verification (run from the worktree)

- `npx tsc --noEmit -p libs/backend/agent-sdk/tsconfig.lib.json`: exit 0.
- `npx tsc --noEmit -p libs/backend/agent-sdk/tsconfig.spec.json`: exit 0.
- `npx eslint` on the 6 files: 0 errors, 2 warnings. Both are `max-lines`, in `sdk-query-options-builder.ts` and `session-query-executor.service.ts`, which were already over the limit before this batch.
- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers --maxWorkers=2`: 120 suites passed, 1 skipped; 2609 tests passed, 1 skipped.
  - The two changed specs alone: 2 suites, 90 tests passed.
- Not run (rule 12, team-leader's): `npm run verify` for `agent-sdk` and `cli-agent-runtime`; `ptah_get_diagnostics` (the scoped `tsc` covered it).

## Out-of-scope observations

- The lane tripwire (`claude-sdk-lane-runner.ts`, `personalClaudeLogin`) accepts only an absent `apiKeySource`. The plan (428-437, 795-798) and main chat also accept `'none'`.
- The lane's init check does not test the init `apiKeySource` against `{none, oauth}`, which main chat now does.
- `git diff` shows uncommitted auth-providers files from the concurrent lane, and `decisions.md`. I did not touch them.
