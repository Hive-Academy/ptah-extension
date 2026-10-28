# Code Logic Review — TASK_SESSION_HANDOFF Q2

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues (should-fix) | 2 |
| Moderate issues | 0 |
| Failure modes found | 2 |

The automatic claim and normal queue path cover the ordinary case, but asynchronous session identity and cancellation ownership remain incorrect. These concrete behavioral defects keep this below the 7–8 band; the guarded send, permission checks, and substantive passing tests keep it above the 3–4 band. No source files were edited.

## Scope and evidence

Reviewed the supplied worktree's Q2 implementation, using `findings.md` section Q2 as the requested behavior. Examined the budget actions and root guard, dispatch and conversation queue paths, banner, settings reader/writer, shared setting definition, backend config reader, `configKeyOf`/evaluation/state composition, and the automatic-handoff tests. Read the existing implementation plan for context; its older automatic successor architecture is not the contract for this opt-in slash-command change. `context.md`, `task-description.md`, and `code-style-review.md` were absent from the discovered task folder.

Commit requested: `5e7b108d4`. The reviewer role explicitly prohibits git operations, so `git show` was not run and exact commit-to-worktree equivalence was not independently established. Findings cite the worktree files examined. This is a logic review, not a rendered Electron review or host compatibility certification.

## Findings and failure modes

### F1 — should-fix / serious: a completed skill probe can send into a replacement session

- Evidence: `libs/frontend/chat/src/lib/services/session-budget-actions.service.ts:272` captures tab and budget session, `:278` awaits command discovery, and `:286` dispatches with only `tabId`. The final guard at `:347` checks skill, permissions, and the old session's root claim; it never revalidates session ownership, current opt-in, stage, or the session-start guard. `libs/frontend/chat/src/lib/services/message-sender.service.ts:356` resolves the tab again, and `:361` uses its **current** session, or starts a new conversation at `:367`.
- Trigger: session A reaches the limit; command discovery is pending; the user clears or loads another session into the same tab; discovery resolves successfully.
- Symptom/impact: the request built from A's budget is sent to session B (or starts a fresh conversation), even though B never qualified. A is marked fired, while B can later auto-fire under its own identity. The reset lifecycle explicitly allows the same tab to survive with a different conversation (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:177`).
- Related stale eligibility: a new snapshot turning automation off or removing the limit during the probe also does not stop the captured request. An ordinary tab switch alone preserves the captured target; replacement of the target session is the destructive case.
- Fix: immediately before claiming and sending, resolve the captured tab and require it still owns the captured session; recheck current eligibility. Invalidate pending probes on reset/close/view disposal. Pass an expected-session identity through dispatch if later asynchronous sends can change ownership too.
- Regression: hold the discovery promise, replace/reset the tab's session, resolve the promise, and assert no send or queue mutation on the replacement and no consumed claim for an undelivered request.

### F2 — should-fix / serious: Cancel can delete a user's identical command and leave the automatic one live

- Evidence: `libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts:191` holds a new slash command behind existing queued text. `:279` searches held commands by text and removes the first match at `:282`, **before** examining the actual queue at `:287`. `libs/frontend/chat/src/lib/services/session-budget-actions.service.ts:232` marks cancellation before `:235` calls this text-based withdrawal. Its queued indicator at `:179` trusts the root entry's fired state.
- Trigger: automatic command C is the main queue item; the user then queues identical C (for example, copied from the queued prompt). The user clicks the automatic banner's Cancel.
- Symptom/impact: withdrawal removes the user's held C, leaves the automatic C in the main queue, and returns success. The banner hides cancellation because the root entry is now cancelled, but the original automatic command still runs when the turn finishes. Cancellation loses user-owned input and fails its own promise.
- Further manifestation of the same ownership defect: after the original automatic command has run, its retained text can make a later identical user queue item appear automatic (`session-budget-actions.service.ts:176`), exposing that user item to Cancel again.
- Fix: return a unique queue-entry handle when enqueuing and retain that handle in the automatic entry. Withdraw and display only the owned item, including its transition from held to main queue; do not infer ownership from string equality or prefix matching.
- Regression: queue auto C, then user C, cancel auto, and assert that exactly the user C survives and is delivered. Also queue user C after the automatic command has already completed and assert that it is not advertised as an automatic handoff.

## Five logic questions

### 1. How does this fail silently?

F2 reports cancellation by clearing the fired state without ensuring the owned command was removed (`session-budget-actions.service.ts:232`; `conversation.service.ts:279`). The command still executes while its Cancel affordance disappears.

### 2. What user action produces unexpected behaviour?

Resetting/replacing a session during command discovery can hand off the wrong session (F1). Queueing an identical command before cancellation removes the wrong item (F2). Ordinary appended *different* text is preserved by `conversation.service.ts:290`, and is tested at `session-budget-actions.auto-handoff.spec.ts:351`.

### 3. What input data produces a wrong answer?

Two independently owned queue entries with identical text defeat the ownership inference (F2). Missing or non-true `autoHandoff` does not arm the effect: `session-budget-actions.service.ts:201` explicitly requires true. Backend configuration rejects nonboolean settings through `session-budget-config.provider.ts:148`. No new runtime crash from an absent field was identified in the examined consumer; a complete persisted-snapshot migration/validator audit was not established.

### 4. What happens when a dependency fails?

