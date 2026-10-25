# P2 fix 5 report: status-action registry receipts and ownerless certification receipts

Verdict: both items are fixed. The accounts and DI suites pass: 10 suites, 348 tests. tsc reports no errors in auth-providers. Its only error is in an agent-sdk file that Batch 13 is editing (see Checks).

All paths are under `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/`.

## Item 1: residual of finding 2 (status action, `runStatus`)

`provider-account-actions.service.ts`:

- `retained(code, receipts)` (:483) is a new helper.
  - It records the unproved refusal as before, with `unobserved(code, false)`. The prior state is kept and the reservation stays held.
  - It then subscribes to every receipt through `releaseStatusOnClose`.
  - If recording throws, it disposes every receipt and rethrows.
- `refused(refusal)` (:497) handles an unterminated refusal that has `closeReceipts`. It now keeps all of them through `retained(refusal.code, receipts)` instead of disposing them.
  - An unterminated refusal without receipts stays unproved and is held permanently, as before.
  - A terminated refusal disposes any stray receipt.
  - This covers the `authContext` refusal (`reg.exe` and the `--version` receipt from item 2) and both `checkCoverage` refusals.
- `unproved(code)` (:508) is now `retained(code, [probed.closeReceipt])` for the status child. It covers the `identity-unproved` and `route-changed` branches.
- `releaseStatusOnClose(receipts, release)` (:527):
  - It adds every receipt to `statusReceipts`, then subscribes to each one. A counter (`open`, :529) calls `release` exactly once, when the last receipt reports its close.
  - `release` is `completeStatus(..., priorState, true)`, which preserves the prior state.
  - It does nothing after disposal begins. A store refusal on release keeps the reservation held; that catch keeps its `degradation-audit: reported` marker.
- `dispose()` already disposes every receipt in `statusReceipts` (unchanged, :216). The status action's registry and `--version` listeners are therefore removed on service disposal, and the reservation stays held.

## Item 2: ownerless receipts (Moderate)

- `claude-account-command.ts:291-296` (`certifyExecutable`): the cancelled, timeout and unterminated `identity-unproved` refusals now carry the `--version` child's `closeReceipt` through `closeReceiptOf(run)`. Every other return path either started no child or had the child's close observed, so it has no receipt.
- `claude-route-certifier.ts`:
  - :52 — the `ok: false` arm of `ClaudeExecutableProbeResult` gets an optional `closeReceipt`.
  - :85 — `ClaudeCliProbe.status` returns `ClaudeStatusProbeResult & { closeReceipt? }`. The command's `ClaudeStatusProbeOutcome` already satisfies this.
  - :286-290 (`prepare`): an executable refusal that has a receipt is returned as `closeReceipts: [receipt]`.
    - Auth paths need late-close recovery. For sign-in and sign-out, `authContext` passes the receipt to `OwnedChildLedger.recordRefusal`, so it becomes a ledger entry. For the status action it goes through `retained` (item 1).
    - Run certification uses `withoutReceipts(prepared)`, which disposes it.
  - :204 (`certify`, step 6): run certification cannot observe a late close, so it disposes the status receipt as soon as the status result arrives, before any return. This covers the `route-changed` branch, the unterminated branch and every later branch. `terminated` stays false where the child was unproved, so the caller still keeps its lease.

## Tests

- `provider-account-actions.service.spec.ts`: the test that pinned the gap ("a status action disposes reg.exe receipts and keeps its reservation") is replaced by two tests:
  - :543 — late close releases. A coverage refusal comes with two receipts. Closing the first keeps the reservation; closing the second releases it.
    - The state stays `signed-in` and the identity ref is unchanged.
    - `completeStatus` is called exactly twice: the retaining call and one late release, which is `signed-in, true`. Repeated closes add no call, so nothing settles twice.
    - A following `readStatus` returns `ok`.
  - :570 — never-close control. An `authContext` refusal comes with two receipts, and only one of them closes.
    - After 600 s the reservation is still held, and `readStatus` returns `busy`.
    - `dispose()` removes the open receipt's listeners. A close after disposal does not release the reservation.
