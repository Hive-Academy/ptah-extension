# Phase 1 B1 review: replay runtime and session-open app change

Reviewer: code-logic-reviewer (read-only; no checks run, no files edited except this one).
Scope: `libs/web/landing/src/lib/live-demo/runtime/**` (all 14 files read in full), the `app-state.service.ts`/spec diff, and the `payload-map.ts` diff.
Evidence: the contract in `implementation-plan.md` (lines 49-70), `batch-b1-notes.md`, `preload.ts:35-51`, `claude-rpc.service.ts`, `rpc-call.util.ts`, `message-router.service.ts`, `session-open-bridge.service.ts`.

## Verdict: APPROVE WITH CHANGES

The runtime matches the contract on the points that matter: storage, network guard, ptahConfig, ready detector, control channel origin and source checks, and the RPC envelope. There is no blocker. Three majors (M1-M3) are real races or silent-failure paths that a slow or hostile page would hit. They are cheap to fix.

## Major

**M1. Pause or `play` commands race the boot sequence (`replay-bridge.entry.ts:64-73`, `playback-engine.ts:51-52`).**
`engine.ready()` sets `ready=true` at once, then the entry waits for the boot messages and the second quiet period before `engine.play()`. Two consequences:
- A parent `play` command arriving in that window (control-channel.ts:10) passes the `state.ready` guard and starts the timeline before the session tab exists. The scenario's chunks are then dropped silently, because there is no tab for the `sessionId`.
- The parent pauses when the iframe is out of view or the document is hidden (B7 contract). A `pause` sent before boot ends is a no-op (`pause()` returns when not playing). Line 71 then autoplays anyway, so the demo plays while hidden or paused by the user.

Fix:
- Add an `engine.booted` flag, set after the boot-quiet wait. `play()` returns when `!booted`.
- Record a `playRequested` flag on a `play` command received before boot.
- Honor a pre-boot `pause` by clearing the autoplay intent: `if (query.autoplay && !userPaused) engine.play()`.
- Better still, keep `ready` false in the published state until boot finishes, so the parent cannot enable play early.

**M2. Ready timeout and failure paths succeed silently (`ready-detector.ts:25`, `replay-bridge.entry.ts:46-47,64-72`).**
- At the 8 s cap, `complete()` fires even when `ptah-root` has no children (Angular crashed or never booted). The runtime reports ready, injects the boot messages into nothing, and plays to completion with `state.complete=true` and zero misses.
- If the scenario load or query validation fails, the miss list gets an entry. But `state` has no error field, `ready` and `complete` stay false, and the parent only sees a frozen progress bar.

Fix:
- `report('ready-timeout', ...)` when the cap fires without a rendered root. Add that kind to `ReplayMiss`, and do not autoplay.
- Add `error?: string` to `ReplayState`, so the parent can show a fallback to the poster image.

**M3. `bootQuiet` has no cap (`boot-quiet.ts:6-10`, entry line 69).**
Every RPC call or response restarts the 300 ms timer. A poll or cascade that never goes quiet for 300 ms means autoplay never starts and nothing is reported. The ready detector has an 8 s cap; this second wait must have one too (suggest 5 s, then report a miss and play anyway or fail loudly).

## Minor

**m1. Ready quiet window counts RPC calls, not responses (`ready-detector.ts:33`).**
It measures 300 ms since the last `rpc:call`. Responses are held until `scenarioPromise` resolves (`rpc-responder.ts:26`). On a slow scenario fetch (over 300 ms), "ready" fires while the first answers are still pending. The boot messages are then injected right after the scenario loads, before the first-wave answers have cascaded. `bootQuiet` recovers some of this, but also call `readyDetector.rpcCall()` from `inject` when `message.type==='rpc:response'`, and defer `detectReady`'s completion until the scenario has loaded.

**m2. `subset` cannot match arrays (`rpc-responder.ts:3-9`).**
A `match` containing an array falls to `Object.is(expected, actual)`, which is always false for distinct arrays. A nested-array rpcCase therefore silently never matches and falls through to the default answer. Either implement element-wise equality (same length, each element recursively) or reject array `match` values at scenario load. Also note that `match: {}` matches anything, which is fine, but document it. Add a spec for both.

