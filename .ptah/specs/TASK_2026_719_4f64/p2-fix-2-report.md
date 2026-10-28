# P2 fix 2 report: a late probe close now unblocks the auth operation it belongs to

Finding: code-logic-review-p2.md finding 2 (Moderate). Follow-ups from p2-fix-1-report.md: B (make the route required) and C (service-level route-changed regressions).

Verdict:

- A (finding 2): fixed.
- C: done.
- B: not done. It needs a sixth file, `claude-login-console.spec.ts`, which this run may not edit. See "B: blocked".

The accounts and DI suites pass: 10 suites, 332 tests.

## A. Close receipts and per-child tracking

All paths below are under `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/`.

### `claude-account-command.ts`

- :121 — new `ClaudeChildCloseReceipt`, exported. It has three members:
  - `closed`;
  - `onClosed(listener)`, which fires once, and fires at once when the close was already seen. It returns an unsubscribe.
  - `dispose()`, which removes the child's listeners.
- :131 / :136 / :141 — `ClaudeStatusProbeOutcome`, `ClaudeLogoutProbeOutcome` and `ClaudeRegistryProbeOutcome`. Each extends the existing result type with `closeReceipt?`.
  - The field is present only when `terminated` is false and a process exists.
  - The certifier's `ClaudeCliProbe` types are unchanged, because the outcomes are subtypes.
- :145 — `ChildCloseReceipt`, the private implementation. `markClosed` detaches the child listeners and then notifies. `dispose` detaches and drops the subscribers. Each acts only once.
- `run()` (:405-495):
  - When the kill grace expires without a close, it resolves `terminated: false` with a receipt (:448). It no longer removes its listeners at that point: `close`, `error` and the stdout/stderr drains stay attached until the close is seen or the owner disposes the receipt (`detach`, :426).
  - A close after settlement marks the receipt closed (:482).
  - A `whenSpawned` that resolves `null` after settlement also marks it closed, because no process exists (:454).
  - Fix run 1's `launchGuard` spread into `spawnProcess` is kept (:412).
- `status` (:318), `logout` (:336) and `queryRegistry` (:350) pass the receipt through on every return that follows a spawn, including fix run 1's `routeChanged` returns after close. The pre-spawn route refusals start no child, so they carry no receipt.

### `provider-account-actions.service.ts`

- :45 / :61 — `OwnedChildLedger` now keeps one `LedgerEntry` per child: the console, plus every status or logout probe that came back with a receipt. The permanent counter is gone.
  - `recordProbe(terminated, receipt?)` (:76): a closed probe adds nothing. An open probe with a receipt becomes an entry, and `receipt.onClosed` marks it closed.
  - An open probe without a receipt counts as `unobservable` and stays unproved. This covers a throwing collaborator, and certifier or scan refusals with `terminated: false`. There is no way to observe those, so exclusion stays. Nothing is reclaimed by time or PID.
  - `unprovedProbes` counts unclosed probe entries plus unobservable ones.
- `allClosed()` is true only when there are no unobservable children and every entry is closed.
- `stop()` (:114) still kills and waits only for consoles. The command has already killed probe children and waited the grace for them.
- `release()` (:137) detaches every entry: console listeners are removed and probe receipts are disposed.
- Call sites:
  - The sign-in status poll (:412), sign-out's logout (:437) and sign-out's follow-up status (:445) pass `closeReceipt`.
  - Fix run 1's `routeChanged` branches stay directly after these calls, unchanged.
- `childClosed` (:576) replaces `consoleChanged`.
  - A late close of any entry completes a gated (`blocked`) operation once `allClosed()` holds.
  - For a sign-in that is not gated and has nothing in flight, it calls `schedulePoll`, so polling that stopped at the 3-unproved limit resumes once one of those children closes.
