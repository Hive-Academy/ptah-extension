# Context: TUI storage health and pinned diagnostics locale

Merged on 2026-10-12 from two TASK_2026_440 review follow-ups (both now `cancelled`, `duplicates` this task).
Full original scope: `../TASK_2026_444_1078/` and `../TASK_2026_445_6ece/`.

## Scope

1. From 444: `apps/ptah-tui/src/components/thoth/MemoryPanel.tsx` consumes `MemoryDiagnosticsResult` but does
   not render its `storage` field. Show DB size, reclaimable bytes, queue, stuck age, and last and next
   retention run.
2. From 445: `formatSnapshot` in `memory-diagnostics-accordion.component.ts:362` calls `toLocaleString()` with
   no locale, while `storage-health-panel.component.ts:48` pins `'en-US'`. Pin it. `corpus-list`,
   `timeline-view` and `memory-curator-tab` also use a bare `toLocaleString()`: fold them in or exclude them
   on purpose.

## Acceptance

- The TUI Memory panel shows the storage block with the same fields as the Electron panel.
- No memory UI date or number formatter depends on the machine locale (spec with a non-en-US locale).