**m3. Throttle drops pulse updates on timer jitter (`control-channel.ts:23`).**
The pulse fires every 250 ms. A pulse that arrives at 249.x ms after the last post is dropped (`< 250`), so the progress bar sometimes updates every 500 ms. Use `< 200`, or throttle against the pulse itself. Final delivery is correct: `complete`, `playing`, and `ready` all change the signature, so those posts are never throttled. The final state is delivered.

**m4. Time shift boundaries (`time-shift.ts:4`).**
- The window is `[timeBase, timeBase+1 day]`. A false positive needs a non-time number in about 1.7e12..1.7e12+8.6e7. Byte counts, token counts, durations and costs will not reach that range, so it is realistic and safe. A numeric id or hash in the range would shift. Document that scenario authors must keep such values as strings.
- Values before `timeBase` are not shifted, so "last active" times for older recorded sessions stay at the recording date. This is correct if B2 sets `timeBase` to the earliest recorded time. State it in the scenario spec.
- The shift is computed once at load. A timeline message stamped `timeBase+30s` becomes `now+30s` at load, so it is in the future for the first 30 s of playback and may render as "in 30s" or "just now". Prefer shifting at injection time using `Date.now() - (playbackStart) ...`, or shift timeline messages relative to their `at`.
- No mutation: confirmed (`map` and `Object.fromEntries`). `__proto__` keys from JSON are safe (`fromEntries` defines own properties).

**m5. Scenario validation is shallow (`scenario-loader.ts:19`).**
Only `id`, `Array.isArray(timeline)` and `timeBase` are checked. An unsorted timeline or a non-finite `at` gives negative or NaN delays (`playback-engine.ts:41`, `Math.max(0, NaN)` is NaN, so the timer fires at about 0 ms). Messages then fire out of order or all at once. Validate that `at` is finite and non-decreasing and that `message.type` is a string, and fail with a `scenario-load` miss. Also, `outbound` and `rpcCalls` (entry lines 51-52) grow without bound for the page lifetime. Cap them (for example 500 entries).

**m6. Speed values are unbounded (`control-channel.ts:12`, `scenario-loader.ts:10`).**
`Number(true)` is 1 and `Number('0x10')` is 16. Clamp to a documented range (for example 0.25-8) in both places.

**m7. `window.parent`/other same-origin reachability.**
`MemoryStorage` replaces `window.localStorage` and `sessionStorage` (`memory-storage.ts:23-25`). Angular and the inline theme script (`apps/ptah-extension-webview/src/index.html:104,131,139`) read only these properties, so they never reach real storage if the bridge is the first script (B3 must keep it first). Remaining reachability, none used by the app:
- `window.parent.localStorage` and `window.top.localStorage` (same origin as the landing page);
- `Storage.prototype` methods applied to a fresh same-origin iframe's storage;
- `document.cookie`, `indexedDB`, `BroadcastChannel`. A grep found no use in the app bundle sources (only a blob `Worker` in `pierre-worker-pool.ts:86`).

Fidelity gaps: `MemoryStorage` is not `instanceof Storage`, and property-style access (`localStorage.foo`, `Object.keys`) does not work. Neither is used by the app today. Extend `Storage.prototype` or use a Proxy if that changes.

**m8. Network guard gaps (`network-guard.ts`).**
Coverage is correct for fetch (string, URL, Request), XHR `open`, WebSocket (ws/wss mapped to http origin), EventSource, and `sendBeacon`. `/demo/../x` normalizes through `URL`. Gaps:
- `blob:` and `data:` fetches are blocked, because their pathname does not start with `/demo/`. This is safe but may break a legitimate `fetch(blobUrl)`. The browser check showed 0 misses, so it is not hit today. Allow `blob:` with same origin explicitly if it appears.
- Redirects from an allowed URL to another origin are not checked (CSP `connect-src 'self'` covers the same-origin case only).
- Guard installation is correct in that `loadScenario` runs after it and uses the patched fetch.
- The `Worker` constructor and `importScripts` are not guarded (CSP `worker-src` covers them).
- `fetch` is assigned, not frozen, so later code can restore it. That is acceptable as defence in depth, since the CSP is the real wall.