- Status action (`runStatus`, :474):
  - An unproved status child, either `identity-unproved` or fix run 1's `route-changed` with `terminated: false`, is still recorded as before (`completeStatus(..., priorState, false)`), and the reservation is retained.
  - When the child has a receipt, `releaseStatusOnClose` (:503) waits for its close and then calls `completeStatus(..., priorState, true)`. The state does not change; only the reservation is released.
  - If recording throws, the receipt is disposed.
  - A store refusal on the late release leaves the reservation held. That catch is marked `degradation-audit: reported`.
- `dispose()` (:232) disposes every outstanding status-action receipt (`statusReceipts`, :197). Ledgers are released as before. Reservations stay held during shutdown.

### Registry probes (scan change needed, not made)

`queryRegistry` now returns `closeReceipt` on an unproved `reg.exe` child. `claude-auth-settings-scan.ts` was out of scope for this run, and it still reduces the result to `terminated`, so the receipt is dropped. Without its owner, the receipt's listeners detach themselves when the late close arrives. A `reg.exe` that never closes keeps them on its handle.

To complete A for registry probes, a follow-up in the scan should:

1. collect `closeReceipt` from each `query()` call (around :304-312);
2. add `closeReceipts?: readonly ClaudeChildCloseReceipt[]` to the `ok: false` scan outcome;
3. have the certifier pass them through `ClaudeCoverageOutcome` and `ClaudeAuthContextOutcome`;
4. have `provider-account-actions.service.ts#coverage` and the `authContext` refusal sites call `ledger.recordProbe(false, receipt)` for each one.

Until then, an unproved registry probe still counts as `unobservable` in the ledger: it fails closed, as before.

## B: blocked

Making `ClaudeAuthContext.route` required breaks compilation of `claude-login-console.spec.ts`:

- its `context()` helper (:24) builds a context literal without `route`;
- its test "launches nothing without a reserved route" (:164) depends on a route-less context.

That spec is not in this run's 5 files. I did not touch `claude-route-certifier.ts`.

The follow-up edit:

1. In `claude-route-certifier.ts:41`, change `readonly route?:` to `readonly route:`.
2. In `claude-login-console.spec.ts`, give `context()` a route, or type the fallback-script tests through `Omit<ClaudeAuthContext, 'route'>`, and delete the :164 test.
3. In `provider-account-auth-env.spec.ts`, drop `withRoute` and its "launches nothing without a reserved route" test.
4. In `provider-account-actions.service.spec.ts`, add `route` to the `context` literal (`resolveProviderAccountRoute(dir)`).
5. `claudeAccountRouteHolds(route | undefined)` (`claude-account-command.ts`) can then take `CanonicalProviderAccountRoute`, and its `if (!route) return false` branch can go.

The edit is small.

## Tests added

`provider-account-auth-env.spec.ts` (command level, real `run()` with a fake spawner):

- :93 — the `reg.exe` kill-after-5-s test now expects `closeReceipt`. A later close marks it closed and leaves no `close` listener.
- :244 — a status child passes its timeout (10 s) and kill grace (2 s), and the test checks:
  - the receipt is returned, and one `close` listener stays attached;
  - 60 s of further fake time proves nothing;
  - the late close fires the subscriber once and removes the `close`, `error` and stdout `data` listeners;
  - a subscriber added after the close is called at once.
- :272 — disposing a logout receipt removes every child listener, and a later close is not reported.
- The two existing unproved expectations (stalled status, and the stalled logout with a route change) now include `closeReceipt`.

`provider-account-actions.service.spec.ts` (`FakeReceipt` at :52):

- `late probe close (close receipts)` (:371):
  1. Timeout and grace, then a late close, then a successful poll: completes `signed-in`, not `busy`, and no operation is left.
  2. A gated sign-in (unproved, then success, so `busy`) completes `signed-in` when the child closes later.
  3. Control: a child that never closes stays `pending`/`busy` after 600 s, with no `completeAuth`.
  4. Polling stopped at 3 unproved children resumes when one of them closes.
  5. An unproved logout gives `busy`. Its late close settles the sign-out, and the reservation is released.
  6. Status action: an unproved child retains the reservation through 600 s, and its close releases it with the state unchanged.
  7. Disposal disposes the sign-in receipt and removes its listeners. A close afterwards does not complete anything.
  8. Disposal disposes a status-action receipt that outlived the action, and the reservation stays held.
