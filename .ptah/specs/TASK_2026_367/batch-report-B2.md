# TASK_2026_367 — Batch B2 Report

**Batch**: B2 (C6a — coalesce concurrent preflight, credit any recent pass)  
**Project**: `@ptah-extension/harness-sync`  
**Date**: 2026-09-03

---

## 1. Files Created and Modified

### Created Files

- [`libs/backend/harness-sync/src/lib/preflight/harness-preflight.coalesce.spec.ts`](file:///D:/projects/ptah-extension/libs/backend/harness-sync/src/lib/preflight/harness-preflight.coalesce.spec.ts)
  - Unit test suite verifying in-flight concurrency coalescing, cross-root isolation, `force: true` coalescing, throttle crediting from external `health` events, settlement cleanup, and `dispose()` unsubscribe behavior.

### Modified Files

- [`libs/backend/harness-sync/src/lib/preflight/harness-preflight.service.ts`](file:///D:/projects/ptah-extension/libs/backend/harness-sync/src/lib/preflight/harness-preflight.service.ts)
  - Added `inFlight = new Map<string, Promise<HarnessHealth | null>>()` to coalesce concurrent preflight passes per workspace root.
  - Added `unsubscribeHealth?: () => void` subscribing to `reconciler.onHealth()` in constructor, crediting completed reconcile passes by updating `lastPassAt`.
  - Added `dispose(): void` to cleanly unsubscribe from the reconciler on teardown.
  - Updated `ensure()` to check `inFlight` before throttling, storing the execution promise and deleting it in a `finally` block upon settlement.
- [`libs/backend/harness-sync/CLAUDE.md`](file:///D:/projects/ptah-extension/libs/backend/harness-sync/CLAUDE.md)
  - Added subsection `#### Concurrent coalescing and external-pass credit (TASK_2026_367 / C6a)` documenting the coalescing promise cache, `force: true` behavior, reconciler `health` subscription, and `dispose()` lifecycle.

---

## 2. Spec Assertions Added

### `harness-preflight.coalesce.spec.ts`

1. **Concurrent calls coalesce**: Two `ensure()` calls for the same root, the second issued while the first is pending, invoke `reconciler.reconcile` **once**, and both resolve to the same value.
2. **Distinct roots run concurrently**: Two `ensure()` calls for different roots invoke `reconciler.reconcile` twice.
3. **`force: true` joins in-flight pass**: `ensure({ force: true })` while a pass is in flight for the same root joins the existing pass rather than starting a second.
4. **External pass credit**: Emitting a `health` event for a root (e.g. from an external full pass or propagate) stamps `lastPassAt`, causing the next `ensure()` for that root to return `null` without calling `reconciler.reconcile`.
5. **In-flight cleanup on settlement**: After the in-flight promise settles, the entry in `inFlight` is removed, allowing subsequent `force: true` calls to start a new pass.
6. **Listener disposal**: `dispose()` invokes the unsubscribe callback from `reconciler.onHealth()`.

---

## 3. Test and Lint Results

### Test Execution

```bash
npx nx run-many -t test -p @ptah-extension/harness-sync
```

- **Test Suites**: 45 passed, 45 total (including new `harness-preflight.coalesce.spec.ts` and existing `harness-preflight.service.spec.ts`)
- **Tests**: 369 passed, 369 total
- **Snapshots**: 0 total
- **Time**: 30.343 s

### Lint Execution

```bash
npx nx run-many -t lint -p @ptah-extension/harness-sync
```

- **Result**: 0 errors, 1 warning (pre-existing `max-lines` warning in `workspace-target.ts`, 0 errors).

---

## 4. Deviations from the Plan

None. In `harness-preflight.service.ts`, `inFlight` check is performed immediately after root resolution and before the throttle check so that concurrent callers for the same root join the in-flight pass and resolve to the same health value instead of prematurely returning `null` under the 60 s throttle interval.

---

## 5. Anything Left Undone

None. All requirements of Batch B2 are complete and verified.

DONE: B2 — coalesce concurrent preflight and credit external completed passes