**m9. Function Proxy (`disable-dynamic-function.ts`).**
- Behaviour is sound for the common cases: `instanceof Function` works because `Function.prototype` is passed through and there is no `get` trap; `Function.call`/`apply`/`bind` go through the same traps; `Function.prototype.toString.call(Function)` still works for a callable proxy.
- It does change identity: `fn.constructor === Function` is now false, because `Function.prototype.constructor` still points at the original. Libraries that compare constructors would misdetect (rare). Fix: also set `original.prototype.constructor = proxy`, or accept and document.
- It does not stop `(async () => {}).constructor('...')` or `Object.getPrototypeOf(function*(){}).constructor`. This is only a hardening gap, because the CSP still blocks it.
- The cost is that a library that feature-detects with `new Function` now gets `EvalError`. That is exactly the intended CSP behaviour, and the browser check shows 0 errors.

**m10. No frame-ancestors protection (B3, not B1).**
`window.addEventListener('message')` in `message-router.service.ts:153` and `rpc-call.util.ts:69` ignores `origin` and `source`, so any window holding a reference to the iframe can inject host messages (`switchView`, `rpc:response`, `chat:chunk`). The runtime cannot fix this on the page side, but a third-party site that frames `/demo/` only affects its own copy. Recommend a response header `Content-Security-Policy: frame-ancestors 'self'` for `/demo/*` (a meta CSP cannot set it). Optionally, add a first capturing `message` listener in the bridge that calls `stopImmediatePropagation()` on `event.isTrusted` events whose `source !== window`, since all internal injections are untrusted synthetic events (origin `''`).

## Contract conformance checklist

| Item | Result |
| --- | --- |
| Storage replaced before Angular | OK (entry line 13, before everything). See m7. |
| Network guard fetch/XHR/WS/ES/beacon, same-origin under base | OK. See m8. |
| ptahConfig vs `preload.ts:35-51` | OK. All 13 keys match; `platform:'linux'` fixed; no `initialSessionId` (stripped twice: `install-host-globals.ts:25`, entry line 42). `ptahClipboard` has extra no-op `hasImage`/`readImageBase64`; harmless. Scenario `config` is merged after the async fetch (entry line 43), so a value read by Angular before the fetch resolves would be the default (minor race; keep scenario `config` equal to the defaults). |
| `acquireVsCodeApi` once | OK. |
| Ready: `ptah-root` children, 300 ms, 8 s cap, `readyAt` | OK, with M2 and m1. |
| bootMessages then second quiet wait | OK, with M1 and M3. |
| Query validation / `baseURI` fetch | OK (`/^[a-z0-9-]+$/`, `new URL(..., baseURI)`). |
| RPC precedence case, error, map, miss | OK. m2 for arrays. |
| Error envelope vs `claude-rpc.service.ts:116-200` | OK. `success`, `data`, `error` (string), `errorCode`, `correlationId` are top-level and read by `handleResponse`. `REPLAY_MISS` is not in the `RpcUserErrorCode` union; harmless at runtime. |
| Control channel origin AND source AND embedded | OK (`control-channel.ts:6`). State posts use `location.origin` (line 24). |
| Tab-id handling | Deviation from the plan (`$activeTabId`), documented in the notes (omit `tabId`, resolve by `sessionId`). No `$activeTabId` code exists. Fine if B2 scenarios omit `tabId`; the browser check passed. The plan text should be updated. |
| `batch-b1-notes.md` file list | Stale: it lists `session-bootstrap.ts`, which does not exist. Update the notes. |

## Playback correctness (traced)

