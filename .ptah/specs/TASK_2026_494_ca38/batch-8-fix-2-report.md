# Batch 8 fix round 2: consumed-draft marker expiry

Executor: frontend-developer. Bounded to one item: codex round-2 F1 (`code-logic-review-batch-8-round-2-codex.md`).
Files touched: only `surface-text-input.component.ts` and its spec (`C/` = `libs/frontend/declarative-dashboard/src/lib/components/`).
No git state change was made.

## Fix

`C/surface-text-input.component.ts`
- `:112-119` `consumed` doc updated: the marker holds only the last consumed `drafts` reference and the id. It is not a
  set or a WeakSet, and it lasts only until a different `drafts` object is seen.
- `:129-133` The input effect now calls `releaseConsumed(drafts)` before `reconcileTyped`. When the `drafts` input
  changes identity, the marker is cleared.
- `:216` `currentDraft` also calls `releaseConsumed(drafts)` at commit time, so a new object passed without an
  effect pass in between also releases it.
- `:219` The block is now `consumed !== null && consumed.componentId === node.id`. Identity with the current
  `drafts` object is implied because any different object has already cleared the marker.
- `:222-225` `releaseConsumed`: `if (consumed !== null && consumed.drafts !== drafts) consumed = null`.

Result: a second Enter, blur or debounce on the same unchanged `drafts` object is still blocked (F1). Once the
parent passes any different object (the usual feedback write, or a host snapshot), the marker is gone. A later
restore of the earlier, consumed object is then treated like any other draft and commits.

Unchanged: the B7 F2 stale-text logic (`reconcileTyped`/`isStale`), and the typed-text path that allows the first
commit before the parent round trip.

## New spec (codex repro)

`C/surface-text-input.component.spec.ts:281-298`: `it.each` with a blur variant and an Enter variant of
"a consumed draft commits once (F1) › commits a restored, previously consumed drafts object once a different one
was seen". The test types `a`, saves `host.drafts()`, commits, then sets a host snapshot of `new host` and
re-renders (value `new host`). It restores the saved object (value `a`) and fires the commit event twice before
advancing the timers. It expects exactly two `{reason, 'a'}` commits: the restore commits, and it commits only
once (F1 still holds on the restored object).

## Red/green

- Red: I reverted only my source hunks (the effect and `currentDraft`, back to `consumed.drafts === drafts` with
  no release). The spec file stayed as is. Command:
  `npx jest -c libs/frontend/declarative-dashboard/jest.config.ts C/surface-text-input.component.spec.ts --maxWorkers=2`
  gave `Tests: 2 failed, 26 passed, 28 total`. The failures were:
  - `… (F1) › commits a restored, previously consumed drafts object once a different one was seen (blur)`
  - `… (F1) › commits a restored, previously consumed drafts object once a different one was seen (Enter)`

  Both showed `Expected - 4 / Received + 0`: the second `{componentId: 'reason', value: 'a'}` commit was missing.
  This matches codex's symptom.
- Green: after restoring the fixed source (byte-compared with `cmp` against the backup), the same command gave
  `Tests: 28 passed, 28 total`.
- Procedural note: my first red attempt used `git show HEAD:<file>` as the baseline. HEAD predates the uncommitted
  B7/B8 work, so that run also failed the older restore spec. I discarded that run. The working file was
  restored from a backup taken before the overwrite, and `cmp` confirmed it matched byte for byte. The red result
  above comes from the correct hunk-only revert.

## Test counts

- Text-input spec: 26 → 28 tests (+2). No existing test or assertion changed.
- Lib: 16 suites, 200 passed, 0 failed.

## Verification

`npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard --skip-nx-cache --parallel=2 --output-style=static`:
exit 0.

```
Test Suites: 16 passed, 16 total
Tests:       200 passed, 200 total
✖ 62 problems (0 errors, 62 warnings)
 NX   Successfully ran targets lint, typecheck, test for project @ptah-extension/declarative-dashboard
  Run duration:      12.0s
  Cache:             Skipped (--skip-nx-cache)
```

Lint warnings in the touched spec are at existing lines 69, 142 and 203 (`no-non-null-assertion`). The new spec
adds none, and the component has none.

`npx tsc -p libs/frontend/declarative-dashboard/tsconfig.spec.json --noEmit`: exit 0, no output.

## Residual note

If a parent passes a new `drafts` object and then the consumed one again, with no change detection and no commit
attempt in between, the input never observes the intermediate object. The restored object stays blocked until
the next different object arrives. This cannot happen with the renderer's synchronous feedback contract, because
each input change goes through change detection, which runs the effect.
