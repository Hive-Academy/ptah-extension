# Gate 2 review — round 5 — scoped fix check (R4-1)

Reviewer: codex  
Review family: OpenAI (cross-side to the Claude architect)

| Finding | Status | Evidence (file:line) |
| --- | --- | --- |
| R4-1 — an acknowledged deliverables hold is forgotten when the store closes | FIXED | `implementation-plan.md:479-507,515-518,575-587`; `decisions.md:52`. The journal key retains an independently readable `heldRuns` entry after the hold op is acknowledged. A closed store can return `held` for its review; an unknown ID still errors. The fixture covers close, restart, reopen, join, and expiry. |

## New finding

**Serious — the backlog hold-cap check counts runs instead of held reports.** `implementation-plan.md:482-485,494,523-525` stores one `heldRuns` entry per run and uses the number of those entries plus pending holds to enforce capacity while the store is unreadable. The actual limit is 500 *reports* (`implementation-plan.md:330-344`; `decisions.md:45`). A single `subagent:` run can have 500 distinct held `deliverables` reports (`report_id` is the hold-table primary key). Its index has one entry. With the store closed, a 501st deliverables report passes the new capacity check and returns `held` (`implementation-plan.md:516`); when applied, the store refuses it and the pipeline dead-letters it (`implementation-plan.md:526-530`). That success-looking tool result contradicts the promised immediate refusal of the 501st hold. **Fix:** persist an exact unexpired held-report count per run, including held reviews, in the independently readable journal metadata; update it on hold, join, and expiry, and reconcile it from the table at open. Count those reports plus pending report holds before accepting a new hold. Add a fixture with 500 held reports for one run, a closed store, and a 501st submission that returns the capacity error without a journal append.

VERDICT: REVISE
