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

# Batch 2 review

## Summary

| Metric               | Value                                 |
| --------------------- | ------------------------------------- |
| Overall score          | 9/10                                   |
| Assessment             | APPROVED                               |
| Blocking issues        | 0                                      |
| Serious issues         | 0                                      |
| Moderate issues        | 0                                      |
| Minor issues           | 1                                      |
| Failure modes found    | 0 (config-only scaffold; none apply)   |

Scope examined: every file under `libs/frontend/declarative-dashboard/` and
`libs/frontend/mcp-apps-page/` (`project.json`, `tsconfig.json`, `tsconfig.lib.json`,
`tsconfig.spec.json`, `jest.config.ts`, `eslint.config.mjs`, `src/test-setup.ts`,
`src/index.ts`), the two new path entries in `tsconfig.base.json` (`git diff
tsconfig.base.json`), `batch-2-report.md`, `batches.md` Batch 2 (Task 2.1 and its
verification note), `implementation-plan.md:263-276` (D6) and `:872-885` (Component 12),
and a byte-for-byte diff of every new config file against `libs/frontend/harness-builder/`
and, for the templateUrl/typecheck question, `libs/frontend/marketplace/`. Root
`eslint.config.mjs:330-400` (module-boundary `type:*` rules) was read to check the chosen
tags are forward-compatible with D6's planned dependency graph. The verification command
`npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard
@ptah-extension/mcp-apps-page --skip-nx-cache --output-style=static` was re-run fresh
(cache bypassed) and passed 6/6 (2 lint, 2 typecheck, 2 test). This batch adds no
executable logic (both `src/index.ts` are `export {};`), so the five logic questions and
failure-mode hunt below are answered largely in the negative — recorded with evidence
rather than skipped, per the "no finding invented to meet a quota" rule.

## Five logic questions

### 1. How does this fail silently?

None found. There is no runtime code in this batch to fail silently — both libs are empty
barrels (`libs/frontend/declarative-dashboard/src/index.ts:1`,
`libs/frontend/mcp-apps-page/src/index.ts:1`, both `export {};`). The one thing that could
"fail silently" in a scaffold batch — a config that looks correct but silently no-ops a
target — was checked directly: `test` does not silently skip in a way that would hide a
real failure later, because `passWithNoTests: true` is a workspace-wide default
(`nx.json:41-45`) shared by every other lib, not something this batch introduced, and the
run showed the expected `No tests found, exiting with code 0` for both projects.

### 2. What user action produces unexpected behaviour?

None applicable. No UI, no runtime consumer; nothing imports either lib yet
(`batch-2-report.md:91-92`, independently confirmed — no `@ptah-extension/declarative-dashboard`
or `@ptah-extension/mcp-apps-page` specifier appears anywhere outside the two new
`project.json`/`tsconfig.base.json` entries; the only matches are the scaffold files
themselves).

### 3. What input data produces a wrong answer?

None applicable; there is no data-processing logic in this batch.

### 4. What happens when a dependency fails?

- `ngc --noEmit` (the `typecheck` target): verified to actually run and pass for both
  projects (evidence below), not just configured. `tsconfig.lib.json` excludes
  `src/**/*.spec.ts`, `src/test-setup.ts`, `jest.config.ts`, `src/**/*.test.ts` and includes
  only `src/**/*.ts` — identical, byte-for-byte, to
  `libs/frontend/harness-builder/tsconfig.lib.json` and
  `libs/frontend/marketplace/tsconfig.lib.json`. Angular's `ngc` resolves a component's
  `templateUrl` relative to the component file regardless of whether the `.html` path is
  separately listed in `include`; `libs/frontend/marketplace/marketplace-hub.component.ts`
  already uses `templateUrl` under the identical `include: ["src/**/*.ts"]` pattern and its
  `typecheck` target passes today, so a future `.html` template in either new lib will be
  covered by `strictTemplates`/`typeCheckHostBindings` (both `true`,
  `declarative-dashboard/tsconfig.json:15-21`) the same way marketplace's are — confirmed by
  reading the analogous, already-working project rather than assumed.
