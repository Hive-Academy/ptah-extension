# Code Logic Review — `TASK_2026_538_3ccf`

## Summary

Verdict: NEEDS_REVISION

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 2 |
| Failure modes found | 3 |

Scope: Batch 11 only, reviewed 2026-09-24 in `D:/projects/ptah-extension/.claude-worktrees/feat-task-538-surface-contract-v2`. Read the named production files, both new specs, harness, registration specs, requirements/context, Batch 11 instructions/report, and Batch 10 handoff and carry-forward. Traced the committed surface service, ledger, store, schemas and dispatch path as dependencies. Concurrent Batch 13 work is not assessed. No source files or task states were edited; no git commands or builds were run. No existing `code-style-review.md` or applicable `AGENTS.md` was found; `CONVENTIONS.md` and the supplied repository guidance were used. Direct Ptah search and scoped diagnostics were used; native reads were necessary because no direct file-read tool was listed.

The score is in the 5–6 band because the normal and rejection paths work, but an unresolved dependency leaves a permanent reservation and there are two reproducible protocol inconsistencies. It is below 7–8 because recovery and operation identity are incomplete, and above 3–4 because validation, registration, ordinary replay, safe error classification, and orphan settlement have concrete passing evidence. No data corruption, duplicate dispatch, or routing authorization defect under the approved trust model was established.

## Five logic questions

### 1. How does this fail silently?

F1 leaves the operation looking perpetually in progress: `libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:288` awaits dispatch without a deadline; settlement and ticket release are unreachable while it stays unresolved. F2 returns a final-looking rejection without retaining its identity at `libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:224`, so a retry can receive a different reason. Neither is reported here as a false successful turn.

### 2. What user action produces unexpected behaviour?

After a stalled submit, pressing Submit again returns `busy` indefinitely (`libs/backend/vscode-lm-tools/src/lib/surface/surface-state.service.ts:274`). Reusing the id from an unsupported action for `send` dispatches instead of reporting `operation-conflict` (`libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:235`). Clicking a retained dashboard action from an older rendering returns `unsupported`, without the stale revision needed to refresh (`libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:226`). See F1–F3 and the executed reproductions below.

### 3. What input data produces a wrong answer?

A valid request with a stale `revision` and a declared non-submit action takes the unconditional branch in F3. A valid operation id previously used by a non-ledgered action can identify different content in F2. Unknown envelope keys, forged action parameters, invalid selection keys and denied data keys were rejected before state changes; relevant boundary code is `libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:390` and `libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.schema.ts:53`.

### 4. What happens when a dependency fails?

Missing submit runtime settles `session-unavailable`; unexpected dispatch rejection settles `indeterminate` with fixed text (`libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:301`, `:309`). The real submit service classifies typed admission refusal and other exceptions (`libs/backend/rpc-handlers/src/lib/chat/session/surface-submit-turn.service.ts:276`). The injected unresolved-promise case never reaches either branch (F1). This differs from a renderer timing out while the host later completes: that latter case correctly remains queryable and does not resend.

### 5. What is missing that the requirements never mentioned?

The plan specifies pending visibility and exception classification, but no dispatch lifetime or teardown/cancellation policy (`.ptah/specs/TASK_2026_538_3ccf/implementation-plan.md:696`, `:708`). The explicit review request requires no pending-forever/leaked ticket; F1 exposes that omission. The plan's instruction not to reserve unsupported actions (`implementation-plan.md:675`) also needs reconciliation with the broader stable-outcome and different-content-reuse contract (`task-description.md:237`). A trusted renderer's routing id is an explicit design decision, not a missing authorization check: `task-description.md:502` and `implementation-plan.md:763`.

## Failure modes

### F1 — Serious: unresolved dispatch permanently holds the submit reservation

- Trigger: the adapter's `sendMessageToSession` promise never resolves or rejects.
- Symptom: the original RPC never completes, operation queries and identical retries stay `pending`, all new submits for that routing id return `busy`, and the ticket remains charged even if the surface is removed.
- Evidence: `libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:288` and `:308`; `libs/backend/rpc-handlers/src/lib/chat/session/surface-submit-turn.service.ts:123`, `:127`, `:137`; ticket release occurs only at `libs/backend/vscode-lm-tools/src/lib/surface/surface-state.service.ts:325`. New submits are refused at that service's `:274`. `libs/backend/vscode-lm-tools/src/lib/surface/surface-operation-ledger.ts:439` only sweeps records with `forgetAt`, which is assigned on settlement at `:369`.
- Current handling: catch handles rejection, and finally releases the runtime guard only after the await finishes. There is no timer, abort path, or reconciliation hook. A client-side RPC timeout does not cancel this promise; `libs/backend/vscode-core/src/messaging/rpc-handler.ts:216` simply awaits the handler.
- Reproduction: the existing real-class harness was used with a deferred send. After advancing Jest timers by 86,400,000 ms: operation `{status:'pending'}`, next submit `{status:'rejected',reason:'busy'}`, `ticketBytes:795`, one send. Explicitly resolving the gate afterward caused settlement and `ticketBytes:0`. The harness has a fixed ledger clock; this experiment advances timers, not ledger age. Static inspection of the sweep proves that advancing ledger time would not expire a pending record either.
- Recommendation: define a bounded dispatch/reconciliation lifecycle. After dispatch begins, an uncertain deadline must produce `indeterminate`, never invented failure or automatic resend. Settle exactly once and release the surface ticket. Coordinate cancellation or fencing of any still-running send before freeing runtime admission; a bare `Promise.race` that forgets a live sender is insufficient. Observe late completion/rejection without a second settlement or dispatch. Test timeout, teardown, late resolution/rejection and deletion during timeout.
- Qualification: this is a reproduced dependency-failure gap, not evidence of a production hang. The current SDK's surface text-message path normally completes without external attachment I/O (`libs/backend/agent-sdk/src/lib/helpers/sdk-message-factory.ts:96`, `:158`). Revision 6 item 3 permits pending/unknown on a UI timeout; it does not prescribe an unsafe rollback or, by itself, a server deadline. The defect is the absence of any terminal recovery when the dependency actually remains unresolved.

