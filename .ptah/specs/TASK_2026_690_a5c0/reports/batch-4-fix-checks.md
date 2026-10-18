# Batch 4 fix checks

## Failures and fixes

| Failure | Cause and ownership | Fix |
| --- | --- | --- |
| `display-sheet.component.ts:53` TS2345 | Component: Angular types `(keydown.escape)` as `Event`, while the handler required `KeyboardEvent`. | `display-sheet.component.ts:124` accepts `Event` and narrows it with `instanceof KeyboardEvent` before handling Escape. |
| “keeps the same panel mounted while collapsed and preserves its inputs on reopen” | Test: it queried the panel immediately after change detection, before `@defer (on immediate)` rendered it. | `display-sheet.component.spec.ts:43` adds a `whenStable()` helper; the test awaits it at line 107, then retains the mount identity and input assertions. |
| “restores each tab’s count, selection and pin when returning” | Test: it read the deferred panel synchronously after returning to the tab. | `display-sheet.component.spec.ts:212` waits for the panel before asserting restored selection and pin. |
| “routes summary actions and shows the service error or the missing-change message” | Test: it queried the deferred panel synchronously before exercising its outputs. | `display-sheet.component.spec.ts:141` waits for the panel; the action and error assertions remain. |
| “gives full mode the remaining flex height while keeping the composer after the sheet” | Test: jsdom does not compute the component stylesheet's `flex-basis`, so `getComputedStyle(...).flexBasis` was empty despite the `sheet-full` class. | `chat-session-layout.component.spec.ts:110-114` checks full-mode host and region classes plus sheet/composer order and content. The component's `:host(.sheet-full) { flex: 1 1 100%; }` declaration is unchanged. |

## Decisions

- Kept `@defer (on immediate)` and waited for its scheduled render in the tests. This preserves the deferred loading behavior and is reversible.
- Tested full mode through classes and DOM structure because jsdom does not resolve the component's CSS layout. This is reversible if a browser layout test is added later.

## Verification

- Scoped `ptah_get_diagnostics` found no diagnostics in the three changed source/spec files. It reported unrelated errors in sibling files.
- Tests, typecheck, lint, and build were not run, per the fix-round instruction. Runtime pass remains unverified.
