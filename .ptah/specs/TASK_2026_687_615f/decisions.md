# Decisions - TASK_2026_687_615f

| # | Decision | Evidence | Reversible |
| --- | --- | --- | --- |
| 1 | Scope = all open Moderates (logic + visual) + r3 Moderates of TASK_686 + Space key + top-bar tab icon; Minors recorded only. Announced to the user before start. | user request; orchestration rule 4. | yes |
| 2 | Stack the branch on PR #741 because the same files change. | git overlap. | yes |
| 3 | Plan first (codex) with a cross-side Anthropic review, because the controller is at 695/700 lines and most logic items touch it. | max-lines rule; style M1. | yes |
| 4 | Plan Gate 2: codex plan, Anthropic reviews REVISE (13 items) -> REVISE (4) -> REVISE (1 Serious: the Stop fallback timer). Cap reached; the USER chose (2026-10-17) "Remove timer, go". The orchestrator removed the timer from the plan; R3-3 scope = idle grace timer only, because page Stop already recovers (controller :496-498). | implementation-plan-re-review-2.md; AskUserQuestion answer. | yes |