### F2 — Moderate: non-ledgered action responses do not honor operation identity

- Trigger: obtain `unsupported`/`undeclared`, then retry that id after state changes or reuse it with different action content.
- Symptom: the same id can first report `unsupported` and then dispatch a submit with changed content; an identical undeclared retry changes from `undeclared` to `stale-revision` after an unrelated value change.
- Evidence: the ledger is consulted only for already recorded ids at `libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:219`; the other action exits at `:224`, `:226`, `:235` and `:347` create no record. This contradicts the unqualified outcome/reuse guarantee in `.ptah/specs/TASK_2026_538_3ccf/task-description.md:237`.
- Current handling: `surface:operation` returns `unknown` for these requests. Once a real submit is recorded, the protection works.
- Reproduction: request `{actionId:'act-0',operationId:K,revision:1}` returned `unsupported dashboard.refresh`; `{...same,actionId:'send'}` returned `applied`, revision 2, one dispatch; replaying the original request then returned `operation-conflict`. Separately, an identical `{actionId:'absent',operationId:J,revision:1}` changed from `undeclared` to `stale-revision/currentRevision:2` after a change.
- Recommendation: preserve a bounded terminal fingerprint/outcome for rejected actions without creating a dispatch ticket. Reconcile unsupported actions explicitly with the plan: either retain a terminal identity for them as well, or narrow the public operation-id guarantee to exclude these preflight responses and require a fresh id for a changed request. Do not claim that the current code satisfies the unconditional Req 6.4 wording.
- Safety assessment: no duplicate side effect was reproduced. Unsupported actions themselves have none, and an identical old request cannot become an accepted new submit after a declaration change without failing the submit revision check. Thus omitting these records is safe for at-most-once side effects under today's action mapping, but not for the stronger stable-result/different-content identity contract. This is a protocol gap, not a security finding.

### F3 — Moderate: declared dashboard actions bypass the revision check

- Trigger: mutate a surface, then invoke a still-declared `dashboard.*` action using the previous rendered revision.
- Symptom: ordinary dashboard actions return `unsupported`; `dashboard.select` returns `undeclared`. Neither returns `stale-revision` or `currentRevision`, so the caller cannot use the documented stale recovery path.
- Evidence: `resolveAction` supplies the current revision at `libs/backend/vscode-lm-tools/src/lib/surface/surface-state.service.ts:450`, but `libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:226` and `:235` ignore it. Only the undeclared branch calls the explicit revision check at `:339`; submit checks it in the state service. Req 6.3 is `.ptah/specs/TASK_2026_538_3ccf/task-description.md:233`.
- Current handling: strict validation establishes that revision is a positive integer, not that it is the accepted revision. No side effect occurs, which limits the impact.
- Reproduction: create revision 1, change `name` to obtain revision 2, call `act-0` at revision 1. Actual result: `{status:'unsupported',action:'dashboard.refresh',operationId:K}` without `currentRevision`.
- Recommendation: after honoring an existing ledger record, compare the declared action's `resolution.revision` with the request before returning the dashboard refusal/unsupported result. Return stale-revision/currentRevision for stale calls, keeping current-revision dashboard actions unsupported and side-effect-free. Add stale `dashboard.select` and unsupported-action cases.

## Blocking issues

None established. In particular, there is no evidence of a second dispatch for a recorded submit: `libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:286` returns replay before dispatch, and the existing concurrency/delete/recreate tests pass.

## Serious issues

### F1: dispatch has no terminal recovery for an unresolved dependency

- File: `libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:288`.
- Scenario: a send never settles.
- Impact: permanently disabled submit for the conversation and retained ticket/runtime guard.
- Fix: bounded, exactly-once indeterminate settlement plus safe cancellation/fencing and late-result handling, as specified in F1.

## Moderate and minor issues

- F2: `libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:224` — unrecorded outcomes permit id reuse and non-stable replay. Preserve terminal identity or explicitly revise the promised contract.
- F3: `libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:226` — declared dashboard branches ignore revision; check the supplied current revision before returning.
- Coverage note, not a separate failure mode: the delivered orphan specs cover delete/recreate (`libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.submit.spec.ts:189`) but not eviction. The reviewer executed an eviction case successfully. Preserve it as a regression test when addressing this review.

## Data flow

