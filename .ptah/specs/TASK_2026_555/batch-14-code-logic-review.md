# Code Logic Review — `TASK_2026_555` Batch 14 (`NativeModalComponent`)

## Summary

| Metric              | Value        |
| ------------------- | ------------ |
| Overall score       | 8/10         |
| Assessment          | APPROVED     |
| Blocking issues     | 0            |
| Serious issues      | 0            |
| Moderate issues     | 3            |
| Failure modes found | 2            |

## Five logic questions

### 1. How does this fail silently?

- If a future consumer omits `ariaLabel` (it is optional — `input<string>()`, no default,
  `native-modal.component.ts:94`), `[attr.aria-label]` is removed entirely
  (`native-modal.component.ts:68`), and the `<dialog>` gets no accessible name at all — no
  `aria-labelledby` fallback exists. Nothing in the component or its tests catches this;
  the modal renders and opens exactly as if correctly labelled, but is silently unnamed for
  assistive tech. Design-spec §2.5 makes `ariaLabel` optional on purpose (design-spec.md:190,
  214-216) so this is spec-compliant, but the spec's own justification ("a `<dialog>` has no
  implicit accessible name") is not backed by any enforcement — it is left entirely to
  discipline in the three not-yet-built consumers.
- `ngOnDestroy` (native-modal.component.ts:138-143) closes the dialog if `open`, but does not
  emit `closed`. If a parent conditionally destroys the modal via `@if` while `isOpen()` is
  still `true` (e.g. route navigation away from a page with an open modal), the dialog is
  closed but the parent's `isOpen` signal is left `true` and never reset — silent state
  desync that only manifests if the same signal is later reused (e.g. component re-created).

### 2. What user action produces unexpected behaviour?

- Pressing Esc: the browser's default action for a `cancel` event on a `showModal()` dialog
  closes the dialog itself, synchronously, before/around the bubbling `cancel` handler runs.
  `onCancel()` (native-modal.component.ts:129-131) only emits `closed` and never calls
  `preventDefault()`, which is correct per design-spec.md:208-211 (browser closes the
  underlying element; the parent is only notified so its `isOpen` signal doesn't drift). The
  risk is entirely on the parent side: if a parent's `(closed)` handler is anything other than
  a synchronous `isOpen.set(false)` (e.g. behind a confirmation, a guard, or dropped), the
  native element is already closed while the component's `isOpen` input is still `true`. The
  `effect()` (native-modal.component.ts:108-116) will not re-run in that state (no signal
  change), so the dialog stays closed indefinitely even though the component's model says
  open — a real desync, but one the component cannot prevent under the "parent owns
  `isOpen`" contract it is documented to follow (native-modal.component.ts:18-20).
- Rapid double-open is not reachable through normal signal semantics: `effect()` only re-runs
  on a value change, so `isOpen()` true→true never triggers a second `showModal()` call and
  the InvalidStateError the review brief asked about cannot occur through the public `isOpen`
  contract. The only way to trigger it would be calling `dialog.showModal()` directly outside
  the component, which is not exposed.

### 3. What input data produces a wrong answer?

- None found for `size` — `SIZE_CLASSES` is a `Record<NativeModalSize, string>` keyed by the
  literal union, so `boxClass()` (native-modal.component.ts:119-121) cannot look up a missing
  key through the public API; the `?? ''` fallback is dead code but harmless.
- `ariaLabel()` accepts any string, including one that duplicates or contradicts the
  projected `[modal-header]` text; the component performs no cross-check. This is a
  documentation/consumer discipline gap, not a bug in this batch.

### 4. What happens when a dependency fails?

- `HTMLDialogElement.showModal`/`close` missing (jsdom, and per implementation-plan.md:445
  explicitly expected to be "the component throws in tests only"): the component itself has
  no try/catch around the calls in the `effect()` (native-modal.component.ts:111-115) or in
  `ngOnDestroy` (native-modal.component.ts:139-142). In a real browser this is a non-issue
  (both methods are universally supported); the acknowledged gap is purely for jsdom, and is
  worked around at the test level, not the component level — consistent with the plan's own
  accepted risk (implementation-plan.md:445-446, batch-14-report.md:34).
- No dependency injection or async call exists in this component (pure DOM API + signals), so
  there is no network/service failure surface to evaluate.

### 5. What is missing that the requirements never mentioned?

- No real-browser (Playwright/visual) coverage anywhere in this batch verifies the actual
  claims the component's doc comment and design-spec §2.5 make — native focus trap, Esc
  auto-close, and focus-restore to the opener. jsdom cannot exercise any of these, and the
  spec file does not attempt to; this is accepted explicitly by the plan
  (implementation-plan.md:445-446) but it means the component's headline behaviour (the whole
  reason for building it instead of reusing the class-toggle pattern) is currently unverified
  by any automated test in the repository. This is a gap worth tracking against the batches
  that build the three consumers (Batches 27/32) or a later visual-review pass, not a defect
  in this batch's own scope.
