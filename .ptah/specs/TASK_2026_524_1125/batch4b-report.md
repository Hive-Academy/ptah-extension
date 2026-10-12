# Batch 4b report — `navigateToUrl` and route persistence

Worktree: `.claude-worktrees/task-524-batch3-4` (branch `refactor/task-524-batch3-4-route-reuse`).
No git commands were run. This batch does not wire `start()` into `app.config.ts`/`app.ts`; that is 4d.

## Files

- MODIFIED `libs/frontend/core/src/lib/routing/surface-router.service.ts`
  - Adds `navigateToUrl(route): Promise<SurfaceNavigationResult>`.
  - `navigateToSurface`'s result mapping moved, unchanged, into a private `navigateToTree(tree)`. Its error log moved into `reportFailure(destination, error)`, with the same message text. Both methods now share them, so the mapping is identical by construction.
  - The segment read moved out of `surfaceOf` into a private `firstPrimaryPath(tree)`. `surfaceOf` behaves as before.
- MODIFIED `libs/frontend/core/src/lib/routing/surface-router.service.spec.ts`
  - Adds a `navigateToUrl` describe block.
  - The `navigates to %s` case now expects `/thoth/memory` for thoth, because of the helper's new redirect.
- CREATED `libs/frontend/core/src/lib/routing/surface-route-persistence.ts`: root `SurfaceRoutePersistence` with `start(seed)`.
- CREATED `libs/frontend/core/src/lib/routing/surface-route-persistence.spec.ts`.
- MODIFIED `libs/frontend/core/src/lib/routing/index.ts`: exports `SurfaceRoutePersistence`. `index.ts:54` of core already re-exports `./lib/routing`.
- MODIFIED `libs/frontend/core/src/testing/surface-router-testing.ts`: `surfaceTestRoutes()` gains the production child shapes.
  - chat: `[{ path: '', children: [] }, { path: ':tabId', children: [] }]`;
  - thoth: `[{ path: '', pathMatch: 'full', redirectTo: 'memory' }, { path: ':tab', children: [] }]`.

## Design notes

- **Parsing.** `navigateToUrl` parses with the injected `UrlSerializer` (the same instance the Router uses), not `Router.parseUrl`.
  - `Router.parseUrl` catches a parse error, warns, and returns `/` (`@angular/router` `_router-chunk.mjs:4703-4710`).
  - With the serializer, a malformed URL throws inside the `try` and becomes `failed`, as section 6 requires.
  - Probed: `/chat(a` (unbalanced group) and `/chat%` (malformed escape) throw. `/chat(` and `/chat)` parse to `/chat`.
- **Surface gate.** `isSurfaceRouteId(firstPrimaryPath(tree))` checks the raw first segment, which is the same segment `surfaceOf` reads.
  - A legacy alias (`/orchestra-canvas`), an unknown id, `/` and a wrong case (`/Settings`) all return `failed` with a `console.warn`, and `navigateByUrl` is not called.
  - Without this gate, the wildcard would silently land on chat; with it, boot falls back to the host value (R8).
- **Persistence lifetime.** `start(seed)` has a `started` flag, and the first call fixes the seed.
  - It makes one `Router.events` → `NavigationEnd` subscription. The subscription is released through the root `DestroyRef.onDestroy`, following the pattern in `back-office-activity.service.ts:101,146`.
- **What it writes.** Each `NavigationEnd` writes `vscodeService.setState(WEBVIEW_ROUTE_STATE_KEY, { v: 1, route: urlAfterRedirects, seed, panelId: config().panelId ?? '' })`, typed as `WebviewRouteState`.
  - It is gated on `vscodeService.isConnected()`. This also avoids `VSCodeService.setState`'s own "API not available" warning on every navigation in a plain browser.
- **Failure handling.** `setState` is wrapped in `try/catch`. A failure logs one `console.warn('[SurfaceRoutePersistence] Could not persist the route:', message)` per failed write, and the subscription survives.
  - The write is not awaited; Electron IPC is asynchronous (R7).
  - The logging convention was checked: `[ServiceName]`-prefixed `console.warn`/`console.error` is what core uses (`surface-router.service.ts`, `vscode.service.ts:200,240`).
- **Round trip.** `parseWebviewRouteState` accepts `panelId: ''` (`SIDEBAR_PANEL_ID`, `webview-route-state.ts:37,184`). There is no contract mismatch.

