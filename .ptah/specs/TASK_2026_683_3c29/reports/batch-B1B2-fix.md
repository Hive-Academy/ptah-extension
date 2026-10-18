# B1/B2 fix round 1

## Fixes

| Review item | Fix | Evidence |
| --- | --- | --- |
| B1-1 | Catch and log each deferred callback failure, then continue flushing the queue. | `libs/frontend/core/src/lib/routing/surface-view-transitions.ts:73-79`; regression spec `surface-view-transitions.spec.ts:235-248` |
| B1-2 | Leave same-surface and reduced-motion transitions untracked and give their view-transition pseudo-elements zero-duration/no animation. Do not call `skipTransition()`, whose `ready` rejection Angular logs in development. | `surface-view-transitions.ts:84-91`; `apps/ptah-extension-webview/src/styles.css:762-772`; specs `surface-view-transitions.spec.ts:152-178` |
| B2-1 | Add `ptah-vt-active` synchronously on `track()` and remove it when the latest transition finishes or rejects; only then give the Electron surface a view-transition name. Superseded transitions leave the class for the latest transition. | `surface-view-transitions.ts:39,54-70`; `styles.css:754-756`; specs `surface-view-transitions.spec.ts:126-141,190-203,251-262` |
| B2-2 | Set the root group to 180 ms and the named surface group to `--ptah-motion-in` (200 ms), both with `--ptah-ease-soft`. The existing reduced-motion group/old/new rule remains in force. | `styles.css:774-782,828-834` |
| B1-3 (minor) | Document the current route-shape assumption alongside surface classification. | `surface-view-transitions.ts:11-13` |

The Electron template already has one `.ptah-vt-surface` in each mutually exclusive state (`electron-shell.component.ts:271,273,308`). Its existing spec still verifies all three states (`electron-shell.view-transition.spec.ts:67-72,117-131`), so the component and spec required no edit. B1-4's suggested `webview-routing.spec.ts` improvement is outside this batch's permitted files; the rapid-navigation stub remains a tracker bookkeeping test rather than a browser supersession test.

## Verification

- `surface-view-transitions.spec.ts`: 16/16 passed, one permitted Jest run.
- `electron-shell.view-transition.spec.ts`: 3/3 passed, one permitted Jest run.
- Scoped `ptah_get_diagnostics`: no errors in the changed TypeScript files. It reported 100 errors in sibling files and did not recognize CSS; those files are outside this batch.
- No browser visual measurement was run; the permitted checks do not establish fixed-descendant geometry or frame timing in Electron.

## Decisions

1. **Avoid `skipTransition()` for visually instant navigations.** Options considered: catch its rejected promises, skip creating a transition, or use zero-duration CSS. Installed Angular Router 22.1.7 attaches `transition.ready.catch(console.error)` before calling `onViewTransitionCreated` (`node_modules/@angular/router/fesm2022/_router-chunk.mjs:3694-3712`), so another catch cannot silence it. The installed `withViewTransitions` hook has no per-navigation creation veto. Zero-duration CSS gives same-surface and reduced-motion navigations no visible motion without an AbortError. This is reversible if Angular adds a per-navigation veto. A transient view-transition overlay can still exist for the update frame, so future E2E probes should measure animation rather than the mere presence of `:active-view-transition`.
2. **Use the existing `LoggingService` for callback failures.** It is the injectable logger in frontend core (`libs/frontend/core/src/lib/services/logging.service.ts:74,180`). The error is sent to `error(context, message, data)` after the callback throws. Reversible.
3. **Keep the Electron markup as is.** The existing mutually exclusive branches already guarantee one class-bearing surface per shell state; the CSS gate prevents a permanent containing block. Reversible.

## Clarifications Needed

None.
