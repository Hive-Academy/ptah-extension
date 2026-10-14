# Epic: Thoth UI (P2)

Created 2026-10-12 by the memory and skills backlog triage (code audit against `main`, codex cross-review).
This epic takes over the last open phase of TASK_2026_439 (phase 6, TASK_2026_587). TASK_2026_439 is closed.

## Children, in suggested order

| Pri | Task | Problem today (evidence) | Size | Depends on |
|---|---|---|---|---|
| P2 | TASK_2026_572 | `memory:listQuarantined` / `memory:restoreQuarantined` exist (`memory-rpc.handlers.ts`) but no UI or CLI surface calls them. | S | - |
| P2 | TASK_2026_587 | Thoth Overview (Health, Needs your attention, Recent outcomes) and a durable activity ledger. No ledger code exists yet. Natural home for the quarantine list. | L | - |
| P2 | TASK_2026_517 | A retention fault shows only inside the Memory tab (`storage-health-panel.component.ts:329`). Choose an active, de-duplicated channel with recovery reset. | M | - |
| P3 | TASK_2026_641 | TUI MemoryPanel shows no storage data; diagnostics dates use an unpinned locale (`memory-diagnostics-accordion.component.ts:362`). Merged from 444 + 445. | XS | - |
| P3 | TASK_2026_457 | One failed count read nulls the whole lifecycle preview (`memory-storage-health.ts:139-152`). | S | - |
| P4 | TASK_2026_266 | Memory graph and vector-space explorer. Old spec with stale numbers; decide after 587 settles the Memory tab layout. | XL | 587 |

## Rescope (2026-10-14, TASK_2026_659_cec4)

Remove the skill-synthesis tabs (Recommended, Sessions, Activity, synthesis Settings) from scope. Keep memory, the Library (manual skill and agent editing) and quarantine restore.
Evidence: `.ptah/specs/TASK_2026_659_cec4/evaluation-report.md` and `task-triage.md`. Approved by the user on 2026-10-14.
