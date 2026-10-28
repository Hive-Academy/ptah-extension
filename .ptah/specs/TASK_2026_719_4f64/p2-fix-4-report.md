# P2 fix 4 report: close receipts for registry probes; B is still blocked

Verdict:

- **Task 1 (registry close receipts): done.** A late `reg.exe` close now unblocks the auth operation it belongs to. A `reg.exe` that never closes keeps the operation blocked. Disposal removes the child's listeners.
- **Task 2 (B, required `ClaudeAuthContext.route`): not done, blocked.** It needs `provider-account-auth-env.spec.ts`, which is not one of the allowed files. See "B: blocked".

The accounts and DI suites pass: 10 suites, 341 tests (332 before this run, 9 added).

Fix runs 1-3 are kept. Nothing under `cli-agent-runtime` or `agent-sdk` was touched.

## Sixth file: `claude-auth-settings-scan.spec.ts`

I picked the scan spec because the task asks for tests with a fake registry child and fake timers. Only a scan-level test can run the real `ClaudeAccountCommand.queryRegistry` (fake spawner, real kill and grace timers) through `scanClaudeAuthPolicy`.

The other two candidates would not have unblocked B on their own:

- `claude-account-command.ts` (B item 5) still leaves `provider-account-auth-env.spec.ts` (B item 3) failing to compile.
- `claude-login-console.ts` has no dead branch: it calls `claudeAccountRouteHolds`.

## Changes

All paths are under `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/`.

### `claude-auth-settings-scan.ts`

- :4 — `import type { ClaudeChildCloseReceipt }` from the command. This is a type-only cycle; the command already imports scan types.
- :77 — `ClaudeRegistryQueryResult` gets an optional `closeReceipt`. The command's `ClaudeRegistryProbeOutcome` already returns it, so the scan now sees it through `ClaudeCliProbe.queryRegistry`.
- :111 — the `ok: false` result gets an optional `closeReceipts`. Its doc comment states the contract: receipts are present only when the run is unterminated and every unproved child returned a receipt, and the caller then owns them.
- :210 / :212 — `PolicyScanRun` gets two new fields:
  - `receipts`, the collected receipts;
  - `unobservable`, set when a query threw or an unproved result came without a receipt.
- :357 (`query`):
  - An unterminated result pushes its receipt, or sets `unobservable` when it has none.
  - A thrown query sets `unobservable`.
  - A receipt on a terminated result is disposed.
  - The return value is unchanged (`null` for timeout or unproved).
  - Fix run 3's header and subkey validation (`registrySubkeys`, `hiveAbsent`) is untouched.
- :339 `refusal(code)`:
  - A terminated run returns `terminated: true` with no receipts.
  - An unobservable run, or one with no receipts, disposes every receipt and returns `terminated: false` with no `closeReceipts` field. It fails closed, as before.
  - Otherwise it returns a frozen `closeReceipts` array.
- :386-389 — all three refusal returns in `scanClaudeAuthPolicy` go through `run.refusal(...)`.

### `claude-route-certifier.ts`

- :107 — new exported `ClaudeProbeRefusal extends ClaudeCertificationRefusal` with optional `closeReceipts`.
- :111 / :113 — `ClaudeAuthContextOutcome` and `ClaudeCoverageOutcome` now use `ClaudeProbeRefusal`.
- `ClaudeRouteCertification` keeps the base refusal type, so the run-certification contract is unchanged.
- :322 — the private `scan()` passes `closeReceipts` through. `prepare()` (and so `authContext`) and `checkCoverage` return the scan refusal as it is.
- :152 `withoutReceipts(...)` disposes the receipts and keeps `terminated` false. Callers that cannot follow a late close use it:
  - `certify()` at :187;
  - `checkLaunch()` at :247, whose return type is in auth-providers-tokens.

  Before this run, those receipts were dropped with their listeners still attached. Now the listeners are removed, and the lease is still retained.

### `provider-account-actions.service.ts`

- :94 — `OwnedChildLedger.recordRefusal(refusal)`:
  - With `closeReceipts`, it calls `recordProbe(false, receipt)` for each one, so each receipt becomes its own ledger entry.
  - Without them, it calls `recordProbe(refusal.terminated)`: closed means nothing to track, and unclosed counts as unobservable.
- The four call sites from task step 4 now call `recordRefusal`:
  - the sign-in `authContext` refusal (:369);
  - the sign-out `authContext` refusal (:443);
  - the `coverage()` helper (:540), which covers every coverage check in sign-in, its polls and sign-out.
- From fix run 2, `childClosed` already finishes a gated operation once `allClosed()` holds, and `release()` disposes every entry's receipt.
- :483 `refused(...)` handles the status action's three certifier refusals (:488, :490, :510):
  - It disposes the receipts, which removes their listeners.
  - It records the unproved refusal as before, so the reservation is kept.

## Tests added

`provider-account-actions.service.spec.ts`, new describe at :474 "late reg.exe close (policy scan close receipts)", 6 tests:

1. An `authContext` refusal with an unproved `reg.exe` child makes sign-out return `busy`, and no logout starts. After 600 s nothing has completed. A late close then completes the operation as `disconnected` and the operation row is removed.
2. A coverage refusal with two receipts:
   - sign-in starts no console;
   - the first close is not enough;
   - the second close completes the operation (`failed`) and removes the operation row.
