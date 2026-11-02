# B1 review fixes — replay runtime

## Findings, changes, and tests

| Finding | Change | Test evidence |
| --- | --- | --- |
| M1: parent controls race boot | `PlaybackEngine` now has a `booted` gate. Pre-boot play is deferred; pre-boot pause clears play intent, sets published `paused`, and suppresses autoplay. `ready` is published only after the second quiet wait. | `replay-runtime.spec.ts` checks deferred play, pause, autoplay suppression, and exact once delivery after resume and speed changes. `replay-bridge.entry.spec.ts` checks the boot sequence. |
| M2: empty root or failed scenario loads were silent | The 8 s cap reports `ready-timeout` and sets `READY_TIMEOUT` in `state.error` without autoplay. Query, fetch, HTTP, JSON, and scenario shape failures set short error codes and messages; the control channel posts the changed state to the parent. | Ready detector cap, loader rejection, and parent error post specs. |
| M3: second quiet wait could hang | The post-boot-message wait has a 5 s cap. It reports `boot-quiet-timeout` and starts playback when the cap fires. | Quiet-period cap spec. |
| RPC case arrays and readiness activity | RPC subset matching compares arrays element by element and recurses through nested objects. Both RPC calls and injected responses reset the readiness quiet timer. | Nested array/object RPC case spec; entry wiring and ready detector specs. |
| Unbounded buffers and speed | `outbound` and `rpcCalls` retain the latest 500 entries. Query and control speed are clamped to 0.25–8. | Entry buffer cap, query clamp, and playback speed specs. |
| Scenario validation and timestamp policy | Loader validates timeline messages, finite nondecreasing `at`, and object RPC maps with specific error codes. Recorded timestamps remain shifted once at load; the B1 notes document this and the session-ID-only timeline. | Loader invalid ID, HTTP, JSON, shape and timeline specs. |
| Entry and host test gaps | The bridge now installs storage isolation, the Function guard, and host globals before query loading. Specs cover that install order, Electron-shaped host globals, one-use `acquireVsCodeApi`, real jsdom network patches, and exact once playback. | `replay-bridge.entry.spec.ts` and `replay-runtime.spec.ts`. |
| App-state spec gaps | Asserted `handleViewSwitch('chat')` still runs with a session ID and a non-string `sessionName` is discarded. | `app-state.service.spec.ts`. |
| Stale B1 notes | Removed the nonexistent session bootstrap module and tab placeholder text; documented the `switchView` boot message and session-ID-only timeline. | Text search found no stale references. |

## Verification

Ran `npm run verify -- -p web-landing,@ptah-extension/core` twice and waited for the queued runs. After fixing two runtime lint errors from the first run, the second run had 4 successful tasks (3 cached), including `web-landing:lint` and all core checks. `web-landing:test` had 132 passing tests and one failure in `scenario/scenario-contract.spec.ts`: the concurrently edited `command-center` scenario sends `view: 'command-center'` where the spec expects `chat`. All runtime and entry suites passed. `web-landing:typecheck` failed only in concurrently edited generated scenario files (`command-center`, `multi-agent`, `tribunal-council`): RPC result shapes and branded agent IDs do not match their declared types. There were no TypeScript errors reported in the runtime files. These scenario files and specs are owned by another lane and were not edited here.
