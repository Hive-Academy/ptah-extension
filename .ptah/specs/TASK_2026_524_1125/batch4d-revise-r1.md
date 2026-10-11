# Batch 4d revise, round 1

All paths are under `apps/ptah-extension-webview/src/app/`. No `libs/frontend/core` file was touched. Only existing public APIs are used: `SurfaceRouterService.navigateToSurface`, `navigateToUrl`, `pendingSurface` and `surfaceNavigationLanded`, plus `Router.url` and `Router.parseUrl`, `DEFAULT_SURFACE_ID` and `ViewType` from `@ptah-extension/shared`.

## Defect 1: a failed host-surface navigation landed nowhere

- `initial-navigation.ts:56-65`: the new `navigateToBootSurface(view)` runs one `navigateToSurface` and warns `Initial navigation to <view> did not land: <result>` when it does not land.
- `initial-navigation.ts:67-84`: `navigateToHostSurface` returns early in three cases:
  - the first navigation landed;
  - the target was already `chat` (`DEFAULT_SURFACE_ID`);
  - a newer navigation is in flight (`pendingSurface() !== null`).

  Otherwise it calls `navigateToBootSurface('chat')` once and returns that result. If chat fails too, the boot warns and returns the failure. It does not throw and does not retry.

- Both callers go through this fallback: the `surface` plan and the restored-route fallback.

## Defect 2: a restore that settles on another surface was accepted

- `initial-navigation.ts:104-118`: when `navigateToUrl` reports a landed result, the boot compares two values:
  - the first primary segment of `router.url`;
  - the first primary segment of `plan.route`.

  If they differ, it warns `[App] Restored route <route> settled on <url>; falling back to the host view.` It then calls `navigateToHostSurface(hostInitialView ?? undefined)`, the same path the not-landed case uses.

- `initial-navigation.ts:121-131`: `firstSegmentPath(router, url)` parses with `Router.parseUrl` and reads `UrlSegment.path`, so matrix parameters, query and fragment are ignored. A redirect inside the same surface still passes, for example `/thoth` to `/thoth/memory`.
- `initial-navigation.ts:2`: imports `PRIMARY_OUTLET` and `Router`.

## Tests

### `app.spec.ts` (unit, all collaborators stubbed)

- Harness changes:
  - a `Router` stub (`url` getter plus a `parseUrl` backed by `DefaultUrlSerializer`);
  - a `pendingSurface` mock that returns `null` by default;
  - the default `navigateToUrl` and `navigateToSurface` mocks now move the stub's `routerUrl` to their target, so existing tests are unaffected by the new check.
- REPLACED the old `never rejects: a navigation that does not land is warned and returned` test (formerly at about line 157) with:
  - `:179`: falls back to chat when the host surface does not land. A `settings` boot fails, the result is `navigated`, and the calls are `[['settings'], ['chat']]`.
  - `:193`: never rejects or retries when chat does not land either. The result is `failed`, there are exactly two calls, and the chat warning is logged.
- ADDED:
  - `:207`: no chat fallback when a cancelled boot was superseded (`pendingSurface` returns `'analytics'`).
  - `:219`: a restored `/settings/obsolete` that settles on `/chat`, with host `analytics`, warns and navigates to `analytics`.
  - `:237`: a restored `/thoth` that settles on `/thoth/memory?x=1#top` is kept, and no host navigation happens.

### `webview-routing.spec.ts` "boot restore precedence (D5)" (real Router and `appRoutes`)

- ADDED `:558`: a saved `/settings/obsolete` with seed `analytics` and host `analytics`. The app wildcard redirects it to `/chat`. The boot ends on `/analytics` with `currentView` `analytics`, the persisted record is `/analytics`, and the exact warning is logged.
- ADDED `:576`: a saved `/thoth/bogus` with a null host. `THOTH_ROUTES` redirects it to `/thoth/memory`, and that result is kept with no `[App] Restored route` warning (30 s timeout, like the other thoth specs). This covers "host null, legitimate redirect inside its surface".
- Unchanged: the `/command-builder` not-landed spec still ends on `/chat`. The null host normalises to `chat`, and the first attempt does not fail, so no chat fallback runs.

## Assumptions

1. **Cancelled navigations.** A `cancelled` result while `pendingSurface()` is non-null means a newer navigation superseded the boot, for example a host `SWITCH_VIEW`. The boot does not fall back to chat in that case, because chat would cancel the newer navigation. A `cancelled` result with nothing in flight, such as a guard rejection, does fall back to chat.
2. **Settled URL.** `router.url` is the post-redirect settled URL once `navigateByUrl` has resolved. `navigateToUrl` awaits that call, so the read is current.
3. **Segment comparison.** The check compares raw first-segment paths and does not use `surfaceIdFromSegment`. An unknown segment therefore cannot collapse to `chat` and match by accident. `navigateToUrl` already rejects a route whose first segment is not a surface id.
4. **Verification.** No tests, typecheck or lint were run, as instructed. `ptah_get_diagnostics` scoped to the 3 files reports 0 diagnostics in them. The 12 errors it lists in sibling files were there before this change and are in files I did not touch: `base-content-muted.spec.ts`, `zone-change-detection.spec.ts`, core `mock-rpc-service.ts` and shared `capability-id-codec.ts`.

## Revision r2

This revision addresses defect 2 of `batch4d-review-r2.md`. Defect 1 is accepted as a documented follow-up, so its only change is a comment.

- `initial-navigation.ts:56-59`: a new shared condition, `supersededByNewerNavigation(): boolean`, returns `surfaceRouter.pendingSurface() !== null`. It carries the comment explaining why the boot skips a fallback in that case.
- `initial-navigation.ts:83`: `navigateToHostSurface` now uses the helper instead of the inline expression. Its behaviour is unchanged.
- `initial-navigation.ts:76-78`: the existing comment now also says that the boot does not wait for the superseding navigation, so that navigation's outcome belongs to its own caller. This is the requested defect 1 note.
- `initial-navigation.ts:111` (defect 2): in the restored-route not-landed branch, if a newer navigation is in flight, the boot returns the result immediately. It logs no warning and does not fall back to the host view, the same rule `navigateToHostSurface` applies.
- `app.spec.ts:219`, ADDED test "does not fall back to the host view when a newer navigation superseded the restore":
  - setup: `navigateToUrl` returns `cancelled` and `pendingSurface` returns `'chat'`;
  - expected: the boot returns `cancelled`, `navigateToSurface` is never called, and no warning is logged.
- Verification: no tests, typecheck or lint were run, as instructed. `ptah_get_diagnostics` scoped to both edited files reports 0 errors in them. The 12 errors it lists in sibling files are the same ones as round 1, in files this change did not touch.
