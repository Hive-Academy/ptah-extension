# Batch CI748 — Fix degradation-audit failure (PR #748 / TASK_2026_683)

## Failure

CI job `checks` / degradation-audit reports `libs/frontend/core: 1 FAIL (baseline 0)`:

- `libs/frontend/core/src/lib/routing/surface-view-transitions.ts:32` —
  `[catch-return-sentinel] catch swallows error and returns a literal`

`prefersReducedMotion()` wrapped its guarded `matchMedia` expression in a
`try/catch` that returned `false` in the catch branch, swallowing any error
without handling or rethrowing it.

## Change

File: `libs/frontend/core/src/lib/routing/surface-view-transitions.ts`

Removed the `try/catch` wrapper from `prefersReducedMotion()` and returned the
guarded expression directly:

- Before: `surface-view-transitions.ts:26-35` — `try { return typeof
  matchMedia === 'function' && matchMedia('(prefers-reduced-motion:
  reduce)').matches } catch { return false }`
- After: `surface-view-transitions.ts:26-31` —

```ts
function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
```

The only call site (`withSurfaceViewTransitions()` at
`surface-view-transitions.ts:108`, formerly line 111) is unchanged.

## Decisions

- **No suppression comment added.** The project rule forbids raising
  `tools/degradation-audit/baseline.json`, and the task forbids suppression
  comments; the correct fix was removing the dead catch branch, not hiding the
  finding.
- **`catch` branch removed rather than kept with rethrow.** `matchMedia` with a
  valid query does not throw per spec, and the `typeof matchMedia ===
  'function'` short-circuit already covers hosts without `matchMedia`
  (Jest/jsdom delete it in the spec's `afterEach`). The catch was unreachable
  dead code whose only effect was to silence a hypothetical error.
- **Spec unchanged — no test depends on `matchMedia` throwing.** Checked
  `libs/frontend/core/src/lib/routing/surface-view-transitions.spec.ts`: the
  stubs install jest.fn mocks returning `{ matches: false }` (spec line 106)
  and `{ matches: true }` (spec line 174); neither throws. The `afterEach`
  (spec lines 124-125) restores or deletes `matchMedia`, which the `typeof`
  guard handles without throwing. Per instructions, the test that exercises
  reduced motion ("skips a navigation under reduced motion", spec lines 170-180)
  is reported, not deleted or edited.
- **Scope held to one file.** Only
  `libs/frontend/core/src/lib/routing/surface-view-transitions.ts` was
  modified; no other file, baseline, or tool was touched.

## Verification

Not run here per task rules (no tests, typecheck, lint, build). The audit rule
targets a catch that swallows an error and returns a literal; that construct no
longer exists in the file.
