# Gate 2 review — round 4 — scoped fix check

Reviewer: codex  
Review family: OpenAI (cross-side to the Claude architect)

| Finding | Status | Evidence (file:line) |
| --- | --- | --- |
| R3-1 — backlog reports lose the unknown-run error | PARTIAL | `implementation-plan.md:470-499,535-545` now rejects an unknown lane ID before appending and tests the tool result, but the new held-review rule loses a previously persisted hold while the store is closed (`implementation-plan.md:477-480,487-488`). |
| R3-2 — live model-not-found 404 marks the route unsupported | FIXED | `implementation-plan-part-a.md:287-307,344-358` rechecks the route with the control probe; a route-specific response keeps the row `ready` and clears a stale mark. `decisions.md:50` records the revised rule. |

## New finding

**Serious — a valid held subagent review is rejected during a later store outage.** A `deliverables` report can be applied to the durable hold table and acknowledged before its stop arrives (`implementation-plan.md:329-335,446-450`). At that point its op is no longer in the pending-hold index (`implementation-plan.md:477-478`). If the desktop/CLI store then closes or becomes unreadable, backlog `submit` cannot read that hold (`implementation-plan.md:479-480`) and returns the unknown-ID error for the matching review (`implementation-plan.md:487-488`). The review is never queued, so the eventual stop cannot join it, contrary to the held-review contract (`implementation-plan.md:335-341,359-360`; `decisions.md:45`). Preserve an independently readable, durable index of applied held-deliverables run IDs across store outages and restarts, or specify another mechanism that accepts this known hold without accepting an actually unknown review. Add a fixture: apply and acknowledge a deliverables hold, close the store, submit its review, reopen, insert the stop, and assert one joined review and `reviseRounds = 1`.

VERDICT: REVISE
