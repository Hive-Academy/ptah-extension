# Code Logic Review — `TASK_2026_538_3ccf` Batch 12

Verdict: NEEDS_REVISION

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 6/10                                 |
| Assessment          | NEEDS_REVISION                       |
| Blocking issues     | 0                                     |
| Serious issues      | 1                                     |
| Moderate issues     | 1                                     |
| Failure modes found | 3                                     |

Scope reviewed: `libs/backend/vscode-lm-tools/src/lib/surface/dashboard-surface-bridge.ts` (+ `.spec.ts`),
`surface/index.ts`, `code-execution/namespace-builders/surface-namespace.builder.ts` (+ `.spec.ts`),
`namespace-builders/index.ts`, `system-namespace.builders.ts`, `dashboard-namespace.builder.ts` (`:133-142` delta
only), `dashboard-namespace.builder.spec.ts` (appended block only). Read whole files, not only diffs, including the
Batch 10 facade (`surface-state.service.ts`, `surface-agent-mutations.ts`, `surface-commit.ts`,
`surface-concurrency.ts`, `surface-state-reader.ts`) to trace the outcome each branch actually produces.

Verification run (targeted, not workspace-wide):
`npx jest -c libs/backend/vscode-lm-tools/jest.config.ts libs/backend/vscode-lm-tools/src/lib/surface/dashboard-surface-bridge.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/surface-namespace.builder.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/dashboard-namespace.builder.spec.ts`
→ 3 suites, 64 tests, all passed. This is a subset of the batch's own report (62/62 suites, 1,355/1,355 tests,
typecheck/lint clean), consistent with it.

`git status --short` confirms Batch 12 touched exactly its own files (`surface/dashboard-surface-bridge.ts(.spec.ts)`,
`surface/index.ts`, `code-execution/namespace-builders/surface-namespace.builder.ts(.spec.ts)`,
`namespace-builders/index.ts`, `system-namespace.builders.ts`, `dashboard-namespace.builder.ts`,
`dashboard-namespace.builder.spec.ts`). The other modified/untracked files
(`libs/backend/rpc-handlers/**`, `libs/shared/src/lib/types/rpc*`) belong to the concurrent Batch 11 in
`libs/shared`/`libs/backend/rpc-handlers`, out of scope per the task brief.

## Five logic questions

### 1. How does this fail silently?

