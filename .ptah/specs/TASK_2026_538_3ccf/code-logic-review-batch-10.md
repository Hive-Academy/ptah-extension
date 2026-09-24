# Code Logic Review — TASK_2026_538_3ccf

Verdict: NEEDS_REVISION

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 1 |
| Failure modes found | 2 |

Scope: Batch 10 only. All eleven named source/spec/barrel files were read in full, along with the requested Batch 10 task and carry-forward notes, Component 10, Q4, R13, requirements 6/7/8/10, both architectural appendices, executor report and Batch 9's final approved disposition. Supporting store, ledger, concurrency, binding, formatting, reader, delivery and logging paths were traced. No existing code-style-review.md was present. No AGENTS.md or CLAUDE.md covering these paths was found; CONVENTIONS.md and the supplied project guidance were consulted.

Path shorthand below: **S** = libs/backend/vscode-lm-tools/src/lib/surface; **D** = libs/backend/vscode-lm-tools/src/lib/di; **C** = libs/shared/src/mcp-apps-contracts. All line numbers refer to this worktree.

The implementation follows the principal mutation, revision, routing and delivery contracts, and the scoped regression suites pass. The score is 6 rather than 7 because a logging dependency failure can leave an operation permanently pending after its side effect, or lose a submit ticket before dispatch. It is above the significant-problems band because ordinary concurrency, replay, expiry, eviction forwarding and host composition checks hold. The second defect concerns supported small byte caps, not a demonstrated failure at the production default.

## Five logic questions

### 1. How does this fail silently?

- **F1:** after a UI change commits and pushes, logging can throw before gate.apply settles its operation. Subsequent retries and status reads return pending indefinitely despite the committed value. Evidence: S/surface-state.service.ts:586, :625, :635; the ledger never expires pending records at S/surface-operation-ledger.ts:443.
- **F2:** settlement can return applied without a revision while the original surface remains at its old revision with lastSubmit null. Only a warning exposes the failed metadata write. Evidence: S/surface-state.service.ts:355, :357, :375. Applied correctly describes runtime acceptance, but does not fulfil the promised same-incarnation metadata commit.

### 2. What user action produces unexpected behaviour?

- A submit coinciding with an output-channel write failure reserves its operation and ticket bytes but throws before returning the dispatch ticket. A fresh submit then reports busy, and retrying the original returns pending. S/surface-state.service.ts:285, :298, :303, :270. See F1 reproduction.
- Under a small configured store limit, submitting a valid form can fail to update the last-submit display despite an applied outcome. S/surface-state.service.ts:351; see F2.
- Ordinary racing UI and agent actions obey Q4: the agent requires exact current revision while a UI change can cross disjoint data writes. S/surface-agent-mutations.ts:179; S/surface-ui-mutations.ts:284. Existing race tests and independent floor/wildcard checks passed.

### 3. What input data produces a wrong answer?

- A valid card with a 128-character id, one checkbox and a submit action exposes insufficient settlement headroom when maxStoreBytes equals admitted surface + operation + ticket bytes. S/surface-ui-mutations.ts:460 accounts values and message, not the potentially larger eventual metadata/log delta. F2 reproduces this at 1,851 bytes.
- Invalid agent patches were rejected without changed state or pushes by the targeted suite: missing component, wrong bound value type and data-model overflow. S/surface-state.service.spec.ts:251; full-document validation occurs at S/surface-commit.ts:100.

### 4. What happens when a dependency fails?

- Host enumeration, rejected sends, false/malformed send results and partial delivery become failed delivery while the committed revision remains. S/surface-state.service.ts:665; delivery primitive at libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/dashboard-namespace.builder.ts:130, :157. Direct injected-failure checks confirmed this.
- Synchronous logger failures escape the mutation/reservation paths and can strand the ledger or suppress eviction notifications. The promise catch at S/surface-state.service.ts:676 protects asynchronous delivery logging only. F1 is reproduced.
- A send that never settles has no timeout in the existing delivery primitive (:157); this remains a pre-existing transport limitation, not a new Batch 10 finding. No timeout or real runtime dispatch was claimed as verified.

### 5. What is missing that the requirements never mentioned?

The implementation needs an explicit policy for observability failures inside state transitions and a reservation-to-settlement space guarantee. The plan says methods do not throw and same-incarnation applied/indeterminate submissions commit metadata, but does not detail either mechanism. S/surface-state.service.ts:298, :355 and S/surface-ui-mutations.ts:460 expose those gaps.

Batch 11 must distinguish turn outcome from surface metadata outcome, including a valid applied submit with no surface revision. It must never redispatch merely because revision is absent.

