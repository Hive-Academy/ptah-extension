# Code Logic Review — `TASK_2026_494` (Batch 1 / Task 1.1)

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score        | 8/10                                  |
| Assessment           | APPROVED                              |
| Blocking issues      | 0                                     |
| Serious issues       | 0                                     |
| Moderate issues      | 3                                     |
| Failure modes found  | 2 (both correctly handled by design)  |

Scope examined: `libs/frontend/chat-routing/src/lib/surface-update-inbox.service.ts`,
`surface-update-inbox.service.spec.ts`, `libs/frontend/chat-routing/src/index.ts`,
`apps/ptah-extension-webview/src/app/app.config.ts`,
`apps/ptah-extension-webview/src/app/surface-message-routing.spec.ts`, plus the consumer
contract in `libs/frontend/core/src/lib/services/message-router.service.ts` and
`message-router.types.ts`, and a workspace-wide grep for every `handledMessageTypes`
declaration and every `SURFACE_UPDATED`/`DASHBOARD_SPEC_PROPOSED` reference. Verification
command `npx nx run-many -t lint,typecheck,test -p @ptah-extension/chat-routing
ptah-extension-webview --skip-nx-cache` was re-run fresh (cache bypassed) and passed 6/6.

## Five logic questions

### 1. How does this fail silently?

No unreported silent failure was found. Two paths look silent but are the documented,
tested design, not defects:

- A push for an id nobody claimed is dropped with no log
  (`surface-update-inbox.service.ts:85`, `this.claims.get(routingId)?.(payload)` — a `Map`
  miss on `?.()` is simply a no-op). This is D3's stated contract ("the routing id is
  unclaimed: drop") and is correct as long as every consumer claims synchronously before
  the session that produces pushes starts, which is a Batch-4 (not this batch's)
  responsibility. If that invariant is ever violated by a future consumer, pushes vanish
  with zero diagnostic — worth a comment for the next author, not a defect in Batch 1.
- A throwing listener is caught by `MessageRouterService.dispatchGuarded`
  (`message-router.service.ts:230-236`) and reported to `ErrorHandler`, then the drain
  continues. From the affected surface's perspective this can look like "the update never
  arrived" with no visible error in the UI (`ErrorHandler` only, not a user-facing toast).
  This is the same guarantee every other `MESSAGE_HANDLERS` entry gets and matches the
  file header's documented claim (`surface-update-inbox.service.ts:30-33`) — not a defect
  introduced by this batch.

### 2. What user action produces unexpected behaviour?

None found. Batch 1 wires no UI; the inbox is not yet claimed by any consumer
(`AppsSessionService` is Batch 4). There is no user-reachable path through this code yet.

### 3. What input data produces a wrong answer?

None found. Every malformed shape enumerated in D3 (non-object, null, array, missing
`routingId`, non-string `routingId`, empty-string `routingId`, unclaimed id) is dropped
before reaching a listener, and a claimed id receives exactly the same object reference
(`surface-update-inbox.service.ts:79-86`), confirmed by identity (`toBe`) assertions in
both `surface-update-inbox.service.spec.ts:70-83` and
`surface-message-routing.spec.ts:187-199`.

### 4. What happens when a dependency fails?

- `MessageRouterService` is a hard DI dependency of the whole app; its absence is a
  bootstrap failure unrelated to this batch.
- A listener (future consumer) that throws synchronously is isolated by
  `dispatchGuarded` (`message-router.service.ts:230-236`) — verified by reading the guard,
  not by a Batch-1 test (there is no consumer yet to throw). This satisfies D3's claim.
- A duplicate `claim()` on the same routing id throws synchronously with the id in the
  message (`surface-update-inbox.service.ts:61-68`), pinned by
  `surface-update-inbox.service.spec.ts:49-54`. If that throw happens re-entrantly *inside*
  a listener already running under `dispatchGuarded` (e.g. a listener that tries to
  re-claim its own still-held id), it propagates through `handleMessage` → `dispatch` →
  `dispatchGuarded`'s `catch`, which reports it and continues the drain — traced by
  inspection of `message-router.service.ts:230-244`, not separately tested in this batch
  (no consumer exists yet to exercise it). No defect found; this is correct behaviour for
  a "programming error" per the file header.
- A listener that calls `release()` then `claim()` on the same id from inside its own
  callback is safe: `handleMessage` already resolved the specific function reference via
  `this.claims.get(routingId)` (`:85`) before invoking it, so a synchronous map mutation
  during the call cannot corrupt the in-flight dispatch (`Map` iteration is not in play —
  this is a single-key lookup, not an iteration).

### 5. What is missing that the requirements never mentioned?

- `claim()` does not itself validate `routingId` (e.g. it would silently accept an empty
  string), unlike `handleMessage`, which explicitly rejects empty-string routing ids
  (`:84`). D3 only specifies drop rules for the *push* path, not the *claim* path, so this
  is in-contract, but it does mean a future caller that accidentally claims `''` gets no
  error — pushes for `''` are simply unreachable (dropped at `:84` before the map lookup),
  so this is not exploitable, only inconsistent. Not a Batch 1 defect.
- No bound on the `claims` Map's lifetime (a consumer that never calls `release()` leaks
  a Map entry forever). D4 documents this is deliberately deferred to
  `surface:release`/TASK_2026_539 and out of Batch 1's scope — correctly not addressed
  here.

