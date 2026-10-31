# Streaming composer: implementation report

Worktree: `D:/projects/ptah-extension/.claude-worktrees/streaming-composer` (branch `feat/streaming-composer`). Nothing is committed. All changes are in the working tree.

Skills loaded: `angular-frontend-patterns`, `impeccable` (with `reference/animate.md` and `reference/product.md`). `.agents/skills/impeccable/scripts/context.mjs` does not exist in this worktree, so I ran `.claude/skills/impeccable/scripts/context.mjs` instead.

## Changes

New files
- `libs/frontend/chat/src/lib/services/composer-compact.store.ts`: `ComposerCompactStore`, a signal store provided per component. It holds all of the fold rules:
  - `compact = streaming && idle && !userExpanded`
  - `idle = !hasContent && !focused && !overlayOpen`
  - `expand()` keeps the composer open for the rest of the stream. After 1.5 s idle (`REFOLD_DELAY_MS`) the expansion is cleared.
  - The expansion is also cleared when the stream ends or the tab changes.
  - `unclipped` turns off clipping `UNCLIP_DELAY_MS` (240 ms) after the composer opens.
  - Each timer is released through the effect's `onCleanup`.
- `libs/frontend/chat/src/lib/services/composer-compact.store.spec.ts`: 10 rule tests (fake timers).
- `libs/frontend/chat/src/lib/directives/composer-activity.directive.ts`: `[ptahComposerActivity]`.
  - `focusWithin`: focusin/focusout, re-checked after a microtask. A window blur keeps the focus, so switching apps does not fold the composer.
  - `popoverOpen`: one capture `toggle` listener checks `:popover-open`. The listener is removed when the directive is destroyed.
- `libs/frontend/chat/src/lib/components/molecules/chat-input/composer-type-to-expand.ts` (+ `.spec.ts`): pure helpers `isTypeToExpandKey` and `isInTypingScope`.
  - They accept printable keys typed inside the owning chat view, or on `<body>` when this composer owns document focus.
  - They ignore Ctrl/Meta/Alt shortcuts (AltGr still counts), IME composition, Space, editable fields and type-ahead widgets (menu/listbox/grid/combobox).
- `libs/frontend/chat-ui/src/lib/molecules/composer-compact-bar.component.ts`: presentational `ptah-composer-compact-bar`.
  - Inputs: `statusLabel`, `modelLabel`, `controlsId`, `showStop`, `collapsed`. Outputs: `expandRequested`, `stopRequested`.
  - Layout: a 40 px row on the composer card surface. One main button holds the pulse dot, the status (truncated), the model chip and a chevron. It has `aria-expanded="false"`, `aria-controls` and an sr-only "Expand composer.". The Stop button sits next to it.
  - Only the inner row fades or translates. The glass card itself never changes opacity.
  - The pulse animates opacity only and is turned off under reduced motion.
