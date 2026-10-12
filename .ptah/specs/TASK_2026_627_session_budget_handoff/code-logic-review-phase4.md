# Phase 4 code logic review — TASK_2026_627

**Score: 5/10. Verdict: NEEDS_REVISION.** The user-only start gate is present in the coordinator (session-handover-coordinator.service.ts:269,493-500), but two reachable phase edges violate the promised cancellation and draft behavior. This is the 5–6 band because the principal handover path is wired and tested, while a progress action fails on likely phases and a closing-phase retry can discard text. A 7–8 score would require these edges to be safe; a 3–4 score would require the authorization or ordinary handover path itself to fail.

## Findings

1. **Serious — Cancel is offered after the backend stops accepting it.** The banner maps `writing-handoff`, `starting-successor`, `successor-confirmed`, and `closing` to one progress stage (session-budget-banner.component.ts:528-535) and renders “Cancel (keep working)” throughout it (:253-265). The coordinator accepts cancel in `writing-handoff` but excludes the other three phases (session-handover-coordinator.service.ts:173-179,359-376). **Scenario:** successor startup is slow, the state advances to `starting-successor`, and the user clicks Cancel; the RPC returns `cancelled: false` (session-handover-rpc.handlers.ts:108-119), the UI displays an error (session-budget-actions.service.ts:419-440), and the handover continues. This contradicts the visible action and the plan’s progress/cancel promise. **Fix:** show Cancel only when the backend phase is cancellable, or extend the backend cancellation contract through the later phases with successor rollback. Add an integration assertion for a click in each rendered progress phase; the current banner spec exercises the button only in `writing-handoff` (session-budget-banner.component.spec.ts:1004-1036).

2. **Blocking — A repeated begin at `closing` can acknowledge and erase composer text that the backend refused to capture.** The coordinator calls `captureDraft` before checking whether an existing operation is user-gatable (session-handover-coordinator.service.ts:250-265). `closing` is absent from `DRAFT_CAPTURE_PHASES` (:149-156), yet a live operation in that phase returns `accepted: true` (:263-265). The frontend clears matching `queuedContent` on *any* accepted result (session-budget-actions.service.ts:369-395). **Scenario:** one panel has already started handover; a second panel still has the Continue action from a stale state and has queued text; its begin reaches the coordinator after the operation enters `closing`. The response looks successful, the second panel clears the text, and the operation neither transfers it nor returns it as a draft. **Fix:** return an explicit refusal or a `draftCaptured` acknowledgement when text cannot be captured, and clear queued content only after that acknowledgement. Pin the `closing` race in the coordinator and actions specs. The existing action spec even expects clearing for an accepted `starting-successor` response (session-budget-actions.service.spec.ts:882-900), but does not cover rejection at `closing`.

## Five logic questions

| Question | Answer |
| --- | --- |
| Silent failure | A closing-phase begin returns accepted despite rejecting its draft, after which the UI clears that text (session-handover-coordinator.service.ts:263-265,423-431; session-budget-actions.service.ts:382-395). |
| User action with unexpected behavior | Cancel during `starting-successor`, `successor-confirmed`, or `closing` emits an RPC that the coordinator refuses (session-budget-banner.component.ts:253-265; session-handover-coordinator.service.ts:173-179,359-369). |
| Wrong answer from input data | A stale second-panel begin containing `queuedInput` at `closing` returns accepted although the text is not in `draftText` or `inputs` (session-handover-coordinator.service.ts:149-156,250-265,423-431). |
| Dependency failure/timeout/wrong shape | A lane-provider throw becomes unknown rather than zero and keeps the operation waiting (session-handover-coordinator.service.ts:454-473); the user can force it from the waiting banner (session-budget-banner.component.ts:293-310). Other dependency paths were not independently fault-injected in this review. |
| Missing from the requirements | The plan does not define what an additional begin with new composer text must return once the operation enters `closing`; this omission causes Finding 2 (session-handover-coordinator.service.ts:149-156,250-265). |

## Gate checklist

| Gate | Result | Evidence |
| --- | --- | --- |
| G1: no automatic budget handover | Pass in searched production paths | No `budget-auto`, `startAutomatic`, wait-escalation constant, or cancelled-auto set matched in `libs`; terminal only parks a blocking limit (session-handover-coordinator.service.ts:302-335; session-lifecycle-manager.ts:517-548). |
| G2: only user RPC begins | Pass in searched production paths | The only coordinator `.begin(` production hit is session-handover-rpc.handlers.ts:99; the agent path calls `requestFromAgent` (session-handover-coordinator.service.ts:278-293; batch-13-report.md:3-34). |
| G3: only begin confirms, only confirmed starts | Pass | `userConfirmed = true` occurs in `begin` and `complete()` is called only by `startConfirmed` (session-handover-coordinator.service.ts:269,492-503). |
| G4: only click queues wrap-up | Pass in searched production paths | `noticeQueue.post` occurs only in `requestWrapUp`, reached by the action switch (session-budget.service.ts:461-462,895-929). Idle is refused at :904-917. |
| G5: draft never enters source restoration/hold | Pass in coordinator path; closing loss fails D24 | `draftText` is separate from `inputs`; `restoreInputs` receives only `operation.inputs` (session-handover-coordinator.service.ts:423-431,748-753). The closing case is Finding 2. |

