# Gate 3 Fix Report — `TASK_2026_440_834c`

Source review: `code-logic-review-branch.md` Finding 1 (Moderate) — the storage panel
rendered a past `nextDueAt` as "X min ago" in the "Next run" field.

All paths below are relative to
`D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\`.

## Finding 1 (Moderate) — "Next run" displayed a past relative time on backlog remaining

### Cause

When a retention run leaves a backlog, the backend sets `nextDueAt` to the run's
finish time (a past epoch), meaning "due at the next idle hourly tick". The panel
passed every non-null `nextDueAt` into `formatRelativeTime`, so a past value rendered
"12 min ago" in the "Next run" field.

### Change

- `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/storage-health-panel.component.ts:340-346`
  — the `nextDueText` expression in the `vm` computed is now
  `s.retention.nextDueAt !== null && s.retention.nextDueAt > now ? formatRelativeTime(...) : 'at the next idle hourly check'`.
  A `null` OR past/equal `nextDueAt` renders "at the next idle hourly check". Only a
  future `nextDueAt` renders "in <span>". A comment at `:340-342` states the backlog
  semantics of a past `nextDueAt`.

The backend is unchanged. `formatRelativeTime` keeps its generic behavior for the
other fields ("Finished", "Oldest pending", last skip), which are genuine past
timestamps.

### Spec

- `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/storage-health-panel.component.spec.ts:193`
  — new test `renders a past nextDueAt (backlog remaining) as the hourly-check wording, not a past time`.
  It renders a state with `backlogRemaining: true`, `outcome: 'partial'` and
  `nextDueAt = NOW - 12 min`, then asserts:
  - the `storage-next-due` field contains "at the next idle hourly check" (`:224-227`);
  - that field does NOT contain "ago" (`:228`), scoped to the field so the "Finished
    … ago" rows do not collide;
  - a future `nextDueAt` (`NOW + 30 min`) still renders "in 30 min" in that field
    (`:238-248`).

## Verification

Command:

```
npx nx run-many -t typecheck test lint --parallel=1 -p @ptah-extension/memory-curator-ui
```

Header confirmed 1 project:
`Running targets typecheck, test, lint for project @ptah-extension/memory-curator-ui`.

Summary:

- Typecheck: passed.
- Test: `Test Suites: 17 passed, 17 total` / `Tests: 184 passed, 184 total`.
- Lint: `0 errors, 27 warnings` — all 27 warnings are pre-existing in
  `db-health-panel.component.ts` and `vec-embedder-recovery.service.ts`(+spec). None
  are in the files this fix touched.
- Final line: `Successfully ran targets typecheck, test, lint for project @ptah-extension/memory-curator-ui`.

Per-file run
(`npx jest -c libs/frontend/memory-curator-ui/jest.config.ts --testPathPatterns storage-health-panel.component.spec`):
`Test Suites: 1 passed, 1 total` / `Tests: 11 passed, 11 total`, 0 skipped.

Test count moved from 183 to 184: one new panel spec. No test was skipped.