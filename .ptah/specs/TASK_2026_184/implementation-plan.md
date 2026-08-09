# Implementation Plan — TASK_2026_184

**Fix `KeyboardNavigationService.configure()` to reset `activeIndex` to `0` on reconfigure instead of clamping to `itemCount - 1`.**

Decision source: user. Scope: `libs/frontend/ui` (service + spec) and one new wiring test in `libs/frontend/chat`. No other library is touched.

---

## 1. Codebase Investigation Summary

### The defect (verified)

`libs/frontend/ui/src/lib/native/shared/keyboard-navigation.service.ts:100-111`

```typescript
configure(config: KeyboardNavigationConfig): void {
  this.config = config;
  if (config.itemCount > 0 && this._activeIndex() === -1) {
    this._activeIndex.set(0);
  }
  if (config.itemCount > 0 && this._activeIndex() >= config.itemCount) {
    this._activeIndex.set(config.itemCount - 1);
  }
  if (config.itemCount === 0) {
    this._activeIndex.set(-1);
  }
}
```

A narrowed filter-as-you-type list keeps whatever row the clamp landed on, not the new first match. `unified-suggestions-dropdown.component.ts:139-142` configures from `suggestions().length` inside an `effect` and never resets — type to narrow, press Enter, insert the wrong file.

### Consumer audit — read, not assumed

The task carrier says "four consumers depend on the current behaviour." Reading all five call sites refines that claim (claim-is-not-evidence applied to the carrier itself):

