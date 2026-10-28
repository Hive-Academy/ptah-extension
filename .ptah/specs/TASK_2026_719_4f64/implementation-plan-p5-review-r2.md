APPROVED — 9/10
Reviewer: codex / Author: claude

Gate 2 re-review, round 2, TASK_2026_719_4f64. The round-1 Moderate item is closed at plan level. No Blocking, Serious, or Moderate finding remains. This approves the written contract, not implemented or measured runtime behavior. Document citations are relative to this task folder; source citations are relative to the supplied worktree.

## Round-1 item status

**Closed — queued refresh outliving its RPC timeout.** `implementation-plan-p5.md:251` gives every read its own 25,000 ms deadline from entry, including same-key joins, obsolete-attempt abort/await, queued follow-ups, and execution. Expiry settles only that caller with `{ state: 'unknown', reason: 'timeout', checkedAt: null }` (`:254`), and its timer is cleared on settlement (`:253`). Queue time can therefore no longer extend the caller's host wait to two full attempts.

The actual RPC default is **30,000 ms**, at `libs/frontend/core/src/lib/services/claude-rpc.service.ts:135`. Its timer starts at `:154`, before posting at `:200`; expiry deletes the pending resolver at `:156`, and response handling consults that resolver at `:241`. The plan retains that timeout in §6 (`implementation-plan-p5.md:342`) and explicitly budgets **5 seconds for transport** (`:260`). This closes the identified queue-induced timeout under ordinary transport and timer scheduling. It is not an unconditional delivery guarantee during process suspension, event-loop starvation, or transport loss; §6 already clears the result and reports local failure for transport failure (`:339`). No larger timeout is needed to accommodate the probe queue itself.

The attempt budget remains 20 seconds plus a 2-second child kill grace (`implementation-plan-p5.md:242`, `:258`), supported by the actual 10-second version/status limits and 2-second grace at `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts:45`. The caller deadline is independent of attempt completion, including dependencies that do not settle within the nominal budget. This independence, rather than assuming every dependency resolves in 22 seconds, is what closes the finding.

**Child ownership remains intact.** Deadline expiry expressly leaves the active attempt, queued follow-up, retained receipts, and close handling untouched (`implementation-plan-p5.md:256`). The serial slot still permits at most one child (`:217`); refreshes share one follow-up (`:227`); key changes abort and await (`:231`); unclosed receipts prevent spawning (`:237`). Receipts remain owned until close or disposal (`:264`). This matches the existing command's retained listeners on receipt-bearing completion (`claude-account-command.ts:442`), receipt creation after grace (`:450`), and late-close handling (`:484`). The timeout reply neither releases the child slot nor abandons termination proof.

**Regression test specified.** `implementation-plan-p5.md:288` requires a deferred slow active attempt plus queued refresh, a 25,000 ms unknown/timeout/null reply before 30,000 ms, a maximum of one live child, no premature follow-up spawn, eventual follow-up/cache recovery, and no second settlement. Existing retained-receipt and close-release cases remain at `:284`. P5-D16 records the same policy and its alternative at `:785`. These are specified tests, not executed tests.

## Regression assessment