- `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.streaming-fold.spec.ts`: 9 rendered component tests:
  - `data-compact` / `inert` binding
  - `aria-expanded` / `aria-controls`
  - expanding from the bar focuses the textarea
  - type-to-expand, and Ctrl shortcuts are ignored
  - stays open with a draft, or with focus inside
  - opens when the stream ends
  - Stop on the bar
  - polite announcement
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.viewport-follow.spec.ts`: regression test. When the viewport resizes, a pinned transcript sticks to the bottom again.

Modified files
- `libs/frontend/chat-ui/src/index.ts:66`: exports `ComposerCompactBarComponent`.
- `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts`:
  - `:180`: `ComposerCompactStore` added to the component providers. The imports array adds `ComposerActivityDirective` and `ComposerCompactBarComponent`.
  - `:214-230`: new stage. The full fold wraps the existing form and status line unchanged. That wrapper gets `[id]`, `[attr.inert]` while compact, `ptahComposerActivity` and `is-unclipped`.
  - `:612-640`: bar fold with `ptah-composer-compact-bar`, plus an `aria-live="polite"` announcer.
  - `:662-735`: fold CSS:
    - both folds share one grid cell, bottom-aligned
    - `grid-template-rows: 0fr <-> 1fr` with `overflow: clip` and content anchored to the bottom, at `calc(var(--ptah-motion-in) + 20ms)` = 220 ms with `--ptah-ease-soft`
    - the full region moves with `translate`
    - opacity is animated only on the children of the card and the status line, never on a `data-glass-surface`
    - `prefers-reduced-motion: reduce` turns the transitions off
  - `:973-1105`: wiring:
    - `expandComposer()` (`:1006`): `store.expand()`, then `cdr.detectChanges()` so the region drops `inert` inside the triggering event, then `focus({preventScroll:true})`. A key press that expands the composer therefore lands in the textarea.
    - `stopFromCompact()` (`:1016`): sends focus back to the textarea after the bar goes inert.
    - paste while compact: expands the composer, appends the clipboard text and passes images to `handlePaste`.
    - `setupCompactComposer()` (`:1049`): connects the store. Its effect adds the document `keydown`/`paste` listeners only while compact and removes them in cleanup.
    - announcement effect.
  - `:1523`: dragging files over the composer expands it.
  - `:2120`: `restoreContentToInput` waits to focus until after render when the region is still inert. This covers the queued-message "Edit".
  - `:2130`: constructor calls `setupCompactComposer()`.
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts:389,1430-1457`: the existing ResizeObserver now also watches the scroll viewport. It keeps the last viewport height and calls `scheduleStickToBottom()` when pinned.
- `chat-input.component.spec.ts` (two TestBed setups) and `chat-input.command-center-lock.spec.ts`: these build the component outside its own injector, so they now provide `ComposerCompactStore` (and a `ChangeDetectorRef` stub where the class is constructed directly).

## Decisions

- **Which focus keeps the composer open.** Options: textarea focus only, or focus anywhere in the full composer. I chose the full composer. Evidence: with textarea-only, clicking Mic, `+` or the model chip during a stream folds the composer under the cursor. Popovers that hold focus are covered by the same check. Focus on the compact bar is outside this region, so tabbing to the bar does not expand it. Reversible: yes (store input `focused`).
- **Where state and DOM tracking live.** Options: inside chat-input, or in a store + directive + helper. I chose the store + directive + helper, as the brief asks. The template/CSS and roughly 130 lines of wiring stay in chat-input because they call its private draft signals (`_currentMessage`, `handlePaste`, the textarea ref). Reversible: yes.
- **Queued-message editor.** There is no separate editor. `editQueue()` (chat-view.component.ts:1400) calls `restoreContentToInput`, which puts text in the composer, so `hasContent` keeps it full. I made no change to chat-view. Reversible: n/a.
- **Status line content.** Options: an elapsed timer or activity text, or a fixed label. No per-tab streaming start time or activity signal exists in chat-state or chat-ui; the only one is inside the compact-session summary pipeline. So the bar shows "Ptah is working…", or "Optimizing context…" while `resolvedIsCompacting()`. Reversible: yes (`compactStatusLabel`).
- **Model chip.** The bar reads `ModelSelectorComponent.effectiveModelDisplay()` through `viewChild`, so there is no second copy of the model rule. The chip is a label, not a second menu; clicking it expands the composer. Reversible: yes.
- **Clipping at rest.** `overflow: clip` is needed for the 0fr fold. At rest it would clip the slash/@ suggestions, which are positioned absolutely above the textarea. I considered a CSS keyframe that releases the clip, a `transitionend` listener, or a store timer, and chose the store timer (`unclipped`, 240 ms after the composer opens). Evidence: `unified-suggestions-dropdown.component.ts:64` uses `position: absolute`. A keyframe on `overflow` is not reliable, and `transitionend` does not fire when no transition runs. Reversible: yes.
- **Live region.** I used `aria-live="polite"` without `role="status"`. The existing Command Center lock spec asserts that no `[role="status"]` exists for an unlocked tab, and an aria-live region gives the same polite announcement. Reversible: yes.
- **Typing with nothing focused.** A key typed on `<body>` expands a composer only if the composer is visible and either has no `SESSION_CONTEXT` (main panel) or has `SESSION_FOCUSED` true (the focused canvas tile). This stops 20 canvas tiles from all expanding at once. Reversible: yes.

