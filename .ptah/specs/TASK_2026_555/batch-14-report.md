# Batch 14 report — `NativeModalComponent` (S3, Task 14.1)

**Tasks completed**: 14.1 — modal on native `<dialog>` with header/default/footer slots.

## Files changed

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\frontend\ui\src\lib\native\modal\native-modal.component.ts` — `ptah-native-modal`, standalone, OnPush, signal inputs `isOpen` (required), `ariaLabel`, `ariaLabelledby`, `size` ('sm'|'md'|'lg', default 'md'), output `closed`. Always-rendered `<dialog class="modal" data-testid="native-modal-dialog">` with a `modal-box` (`max-w-sm`/`max-w-lg`/`max-w-2xl` per size), `[modal-header]`/default/`[modal-footer]` slots, and the `modal-backdrop` form-button pattern from `confirmation-dialog.component.ts:57-59`. An `effect()` calls `showModal()` when `isOpen` turns true and `close()` when it turns false — no `[class.modal-open]`. `(cancel)` forwards `closed` without the component closing itself; the backdrop button click forwards `closed`. `ngOnDestroy` closes an open dialog and emits `closed` so the parent's `isOpen` does not stay stale. No document listeners.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\frontend\ui\src\lib\native\modal\index.ts` — sub-barrel exporting `NativeModalComponent` and the `NativeModalSize` type, same shape as `drawer\index.ts`.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\frontend\ui\src\lib\native\modal\native-modal.component.spec.ts` — 10 cases: open calls `showModal` and close calls `close`; `cancel` emits `closed` without the component closing itself; backdrop button click emits `closed`; `aria-label` applied (and omitted when unset); `aria-labelledby` applied; missing accessible name reported in dev mode until one is provided; size → width class mapping for sm/md/lg; slot projection; destroy while open closes and emits `closed`; destroy while already closed emits nothing. Uses the jsdom `showModal`/`close` stub pattern from `diff-view.component.spec.ts:55-69`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\frontend\ui\src\lib\native\index.ts` — one added line `export * from './modal';` (the barrel stays a pure list of star exports, per its R7 header rule).

## Stack observed

Angular 22, standalone components, `ChangeDetectionStrategy.OnPush`, signal `input`/`output`, `viewChild` + `effect()`, inline templates and styles, daisyUI `modal`/`modal-box`/`modal-backdrop` classes — read from `native-drawer.component.ts`, `native-popover.component.ts` and `chat\...\confirmation-dialog.component.ts`.

## Design fidelity

Design-spec §2.5 and implementation-plan §8 followed. Deviations: none for behaviour. Two notes:
- `isOpen` uses `input.required<boolean>()` per the plan's contract line (plan:439); design-spec §2.5 prose writes `input<boolean>`. The required form matches `NativeDrawerComponent`'s existing `isOpen` contract, which both documents call the reference.
- The original task prompt mentioned `aria-labelledby`/`aria-describedby`, but plan §8 and design-spec §2.5 specified only `[attr.aria-label]`; the first implementation followed that. The code-logic review then required an `ariaLabelledby` input, which is now implemented (see Review fixes).

## States covered

Open/closed driven by the parent; Esc (`cancel`) and backdrop click request closure only (the parent must flip `isOpen`); focus trap, focus return and the assistive-tech dialog role come from the native `showModal()`/`close()` API, which jsdom cannot exercise — covered by the stub-reflection specs, same as the existing revert-dialog pattern.

## Verification

`npx nx run-many -t typecheck,test,lint -p @ptah-extension/ui @ptah-extension/chat` — PASS after one fix round. First run failed with 2 spec errors (the Jasmine `spyOn` global is not available in this Jest setup; switched to `jest.spyOn`, the repo's convention). The backdrop test also surfaced a jsdom `HTMLFormElement.prototype.requestSubmit` "Not implemented" console error. Correction of the earlier claim: that error is **not** avoided by dispatching the click event instead of calling `.click()` — jsdom's button activation behaviour runs on the bubbling click either way, so the error still logs. The test stays green because Jest does not fail on `console.error`, and in a real browser `method="dialog"` closes the dialog without any submission. The dispatchEvent form is kept and the spec comment now states this accurately. Second run: all 6 targets green (`ui` typecheck/test/lint, `chat` typecheck/test/lint); the `ui` test target runs the full suite including the modal cases, all passing. The `chat` targets were green and untouched in both runs.

Gate G does not apply (nothing is committed after Batch 16 by this batch's own timeline; the team-leader runs Gate G at commit time).

## Risks handled

- jsdom has no `showModal`/`close`: stubbed per the established `diff-view.component.spec.ts` pattern; the plan's "throws in tests only" failure behaviour is therefore never hit.
- The first run's "worker process failed to exit gracefully" warning did not recur in the green run.

## Plan deviations

None beyond the two `isOpen`/aria notes recorded under Design fidelity.

## Not done / out of scope

- The three consumers (`ProviderCatalogModalComponent`, add-instance modal, tier-mapping modal) are Batches 27 and 32, not this batch.
- `Gate G` and the code reviews belong to the team-leader's commit flow.

## Review fixes

The code-logic review (`batch-14-code-logic-review.md`, APPROVED, 3 moderate findings) requested two fixes. Both are applied, in `native-modal.component.ts` and its spec only:

1. **Destroy-while-open now reconciles the parent.** `ngOnDestroy` closes an open dialog and then emits `closed`, so a parent that unmounts the modal via `@if` or a route change while `isOpen` is true does not keep a stale open signal. Emitting during teardown is safe — if the subscriber is already gone, Angular drops the event. Two new spec cases: destroy while open emits `closed` and clears the `open` attribute; destroy while already closed emits nothing.
2. **The dialog must always carry an accessible name.** New input `ariaLabelledby` (id of the visible title) bound as `[attr.aria-labelledby]`, alongside the existing `ariaLabel`. A second `effect()` reports the omission with a dev-mode `console.error` (via `isDevMode()`) when both inputs are empty — the lighter option, since the siblings do not throw either (the drawer avoids the problem with a defaulted label). Three spec cases cover the `aria-labelledby` binding, the dev-mode report while both are empty, and its silence once one is provided; the existing aria-label test was adjusted so unsetting `ariaLabel` no longer trips the new check.

The review's minor finding 2 (the report's inaccurate jsdom claim) is corrected in the Verification section above, and the spec's backdrop-click comment now states the behaviour accurately.

Verification after the fixes: the same Batch 14 verify command ran in the foreground and passed — all 6 targets green (`ui` typecheck/test/lint, `chat` typecheck/test/lint), 10 modal spec cases passing.