| Consumer                                                                                    | Calls `configure()`? | How                                                | Verdict on reset-to-0                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/frontend/chat/.../file-suggestions/unified-suggestions-dropdown.component.ts:139-142` | Yes                  | `effect` on `suggestions().length`                 | **Live victim — fixed at the source.** Filter-as-you-type; reset is exactly what it needs.                                                                                                                                               |
| `libs/frontend/ui/.../native/autocomplete/native-autocomplete.component.ts:237-240`         | Yes                  | `effect` on `suggestions().length`                 | Same shape, same fix. Its spec (`native-autocomplete.component.spec.ts:199-269`) asserts arrow/home/end/hover behaviour only — **no clamp-dependent expectation exists**, so no spec change needed there.                                |
| `libs/frontend/tasks-ui/.../palette/task-command-palette.component.ts:313-318, 340-344`     | Yes                  | constructor `effect` + eager `onQueryChange`       | Already self-resets; see §4. No change.                                                                                                                                                                                                  |
| `libs/frontend/chat/.../molecules/chat-input/effort-selector.component.ts:277,317`          | **No**               | uses only `activeIndex` + `setActiveIndex` (hover) | Immune. It never executes the changed method. (`setActiveIndex` guards on `config.itemCount`, which stays at the default `0`, so its hover call is a no-op and its active index is permanently `-1` today — pre-existing, out of scope.) |
| `libs/frontend/chat/.../molecules/chat-input/model-selector.component.ts:174,254`           | **No**               | same two calls                                     | Immune, same reasoning.                                                                                                                                                                                                                  |
| `libs/frontend/chat-ui/.../molecules/chat-input/agent-selector.component.ts:154,218`        | **No**               | same two calls                                     | Immune, same reasoning.                                                                                                                                                                                                                  |

**Correction to the carrier**: only three consumers call `configure()` at all (victim, native-autocomplete, tasks-ui palette). The three selectors cannot "depend on the clamp" because they never invoke `configure()`. The fix's blast radius is exactly two components plus one already-self-resetting palette.

### The one real risk — reconfigure clobbering an in-progress arrow selection

The dangerous interleave would be: consumer reconfigures on every keystroke **while** the user is arrowing through the list, resetting to 0 mid-navigation. Established by reading the call sites:

- Typing and arrowing are temporally disjoint for one user. `configure` fires only when the suggestions array reference changes; arrow keys never change the array, so no `effect` re-fires during navigation. Verified: both filter consumers' effects depend solely on `suggestions().length` (the signal read), and `handleKeyDown`/`setNext`/`setPrevious` touch only `_activeIndex`.
- The only mid-arrow reconfigure is **async**: a fetch resolves or a `computed` re-derives with a new array reference while the user is arrowing. In that interleave the list content changed underneath the user. Clamp semantics would silently leave the highlight on the same _index_, now pointing at a _different item_ — the exact wrong-row defect this task fixes. Reset semantics moves the highlight to the new first match, which is the behaviour a filter list wants. Reset is never worse than clamp here.
- The tasks-ui palette's constructor effect re-fires on any `visibleResults()` change (e.g. background reindex); reset-to-0 there matches its existing eager `onQueryChange` behaviour.

**Conclusion: no consumer configures in a way where reset-to-0 is worse than the clamp. No guard (e.g. "only when the list changed") is needed. The unconditional reset belongs in the shared service.** Identity-tracking guards are rejected: a same-count reconfigure with different content is precisely a case that must reset (§2, test T2).

---

## 2. Component 1: `KeyboardNavigationService.configure()` — the semantic change

**File**: `libs/frontend/ui/src/lib/native/shared/keyboard-navigation.service.ts` (MODIFY)

### Final code (exact)

Replace `:100-111` with:

```typescript
configure(config: KeyboardNavigationConfig): void {
  this.config = config;
  if (config.itemCount > 0) {
    this._activeIndex.set(0);
  } else {
    this._activeIndex.set(-1);
  }
}
```

Three branches collapse to two:

- `itemCount > 0` → always `set(0)`. This subsumes the old `-1 → 0` initialization and replaces the clamp.
- `itemCount === 0` → `set(-1)`. Unchanged.

### Docblock change (required)

The `@example` and `Call this when the item count changes` wording at `:84-99` must state the new contract:

> Reconfiguring resets the active index to the first item (`0`), or `-1` when the list is empty. A consumer that must preserve a selection across a reconfigure re-applies it with `setActiveIndex()` after `configure()` returns.

This sentence is the contract the tasks-ui palette already relies on.

### What does NOT change

- `handleKeyDown`, `setNext`, `setPrevious`, `setActiveIndex`, `reset`, `setFirstItemActive`, `setLastItemActive` — untouched. (`reset()` is now semantically equal to the non-empty branch of `configure()`; it stays as public API. Nothing in the repo calls it — verified by grep — but removing it is out of scope.)
- No new config flag, no opt-in clamp mode. No consumer wants the clamp (§1), and a mode knob would be a parallel-implementation smell for zero callers.
- `KeyboardNavigationConfig` interface — untouched.

---

## 3. Component 2: Service spec — rewrite two tests, add one

**File**: `libs/frontend/ui/src/lib/native/shared/keyboard-navigation.service.spec.ts` (MODIFY)

The existing `configure()` block (`:27-54`) contains **two tests that lock in the buggy semantics** and must be rewritten, not deleted silently:

### T1 (rewrites `'should clamp active index when new itemCount is smaller'`, `:40-46`)

```typescript
it('should reset to the first item when the list narrows, even when the index survives the clamp', () => {
  service.configure({ itemCount: 5 });
  service.setActiveIndex(2); // survives the clamp: 2 <= M-1
  service.configure({ itemCount: 3 }); // N=5 narrowed to M=3 (M >= 2)
  expect(service.activeIndex()).toBe(0);
});
```

**The vacuity trap, avoided**: the fixture narrows to **M=3 ≥ 2** remaining items and parks the index at **2**, a value the old clamp leaves untouched (2 < 3). Old code yields 2; new code yields 0. The assertion cannot pass under the clamp.
**Breakability**: restore the clamp branch (or delete `this._activeIndex.set(0)`) → red. A one-item narrowing (M=1) would be satisfied by the clamp and is explicitly rejected as a fixture — this is the TASK_2026_181 Batch 10 trap.

### T2 (rewrites `'should preserve active index when still valid'`, `:48-53`)

```typescript
it('should reset to the first item on a same-count reconfigure', () => {
  service.configure({ itemCount: 5 });
  service.setActiveIndex(2);
  service.configure({ itemCount: 5 }); // same count: content may have changed
  expect(service.activeIndex()).toBe(0);
});
```

This pins the deliberate semantic that **every** reconfigure resets, not just narrowing ones — a same-length re-filter (different items, same count) must not keep a stale row. Rename included: the old name asserts the old behaviour.
**Breakability**: make the reset conditional on `itemCount !== previousItemCount` → red.

### T3 (new — discriminates reset from clamp on the out-of-range side)

```typescript
it('should land on 0, not the clamp, when the index is out of range after narrowing', () => {
  service.configure({ itemCount: 5 });
  service.setActiveIndex(4);
  service.configure({ itemCount: 3 }); // clamp would give 2
  expect(service.activeIndex()).toBe(0);
});
```

**Breakability**: restore the clamp branch → red (expects 0, clamp gives 2).

### Unchanged tests that must stay green

- `'should initialize to first item when items are added and no active'` (`:28-31`) — passes under both semantics; keep.
- `'should reset to -1 when itemCount is 0'` (`:33-38`) — the preserved branch; keep.
- All `handleKeyDown` / `setNext` / `setPrevious` / `setActiveIndex` / `reset` blocks — untouched behaviour, untouched tests.

---

## 4. Component 3: The tasks-ui workaround — stays, untouched

**File**: `libs/frontend/tasks-ui/src/lib/components/palette/task-command-palette.component.ts` — **NO CHANGE**.

`onQueryChange` (`:333-346`) calls `configure()` then `setActiveIndex(0)` synchronously, with a docblock stating the ordering is eager on purpose. After the shared fix the `setActiveIndex(0)` is redundant — but:

- **No double-reset flicker.** Both calls write the same value (`0`); Angular signals use default `Object.is` equality, so the second write notifies nothing. The constructor effect's later `configure` also converges on `0`.
- **It does not depend on `configure()`'s semantics either way** — it is correct under clamp and under reset. That is why TASK_2026_181 shipped it, and `context.md` records the decision that it stays.
- Touching another batch's shipped, mutation-tested code to remove a harmless no-op is churn without a failure mode.

---

## 5. Component 4: Victim wiring test in chat (CREATE spec)

**File**: `libs/frontend/chat/src/lib/components/file-suggestions/unified-suggestions-dropdown.component.spec.ts` (CREATE — no spec exists today; `native-autocomplete.component.spec.ts` is the template for host-component mounting of these primitives)

One test, proving the **effect wiring** reaches the fixed service (the service tests alone cannot catch a regression where the effect stops calling `configure`):

```typescript
it('resets the active row to the first match when typing narrows the suggestions', () => {
  // host provides 4 SuggestionItems; fixture.detectChanges()
  // drive ArrowDown twice via component.onKeyDown(...) → activeIndex() === 2
  // host narrows suggestions input to 2 items (M >= 2 — the vacuity trap applies here too)
  // fixture.detectChanges()
  // expect(component.activeIndex()).toBe(0)
});
```

Fixture requirements: `overlayOrigin` satisfied with a stub `{ elementRef: ElementRef }` (native-autocomplete's spec shows the host pattern, including the `FloatingDom.computePosition` mock); N=4 narrowed to M=2; index parked at 2 (survives the clamp, differs from 0).
**Breakability**: (a) revert the service change → red; (b) delete the `configure` call from the component's effect at `:139-142` → red. Either deletion must fail this test — that is what makes it a wiring test and not a duplicate of T1.

No production change to `unified-suggestions-dropdown.component.ts`. Its `resetFocus()` at `:268` stays (public API); the effect now resets through the service, which is the fix.

---

## 6. Files Affected Summary

**MODIFY**

- `libs/frontend/ui/src/lib/native/shared/keyboard-navigation.service.ts` — `configure()` body + docblock (§2)
- `libs/frontend/ui/src/lib/native/shared/keyboard-navigation.service.spec.ts` — rewrite 2 tests, add 1 (§3)

**CREATE**

- `libs/frontend/chat/src/lib/components/file-suggestions/unified-suggestions-dropdown.component.spec.ts` — wiring test (§5)

**Explicitly NOT touched**

- `libs/frontend/tasks-ui/.../task-command-palette.component.ts` (§4)
- `native-autocomplete.component.ts` and its spec (fixed at the source; no clamp-dependent expectations)
- `effort-selector`, `model-selector`, `agent-selector` (never call `configure()`)
- `libs/web/members` — foreign work owned by another session

---

## 7. Verification Gate

Mutation-window rule in force: these suites are pure unit tests (no `.ptah/specs` mutation), but **announce a window before `nx test tasks-ui`** — that suite contains TASK_2026_181's mutation-based specs — and close it only after a clean run. Do not start any run while another agent's window is open.

```bash
# Baseline FIRST (record passing totals before any edit):
npx nx test ui
npx nx test chat
npx nx test chat-ui
npx nx test tasks-ui

