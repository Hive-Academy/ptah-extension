# Task Context - TASK_2026_572_07c4

## Background

Quarantined memories can be listed and restored only through memory:listQuarantined and memory:restoreQuarantined, reachable from the CLI via ptah interact rpc.call. Add a quarantine view with restore actions in the memory UI (Electron) and a ptah CLI subcommand. Restore requires an explicit authorized workspace or explicit null for NULL-workspace rows.

## Evidence

Source: follow-up from TASK_2026_563_2939 (PR #601). Evidence: ../TASK_2026_563_2939/implementation-plan.md component 8.