- `route-changed (reserved directory replaced)` (:474), which is follow-up C:
  1. Sign-in start-up console `route-changed`: the result is `route-changed`, no fallback script, state `failed`, and the reservation is released.
  2. A sign-in poll with `routeChanged` and `terminated: true`: `completeAuth(..., 'failed', undefined)`, no identity reference, and the reservation is released.
  3. A sign-in poll with `routeChanged` and `terminated: false`: `pending`/`busy`, and no `completeAuth`.
  4. Sign-out with `routeChanged` after logout (no status child is started), and again after the follow-up status: both give `route-changed` and `disconnected`. The identity reference is kept, and no `signed-out` state is recorded.
  5. Status action with `routeChanged`: `route-changed`, state `failed` (never `signed-in` or `signed-out`). With `terminated: false` and a receipt, the reservation is retained until the close.

## Checks

- `npx tsc --noEmit -p libs/backend/auth-providers/tsconfig.lib.json`: no output (pass).
- `npx tsc --noEmit -p libs/backend/auth-providers/tsconfig.spec.json`: no output (pass).
- `npx eslint` on the 4 changed files: no output (0 errors, 0 warnings).
- `npx jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/accounts libs/backend/auth-providers/src/lib/di --maxWorkers=2`: 10 suites, 332 tests passed.
- `ptah_get_diagnostics` (scoped to the 2 source files): unavailable, because the TypeScript check was still running after 45 s. The scoped tsc runs above cover these files.
- Not run: `npm run verify`, build, and other projects (rule 12). No real `claude`, `conhost.exe` or `reg.exe` was started: the spawners are fakes and `killProcessTree` is mocked.

## Specs that mock or pin changed members (rule 5)

- `provider-account-actions.service.spec.ts` fakes `commands.status`/`logout` and `loginConsole.launch`. Edited: tests added only, and the existing tests are unchanged and passing.
- `provider-account-auth-env.spec.ts` pins the `ClaudeAccountCommand` results. Edited as described above.
- `claude-route-certifier.spec.ts` mocks `ClaudeCliProbe.status`/`logout` with the base result types. It was not edited and passes.
- `claude-auth-settings-scan.spec.ts` uses fake `queryRegistry` results. It was not edited and passes.
- Ambient-path pins: untouched.

## Decisions

- **The receipt is an optional field on probe-outcome subtypes declared in the command file. `ClaudeStatusProbeResult` and its siblings in the certifier are unchanged.**
  - Options: change `terminated` to a receipt in the certifier types, or add the receipt as an optional subtype field.
  - Evidence: the certifier may be edited only for B, and the scan is not editable. The service injects the concrete `ClaudeAccountCommand`, so it sees the subtype.
  - Reversible: yes.
- **The gate's `stop()` still waits only for consoles.**
  - Evidence: the command has already issued the tree kill and waited the 2 s grace for each probe child. Waiting again would add 2 s to every gate and would prove nothing new.
  - Reversible.
- **A late close resumes sign-in polling that stopped at the 3-unproved limit.**
  - Evidence: plan Component 6 bounds polling by unproved entries, and a closed entry is no longer unproved.
  - Reversible: drop the `schedulePoll` call in `childClosed`.
- **The status action's late release reuses `completeStatus(..., priorState, true)`.** An unproved status always records `priorState`, so the late call changes no state and only deletes the operation row (`provider-account.store.ts:440-462`).

## Files modified

- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts`
- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.ts`
- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/provider-account-auth-env.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.spec.ts`

Fix run 1's uncommitted changes are kept.
