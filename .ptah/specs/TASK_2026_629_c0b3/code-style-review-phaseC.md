# Code Style Review, Phase C — TASK_2026_629_c0b3

Scope: `599deb687` (B5a, chat) and `fd290fac9` (B5b, canvas). Read-only; no checks run.

Score: 7/10. Verdict: REVISE (two Moderate findings are cheap to fix; nothing Serious).

## Serious

None. No tag boundary is crossed: chat imports only its own token, canvas imports `SESSION_FORCED_CARD` through the `@ptah-extension/chat` barrel (`canvas-tile.component.ts` import block), and `isCompactViewMode` still comes from `@ptah-extension/chat-types`. Components stay standalone/OnPush, use `inject()` and `input()`.

## Moderate

### M1. Grid file crossed the lint limit because of B5b
- `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts` is 887 physical lines before and 896 after fd290fac9 (+9). Lint reports 703 against 700. B5b's +9 is exactly what pushed it over (it was about 694 before), so B5b owns the new warning. The lane report waved it away as a warning.
- Extract: the `items` computed (`:331-371`, about 40 lines plus the `creationOptions` map and `UNMEASURED_ITEM`) into a pure helper `canvas-grid-items.ts`, or the gesture methods (`cancelGesture`/`settleGesture`/`reconcileGesture`, `:691-725`) with the `GestureSnapshot` types (`:49-62`) into `canvas-gesture-observation.ts`, which already exists beside it. Either removes well over 3 lines. Do not trim the new binding to get under the limit.

### M2. Template calls a function per change-detection pass, and the tile count is recomputed per tile
- `canvas-workspace-grid.component.ts` template, the `[autoCard]` binding (~`:132-137`) calls `isAutoCardTile(items().length, canvasStore.focusedTabId() === item.tabId)` once per tile per pass, and `isAutoCardTile` is re-exposed as a `protected readonly` field (`:373`) only to reach the template. The function is pure and cheap, so the runtime cost is small, but it duplicates the `focusedTabId() === item.tabId` expression already in `[focused]` on the line above, and it is the one place where the budget rule lives in markup instead of a computed.
- The grid already derives per-tile view-model fields inside the `items` computed (`compact`, `firstInOrder`). Put `autoCard` there (compute `tileCount = tiles().length` once, `focusedId = canvasStore.focusedTabId()` once) and bind `[autoCard]="item.autoCard"`. This removes the protected re-export, the duplicate focus comparison and the per-pass calls. Cost: `items` then depends on `focusedTabId`, which it does not read today, so every focus change rebuilds the item array. `track item.tabId` and the `creationOptions` map keep identity stable, so this is acceptable, but the spec at `canvas-workspace-grid.component.spec.ts:459` (geometry unchanged across focus) must keep passing. If that rebuild is unwanted, a separate `autoCardIds = computed(() => Set<string>)` keyed by tabId is the alternative; either is better than the inline call.

## Minor

- m1. `canvas-tile.component.ts:438` `autoCard` input has no doc comment, while its neighbour `focused` (`:429-437`) documents the default and who binds it. Add one line saying it feeds `SESSION_FORCED_CARD` and that an unbound host gets the full view.
- m2. `canvas-live-budget.ts:1-9` has no doc comment on `CANVAS_LIVE_BUDGET` (what "live" means: tiles allowed to render a full transcript) or on `isAutoCardTile`. Name is fine and matches `canvas-running-cap.ts` style (verify its header, which I did not open).
- m3. `session-context.token.ts` (new token, ~`:46-49`): the single-line `/** ... */` comment is 100+ characters on one line, unlike `SESSION_FOCUSED` (`:35-44`), which uses a multi-line block saying who provides it and the absent-means-default behaviour. State "Absent -> false (single chat view, tests)" and that canvas tiles provide it. Naming (`SESSION_*`), typing (`InjectionToken<Signal<boolean>>`) and placement match `SESSION_FOCUSED`. It differs from `SESSION_CARD_ACTIONS` only in that one is a signal and one an interface, which is correct.
- m4. `libs/frontend/chat/src/index.ts:35` adds a second `export { ... } from` of the same module on a new line right under `SESSION_CARD_ACTIONS` (`:34`). It follows the file's existing one-line-per-export style, so this is consistent; merging into `export { SESSION_CARD_ACTIONS, SESSION_FORCED_CARD }` would be tidier but is optional.
- m5. `chat-view.component.ts:922` `showCompactCard` is `readonly` public while its sibling derivations are `protected`; it is only used by the template. Make it `protected readonly` (the removed `isCompactViewMode` field was `protected`). It also lacks a doc comment, unlike `resolvedViewMode` right above (`:906-919`).
- m6. `chat-view.component.ts:841` and `:907` comments still reference `isCompactViewMode(resolvedViewMode())` and `{@link isCompactViewMode}`; they now describe a superseded gate. Point them at `showCompactCard`.
- m7. `canvas-live-budget.ts:7` optional `budget = CANVAS_LIVE_BUDGET` parameter is used only by the spec's custom-budget case. Acceptable for a pure rule, but it is a speculative option with a single production caller.

## Unrelated Prettier reformatting in B5a

Yes. In `chat-view.component.ts`, two hunks only re-wrap lines: `budgetWrapUpRequested` (`:1068-1069`) and `hasNotice` (`:1083-1084`). In `chat-view.component.spec.ts`, the `console.warn` spy was re-wrapped (about `:2270`s, the `jest.spyOn(console, 'warn').mockImplementation(...)` hunk). B5b's tile spec has the same pattern (the `childInjector()!.get(SESSION_FOCUSED)()` expectation re-wrapped). They are harmless, formatter-owned, and arrive because `prettier --write` ran on whole files whose prior state was not formatted. Not a blocker; note that they inflate the diff and would normally go in a separate formatting commit.

## Five style questions (short)

1. Six months: a third forcing source (for example a user pin or a Tribunal conductor) means more OR-terms in `showCompactCard`; the token carries a boolean only, so it cannot say why. Fine today.
2. Misread: `autoCard` (canvas input) versus `SESSION_FORCED_CARD` (chat token) versus stored `viewMode` are three names for one concept. A reader will look for the view-mode write; the commit message and an input doc comment (m1) mitigate this.
3. Maintenance: the dock/sidebar suppression (`chat-view.component.html:268,340`) is coupled to the card state; any new right-hand panel must remember `!showCompactCard()`.
4. Consistency: token and wiring match `SESSION_FOCUSED` and the tile provider list; the inline template function call (M2) is the outlier against how `items` carries other derived tile fields.
5. Differently: move `autoCard` into `items` (M2) and extract `items` into its own file (M1), which fixes both findings at once.

## Pattern compliance

| Rule | Status | Evidence |
| --- | --- | --- |
| Import only through `@ptah-extension/<lib>` barrels | PASS | tile and grid imports of chat; grid imports `./canvas-live-budget` (same lib, relative) |
| chat must not import canvas; chat-ui must not import chat/canvas | PASS | no such imports in either diff |
| Standalone, OnPush, signals, `inject()` | PASS | `input<boolean>`, `inject(SESSION_FORCED_CARD, { optional: true })` |
| Token naming, typing, export style vs `SESSION_FOCUSED` | PASS with doc nit | m3, m4 |
| Lint file-size limit (700) | FAIL (warning) | M1 |
| Derived per-tile state lives in `items` | FAIL | M2 |
| No unrelated reformatting | FAIL (minor) | section above |
