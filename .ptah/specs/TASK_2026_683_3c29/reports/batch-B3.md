# Batch B3 — chat URL reconciliation during page transitions

## Changes

- `libs/frontend/chat/src/lib/services/chat-tab-route-sync.service.ts:98,118-128`: added a route generation that advances on every `NavigationStart` and correction request.
- `libs/frontend/chat/src/lib/services/chat-tab-route-sync.service.ts:279-316`: route corrections through `SurfaceTransitionTracker.afterTransition`. A deferred callback runs only if its generation is current, the Router has no pending surface, the URL still addresses chat, and the URL still differs from the active tab. It replaces toward the then-active tab. Idle corrections retain their synchronous timing and existing correction bookkeeping.
- `libs/frontend/chat/src/lib/services/chat-tab-route-sync.service.spec.ts:90-119,347-460`: added a controlled transition backed by the real tracker and seven Router cases: synchronous idle replace; latest tab after multiple queued corrections; rapid chat-to-settings; rapid chat-to-tasks with a superseding transition; newer chat deep link; pending surface; and rejected transition flush.

## Verification

- `ptah_get_diagnostics` scoped to the two edited files: **no diagnostics in either requested file**. It reported 266 errors in sibling chat files; those are outside B3 ownership.
- Jest, Nx typecheck, and lint were not run because the B3 assignment prohibits heavy checks while another check runs on this machine.
- Exact commands for the orchestrator (run one at a time):
  - `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/chat-tab-route-sync.service.spec.ts --coverage=false --maxWorkers=2`
  - `npx nx typecheck @ptah-extension/chat --parallel=1`
  - `npx nx lint @ptah-extension/chat --parallel=1`

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Apply the four discard guards only to deferred callbacks | Guard all callbacks; guard deferred callbacks | The approved plan requires idle corrections in the same call. Angular Router emits `NavigationEnd` before clearing `currentNavigation()` in `node_modules/@angular/router/fesm2022/_router-chunk.mjs:3996-4014`; guarding an idle callback with `pendingSurface() === null` would discard the existing correction. | Yes |
| Use the real tracker with controlled `ViewTransition.finished` promises in specs | Fake tracker; real tracker with fake transition | The tracker can be controlled without a browser transition and exercises its supersession and rejection flush behavior with the existing Router harness. | Yes |

## Clarifications Needed

None.