1. **OK — registration:** shared exports/imports at `libs/shared/src/lib/types/rpc.types.ts:39`, `:649`; five registry entries at `:2220`, five runtime entries at `:3853`; prefix at `libs/backend/vscode-core/src/messaging/rpc-handler.ts:90`; handler barrel at `libs/backend/rpc-handlers/src/lib/handlers/index.ts:13`; manifest at `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:148`.
2. **OK — boundary:** `surface-rpc.handlers.ts:390` measures UTF-8 JSON before `safeParse` at `:401`. All five schemas are strict (`surface-rpc.schema.ts:53`); nested selection is strict and data values are depth-bounded with raw denied-key checks (`libs/shared/src/mcp-apps-contracts/surface.schemas.ts:426`, `:448`, `:616`). These paths reject invalid input before mutation.
3. **OK under approved trust model — routing:** `surface-rpc.handlers.ts:159`, `:168`, `:210` use the renderer-supplied routing id. The host-owned renderer may address a known tab; no per-webview caller identity is supplied by `rpc-handler.ts:194`. This is expressly accepted in `task-description.md:502`. The test at `surface-rpc.handlers.spec.ts:175` proves absent-tab behavior, not isolation of two authenticated renderer principals. Do not broaden this trust assumption to third-party app frames.
4. **OK — change/select:** synchronous state-service mutation, revision-bearing result, no chat dispatch (`surface-rpc.handlers.ts:162`, `:178`, `:497`).
5. **F2/F3 — action resolution:** stored action allowlist at `surface-rpc.handlers.ts:210` is correct, but non-submit exits omit identity retention and revision comparison.
6. **OK until unresolved dependency — submit:** `beginSubmit` precedes dispatch; replay returns before it (`surface-rpc.handlers.ts:280`). Immutable scope/message come from the service. **F1** occurs at `:288`.
7. **OK when dispatch settles — settlement:** service checks incarnation and releases ticket (`surface-state.service.ts:325`, `:349`); wire mapping preserves `updated` or `not-recorded` without inventing a revision (`surface-rpc.handlers.ts:458`). Delete, recreate and reviewer-tested eviction preserve one dispatch and terminal replay.
8. **OK — status/read:** `surface-rpc.handlers.ts:257` preserves detail and separates rejected `currentRevision` from committed `revision`; `:159` returns full state. The operation status can omit revision for an orphan without authorizing resend.
9. **OK within examined error paths — error disclosure:** fixed dispatch failure text (`surface-rpc.handlers.ts:316`, `surface-submit-turn.service.ts:80`) and capped schema descriptions (`surface-rpc.handlers.ts:420`). Generic RPC infrastructure still returns unexpected `error.message` (`rpc-handler.ts:248`); no concrete normal surface-input path causing such an unsanitized dependency exception was established here, so this is not counted as a new defect.

## Requirements fulfilment

| Requirement | Status | Gap / evidence |
| --- | --- | --- |
| Req 6.1/6.7 allowlist and stored action/input mediation | COMPLETE | Handler `:210`; strict action params prohibit renderer-supplied action payloads at schema `:75` |
| Req 6.2 and 9.2 strict, bounded RPC inputs | COMPLETE | Handler `:390`, schema `:46`; delivered and reviewer nested-invalid cases pass |
| Req 6.3 stale / absent behavior | PARTIAL | F3; absent paths pass, dashboard staleness does not |
| Req 6.4/6.5 stable identity and queryable outcome | PARTIAL | Recorded mutations/replays work; F2 is the non-ledgered exception; F1 has no terminal recovery |
| Req 6.8 unsupported dashboard actions | COMPLETE | Handler `:235`, all six delivered cases pass |
| Req 9.1/9.3 registration | COMPLETE | Registry, allowlist and manifest wired; three host registry specs pass |
| Req 9.4 change never starts a turn | COMPLETE | Handler `:168`; delivered test `surface-rpc.handlers.spec.ts:210` |
| Req 9.5/9.6 full read and never create unknown state | COMPLETE | Handler `:159`; delivered read/not-found specs pass |
| Req 10 one scoped submit, safe rejection/indeterminate, no resend | PARTIAL | Normal and throwing paths pass; unresolved dependency leaves F1 |
| Batch 10 no-revision carry-forward | COMPLETE | Action mapping `:458`; delete/recreate delivered tests, eviction reviewer test |
| Batch 5 reject-reason guard | COMPLETE | `surface-submit-turn.service.ts:59` uses literal array with `satisfies readonly SurfaceRejectReason[]` |
| New main-barrel module stays zod-free | COMPLETE | `rpc-surface.types.ts:20` imports only plain surface types; AST import-closure check found five files, zero external imports |

Implicit requirements not addressed: bounded lifetime/reconciliation of an unresolved dispatch; explicit exceptions, if intended, to the operation identity and stale-revision contracts.

### Judgment of report deviations

The current report lists **seven**, not five, at `batch-11-report.md:150`. Its non-ledgered-action deviation is **4**; deviation 2 is the operation result extension.

