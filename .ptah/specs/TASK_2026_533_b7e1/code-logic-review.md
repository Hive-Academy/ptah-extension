# Code Logic Review — TASK_2026_533, Batch A, final re-review

## Verdict

**REVISE — 6/10 (NEEDS_REVISION).** Five findings are fixed; F2 and F5 are partially fixed. One new reset regression remains. Confidence: high for the executed accounting cases; medium for the end-to-end teardown interleaving, whose owner operations were executed and adapter/control ordering was traced.

The original reproductions now pass, which separates this revision from the previous 4/10 assessment. Two reproducible, silently wrong lifetime totals and an unreleased-owner race prevent a 7–8 assessment. The required next changes are reset evidence that distinguishes truncation from a real clear, and release by stable owner identity across rebinds.

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 2 |
| Serious issues | 1 |
| Moderate issues | 0 |
| Failure modes found | 3 |

Severity mapping: blocker = Blocking; major = Serious. Counts include the residual F2/F5 cases and N1 below, not already-fixed original scenarios.

## Re-review of F1–F7

Paths in this table are relative to the worktree root.

| ID | Status | Evidence path:line | Note |
| --- | --- | --- | --- |
| F1 | FIXED | `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts:405`; `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:375`; `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:581` | Every prepared run obtains a raw disk candidate; the first uses the prefix read and later runs read the last cost-state. Slash ordering is end → read → launch. Re-executed stale-disk example: 170 input/$17, as required. Unreported $10 followed by a reported run restoring raw $0 now gives $13. The accepted read/start window is not a finding. |
| F2 | PARTIAL | `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts:672`; `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts:809` | Original growing-A/missing-B reproduction rejects atomically: 150/$15 remains unchanged, then recovers to 170/$17. No incompleteness flag is added, as directed. But unchanged-A/missing-B still seals a false segment and recovers to 320/$32. Residual F2 below. |
| F3 | FIXED | `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts:613`; `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts:669` | Re-executed $5 → missing usage: total null, knownCost 5, partial coverage/pricing. Complete $6 cumulative result restores total 6 and complete/full coverage. Incompleteness is retained on sealed segments. |
| F4 | FIXED | `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:137`; `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:150`; `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:500` | Effective override/global auth is copied and frozen at query creation, then supplied to cost resolution. Re-executed transformer with global tier mutation: costs [1, 2], not [1, 200]; explicit frozen override priced 100 tokens at $100. Alias resolution is retained intentionally. History/list pricing is outside this review. |
| F5 | PARTIAL | `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts:403`; `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts:517`; `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:638`; `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:844` | Re-executed released-owner late write: stale-owner/null; next prepare seeds 100/$10 normally. Captured old epoch cannot release a newly prepared run. Generation checks protect replacements after pricing awaits. A lease captured under a provisional key still cannot release its owner after a canonical rebind; residual F5 below. |
| F6 | FIXED | `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:879`; `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:1048`; `libs/backend/agent-sdk/src/lib/session-stats/session-usage-aggregator.ts:282` | Executed loader with read failures: nested agent-a9 is reported as owned; unreadable legacy member has no identity. Passing those actual callbacks into history aggregation yielded total null, knownCost 2, one agent, partial coverage/pricing. Directory failure callback is also wired at loader :903–908. |
| F7 | FIXED | `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:1006`; `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts:396` | History returns an existing owner's snapshot or aggregates directly. Re-executed three browse-only publications: zero retained owners. Activation creates its owner and rereads the prefix; it no longer freezes a browse-time prefix. |

## New defects

