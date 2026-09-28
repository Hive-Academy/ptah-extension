# Task Context - TASK_2026_569_adc1

## Background

The 443 lifecycle deleted most rows that TASK_2026_473 Track A judged relevant. On the 2026-09-26 snapshot, base-commit main scores 9/20 on Q1-Q4; only 7 of the 16 relevant rows remain in scope, and Q4 has none. The 16/20 gate from Track A can no longer be reached by any change. Define a new judged query set, record a fresh main baseline, and use it for future memory tasks.

## Evidence

Source: follow-up from TASK_2026_563_2939 (PR #601). Evidence: ../TASK_2026_563_2939/test-report.md Meas-1, harness/output/relevance-main.md and relevance-branch.md.