| Deviation | Judgment |
| --- | --- |
| 1. Separate action result and two surface dispositions | Accept. `rpc-surface.types.ts:146` and handler `:458` represent the service's observable information honestly. `not-recorded` does not pretend to distinguish disappearance, replacement and defensive refusal. Change/select keep required revisions. |
| 2. Status detail and currentRevision | Accept. Handler `:257` exposes the ledger's safe detail and distinguishes a stale rejection's current revision from a committed revision; delivered stale-change test checks it at `surface-rpc.handlers.spec.ts:264`. |
| 3. Read/status do not require mutation fields | Accept. Schema `:53`, `:82` and types `rpc-surface.types.ts:33`, `:70` fit Req 9.5 and 6.5. Read does support optional surfaceId; status does not need it. |
| 4. Unsupported/select/undeclared not ledgered | Conditional only: safe for at-most-once side effects, but not Req 6.4's full identity guarantee (F2). Unsupported no-reservation matches the plan; broadening this to terminal rejections leaves unrecorded changing outcomes. Reconcile explicitly. |
| 5. Missing runtime settles rejected | Accept. Handler `:301` gives a terminal outcome and releases resources instead of stranding a ticket. |
| 6. File count and split specs/harness | Accept for logic. Harness `:162`, `:193`, `:200` instantiates real state, submit service and RPC handler. No production stub introduced. |
| 7. Inconsistent non-submit outcome mapping throws | Accept the invariant for applied-without-revision and indeterminate at handler `:497`; different operation kinds are fingerprinted. The report overstates the pending branch: implementation `:510` forwards pending rather than throwing. This discrepancy currently has no demonstrated reachable normal change/select path and is not counted as a defect. |

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Missing/null/unknown params, excessive bytes | YES | Byte check then strict schema | No mutation on rejection |
| Nested selection unknown key / raw denied object key | YES | Reviewer executed both; INVALID_PARAMS | No state revision change |
| Unknown tab or surface | YES | Not-found; no created state | This is not per-renderer authentication |
| Duplicate submit concurrent/later | YES | Pending/terminal ledger replay | Delivered test `surface-rpc.handlers.submit.spec.ts:31` |
| Delete/recreate while pending | YES | Terminal outcome, not-recorded, no replacement mutation | Delivered tests at submit spec `:207`, `:242` |
| Eviction while pending | YES | Reviewer forced eight new surfaces, terminal replay, ticketBytes 0 | Add lasting regression coverage |
| Dispatch throws/rejects | YES | Fixed indeterminate; one settlement | Reviewer injected direct dispatch throw too |
| Dispatch never settles | NO | No deadline/cancellation/reconciliation | F1 |
| Reuse non-ledgered action id / identical rejected retry | NO | Re-evaluated from current state | F2 |
| Stale declared dashboard action | NO | Unsupported/undeclared bypasses revision | F3 |
| Process restart | NO, intentionally | Store/ledger are in memory | Requirement explicitly excludes restart idempotency (`task-description.md:243`) |

## Verification and reproductions

Executed once, with `NX_DAEMON=false` and `NX_NO_CLOUD=true`:

```powershell
npx nx run-many -t test -p @ptah-extension/rpc-handlers ptah-electron ptah-extension-vscode @ptah-extension/cli-engine --excludeTaskDependencies --testPathPatterns='surface-rpc.handlers|rpc-surface.spec' --runInBand --outputStyle=static
```

Result: **5 suites / 54 tests passed** (38 surface handlers, 2 Electron, 2 VS Code, 12 CLI). `--excludeTaskDependencies` avoided the hosts' build dependencies. No build ran. Scoped `ptah_get_diagnostics` for the new handler and RPC type files returned TypeScript compiler availability, 0 errors and 0 warnings. This review did not rerun broader suites or lint; batch report claims are not counted as independently executed checks.

Seven additional assertions ran against the real classes through the existing harness, in two narrowly filtered Jest runs of `surface-rpc.handlers.submit.spec.ts` (`testNamePattern: REVIEW_REPRO` / `REVIEW_REPRO_EXTRA`, `testPathPatterns` retained, cache disabled). A process-local `fs.readFileSync` wrapper appended test source in memory; the on-disk spec and production source were not changed. The initial reproduction attempt failed TypeScript checking because the review snippet used dot access on a Record; correcting the snippet to bracket access yielded **4 passing** reproductions. The second run yielded **3 passing** validation/eviction/throw checks. PowerShell wrapped Jest's stderr summary as `NativeCommandError` and reported wrapper exit 1; Jest itself reported both suites passed. Do not confuse those wrapper exits with a failing product assertion.

To reproduce F1–F3 using imports already present in the submit spec:

```ts
// F1
jest.useFakeTimers({ doNotFake: ['setImmediate'] });
const t = setup(), revision = t.create(), gate = deferred();
t.sendMessageToSession.mockImplementationOnce(async () => gate.promise);
const p = { ...t.base(revision), actionId: 'send' };
const first = t.ok('surface:action', p);
await flush();
await jest.advanceTimersByTimeAsync(86_400_000);
expect(await t.ok('surface:operation', {
  routingId: TAB, operationId: p.operationId,
})).toEqual({ status: 'pending' });
expect(t.state.usage().ticketBytes).toBe(795);
expect(await t.ok('surface:action', {
  ...t.base(revision), actionId: 'send',
})).toMatchObject({ status: 'rejected', reason: 'busy' });
gate.resolve(); await first;
expect(t.state.usage().ticketBytes).toBe(0);
jest.useRealTimers();

// F2, fresh harness
const u = setup(), r = u.create();
const q = { ...u.base(r), actionId: 'act-0' };
expect(await u.ok('surface:action', q)).toMatchObject({ status: 'unsupported' });
expect(await u.ok('surface:action', { ...q, actionId: 'send' }))
  .toMatchObject({ status: 'applied' }); // same id, different content
expect(u.sendMessageToSession).toHaveBeenCalledTimes(1);

// F3, fresh harness
const v = setup(), old = v.create();
await v.ok('surface:change', { ...v.base(old), componentId: 'name', value: 'Grace' });
expect(await v.ok('surface:action', { ...v.base(old), actionId: 'act-0' }))
  .toMatchObject({ status: 'unsupported' }); // no stale-revision/currentRevision
```