| Contract | Assessment and current evidence |
| --- | --- |
| Original finding 1 / D41 badge | Still closed. Both reads must be usable; unknown/checking/local failure hide the entire badge, signed-out adds zero, and zero stays hidden (`implementation-plan-p5.md:377`). Positive named-count, recovery, and pushed-snapshot cases remain at `:388` and `:524`. Display-only text, Claude-only placement, page reads, and drawer-close refresh remain at `:514`. These preserve `decisions.md:251`. |
| Original finding 2 / dependent-host verification | Still closed. Derivation remains at `implementation-plan-p5.md:660`; B1/B2/B3 retain 9/7/10 projects (`:680`, `:686`, `:695`), including TUI and the required shared-contract webview coverage. F1–F7 retain VS Code and counts 5/4/4/4/4/4/5 (`:700`, `:705`, `:709`, `:714`, `:718`, `:723`, `:728`). No verification was run. |
| Original finding 3 / serialization | Still closed. The per-caller deadline changes waiting duration, not child ownership or follow-up ordering (`implementation-plan-p5.md:217`, `:227`, `:256`). |
| Original finding 4 / timestamp provenance | Still closed. Nullable completed-attempt time remains the contract (`implementation-plan-p5.md:156`); blocked reads preserve earlier provenance (`:237`); deadline replies have null (`:255`); transport failure creates no timestamp (`:339`); the row suppresses age without host time (`:373`). |
| 74-row parity map | Counted 74 rows and 74 distinct IDs, with no missing ID in 1–74 (`implementation-plan-p5.md:575` through `:648`). The dispositions retain the prior review's explicit removal set: 12, 14, 20, 26, 31, 34, 51, 53, 66. Harness/other-consumer exclusions remain at `:650`; no additional removal appears. |
| D42 B-1 | Removal still cannot assign selection locally (`implementation-plan-p5.md:48`, `:487`). General absent-named-target handling and omitted-versus-absent tests remain at `:360`, `:385`, and `:493`, preserving `decisions.md:263`. |
| D42 B-2 | Both current focus and originating view must match (`implementation-plan-p5.md:53`). Bookkeeping remains at `:488`, with both-branch tests for ambient, selects, and detail (`:406`, `:435`, `:460`), preserving `decisions.md:265`. |

The Revision 2 additions are consistent with its declared scope (`implementation-plan-p5.md:22`): deadline, regression case, frontend timeout relationship, and P5-D16. Comparing the current contracts with the round-1 review's recorded evidence found no unrelated behavioral change. No historical Revision 1 file snapshot was supplied, so this is a semantic regression check, not a byte-for-byte historical diff.

## New findings

None. No severity-bearing new defect was identified in this revision; no Minor item blocks approval.

## Five logic questions

1. **Silent success-looking failure?** Deadline expiry returns unknown and no timestamp; badge and age rules cannot present it as successful freshness (`implementation-plan-p5.md:255`, `:373`, `:377`).
2. **Unexpected user action?** Opening Accounts during the page probe still queues a fresh follow-up, but the caller now receives a bounded host result (`:227`, `:251`, `:470`).
3. **Wrong-answer input?** Positive named counts combined with unknown ambient status hide the badge; omitted and absent named selections remain distinct (`:360`, `:377`, `:388`).
4. **Dependency failure, timeout, or malformed shape?** Probe failures map to unknown (`:243`); the deadline bounds caller waiting (`:251`); receipts continue blocking unsafe spawning (`:264`); transport failure clears the frontend result (`:339`).
5. **Missing requirement?** The missing total-read bound is now explicit (`:251`). Actual scheduling/transport latency and A1's effective-environment check remain implementation verification, not established runtime facts (`:127`, `:260`).

## Decisions

- Accept P5-D16's 25-second host deadline rather than extending RPC timeout to cover two attempts. Evidence: plan `:251`, `:785`, and the real RPC timer at `claude-rpc.service.ts:135`. Reversible; preserves the existing queue and child ownership contracts.
- Treat the stalled-command test as deliberately stronger than the normal 22-second attempt schedule: it proves caller settlement does not depend on child completion (`implementation-plan-p5.md:288`). Alternative: test only two normally bounded slow attempts. Reversible test choice.

## Scope, evidence, and score

Read the implementation plan, round-1 review, task context and relevant requirements/decisions, repository instructions, and the complete ClaudeRpcService; inspected command budget, receipt, and close-handling source. Static parity counting and source inspection support this verdict. No builds, tests, verify, Electron, or git commands were run; only this deliverable was written. Source implementation, real cleanup timing, and frontend integration remain for subsequent implementation review.

**9/10:** the concrete gap that held the previous review at 8 is now closed by an explicit caller deadline, preserved ownership, and a regression test. Comprehensive failure contracts and unchanged parity justify the exemplary band; unexecuted implementation/transport behavior and the lack of a historical byte comparison prevent a 10. Remaining counts: **0 Blocking, 0 Serious, 0 Moderate, 0 Minor; 0 newly identified unresolved failure modes**.