## Verification

- `npm run verify -- -p @ptah-extension/chat-ui,@ptah-extension/chat`: Nx reported "6 tasks: 5 succeeded, 1 failed". The header names exactly these 2 projects (`verify lint,test,typecheck (@ptah-extension/chat-ui,@ptah-extension/chat)`).
  - Lint and typecheck passed for both projects. chat-ui tests passed.
  - chat tests: 313 of 314 suites passed. 3 tests failed in the "compaction overlay and banner agree (real registries)" block, because its own TestBed lacked `ComposerCompactStore` (NG0201). I fixed the spec providers.
- `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns=chat-input`: 1 task succeeded. Test Suites: 6 passed; Tests: 126 passed.
- `npm run verify -- -t typecheck,lint -p @ptah-extension/chat` (after the spec fix): 2 tasks succeeded.
- The new store, type-to-expand and transcript viewport specs ran in the full chat run and passed.
- Not run:
  - `ptah-extension-webview`: `styles.css` was not changed. Only the existing tokens are used.
  - The Electron and VS Code host projects: CI and the pre-push hook run them.
  - No build, serve or e2e. No visual check in Electron.

## Not done / open questions

- **Visual review in Electron.** The animation, glass rendering, the 40 px bar against the card, and the card rising from the bar have only been checked by reasoning and in jsdom. A screenshot pass is still needed.
- **Pinned transcript during the fold.** The transcript re-sticks on every viewport resize frame, coalesced to one rAF per frame. Watch for jitter on long transcripts during the 220 ms fold.
- **Status text.** An elapsed time or current activity needs a per-tab "turn started at" or activity signal. None exists; adding one is out of scope.
- **Stop then refocus.** After Stop on the bar, focus goes back to the textarea when the stream ends. If the user cancels the abort confirmation, the flag stays set until the next expand. That is harmless: the next expand focuses the textarea anyway.
- **Opacity inside the toolbar.** The fade sets opacity on the card's children. The toolbar contains the attach-menu popover (`data-glass-surface="overlay"`), but no popover can be open while folded or folding, and a closed popover layer is `display: none`.
- **VS Code webview.** It gets the same behaviour because it shares this code. It compiles in the lint/typecheck targets above, but I did not test it by hand.
- **chat-input size.** chat-input.component.ts grew by about 290 lines (template, CSS and wiring). If that is too much, the CSS could move to a `styleUrl` file and the paste/type listeners into a host directive.

## Revise round 2

Source: `visual-review.md` (Electron run), serious finding 1 and the moderate slash-popup note.

### Changes

- `libs/frontend/chat/src/lib/components/molecules/chat-input/composer-type-to-expand.ts:38` - new `wrapsOnlyThisView(target, view)`: the target contains this view and holds exactly one element with the view's tag. `isInTypingScope` (`:44`, check at `:53-58`) now accepts such a target as well as a target inside the view. The exclusions are unchanged and still apply to the wrapper target (editable / type-ahead `closest()` check, Ctrl/Meta/Alt, IME, Space, handled events). The `ComposerTypingScope.view` doc was updated.
- `.../chat-input/composer-type-to-expand.directive.ts:21` - doc comment only (scope now includes the owning wrapper).
- `.../chat-input/composer-type-to-expand.spec.ts:73` - new `focused wrapper around the chat view (canvas tile)` block: the tile wrapper and the embed wrapper expand; the shared grid ancestor holding three `ptah-chat-view`s expands none of them; another tile's wrapper is ignored; Ctrl / IME / a wrapper inside `role="grid"` are still rejected; an ancestor of the fallback host (composer root `div` holding `div`s) never counts. The existing cases are unchanged and pass.
- `.../chat-input/chat-input.component.ts:393` - the suggestions dropdown renders only when `compactStore.unclipped()` is true as well (comment above it explains why).
- `.../chat-input/chat-input.streaming-fold.spec.ts:397,423` - two new specs: after an expand from the bar the dropdown is absent until `UNCLIP_DELAY_MS` passes, then present; with no fold in progress it opens at once. The spec now imports the real `UnifiedSuggestionsDropdownComponent` (the parent reads `getActiveDescendantId()` from it). Also removed a duplicate `ComposerCompactStore` import in that spec.
- Not touched: `composer-compact.store.ts`, `@ptah-extension/canvas`, everything else.

