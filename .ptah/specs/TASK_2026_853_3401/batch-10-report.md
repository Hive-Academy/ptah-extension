# Batch 10 report: detached-window bootstrap and layout persistence

## Files

- MODIFIED `apps/ptah-extension-webview/src/main.ts`: when
  `URLSearchParams(window.location.search).get('ptahWindow') === 'display'`, `main.ts` lazy-imports
  `./app/display-window/display-window.config`. Then it calls `mountDisplayWindowHost(document)` and
  `bootstrapApplication(DisplayWindowComponent, displayWindowConfig)`. Otherwise the main app boots
  exactly as before. `getRpcClient().markReady()` still runs for both windows.
- CREATED `apps/ptah-extension-webview/src/app/display-window/display-window.config.ts`:
  - `displayWindowConfig`: `provideBrowserGlobalErrorListeners`, `provideZonelessChangeDetection`,
    a console `ErrorHandler`, `provideVSCodeService()`, `provideMessageRouter()`, and
    `MESSAGE_HANDLERS` → `ClaudeRpcService` and `DisplayWindowStateHandler`.
  - It provides no `DisplayWindowSync`, `ElectronLayoutService`, chat or streaming stores, or
    router. The child never calls `setState`.
  - `mountDisplayWindowHost(doc)` swaps the shared `index.html`'s `<ptah-root>` for
    `<ptah-display-window>`, appends one if `<ptah-root>` is missing, and is idempotent.
  - The module re-exports `DisplayWindowComponent` from `@ptah-extension/chat`.
- CREATED `.../display-window/display-window.config.spec.ts` (11 tests):
  - Pins the `main.ts` branch: dynamic-only import of the config, and the main bootstrap kept.
  - Pins the handler list (exactly `ClaudeRpcService` and `DisplayWindowStateHandler`), the router,
    and the absence of `DisplayWindowSync` and `ElectronLayoutService`.
  - A raw `displayWindow:state` window message reaches `DisplayWindowStateHandler` through the real
    `MessageRouterService` (built from the config's providers).
  - Covers the three `mountDisplayWindowHost` cases.
- MODIFIED `libs/frontend/core/src/lib/services/electron-layout.service.ts`:
  - `displaySidebarWidth` (`Signal<number | null>`, default `null`) and
    `setDisplaySidebarWidth(width | null)`. The setter persists at once, so it is a commit-point
    API: drag end, key step, reset. `null` resets.
  - Non-finite widths are dropped without persisting. Widths are rounded with a 300 px floor. The
    host-relative 75% max stays in ChatView's `clampDockWidth`.
  - `persistLayout` writes `displaySidebarWidth`. `restoreLayout` applies a stored number without
    re-persisting. Any other stored value keeps `null`.
- MODIFIED `libs/frontend/core/src/lib/services/electron-layout.service.spec.ts`:
  - The exact persisted-object assertion now includes `displaySidebarWidth: null`.
  - Added a "Display sidebar width" describe (6 tests) and restore tests (round trip, 5 invalid
    stored values, floor).

## Verification

- `npm run verify -- -p @ptah-extension/core,ptah-extension-webview` (lint, test, typecheck; 6 tasks):
  5 passed and 1 failed.
  - `@ptah-extension/core` lint, test and typecheck pass. `ptah-extension-webview` test and
    typecheck pass, including the new spec.
  - `ptah-extension-webview:lint` first reported one new error,
    `explicit-member-accessibility` on `handleError`. It is fixed (`public`).
  - Re-run `npm run verify -- -t lint -p ptah-extension-webview`: the only error left is the known
    pre-existing `app.routes.ts` / `scene-contrast.spec.ts` circular dependency (plus a
    pre-existing warning in `glass-scrim.spec.ts`).
- No other spec in `apps/` or `libs/frontend` pins the exact `electron-layout` object.

## Deviations

- `index.html` is unchanged. The plan left open whether `index.html` or the bootstrap provides the
  host element. `mountDisplayWindowHost` swaps the element at boot, so both windows share one HTML
  file with the same CSP meta and theme boot script.
- `main.ts` lazy-imports only the local config module. The config re-exports
  `DisplayWindowComponent`, so `main.ts` has no dynamic `import('@ptah-extension/chat')`, which the
  Nx static-vs-lazy library rule would flag. `@ptah-extension/chat` is already in the main eager
  bundle, so the child chunk is small.
- The child uses zoneless change detection unconditionally. It does not read the main app's
  `zoneChangeDetectionFallback` flag.
- `setDisplaySidebarWidth` persists on every call, unlike the split `set*`/`commit*` pairs. The
  plan says ChatView "commits on drag end, key step and reset", so drag frames stay in
  `PanelResizeService` and only the commit reaches this setter.

## For batch 11

- Seed `PanelResizeService` from `layout.displaySidebarWidth()`. `null` means use the ChatView
  default. Clamp with `clampDockWidth` (min 300, max 75% of the host). Call
  `layout.setDisplaySidebarWidth(w)` only on drag end, key step and reset (`null` on reset).
- Do not call the setter per drag frame: it persists through `setState` every time.
- Theme in the child: the shared `index.html` boot script applies the persisted theme (from shared
  `localStorage`) and loads `theme-extra.css` for deferred themes at child boot.
  `DisplayWindowComponent` then mirrors only the `data-theme` and `data-theme-mode` attributes. If
  the user switches to a deferred theme while the window is open, the child has no extra sheet
  until it reopens. This was not fixed here and needs a follow-up or the visual review.
- The batch 9 chat suite showed one flaky unrelated spec (`stdout-visibility.spec.ts`). If it
  fails again, re-run it alone before you investigate.