## Failure modes

### F1 — SERIOUS: synchronous logging interrupts committed or reserved operations

- Trigger: logger.info or logger.warn throws during a surface state transition, for example an output-channel write failure.
- Symptom: an exception replaces the typed result; status/replay can remain pending forever; an undispatched submit retains ticket bytes and makes subsequent submits busy.
- Evidence: S/surface-state.service.ts:298 logs after ticket reservation and before ticket return; :586 logs after store.commit and publish but before UI gate.apply (:635), or submit ledger settlement (:371). Eviction logging at :646 precedes each eviction push. Orphan settlement logging at :363 also precedes ledger settlement.
- Current handling: no synchronous error boundary at these sites. The publish promise catches its own asynchronous logging failure (:676), which cannot catch the other calls.
- Recommendation: make observability nonthrowing at this boundary. Preserve ledger settlement and return the truthful committed outcome even when logging fails. Ensure every already-performed eviction is published independently of logging. For failures before dispatch, release reservations and terminally settle the operation unless a dispatch ticket is successfully returned.

This is a supported dependency failure, not an assumption that all loggers throw: the real Logger.info delegates to log at libs/backend/vscode-core/src/logging/logger.ts:134, logWithContext calls writeLogEntry at :200, and writeLogEntry calls OutputManager.write at :269. OutputManager.write explicitly rethrows appendLine failures at libs/backend/vscode-core/src/api-wrappers/output-manager.ts:147, :151.

**Executed reproduction:** real SurfaceStateService, ledger, store, reader, contract validators/formatters and delivery primitive, transpiled in memory. Only the logger/host/clock/nonce seams were supplied. Create a validated surface with name and other text inputs and a card submit action. Inject an info function throwing Error('output channel write failed') for the named call, then restore it before querying/retrying.

| Call receiving the logging fault | Actual state after the exception | Retry / next action |
| --- | --- | --- |
| change at revision 1 | revision 2, changed value committed, two total pushes including create, operation pending | identical retry returns pending |
| beginSubmit at revision 1 | revision 1, 409 ticket bytes retained, operation pending, no dispatch ticket returned | identical retry pending; new submit busy |
| settleSubmit(ticket, applied) | revision 2, lastSubmit.status applied, ticket bytes released, operation pending | identical submit retry pending |

Core reproduction sequence, using the fixture setup described above:

~~~ts
const id = 'op-1800000000000-review000001';
const logger = { info() {}, warn() {}, debug() {} };
const service = new SurfaceStateService(logger, provider, {
  clock: () => 1800000000000,
  createNonce: () => 'nonce-0123456789abcdef',
});
service.applyAgentUpdate('tab', { operation: 'create', surface }, 'create');
logger.info = () => { throw new Error('output channel write failed'); };
try {
  service.change('tab', {
    surfaceId: 's', componentId: 'name', revision: 1,
    operationId: id, value: 'Grace',
  });
} catch {}
logger.info = () => {};
// service.read('tab', 's'): revision 2, name 'Grace'
// service.operationStatus('tab', id): { status: 'pending' }
~~~

No source or reproduction files were written. Add persistent tests for these three interruption points and for an eviction log failure.

### F2 — MODERATE: ticket admission does not guarantee settlement metadata fits

- Trigger: a supported small maxStoreBytes admits a ticket whose values/message cost is smaller than the eventual lastSubmit plus write-log growth.
- Symptom: runtime outcome is applied, but the same live surface gets neither the promised revision increment nor lastSubmit/push.
- Evidence: S/surface-ui-mutations.ts:460 reserves values + formatted message only; :470 builds additional last-submit metadata. S/surface-state.service.ts:320 releases the reservation, :351 attempts commit, :355 accepts the possibility of refusal, and :375 returns applied without a revision. S/surface-state.store.ts:197 refuses the larger record plus ledger charge.
- Current handling: logs the refusal and truthfully settles the turn outcome, but silently omits the required surface metadata from the caller's result. The executor's claim that revision is absent only for a gone/recreated surface is therefore inaccurate (batch-10-report.md:95).
- Recommendation: reserve enough headroom before dispatch for both the live ticket and the eventual record/log delta, and preserve that guarantee through intervening writes. Alternatively, explicitly revise the contract to expose a metadata-write failure separately; do not turn a successfully dispatched turn into rejected or authorize redispatch.

**Executed reproduction:** one validated surface with a card id of 128 'a' characters, title C, action { id: 'send', action: 'surface.submit', label: { text: 'S' } }, and one checkbox { id: 'c', label: 'C', path: 'c' }; empty dataModel. Surface id s, title S, contract/catalog version 2. Clock 1800000000000, nonce nonce-0123456789abcdef, operation id op-1800000000000-review000001.