3. Control: a `reg.exe` child that never closes keeps the operation `busy` after 600 s on fake timers.
4. An unterminated refusal without receipts stays unproved.
5. Disposal disposes the receipt and its listener count drops to 0. A later close changes nothing, and the reservation stays held.
6. The status action disposes `reg.exe` receipts, starts no status child, keeps its reservation, and leaves the state unchanged.

`claude-auth-settings-scan.spec.ts`, new describe at :561. It uses the real `ClaudeAccountCommand.queryRegistry`, a fake `RegChild` spawner, Jest fake timers, and a `jest.mock` of `killProcessTree` (the same pattern as `provider-account-auth-env.spec.ts`). Its `afterEach` asserts that no timers are left. 3 tests:

1. HKLM `Policies` stalls. The kill fires at 5 s and the grace runs 2 s. The scan refuses with `{ terminated: false, closeReceipts: [receipt] }`. The child still has its `close` listener. A late `close` marks the receipt closed, notifies the subscriber, and detaches the listener.
2. Control: a child that never closes stays unproved after 600 s. `dispose()` removes its `close` and `error` listeners, and a later close is not observed.
3. An unproved result without a receipt returns a refusal with no `closeReceipts` field (unobservable).

## B: blocked (not started)

If `ClaudeAuthContext.route` becomes required (`claude-route-certifier.ts:41`), `provider-account-auth-env.spec.ts` no longer compiles. Its `context(withRoute = true)` helper (:211-216) builds `...(withRoute ? { route } : {})`, which can produce a context with no route. Its test "launches nothing without a reserved route" (:328) depends on that.

That file is B item 3 and is not in this run's allowed set. Making the route required without editing it would break `tsconfig.spec.json`, so I changed nothing for B.

What is left, needing 5 files:

1. `claude-route-certifier.ts:41`: change `readonly route?:` to `readonly route:`, and fix the doc comment at :36-40 ("an absent route never launches").
2. `claude-login-console.spec.ts`: give `context()` (:24) a route, or type the fallback-script tests through `Omit<ClaudeAuthContext, 'route'>`. Delete the test at :164.
3. `provider-account-auth-env.spec.ts`: drop `withRoute` and the test at :328.
4. `provider-account-actions.service.spec.ts`: add `route: resolveProviderAccountRoute(dir)` to the `context` literal (:118).
5. `claude-account-command.ts:90`: make `claudeAccountRouteHolds(route: CanonicalProviderAccountRoute)` and remove the dead `if (!route) return false` (:91).

A follow-up run with exactly those 5 files can finish B.

## Checks

- `npx tsc --noEmit -p libs/backend/auth-providers/tsconfig.lib.json`: no output (pass).
- `npx tsc --noEmit -p libs/backend/auth-providers/tsconfig.spec.json`: no output (pass).
- `npx eslint` on the 5 changed files: no output (0 errors, 0 warnings).
- `npx jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/accounts libs/backend/auth-providers/src/lib/di --maxWorkers=2`: 10 suites, 341 tests passed.
- `ptah_get_diagnostics`, scoped to the 3 changed source files: 0 errors.
- Not run: `npm run verify`, builds, and other projects (rule 12).
- No real `claude`, `conhost.exe` or `reg.exe` was started. The spawner is a fake `EventEmitter` child, and `killProcessTree` is a `jest.mock`.

## Specs that mock or pin changed members (rule 5)

- `provider-account-actions.service.spec.ts` fakes `certifier.authContext` and `checkCoverage` with plain refusals. The existing tests are unchanged and pass; only tests were added.
- `claude-route-certifier.spec.ts` asserts refusals with `toEqual({ ok, code, terminated })`. Not edited, and it passes: no `closeReceipts` field appears without receipts.
- `claude-auth-settings-scan.spec.ts` uses fake `queryRegistry` results without receipts. The existing tests are unchanged and pass. The new `jest.mock` keeps the real `platform-core` exports apart from `killProcessTree`.
- `provider-account-auth-env.spec.ts` pins `queryRegistry` outcomes with `closeReceipt`. Not edited, and it passes.
- Ambient-path pins: untouched.

## Decisions

- **The scan returns receipts only when every unproved child has one. Otherwise it disposes them and the refusal stays unobservable.**
  - Options: also return a separate unobservable flag.
  - Evidence: the ledger cannot prove an unobservable child anyway, so a partial set of receipts would only leak listeners.
  - Reversible: yes.
- **Run certification (`certify`) and the run boundary (`checkLaunch`) dispose receipts instead of passing them on.**
  - Evidence: the task scopes the pass-through to the coverage and auth-context outcomes. `ClaudeLaunchBoundaryOutcome` is in auth-providers-tokens, which is not in scope. These callers already retain on `terminated: false`.
  - Reversible: yes.
- **The status action disposes `reg.exe` receipts rather than releasing its reservation on their close.**
  - Evidence: task step 4 names only the ledger sites. The existing single-receipt `releaseStatusOnClose` does not cover several receipts.
  - Effect: unchanged fail-closed behaviour, with the listeners now removed.
  - Reversible: yes.

## Files modified

- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/claude-auth-settings-scan.ts`
- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/claude-auth-settings-scan.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/claude-route-certifier.ts`
- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.ts`
- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.spec.ts`

`claude-login-console.spec.ts` was not edited, because B did not start.