# After the change:
npx nx typecheck ui
npx nx typecheck chat
npx nx test ui
npx nx test chat
npx nx test chat-ui
npx nx test tasks-ui
```

**Totals discipline (both ends)**: record the pre-change pass counts for `ui`, `chat`, `chat-ui`, `tasks-ui`. Post-change deltas must be exactly: `ui` +1 test (2 rewritten, 1 added — rewrites keep their slots), `chat` +1 (new spec file). `chat-ui` and `tasks-ui` totals **must be identical to baseline** — they are the regression witnesses for the consumer audit in §1. Any other delta is a finding, not noise.

TS 5.9 strict, no `any`, no `@ts-ignore`; signals + OnPush conventions per both libs' CLAUDE.md; the service stays domain-free (no feature imports into `libs/frontend/ui`).

---

## 8. Team-Leader Handoff

**Recommended developer**: frontend-developer (Angular signals, Jest, two frontend libs).

**Complexity**: LOW. ~10 lines of production code (one method + docblock), 3 service tests, 1 component wiring test. Estimated 1–2 hours including baseline/delta measurement.

**Critical verification points for the implementer**

1. The `configure()` body matches §2 exactly — two branches, no clamp remnant, no identity guard.
2. T1's fixture is **N=5 → M=3 with index parked at 2**. If the fixture ever narrows to 1 item, the test is vacuous — this exact trap shipped in TASK_2026_181 Batch 10.
3. The chat wiring test narrows to **M=2**, not 1 — same trap, second surface.
4. `chat-ui` and `tasks-ui` totals unchanged vs baseline; any drift means the consumer audit in §1 missed a call site — stop and re-audit with `Grep("configure\\(", libs/frontend)` before proceeding.
5. tasks-ui palette is not edited. If a flicker is suspected, verify signal equality suppression instead of deleting the eager reset.