1. **N1 — blocker: real `/clear` with mixed counter movement is rejected, then its prior segment is lost.**
   - Evidence: `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts:672`, `:813`; required decrease rule: `.ptah/specs/TASK_2026_533_b7e1/context.md:48`.
   - Scenario: one complete model has input=10, output=100, cost=$11. `/clear` resets the SDK; its next complete cumulative result has input=20, output=1, cost=$2.10. Output decreased but input grew. `isReset` requires every token class to be nonincreasing, so it returns false and the owner reports the old 10/100/$11 instead of lifetime 30/101/$13.10. When that new segment reaches input=30, output=120, cost=$15, `isGrown` replaces the old segment: actual lifetime becomes 30/120/$15 rather than 40/220/$26. Both wrong outputs were reproduced against the production owner/aggregator.
   - Fix direction: separate incomplete model-map detection from reset detection within a complete map. A genuine reset can lower one class while the first post-reset request already exceeds another old class. Preserve the agreed decrease rule for complete maps, or carry explicit reset evidence; add this mixed-counter regression. Simply treating every rejected map as incomplete would not recover the sealed prior spend.

## Failure modes

### Residual F2 — blocker: unchanged surviving rows still turn a truncated map into a segment

- Evidence: `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts:809`, `:676`.
- Trigger/input: accept A=100 input/$10 and B=50 input/$5, then receive an incomplete map containing only unchanged A=100/$10.
- Current handling/output: `isGrown` fails because B is absent; `isReset` passes because A did not grow. The owner seals $15 and adds $10, reporting 250 input/$25. The next complete A=120/$12+B=50/$5 replaces only the false new segment and reports 320 input/$32, instead of 170/$17. Executed in memory; both snapshots incorrectly claim complete/full coverage.
- Impact: persistent double-counting, even after complete data recovers. This is the original F2 family, not counted as an additional new defect.
- Minimal fix: a missing model plus equality of all remaining counters is not reset evidence. Reject this truncated map without changing state, as the orchestrator requires, unless a separate reset boundary establishes that the disappearance is real. Cover equality and disjoint-map ambiguity alongside the already-tested growing-row case.

### Residual F5 — major: rebind during awaited interruption makes the captured release miss its owner

