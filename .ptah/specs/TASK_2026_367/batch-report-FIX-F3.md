# FIX-F3 — preflight coalescer cannot cache a rejected promise

Review finding: F3 (MEDIUM), commit `298b59d27`,
`libs/backend/harness-sync/src/lib/preflight/harness-preflight.service.ts:164-203`.

## Files modified

- `libs/backend/harness-sync/src/lib/preflight/harness-preflight.service.ts` (MODIFY)
- `libs/backend/harness-sync/src/lib/preflight/harness-preflight.coalesce.spec.ts` (MODIFY)

No other file was touched. The reconciler, `CLAUDE.md` and the plan file are unchanged.

## Restructured control flow (five lines)

1. `ensure()` resolves the root, checks `inFlight`, applies the throttle, then stamps `lastPassAt` — unchanged.
2. The body of one pass now lives in the private async method `runPass(workspaceRoot, options)`.
3. `ensure()` calls `const pass = this.runPass(...)`, then builds `const shared = pass.finally(cleanup)`, then `this.inFlight.set(root, shared)`, then `return await shared`.
4. `cleanup` deletes the map entry only when `this.inFlight.get(root) === shared`, so an earlier pass never evicts a later pass's entry.
5. `resolveTimeout()` reads `deps.readTimeoutMs` through the new `readConfiguredTimeout()`, which catches a throwing host reader, logs at debug and degrades to `DEFAULT_PREFLIGHT_TIMEOUT_MS`.

Because `runPass` is an async method, a throw before its first `await` becomes a rejected promise, not a synchronous throw in `ensure()`. The cleanup can therefore never run before the insertion. Together with the guarded timeout read, `ensure()` keeps the documented contract: every path returns health or `null`.

## Behaviour preserved

Coalescing, `force: true` joining an in-flight pass, external health credit, `dispose()`, the 1500 ms budget, the timed-out `lastPassAt` stamp and the `info` timeout log are all unchanged. The 21 pre-existing preflight assertions still pass without edits.

## Spec assertions added (`harness-preflight.coalesce.spec.ts`, 4 new tests)

1. **Throwing `readTimeoutMs` (F3 case a)** — `ensure()` resolves to the health report instead of rejecting, `reconcile` is called exactly once, `logger.debug` is called with `using the default budget` and `{ budgetMs: DEFAULT_PREFLIGHT_TIMEOUT_MS }`, and a following `force: true` call starts a second `reconcile` (the map was cleaned).
2. **Timeout cleanup (case b)** — a pass that never settles inside a 5 ms budget resolves to `null`, and a following `force: true` call starts a new pass (`reconcile` twice).
3. **Reconcile rejection cleanup (case b)** — a rejected `reconcile` resolves to `null`, and a following `force: true` call starts a new pass (`reconcile` twice).
4. **Conditional delete (case c)** — pass 1 is started with a deferred reconcile, a later promise is stored under the same root, pass 1 then settles, and the later entry must still be the stored one. The public API cannot produce this ordering today, so the test reads the private `inFlight` map through a typed cast, and its comment says why the guard is defence in depth.

Anti-tautology check: the service was temporarily regressed to the pre-fix shape (unconditional delete, unguarded `readTimeoutMs`) and the preflight suites reported `2 failed, 23 passed`. The file was restored from a copy outside the repository, not with git.

## Verification

| Command                                                   | Result                                                                                                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npx nx run-many -t test -p @ptah-extension/harness-sync` | `Running target test for project @ptah-extension/harness-sync` (1 project). **45 suites passed, 373 tests passed.** Preflight suites alone: 2 suites, 25 tests (21 before this fix). |
| `npx nx run-many -t lint -p @ptah-extension/harness-sync` | **Successfully ran.** 0 errors, 1 warning — `targets/workspace-target.ts` `max-lines` (703), pre-existing and in an untouched file.                                                  |
| `npx prettier --write <both files>`                       | Applied.                                                                                                                                                                             |
| `git diff --check`                                        | Clean.                                                                                                                                                                               |

## Left undone

- `libs/backend/harness-sync/CLAUDE.md` still describes the cleanup as "a `finally` block on settlement", which remains accurate. It was not edited, because the file scope for this fix is the `preflight/` folder and finding F5 asks that the earlier out-of-plan `CLAUDE.md` edit be reconciled rather than repeated.
- F5 itself (record or revert the B2 `CLAUDE.md` deviation) is not part of this fix.

DONE: FIX-F3 — preflight builds and stores the shared promise before cleanup, guards the host timeout read, and adds four regressions that fail on the old shape