## Tests

Command: `npx jest -c libs/frontend/core/jest.config.ts <4 specs> --coverage=false --maxWorkers=2`

Result: **Test Suites: 4 passed; Tests: 209 passed, 209 total.** The four specs are the two changed specs plus `surface-active.spec.ts` and `app-state.service.spec.ts`, the other core users of the helper.

- `surface-router.service.spec.ts`: 13 new cases.
  - Lands on `/chat/<uuid>` and on `/thoth/skills`.
  - Keeps matrix, query and fragment.
  - Reports `already-there` on a repeat.
  - Four cases for "no surface", each returning `failed` with no `navigateByUrl` call.
  - Two unparsable URLs return `failed` and never reject.
  - A `navigateByUrl` throw returns `failed`.
  - Mocked `false` returns `cancelled`.
  - A real supersession returns `cancelled`.
- `surface-route-persistence.spec.ts`: 13 cases. It runs the real `VSCodeService` over a fake `window.vscode`.
  - Writes `urlAfterRedirects` (`/thoth` → `/thoth/memory`) with the seed and the panelId.
  - Writes once per settled navigation; a navigation that does not settle writes nothing.
  - Keeps the other state keys.
  - Round-trips through `parseWebviewRouteState` for `''`, `electron-main` and `ptah.panel.<uuid>`, for an undefined config panelId (written as `''`), and for a matrix/query/fragment URL.
  - Not connected: no write and no warning.
  - `setState` throws: one warning per failed write, navigation unaffected, and the next navigation retries.
  - A second `start`: one write per navigation, and the first seed is kept.
  - Nothing is written before `start`.

## Verification

- `npx nx typecheck @ptah-extension/core --parallel=1`: success. This covers `tsconfig.lib.json`, which excludes specs.
- `npx tsc --noEmit -p libs/frontend/core/tsconfig.spec.json`: 0 errors in the touched files. The config reports 100 errors in other, untouched files; they were already there. Jest runs `isolatedModules`.
- `npx nx lint @ptah-extension/core --parallel=1`: 0 errors, 14 warnings. None of the warnings is in a touched file.

## Deviations

- The plan said to use the "existing private `surfaceOf` plus `isSurfaceRouteId` on the raw segment". `surfaceOf` already falls back to chat, so the raw segment cannot be read back from its result. The segment read was therefore extracted into `firstPrimaryPath`, and both use it. `surfaceOf`'s behaviour is unchanged.
- The plan said to parse inside `try`. The service uses `UrlSerializer.parse`, not `Router.parseUrl`, for the reason above.

## Risks and notes for later batches

- **Other libs using `surfaceTestRoutes`/`provideSurfaceRouterTesting`.** These were not run, because only core changed (CLAUDE.md rule). Recommend the orchestrator runs them once the projects are verified.
  - `chat`: `app-shell.retained-chrome`, `app-shell.organization`, `app-shell.auth-redirect`, `settings.component`, `workspace-coordinator.service` specs.
  - `marketplace`: `marketplace.routes.spec.ts`.
  - `harness-builder`: `setup-hub.component.spec.ts`.
  - What a grep shows:
    - No spec asserts `router.url === '/thoth'` or a `/chat/...` URL.
    - `marketplace.routes.spec.ts:204` replaces only `marketplace`, and its `visit('/chat')` still lands on `/chat` through the `''` child.
    - `app-shell.auth-redirect.spec.ts:148-156` replaces the thoth route entirely.
    - `workspace-coordinator.service.spec.ts:521` calls `setCurrentView('thoth')`. That now settles on `/thoth/memory`, but `currentView()` is still `thoth`.
  - Low risk.
- **Thoth repeat navigation.** After the helper change, `navigateToSurface('thoth')` while on `/thoth/memory` builds `/thoth`. That URL differs from `router.url`, so the method reports `navigated` (after a redirect), not `already-there`. Production gains the same shape in 4e, so 4e should confirm that callers do not depend on `already-there` for thoth.
- **Seed length.** `start(seed)` writes the seed as given. A host `initialView` longer than 64 characters would produce a record that `parseWebviewRouteState` rejects, so the restore would fall back. Host values are short surface ids today, so 4d does not need to clamp.
- **Colon routes.** A settled URL that carries a colon (other than the skill-ref shape) is still written, and the parser rejects it on restore, which is a safe fallback. Chat tab UUIDs and thoth tabs carry no colon.