- Evidence: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:802`, `:824`, `:844`, `:1139`; `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts:438`, `:518`; `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts:255`, `:276`.
- Trigger: end a newly launched query before its init message has bound the canonical ID. Teardown captures only the provisional tab's key/lease. While `query.interrupt()` is pending, the still-registered query delivers init, and its matching-token callback moves the same owner to the canonical ID. Registry binding remains possible until control deregisters after the interrupt await.
- Current handling/output: release looks up the captured old key, finds nothing, and returns false. Executed owner sequence `startNew(tab) → capture lease → rebind(tab, canonical, generation) → release(tab, lease)` returned false and left the canonical snapshot present.
- Impact: the ended session retains its prefix, runs and identities; the generation is still live, so delayed producers have not been barred by release. Repeated early-close races retain owners until backend disposal. This is residual lifecycle coverage under F5, not claimed as a newly introduced revision defect.
- Minimal fix: release the captured generation through a stable owner handle or a generation-to-current-key lookup, still checking epoch. Do not clear whichever owner happens to occupy a freshly looked-up session key. Add an adapter regression that delivers init while interrupt is awaiting.

## Five logic questions

1. **How does this fail silently?** F2 reports 320/$32 as complete/full after truncated-map recovery; N1 reports $15 instead of $26 after a real clear. Both originate at owner `:672`/`:676` and the reset predicate `:809`.
2. **What user action produces unexpected behaviour?** `/clear` after a turn dominated by output tokens can produce N1. Closing a query before init arrives can produce residual F5 (adapter `:802`, `:1139`).
3. **What input data produces a wrong answer?** An incomplete model map with an unchanged surviving row causes residual F2; a complete post-reset map with one growing and one decreasing token class causes N1 (owner `:813`).
4. **What happens when a dependency fails?** Unreadable agent files now reach coverage/identity aggregation instead of disappearing (JSONL reader `:879`, history reader `:1048`). Saved-state read failures log and return null (history reader `:386`). A slow interrupt creates the rebind/release interleaving in residual F5 (control `:255`).
5. **What is missing that the requirements never mentioned?** A teardown lease must follow the same owner across ID changes, not just protect against replacement at a fixed key (owner `:438`, `:518`). Reset and incomplete-map inference need distinguishable evidence; “no shared counter grew” does not establish a reset (owner `:809`).

## Blocking issues

- Residual F2: incomplete unchanged-row maps permanently inflate lifetime totals; detailed reproduction and fix above.
- N1: mixed-counter clear loses an entire completed segment; detailed reproduction and fix above.

## Serious issues

- Residual F5: captured-key release misses an owner rebound during interruption; detailed interleaving and fix above.

## Moderate and minor issues

None added. No style or file-length finding.

## Data flow

1. Effective auth → frozen record context: **OK**, executor `:137`/`:150`; transformer uses it at `:500`.
2. Query preparation → prefix/raw saved candidate → beginRun: **OK** for the examined serial paths, owner `:405`/`:416`; slash ordering at lifecycle manager `:581`.
3. SDK cumulative result → owner: **PARTIAL**, generation guard at transformer `:638` works; reset classification at owner `:672` has F2/N1.
4. Unreadable members → prefix → published coverage: **OK** for the reproduced priced-parent case, history reader `:1048`/`:1059` and aggregator `:282`.
5. History browse → direct aggregate: **OK**, history reader `:1006`; no owner allocation.
6. Teardown → exact lease release: **PARTIAL**, adapter `:844`; lease follows generation/epoch but not owner key changes.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Raw per-run restore base, frozen effective auth | COMPLETE | Original reproductions corrected; accepted saved-state window unchanged |
| Replace cumulative values; reject incomplete maps; seal clear segments | PARTIAL | F2 and N1 |
| Null total for missing usage, retain known subtotal, recover on complete growth | COMPLETE | Executed F3 recovery |
| Released generations reject late writes; memory release | PARTIAL | Residual F5 after rebind |
| Unreadable agent coverage and proven identities; browsing without retention | COMPLETE | Executed F6/F7 cases |

Implicit requirement still needing implementation: owner identity must survive canonical rebind for teardown purposes (owner `:438`, `:518`).

## Edge cases

| Case | Handled | Evidence/result |
| --- | --- | --- |
| Old disk candidate differs from preceding run | YES | Executed 170/$17; owner `:405` |
| Proxy rate-card dollars followed by reported raw dollars | YES | Executed $13; owner `:405` |
| Truncated map where surviving row grows | YES | Rejected unchanged, then 170/$17; owner `:672` |
| Truncated map where surviving row is unchanged | NO | 320/$32 after recovery; owner `:809` |
| Clear with mixed token-class movement | NO | $15 instead of $26; owner `:813` |
| Old result after successful owner release | YES | stale-owner/null; owner generation check used by transformer `:638` |
| Owner rebind while teardown awaits | NO | Canonical owner retained; adapter `:844`, owner `:518` |
| Failed owned file plus unknown-owner legacy file | YES | One identity; null total/$2 known/partial; history reader `:1048` |

## Verified OK

- Reran all original in-memory reproduction families using production TypeScript modules: F1–F3/F5 owner+aggregator; F4 transformer with controlled pricing collaborator; F6 real JSONL loader with injected filesystem failures and real history/ledger/aggregator; F7 real history publication and owner. No source/test files were written. A first transformer harness attempt lacked its isolated-transformer mock; that harness setup was corrected before the successful run.
- Scoped `ptah_get_diagnostics` for the agent-sdk owner returned TypeScript compiler errors: 0, warnings: 0.
- Read Revision 1, current changed paths and regression evidence. Developer-reported project-scoped tests/typecheck/lint are recorded in `batch-a-report.md:212`; no full suite was rerun.
- `onTurnEnd` remains before accounting (`stream-transformer.ts:478`); accounting runs before the optional UI callback branch (`:638`, `:683`), and the empty-usage publication guard remains (`:688`).

## Not verified

- No live Claude/proxy process or filesystem-permission integration test; filesystem failures and pricing dependencies were controlled in memory. The F5 owner sequence was executed, but the full adapter/SDK timing was traced rather than run.
- No workspace-wide or full project test/lint/build suites. Orchestrator verification was not independently rerun.
- Session-ID uniqueness across workspaces remains an existing assumption; this review does not establish a collision scenario or report one as a defect.
- History/list pricing policy remains outside scope (TASK_2026_475). Proxy alias resolution and the accepted cost-state read/start window are not defects.