# PR #808 review fixes — applied

Task: TASK_2026_712 residual R1 (D7/D25). This file follows up `pr808-review-fixes.md`.
Worktree: `D:/projects/ptah-extension/.claude-worktrees/provider-accounts` (branch `feat/provider-accounts`).
Nothing is committed or pushed. No nx, jest, tsc, lint or npm command was run.

## Per-thread result

| Thread | Final verdict | Change (file:line) | Covering spec | Existing specs that touch changed members |
|---|---|---|---|---|
| 1fe | FIX, applied earlier and reviewed. Kept as is. | `libs/backend/auth-providers/src/lib/di/register.ts:162-188`: fail-closed `releaseHeldProviderAccountAdmission()`. The admission factory resolves `ProviderAccountService` only when `c.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION, true)` (:183). | `register.spec.ts:116` "hands out fail-closed admission when the SQL connection is not registered". It checks `release-held` for admission, `conflict` for release and retain, a string summary, and the cached singleton. | `register.spec.ts` "registers without persistence ..." and "returns typed busy refusals ...". Both register `SQLITE_CONNECTION` before they resolve, so they still get `ProviderAccountService`. |
| 1fL | FIX, applied. | `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts:188-199`, `stop()`. If `whenSpawned` resolves `null`, it calls `finish({ code, terminated: true })` at once. `finish` clears the grace timer. A spawned pid still gets the best-effort tree kill. | `register.spec.ts:219` "releases a never-spawned sign-in at once on disposal without waiting out the grace". No timer advance. Expects `cancelled`, profile state `cancelled`, 0 operation rows, no `killProcessTree` call, no listeners and no timers left. | `register.spec.ts` disposal `it.each` (pid 4321 path, unchanged). `AccountChild` now takes optional `(whenSpawned, pid)` constructor arguments that default to 4321, so existing uses do not change. It module-mocks `killProcessTree`. The new test calls `mockClear()` first. |
| 41SX | FIX, applied. | `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:367-385` adds a lenient `preservedIndexEntry`. It tolerates only `SessionAccountBindingError` and rethrows anything else. `flush()` at :895 now maps the async index through it. The target row of a write stays strict at :844 (`this.indexEntry(detail)`). | `session-metadata-store.account-binding.spec.ts:83` "keeps writing the async index when one stored row has a malformed binding". It uses a local `asyncFixture()` with typed `IAsyncStateStorage`, no casts. `save` resolves, the index keeps all 3 ids, the bad row keeps its stored binding, and `get()` still rejects `invalid-bound`. | `session-metadata-store.spec.ts` has its own async storage fixture (`replaceJsonSequence`/`getAsync`) and exercises the async flush with healthy rows. For valid rows `preservedIndexEntry` is identical to `sessionIndexEntry`, so no change is expected there. Other `session-metadata-store*.spec.ts` files use the sync mock and do not hit this branch. |
| 1fh | FIX, applied (security, fail closed). | `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts:412-422`: `sameIdentity` is true only when both identities are `known` with the same `ownerKey`, so `unknown` never matches, not even another `unknown`. `bootstrap` (:443) throws `claudeLaneRefusal()` right after `readIdentity()` when the identity is not `known`. That is before the stored-binding check, before the gate or child is released, and before any `commitRunBinding`. | `claude-sdk-lane-runner.spec.ts:554` `it.each` "refuses an unproved identity before any binding with %s" covers (a) no stored binding and (b) a stored unknown binding. It builds a real `ClaudeNamedLaneAdmission` with typed fake persistence and admission ports. It expects `release-held`, `commitRunBinding` not called, the child not closed and no abort. The 60 s deadline means a timeout cannot satisfy the test, so before the fix the no-stored-binding case would hang and fail. | The `named runner handoff` tests in the same spec use a stubbed `named` object and never call `bootstrap`/`sameIdentity`, so they are unaffected. No other spec calls `bootstrap`. Its production caller is `claude-cli.adapter.ts` (named path, release-held under D7). |
| 1fH, 1fi, 1fl | NO-CHANGE (unchanged from `pr808-review-fixes.md`). | — | — | — |

## Review of the pre-applied 1fe change

The change is correct and kept:
- `isRegistered(token, true)` also checks parent containers. Electron registers the connection after this module, and the check runs at resolution time, so Electron still gets `ProviderAccountService`.
- The fallback port's codes and summaries come from `accountActionResult`. The result is cached by `instanceCachingFactory`.
- One cosmetic point is left to the formatter: the import on `register.ts:14` is longer than 80 characters. lint-staged prettier rewraps it at commit time.

## Decisions

1. The 1fL draft guard `if (settled || stopped) return;` was wrong and was not applied. `stopped` is always set inside `stop()`, so the drafted guard would skip both the new branch and the tree kill. The applied guard is `if (settled) return;`, followed by the `pid === null` branch. Reversible.
2. In the 41SX spec fixture, the sequence methods throw rather than emulate pages. The session index never uses them, so an unexpected call fails the test visibly. This avoids an `as unknown as IAsyncStateStorage` cast. Reversible.
3. In the 1fh spec, the stored-binding refusal (`stored.identity.kind !== 'known'`) stays in `bootstrap`. The new earlier check makes it redundant but harmless. Removing it would widen the diff for no behaviour change. Reversible.

## Files changed (7, within cap)

- MODIFIED `libs/backend/auth-providers/src/lib/di/register.ts` (pre-applied 1fe, reviewed)
- MODIFIED `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts` (1fL)
- MODIFIED `libs/backend/agent-sdk/src/lib/session-metadata-store.ts` (41SX)
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts` (1fh)
- MODIFIED `libs/backend/auth-providers/src/lib/di/register.spec.ts` (1fe + 1fL tests)
- MODIFIED `libs/backend/agent-sdk/src/lib/session-metadata-store.account-binding.spec.ts` (41SX test)
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.spec.ts` (1fh test)

No new `@inject` token. No `any`, `@ts-ignore` or `as unknown as` was added. No `process.cwd()` and no `jest.spyOn` on module namespaces. Every touched spec already imports `reflect-metadata`.

## Diagnostics

`ptah_get_diagnostics` on the 7 changed files (severity error): typescript-compiler, Errors 0, Warnings 0, coverage clean.

## Checks for the orchestrator (not run here)

```
npx jest -c libs/backend/auth-providers/jest.config.ts src/lib/di/register.spec.ts --coverage=false --maxWorkers=2
npx jest -c libs/backend/agent-sdk/jest.config.ts src/lib/session-metadata-store.account-binding.spec.ts src/lib/session-metadata-store.spec.ts --coverage=false --maxWorkers=2
npx jest -c libs/backend/cli-agent-runtime/jest.config.ts src/lib/claude/claude-sdk-lane-runner.spec.ts --coverage=false --maxWorkers=2
```

The degradation audit (`tools/degradation-audit/check-degradation.ts`) should be checked against the new `catch` in `preservedIndexEntry`. That catch rethrows every error except one typed error and carries a justification comment.