- `@nx/eslint:lint`: both `eslint.config.mjs` files are byte-identical to
  `harness-builder/eslint.config.mjs`, including the `files: ['**/*.html']` block
  (`declarative-dashboard/eslint.config.mjs:51-81`) with
  `@angular-eslint/template/*` rules — so a `.html` template added in a later batch will be
  linted, not silently skipped.
- `@nx/jest:jest`: `jest.config.ts` and `tsconfig.spec.json` are byte-identical to
  harness-builder; `tsconfig.spec.json:12-17` includes `src/**/*.spec.ts` and
  `src/**/*.test.ts`, so a future `*.spec.ts` under `src/` will be picked up; `test-setup.ts`
  imports `setupZoneTestEnv` (`declarative-dashboard/src/test-setup.ts:1-6`,
  `mcp-apps-page/src/test-setup.ts` identical), matching the pattern every other Angular lib
  in the workspace uses — confirmed by a real (not just configured) test run.
- Known, already-flagged deviation: both `project.json` files still use
  `"commands": [{ "command": "...", "forwardAllArgs": false }]`
  (`declarative-dashboard/project.json:21-29`, `mcp-apps-page/project.json:21-29`) instead of
  harness-builder's plain `"command": "..."` (`harness-builder/project.json:22-24`).
  `batches.md:193-196` documents that this is meant to be reverted, because the flag existed
  only to stop `nx:run-commands` forwarding an unrecognized `--passWithNoTests` CLI arg into
  `ngc` (which doesn't understand it, `TS5023`), and the corrected verification command no
  longer passes that flag. I confirmed the reasoning holds by running
  `npx nx run @ptah-extension/harness-builder:typecheck --skip-nx-cache --output-style=static`
  directly against harness-builder's own plain-`command` target (no `forwardAllArgs`
  override) — it exited 0. Since the corrected verification command passes no extra
  unrecognized args, the plain form will behave identically once applied to the two new
  libs. See Minor issue below — this is not a live defect, only unreverted code.
- Nx Cloud 401 (org disabled) noise, reported by the executor and reproduced in my own run's
  environment: affects remote caching only, does not fail any target.

### 5. What is missing that the requirements never mentioned?

- `batches.md`'s own Batch 2 verification note (`:193-196`) already narrates the
  `typecheck` target as if it "stays identical to harness-builder, without
  `forwardAllArgs: false`" — past tense — but the actual `project.json` files still carry
  the deviated form. The task brief that scoped this review calls this "a known item
  already ruled," so I am not treating it as an undisclosed gap, only recording the
  code/documentation mismatch for whoever applies the revert (see Minor issue).
- Nothing else: R8 (no zod/new-lib in the initial bundle) is satisfied trivially — both
  `src/index.ts` are empty, no `package.json` dependency was added, and the `/services`
  subpath was correctly omitted from `tsconfig.base.json` (only two entries, both pointing
  at `src/index.ts` — `git diff tsconfig.base.json`). The lazy-load gate itself (B19) is
  explicitly out of this batch's scope per both `batches.md` and the task brief.

## Failure modes

None found that apply to this batch. A config-scaffold batch's only realistic failure
modes — a target that is wired but doesn't actually run, or a target that passes only
because there's nothing yet to fail — were checked directly against a fresh, uncached run
(see Evidence) rather than assumed from the files alone.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

### Minor — `typecheck` target's `forwardAllArgs: false` deviation is not yet reverted, despite `batches.md` describing it as already reverted

- File: `libs/frontend/declarative-dashboard/project.json:21-29`,
  `libs/frontend/mcp-apps-page/project.json:21-29`; compare
  `libs/frontend/harness-builder/project.json:20-25` (plain `"command"` form) and
  `batches.md:193-196` (verification note).
- Scenario: none that breaks a green run today — I re-ran the exact verification command
  given in this review's brief and it passed 6/6 with the current (deviated) form, and I
  independently confirmed the plain form also passes the same corrected command when run
  against harness-builder's own target. So this is not a live behavioural defect; it is a
  drift between what `batches.md` says happened and what the two `project.json` files
  actually contain.
- Impact: low. A future reader trusting `batches.md`'s verification note at face value
  would be surprised to find the deviated form still in the files; if a later batch copies
  these two libs' `project.json` as a new pattern-to-follow (the way this batch copied
  harness-builder), the deviation could propagate as if it were the new house style, when
  the plan is for it to disappear.
