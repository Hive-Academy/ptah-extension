# Backend implementation — `TASK_2026_701_9e4b`, batch 8

**Tasks completed**: Task 8.1 — `createCoalescedJob<TPayload, TResult>` returns `CoalescedOutcome` per batch (A24).

## Files

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment/apps/ptah-electron/src/activation/coalesced-job.ts`
  - New exported `CoalescedOutcome<TResult> = {kind:'ran', result} | {kind:'skipped'} | {kind:'threw'}`.
  - `CoalescedJobOptions<TPayload, TResult = void>`: `run` returns `Promise<TResult>`.
  - `CoalescedJob<TPayload, TResult = void>`: `request` returns `Promise<CoalescedOutcome<TResult>>`.
  - `PendingBatch` now holds `promise: Promise<CoalescedOutcome<TResult>>` and `settle(outcome)`.
  - In the drain link, admission `skip` settles with `{kind:'skipped'}`. A resolved run settles with `{kind:'ran', result}`. A rejected run goes to `onError` (or the default warn) and settles with `{kind:'threw'}`.
  - The outcome travels on the batch's own promise. Every request merged into a batch gets the same outcome object. A request made during a running pass joins the next pending batch, the existing rule, and gets that batch's outcome. No request can receive an older or newer batch's result.
  - Header contract and JSDoc updated.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment/apps/ptah-electron/src/activation/coalesced-job.spec.ts`
  - Three existing assertions that expected `undefined` now expect `{kind:'threw'}` (×2) or `{kind:'skipped'}`.
  - New describe block "per-batch outcome" with 5 cases:
    - success gives `ran` with the result;
    - success then a skipped batch: the second request gets `skipped`, not the earlier success;
    - overlapping pass: a request made mid-run gets the next batch's result (`2`, not `1`);
    - merged requests share one outcome (`toBe` identity, one run);
    - a throw gives `threw` to every merged request, and `onError` is called once.
- MODIFIED (deviation, approved by team-leader) `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment/apps/ptah-electron/src/activation/plugin-activation.ts`, `refreshUserLayer()` (around lines 527-535)
  - The return is now `userLayerJobFor(container).request(...).then(() => undefined)`.
  - Nothing else in the file changed. `plugin-activation.spec.ts` is untouched.

## Stack observed

- Plain TypeScript factory with no DI. It is wired by `userLayerJobFor` in `plugin-activation.ts:107-121`, a WeakMap keyed by container, and uses the default `TResult = void`, so it compiles unchanged.
- The error convention is unchanged: `onError` hook with a `console.warn` default, as already in this file.

## Verification

1. `npm run verify -- -p ptah-electron`: **exit 1**. 9 tasks ran, 7 succeeded, 2 failed: `ptah-electron:typecheck` and `ptah-electron:test`.
   - typecheck: exactly 1 error, `libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.service.ts:298:13 TS2345` (object not assignable to `HarnessPlan`). That file is Batch 6's in-progress work, not this batch. No error in any Batch 8 file.
   - test: 17 suites failed to run, every one on the same `harness-reconciler.service.ts:298` TS2345, compiled transitively through harness-sync. Totals: 1051 tests passed, 3 skipped, 0 failed assertions.
   - lint: passed.
2. Targeted re-run `npm run verify -- -t test -p ptah-electron -- --testPathPatterns=coalesced-job --verbose`: **exit 0**. Header "verify test (ptah-electron)", 7 tasks succeeded. `coalesced-job.spec.ts`: **22 passed, 22 total** (17 existing + 5 new).
3. `plugin-activation.spec.ts` could not be confirmed. It goes through harness-sync, so it is blocked by the same Batch 6 compile error. It needs a re-check once Batch 6 lands; the team-leader's combined verify covers it.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Settle each outcome on the batch's own promise instead of a shared or last-result lookup | per-batch promise; last-result map keyed by root | plan :709-715 (A24); `coalesced-job.ts` already creates one promise per pending batch | yes |
| `TResult` defaults to `void`, so existing `CoalescedJob<UserLayerPassPayload>` users compile without type changes | required generic; default `void` | plan :709 `TResult = void` | yes |
| Minimal `.then(() => undefined)` in `refreshUserLayer` (option A) | edit one line; defer the type change to Batch 9 | team-leader reply; TS2322 otherwise at `plugin-activation.ts:532` | yes; Batch 9 replaces the line |

## Plan deviations

- TL5 assumed that "existing `request()` callers ignore the result". `refreshUserLayer()` (`plugin-activation.ts:527-537`, declared `Promise<void>`) returned `request(...)` directly, which fails to compile once `request` returns `Promise<CoalescedOutcome<void>>`. Fixed with the one-line edit above, approved by the team-leader. Task 9.2 replaces it with the `UserLayerPassOutcome` mapping.
- The "Remove the per-root map" requirement had nothing to remove. No per-root or last-result map exists in `coalesced-job.ts` or its caller. The per-root map was the rejected alternative ("last-result map") in plan :220 A24 and review finding 5. The per-batch promise satisfies the intent.

## Out-of-scope observations

- `libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.service.ts:298` TS2345 (Batch 6, in progress) currently breaks `ptah-electron` typecheck and test. It was not touched.