## Failure modes

### Unclaimed-id drop (by design)

- Trigger: a push arrives for a routing id that was never claimed, or was already
  released.
- Symptom: the push is discarded; no consumer is notified.
- Evidence: `surface-update-inbox.service.ts:85`; tested at
  `surface-update-inbox.service.spec.ts:129-152` and
  `surface-message-routing.spec.ts:201-218`.
- Current handling: silent drop, matching D3 exactly.
- Recommendation: none for this batch — this is the specified contract. Flag for whoever
  builds the consumer (Batch 4 / TASK_2026_539) that the claim-before-session-start
  ordering is load-bearing and worth its own invariant check there.

### Throwing listener isolation

- Trigger: a claimed listener throws inside `handleMessage`.
- Symptom: the error reaches `ErrorHandler`; the drain of remaining queued messages
  continues; the throwing listener's surface silently does not update.
- Evidence: `message-router.service.ts:230-236` (guard), `surface-update-inbox.service.ts:85`
  (single unguarded listener invocation inside the inbox itself — the guard lives one
  layer up, in the router, not in the inbox).
- Current handling: correct per D3's documented claim; verified by code reading since no
  consumer exists yet in this batch to write a listener that throws.
- Recommendation: none required for Batch 1. When Batch 4 lands, consider a test that
  drives a throwing `AppsSessionService` listener through the real router to pin this
  contract end-to-end (currently only inferred from `message-router.service.ts`, not
  exercised through `SurfaceUpdateInbox` itself).

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

### M1 — Drop-rule tests for missing/non-string/empty `routingId` cannot detect removal of their own guard (Moderate)

- File: `libs/frontend/chat-routing/src/lib/surface-update-inbox.service.spec.ts:113-127`
  and the app-level equivalent `apps/ptah-extension-webview/src/app/surface-message-routing.spec.ts:220-228`.
- Evidence: the production guard is
  `if (typeof routingId !== 'string' || routingId.length === 0) return;`
  (`surface-update-inbox.service.ts:84`). Each test payload (`{}`, `{ routingId: 42 }`,
  `{ routingId: '' }`) is dispatched while only `'route-1'` is claimed. Even if line 84
  were deleted entirely, `this.claims.get(routingId)` at `:85` would still miss —
  `Map.get(undefined)`, `Map.get(42)` and `Map.get('')` all return `undefined` against a
  map keyed only by the string `'route-1'` — so the listener still would not fire and the
  test would still pass. The test observes "listener not called," which is also the
  outcome of the `Map` miss alone; it does not isolate whether the type/emptiness guard
  actually ran.
- Impact: a future regression that silently drops the `typeof`/`length` guard (e.g. during
  a refactor of the drop-rule ordering) would not be caught by these specific test cases.
  Production behaviour today is correct (verified by direct code reading of
  `surface-update-inbox.service.ts:79-86`); this is a test-strength gap, not a live
  defect.
- Fix (for the next touch of this file, not blocking this batch): add a case that claims
  the *same* malformed key first (e.g. `inbox.claim('', listener)` then push
  `{ routingId: '' }`) so the guard, not the `Map` miss, is what has to fire to keep the
  test green.

### M2 — The uniqueness-sweep "self-test" does not exercise `handlerDeclarationsFor` (Moderate)

- File: `apps/ptah-extension-webview/src/app/surface-message-routing.spec.ts:286-296`.
- Evidence: the test titled "actually detects a handler declaration when one is present"
  calls only `stripComments()` and a plain `.includes()` on two hand-written strings; it
  never calls `handlerDeclarationsFor` (the function that actually combines
  `source.includes('handledMessageTypes') && wireRef.test(source)` at `:138-146`) with
  those fixtures. It proves comments are stripped and that a literal string contains a
  substring — both true by construction — but not that the real detector correctly
  distinguishes a live declaration from a commented one, or that `wireRef`'s regex
  escaping (`:134-136`) is correct.
