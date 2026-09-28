# Task Context - TASK_2026_566_9a50

## Background

D4 in TASK_2026_563: option B (shipped) runs tier-2 searchRich only when tier 1 is non-empty, so no pass makes a resolve LLM call that main would not make. On the fixed 23-draft replay: Before 8/23 (34.78%), B 7/23 (30.43%), A 20/23 (86.96%) with +15 resolve calls (per-draft upper bound; production is one resolve call per pass). The owner must choose A or B; A is a one-line change in MergeCandidateCollector.collect (remove the tier1-empty early return). Before switching, measure the real per-pass call increase and check merge precision on the A merges.

## Evidence

Source: follow-up from TASK_2026_563_2939 (PR #601). Evidence: ../TASK_2026_563_2939/test-report.md M3-8(b), harness/output/m3-replay.md, implementation-plan.md D4.
