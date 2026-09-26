# Task Context - TASK_2026_574_c230

## Background

libs/backend/rpc-handlers/src/lib/harness/selection/harness-skill-selection-rpc.service.spec.ts > never writes state.json fails before the service runs when %TEMP%/.ptah exists on the host. The files are identical to base ebfc73321, so this is test isolation, not a product defect. Use a per-test temp directory.

## Evidence

Source: follow-up from TASK_2026_563_2939 (PR #601). Evidence: ../TASK_2026_563_2939/test-report.md scoped verification.