- Fix: when the revert lands, change both `project.json`'s `typecheck.options` from the
  `commands`/`forwardAllArgs` array form back to harness-builder's single `"command"`
  string; no other file needs to change, per the behavioural confirmation above.

## Data flow

This batch has no runtime data flow (no logic, no consumer). The relevant "flow" is
build-time target resolution, traced end to end:

1. `nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard
   @ptah-extension/mcp-apps-page` resolves both projects via `nx show projects` — OK,
   confirmed by the executor's evidence (`batch-2-report.md:78-79`) and implicitly by my own
   successful run-many invocation, which would have failed to resolve targets otherwise.
2. `lint` runs `@nx/eslint:lint` against each project's `eslint.config.mjs`, which extends
   the (untouched) root config plus Angular flat-config presets — OK, both pass with no
   findings.
3. `typecheck` runs `npx ngc --noEmit --project .../tsconfig.lib.json` (via the deviated
   `commands`/`forwardAllArgs: false` form today) — OK, exits 0 for both; would also exit 0
   under the planned plain-`command` form given the corrected invocation (independently
   confirmed against harness-builder).
4. `test` runs `@nx/jest:jest`; jest finds zero spec files under `src/`, and
   `passWithNoTests: true` (workspace default, `nx.json:41-45`) turns that into exit 0
   rather than a failure — OK, this is the intended, already-workspace-wide behaviour, not
   something this batch introduces.
5. `tsconfig.base.json`'s two new path entries map the bare specifiers to `src/index.ts` —
   OK by inspection (`git diff tsconfig.base.json`); not yet exercised by any real import
   since nothing in the workspace imports either lib yet, which is correct for this batch
   (Batch 3 is the first consumer, per `batches.md:206`).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Two libs scaffolded with the documented names/tags/paths (D6) | COMPLETE | None; verified against the plan's table (`implementation-plan.md:265-268`) and `batches.md:184-188` |
| `"strict": true` plus harness-builder's Angular strict-template options | COMPLETE | `tsconfig.json` is byte-identical to harness-builder's for both libs |
| No `build` target; non-buildable | COMPLETE | Confirmed by reading both `project.json`'s `targets` object — only `test`, `lint`, `typecheck` |
| `test`/`lint`/`typecheck` targets like harness-builder | COMPLETE (with a known, tracked deviation) | `typecheck` still uses the `forwardAllArgs: false` form pending the documented revert — see Minor issue; functionally equivalent today |
| `eslint.config.mjs` at the root not edited | COMPLETE | `git status --porcelain eslint.config.mjs` shows no change |
| `src/index.ts` starts empty (`export {};`) | COMPLETE | Both files read directly |
| No `/services` subpath for `mcp-apps-page` (R7) | COMPLETE | `git diff tsconfig.base.json` shows exactly two entries, both `src/index.ts` |
| No zod or new lib in the initial bundle (R8) | COMPLETE | Empty barrels, no `package.json` change, nothing imports either lib yet |
| Delete any generator sample component | COMPLETE (vacuously) | No generator was run (`batch-2-report.md:41-43`), so there was never a sample component to delete; file listing confirms no stray `lib.ts`/spec beyond the documented set |
| Targets actually work, not just configured | COMPLETE | Re-ran `lint,typecheck,test` fresh with `--skip-nx-cache`: 6/6 green |