The exact 795-byte charge is fixture-specific; the durable assertion should be positive and unchanged while stalled. Additional executed checks confirmed that an identical undeclared action changes rejection reason after an unrelated input change, eviction returns `not-recorded` with one dispatch, a directly rejected `dispatch` returns fixed indeterminate text, and nested invalid selection/data payloads produce INVALID_PARAMS.

The zod-free check walked TypeScript import/export declarations from `rpc-surface.types.ts`, following relative modules. Its closure was `rpc-surface.types.ts`, `surface.types.ts`, `surface-catalog.ts`, `dashboard-catalog.ts`, `dashboard-spec.types.ts`: zero external imports, hence no new zod path. This is scoped to the new module; the unrelated pre-existing main-barrel zod edges accepted in `context.md:88` remain outside this batch.

## Verdict

- Recommendation: REVISE.
- Confidence: HIGH in the reproduced protocol/resource behavior; MEDIUM in the frequency of a production dispatch stall, which was injected rather than observed in a live host.
- Top risk: an unresolved dispatch retains a ticket and prevents every subsequent submit for that conversation until the dependency settles or the host restarts.
- What a robust implementation would add: safe terminal recovery for unresolved dispatch, explicit terminal identity semantics for preflight action responses, revision checks before dashboard action refusals, and durable timeout/eviction/reuse regression tests.

Verdict: NEEDS_REVISION


---

# Re-review after revision round 1

# Code Logic Review — `TASK_2026_538_3ccf`

## Summary

Verdict: APPROVED

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 remaining; F1–F3 closed |
| Minor observations | 1 documentation correction |

Scope: Batch 11, Revision 1, reviewed on 2026-09-24. This supersedes the verdict in `code-logic-review-batch-11.md`. Read the revised production files and tests in full, the Revision 1 report, original requirements and handoffs, and the real surface ledger/store and SDK admission path. Rechecked the original RPC boundary and registration invariants. Concurrent Batch 13 code-execution changes are excluded.

The score is in the 7–8 band because all three reproduced defects are closed, including adversarial deadline and capacity cases. It is above 5–6 because no unresolved lifecycle or operation-identity defect remains. It is below 9–10 because the documented admission guarantee overstates what the implementation provides, and the unresolved-send lifetime still has an explicit limitation: the surface operation terminates, but the underlying send is not cancelled. The caller is correctly told it may still start a turn.

No source files, task states or git state were edited. No builds were run. Only this deliverable was written. Native file reads were used because no direct Ptah file-read tool was listed. Scoped Ptah diagnostics were requested, but the provider twice reported unavailable because its compiler check had not completed; this review does not claim a clean diagnostic result.

## Five logic questions

### 1. How does this fail silently?

No remaining success-looking failure was reproduced. A send that never answers becomes `indeterminate`, not success or invented failure, at `libs/backend/rpc-handlers/src/lib/chat/session/surface-submit-turn.service.ts:191`. The handler then settles at `libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:288`, and the state service releases the ticket at `libs/backend/vscode-lm-tools/src/lib/surface/surface-state.service.ts:333`.

The timeout does not prove that the message was never sent. This is explicit in the fixed client detail at `surface-submit-turn.service.ts:101`. A late send result is logged, without replacing the terminal operation result (`surface-submit-turn.service.ts:316`).

### 2. What user action produces unexpected behaviour?

After one submit times out, a different new submit can be accepted. If the old send's preparation resumes while the new turn is queued or running, the real pump refuses it as busy. If it resumes after the new turn ends, the old send can be queued and run later. Both cases were reproduced against the real `SessionStreamPump` and `SessionRegistry`; see R6–R7 below.

This is a limitation of indeterminate acceptance, not a duplicate dispatch of one operation id. The deadline response warns that the message may still start; no automatic retry occurs. `session-stream-pump.service.ts:279` checks current occupancy, not historical ordering. The source comment should be qualified accordingly.

### 3. What input data produces a wrong answer?

The former stale-dashboard and reused-refusal-id inputs now produce the correct result. Non-submit actions compare the rendered revision at `surface-rpc.handlers.ts:446`. `refuseAction` uses the same submit fingerprint and gives an existing record priority at `surface-state.service.ts:305`. Unsupported results are reconstructed from the stored detail at `surface-rpc.handlers.ts:488`, so an identical replay is byte-identical even after surface changes.

Invalid RPC inputs still fail before mutation: byte measurement precedes schema parsing at `surface-rpc.handlers.ts:357` and `:368`; strict envelopes reuse the contract leaves at `surface-rpc.schema.ts:21`, `:53`, `:60`, `:68`, `:75` and `:82`.