1. Probe a default service: create the surface, begin the submit, record usage.totalBytes = 1851.
2. Create a fresh service with storeLimits.maxStoreBytes = 1851 and the same fixture.
3. beginSubmit returns dispatch.
4. settleSubmit(ticket, { status: 'applied' }) returns { status: 'applied', operationId }.
5. The surface is still present at revision 1 with lastSubmit null.
6. Warning: surface needs 909 bytes; cap 1851; 1024 reserved. Thus 1933 bytes are needed, 82 above the admitted cap.

This is an uncommon configuration edge. The default 24 MiB cap was not shown to fail: bounded ledger/ticket charges leave substantially more room for a single record. Two initial experimental fixture attempts were rejected (missing card title and an invalid operation-id suffix); only the validated, admitted case above supports this finding.

## Blocking issues

None.

## Serious issues

### F1 — Logging must not break mutation completion

- File: S/surface-state.service.ts:586, :298, :363, :646.
- Scenario: output-channel failure during change, submit reservation, settlement or eviction notification.
- Impact: callers receive exceptions after side effects; operation status is permanently wrong, or submit becomes permanently busy with retained ticket bytes.
- Fix: isolate logging from transition control flow, guarantee terminal bookkeeping after committed effects, and test failure injection at each demonstrated interruption point. Do not blanket-return rejected after an effect already occurred.

## Moderate and minor issues

- **F2 (Moderate):** S/surface-ui-mutations.ts:460 and S/surface-state.service.ts:355 — reserve settlement headroom or explicitly represent metadata failure. Reproduced under a supported small cap.
- No separate style/naming findings or duplicate counts. The Batch 11 contract recommendation below is a carry-forward, not an additional failure mode.

## Data flow

1. Trusted routing id + validated agent input -> scoped store lookup -> exact-base plan: **OK**, S/surface-state.service.ts:191 and S/surface-agent-mutations.ts:179. Trusted RPC/MCP context extraction remains later-batch work.
2. UI request -> canonical fingerprint -> scoped ledger reservation with store.makeRoom admission: **OK**, S/surface-state.service.ts:609 and S/surface-operation-gate.ts:61. Store is constructed with charges: ledger at service :170. The callback makes no nested reservation.
3. Conflict checks -> apply -> whole-document validation -> selection revalidation -> current + 1 -> log append: **OK**, S/surface-commit.ts:97, :100, :102, :103, :119.
4. Atomic store commit -> one publish site -> commit eviction list: **OK in normal execution**, service :574, :576, :585, :662. Logging exception interrupts completion/eviction notification: **F1**.
5. makeRoom eviction list -> facade publishEvictions; reserveTicket list -> same path: **OK in normal execution**, service :268, :297, :620. Existing tests cover all three sources at S/surface-state.service.submit.spec.ts:408, :445, :462.
6. Explicit delete -> retiredRevision -> deleted push; recreate above max(store high-water, retiredRevision): **OK**, service :504, :505, :458, :462. Direct check: create 1, delete 2, recreate 3.
7. Submit -> scoped validated primitive values -> frozen ticket -> nonce formatting -> reservation -> return dispatch: **OK normally**, S/surface-ui-mutations.ts:403, :416, :424, :431, :446. Logging can lose the ticket (**F1**); settlement headroom is insufficient under small caps (**F2**).
8. Settlement -> release ticket -> incarnation guard -> metadata commit -> terminal ledger result: **OK for ordinary change/replace/delete/recreate/eviction**, service :320, :344, :371; UI planner :493, :498. F1/F2 identify interruption/refusal gaps.
9. Scoped reads/status -> caller: **OK**, service :398, :410, :418. Cross-routing lookups do not expose another tab's records.
10. DI singleton + lazy host lookup: **OK**, D/register.ts:116, :127; tests at D/register.spec.ts:287, :301, :325. Public exports present at src/index.ts:93.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Req 6 host-resolved inputs/actions and staleness | COMPLETE for Batch 10 | UI planner :274, :284, :340, :403; trusted RPC validation/authorization remains Batch 11 |
| Req 6.4/6.5 replay, conflict, expiry, terminal status | PARTIAL | Normal paths pass; F1 leaves reserved operations pending after effects |
| Req 7.1 current state/revision before success | PARTIAL | Ordinary commits pass; F2 omits same-incarnation submit metadata |
| Req 7.2/7.6 bounds and all eviction notifications | PARTIAL | Accounting/admission integration passes; F1 can interrupt eviction notifications |
| Req 7.3 coding tabs and cross-tab isolation | COMPLETE for facade | Service spec :447 and :664; no surfaceMode gate |
| Req 7.4 singleton and lazy delivery host | COMPLETE for Batch 10 | D/register.ts:116, :127; full host MCP/RPC composition belongs to later batches |
| Req 7.5 selection validated against stored copy | COMPLETE | UI planner :334; service spec :486 |
| Req 8.1/8.2 create/replace/patch/delete; invalid patches atomic | COMPLETE for facade | Agent planner :203; commit :100; service spec :183, :251 |
| Req 8.6 state and delivery outcome separated | COMPLETE for agent facade | service :550, :665; failed-send checks preserve revision |
| Req 8.7 v1 envelope revision retained | COMPLETE | agent planner :279; service spec :343 |
| Req 10 scoped immutable submits and one operation | PARTIAL | Normal replay/busy/incarnation paths pass; F1/F2 violate failure completion |
| Q4 asymmetric staleness/current + 1 | COMPLETE | Agent planner :179; UI planner :284; commit :103; independent floor/wildcard checks pass |