Implicit requirements not addressed: none found. The lazy-load gate (B19) and the first
real consumer (Batch 3) are explicitly deferred to later batches by both `batches.md` and
`implementation-plan.md`, not silently skipped here.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Future `*.spec.ts` under `src/` is picked up by jest | YES | `tsconfig.spec.json` includes `src/**/*.spec.ts`/`src/**/*.test.ts`; `jest.config.ts` transform covers `.ts`/`.html`; identical to every other Angular lib | None |
| Future component template covered by `typecheck` and excluded from it correctly | YES | `tsconfig.lib.json` excludes specs/test-setup; `ngc` resolves `templateUrl` independent of `include` glob, confirmed against the already-working `marketplace` lib | None |
| Future `.html` template linted | YES | `eslint.config.mjs`'s `files: ['**/*.html']` block, identical to harness-builder | None |
| Path mapping resolves for a future static import | Not yet exercised | `tsconfig.base.json` entries point at `src/index.ts`, same shape as every other lib's mapping | Low — first real test is Batch 3; nothing in this batch could break it further since the entries are trivial |
| Either lib accidentally lands in the eager bundle | NO (correctly) | No import exists anywhere yet; `src/index.ts` empty; no `/services` eager side-entry | None for this batch; the real gate is B19 |
| `test` target on an empty lib doesn't mask a real failure | YES | `passWithNoTests: true` is a pre-existing workspace default, not new to this batch; exit 0 behaviour verified by direct run | None |
| `typecheck` target's current `forwardAllArgs: false` form vs. the planned plain form | YES (both work) | Verified both forms pass the corrected verification command (current form via my own run-many; plain form via harness-builder's own target) | Minor — see issue above |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking or serious. The only residual item is the Minor
  documentation/code drift on the `typecheck` target's `forwardAllArgs: false` form, which
  I confirmed behaviourally does not affect the current green run and will not affect it
  once reverted to the plain form.
- What a robust implementation would add: (1) apply the already-agreed revert of the
  `typecheck` target to harness-builder's plain `"command"` form so the two `project.json`
  files match what `batches.md` already describes; (2) nothing else — this is a
  configuration-only scaffold batch, faithfully copied from a proven, already-working
  pattern (`harness-builder`, cross-checked against `marketplace` for the templateUrl
  question), and its stated requirements (R7, R8, non-buildable, strict tsconfig) are all
  independently verifiable from the files and from a fresh, cache-bypassed target run.

# Batch 3 review

## Summary

| Metric               | Value                                 |
| --------------------- | ------------------------------------- |
| Overall score          | 8/10                                   |
| Assessment             | APPROVED                               |
| Blocking issues        | 0                                      |
| Serious issues         | 0                                      |
| Moderate issues        | 1                                      |
| Minor issues           | 1                                      |
| Failure modes found    | 1                                      |

Scope examined: `libs/frontend/declarative-dashboard/src/lib/surface-view-state.ts`,
`surface-interaction.ts`, `view-model/view-model.types.ts`, `view-model/dashboard-view-model.ts`
(+ `.spec.ts`), `src/index.ts`; the referenced contract types at
`libs/shared/src/mcp-apps-contracts/surface.types.ts:1-210`,
`dashboard-spec.types.ts:80-140`, `dashboard-catalog.ts:56-169`, and the v1 validator's own
depth walk (`dashboard-spec.validator.ts:134-163`) to independently confirm the "root depth
1, off-by-one" claim rather than trust the doc comment. `batches.md` Batch 3 (Task 3.1,
D-4/R4) and `implementation-plan.md:263-276` (D6) and `:725-750` (Component 10) were read in
full. `ptah_get_diagnostics` scoped to the six files under review: 0 errors, 0 warnings.
Verification re-run fresh: `npx nx run-many -t lint,typecheck,test -p
@ptah-extension/declarative-dashboard --skip-nx-cache --output-style=static` — 6/6 targets
green, 17/17 tests passed.

## Five logic questions

### 1. How does this fail silently?

- `mapDisplayNode` (`dashboard-view-model.ts:37-83`) validates the `id`, `actions` array
  shape, and each kind's own required field for `stat` (`:39-44`) and `table` (`:53-54`),
  but does **not** validate the shape of `list.items` (`:62-69`) or either chart kind's
  `series` (`:70-79`). A component with `kind: 'list'` and `items: 'not-an-array'`, or
  `kind: 'line-chart'` and `series: null`, passes through `mapDisplayNode` unchanged and is
  returned as a "successful" `DisplayNode` — no `TypeError`, no `renderFailed` signal — even
  though the file's own doc comment (`:85-88`) promises "Defensive shape failures throw for
  the renderer's renderFailed fallback." The malformed value is silently forwarded to
  whatever consumes `DisplayNode.items`/`.series` next (the list/chart components, not yet
  built — Batches 4-5), which is exactly where "fails silently" becomes "fails loudly and
  confusingly one layer downstream," outside this builder's own declared contract.
  Evidence: `dashboard-view-model.ts:62-79` (no `Array.isArray` guard on `items`/`series`,
  contrast with `:53-54`'s `if (!Array.isArray(component.columns)) throw ...` for `table`).
  Severity is bounded because the hard boundary — `dashboard-spec.validator.ts`'s zod schema
  — already rejects a malformed `items`/`series` before a spec ever reaches this builder in
  production (confirmed: `findStructuralBreach` and the surrounding validator only hand a
  spec to a caller after full schema validation). The gap only bites a caller that invokes
  `buildDashboardViewModel` directly on unvalidated input, which the current codebase does
  not do. See Moderate issue M1.

### 2. What user action produces unexpected behaviour?

None found. This batch ships no component and no user-reachable path; `buildDashboardViewModel`
and `mapDisplayNode` are pure functions with no caller yet outside their own spec.

### 3. What input data produces a wrong answer?

- The depth/off-by-one case was independently re-derived against the validator, not just
  read from the doc comment: `dashboard-spec.validator.ts:141-159` starts roots at
  `depth: 1` and fails when `depth > maxDepth` (8), so a validated spec's deepest node sits
  at tree-depth 8 and can never itself carry children (a depth-8 node's children would be
  depth 9, which the validator already refused). `buildDashboardViewModel`'s
  `mapComponents(spec.components, 1)` (`:125`) mirrors this exactly: a component at depth
  `d` is always included, but its own children are only recursed into when `d < maxTreeDepth`
  (`:113-118`); at `d === 8` children are forced to `[]` without being visited. This matches
  the validator's semantics bit-for-bit (root depth 1, depth 8 is the deepest legal level,
  a would-be depth-9 descendant is dropped, not thrown on). The spec at
  `dashboard-view-model.spec.ts:122-148` builds a 9-level chain (`depth-1`…`depth-8`→`beyond`)
  and asserts the walk stops at `depth-8` with `depth === DASHBOARD_LIMITS.maxTreeDepth` —
  this assertion would fail under either a fencepost error (dropping at depth 7 or leaking
  depth 9) so it is a real, falsifiable pin, not a decorative one. No off-by-one defect
  found.
- `component.actions?.some((action) => action?.action === 'dashboard.select')`
  (`:24-27`) is null-safe per array element, so a malformed action entry (`null`, a string)
  cannot throw and simply does not count as a `dashboard.select` match — correct, matches
  "selectable true only with dashboard.select".
- No defect found in `SurfaceRenderable = SurfaceContent` (`surface-view-state.ts:7`): a
  direct type alias is the simplest possible mirror of `surface.types.ts:187-196` and stays
  byte-for-byte in sync as the source type evolves, satisfying D6/Component 10 exactly.

### 4. What happens when a dependency fails?

Not applicable in a meaningful way — this batch has no I/O, network, RPC or timer
dependency; its only "dependency" is the imported constants (`DASHBOARD_LIMITS`,
`DASHBOARD_COMPONENT_KINDS`) and contract types from `@ptah-extension/shared` and
`@ptah-extension/shared/mcp-apps-contracts`, both compile-time and verified present by a
clean `typecheck` run.

### 5. What is missing that the requirements never mentioned?

- The requirements ask only that "text remains literal contract text, never HTML" and that
  the union mirror `SurfaceContent`; they do not ask for per-kind structural validation
  parity across all five v1 kinds. The implementation nonetheless validates `stat` and
  `table` defensively but not `list`/`line-chart`/`bar-chart` — an inconsistency the
  requirements never called out either way (see M1). Nothing else appears missing: D-4/R4's
  named export list is complete in `index.ts:1-25` (`SurfaceRenderable`, `SurfaceViewState`,
  `SurfaceComponentViewState`, `SurfaceInteractionState`, `SurfaceInputCommit`,
  `SurfaceActionInvoke`, `SurfaceSelectionChange`, `SURFACE_PAGE_SIZE`), and the v2-shaping
  fields Batch 6 will need are already on the types (`InputNode.hostValue`/`.draftError` at
  `view-model.types.ts:40-44`; `LayoutNode.submitActions` at `:30`).

## Failure modes

### Inconsistent per-kind defensive validation in `mapDisplayNode`

- Trigger: a caller passes `buildDashboardViewModel` a spec whose `list.items` or a chart's
  `series` field is not an array (or is some other wrong shape), while its `id`, `actions`,
  and (for `stat`/`table`) their own required fields are otherwise well-formed.
- Symptom: no `TypeError` is thrown; the malformed value passes straight into the returned
  `DisplayNode`, silently breaking the documented "defensive shape failures throw for the
  renderer's renderFailed fallback" contract for two of the five v1 kinds.
- Evidence: `dashboard-view-model.ts:62-69` (`list`, no `items` check), `:70-79` (charts, no
  `series` check), contrast `:39-44` (`stat`, throws on bad `value`) and `:53-54` (`table`,
  throws on bad `columns`).
- Current handling: none for `list`/chart kinds; the doc comment at `:85-88` overstates the
  actual coverage.
- Recommendation: add the same `Array.isArray` guard used for `table.columns` to
  `list.items` and to each chart's `series`, or narrow the doc comment to state precisely
  which kinds get defensive shape checks and why (e.g., "the schema validator is the real
  boundary; these are spot checks, not full coverage"). Low urgency today because
  `dashboard-spec.validator.ts` is the actual production boundary and already rejects these
  shapes before this builder ever sees them — but the builder's own doc comment currently
  promises more than the code delivers, which will mislead a future caller that invokes it
  directly (e.g., from a test fixture or a future non-webview consumer).

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

### M1 — `list`/chart kinds skip the per-kind defensive check `stat`/`table` get (Moderate)

See "Failure modes" above for full detail. File: `dashboard-view-model.ts:62-79`.

### Minor — `toMatchObject` in the primary mapping test cannot detect an added stray field

- File: `dashboard-view-model.spec.ts:80-86` ("maps every v1 catalog kind without losing
  display fields or interpreting text").
- `expect(result.components[index]).toMatchObject({...component, selectable: false})` only
  asserts the listed keys are present with the right values; it does not fail if
  `mapDisplayNode` started leaking an extra, unexpected field onto the returned node (e.g.
  an internal marker). The companion `not.toBe(component)` assertion does catch aliasing,
  and the "invalid shape" `it.each` block separately proves the throw paths, so this is a
  narrow gap, not a hole in the batch's overall spec rigor.
- Impact: low — a hypothetical regression that adds a stray field to every `DisplayNode`
  would slip past this specific assertion, though it would very likely be caught by
  `dashboard-view-model.spec.ts`'s "does not mutate frozen source objects... produces
  repeatable results" test only if the extra field varied between runs (it likely would
  not, so that test would not catch it either).
- Fix (optional, next touch): swap to `toEqual` with an explicit expected object per kind, or
  add one `expect(Object.keys(result.components[index]).sort()).toEqual([...])` assertion.

## Data flow

1. A `DashboardSpecEnvelope` (already validated upstream by
   `dashboard-spec.validator.ts`, outside this batch) is passed to `buildDashboardViewModel`
   — OK; the function re-checks `schemaVersion`, `catalogVersion`, `title.text`, and
   `Array.isArray(components)` itself as a second boundary (`:92-100`).
2. `mapComponents` walks the component array depth-first, incrementing `depth` per level and
   capping recursion at `DASHBOARD_LIMITS.maxTreeDepth` (`:102-120`) — OK, verified to match
   the validator's own depth semantics bit-for-bit (see Q3 above).
3. Each component is handed to `mapDisplayNode`, which validates `id` and `actions` shape
   uniformly, then does a kind-specific check for `stat` and `table` only — PARTIAL, gap
   noted in M1 for `list`/chart kinds (does not affect production today since step 1's
   upstream validator already guarantees well-formed shapes; matters only for a future
   direct caller).
4. The mapped `DisplayNode` tree is returned as a new, unfrozen object graph, provably not
   aliasing the (possibly frozen) input (`dashboard-view-model.spec.ts:201-210`) — OK, pure
   and side-effect-free.
5. `index.ts` re-exports the types and functions Batch 6+ need — OK, D-4/R4's full list is
   present.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Node union `LayoutNode \| InputNode \| DisplayNode`, each with `selectable` (true only with `dashboard.select`) | COMPLETE | `selectable` computed correctly for `DisplayNode` today (`mapDisplayNode:24-27`, spec-pinned); `LayoutNode`/`InputNode` are type-only in this batch (no builder yet — correctly deferred to Batch 6) |
| v1 `children` up to `DASHBOARD_LIMITS.maxTreeDepth`, root depth 1 as in the v1 validator | COMPLETE | Independently re-derived against `dashboard-spec.validator.ts:141-159` and confirmed bit-for-bit; spec-pinned with a falsifiable 9-level fixture |
| `SURFACE_PAGE_SIZE = 25` | COMPLETE | `surface-view-state.ts:9`, spec-asserted `dashboard-view-model.spec.ts:87` |
| `SurfaceRenderable` mirrors `SurfaceContent` (`surface.types.ts:187-196`) | COMPLETE | Direct type alias, byte-for-byte mirror |
| D-4/R4 exports from `src/index.ts` | COMPLETE | All eight named items present, `index.ts:1-25` |
| Imports only `@ptah-extension/shared` and `@ptah-extension/shared/mcp-apps-contracts` (incl. `/surface` subpath) | COMPLETE | Verified across all four `.ts` source files; no stray import |
| Purity / no mutation | COMPLETE | Spec-pinned with `Object.freeze` + `JSON.stringify` before/after comparison |
| No text interpretation | COMPLETE | Text fields copied as opaque `DashboardRichText`/strings throughout; no HTML parsing anywhere in scope |
| Types serve later batches (B6 InputNode hostValue/draftError, LayoutNode submitActions; B10-B13 Apps-state imports) | COMPLETE | Fields present on the types; B10-B13 usage not yet exercised (expected, those batches are pending) |
| No stubs/TODOs | COMPLETE | No placeholder comments or unimplemented branches found |

Implicit requirements not addressed: consistent per-kind defensive validation across all
five v1 `DisplayNode` kinds (M1) — the requirements never state this explicitly, and the
production boundary (the zod validator) already covers it, so this is a residual doc/code
mismatch rather than an unaddressed requirement.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty `components` array | YES | `dashboard-view-model.spec.ts:151` | None |
| Depth exactly `maxTreeDepth` (8) | YES | Node included, children dropped without being visited (`:113-118`), spec-pinned with a 9-level fixture | None |
| `dashboard.select` present among other/no actions | YES | `dashboard-view-model.spec.ts:90-120`, four-way table | None |
| Frozen/deeply-frozen input spec | YES | `dashboard-view-model.spec.ts:201-210` | None |
| `null`/non-object/wrong-`schemaVersion`/non-array-`components` envelope | YES | `it.each` at `:166-199`, 10 cases | None |
| Malformed `stat.value` / `table.columns` / `actions` shape | YES | Throws, spec-pinned | None |
| Malformed `list.items` / chart `series` shape | NO | Passes through unchecked | M1 — low production risk (upstream validator is the real gate), but the doc comment overstates coverage |
| Opaque `data` reference passed through unresolved | YES | `dashboard-view-model.spec.ts:150-164` | None |
| Determinism / repeatable output for the same input | YES | `dashboard-view-model.spec.ts:205-206` (`toEqual` across two calls) | None |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking or serious. The only material finding (M1) is a defensive-coverage
  inconsistency between `stat`/`table` and `list`/chart kinds inside `mapDisplayNode`, whose
  practical impact is currently zero because the real trust boundary
  (`dashboard-spec.validator.ts`) already rejects malformed shapes before they reach this
  builder — it matters only if a future caller invokes `buildDashboardViewModel` on
  unvalidated input, and it means the file's own doc comment (`:85-88`) promises slightly
  more defensive coverage than the code delivers.
- What a robust implementation would add: (1) close M1 by adding the same `Array.isArray`
  guard to `list.items` and chart `series` that `table.columns` already gets, or narrow the
  doc comment to say precisely what is and is not defended; (2) strengthen the primary
  mapping test (Minor issue) to catch an added stray field, e.g. via an explicit key-set
  assertion; (3) nothing else — the depth/off-by-one semantics, the selectable logic, the
  export surface for later batches, purity, and the "no text interpretation" requirement are
  all independently verified against the source contracts and are spec-pinned with
  falsifiable assertions, not just present.
