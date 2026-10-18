# Gate 2 review — round 6 — scoped fix check (R5-1)

Reviewer: codex  
Review family: OpenAI (cross-side to the Claude architect)

| Finding | Status | Evidence (file:line) |
| --- | --- | --- |
| R5-1 — capacity counted runs rather than held reports during a store outage | FIXED | `implementation-plan.md:482-489,491-514,530-545,608-618`; `decisions.md:55`. Each held report, including a review, contributes one unexpired expiry value. Pending report holds are added to that count, and a 501st hold returns the capacity error without a journal append. The plan covers restart, partial expiry and reconciliation from the table at open. |

## New finding

**Moderate — readable-store capacity can count expired rows until the sweep runs.** `implementation-plan.md:342-345,513-514,538-545` specifies that expiry cleanup runs at most once per 60 seconds and reconciliation selects unexpired rows, but the readable-store branch of the capacity check says to count the table's rows without an `expires_at > now` filter. If an expired row remains between sweeps, a submission at the nominal cap can receive `too many held reports` even though fewer than 500 holds are unexpired. **Fix:** count only unexpired table rows for capacity, and ensure expired rows are removed before applying a newly accepted hold. This does not affect the closed-store 501st-report case that R5-1 addressed.

VERDICT: APPROVED
