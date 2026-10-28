# P4 fix re-review

Verdict: **REVISE**  
Score: **7/10**  
Review family: reviewer **codex**, implementer **Claude**

Scope: the uncommitted changes to the two provider-account handler/state files and their specs, with targeted reads of the actions port and UI caller. This is not a phase re-review.

## Findings 1–2

Paths below are relative to the repository root.

| P4 finding | Status | Evidence |
| --- | --- | --- |
| 1. Refused sign-out destroys the live sign-in handle | **Closed** | `libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.ts:508` calls the port without replacing the map entry; `:514` returns on every non-ok result; only accepted sign-out deletes at `:518`. Regression coverage: `provider-account-rpc.handlers.spec.ts:1136` (conflict/busy and replay), `:1186` (accepted cleanup). |
| 2. Stale replies restore obsolete scripts/operations | **Partially closed; revise** | `libs/frontend/core/src/lib/services/provider-accounts-state.service.ts:564` captures generation, `:565` captures the epoch, and `:595`–`:599` gate response fields. `:481`, `:484`, `:491` invalidate/clear on terminal/removal; `:415`–`:417` clear on workspace reset. Push-first remains valid through `:645`. The write-path stale-reply cases are addressed, but a refused overlap now discards a valid reply (new defect 1), and status replies bypass these protections (defect 2). |

## New defects / remaining gaps

1. **Moderate — A refused overlapping request invalidates the successful sign-in reply.**

   File: `libs/frontend/core/src/lib/services/provider-accounts-state.service.ts:565`, `:579`, `:598`, `:626`.

   Scenario: start sign-in A and defer its successful response containing the manual fallback. Before A resolves, start another sign-in or sign-out B for the same profile. The service permits overlapping calls (`:515`–`:522`). B advances the epoch, but the real actions port refuses B with busy/conflict while A owns the reservation (`libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.ts:339`–`:340`). The refusal returns without reconciling the epoch. When A resolves, its epoch no longer matches, so both its valid Cancel handle and its sole fallback script are discarded even though A remains pending. This regression also occurs when A resolves before B's refusal arrives. Existing tests cover two successful replies, not a refused contender.

   Fix: distinguish an attempted request from an accepted operation replacement. Preserve/reconcile a successful pending reply when later contenders are refused, while retaining terminal/removal/generation invalidation; alternatively serialize same-profile handle writes before advancing their epoch. Add deferred tests for both response orders and conflict/busy refusals. Do not simply roll the epoch back after refusal: A may already have been discarded, and terminal/newer-operation invalidations must remain authoritative.

2. **Moderate — Status replies can restore obsolete operations or erase a newer script (pre-existing, explicitly requested assessment).**

   File: `libs/frontend/core/src/lib/services/provider-accounts-state.service.ts:320`–`:334`.

   Concrete scenario: Refresh status captures operation A on the host; delay delivery. Switch workspaces, clearing the slot, and receive a terminal/removal snapshot. Deliver the old successful status response: `:329` installs A without a generation, epoch, or pending-state check. A later pending attempt can expose that stale Cancel handle. A workspace switch alone does not necessarily make a global profile's operation invalid, but a reset followed by completion/removal/new attempt does. Even without switching workspaces, a delayed status response with no operation can delete a newer sign-in B's handle and fallback at `:330`/`:334`.

   The path is reachable through `libs/frontend/chat/src/lib/settings/providers/accounts/accounts-section.component.ts:643`; it is not a hypothetical unused helper. The host status reply contains the operation captured at response construction (`libs/backend/rpc-handlers/src/lib/handlers/provider-account-rpc.handlers.ts:359`–`:364`).

   Fix: capture and validate workspace generation plus a per-profile invalidation/read token for status requests, including profiles without a prior local write; reject replies superseded by terminal/removal, newer operations, or newer status reads. Guard deletion as well as insertion. Add deferred status tests across reset, terminal/removal and a newer successful sign-in. A generation check alone is insufficient.

## Decisions

- Finding 1 is closed for every refusal, including exceptions before acceptance: the sign-out handler does not mutate the operation map before success. The real port rejects competing operations while a reservation is active; accepted sign-out settles before returning (`provider-account-actions.service.ts:319`–`:340`). Cancellation retains its operation-ID ownership check (`provider-account-rpc.handlers.ts:489`, `:586`). No concrete new handler concurrency defect was established; the unconditional accepted cleanup was assessed against the real port, not solely the permissive fake.
- Finding 2's generation/epoch approach correctly preserves a same-revision push-first reply and tolerates a higher snapshot revision for the same pending operation. Requiring exact snapshot revision equality would lose valid scripts after duplicate pushes. Terminal/removal invalidation and workspace reset work for the guarded write responses. The new refused-overlap regression prevents approval.
- The fixer's `refreshAccountStatus` observation is a real defect, not merely a missing defensive check. It predates this diff, but directly violates the requested response-only-operation freshness invariant and needs the same ownership protections. It does not restore a script directly; it can restore a stale operation or delete a newer script.
- No fallback logging was introduced. The handler returns fallback only to the caller; logging uses safe result codes. The existing backend logging assertions cover the fallback path. No module-namespace `jest.spyOn` was added; the inspected existing spy targets a service instance.
- Ran the two permitted targeted Jest commands sequentially. Frontend result confirmed: **23/23 passed**. The backend command was invoked, but its result was not retained in the visible tool output, so this review does not independently certify its test count; the fixer's report records 62/62. No test was rerun to recover output. New edge cases above were established by code-path inspection, not added executable tests.

## Not checked

- P4 findings 3–4, other phase requirements, and unrelated changes.
- Full suites, builds, installs, e2e, npm run verify, and additional type/lint checks.
- Live Electron transport timing or end-to-end concurrent UI interactions; no source/spec files were edited and no git state-changing commands were run.