- `elapsed` accounting: `currentElapsed()` derives from `startElapsed + (now - started) * speed`, clamped to `duration`. Pause stores it, `setSpeed` is pause + set + play, and the timer delay is `(at - elapsed) / speed`. Correct: no lost or duplicated message (the index only advances inside the timer callback, and `pause` clears the timer before it can fire).
- Two timeline entries with the same `at`: delivered in separate timers, order preserved.
- `play()` after `complete` is ignored; restart is `location.reload()`, which loses all state and re-runs boot. OK.
- The timer callback sets `elapsed = item.at` while the pulse sets `currentElapsed()`; a late timer can make `elapsed` jump back by a few ms. Cosmetic.
- Pulse interval is cleared on finish, pause and speed change. No leak seen.
- Final state: `finish()` posts `complete=true`; not throttled. OK.

## App change (`app-state.service.ts:361-369`, spec)

- Behaviour without `sessionId`, or on another view, is unchanged (`handleViewSwitch` is called exactly as before; the new branch is gated on `view==='chat'` and a non-empty string).
- Ordering: `handleViewSwitch('chat')` first, then `requestOpenSession`. `SessionOpenBridgeService.consume` also calls `setCurrentView('chat')` (`session-open-bridge.service.ts:29-30`), so the order is harmless.
- Unknown or malformed id: `requestOpenSession` calls `SessionId.safeParse` and drops an invalid UUID (`app-state.service.ts:1393-1394`), so a bad id is silent. A valid but unknown UUID reaches `requestCanvasSession`, which issues `session:load`; the failure path is the existing one. In the replay, a failed open shows nothing to the parent. Related to M2: report a miss if no `session:load` RPC follows the boot message.
- Because the router has no origin check (m10), any window can now open any session id the host knows via `switchView`. This is the same trust as the existing `switchView`.
- Spec gaps: no test that `handleViewSwitch` is called when a `sessionId` is present; no test for a non-UUID string being dropped; no test that a non-string `sessionName` becomes `undefined`; no test that a repeated request publishes a new request object. The existing spec covers the case with no `sessionId`.
- `payload-map.ts` intersection type is being moved to `system.ts` (a diff of `system.ts` shows the field added there); the behaviour is the same. Make sure there is exactly one definition.

## Test quality (`replay-runtime.spec.ts`)

Good: fake timers drive the engine and detector; the RPC envelope, control origin/source and Function proxy are tested; `afterEach` restores real timers.

Missing or weak:
- The network-guard test uses a hand-made fake window, so it never proves the patch works on the real jsdom `XMLHttpRequest`, `fetch` or `navigator`. It has no allowed-XHR or allowed-beacon case, no `ws:` mapping case, and no `Request` input case.
- The playback test asserts `toBeGreaterThanOrEqual(500)` but not exact elapsed or that exactly one `first` message was injected (`injected` length is not checked after resume). It has no test for a pause exactly at a message boundary, a speed change while a timer is pending, or an unsorted timeline.
- The control-channel test never covers `embedded=false`, `speed` with a bad value, `restart`, or final-state delivery after `complete`.
- There is no test for `loadScenario` (relative `baseURI`, id mismatch, HTTP error), `installHostGlobals` (shape, `acquireVsCodeApi` twice, `initialSessionId` stripping), array matches in `subset`, or `rpcCases` and `bootMessages` time shift.
- No test of the entry wiring (boot order, M1 race). A small test of the boot sequence with an injected `engine` would catch M1 and M3.
- `disableDynamicFunction` replaces `globalThis.Function` and restores it in `finally`; fine, but a failing assertion before the restore could still leak into other test files only if `finally` is skipped, which it is not.

## Five logic questions (short)

1. Silent failure: M2 (ready at cap with no UI; scenario load failure invisible to the parent), M3, array `match` fall-through (m2), failed session open (no miss).
2. User action: pause or play during boot (M1); speed from the parent unbounded (m6).
3. Wrong answer from input: an unsorted timeline (m5), a numeric id in the shift window (m4).
4. Dependency failure: the scenario fetch is slow (m1) or 404 (reported as a miss, parent not told); the app never renders (M2).
5. Missing: a `state.error` field, frame-ancestors header (m10), bounds on `outbound`/`rpcCalls`, and a timeline validation step.
