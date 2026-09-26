# Task Context - TASK_2026_573_e2bf

## Background

On the dev machine better-sqlite3 loads under both Node and Electron, so the node:sqlite fallback of the new real-SQLite specs (0048/0049, store, lifecycle, search, round-trip) was never exercised. Force the fallback in CI or a dedicated job and run them. Also add the Batch 6 minor case: unpin on a quarantined pinned row returns failure and pinned stays 1 after restore.

## Evidence

Source: follow-up from TASK_2026_563_2939 (PR #601). Evidence: ../TASK_2026_563_2939/test-report.md M5-6, reviews/batch-6-code-logic-review.md.