- No test exercises `ngOnDestroy` emitting (or not emitting) `closed` — see finding 1 above.
  The existing destroy spec (native-modal.component.spec.ts:158-165) only asserts the `open`
  attribute is cleared, not that the parent's `isOpen` model is reconciled.

## Failure modes

### Parent/dialog `isOpen` desync on destroy-while-open

- Trigger: parent removes the `NativeModalComponent` from the DOM (e.g. `@if`, route change)
  while `isOpen()` is still `true`.
- Symptom: dialog closes correctly (no leaked top-layer element), but the parent's `isOpen`
  signal is never reset. If the same signal instance is reused when the modal is re-mounted,
  it will immediately reopen with a stale "open" state.
- Evidence: native-modal.component.ts:138-143 (`ngOnDestroy` calls `close()` but never emits
  `closed`).
- Current handling: none; silent.
- Recommendation: either emit `closed` from `ngOnDestroy` when the dialog was open at destroy
  time, or explicitly document (as the drawer does not either, per native-drawer.component.ts
  precedent — worth checking) that parents must reset `isOpen` themselves on destroy/navigate.

### Esc-driven native close vs. parent `isOpen` lag

- Trigger: Esc is pressed and the parent's `(closed)` handler does not synchronously flip
  `isOpen` to `false` (async guard, confirmation step, or a handler that no-ops).
- Symptom: the underlying `<dialog>` element is already closed (browser default action), but
  the component's `isOpen` input remains `true`; the `effect()` never re-runs to reconcile
  because no signal changed, so the modal cannot be reopened by toggling `isOpen` from
  true→true, and any code relying on `isOpen()` to reflect real dialog state is wrong.
- Evidence: native-modal.component.ts:108-116, 129-131; design-spec.md:208-211 acknowledges
  the browser closes the dialog on cancel independent of the component.
- Current handling: contract explicitly delegates reconciliation to the parent; the component
  cannot fix this without owning `isOpen` itself, which the design intentionally avoids.
- Recommendation: none required of this component under the stated contract; flag as a
  constraint the three consumer batches (27/32) must respect — their `(closed)` handlers must
  be synchronous `isOpen.set(false)` calls, not async.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

1. **Moderate** — `ariaLabel` is optional with no enforcement, and the dialog has no
   `aria-labelledby`/`aria-describedby` fallback (native-modal.component.ts:68, 94). This
   matches design-spec §2.5 verbatim (design-spec.md:190, 214-216) and implementation-plan §8
   (implementation-plan.md:439), so it is not a deviation from the approved contract — but it
   is a real accessibility gap if a future consumer forgets to pass `ariaLabel`, since nothing
   catches the omission. Recommend flagging to the architect for the three consumer batches
   rather than reopening this batch.
2. **Minor** — batch-14-report.md:9 states the backdrop-click spec "dispatches a click event
   instead of `.click()`" specifically to avoid the jsdom `requestSubmit` "Not implemented"
   console error. Running the spec in isolation shows the error still fires as a
   `console.error` (jsdom's activation behaviour on the bubbling click still calls
   `requestSubmit`); the test still passes because Jest does not fail on `console.error` by
   default. The report's stated reason for the dispatch choice is inaccurate — the change
   avoids `.click()`'s synchronous throw, not the console error — though the test itself is
   not broken. See `native-modal.component.spec.ts:117-126`.