It mostly does not — every rejection/unavailable/render-only branch returns a discriminated status the dispatcher
maps to `isError: true` (v2) or `toolErrorResponse` (v1, `protocol-dispatcher.ts:1645`). The one place a failure is
dressed as something other than what happened is the v1 bridge's collapse of a **store rejection** into a
**delivery failure** — see Failure mode 1 below. It is not literally silent (the tool result is still `isError: true`
through `dashboard-propose-spec`'s dispatcher case), but the reported cause and the recommended recovery are wrong.

### 2. What user action produces unexpected behaviour?

A `ptah_dashboard_propose_spec` call that is schema-valid but pushes the surface store over `SURFACE_STORE_LIMITS.maxStoreBytes`
gets `status: 'delivery-failed'` with text saying "is valid but was NOT fully delivered to the UI... re-send rather
than assuming nothing arrived" (`dashboard-namespace.builder.ts:296-300`), while `ptah_surface_get_state` for
`v1:<specId>` will report not-found, because nothing was ever committed
(`dashboard-surface-bridge.spec.ts:110-135` proves `service.read('tab-a')` is `{ status: 'not-found' }` in exactly
this case). See Failure mode 1.

### 3. What input data produces a wrong answer?

Same input as above: a well-formed v1 dashboard-spec envelope for a routing id whose store usage is already near
`maxStoreBytes`. `validateDashboardSpec` (shared, upstream of the bridge) only checks the spec's own shape/size, not
whether the store has room, so this is reachable from ordinary agent traffic, not just an adversarial payload.

### 4. What happens when a dependency fails?

- Logger throws: `surface-namespace.builder.ts` wraps its dependency in `nonThrowingSurfaceLog` (`surface-log.ts`),
  and Task 12.4 guards the one previously-unguarded `logger.debug` call inside `createDashboardBroadcast`
  (`dashboard-namespace.builder.ts:133-139`). Both are pinned by tests and both pass.
- `sendMessage` throws / rejects / returns false / is partial / races disposal: fully covered by
  `surface-namespace.builder.spec.ts:353-410` (`false`, `throw`, `reject`, `partial`, `disposed`), each asserting no
  unhandled rejection (`process.on('unhandledRejection', ...)`), retained store state, and a stale rejection on
  retry. This matches the review focus exactly and is solid.
- Store/service missing (`SURFACE_STATE_SERVICE` not registered): both `update` and `getState` return
  `{ status: 'unavailable', reason: 'surface state unavailable on this host' }` before touching anything
  (`surface-namespace.builder.ts:119`, `:172`), verified by
  `surface-namespace.builder.spec.ts:295-322`.
- Store commit refused (budget) for a v1 proposal: turned into a *delivery* failure, not surfaced as what it is (a
  commit refusal). See Failure mode 1.

### 5. What is missing that the requirements never mentioned?

- `DashboardDeliveryOutcome` (owned by `dashboard-namespace.builder.ts`, out of this batch's edit scope except
  `:133-136`) has no variant for "the write was refused before any surface was contacted." The v1 bridge has to
  fold that case into `'failed'`, which is the least-bad of the three available statuses (mapping it to
  `'no-surface'` would read as full success, since `buildDashboardNamespace.proposeSpec` treats any non-`'failed'`
  delivery as `status: 'accepted'`) — but the resulting caller text is still wrong. Neither `batch-12-report.md` nor
  the code comment at `dashboard-surface-bridge.ts:16-17` escalates this as an open question for the reviewer; it is
  stated as settled ("preserve the reason for its caller") without flagging the misleading "re-send... nothing
  arrived" wording that results.
- The v2 `'delivery-failed'` text in `surface-namespace.builder.ts:143-144` always says "the same patch would be
  stale," even when the applied operation was `create`, `replace` or `delete` — for those, a retry does not fail
  with `stale-revision`, it fails with `already-exists` or (for delete) `not-found`/stale by a different mechanism.
  Not incorrect advice ("do not resend blindly" still holds), just imprecise wording. Minor.

## Failure modes

### 1. v1 store-rejection reported as a misleading delivery failure

- Trigger: `ptah_dashboard_propose_spec` with a schema-valid spec for a routing id where the surface store is at or
  near `SURFACE_STORE_LIMITS.maxStoreBytes`, so `prepareCreateCommit`/`prepareReplaceCommit` (via
  `surface-state.service.ts:538-554`, `commitRecord`) refuses the commit.
- Symptom: the agent is told (`dashboard-namespace.builder.ts:296-300`) "Dashboard spec ... is valid but was NOT
  fully delivered to the UI: `<budget reason>`. 0 surface(s) did receive it, so the user may be looking at this
  dashboard already — re-send rather than assuming nothing arrived. The dashboard follows as text." Nothing was
  ever committed (`service.read()` returns `not-found`), so "re-send rather than assuming nothing arrived" is
  backwards: resending IS what should happen, and there is no chance the user is "already looking at" anything,
  because the write never reached the store.
- Evidence: `libs/backend/vscode-lm-tools/src/lib/surface/dashboard-surface-bridge.ts:15-23` (maps every
  non-`'applied'` `SurfaceAgentUpdateResult` — which includes genuine store `'rejected'` results, confirmed reachable
  via `surface-state.service.ts:543-554` → `executeAgentPlan`'s `'rejected'` plan branch, `:477-494` — to
  `{ status: 'failed', delivered: 0, surfaces: 0, reason: result.detail }`); reproduced by the batch's own test
  `dashboard-surface-bridge.spec.ts:110-135` ("reports a refused store commit as failed delivery"), whose assertion
  (`service.read('tab-a')` is `not-found`) proves the store never committed while the outer text (traced through
  `dashboard-namespace.builder.ts:286-303`) claims otherwise.
- Current handling: `DashboardBroadcast`'s return type (`DashboardDeliveryOutcome`, owned by
  `dashboard-namespace.builder.ts:55-64`, out of this batch's edit scope) has only `delivered` / `no-surface` /
  `failed`, with no "refused before dispatch" variant, so the bridge picks `'failed'` as the closest fit. That
  choice is reasonable given the constraint; the resulting caller-facing copy is not.
- Recommendation: either (a) have the architect extend `DashboardDeliveryOutcome` with a fourth,
  honestly-named variant (e.g. `'refused'`) that `buildDashboardNamespace.proposeSpec` renders with different,
  accurate wording ("was not committed; nothing to resend caution needed, retry once space frees" rather than "do
  not assume nothing arrived"), or (b) at minimum, have the bridge's `reason` string state explicitly that the spec
  was never committed and a retry has not yet been attempted, and have the report/team-leader record this as an
  accepted, reasoned wording limitation rather than leaving it undiscussed. This is reachable in production (any
  routing id whose accumulated surface state nears the store budget), not just in the unit test's artificially tiny
  `maxStoreBytes: 1`.

### 2. `dashboard-namespace.builder.spec.ts`'s "no-webview" throwing-logger case is vacuous

- Trigger: none at runtime — this is a test-quality gap, not a production defect.
- Symptom: the appended parametrized case `it.each(['no-host', 'no-webview'])('keeps %s classified as no-surface
  without rejecting', ...)` (`dashboard-namespace.builder.spec.ts:711-729`) passes for `'no-webview'` regardless of
  whether the throwing `debug` guard exists, because `createDashboardBroadcast`'s `logger.debug` call only executes
  on the `!resolvedHost` (no-host) branch (`dashboard-namespace.builder.ts:131-141`); when a host exists but
  `getActiveWebviews()` is `[]`, the function returns `{ status: 'no-surface' }` at `:155-157` without ever touching
  the logger. The throwing `debug` passed into the fixture is simply never invoked for that parametrized case.
- Evidence: `dashboard-namespace.builder.ts:127-157` (no `logger.debug` call reachable once `resolvedHost` is
  truthy) vs. `dashboard-namespace.builder.spec.ts:711-729` (asserts on both `'no-host'` and `'no-webview'` as if
  both exercised the guard).
- Current handling: batch-12-report.md states "Appended two parameterized regression cases for a throwing logger
  with no host and no webview; both resolve no-surface and never attempt a send" — accurate about the outcome, but
  overstates what the `'no-webview'` case actually exercises.
- Recommendation: either drop the `'no-webview'` variant (there is nothing to guard on that path) or replace it
  with a case that actually forces a logger call on a path that has one, so the regression's name matches what it
  proves. Non-blocking — the underlying behaviour (`Task 12.4`'s one-line fix) is correct and is exercised by the
  `'no-host'` case.

### 3. Delivery-failed wording assumes "patch" semantics for every operation

- Trigger: an `accepted`-then-`delivery-failed` `create`, `replace` or `delete` through `ptah_surface_update`.
- Symptom: the reason text always says "do not resend; the same patch would be stale"
  (`surface-namespace.builder.ts:143-144`), even for a `create` (a resend would fail with `already-exists`, not a
  staleness check) or a `delete`.
- Evidence: `surface-namespace.builder.ts:141-146` — the template is built once from `result.operation`-independent
  text.
- Current handling: none; the word "patch" is generic filler in the template regardless of `result.operation`.
- Recommendation: minor wording fix only if this file is touched again; the guidance direction (do not blindly
  resend) is still correct, just imprecise for non-patch operations. Not blocking.

## Blocking issues

None found. Scope, imports (R8), anonymous-caller rules, validation-before-scope ordering, and the delivery matrix
are all implemented and tested correctly (see Edge cases below).

## Serious issues

### v1 bridge conflates a store-commit refusal with a delivery/transport failure

- File: `libs/backend/vscode-lm-tools/src/lib/surface/dashboard-surface-bridge.ts:15-23`
- Scenario: a schema-valid v1 dashboard-spec proposal that the store refuses to commit (budget exceeded, or any
  future `'rejected'`-plan reason from `planV1Proposal`).
- Impact: the agent (and, transitively, whatever narrates the tool result to the user) is told the content "is
  valid," is given rendered text as if it reflects the surface, and is explicitly advised "re-send rather than
  assuming nothing arrived" — the opposite of correct guidance, since nothing was committed and a resend is exactly
  what recovers the situation. A subsequent `ptah_surface_get_state` for `v1:<specId>` will contradict the earlier
  message by returning not-found. See Failure mode 1 for full trace and reproduction.
- Fix: see Failure mode 1 recommendation — extend the type (architect-level decision, likely a Batch 13/16 item
  since `DashboardDeliveryOutcome` is a shared type outside this batch's file-edit scope) or, at minimum, adjust the
  bridge's `reason` string so it does not claim a delivery attempt happened when the store never committed.

## Moderate and minor issues

- MODERATE: `dashboard-namespace.builder.spec.ts:711-729` — the `'no-webview'` throwing-logger case does not
  exercise a throwing logger (see Failure mode 2). Test-only; no production risk.
- MINOR: `surface-namespace.builder.ts:143-144` — "the same patch would be stale" wording is imprecise for
  `create`/`replace`/`delete` delivery failures (see Failure mode 3).
- MINOR: `planV1Proposal`'s `'rejected'` branch from `checkSurfaceConflict` (`surface-agent-mutations.ts:286-300`)
  is dead code — `checkSurfaceConflict` always returns `{ ok: true }` for `kind: 'v1-proposal'`
  (`surface-concurrency.ts:170`). Harmless defensive code, not introduced by this batch's diff (the conflict check
  itself is Batch 4), but worth noting it can never fire; the only reachable `'rejected'` path for a v1 proposal is
  the store-commit refusal in Failure mode 1.

## Data flow

**v1 path** (`ptah_dashboard_propose_spec` → `dashboard-namespace.builder.ts:proposeSpec` →
`createDashboardSurfaceBridge` → `SurfaceStateService.recordV1Proposal`):

1. `validateDashboardSpec(spec, jsonUtf8Bytes)` — OK, pre-existing v1 schema validation, unedited.
2. `broadcast(DASHBOARD_SPEC_PROPOSED, { spec, sessionId, toolCallId })` calls the bridge — OK, correct payload
   shape (`dashboard-surface-bridge.spec.ts:17-23`).
3. Bridge: `!payload.sessionId` → `{ status: 'no-surface' }`, nothing stored, nothing pushed — OK, matches Req 8.7
   / anonymous rule, proven by `dashboard-surface-bridge.spec.ts:92-98`.
4. Bridge (scoped): `service.recordV1Proposal(sessionId, spec, toolCallId)` → `planV1Proposal` → upsert at
   `v1:<specId>`, agent `revision` kept verbatim, host revision incremented — OK, proven by
   `dashboard-surface-bridge.spec.ts:27-59, 61-74`.
5. `result.status === 'applied'` → `result.delivery` (a `Promise<DashboardDeliveryOutcome>` that "never rejects" per
   its own contract, inherited from Batch 10) is awaited and returned — OK.
6. `result.status !== 'applied'` (i.e. `'rejected'`, since `'not-found'` is unreachable for this plan) → mapped to
   `{ status: 'failed', delivered: 0, surfaces: 0, reason: result.detail }` — GAP, see Failure mode 1: this is a
   store-refusal, not a delivery failure, and the resulting text is misleading.
7. `dashboard-namespace.builder.ts:286-317` renders the final tool outcome from the delivery status — inherits the
   gap from step 6 unchanged (this file is untouched here except `:133-139`).

**v2 path** (`ptah_surface_update`/`ptah_surface_get_state` → `surface-namespace.builder.ts` →
`SurfaceStateService`):

1. `validateSurfaceUpdateInput(input, jsonUtf8Bytes)` runs first, before any caller/scope check — OK, matches Req
   8.2/8.5 ordering, proven by `surface-namespace.builder.spec.ts:295-322`.
2. Anonymous + create/replace → `render-only` with `renderAnonymous`, no store/push touch (`apply` spy asserted
   not-called) — OK, proven by `:256-275`.
3. Anonymous + patch/delete → `unavailable` — OK, proven by `:277-293`.
4. Anonymous getState → `not-found`, generic text regardless of input — OK, proven by `:288-291`.
5. Scoped, service present → `service.applyAgentUpdate(caller.sessionId, validated, caller.toolCallId)`; scope is
   never taken from any tool argument (schema `.strict()` rejects forged `sessionId`/`routingId` keys) — OK, proven
   by `:154-219` (cross-tab not-found parity) and `:207-219` (forged-key rejection).
6. `result.status !== 'applied'` → `rejected` with `not-found`/reason-prefixed text — OK, this path correctly keeps
   store-rejection and delivery-failure as two distinct outcome kinds (unlike the v1 bridge), because
   `applyAgentUpdate`'s `'rejected'`/`'not-found'` results are handled BEFORE any push is attempted.
7. `result.status === 'applied'` → await `result.delivery`; `delivery.status === 'failed'` → `delivery-failed` with
   committed state retained and a "do not resend" note; otherwise `accepted` — OK, full delivery matrix
   (false/throw/reject/partial/disposed) proven with no unhandled rejection at `:353-410`.
8. A retried delivery-failed patch → `rejected`, reason contains `'stale-revision'` — OK, proven at `:399-402`.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Req 8.1 (accepted text incl. delete naming surface+revision) | COMPLETE | none |
| Req 8.2 (invalid input rejected first, nothing changed/pushed) | COMPLETE | proven for both anonymous and scoped, `:295-322` |
| Req 8.3 (bounded get-state, truncation + per-surface recovery) | COMPLETE (delegated to Batch 10's `describeForAgent`, exercised via `:98-125`) | none in this batch |
| Req 8.4 (scope from trusted context only; cross-tab = not-found for each tool) | COMPLETE | proven for update (replace/patch/delete) and getState (state/structure), `:154-219` |
| Req 8.5 (anonymous matrix) | COMPLETE | proven at `:256-293` |
| Req 8.6 (committed vs delivery reported separately; never `delivered` on failed send; retry not applied twice) | PARTIAL | v2 path complete and well-tested; v1 bridge conflates a store refusal into the delivery-failure channel (Failure mode 1) |
| Req 8.7 (one intake for v1/v2; deterministic v1 id mapping; repeat/revision/two-tab/collision cases) | COMPLETE for the happy and collision paths; the store-refusal edge case reports incorrectly (same gap as 8.6) | see Failure mode 1 |
| Task 12.4 (throwing logger never turns `no-surface` into `failed`) | COMPLETE | the added `'no-webview'` case is vacuous (Failure mode 2), but the real risk (`'no-host'`) is correctly fixed and tested |
| R8 import rule | COMPLETE | all four new/touched files import v2 values from `.../mcp-apps-contracts/surface`, v1/plain types from `@ptah-extension/shared`, no deep imports |

Implicit requirements not addressed: none found beyond Failure mode 1 (the type-level inability to distinguish a
committed-but-undelivered push from a never-committed write, inherited from the pre-existing `DashboardBroadcast`
contract this batch had to fit into).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Repeated v1 proposal (upsert) | YES | `dashboard-surface-bridge.spec.ts:27-59` | none |
| Agent revision decreases, kept verbatim | YES | same test | none |
| Same v1 `specId` in two tabs | YES | `:61-74` | none |
| v2 id colliding with `v1:<specId>` | YES (schema-level rejection) | `:76-90` | none |
| Anonymous v1 proposal | YES | `:92-98` | none |
| v1 delivery failure after commit | YES | `:100-108` | none |
| v1 store-commit refusal | YES (state), NO (message accuracy) | `:110-135` | Failure mode 1 |
| v2 outcome matrix (accepted/delivery-failed/rejected/unavailable/render-only) | YES | `surface-namespace.builder.spec.ts` throughout | none |
| Cross-tab not-found parity, update + getState, every op/view | YES | `:154-219` | none |
| Forged `sessionId`/`routingId` in tool args | YES | `:207-219` | none |
| Deep/cyclic/oversized/prototype-polluting input | YES | `:221-254` | none |
| Anonymous create/replace/patch/delete/getState | YES | `:256-293` | none |
| Missing service ordering vs. invalid input | YES | `:295-322` | none |
| Throwing get-state input getter | YES | `:324-336` | none |
| Throwing logger never changes accepted/rejected/delivery-failed | YES | `:338-351` | none |
| Delivery matrix false/throw/reject/partial/disposed, no unhandled rejection, stale retry | YES | `:353-410` | none |
| Throwing logger keeps no-host classified as no-surface | YES | `dashboard-namespace.builder.spec.ts:711-729` (`'no-host'`) | `'no-webview'` variant is vacuous (Failure mode 2) |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: the v1 bridge's store-refusal-as-delivery-failure mapping
  (`dashboard-surface-bridge.ts:15-23`) produces caller-facing guidance that actively contradicts the true store
  state ("re-send rather than assuming nothing arrived" when nothing was ever committed and a resend is in fact
  required), reachable by ordinary store-budget pressure, not just adversarial input.
- What a robust implementation would add: either a fourth `DashboardDeliveryOutcome` variant for "refused before
  dispatch" (architect-level, since the type lives outside this batch's edit scope) or, at minimum, wording in the
  bridge/namespace that does not claim a delivery attempt occurred when the store commit itself was refused; and a
  `'no-webview'` throwing-logger regression that actually forces the code path it claims to cover.

---

# Re-review after revision round 1

Verdict: APPROVED

## Summary

| Metric              | Value                                     |
| -------------------- | ------------------------------------------ |
| Overall score        | 9/10                                       |
| Assessment            | APPROVED                                   |
| Blocking issues       | 0                                           |
| Serious issues        | 0                                           |
| Moderate issues       | 0                                           |
| Open findings         | 0 (1 trivial residual note, non-blocking)  |

## Scope of this pass

Read `batch-12-report.md` "## Revision 1" and the five revised files in full (not just the diff):
`dashboard-surface-bridge.ts`/`.spec.ts`, `dashboard-namespace.builder.ts`/`.spec.ts`,
`surface-namespace.builder.ts`/`.spec.ts`. Traced every consumer of `DashboardBroadcast` /
`DashboardDeliveryOutcome` / `createDashboardBroadcast` across the repo (`grep -rn` for the three symbols under
`apps/` and `libs/`, excluding specs, then read each hit) to check the widened union for regressions, since the
revision instructions explicitly authorized touching `dashboard-namespace.builder.ts` beyond its original
`:133-136` scope.

## Finding-by-finding closure

### Serious — v1 bridge conflates store-commit refusal with delivery failure — CLOSED

- `DashboardBroadcast`'s return type is now
  `Promise<DashboardDeliveryOutcome | { status: 'refused'; reason: string }>`
  (`dashboard-namespace.builder.ts:66-71`). `DashboardDeliveryOutcome` itself (the transport-level type used by
  `createDashboardBroadcast`, `surface-push.ts`, `surface-agent-mutations.ts`, `surface-state.service.ts`) is
  untouched — its three members (`delivered`/`no-surface`/`failed`) and every field are byte-for-byte the same as
  before revision 1.
- The bridge (`dashboard-surface-bridge.ts:15-19`) now returns `{ status: 'refused', reason: result.detail }`
  instead of pushing the rejection through the `'failed'` (delivery) channel.
- `buildDashboardNamespace.proposeSpec` (`dashboard-namespace.builder.ts:289-294`) handles `'refused'` before the
  `'failed'` branch, returning `{ status: 'rejected', reason: "Dashboard <identity> was rejected and was not
  stored: <reason>. Nothing was sent to the UI." }` — the correct outcome kind (`rejected`, not
  `delivery-failed`/`accepted`), and the text no longer claims a delivery attempt occurred or advises resending.
- Verified end to end, not just at the type level: `dashboard-surface-bridge.spec.ts:111-155` drives a real
  `SurfaceStateService` with `maxStoreBytes: 1` through the real bridge AND the real `buildDashboardNamespace`,
  asserts the exact `rejected` text (`"...was rejected and was not stored: <budget reason>. Nothing was sent to the
  UI."`), asserts `service.read('tab-a')` is `{ status: 'not-found' }`, asserts `sendMessage` was never called, and
  supplies a logger whose `info`/`warn` both throw to prove the outcome does not depend on logging succeeding. This
  is materially stronger than the original test (which only checked the bridge's own return value in isolation).
- Because `delivery` is narrowed by the early `'refused'` return, the remaining `'failed'`/default
  (`'delivered'`/`'no-surface'`) branches keep exactly their pre-revision types and text
  (`dashboard-namespace.builder.ts:296-320` is textually identical to the pre-revision `:286-317` other than the new
  branch above it) — confirms the report's claim "Accepted and delivery-failed variants, text and fields remain
  unchanged."
- Residual, non-blocking: `proposeSpec`'s `'refused'` branch does not call `logger.warn`/`logger.info` at all, so the
  throwing-logger assertion in the new test, while harmless, doesn't exercise a real guard on that specific branch
  (there is nothing to guard there). Cosmetic; does not affect the verdict.

### Regression check — widened `DashboardBroadcast` type at every consumer

`grep -rn "DashboardBroadcast\b|DashboardDeliveryOutcome\b|createDashboardBroadcast\b" --include="*.ts" apps libs`
(excluding specs) and read every match:

- `libs/backend/vscode-lm-tools/src/lib/surface/dashboard-surface-bridge.ts:1,7` — the only production function
  typed to *return* `DashboardBroadcast`. Fine: it now genuinely produces the `'refused'` member.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/dashboard-namespace.builder.ts` — owns
  both types; `DashboardNamespaceDependencies.broadcast: DashboardBroadcast` is the only place a
  `DashboardBroadcast`-typed value is *consumed*, and `proposeSpec` is the only caller, now handling every member.
  No other file destructures or pattern-matches a `DashboardBroadcast` result.
- `createDashboardBroadcast` (`dashboard-namespace.builder.ts:123-131`, the Batch 2/8 Electron/CLI/VS Code delivery
  primitive) still declares `Promise<DashboardDeliveryOutcome>` — NOT widened. It structurally satisfies the wider
  `DashboardBroadcast` type via return-type covariance when assigned at `ptah-api-builder.service.ts:846`'s
  `broadcast: createDashboardBroadcast(...)`, but it can never itself produce `'refused'`. So Electron, VS Code and
  CLI real webview delivery is provably unaffected by this widening — confirmed by reading
  `apps/ptah-electron/src/ipc/ipc-bridge.ts`, `apps/ptah-electron/src/ipc/webview-manager-adapter.ts`, and
  `libs/backend/cli-engine/src/lib/transport/cli-webview-manager-adapter.ts` (each references
  `createDashboardBroadcast` only in a doc comment, none imports `DashboardBroadcast`/`DashboardDeliveryOutcome`).
- `surface-push.ts:3-22` calls `createDashboardBroadcast(...)(...)` directly and declares its own return type as
  `Promise<DashboardDeliveryOutcome>` (unchanged) — still type-checks because `createDashboardBroadcast`'s return
  type was not widened.
- `surface-agent-mutations.ts:29,66` and `surface-state.service.ts:43,141,669,684` import and use
  `DashboardDeliveryOutcome` only (not `DashboardBroadcast`), which is unchanged — no impact on the v2 agent-write /
  facade delivery path, matching the report's claim that no facade file needed touching.
- No app composition root (`apps/ptah-electron/src/main.ts`, `apps/ptah-extension-vscode/src/main.ts`, `apps/ptah-cli`)
  references either type directly.
- `ptah_get_diagnostics` scoped to the five revised files plus `ptah-api-builder.service.ts` and `surface-push.ts`
  reported 0 errors, 0 warnings, consistent with the report's own `nx run-many -t typecheck` pass.

Conclusion: the widening is contained to exactly the two files that needed it, and every other consumer of the
narrower `DashboardDeliveryOutcome` type is provably untouched.

### Moderate — vacuous "no-webview" throwing-logger case — CLOSED

- `dashboard-namespace.builder.spec.ts:711-719` now has a single case ("keeps no-host classified as no-surface after
  debug throws") that supplies a throwing `debug` and asserts both the `{ status: 'no-surface' }` result and
  `expect(debug).toHaveBeenCalledTimes(1)` — this forces the test through the exact branch
  (`dashboard-namespace.builder.ts:135-141`) the guard protects, unlike the removed `'no-webview'` variant, which
  never reached a `logger.debug` call.
- The report's mutation-testing evidence (temporarily removing the `try/catch` around `logger.debug` and confirming
  the test fails with `{ status: 'failed', delivered: 0, surfaces: 0, reason: 'log channel closed' }`, then
  restoring it) is genuine non-vacuity proof, reproducible from the diff at `dashboard-namespace.builder.ts:135-141`.
- The dashboard spec's original 709-line prefix is confirmed unedited; the file is now 720 lines (down from 730 in
  the pre-revision pass), still under the 1,000-line hard-ceiling precedent from Batch 4.

### Minor — delivery-failed wording assumed "patch" semantics for every operation — CLOSED

- `surface-namespace.builder.ts:141-149` now maps `validated.operation` to an operation-specific retry explanation
  (`create` → "already created... read its current state"; `replace` → "same replacement would be stale"; `patch` →
  "same patch would be stale"; `delete` → "already deleted... cannot repeat that deletion"). All four are accurate
  against the actual retry-rejection mechanism traced in the original review (create retries fail `already-exists`,
  replace/patch retries fail `stale-revision`, delete retries fail `not-found`).
- Pinned by `surface-namespace.builder.spec.ts:412-441`, which for `create`/`replace`/`delete` asserts the exact
  operation-specific phrase, asserts the text does NOT contain "same patch", and asserts the resulting store state
  (`found` for create/replace, `not-found` for delete) — this closes the finding with evidence, not just a wording
  change. The original five-case `false/throw/reject/partial/disposed` patch matrix (`:353-410`) is untouched and
  still asserts the exact patch wording.

### Minor — dead `'rejected'` branch in `planV1Proposal`'s conflict check — unchanged, as instructed

Confirmed still present and still unreachable (`checkSurfaceConflict` always returns `{ ok: true }` for
`kind: 'v1-proposal'`, `surface-concurrency.ts:170`). The report explicitly defers this as harmless pre-existing
defensive code from the already-committed Batch 4/10 facade, outside this batch's authorized edit scope. Accepted;
this was never a defect in Batch 12's own logic.

## Verification

Targeted Jest only, as instructed:

```bash
npx jest -c libs/backend/vscode-lm-tools/jest.config.ts \
  libs/backend/vscode-lm-tools/src/lib/surface/dashboard-surface-bridge.spec.ts \
  libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/surface-namespace.builder.spec.ts \
  libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/dashboard-namespace.builder.spec.ts
```

Result: 3 suites, 66/66 tests passed (up from 64 in the pre-revision pass: -1 for the removed vacuous `'no-webview'`
case, +3 for the new `create`/`replace`/`delete` delivery-failed cases). Consistent with the batch report's
full-project figures (62/62 suites, 1,357/1,357 tests, typecheck and lint clean). `ptah_get_diagnostics` on the
eight touched/consumer files reported 0 errors.

`git status --short` reconfirms Batch 12's file set is unchanged in shape (the five files named in the coordinator's
message plus the two spec files) and no other project was touched by this revision.

## Verdict (re-review)

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking. The one residual note (the `'refused'` branch in `proposeSpec` has no logger call for the
  new throwing-logger assertion to actually guard) is cosmetic and does not change behaviour or coverage of any real
  risk.
- All three findings from the first pass (1 serious, 1 moderate, 1 minor addressed by wording; 1 minor left
  unchanged by design) are closed with file:line evidence and reproducible tests. No new issues found while tracing
  the widened `DashboardBroadcast` type through every consumer in the repository.