## Revise round 1 (`batch4b-review.md`)

### Defect 1 — a rejected URL erased the last restorable route

- `persist()` now runs the record through `parseWebviewRouteState({ [WEBVIEW_ROUTE_STATE_KEY]: record })` before writing.
  - When the parser rejects the record, the write is skipped, so the last good `ptahRoute` survives `setState`'s whole-entry replace.
  - When the parser accepts it, the parser's own fresh object is written.
- Skips log a single `console.warn('[SurfaceRoutePersistence] …')` per service lifetime (a `warnedRejected` flag). Later skips are silent, so a user who browses query URLs with colons does not flood the console.
- The shared parser is unchanged.

### Defect 2 — an overlong seed made every record unrestorable

- `start(seed)` now normalizes the seed once, through `acceptedSeed(seed)`.
  - It checks the seed with the shared parser against a minimal valid record (`route: '/'`, `panelId: ''`), so the 64-character cap is not duplicated.
  - A rejected seed is stored as `null`.
- **D5 check, `boot-navigation.ts:58-63`.** Rule 2 fires when `hostInitialView != null && (restored === null || hostInitialView !== restored.seed)`.
  - With `restored.seed === null`, every non-null host value differs from it, so the host deep link wins on the next boot. That is the same outcome as having no saved state at all, which is what D5 gives a deep link the webview has not consumed.
  - Consequence: a panel whose host keeps sending the same overlong `initialView` never restores its route. The host value wins on each reload, as it would for a fresh panel, rather than the record being unreadable. No such host value exists today; host values are short surface ids.
  - When the host sends `null`, rule 2 does not fire and the saved route restores normally.

### New specs (`surface-route-persistence.spec.ts`, describe "records the restore contract rejects")

- `it.each`, 4 cases. `/settings` is saved first. The test then navigates to `/settings?time=12:30`, `/settings#at:top`, `/chat(aux:help)` (a component-less `aux` outlet route is added so it settles) or a URL longer than 2048 characters.
  - The navigation resolves `true`.
  - The stored record is still `/settings`, after exactly one write.
  - Exactly one warning is logged.
- Three rejected navigations in a row: zero writes and exactly one warning.
- After a skip, the next accepted URL (`/analytics`) is written again.
- A 65-character seed: the written seed is `null`, and the record parses as `{ v: 1, route: '/settings', seed: null, panelId: '' }`.
- A 64-character seed, the boundary: the seed is kept.

Persistence spec total: 13 → 21 cases.

### Verification

Not run. The coordinator asked me to hold the checks while another heavy check is in flight. When cleared, run in this order:

1. `npx jest -c libs/frontend/core/jest.config.ts libs/frontend/core/src/lib/routing/surface-route-persistence.spec.ts libs/frontend/core/src/lib/routing/surface-router.service.spec.ts --coverage=false --maxWorkers=2`
2. `npx nx typecheck @ptah-extension/core --parallel=1`
3. `npx nx lint @ptah-extension/core --parallel=1`

## D6 extras (added for batch 4e)

- `navigateToSurface(id, subPath = [], extras: { readonly replaceUrl?: boolean } = {})`.
  - It passes `extras.replaceUrl === true` to the private `navigateToTree(tree, replaceUrl = false)`.
  - That method calls `router.navigateByUrl(tree, { replaceUrl: true })` only when replacing. Otherwise it calls `router.navigateByUrl(tree)` with one argument, exactly as before, so existing callers are unchanged.
  - The JSDoc has a one-line D6 note.
- `navigateToUrl` is unchanged.
- New specs, in `surface-router.service.spec.ts` under "history semantics (D6)", 3 cases:
  - **Replace:** settings → `/chat/tab-1` → `/chat/tab-2` with `replaceUrl`, then `Location.back()` lands on `/settings`. This proves the tab-1 entry was replaced.
  - **Push, the default:** the same sequence without the flag, then Back lands on `/chat/tab-1`.
  - **Call shape:** the default call and `replaceUrl: false` pass one argument to `navigateByUrl`; `replaceUrl: true` passes `{ replaceUrl: true }`.
- These specs use the helper's new `chat/:tabId` child.
- Checks not run yet. They belong to the whole 4b check set the coordinator will clear.