### 4. What happens when a dependency fails?

Typed runtime admission refusals remain rejected; unexpected dispatch failures remain indeterminate with fixed text (`surface-submit-turn.service.ts:292`, `:386`; `surface-rpc.handlers.ts:308`). An unresolved send now reaches the 120,000 ms host deadline. Two timer-order reproductions confirmed exactly one settlement whether send completion or the deadline wins at the same timestamp. The timer is cleared and only the owning token releases the guard (`surface-submit-turn.service.ts:200`).

Delete, recreate or eviction during the wait does not rewrite another incarnation. The operation retains its terminal result, with `surfaceState: not-recorded` when no matching commit occurs (`surface-state.service.ts:357`; `surface-rpc.handlers.ts:462`). No raw dependency error message reached the client in the targeted failure tests.

### 5. What is missing that the requirements never mentioned?

A host-side acceptance deadline was previously unspecified; Revision 1 supplies one and preserves Revision 6's distinction between UI timeout and final host knowledge. Underlying send cancellation and ordering between different operation ids remain unspecified. This review accepts the current explicit indeterminate semantics; it does not infer cancellation from terminal ledger settlement.

Refusals now share the existing per-routing operation budget with submits. A client can consume all 128 slots with distinct refused operations and temporarily prevent new submits. This is bounded, charged, visible fail-closed behaviour, consistent with preserving recent operation identities (`surface-operation-ledger.ts:281`; `libs/shared/src/mcp-apps-contracts/surface-catalog.ts:127`). Existing pending submits can still settle. There is no separate priority allocation for successful submits.

## Failure modes

No remaining Blocking, Serious or Moderate failure mode was established within this scope.

### F1 — CLOSED: unresolved dispatch held the ticket and guard forever

- Original trigger: `sendMessageToSession` never resolves or rejects.
- Correction: a finite deadline resolves dispatch as indeterminate; the handler performs its single settlement and releases the ticket.
- Evidence: `surface-submit-turn.service.ts:98`, `:186`, `:191`, `:202`; `surface-rpc.handlers.ts:284`; `surface-state.service.ts:333`.
- Reproduction: R1–R3 verified bounded settlement, replay, ticket release and both same-tick orderings. R6–R7 verified actual SDK admission after guard release.
- Limit: the deadline fences the returned outcome, not execution of the original send. Late execution after the session becomes idle is permitted and disclosed. No concurrent turn or second dispatch of the same id was reproduced.

### F2 — CLOSED: non-ledgered action responses lost operation identity

- Original trigger: reuse an unsupported action id for submit, or retry an undeclared request after an unrelated change.
- Correction: terminal refusals reserve the same fingerprint as submit without a dispatch ticket.
- Evidence: `surface-state.service.ts:300`; `surface-ui-mutations.ts:185`; `surface-operation-gate.ts:159`; `surface-rpc.handlers.ts:488`.
- Reproduction: R4 returned operation-conflict for changed content, retained the undeclared rejection after a change, and preserved exact unsupported response bytes across change, delete and recreate.
- Bound: R5 confirmed that refusals consume the existing charged ledger capacity, do not reserve tickets and do not prevent settlement of an already-pending submit.

### F3 — CLOSED: dashboard actions ignored revision

- Original trigger: invoke a still-declared dashboard action using an old rendered revision.
- Correction: revision comparison precedes undeclared, dashboard.select and unsupported decisions; ledger replay still has priority.
- Evidence: `surface-ui-mutations.ts:514` supplies current revision for undeclared actions; `surface-rpc.handlers.ts:441` checks it; `surface-state.service.ts:311` returns recorded outcomes first.
- Reproduction: R4 and the committed revision tests returned stale-revision/currentRevision for stale unsupported and dashboard.select requests, with no selection mutation or dispatch.

## Blocking issues

None established.

## Serious issues

None remaining. Original F1 is closed with the execution limitation stated above.

## Moderate and minor issues

**Minor — qualify the admission explanation.** `libs/backend/rpc-handlers/src/lib/chat/session/surface-submit-turn.service.ts:132` and `batch-11-report.md:194` say whichever of two live sends reaches admission second is refused. That is true only while the first admitted message remains queued or its turn remains in flight. R7 demonstrated that an older stalled send is accepted after the newer turn finishes. Describe the guarantee as “no concurrent turn while queued/busy,” and explicitly retain the possibility of later acceptance once idle. The existing client deadline detail already describes this correctly; no production behaviour change is required for approval.

The earlier report's deviation list at `batch-11-report.md:158` still describes non-ledgered refusals. Revision 1 at `:222` supersedes it; reviewers should use the revised behaviour.

## Data flow