Implicit requirements not addressed: nonthrowing observability during bookkeeping and guaranteed settlement capacity (F1/F2).

## Seven plan deviations

| Deviation | Judgment and evidence |
| --- | --- |
| 1. Two extra helper files | Accept. Commit planning and ledger gate remain behind the facade, with no independent push sites: S/surface-commit.ts:88; S/surface-operation-gate.ts:55; S/surface-state.service.ts:662. |
| 2. Optional options token local to the service | Accept behaviorally. Production omission uses defaults, injected options enable bounded tests: service :161, :164, :176. Token placement is a style concern. F2 concerns behavior under the supported override. |
| 3. Deletion high-water in facade; eviction uses high-water | Accept. Explicit deletion is current + 1 and recreate is strictly above both marks: service :505, :462. Eviction :644 carries a high-water removal marker, not necessarily victim revision + 1. Keep this distinction in the renderer handoff: the plan specifies deleted removes the view (implementation-plan.md:894), so consumers must not assume every eviction is a new per-surface commit. No current renderer defect is alleged. |
| 4. Optional revision on applied submit | Accept the orphan semantics, require a Batch 11 contract update. Service :375 and UI outcome :84 correctly avoid inventing a revision for a deleted/recreated surface. F2 shows omission is currently broader than the report claims. |
| 5. resolveAction and usage reads | Accept. resolveAction returns the stored allowlisted action kind and current revision; usage is accounting only: service :431, :444, :450. |
| 6. Separate registration log | No behavioral issue found; both registrations execute before the summary: D/register.ts:122, :127, :131. Logging style is outside this review. |
| 7. SurfaceAction['action'] type | Accept. It preserves the declared union without adding runtime behavior: service :129. |

**Batch 11 recommendation for deviation 4:** define a submit result that permits applied/indeterminate with no committed surface revision; preserve terminal outcome and operation id through surface:action, operationStatus and replay. Prefer an explicit surface-state disposition (updated with revision, gone/recreated, or metadata unavailable) rather than fabricating the request/current revision. Keep change/select applied results revision-bearing. Add contract tests for delete, eviction and recreate while dispatch is unresolved, asserting exactly one dispatch, terminal replay, no modification of a replacement incarnation, and no automatic redispatch. Resolve F2 or represent its metadata failure distinctly. The RPC surface types are not present yet; this is a handoff, not a claim that Batch 11 is already broken.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Two same-tick commits | YES | service spec :628 sees revisions 2, 3 in order | Guarantee assumes the same host and ordinary non-reentrant adapters |
| Old disjoint UI base | YES | service spec :469 commits current + 1 | Agent still requires exact current |
| Write-log floor / wildcard | YES | Direct checks: base 1 stale after 33 writes, base 2 accepted at revision 35; 17-path write stales disjoint old UI request | None found |
| Invalid/missing-id/oversize patch | YES | service spec :251, unchanged view/push count | No new boundary schema claimed |
| Same id in different tabs | YES | service spec :236, :447 | Trusted context extraction later |
| Replay after deletion/recreate | YES | Direct check returns old applied outcome without touching new surface | Batch 11 optional-revision contract |
| Expired id with real charging | YES | After retention+1, operation-expired and chargedBytes 0 | No redispatch |
| Settlement after change/replace | YES normally | submit spec :328 | F1 under logger failure |
| Settlement after delete/eviction | YES normally | submit spec :358; direct recreate check | No lastSubmit restoration |
| All three eviction sources | YES normally | submit spec :408, :445, :462 | F1 if synchronous eviction logging throws |
| Output-channel write failure | NO | Exception with pending operation; begin retains 409 ticket bytes | F1 |
| Tight valid configured byte cap | NO | Dispatch admitted at 1851; settlement needs 1933 | F2 |
| Host missing/throws/rejects/partial/malformed send return | YES | Direct checks: no-surface or failed; committed revision remains 1 | Never-settling send remains a transport limitation |