### Decisions

- **Structural rule, not a DI token** (Fix 1). Options: (a) a token the canvas tile provides, (b) "the target contains this view and no other view". Chose (b): no canvas -> chat dependency or new file, and it also covers any other wrapper (`ptah-session-embed`, a future host) without wiring. A canvas grid / app shell holding 20 tiles holds 20 `ptah-chat-view`s, so it matches none: only the clicked tile's composer expands. Cost: one `getElementsByTagName(...).length` per keydown per folded composer, only when the target is outside the view (body and in-view targets return earlier). Reversible: swap the helper for a token check.
- An ancestor that holds only this one chat view (for example a single-panel shell region with `tabindex=-1`) also counts. That is the same outcome as focus on `<body>` for the visible panel, so it is intended. Visibility / `SESSION_FOCUSED` is not required for the wrapper path: the wrapper only has focus because the user clicked inside that tile.
- **Popup fix: gate rendering, not the motion** (Fix 2). Removing the `translate` would drop the agreed rise motion; re-positioning on unclip would still show one wrong frame. Gating on `unclipped()` keeps the slash/@ state (the composer stays open because `overlayOpen` includes `showSuggestions`) and shows the panel ~240 ms after an expand. With no fold in flight `unclipped()` is already true, so main's behaviour is unchanged. While the panel is not rendered, Enter does not send (`showSuggestions()` is true) and arrow keys fall through to the textarea, for at most 240 ms.

### Slash popup finding (caused by this branch)

- Panel positioning: `unified-suggestions-dropdown.component.ts` uses `FloatingUIService.position()` (`libs/frontend/ui/src/lib/native/shared/floating-ui.service.ts:180-235`), which sets `position: fixed` and writes `left/top` from `computePosition(..., { strategy: 'fixed' })`. Floating UI measures relative to the panel's containing block; `@floating-ui/utils` 0.2.12 `isContainingBlock` counts a non-`none` `translate`.
- This branch added `translate: 0 8px` on `.ptah-composer-fold--full > .ptah-composer-fold-clip` while compact, with a `translate` transition back to `none` (`chat-input.component.css`). `git diff main` of the chat-input files shows main has no transform/translate/filter on any ancestor of the textarea; the `.ptah-composer` `container-type: inline-size` rule is identical on main (it was in the inline `styles` there).
- Sequence in the tester's run (`c3_body_slash.png`): body focus -> `/` -> expand -> textarea focused -> slash trigger opens the panel in the same task, while the clip box still carries the animating translate. The clip box is the containing block, so `left/top` are box-relative (small values). When the translate ends at `none`, the containing block becomes the viewport and those small values put the panel near the window's top-left. `autoUpdate` does not reliably recompute on that change (the reference does not resize).
- Main has no translate there, so main does not have this behaviour. Fixed by the render gate above; covered by the two new fold specs. Not re-checked in Electron (this round does not launch it); the electron-tester should re-run check 3b `/` and 3a.

### Verification

- Focused: `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="composer-type-to-expand|chat-input.streaming-fold"` - first run 2 failed (`getActiveDescendantId is not a function`: the dropdown was an unknown element under `CUSTOM_ELEMENTS_SCHEMA`); after importing the real dropdown: `NX 1 task: 1 succeeded`, exit 0. Before that fix the log showed `Tests: 2 failed, 40 passed, 42 total`; the two were the new specs.
- Full: `npm run verify -- -p @ptah-extension/chat-ui,@ptah-extension/chat` - `NX 6 tasks: 6 succeeded, 3 cached` (lint, test, typecheck for both projects; `Cache: 3/6 hit`, the log does not name which three; chat-ui was not changed this round), exit 0.
- Not run: `@ptah-extension/canvas` (not touched), host projects (CI / pre-push), Electron visual re-check.
