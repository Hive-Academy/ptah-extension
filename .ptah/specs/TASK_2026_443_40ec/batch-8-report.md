# Batch 8 report — memory-curator-ui lifecycle diagnostics

## Task 8.1 — storage panel rows

Implemented the two read-only lifecycle rows in the existing OnPush storage panel.

- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\storage-health-panel.component.ts`
  - The `Last retention run` definition list now renders `Memories` as `archived <a> · deleted <d> · evicted <e>` with `formatCount`.
  - The `Retention settings` definition list now renders `Memory lifecycle` with the configured archive age, delete age and workspace cap plus exactly one status line in `data-testid="storage-memory-lifecycle"`.
  - The component remains standalone and `ChangeDetectionStrategy.OnPush`; it adds no settings write and no raw HTML binding.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\storage-health-panel.component.spec.ts`
  - Covers the populated last-run counters and all four lifecycle rendering states.

Rendered-state evidence:

- Populated preview: `archive after 30 d · delete after 60 d · cap 25,000` followed by `next run: 1,234 to archive · 56 to delete · up to 7 over cap`.
- Null preview: `preview after the first run`.
- Disabled: `off (preview only)`.
- Vector unavailable: `deletes paused: vector extension unavailable`.
- All exceptional states are carried by text, not colour.

## Task 8.2 — decay UI/state removal

Removed the dead decay tile, state signal/assignment and event-specific tone, and updated all affected frontend fixtures.

- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\memory-diagnostics-accordion.component.ts`
  - Removed the `Last decay sweep` tile, `lastDecay` binding and `lastDecayLabel` computed value.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\memory-diagnostics-accordion.component.spec.ts`
  - Removed the decay signal fixture and now asserts `[data-testid="last-decay-run"]` is absent.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\frontend\memory-curator-ui\src\lib\services\memory-diagnostics-state.service.ts`
  - Removed `_lastDecay`, its public signal and the diagnostics refresh assignment.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\frontend\memory-curator-ui\src\lib\services\memory-diagnostics-state.service.spec.ts`
  - Removed decay snapshot assertions and replaced the decay event fixture with an ordinary `manual-run` event.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\event-feed.component.ts`
  - Removed the decay-specific switch case. The temporary default remains the neutral `info` tone while Batch 9 still carries the shared event union member.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\frontend\memory-curator-ui\src\lib\services\memory-diagnostics-rpc.service.spec.ts`
  - Removed the obsolete decay fields from untyped RPC payload fixtures.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\frontend\memory-curator-ui\src\lib\components\memory-curator-tab.component.spec.ts`
  - Removed the obsolete decay signal from the diagnostics-state stub.

No new `catch` or `.catch` path was added, so XB2 required no new degradation annotation. The audit baseline did not grow.

## Verification

### `npx nx run-many -t test -p @ptah-extension/memory-curator-ui` — first run

```text
NX   Running target test for project @ptah-extension/memory-curator-ui:
- @ptah-extension/memory-curator-ui

FAIL storage-health-panel.component.spec.ts
Tests: 2 failed, 186 passed, 188 total
NX   Running target test for project @ptah-extension/memory-curator-ui failed
Exit code: 1
```

The first run exposed two Batch 8 issues: concatenated accessible text between the lifecycle lines and an older inline `lastRun` fixture missing the three new counters. Both were corrected in the assigned component/spec.

### `npx nx run-many -t test -p @ptah-extension/memory-curator-ui` — corrected run

```text
NX   Running target test for project @ptah-extension/memory-curator-ui:
- @ptah-extension/memory-curator-ui

Test Suites: 17 passed, 17 total
Tests:       188 passed, 188 total
Snapshots:   0 total
NX   Successfully ran target test for project @ptah-extension/memory-curator-ui
Exit code: 0
```

### `npx nx run-many -t test -p @ptah-extension/memory-curator-ui` — final run after readonly fixture cleanup

```text
NX   Running target test for project @ptah-extension/memory-curator-ui:
- @ptah-extension/memory-curator-ui

Test Suites: 17 passed, 17 total
Tests:       188 passed, 188 total
Snapshots:   0 total
NX   Successfully ran target test for project @ptah-extension/memory-curator-ui
Exit code: 0
```

### `npx nx run-many -t typecheck -p @ptah-extension/memory-curator-ui`

```text
NX   Running target typecheck for project @ptah-extension/memory-curator-ui:
- @ptah-extension/memory-curator-ui

> npx ngc --noEmit --project libs/frontend/memory-curator-ui/tsconfig.lib.json
NX   Successfully ran target typecheck for project @ptah-extension/memory-curator-ui
Exit code: 0
```

### `npx nx run-many -t lint -p @ptah-extension/memory-curator-ui` — initial and final runs

```text
NX   Running target lint for project @ptah-extension/memory-curator-ui:
- @ptah-extension/memory-curator-ui

Linting "@ptah-extension/memory-curator-ui"...
✖ 27 problems (0 errors, 27 warnings)
NX   Successfully ran target lint for project @ptah-extension/memory-curator-ui
Exit code: 0
```

Both runs produced the same 27 existing explicit-member-accessibility warnings in `db-health-panel.component.ts`, `vec-embedder-recovery.service.ts` and `vec-embedder-recovery.service.spec.ts`; no warning points to a Batch 8 edit.

### `npx nx run degradation-audit:lint`

```text
> nx run degradation-audit:lint
> npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts

degradation-audit: scanned 2849 file(s)
libs/frontend/memory-curator-ui: 15 ok (baseline 15)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX   Successfully ran target lint for project degradation-audit
Exit code: 0
```

### Frontend non-spec symbol search

Command:

```text
rg -n "lastDecay|decay-run" libs/frontend --glob "*.ts" --glob "!*.spec.ts"
```

Output:

```text
NO MATCHES: libs/frontend non-spec .ts files contain neither lastDecay nor decay-run
Exit code normalized to 0 after confirming rg's no-match exit code was 1.
```

## Supplemental diagnostics

The scoped Ptah TypeScript diagnostics pass reports no error in Batch 8 production files. It still reports four unrelated pre-existing spec-only errors in `corpus-build-dialog.component.spec.ts` and `memory-rpc.service.spec.ts`; the required Nx test target and production `ngc` typecheck both pass. No out-of-scope file was edited.

## Plan deviations

None. The implementation follows Component 10 and Batch 8. The shared DTO/event declarations remain untouched for Batch 9.
