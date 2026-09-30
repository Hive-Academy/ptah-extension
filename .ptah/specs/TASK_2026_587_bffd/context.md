# Task Context - TASK_2026_587_bffd

## Origin

Phase 6 of the Thoth umbrella TASK_2026_439_1310. Filed 2026-10-01. Requirements source:
`../TASK_2026_439_1310/tribunal/verdict.md` section C ("Root causes" 5, "Fix / Target", evidence card).

## Task Type

FEATURE (Thoth page + a persisted activity ledger).

## Current state (completion validation 2026-09-30)

- No Thoth Overview or "Needs attention" code exists (grep hits only in marketplace/admin UIs).
- Activity is only the in-memory emitter `libs/backend/thoth-runtime/src/lib/activity-emitter.ts`. No durable
  ledger. The surface-operation ledger in `vscode-lm-tools` is unrelated.
- Storage health (DB bytes, queue bytes, stuck age, retention) appears nowhere in the UI
  (`diagnostics.service.ts:62`, `memory-stats-strip.component.ts:25`).

## Scope (verdict "Target")

- **Overview** as the Thoth landing view:
  - *Health*: DB size, reclaimable bytes, last/next retention run, skill funnel with oldest queued age, failed
    jobs, gateway status.
  - *Needs your attention*: reclaimable storage, candidates to review with evidence, failed jobs.
  - *Recent outcomes*: newest-first, cross-subsystem rows from the ledger, in plain language.
- **Durable activity ledger**: SQLite table (next migration in `persistence-sqlite`), ULID ids, bounded
  retention hooked into the phase 1 retention job (`@ptah/memory-retention`).
- Tabs become task pages; diagnostics move under Advanced.
- Evidence card per skill: sessions, projects, cited routine, verdict, judge and trigger scores, and the exact reason
  it is pending, rejected or promoted.

## Coordination

- Depends on phase 4 (TASK_2026_586_2b3e) for event ids and grouping.
- Skill evidence fields come from TASK_2026_578_3b00 (judge gate, promotion) and the phase 5 pipeline.

## Acceptance

- Reachability proof (umbrella rule): a spec that fails if production subsystems do not write to the ledger, and one
  that fails if retention does not bound it.
- Durability: an integration spec writes events through the production path, closes and reopens the SQLite
  database, and asserts that the rows persist, every id is a valid ULID, and reads return newest-first.
- UI: visual-reviewer screenshots, dark and light, against an approved prototype.