## Verification and reproductions

- Scoped ptah_get_diagnostics for the facade and DI registration: **0 errors, 0 warnings**, typescript-compiler source.
- Ran once:
  npx nx run-many -t test -p @ptah-extension/vscode-lm-tools --skip-nx-cache --output-style=static --runInBand --testPathPatterns='surface-state.service|register.spec|surface-operation-ledger|surface-state.store|surface-push'
- **6 suites / 90 tests passed.** Nx reported success. Executor deprecation and module-loading warnings were printed; no test failure.
- Independent in-memory checks used real state classes, validators, formatting and delivery primitive with deterministic external seams. They reproduced F1/F2 and confirmed expiry, log floor/wildcard, recreate/replay and delivery error outcomes. They are not persistent regression tests.
- No build, workspace-wide check, git operation, source edit or extra deliverable. Only this review was written. Output was escaped; no raw U+2028/U+2029 was printed.
- Residual scope: runtime submit acceptance, RPC wire schemas, MCP entry points and host-specific end-to-end composition await later batches. The passing suites do not establish those behaviors.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the two reproduced failure modes and the scoped regression evidence.
- Top risk: a routine observability failure can strand a submit or leave a committed operation permanently pending.
- What a robust implementation would add: nonthrowing logging around every state transition, guaranteed bookkeeping after effects, failure-injection regressions, settlement headroom for configured byte caps, and the explicit Batch 11 submit result contract above.


---

# Re-review after revision round 1

# Code Logic Review — TASK_2026_538_3ccf

Verdict: APPROVED

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 open |

**F1 and F2 are closed.** This re-review covers Batch 10 revision round 1: the nonthrowing logger, its facade/gate/delivery wiring, eviction/log ordering, submit settlement headroom and regression tests. The original review remains in code-logic-review-batch-10.md. The requested Revision 1 report was read, and the revised implementation and failure spec were read in full against the previously reviewed contracts.

Path shorthand: **S** = libs/backend/vscode-lm-tools/src/lib/surface; **C** = libs/shared/src/mcp-apps-contracts. Line numbers refer to the current worktree.

The score rises from 6 to 8 because both reproduced defects now have correct outcomes, the accounting proof holds through intervening writes, and the original scoped regression selection remains green. This is sound local behavior, not an exemplary whole-feature verdict: real RPC/MCP/runtime composition still belongs to later batches, and a nonblocking reservation-accounting comment needs updating.

## F1 closure — logging no longer interrupts transitions

S/surface-log.ts:18 catches synchronous errors from each wrapped call. The wrappers at :33 preserve the original logger receiver and guard info, warn and debug. The facade wraps the injected logger at S/surface-state.service.ts:167 and passes that wrapper to the operation gate at :176 and delivery at :670. No facade mutation uses the original logger directly.

The original interruption points now use guarded logging: submit ticket return at service :302, commit completion at :591, orphan settlement at :368 and failed-delivery reporting at :673. Every eviction is published before its log at :651 and :658. UI commits can therefore reach gate.apply (:640), and submit settlement can reach the terminal ledger writes (:376, :384), despite a failing output channel.

Persistent regressions: S/surface-state.service.failure.spec.ts:103 (change, replay and rejection), :137 (ticket return, settlement, release and next submit), :174 (orphan), :204 (eviction).

Independent executions used the real facade, store, ledger, contract validators/formatters and delivery primitive, transpiled in memory. Only logger, host, clock and nonce seams were supplied. The logger threw Error('output channel write failed') from info, warn and debug while each named path ran.

| Original reproduction / added check | Current result |
| --- | --- |
| change from revision 1 with throwing logger | applied at revision 2; ledger applied at 2; identical replay applied at 2; pushes [1, 2] |
| beginSubmit with throwing logger | returns dispatch ticket; subsequent settlement applied at 2; reservation released |
| settleSubmit(applied) with throwing logger | lastSubmit written; ledger applied at 2; replay applied; reservation released |
| Next submit after each applicable completion | dispatch, not permanently busy |
| Commit eviction with throwing logger | a:snapshot, b:snapshot, a:deleted, in that order |
| Missing host with throwing debug logger | no-surface, without exception |
| Failed delivery with throwing warn logger | failed with delivered 0 / surfaces 1, without exception |
| Orphan after delete, recreate or eviction with throwing logger | terminal indeterminate; no revision; ticketBytes 0 |