- Impact: a regression specifically in `wireRef` construction (e.g. broken escaping that
  makes the regex never match, silently turning the uniqueness/absence sweep into a
  vacuous pass) would not be caught by this self-test, even though its name implies it
  guards exactly that. Today the sweep is independently proven correct by the fact that it
  currently finds exactly one file for `SURFACE_UPDATED` and zero for
  `DASHBOARD_SPEC_PROPOSED` (verified by running the suite and by an independent grep,
  see Requirements fulfilment below) — so there is no live defect, only an
  under-strength regression guard.
- Fix (future touch): call `handlerDeclarationsFor([...], ...)` directly against two
  in-memory-equivalent fixture files (or refactor the string-matching predicate out of
  `handlerDeclarationsFor` so it can be unit-tested without file I/O) rather than
  re-implementing a partial check inline.

### M3 — Source sweep's own Nx cache scope is narrower than the tree it walks (Minor/Moderate, largely self-correcting)

- File: `apps/ptah-extension-webview/src/app/surface-message-routing.spec.ts:64-67, 94-115`
  (walks `libs/frontend/**` and `apps/ptah-extension-webview/src/**` at test *runtime* via
  `readdirSync`); `nx.json:41-47` (`@nx/jest:jest` target default:
  `"inputs": ["default", "^production", ...]`, where `^production` is scoped to the
  *project graph's* transitive dependencies of `ptah-extension-webview`, derived from
  actual imports — not a blanket glob over `libs/frontend`).
- Impact: a new file added under `libs/frontend` that declares
  `handledMessageTypes = [MESSAGE_TYPES.SURFACE_UPDATED]` but is **not yet imported**
  (directly or transitively) by `ptah-extension-webview` is invisible to Nx's cache key for
  this test target. A cached (unchanged) run of `ptah-extension-webview:test` would not
  re-execute the sweep and would not catch that new file, even though a fresh run would.
  In practice this window is narrow and self-correcting: a handler only matters once it is
  registered via `{ provide: MESSAGE_HANDLERS, useExisting: ..., multi: true }` in
  `app.config.ts`, and adding that registration necessarily adds an import that *does*
  enter the project graph and bust the cache on the same commit. The risk is real only for
  an in-progress/dead file that declares the type but is not yet wired in — which poses no
  routing risk until it is wired in, at which point the cache does invalidate.
- Recommendation: none required to block this batch. Worth a one-line comment in the spec
  header noting the cache-scope caveat so a future reader does not over-trust a green CI
  cache hit as proof the sweep re-ran.

### Minor — Array drop-rule test is correctly asserted but mislabeled

- File: `libs/frontend/chat-routing/src/lib/surface-update-inbox.service.spec.ts:98-111`.
- The `it.each` table labels `['route-1']` under "drops a non-object payload," but
  `typeof [] === 'object'` and the array is non-null, so it actually passes the first
  guard (`:81`) and is dropped by the second guard (`'routingId' in payload` is `false` for
  an array with no such property, `:82`). The assertion (`listener not called`) is correct;
  only the grouping/label is imprecise. No behavioural impact — this is exactly the
  `typeof [] === 'object'` case the review brief asked to confirm, and it is confirmed
  correct.

## Data flow

1. Backend/extension host broadcasts a `postMessage` with `type: 'surface:updated'` and an
   arbitrary payload — OK, outside this batch's code.
2. `MessageRouterService.onWindowMessage` queues the message and drains it inside
   `dispatchGuarded` (`message-router.service.ts:101-113, 230-244`) — OK, existing,
   unmodified infrastructure; the try/catch isolates handler failures.
3. `dispatch` looks up `SurfaceUpdateInbox` in the handler map built from
   `handledMessageTypes` (`:238-244`, `:127`) — OK, and independently confirmed unique via
   workspace grep (see Requirements fulfilment).
4. `SurfaceUpdateInbox.handleMessage` applies the three D3 drop rules in order
   (`surface-update-inbox.service.ts:79-84`) — OK, each rule independently tested, though
   M1 notes the tests don't isolate the last two rules from the `Map`-miss fallback.
5. On a claimed id, the exact listener is invoked with the exact payload object
   (`:85`) — OK, identity-checked by `toBe` in two independent spec layers.
6. Listener execution (a future consumer, not built in this batch) — out of scope; the
   guarantee that a throw there is isolated is verified by reading the router, not
   exercised end-to-end through a real listener yet (acceptable for a plumbing-only
   batch).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Drop rules exactly per D3 (non-object, missing/non-string/empty `routingId`, unclaimed id) | COMPLETE | None; array case independently re-verified via grep/read, see Minor note on test label only |
