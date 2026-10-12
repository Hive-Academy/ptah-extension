# Batch 4d review (round 2)

Verdict: REVISE

## Defects

1. **Major** — `apps/ptah-extension-webview/src/app/initial-navigation.ts:72-79`: A `cancelled` host navigation with `pendingSurface() !== null` returns immediately, before the newer navigation settles. If booting `settings` is superseded by a host request for lazy `thoth` and that chunk fails, neither navigation lands; `App.ngOnInit` still marks boot ready (`app.ts:92-94`). The unit test at `app.spec.ts:207-217` stubs a pending surface but never settles it, so it passes in this failure case. Preserve the newer request, then observe its outcome; fall back to chat once if no surface landed and no navigation remains pending.
2. **Major** — `apps/ptah-extension-webview/src/app/initial-navigation.ts:103-108`: The restored-route failure path bypasses the pending-navigation guard entirely. If a saved lazy route is cancelled by a newer host navigation, boot immediately navigates to the host fallback (chat when host `initialView` is null), potentially cancelling the newer request. Apply the same supersession handling to the route branch, and add a test that starts a newer navigation while restore is in flight and verifies it is allowed to settle.

## Verified OK

- A non-landing host surface now gets one chat attempt; a failed chat attempt is warned and returned without retry or throw (`initial-navigation.ts:56-83`; `app.spec.ts:179-205`).
- A saved route redirected to another surface falls back to the host. The real Router spec covers `/settings/obsolete` redirecting to chat, followed by landing on analytics and persisting analytics (`initial-navigation.ts:110-118`; `webview-routing.spec.ts:558-574`).
- Redirects within a surface are retained. First-segment parsing ignores query and fragment (`initial-navigation.ts:113-130`; `app.spec.ts:237-247`); the real Router spec covers `/thoth/bogus` redirecting to `/thoth/memory` (`webview-routing.spec.ts:576-587`).
- The Router stub in `app.spec.ts:58-101` provides the URL and parser needed by the unit branches. The redirect behavior is also checked against real `appRoutes`, so those assertions do not depend only on the stub.

## Notes

- The cancellation exception is reasonable while another navigation is active; returning from boot before its result is known breaks the landed-surface guarantee. No tests, builds, lint, or typecheck were run for this read-only review.