No reproduction left an operation pending after a completed effect. Deliberately dropped log writes do not change the operation outcome; this is the intended fix, not swallowed business failure.

## F2 closure — settlement growth is reserved before dispatch

### Original 1,851-byte case

Reused the original validated fixture: surface s/title S; card id consisting of 128 'a' characters/title C; submit action send/label S; one checkbox c/path c/label C; empty model. Clock 1800000000000, nonce nonce-0123456789abcdef and operation id op-1800000000000-review000001.

At maxStoreBytes = 1851, beginSubmit now returns rejected / too-many-operations **before dispatch**. It reports that another 711 bytes cannot be reserved. The surface remains revision 1; ticketBytes = 0; ledger status is rejected; identical retry returns the recorded rejection. Usage is 527 surface + 1024 ledger = 1551 bytes. This closes the old admitted-then-lost-metadata scenario; closure does not require the formerly insufficient cap to admit the submit.

### Admitted and intervening-write cases

| Case | Result |
| --- | --- |
| Same fixture at newly probed exact admission cap, 2262 bytes | 711 bytes reserved; applied settlement at revision 2; lastSubmit present; ticketBytes 0; final usage 1933 |
| Same fixture, pending ticket plus checkbox change fills cap exactly, 3350 bytes | change at 2; indeterminate settlement at 3; checkbox remains true; lastSubmit present; ticketBytes 0; final usage 3028 |
| 24 real prepareOpsCommit comparisons across log lengths 0/1/31/32, revision digit boundaries and both terminal statuses | headroom 411 bytes; maximum measured record growth 407 bytes |
| Valid 50-input form with 128-character component ids and 500-character values | reservation 94431 bytes; applied settlement at revision 2 |

Persistent F2 regressions are at S/surface-state.service.failure.spec.ts:238 and :258. The independent execution additionally pinned the original fixed 1851 cap rather than only probing a larger cap.

### Why the bound holds

At S/surface-ui-mutations.ts:478, headroom H is:

- The exact ticket's last-submit record serialized with the longer status, indeterminate, and a maximal safe-integer timestamp (:479).
- One submit-record log entry with a maximal safe-integer revision, plus a comma (:484, :488).

Ticket values, ids and base revision are fixed; values and ticket are frozen at :371 and :446. The record serialized for H has all the same metadata keys as the eventual record at :492. Production Date.now timestamps and valid host revisions fit the safe-integer numeric allowance.

Settlement changes neither content nor selection: it applies only set-last-submit (:530). S/surface-commit.ts:103 advances the record revision, which is not part of the store's byte sum (S/surface-state.store.ts:319); :119 appends the write-log entry. Replacing an existing lastSubmit costs no more than adding the full new one. A non-full log adds at most the bounded entry plus comma. At a full log, dropping an entry also updates the floor (C/surface-concurrency.ts:121): the possible floor digit growth is smaller than the removed serialized entry, so this still fits the conservative allowance. The boundary comparisons above exercised both cases.

The reservation R is values + message + H at S/surface-ui-mutations.ts:460, hence R >= H. Before settlement, the store invariant is:

~~~text
current surface bytes + other surface bytes + other fixed charges + R <= cap
~~~

The reservation remains non-evictable through every intervening commit and admission: S/surface-state.store.ts:196, :256, :289. Settlement releases R at S/surface-state.service.ts:325 before committing the same-incarnation record, whose growth is at most H. Thus:

~~~text
new total <= old total - R + H <= cap
~~~

No await occurs between release and commit. This reasoning applies after a change or replacement as well as an unchanged surface; if the surface has disappeared or is a new incarnation, settlement intentionally writes no metadata. The remaining refusal branch at service :360 is defensive under these documented inputs.

### Reservation lifecycle

| Path | Evidence and result |
| --- | --- |
| Identical pending replay / conflict | service :273 returns before reserveTicket; operation gate :70 / :72; existing reservation is unchanged |
| Busy second submit | service :274 rejects before reserveTicket; the first ticket remains reserved |
| Invalid/stale/undeclared submit | service :287 returns before reserveTicket |
| Ledger admission refusal | service :273 returns before reserveTicket |
| Ticket-space refusal | service :295 terminally rejects; store :287 returns before inserting ticket at :289 |
| Applied / indeterminate / dispatch-rejected settlement | service :325 releases first; terminal outcome is then recorded at :335, :376 or :384 |
| Delete / recreate / eviction while pending | ticket remains charged until settlement; service :325 releases; planner :520 / :525 prevents writing an orphan snapshot |
| Repeated settlement | store.releaseTicket is idempotent at store :298; service :333 returns recorded terminal result |

