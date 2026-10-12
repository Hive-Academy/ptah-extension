# Code Logic Review, Phase C (B5a + B5b) - TASK_2026_629_c0b3

Scope: commits 599deb687 (B5a) and fd290fac9 (B5b). Read-only; no tests or checks were run. I read the diffs plus the surrounding code in the chat view, tab manager, canvas tile, grid and store.

Score: 5/10. Verdict: REVISE.

The token signal is wired correctly and reactively, and the forced card does not itself write the stored mode or touch grid geometry. But the card's "open full view" path writes the stored mode, the dock and sidebar gate regresses non-canvas surfaces, and the auto-card unmounts the composer, which holds the user's draft in component-local state.

## Answers to the specific questions

### Q1. Dock/sidebar gate and non-canvas surfaces: regression, yes

- Main chat panel mounts `<ptah-chat-view />` with no `SESSION_CONTEXT` or token (`app-shell.component.html:830`). `resolvedViewMode` then falls to `tabManager.activeTabViewMode()` (`chat-view.component.ts:913-920`).
- A user can set a tab compact there. The tab bar forwards `viewModeToggle` to `tabManager.toggleTabViewMode` (`tab-bar.component.ts:100,319-321`; button in `tab-item.component.ts:74-80`). The card's expand action also uses it (`chat-view.component.ts:1968-1972`).
- Before B5a, a compact active tab in the main panel still rendered the dock (Electron: Displays | Agents) or the agent sidebar tab (VS Code webview and others). After B5a the dock and sidebar are gated on `!showCompactCard()` (`chat-view.component.html` diff, lines ~268 and ~340), and `showCompactCard` includes user-chosen compact (`chat-view.component.ts:922-926`).
- Result: compacting a tab in the main panel removes the Displays dock and the Agents toggle. It also unmounts the Agents panel, with no token present. This violates "token absent -> same as today".
- The `@if/@else if` chain does not fall through to the sidebar branch when the dock is enabled, so nothing renders in its place.
- Other mounts: `conductor-tile.component.ts:142` (Tribunal, already `hideAgentSidebar`) and `canvas-tile.component.ts:580`. Canvas tile with a user-chosen compact mode also loses its sidebar, which is a change from today, though it is the intent of D2 for tiles.

### Q2. Reactivity: correct

- `createEnvironmentInjector` runs in `ngOnInit` (`canvas-tile.component.ts:616-626`), and the outlet is guarded by `@if (childInjector())` (`:416-420`), so the ChatView cannot exist before the injector.
- `useValue: this.autoCard` is the signal-input instance. `showCompactCard` is a `computed` that reads `_forcedCard?.()` (`chat-view.component.ts:922-926`), so a focus change flips it without re-creating the injector or the ChatView.
- The inputs are signal-based, and the grid binding re-evaluates on `canvasStore.focusedTabId()` and `items()`.

### Q3. Focus change: no stored write by the token itself, but side effects exist

- Not written: `showCompactCard` is read-only over `resolvedViewMode`. Gridstack nodes do not depend on the token (the grid spec asserts equal geometry). The ChatView, tile and session are not remounted.
- Destroyed on focus loss: the whole non-card `@else` branch, meaning the transcripts (`chat-view.component.html:80-95`), the composer `<ptah-chat-input />` (`:263`) and the dock/sidebar. See S1 and M2 below.
- The stored mode IS written through the card's expand paths. See S2 below.

### Q4. Edge cases

- Tile count: `items().length` is derived from the grid's own `tiles()`, which is per-workspace (`canvas-workspace-grid.component.ts:239-240,331`). Add and remove flip tiles in the same change-detection pass, so there is no torn state. See M4 for the 2->3 and 3->2 bursts.
- `focusedTabId` null: closing the focused tile sets focus to null (`canvas.store.ts:507-508,611-612`). With 3 or more tiles, every tile then shows a card and none is live. See M3.
- Layout-focus (maximize) preset: `toggleLayoutFocus` (`canvas.store.ts:382-389`) does not set canvas focus. Layout-focus on an unfocused tile gives a maximized tile showing a card. See M3.
- Hidden workspace grids: see M1.

## Serious

### S1. Auto-card destroys the unsent draft, attachments and pasted images
- File: `chat-view.component.html:15-17,263` (composer sits in the `@else` branch); `chat-input.component.ts:658,674,675` (`_currentMessage`, `_selectedFiles`, `_pastedImages` are component-local signals).
- Scenario: 3 or more tiles. The user types in the focused tile, then clicks another tile (or a tile is added or closed so focus moves). The previously focused tile flips to a card, `ptah-chat-input` is destroyed, and the text and attachments are gone. Refocusing mounts a fresh empty composer.
- Impact: silent data loss on an ordinary action. Previously a tile never lost its composer from a focus change. A user-chosen compact toggle had the same property, but that was deliberate and not automatic.
- Fix: persist the draft before unmount (tab-scoped draft in `TabState` or a store keyed by tabId, restored in the composer), or keep the composer mounted but visually hidden (`[hidden]`) when only the transcript is the budget concern. Add a test: type, unfocus, refocus, expect the draft to survive.