A failed send clears the manual-view flag (`session-budget-actions.service.ts:290`) but leaves the root claim (`session-auto-handoff.service.ts:44`), so this effect does not retry it indefinitely. A thrown/malformed command-discovery response is treated as unavailable (`session-budget-actions.service.ts:322`), and `:353` caches that absence for this view/session. This also suppresses automation after a transient discovery failure until view recreation; the manual action remains available. Existing tests cover a refused idle send at `session-budget-actions.auto-handoff.spec.ts:378`; they do not prove queue-flush failure recovery. Dispatch restores a failed queued message at `message-dispatch.service.ts:296` for the existing queue machinery to handle.

### 5. What is missing that the requirements never mentioned?

The design needs explicit ownership of queue items and a lifecycle rule for requests pending during session replacement (F1/F2). Discovery uses an immediate resolved fake in `session-budget-actions.auto-handoff.spec.ts:169`; deferred completion and session replacement need coverage. Queue ownership cannot be represented by the command text alone (`session-auto-handoff.service.ts:11`).

## Data flow and requested checks

| Step/check | Result and evidence |
| --- | --- |
| Setting load/save | UI reads every registry key (`session-budget-settings.component.ts:413`), includes the new boolean (`:377`), writes its registered key and boolean (`:605`), and updates the displayed saved value only on confirmation (`:619`). Backend reads it at `session-budget-config.provider.ts:124`. No round-trip mismatch found; the test checks enabling, not a real host restart (`session-budget-settings.component.spec.ts:467`). |
| State composition | `session-budget.service.ts:536` supplies the current flag, including when an old snapshot is rejected at `:364`. Excluding only this setting from the measurement key (`:128`) avoids resetting the measured stage. |
| Trigger and signal stability | `session-budget-actions.service.ts:195` uses an effect with `untracked` around dispatch at `:213`. Per-view wrap-up state blocks a second probe; root `claim` is synchronous (`session-auto-handoff.service.ts:44`). No self-sustaining effect loop identified. Full ChatView ExpressionChanged behavior was not rendered or exercised end to end. |
| Concurrent views | Both may discover the skill, but only one root claim succeeds before dispatch (`session-budget-actions.service.ts:358`). Tested with two views at `session-budget-actions.auto-handoff.spec.ts:315`. This is an in-memory, one-root guarantee, not a cross-window/reload guarantee. |
| Streaming | Dispatch evaluates status, spinner and unsettled tree (`message-dispatch.service.ts:208`) and queues at `:235`; it does not directly call the sender in that branch. Tested at `session-budget-actions.auto-handoff.spec.ts:301`. |
| Permissions | Checked before discovery (`session-budget-actions.service.ts:209`) and again before claim (`:357`). Routing shares the dispatch matcher (`message-dispatch.service.ts:362`). |
| Session changes | Incomplete: F1. |
| Cancel ownership | Incomplete: F2. |
| Failed automatic send | No automatic re-arm; retained root claim. Manual retry remains possible (`session-budget-actions.service.ts:290`). |
| Old snapshots | Absent flag is treated as off by the strict trigger check (`session-budget-actions.service.ts:201`); restoration pipeline not fully certified. |
| Tests asserting nothing | No assertion-free test found in the fully examined automatic-handoff and banner specs. Negative tests run an idle eligible setup before asserting no sends (`session-budget-actions.auto-handoff.spec.ts:276`). The settings addition asserts key/value, checkbox state and preserved banners (`session-budget-settings.component.spec.ts:467`). These assertions are meaningful but miss F1/F2. |

Paths abbreviated in this table are the files identified in Scope/Findings: frontend service paths under `libs/frontend/chat/src/lib/services/`, settings under `libs/frontend/chat/src/lib/settings/ptah-ai/`, and backend budget files under `libs/backend/agent-sdk/src/lib/helpers/session-budget/`.

## Verification and limitations

Ran exactly the permitted scoped command:

```sh
npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns='session-budget-actions.auto-handoff|session-budget-settings.component|session-budget-banner.component'
```

Result: exit 0, Nx reported one task succeeded, no cache hit. The wrapper did not inline individual Jest totals, so no suite/test count is claimed. Log: `/tmp/q2-review-tests.log`. Findings are source-traced failure scenarios, not newly added regression tests; no source/test files were edited.

Requested Ptah diagnostics for the two handoff services. Both the initial response and one retry reported both files unchecked because the TypeScript check exceeded 45 seconds; this is not a clean diagnostics result. No build, workspace-wide checks, host checks, or browser/e2e run was performed.

Tool availability was checked. Used Ptah workspace/file discovery and AST inspection. `ptah_code_search_symbols` returned an empty index for `MessageSenderService`, `isSessionBudgetState`, and `setSessionBudget`; native `rg` was the fallback. An initial `ptah_ast_analyze` argument error and capped source output required native source reads. No CLI skill-loading tool was listed; the repository Angular patterns skill was discovered and read directly at `.claude/skills/angular-frontend-patterns/SKILL.md`.

## Decisions

- Review Q2's opt-in frontend command behavior rather than the older successor-creation plan. Options: apply the older plan or the explicit Q2 design. Evidence: the user's named section and the current implementation. Reversible: yes, review scope can be expanded.
- Treat F1/F2 as serious should-fix findings, with no invented blocking/nit findings. They misroute an automatic action and violate cancellation ownership respectively. Reversible: yes, after regression evidence and fixes.
- Honor the role's prohibition on git operations and disclose commit-attribution uncertainty rather than claim to have inspected the requested commit diff. Reversible: an authorized caller can compare these findings against the commit.

## Verdict

**NEEDS_REVISION — 6/10.** Confidence is high in the two traced defects, moderate in overall coverage. Fix expected-session validation and queue-item ownership, then add the deferred-probe and identical-command regressions. Passing ordinary-path tests do not discharge those failure modes.