- `provider-account-auth-env.spec.ts` (real `run()`, fake `Child` spawner, fake timers, mocked `killProcessTree`; its `afterEach` asserts that no timers are left):
  - :199 — the `--version` child outlives the 10 s timeout and the 2 s grace. The result is `timeout`, `terminated: false`, with a receipt.
    - Listeners stay attached until the late close.
    - Two closes call `onClosed` once.
    - Afterwards, the `close`, `error` and stdout/stderr `data` listener counts are 0.
  - :220 — a cancelled `--version` child past the grace returns a `cancelled` receipt.
    - `dispose()` removes all its listeners.
    - A later close does not call `onClosed`, and `closed` stays false.
- `claude-route-certifier.spec.ts` (new `FakeReceipt` helper):
  - :386 — run certification disposes the `--version` receipt exactly once and returns `{ timeout, terminated: false }` with no receipt field. No status child is started.
  - :397 — `authContext` returns the `--version` receipt undisposed as `closeReceipts: [receipt]`.
  - :409 (`it.each`, 2 cases: `identity-unproved` and `route-changed`) — run certification disposes the unterminated status receipt exactly once and removes its listeners.
    - The result is `terminated: false`.
    - A later close causes neither a second dispose nor a change to the result.

## Checks

- `npx tsc --noEmit -p libs/backend/auth-providers/tsconfig.lib.json` and `-p ...tsconfig.spec.json`: both fail with the same single error, in `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts(698,78)` (TS2345). That file belongs to the concurrent Batch 13 edit; I did not touch it. tsc reported no errors in auth-providers files.
- `ptah_get_diagnostics`, scoped to the 3 changed source files: 0 errors, 0 warnings.
- `npx eslint` on the 6 changed files: exit 0, with no output (0 errors, 0 warnings).
- `npx jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/accounts libs/backend/auth-providers/src/lib/di --maxWorkers=2`:
  - First run: 2 suites failed to run, and all 236 tests that ran passed. This was most likely a transient compile failure while Batch 13 was editing agent-sdk; I did not capture the reason.
  - Immediate rerun: 10 suites passed, 348 tests passed. The count matches: 341 before, plus 7 new tests, minus the 1 replaced test (341 − 1 + 2 + 2 + 4).
- Not run: `npm run verify`, builds, installs, and other projects (rule 12). No real `claude`, `conhost.exe` or `reg.exe` was started.

## Specs that mock or pin changed members (rule 5)

- `provider-account-actions.service.spec.ts` fakes `certifier.authContext`/`checkCoverage` and `commands.status`. Edited: the gap pin was replaced as requested. The other tests are unchanged and pass, including :435 "a status action releases its reservation only when the unproved child closes", which now runs through `retained`.
- `claude-route-certifier.spec.ts` mocks `ClaudeCliProbe.certifyExecutable`/`status` with base results. Existing tests are unchanged and pass: the receipt fields are optional.
- `provider-account-auth-env.spec.ts` pins `certifyExecutable` results with `toEqual`. Existing tests are unchanged and pass: no receipt field appears when the child closed.
- `claude-login-console.spec.ts:256` fakes `certifyExecutable` with an `ok` result. Not edited; it passes.
- Ambient-path pins: untouched.

## Decisions

- **The `--version` receipt goes into the existing `closeReceipts` refusal field, not a new field.** Options considered: a separate `executableReceipt` field. Evidence: `recordRefusal` and `withoutReceipts` already give that field the right owner on every path. Reversible: yes.
- **Run certification disposes the status receipt as soon as the status result arrives.** Evidence: no return path in `certify` can hand it on, because `ClaudeRouteCertification` has no receipt field. Disposing once, up front, covers every branch, including `route-changed`. Reversible: yes.

## Files modified

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.spec.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/claude-route-certifier.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/provider-account-auth-env.spec.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/auth-providers/src/lib/accounts/claude-route-certifier.spec.ts`

I did not touch agent-sdk or cli-agent-runtime, and I changed no git state.