### S2. "Open full view" / "show output" / lane click on a forced card writes the stored mode, inverted
- File: `chat-view.component.html:12`, `chat-view.component.ts:1968-1972`, `tab-manager.service.ts:2970-2977`, `compact-session-card.component.ts:88,91,320-321`.
- Scenario: a tile with stored mode 'full' is forced to a card. The user clicks "open full view", "show output" or a lane row. `SESSION_CARD_ACTIONS` is not provided by anything yet (grep shows no provider), so the card emits `expandToFull`. The handler calls `toggleTabViewMode`, which sees 'full' and writes 'compact'. The card stays (the token is still on). The click also bubbles to the tile and focuses it.
- Impact: contradicts the batch contract ("stored mode never written") and AC 1.x. The tile now has a persisted compact mode and `compactHeightUnits`, so the grid shrinks it (geometry change) and it stays a card even while focused. The user clicked "open full" and got the opposite. It persists across reload.
- Fix: make `expandToFullView` write `'full'` explicitly via `setViewMode` (and do nothing if already 'full'), or, when the card is forced, route to `canvasStore.focusTile` only. Add a test: forced card plus click on open-full leaves the stored mode unchanged and the tile focused/live.

### S3. Dock and sidebar gate regresses non-canvas surfaces (Q1)
- File: `chat-view.component.html` (dock `@if` and sidebar `@else if`), `chat-view.component.ts:922-926`.
- Scenario: main panel, user compacts the active tab. The Displays/Agents dock (Electron) or Agents sidebar tab (webview) vanishes, though no token is present.
- Impact: violates the "token absent -> same as today" requirement; users lose the Displays tab while in compact mode.
- Fix: gate on the forced signal only, e.g. `protected readonly forcedCard = computed(() => this._forcedCard?.() ?? false)` and `!forcedCard()` in the two conditions, leaving `showCompactCard` for the card branch. Add a test: no token, user-compact, dock still rendered.

## Moderate

### M1. Hidden workspace grids compare against the active workspace's focus
- File: `canvas-workspace-grid.component.ts:131-136`; `canvas.store.ts:142-147` (`focusedTabId` is the active workspace's only), versus the per-workspace tiles at `:239`.
- Scenario: a retained hidden grid (display:none) with 3 or more tiles never matches any tile as focused, so all become cards. Its live transcript and composer are torn down when the user switches workspace, and rebuilt when returning. This breaks the keep-alive intent stated near `:95` and drops drafts (S1). `[focused]` already had this quirk, but it only gated visibility behaviour before; now it destroys state.
- Fix: use the focus of this grid's workspace (a `focusedTabIdFor(path)` accessor) for both bindings, or force `autoCard` false when `!active()`.

### M2. Transcript scroll and stream UI state are lost on every focus flip
- File: `chat-view.component.html:80-95`, `transcript-retention.service.ts` (retention is per ChatView, and the whole `@else` branch is destroyed).
- Scenario: the user scrolls up in the focused tile, clicks another tile, and returns. The transcript remounts at the default scroll position. Stream data is in the store, so no data loss, but position and expanded-state are lost. Remounting a large transcript on each focus click is also a cost spike.
- Fix: acceptable if documented; otherwise keep the retention-service mount or save and restore the scroll position per tab.

### M3. Null focus and layout-focus leave nothing live or a maximized card
- File: `canvas-live-budget.ts:7`, `canvas.store.ts:507,611,382`.
- Scenario A: closing the focused tile when 3 or more tiles remain gives focus null, so zero live tiles and every tile is a card until the user clicks. Scenario B: "Focus" (layout focus) on an unfocused tile maximizes a card, because layout focus does not move canvas focus.
- Fix: on tile close, focus a neighbour; make layout focus also call `focusTile`, or treat `layoutFocusTabId` as focused in the rule (it exists in the grid at `:296`).

### M4. 2->3 tile transition flips the live second tile to a card
- File: `canvas-workspace-grid.component.ts:132-135`. Adding a third tile (add focuses the new one) tears down the other live tile and its composer in the same pass (see S1). Removing back to 2 mounts two transcripts at once.
- Fix: fix S1; otherwise this is acceptable as the stated rule.

## Minor

- `canvas-workspace-grid.component.ts`: the file is now 703 lines against a 700-line lint limit (the B5b report notes the warning).
- `autoCard` has no doc comment (`canvas-tile.component.ts:438`), unlike `focused`.
- `index.ts:34-35`: the two exports of the same module could be merged.
- B5a also reformatted unrelated lines (`chat-view.component.ts` budget lines); noise only.

## Requirement fit

| Item | Status |
|---|---|
| Token absent -> same as today | PARTIAL (S3: dock/sidebar differ for user-compact) |
| Forced card never writes stored mode | PARTIAL (S2 via expand paths) |
| Geometry unchanged across focus | COMPLETE for the token itself (S2 can change it indirectly) |
| Budget rule: >2 tiles, unfocused -> card | COMPLETE as coded; M1 and M3 edge cases |
| Reactive, no injector re-creation | COMPLETE |

Residual uncertainty: no browser run. Whether anything else re-saves the stored mode on blur was not traced beyond the tab-manager call sites listed.