## Scenario checklist

“Pass” means the reviewed code path and cited existing specification support the case; no suite was rerun for this review. “Not covered” means the complete end-to-end case was not independently established here.

| Case | Result | Evidence |
| --- | --- | --- |
| S1 | Pass | Terminal creates an op only at blocking limit (session-handover-coordinator.service.ts:310-314; session-lifecycle-manager.ts:517-532). |
| S2 | Pass | The same blocking-only terminal path excludes non-blocking stages (session-handover-coordinator.service.ts:310-314). |
| S3 | Pass | Post-result adapter checks `blocked` before parking (sdk-agent-adapter.ts:1829; session-lifecycle-manager.ts:542-548). |
| S4 | Pass | Stop/terminal follows the blocking-only arm path (session-lifecycle-manager.ts:517-532). |
| S5 | Pass | `observeLive` returns a display stage and calls only `logLiveStage` (session-budget.service.ts:320-375). |
| S6 | Pass | Rank and turn guard, then click action posts (session-budget.service.ts:895-929,383-390). |
| S7 | Pass | `begin` gates; terminal rechecks work and starts only when clear (session-handover-coordinator.service.ts:250-275,322-335,442-473). |
| S8 | Pass | `continueNow` sets `forced`; terminal honors it (session-handover-coordinator.service.ts:271-275,322-325). |
| S9 | Pass | Cancel clears waiting and restores held `inputs`, separate from draft (session-handover-coordinator.service.ts:359-376,748-753). |
| S10 | Pass | Interrupt hold predicate excludes waiting and agent request (session-handover-coordinator.service.ts:351-356,483-490). |
| S11 | Not covered | Blocking send refusal is asserted by the existing chat-session-budget spec per the plan; it was not retraced here. Limit park itself is at session-handover-coordinator.service.ts:310-335. |
| S12 | Not covered | Source-unavailable action fallback was not retraced; coordinator refusal remains at session-handover-coordinator.service.ts:388-398. |
| S13 | Fail | Progress Cancel remains visible in phases where the backend refuses it (session-budget-banner.component.ts:253-265,528-535; session-handover-coordinator.service.ts:173-179). |
| S14 | Not covered | Parser behavior is recorded by batch-10-report.md:3-22 but was not independently read. |
| S15 | Pass | Agent request parks without confirmation or hold (session-handover-coordinator.service.ts:278-293,483-490). |
| S16 | Pass | Approval sets confirmation; blocking terminal converts agent request to limit park (session-handover-coordinator.service.ts:267-275,315-335). |
| S17 | Not covered | Spawner wiring and reply are reported in batch-13-report.md:3-34, but were not independently retraced. |
| S18 | Pass | Banner emits Approve/Cancel and the view routes Approve to begin (session-budget-banner.component.ts:312-329; chat-view.component.ts:1361-1364). |
| S19 | Fail | Draft recovery is lost for an accepted repeated begin at `closing` (session-handover-coordinator.service.ts:149-156,250-265; session-budget-actions.service.ts:382-395). |
| S20 | Pass for reviewed path | Client peeks, view restores then acknowledges, input appends without send (session-handover-client.service.ts:52-68; chat-view.component.ts:1227-1234,1373-1383; chat-input.component.ts:1515-1520). |
| S21 | Pass for reviewed path | Ignored live samples keep prior display; disabled clears; display reads live only while running (session-budget.service.ts:320-375; session-budget-actions.service.ts:208-230). |
| S22 | Pass | Provider throw yields `lanes: null` and keeps wait; force can start (session-handover-coordinator.service.ts:454-473,271-275). |
| S23 | Pass for coordinator path | `waiting-for-turn-end` is absent from held phases, so send admission proceeds (session-handover-coordinator.service.ts:140-147,338-348). |

## Decisions

- **D22/D23:** The reviewed production call sites preserve the click gate. A parked agent request is not confirmation (session-handover-coordinator.service.ts:278-293,492-500). The D17/D18 live-limit-before-result bypass is removed by the blocking-only terminal arm (session-lifecycle-manager.ts:517-532; session-handover-coordinator.service.ts:310-335).
- **D24:** The ordinary cancel/failure draft path is separate from sendable inputs, but Finding 2 breaks the no-loss promise at `closing` (session-handover-coordinator.service.ts:423-431,748-753; session-budget-actions.service.ts:382-395).
- **D25:** Unknown lane status waits, and ignored live estimates return `undefined` rather than clearing the display (session-handover-coordinator.service.ts:454-473; session-budget.service.ts:320-375).
- The two `ENDED_HANDOVER_PHASES` sets currently contain the same three phases, so no present-state defect is established (chat-view.component.ts:92-97; session-budget-actions.service.ts:79-84). Drift is a maintenance risk, not a finding.
- R-P1 through R-P11 are documented in batches.md:1020-1030 and batch reports; this review directly checked the user gate, lane-unknown behavior, agent park, banner progress, and draft boundary. No new claim is made for the remaining mitigations without an independent trace.
- The native `ptah_*` tool list was empty in this session. No diagnostics tool, git operation, Jest, Nx, or source edit was run. Review evidence comes from targeted production/spec reads and the batch reports; this limits any “Pass” to the cited paths rather than a fresh full-suite result.