3. **Minor** — `ngOnDestroy` closing behaviour has no companion test asserting `closed` is or
   isn't emitted (native-modal.component.spec.ts:158-165 only checks the `open` attribute).
   Given finding 1 above, a test locking in the current (silent) behaviour would make the
   contract explicit rather than incidental.

## Data flow

1. Parent sets `isOpen` signal → `true`. OK.
2. `effect()` reads `isOpen()` and `dialog()`, calls `dialog.showModal()`. OK — single call
   per true transition, per Angular signal semantics (no re-run without a value change).
3. User presses Esc → browser fires `cancel`, browser default action closes the dialog →
   `onCancel()` emits `closed`. OK for the component; gap is downstream if the parent handler
   is not synchronous (see failure mode above).
4. User clicks backdrop button → `requestClose()` emits `closed`; jsdom-only side effect: the
   button's native form-activation behaviour also fires and logs (not throws) in tests. OK in
   real browsers (`method="dialog"` intercepts submission without navigation).
5. Parent sets `isOpen` → `false` → `effect()` calls `dialog.close()`. OK, no-op-safe if
   already closed.
6. Component destroyed while dialog open → `ngOnDestroy` calls `close()`. OK for DOM cleanup;
   gap is the parent's `isOpen` signal is left stale (see failure mode above).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| `isOpen` drives `showModal()`/`close()` via effect, no class toggle | COMPLETE | none |
| `closed` output on cancel and backdrop click, component never self-closes | COMPLETE | none |
| `[modal-header]`/default/`[modal-footer]` slots | COMPLETE | none |
| `size` → `modal-box` width class (sm/md/lg) | COMPLETE | none |
| `aria-label` on the dialog | COMPLETE | optional per spec; no enforcement (moderate finding 1) |
| `ngOnDestroy` closes if open | COMPLETE | does not reconcile parent `isOpen` (failure mode) |
| Barrel export matches sibling (`drawer/index.ts`) shape | COMPLETE | none |
| Native focus trap / Esc / focus-restore | COMPLETE (by delegation to browser) | unverified by any automated test in this repo (five-questions §5) |

Implicit requirements not addressed: none beyond the accessibility-enforcement and
destroy-reconciliation gaps already logged as moderate/failure-mode findings above.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| `isOpen` true on first render | YES | effect calls `showModal()` once `dialog()` resolves | none |
| `isOpen` false on first render | YES | effect calls `close()`, no-op on jsdom stub and per spec on real `<dialog>` | none |
| Esc with synchronous parent handler | YES | `cancel` → `closed` → parent flips `isOpen` → effect closes (no-op, already closed) | none |
| Esc with async/absent parent handler | NO | dialog already closed by browser; `isOpen` signal never reconciled | desync, contract explicitly assigns this to parent (see failure modes) |
| Destroy while open | PARTIAL | `ngOnDestroy` closes the DOM element | parent's `isOpen` signal not reset (finding 1) |
| Missing `ariaLabel` | NO enforcement | attribute simply omitted | unnamed dialog for assistive tech (moderate finding 1) |
| `showModal`/`close` unsupported (jsdom) | YES (test-only) | stubbed per plan's accepted risk | real focus-trap/restore claims remain unverified anywhere in the suite |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking within this batch's own scope; the real risk is downstream — the
  three consumer batches (27/32) must give `(closed)` synchronous `isOpen.set(false)`
  handlers and must always pass `ariaLabel`, since this component enforces neither.
- What a robust implementation would add: emit `closed` from `ngOnDestroy` when destroying an
  open dialog (or explicitly document that parents must reset `isOpen` on unmount); a real
  end-to-end/visual test (Playwright) somewhere in the task that actually exercises native
  focus trap and focus-restore, since jsdom structurally cannot; and a spec asserting
  `ngOnDestroy`'s effect on the `closed` output (currently untested either way).