1. **OK — registration.** All five methods are present in `libs/shared/src/lib/types/rpc.types.ts:2220` and `:3853`; the prefix is allowed at `libs/backend/vscode-core/src/messaging/rpc-handler.ts:90`; the handler is exported at `handlers/index.ts:14` and included in the host manifest at `host-profile/manifest.ts:148`. All three targeted host registration suites pass.
2. **OK — boundary validation.** Measure the complete params object, then parse strict envelopes using contract leaves (`surface-rpc.handlers.ts:357`; `surface-rpc.schema.ts:21`). Client action parameters cannot replace stored declarations.
3. **OK under the specified trust model — routing.** The host-owned renderer supplies routingId; RPC does not derive a separate authenticated tab principal. This is expressly allowed by `implementation-plan.md:763` and `task-description.md:502`. Store lookups remain routing-scoped. This is not a claim that RPC independently prevents a trusted renderer from naming another known tab.
4. **OK — resolve and reserve.** Action lookup uses stored declarations. Submit and refused-action paths converge on the same operation identity. The extracted `reserveOn` handles missing surfaces while preserving replay/conflict (`surface-operation-gate.ts:105`); the facade publishes reservation evictions once (`surface-state.service.ts:640`).
5. **OK — bounded admission.** The ledger checks replay before expiry/capacity, charges new records, and does not evict recent identities (`surface-operation-ledger.ts:251`, `:281`, `:291`). Refusals settle immediately, without tickets (`surface-state.service.ts:312`).
6. **OK — dispatch.** Begin-submit returns replay before dispatch; an accepted ticket dispatches once (`surface-rpc.handlers.ts:284`). The adapter forwards require-idle to lifecycle (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1083`), and the real pump rechecks admission synchronously before enqueue (`session-stream-pump.service.ts:241`).
7. **OK — settlement and response.** Deadline and send compete for one outcome. Settlement releases the ticket, writes only to the matching incarnation, and stores the terminal result. Response mapping distinguishes updated/not-recorded and operation status detail/currentRevision (`surface-state.service.ts:327`; `surface-rpc.handlers.ts:261`, `:462`).
8. **OK — main-barrel dependency scope.** `rpc-surface.types.ts` reaches plain surface/dashboard types and catalogs, not schema or binding modules. Its local dependency closure introduces no Zod edge into the shared main barrel. Adding the unsupported reason at `libs/shared/src/mcp-apps-contracts/surface.types.ts:258` does not change that closure.

## Requirements fulfilment

| Requirement | Status | Evidence / qualification |
| --- | --- | --- |
| Req 6: surface RPC methods, operation identity, stale recovery, unsupported dashboard actions | COMPLETE | Handler :219, :246, :441, :488; F2 and F3 reproductions pass. |
| Req 9: byte limit before strict schema; stored action allowlist; safe failures | COMPLETE within scope | Handler :357/:368; schema :21; no caller-supplied action params. |
| Req 10: begin → dispatch → settle; one send per id; frozen submit and orphan settlement | COMPLETE within scope | Handler :284; state service :327; submit/deadline and Batch 10 regression suites pass. |
| Revision 6 item 3: UI timeout does not invent failure or trigger resend | COMPLETE | Host deadline is indeterminate with explicit uncertainty; status/replay remain stable. |
| Batch 10 carry-forward: deletion/recreation/eviction before settlement | COMPLETE | Existing submit regressions plus added eviction/deadline-delete tests pass; no leaked ticket. |
| Revision 1: refusal capacity/accounting | COMPLETE | R5: 128 records, 131,072 charged bytes, visible refusal at capacity, pending submit settles. |
| Registration in every host | COMPLETE | Three rpc-surface suites: 16/16 tests. |
| Unchanged Batch 10 behaviour after extraction | COMPLETE within tested scope | State, failure, submit, ledger and store suites: 79/79 tests. |

Implicit requirements not addressed: cancellation of underlying stalled sends, strict ordering between distinct operation ids, and submit-priority ledger allocation. None is promised by the current contract. Process-restart persistence remains explicitly out of scope (`implementation-plan.md:761`).

### Plan-deviation assessment

- **Submit surfaceState disposition:** accepted. It separates runtime acceptance from whether a matching surface could record it; two dispositions replay faithfully (`surface-rpc.handlers.ts:462`).
- **Operation detail/currentRevision fields:** accepted. They preserve indeterminate explanations and stale-revision recovery (`surface-rpc.handlers.ts:261`).
- **Read/operation request identity:** accepted. These queries do not have a rendered mutation revision; read retains its optional surface filter (`surface-rpc.schema.ts:53`, `:82`).
- **Non-ledgered unsupported/undeclared refusals:** superseded by Revision 1. Recording bounded terminal refusals resolves the previous deviation against Req 6.4 (`surface-state.service.ts:300`).
- **Missing submit runtime:** accepted. Rejected session-unavailable reaches settlement instead of stranding a reservation (`surface-rpc.handlers.ts:300`).
- **Spec/harness file split:** no behavioural deviation; the real-class harness supports failure injection and the selected suites pass.
- **Inconsistent mutation outcomes:** no reproduced regression. Change/select and submit use different fingerprints; ordinary change/select success retains its required revision (`surface-rpc.handlers.ts:510`).
- **Revision 1 additions:** the finite indeterminate deadline is a justified recovery policy; adding unsupported to the reject reason and replacing the unsupported wire action field with stored detail is coherent with byte-stable replay. Consumers of this new channel must use the revised shared types (`rpc-surface.types.ts:136`).

## Edge cases

| Case | Handled | Evidence / remaining concern |
| --- | --- | --- |
| Send never settles | YES | Deadline terminal result, ticket bytes zero, next fresh submit can proceed. Underlying send is not cancelled. |
| Send and deadline due at same tick | YES | Both scheduling orders tested; one settlement and one revision increment. |
| Late resolve/reject | YES | Logged only; no operation rewrite, extra push or leaked client error text. |
| Newer dispatch owns guard when old send settles | YES | Token ownership test passes; old completion does not release the newer guard. |
| Old send resumes during newer turn | YES | Real pump rejects busy; no enqueue. |
| Old send resumes after newer turn ends | YES, as indeterminate | Real pump accepts; old ledger outcome stays indeterminate. Documentation qualification above. |
| Identical unsupported replay after replacement | YES | JSON.stringify result exactly equal; no dispatch. |
| Refusal id reused for submit | YES | operation-conflict; no send. |
| Stale dashboard.select / unsupported action | YES | stale-revision with currentRevision; no effect. |
| Refusals fill ledger | YES | Bounded and charged; new operations visibly refused; no submit-priority partition. |
| Capacity reached while submit pending | YES | Existing submit still settles and releases ticket. |
| Delete/recreate/evict before settlement | YES | Stable terminal outcome, not-recorded, no new-incarnation write. |
| Oversized/unknown-key/forged payload | YES | Targeted handler boundary cases pass. |
| Host process termination | OUT OF SCOPE | Store and ledger intentionally in-memory; no durability claim. |

## Verification and reproductions

All commands were scoped with project names and `--testPathPatterns`; `--excludeTaskDependencies` prevented dependent builds.

1. `npx nx run-many -t test -p @ptah-extension/rpc-handlers @ptah-extension/vscode-lm-tools @ptah-extension/agent-sdk --excludeTaskDependencies --testPathPatterns='surface-rpc.handlers|surface-submit-turn|surface-state.service|surface-operation-ledger.spec|surface-state.store.spec|session-stream-pump.service.spec' --runInBand --outputStyle=static`
   - **11 suites, 182 tests passed**: rpc-handlers 87, vscode-lm-tools 79, agent-sdk 16.
2. `npx nx run-many -t test -p ptah-extension-vscode @ptah-extension/cli-engine ptah-electron --excludeTaskDependencies --testPathPatterns=rpc-surface --runInBand --outputStyle=static`
   - **3 suites, 16 tests passed**: VS Code 2, CLI 12, Electron 2.
3. Seven reviewer reproductions used the existing `surface-rpc.handlers.submit.spec.ts` environment with additional test text appended through an in-process read interceptor, without writing source files. Jest ran only `--testPathPatterns=surface-rpc.handlers.submit.spec` and test names matching `REVIEW_R1`.
   - **7 passed, 0 failed**; existing 11 tests were deliberately skipped in this run. Jest's explicit result was `{"success":true,"passed":7,"failed":0}`. The PowerShell wrapper reported exit 1 because Jest's stderr summary was surfaced as NativeCommandError; the test result itself passed.

The reproductions use the real RpcHandler, SurfaceRpcHandlers, SurfaceStateService and SurfaceSubmitTurnService through `surface-rpc-harness.ts`. Only collaborators and clocks are controlled. R6–R7 additionally use the real SDK pump and registry, delaying the first message factory call.

| Reproduction | Steps | Observed result |
| --- | --- | --- |
| R1 — original F1 | Hold first send unresolved; advance timers by 24 hours; query/replay; issue fresh submit; finally release old send. | First indeterminate; ticketBytes 0; next applied; two sends total for two ids; late release does not rewrite first outcome. |
| R2 — same tick, send timer first | Schedule send resolution at the deadline before the service registers its timer; spy on real settleSubmit. | applied; exactly one settlement, one send, one revision increment; ticketBytes 0. |
| R3 — same tick, deadline timer first | Register service deadline first, then resolve send at the same timestamp. | indeterminate; exactly one settlement, one send, one revision increment; ticketBytes 0. |
| R4 — F2/F3 | Refuse act-0; reuse its id for send; replay after change, delete and recreation; retry undeclared after change; invoke stale act-0 and pick. | Conflict on changed content; byte-identical original unsupported reply; stable undeclared reply; stale-revision/currentRevision for both dashboard cases. |
| R5 — shared capacity | Keep one submit pending; add 127 distinct unsupported operations; try another new submit; complete the pending one. | New submit rejected too-many-operations; chargedBytes 131072, ticketBytes 795 before settlement and 0 after; pending submit applied and replayed. |
| R6 — actual concurrent-turn admission | Timeout old send during message preparation; admit fresh send; consume its queue item so turnInFlight is true; release old preparation. | Old late outcome rejected; queue length 0; two adapter calls for two ids; original operation remains indeterminate. |
| R7 — actual admission after newer turn ends | Repeat R6 but mark the newer turn ended before releasing old preparation. | Old late outcome applied; queue length 1; original operation remains indeterminate; no second surface settlement. |

The harness fixes ledger time, so the 24-hour timer reproduction establishes deadline behaviour, not expiry. Retention/capacity expiry behaviour is covered by the real ledger regression suite and the lookup/sweep logic.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for the scoped logic; no fresh compiler-diagnostic result was available.
- Top risk: consumers must treat indeterminate as “may still execute,” including after a later distinct turn, rather than as cancellation.
- What a robust implementation would add: qualify the admission comment, retain the same-tick and real-pump adversarial cases as permanent regressions, and define cancellation/ordering only if the product later requires stronger semantics.

