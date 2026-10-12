# Batch 4d review (round 1)

Verdict: REVISE

## Defects

1. **Major** — `apps/ptah-extension-webview/src/app/initial-navigation.ts:51-62,78-87`: A failed or cancelled host-surface navigation is warned and returned without landing anywhere. For example, booting a `thoth` deep link when its lazy chunk fails returns `failed`; `App.ngOnInit` then marks the app ready with the Router still at `/`. A restored `/thoth/skills` with the same host seed retries the same failing chunk and has the same outcome. Route a failed first choice to `chat`, and handle a failed chat attempt so boot does not report success without a landed surface. Replace `app.spec.ts:157-165`, which currently asserts the broken return behavior, with a landing assertion.
2. **Major** — `apps/ptah-extension-webview/src/app/initial-navigation.ts:82-83`: `surfaceNavigationLanded('navigated')` says only that some route settled. A contract-valid saved `/settings/obsolete` passes `navigateToUrl`'s first-segment check, then the app route wildcard redirects it to `/chat`; `navigateToUrl` reports `navigated`, so an unchanged host `initialView: 'analytics'` never gets its required fallback. Check the settled surface/URL after saved-route navigation, allowing redirects within the requested surface (such as `/thoth` to `/thoth/memory`), and fall back to the host when it settled on another surface. Add a real-Router spec for this case.

## Verified OK

- D5 precedence and seed selection flow through `resolveBootNavigation` (`initial-navigation.ts:66-76`; `libs/frontend/core/src/lib/routing/boot-navigation.ts:51-67`). The real-Router specs cover override, new host link, matching seed, and null host (`webview-routing.spec.ts:471-527`).
- Persistence starts before navigation (`initial-navigation.ts:74-82`); a spec checks call order (`app.spec.ts:103-115`) and another checks the first persisted record (`webview-routing.spec.ts:471-484`).
- `getState<unknown>('ptahRoute')` rewrapping matches the parser's whole-record input and the persistence write shape (`initial-navigation.ts:96-105`; `libs/shared/src/lib/types/webview-route-state.ts:94-119`; `libs/frontend/core/src/lib/routing/surface-route-persistence.ts:69-89`; `libs/frontend/core/src/lib/services/vscode.service.ts:215-225,238-248`). The read exception is caught (`initial-navigation.ts:99-112`).
- `injectInitialNavigation()` is captured in App's field initializer, an Angular injection context (`app.ts:56`), and invoked in `ngOnInit` (`app.ts:86-115`). The routing specs call that production function with real `appRoutes`, Router, and `VSCodeService` (`webview-routing.spec.ts:143-172,191-218`). `window.vscode` is deleted after each spec (`webview-routing.spec.ts:229-237`).
- The extracted file is justified because both spec layers exercise production boot logic (`app.spec.ts:50-52`; `webview-routing.spec.ts:168-172`). It has explicit public return typing, no `any`, and barrel imports (`initial-navigation.ts:1-15,45`).

## Notes

- The routing specs do not instantiate `App` (`webview-routing.spec.ts:160-169`), so the App-to-helper delegation is checked by source inspection. No tests, builds, lint, or typecheck were run for this read-only review.