Independent lifecycle executions observed unchanged 752-byte reservations for identical pending replay and busy refusal, then zero after applied, indeterminate and rejected settlement. Double settlement returned the same result. Invalid and ledger-capacity refusals retained no ticket bytes. The fixed-cap reproduction exercised ticket-space refusal. Delete/recreate/eviction settlements also released all ticket bytes.

## Five logic questions

### 1. How does this fail silently?

Neither original silent inconsistency remains: logging cannot strand terminal bookkeeping (service :167, :640), and insufficient settlement space is rejected before dispatch (:289, :295). The defensive metadata-refusal warning remains at :362, but no supported-input reproduction reached it with the new reservation.

### 2. What user action produces unexpected behaviour?

No new case found in this delta. Repeating a pending submit returns pending without another reservation (:273); a distinct submit while one is pending returns busy (:274); completed operations permit later submissions. Independent checks and the targeted suites establish these behaviors.

### 3. What input data produces a wrong answer?

The previous valid long-card-id fixture no longer produces applied without live-surface metadata. At 1851 bytes it is refused; at 2262 it settles at revision 2. S/surface-ui-mutations.ts:478 supplies the missing allowance. A larger valid form also settled successfully. One exploratory 99-child fixture was rejected by maxChildrenPerNode; it was not used as evidence for a production defect.

### 4. What happens when a dependency fails?

Synchronous logging failures are deliberately contained by S/surface-log.ts:20. Missing-host and failed-send results retain their delivery meaning with throwing debug/warn loggers because the wrapper reaches delivery at service :670. No new error is converted into an applied business result.

The existing delivery primitive's lack of a timeout for a never-settling host promise and failure of arbitrary clock/nonce replacements were not changed or certified by this revision.

### 5. What is missing that the requirements never mentioned?

No further runtime requirement gap was found in this delta. The new headroom makes ticketBytes a reservation total, not just retained values/message bytes; the old store capacity commentary should describe this accurately (minor note below). The previously identified Batch 11 wire-contract handoff remains required.

## Failure modes

No open runtime failure mode found in the revision. F1 and F2 were re-executed against the real state classes, not inferred closed from tests alone. Scope includes throwing logging, all settlement outcomes, orphan settlement, pending replay/busy, admission refusals, exact-cap growth and ordered eviction delivery.

Residual uncertainty: the later runtime acceptance boundary and RPC/MCP composition were not exercised; the headroom proof assumes ordinary non-reentrant infrastructure callbacks and valid safe-integer host time/revisions. No whole-feature runtime approval is implied.

## Blocking issues

None.

## Serious issues

None open. F1 closed.

## Moderate and minor issues

**Minor, nonblocking documentation correction:** S/surface-state.store.ts:24 still describes tickets as values + message only; :34 claims each reservation is at most 64 KiB and all 64 at most 4 MiB. The new reservation also includes headroom (S/surface-ui-mutations.ts:463), and a validated 50-input fixture reserved **94431 bytes**. Update this comment and the equivalent Component 10 accounting prose in implementation-plan.md:528 to distinguish retained ticket bytes from reserved settlement space and give a current bound.

Impact is inaccurate capacity documentation, not loss of the enforced 24 MiB total cap: every reservation still participates in store.makeRoom (:256), and the large-form settlement passed. This is not counted as a runtime failure mode or a reason to block Batch 10.

## Data flow

1. Injected logger -> one guarded wrapper -> facade/gate/delivery: **OK**, service :167, :176, :670; log :18.
2. UI reservation -> existing-id replay/conflict or ledger admission -> busy/validation checks: **OK**, service :261, :273, :274, :287. No new ticket is charged on these exits.
3. Frozen values -> formatted message -> exact-ticket headroom -> reserveTicket: **OK**, UI planner :424, :431, :460; service :289.
4. Reservation -> intervening surface commits/admissions: **OK**, non-evictable charge participates in store :196 and :256.
5. Settlement -> release reservation -> same-incarnation metadata commit -> ledger settlement: **OK**, service :325, :349, :376; UI planner :520, :525.
6. Store commit -> single publish -> all commit eviction pushes -> guarded logs: **OK**, service :579, :581, :590, :591.
7. makeRoom and reserveTicket eviction lists -> same ordered publish site: **OK**, service :272, :301, :625, :651. The logger now cannot cut the list short.

## Requirements fulfilment

