# Backend implementation — `TASK_2026_719_4f64`, batch 12, WP-b

**Status**: WP-b COMPLETE. Lib and spec typecheck are clean. ESLint reports 0 problems on the 2 files. The scoped Jest set passes: 4 suites, 109/109 tests.

**Tasks completed**: Task 12.1, WP-b (2 files). Together with WP-a, Batch 12 is complete.

## Files (both MODIFIED)

- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/cli-agent-runtime/src/lib/di/register.ts`
  - `:98-108`: the doc comment on `createClaudeLaneReadOnlyBindings` replaces the stale D7 "held until certification" text. It now says this port never writes, that named runs need the certified persistence port (`CLAUDE_LANE_ACCOUNT_PERSISTENCE`, with launch-boundary checks) which a certifying host binds, and that refusals are `unavailable-storage`.
  - `:136-141`: `validateResume` returns `{ code: 'unavailable-storage' }`, and `persistReference` throws `new LaneAccountResumeError('unavailable-storage')`. Both were `release-held` before.
  - `:203-207`: the stale D7 comment on the `accountPersistence` factory is updated. The certified port is bound only by a certifying host. When it is absent or null, named admission refuses before any route or SDK load, and resumes fall back to the read-only bindings: ambient continues, and a bound session refuses `unavailable-storage`.
- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/cli-agent-runtime/src/lib/di/register.agent-process-manager.smoke.spec.ts`
  - `:299-310`: the read-only fallback test now pins `persistReference` rejecting with `LaneAccountResumeError` / `unavailable-storage`. It also pins `validateResume` resolving to `{ code: 'unavailable-storage' }`, with no lookup call.
  - `:329-337`: test (b) is renamed. It now expects `LaneAccountResumeError` / `unavailable-storage` for a bound session and checks that the lookup ran exactly once.
  - Test (d) is unchanged: it still expects `release-held`. Named admission without the certified port refuses at `prepareNamed` with the fixed "prompt gate" refusal, before admission and before SDK load. That matches the WP-a contract.

## Acceptance evidence

| Bullet | Evidence |
| --- | --- |
| Read-only bindings return `unavailable-storage` | `register.ts:137,140`. Pinned by smoke spec `:303-309` (direct port calls) and `:329-336` (through `resolveLaneAccountResume` for a bound session). |
| Read-only bindings stay read-only | `lookupBySdkSession` is unchanged (`register.ts:111-134`). Test (a) still resumes an ambient continue of a never-bound session. `persistReference` never persists, and the spec asserts no lookup or write call. |
| Stale D7 comment updated | `register.ts:98-108` and `:203-207`. |
| DI guard | `register.agent-process-manager.smoke.spec.ts` was edited and passes, including the existing "passes the host-registered persistence port" and "explicit null" cases. |
| Register every new `@inject` token (rule 4) | Not needed. WP-a added no token, no `@inject` and no `ClaudeCliAdapterDependencies` change ("Contract for WP-b"). No persistence adapter is registered here; B17 binds it in Electron. |
| No object typed as `ClaudeLaneAccountPersistence` built in `register.ts` | Confirmed. It is only resolved through `CLAUDE_LANE_ACCOUNT_PERSISTENCE`, and spec typecheck is clean. |

## Specs that mock or pin changed members (rule 5)

- `register.agent-process-manager.smoke.spec.ts:295-337` pins `createClaudeLaneReadOnlyBindings` refusal codes. These pins were updated.
- `session-spawner.accounts.spec.ts:57` and `account-binding.spec:191` pass codes through and do not construct the read-only bindings, so they are unchanged.
- No ambient-path pin changed (plan 943-953). The ambient lookup path is untouched.

## Verification (run from the worktree)

| Command | Result |
| --- | --- |
| `npx tsc --noEmit -p libs/backend/cli-agent-runtime/tsconfig.lib.json` | exit 0 |
| `npx tsc --noEmit -p libs/backend/cli-agent-runtime/tsconfig.spec.json` | exit 0 |
| `npx eslint register.ts register.agent-process-manager.smoke.spec.ts` | exit 0, no output |
| `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts .../di .../claude .../claude-cli.adapter.spec.ts --maxWorkers=2` | 4 suites passed, 109/109 tests (the 2 DI smoke specs, the runner spec, the adapter spec) |

- The first run of the Jest set reported the runner and adapter suites as failed, with 0 of their tests run. That is a suite-level load failure; the 18 DI tests passed. The runner spec alone then passed (40/40), and two later runs of the full set passed (4/4 suites, 109/109). The likely cause is a transient compile error during concurrent edits under `libs/backend/auth-providers` by the other developer, which these suites import transitively. This is not confirmed, because the first run's error text was filtered out. The team-leader's scoped `npm run verify` should be the deciding run.
- `ptah_get_diagnostics` was not used. The scoped `tsc` runs replace it, as in WP-a.
- `npm run verify` was not run (rule 12).

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Test (d) keeps `release-held` | Change it to `unavailable-storage` | WP-a contract: without the certified port, named lanes refuse at `prepareNamed` with `release-held` before admission. Only the read-only binding answers move. | yes |

## Plan deviations

None.

## Out-of-scope observations

- `register.ts:165`: the existing comment "refuses with `unavailable-storage`" was already accurate and is left as is.