| Claimed id calls exactly its listener with the same object | COMPLETE | None; identity-checked twice |
| Zod-free, only `@angular/core` + type-only `MessageHandler` + `MESSAGE_TYPES` | COMPLETE | Confirmed by reading the 3-line import block, `surface-update-inbox.service.ts:36-38` |
| Generic dispatcher, no Apps-specific API, no dependency cycle | COMPLETE | Re-verified independently: `grep chat-routing` under `libs/frontend/core/src` → no matches; `grep mcp-apps` under `libs/frontend/chat-routing/src` → no matches |
| Throwing listener propagates to `dispatchGuarded` | COMPLETE | Confirmed by reading `message-router.service.ts:230-244`; no live consumer in this batch to exercise it end-to-end (acceptable — Batch 1 is plumbing only) |
| Duplicate claim throws | COMPLETE | Pinned by spec |
| `SurfaceUpdateInbox` is the ONLY `surface:updated` handler; no handler for `dashboard:spec-proposed` | COMPLETE | Independently re-verified by grep across `libs/frontend` + `apps/ptah-extension-webview/src` (30 `handledMessageTypes` declarations found; only `surface-update-inbox.service.ts:49` references `SURFACE_UPDATED`; none reference `DASHBOARD_SPEC_PROPOSED`). `apps/ptah-electron` references to `SURFACE_UPDATED` are broadcast-side (IPC senders), not `handledMessageTypes` declarations, so they do not compete for this token |
| `useExisting` resolves the root singleton so claimers and the router share one instance | COMPLETE | `app.config.ts:176-180` uses `useExisting: SurfaceUpdateInbox` against the `providedIn: 'root'` class; same pattern as every neighbouring registration |
| R12: index.ts doc comment corrected | COMPLETE | `index.ts:11-16` now lists `chat-state`, `chat-streaming`, `chat-types`, `core` (type-only), `shared`, matching an independent import audit of every non-spec file in the lib |
| Spec quality: pins every rule, can fail | PARTIAL | M1 (Map-miss masks 2 of 3 rule-specific tests), M2 (self-test doesn't call the function it claims to validate) |

Implicit requirements not addressed: none found beyond what D4 already defers
(`surface:release`, unbounded claim lifetime) — both explicitly out of Batch 1 scope per
the plan.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| `null`/`undefined` payload | YES | First guard, `:81` | None |
| Array payload | YES | Passes first guard (object, non-null), dropped by second (`'routingId' in []` false) | Test label says "non-object" but mechanism is "missing routingId" — cosmetic only |
| `routingId` present but non-string (number) | YES | Third guard, `:84` | M1: test can't distinguish guard from Map-miss |
| `routingId` empty string | YES | Third guard, `:84` | M1: same |
| Unclaimed id | YES | Map miss, `:85` | None |
| Released id | YES | `release()` deletes from map, `:71-73` | None |
| Duplicate claim | YES | Throws, `:61-68` | None |
| Re-claim after release | YES | Spec at `surface-update-inbox.service.spec.ts:56-68` | None |
| Listener throw during dispatch | YES (by router, not inbox) | `message-router.service.ts:230-236` | Not exercised end-to-end in this batch (no consumer yet) — acceptable |
| Re-entrant release/claim inside a listener | YES (by inspection) | Single-key `Map.get` before invocation, `:85`, no iteration to corrupt | Not unit-tested; low risk given the code shape, worth a test once a real consumer exists |
| Payload with extra/unexpected fields | YES | Delivered raw, unmodified — explicit design choice | None; correct per D3 ("typing it would claim a check nobody made") |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking. The most material residual risk is M1 — the drop-rule unit
  tests for two of the three `routingId` sub-conditions would not catch a regression that
  deletes their specific guard, because a `Map` miss produces the same observable outcome.
  Production code today is correct by direct reading; the risk is to *future* regressions
  going undetected, not to this batch's current behaviour.
- What a robust implementation would add: (1) drop-rule tests that claim the exact
  malformed key before asserting it is dropped, closing M1; (2) a self-test that calls
  `handlerDeclarationsFor` directly against fixtures rather than re-implementing part of
  its logic inline, closing M2; (3) a one-line comment on the cache-scope caveat in M3 so a
  future reader does not over-trust a cached green run of the uniqueness sweep; (4) once a
  real consumer exists (Batch 4 / TASK_2026_539), an end-to-end test that drives a
  throwing listener through the real `MessageRouterService` + `SurfaceUpdateInbox` pair to
  turn the currently-by-inspection-only "throwing listener is isolated" claim into a
  pinned test.
