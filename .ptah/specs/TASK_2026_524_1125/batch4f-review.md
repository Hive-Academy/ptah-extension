# Batch 4f review (round 1)

Verdict: REVISE

## Defects

1. **Major** — `libs/frontend/core/src/lib/services/app-state.service.ts:1090`: The request is set immediately, but `requestSurface` only drops the _surface write_ when navigation is cancelled or fails (`:630`). If a lazy load fails, or another navigation supersedes `/thoth/skills` before the Skills tab mounts, the request stays pending. A later ordinary visit to Skills in the same workspace consumes it and unexpectedly opens the diverged Library filter. Clear the matching request on a `cancelled`/`failed` result, using a request token so an older navigation cannot clear a newer deep link. Cover cancellation/failure and a subsequent ordinary Skills visit.
2. **Minor** — `libs/frontend/core/src/lib/services/app-state.service.spec.ts:423`: The new already-open test uses the component-less testing route, so it passes while `thothActiveTab()` remains `cron` even though the URL is `/thoth/skills`. It does not establish that the shell actually selects Skills or that the filter is applied after navigation. Add a routed component integration assertion, or state explicitly that this test covers only the service's URL/request contract and rely on linked shell/Skills component tests for rendering.

## Verified OK

- `app-state.service.ts:1088-1091` keeps the guard and performs the exact required calls in order, with no direct tab-memory write or new `any`.
- `app-state.service.ts:593-604,995-1005,663-665` shows `requestSurface` routes to the child URL and updates the Router-backed view; dropping `setCurrentView` loses no extra side effect. Its same-surface early return would have prevented this tab change.
- `thoth-shell.component.ts:301-313,377-378,223-229` updates the active tab at `NavigationEnd` and mounts Skills. `skill-synthesis-tab.component.ts:755-762` consumes the request in an effect. The request is set before asynchronous navigation settles, so both a new Thoth mount and a switch from another tab can consume it.
- `app-state.service.ts:1099-1104` compares the request's workspace with the active workspace and clears it on consumption; `app-state.service.spec.ts:431-459` covers a different workspace and the blocked guard. The specs use the real Router through `surface-router-testing.ts:82-92`.

## Notes

- The component-less service route does not mount the shell or Skills tab. Separate shell and Skills component specs cover tab settlement and filter activation, but not the complete routed deep link.
- Read-only review; no tests, builds, lint, or typecheck were run.
