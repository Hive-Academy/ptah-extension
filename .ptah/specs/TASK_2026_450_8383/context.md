# TASK_2026_450_8383 — context

## Triage 2026-10-30

Backlog audit after the October refactors: partly delivered, still open.

- Still open: Show AC-7 stays green twice beside another heavy project. The 15s load margin may still be a timeout bump rather than a fix of a slow or racy recovery.
- Evidence on main: The flat 15s deadline named in the task is gone. c0670a9e8 (2026-09-16, test(platform-electron): re-probe delivery after watch host recovery) re-probes and sets DEGRADED_DELIVERY_TIMEOUT_MS to recovery delay + ack window + batch intervals + DEGRADED_RECOVERY_LOAD_MARGIN_MS 15000 (workspace-watch-host.stress.harness.ts:743-751). runDegradedPastBudgetScenario is still the AC-7 test.
