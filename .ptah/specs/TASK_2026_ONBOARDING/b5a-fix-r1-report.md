# B5a fix round 1

| Item                | Fix                                                                                     | File:line                                                                                       | Covering spec                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Failing router test | Warn when a non-route id resolves to the default surface; preserve silent setup aliases | `libs/frontend/core/src/lib/routing/surface-router.service.ts:153`                              | `falls back to the default surface for a non-routable id, with a warning`; `normalises legacy surface %s and drops its old child address` |
| Minor 2             | Open `onboarding` from the skill clones empty state                                     | `libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts:782` | `empty Agents tab: new copy and "Open setup wizard" through setCurrentView (A-nav)`                                                       |
| Minor 4             | Let only the latest resume refresh commit items                                         | `libs/frontend/onboarding/src/lib/home/onboarding-resume.store.ts:31`                           | `keeps the newer workspace result when an older refresh finishes last`                                                                    |
| Minor 6             | Resolve the saved first segment through the shared alias resolver                       | `apps/ptah-extension-webview/src/app/initial-navigation.ts:125`                                 | `restores legacy %s to onboarding Home` in `webview-routing.spec.ts`                                                                      |
| Minor 7             | Treat a pending intent as active only while a harness step is shown                     | `libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.ts:136`        | `replaces a stale pending intent from onboarding Home with a new open-workflow request`                                                   |

## Minor 1 explanation

B1 skipped every settled `/onboarding` URL in `surface-route-persistence.ts`, leaving the previous route as the restore target. B5a removed that early return so it can persist generation and guidance URLs under `/onboarding`, as the B5a plan requires. For those paths when a `tab` query key is present, `onboardingGenerationBinding` validates the identity before persistence (`surface-route-persistence.ts:75-93`). The code also now persists Home and other unbound onboarding pages, including `/onboarding/ready`. The changed spec explicitly asserts that Home replaces the prior `/chat/tab-1` route (`surface-route-persistence.spec.ts:174`). This reverses the B1 rule and means a webview closed on Home or Ready can reopen there. No code change was requested for minor 1; whether those unbound pages should restore remains a product decision.

## Decisions

- The router warning follows fallback to `chat` for the legal non-route `orchestra-canvas` id. The three setup aliases resolve to `onboarding` without a warning.
- The resume store increments a request sequence before its first await, so even a no-workspace refresh invalidates older requests.
- The pending-intent guard checks the settled URL for an onboarding harness step. A new request from Home clears the stale intent and follows the normal navigation path.
- The webview restore comparison narrows the saved segment with `isAcceptedInitialView` before calling `resolveSurfaceAlias`.

## Not fixed

- Minors 3 and 5 were explicitly excluded from code changes in this round.
- Minor 1 received the explanation above and no code change, as requested.
- The existing `ptah-extension-webview:lint` circular dependency was not changed. Its lint log points to `app.routes.ts:232` and the chain through `@ptah-extension/command-center`; the task explicitly accepts this failure.
- Electron visual review was not run because the task forbids launching the app. This round changes no rendered markup or styling.
- A new independent review of these fixes was not possible under the instruction not to spawn other agents. I inspected the scoped diff against the supplied B5a review.

## Verification

1. `npm run verify -- -t test -p @ptah-extension/core,@ptah-extension/onboarding,@ptah-extension/harness-builder,ptah-extension-webview,@ptah-extension/skill-synthesis-ui` — exit 0. Nx summary: `NX   5 tasks: 5 succeeded`. Duration `5m 3s`.
2. `npm run verify -- -t lint,typecheck -p @ptah-extension/core,@ptah-extension/onboarding,@ptah-extension/harness-builder,ptah-extension-webview,@ptah-extension/skill-synthesis-ui` — exit 1. Nx summary: `NX   10 tasks: 9 succeeded, 1 failed`; failed task: `nx run ptah-extension-webview:lint` (the accepted circular dependency above). Duration `4m 0s`.