| Requirement | Status | Evidence / remaining scope |
| --- | --- | --- |
| F1: logging cannot interrupt effects/bookkeeping | COMPLETE | log :18; facade wiring :167/:176/:670; direct fault injection and failure spec :103 |
| F1: every eviction still pushed | COMPLETE | service :651 before :658; ordered throwing-logger reproduction |
| F2: safe refusal before dispatch when cap is insufficient | COMPLETE | original 1851-byte reproduction; service :295 |
| F2: admitted same-incarnation settlement metadata fits | COMPLETE | UI planner :478; exact-cap and intervening-write reproductions |
| R13 replay/busy/refusal/terminal reservation lifecycle | COMPLETE for this delta | service :273/:274/:295/:325; direct lifecycle checks |
| Current + 1, routing isolation, atomic invalid patches, lazy DI host | COMPLETE for prior Batch 10 scope | unchanged paths exercised by the same scoped regression selection; initial review remains the detailed trace |
| Batch 11 optional revision contract | PENDING LATER BATCH | report handoff :148; no source/API change made in this review |

Implicit requirements not addressed: no additional runtime gap identified; capacity documentation needs the minor correction above.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Logger throws during change/begin/settle | YES | State and ledger complete; ticket returned/released | Failed log line is intentionally dropped |
| Logger throws during eviction | YES | Publish precedes guarded log | None found |
| Logger throws on no-host/failed-delivery path | YES | Original no-surface/failed result preserved | Existing transport timeout limitation unchanged |
| Fixed old 1851-byte cap | YES | Refused before dispatch; ticketBytes 0 | Ledger rejection remains charged for replay protection |
| Exact new admission cap 2262 | YES | Applied at revision 2 | Conservative reservation intentionally exceeds final growth |
| Intervening change fills cap 3350 | YES | Indeterminate at 3, changed value retained | None found |
| Full 32-entry log and floor growth | YES | Removed entry offsets floor growth; direct comparisons pass | Safe-integer revision assumption |
| Duplicate pending request / second submit | YES | Pending replay / busy, unchanged first reservation | Busy rejection adds its ordinary ledger charge |
| Validation / ledger / ticket refusal | YES | No ticket reservation retained | Terminal records retain their normal lifetime |
| Applied / indeterminate / rejected / double settlement | YES | Reservation released once; terminal replay stable | None found |
| Delete / recreate / eviction before settlement | YES | Terminal ledger, no orphan metadata, reservation released | No-revision wire outcome remains a Batch 11 concern |
| Large valid input set | YES | 94431 reserved bytes; settlement applied | Store comment's 64 KiB estimate is stale |

## Verification

- Targeted Jest: **7 suites, 96 tests passed**.
- Command:
  npx nx run-many -t test -p @ptah-extension/vscode-lm-tools --skip-nx-cache --output-style=static --runInBand --testPathPatterns='surface-state.service|register.spec|surface-operation-ledger|surface-state.store|surface-push'
- First attempt failed before tests because Nx plugin workers exited during graph setup. Re-ran the same selection with NX_DAEMON=false and NX_ISOLATE_PLUGINS=false; Nx reported success. This was an infrastructure retry, not a suite rerun to reread output.
- Scoped ptah_get_diagnostics: initially reported the compiler still running; one later request returned **0 errors, 0 warnings**.
- Direct reproductions loaded real TypeScript implementations in memory, using external dependency seams and actual validators. An initial harness invocation lacked its prior-turn in-memory setup and did not execute the cases; it was corrected before the successful runs recorded above.
- File line counts: facade 692; UI planner 536; operation gate 177; logger wrapper 37; failure spec 282; original facade specs 671 and 484; agent planner 306; commit helper 184; folder barrel 31. All inspected Batch 10 surface files are below 700.
- No build, workspace-wide test, source edit or git command. No raw U+2028/U+2029 printed. Only code-logic-review.md was written.

## Batch 11 carry-forward

Keep the Revision 1 handoff at batch-10-report.md:148: applied/indeterminate submit outcomes may lack a surface revision when the original incarnation is gone. Preserve terminal status and operation id through action results, status reads and replay. Never invent a revision or redispatch because it is absent; keep applied change/select results revision-bearing. F2 no longer requires a metadata-unavailable variant for ordinary admitted same-incarnation settlement, although retaining a defensive disposition is an architectural choice.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for F1/F2 closure and the scoped regression evidence.
- Top residual risk: later RPC/runtime handlers must preserve the terminal submit outcome when its surface is gone.
- What a robust implementation would add: update reservation-accounting documentation, retain the failure-injection and exact-cap regressions, and pin the Batch 11 no-revision outcome at the wire boundary.
