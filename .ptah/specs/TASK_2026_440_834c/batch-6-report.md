# Batch 6 — Frontend storage + retention panel

Branch `feat/task-440-memory-retention`, worktree `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention`.
Scope: render the new required `storage` block of `memory:diagnostics` in the Memory tab diagnostics accordion.

## Task 6.1 — StorageHealthPanelComponent (CREATE)

### Files

- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\storage-health-panel.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\storage-health-panel.component.spec.ts`

### Evidence

Component (`storage-health-panel.component.ts`):

- :108 — selector `ptah-storage-health-panel`, standalone, `ChangeDetectionStrategy.OnPush` (:109), `imports: [NativeCardComponent]` (:110).
- :113 — `<section aria-label="Storage and retention">` with `<h3>` heading (:115 "Storage and Retention").
- :284 — `public readonly storage = input<MemoryStorageHealthDto | null>(null)`; :287 — `now` input (clock for relative times; `null` → real clock).
- :289 — single `computed()` view-model `vm` producing all rendered strings; null input → `null` VM → `data-testid="storage-empty"` "No storage data yet." (:263).
- :27 — `formatBytes` (local PURE, exported; binary 1024 steps, `null` → `—`).
- :43 — `formatCount` (local PURE, `null` → `—`).
- :61 — `formatRelativeTime` (local PURE, past/future, `null` → `—`). No shared formatter imported; the marketplace one is private.
- Cards rendered: Database size (dbBytes + reclaimableBytes, :120), Pending observations (rows/size/oldest-pending age, :131), Quarantine (stuckEligibleRows, quarantineLedgerRows, :149), Processed observations labelled "as of last retention run · estimate" (:176 footer), Last retention run (:186 — finished relative, badge carrying the outcome TEXT plus class success/warning/error, purged/quarantined/pages reclaimed, reason for `partial` / error for `failed`, :216), Retention settings (enabled, processedDays, stuckDays, nextDueAt with null → "at the next idle hourly check", :229), last-skip footer (:240), readErrors muted list (:249).
- No settings writes, no RPC calls, no `[innerHTML]`.

Spec (`storage-health-panel.component.spec.ts`, `makeStorage` factory :16, `render()` helper sets inputs via `fixture.componentRef.setInput` :56–58):

- :70 `renders the null state when no storage data is supplied`
- :78 `marks the section with aria-label "Storage and retention"`
- :85 `renders "—" for null fields` (all-nullable storage DTO)
- :112 `renders a partial run with its badge text and reason` (badge text `partial` + `badge-warning`, "Reason: row purge failed mid-batch")
- :131 `renders a failed run with its badge text and error` (badge text `failed` + `badge-error`, "Error: SQLITE_BUSY: database is locked")
- :153 `renders the completed-run badge, run counts and relative times` (`completed`/`badge-success`, "2 h ago", "in 30 min", purge counts, "as of last retention run", "estimate")
- :167 `renders last skip time and reason when a skip is recorded` ("10 min ago", skip reason, next-due null → "at the next idle hourly check")
- :193 `formats bytes across scales via the pure formatter` (0 → `0 B`, 1023 → `1023 B`, 1536 → `1.5 KB`, 1374389535 → `1.28 GB`, null → `—`)
- :201 `renders formatted byte values for db size and pending size` (`1.28 GB` db size, `2 KB` pending size in the DOM)
- :212 `renders "—" for pending size and lists readErrors when the backlog is too large to measure` (pendingBytes null → `—`, readError `pendingBytes: not measured above 5000 pending rows` listed, `6,204` pending rows, "3 days ago")

Jest: `storage-health-panel.component.spec.ts` — **10 passed, 10 total, 0 skipped, 0 failed**.

## Task 6.2 — State service + wiring (MODIFY)

### Files

- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\frontend\memory-curator-ui\src\lib\services\memory-diagnostics-state.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\frontend\memory-curator-ui\src\lib\services\memory-diagnostics-state.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\frontend\memory-curator-ui\src\lib\services\memory-diagnostics-rpc.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\memory-diagnostics-accordion.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\memory-diagnostics-accordion.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\frontend\memory-curator-ui\src\lib\components\memory-curator-tab.component.spec.ts`

### Evidence

- `memory-diagnostics-state.service.ts:35` — `private readonly _storage = signal<MemoryStorageHealthDto | null>(null)` next to `_dbHealth`; :44 — `public readonly storage = this._storage.asReadonly()`; :75 — `this._storage.set(snapshot.storage)` in `refresh()` right after `_dbHealth.set`. Import added at :7.
- `memory-diagnostics-state.service.spec.ts:40` — `baseStorage` fixture; :76 — `storage: baseStorage` in the snapshot fixture; :135 — `expect(service.storage()).toEqual(baseStorage)` after refresh.
- `memory-diagnostics-rpc.service.spec.ts:23` — shared `baseStorage` const; :77 and :115 — both `diagnostics()` payload fixtures now carry `storage: baseStorage`.
- `memory-diagnostics-accordion.component.ts:26` — import; :36 — added to `imports`; :176 — `<ptah-storage-health-panel [storage]="storage()" />` mounted directly after `<ptah-db-health-panel [health]="dbHealth()" />` (:174); :229 — `protected readonly storage = this.state.storage`.
- `memory-diagnostics-accordion.component.spec.ts:44` — `storage` signal added to the state stub; reset to `null` in `beforeEach`; :140 — new test `renders the storage health panel from the state storage signal` asserting the `ptah-storage-health-panel` element renders with "Storage and Retention" content (:172). :120 — panel-count test updated to "seven panels".
- `memory-curator-tab.component.spec.ts:23` — `diagnosticsStateStub()` gains `storage: signal(null).asReadonly()`.

### Per-file Jest results (all 0 skipped)

| Spec file | Suites | Tests |
|---|---|---|
| `storage-health-panel.component.spec.ts` | 1 passed | **10 passed**, 0 skipped |
| `memory-diagnostics-state.service.spec.ts` | 1 passed | **12 passed**, 0 skipped |
| `memory-diagnostics-accordion.component.spec.ts` | 1 passed | **22 passed**, 0 skipped |
| `memory-curator-tab.component.spec.ts` | 1 passed | **18 passed**, 0 skipped |

Combined 4-file run: `Test Suites: 4 passed, 4 total` / `Tests: 62 passed, 62 total` (10 + 12 + 22 + 18).

## Verification

Command:

```
npx nx run-many -t typecheck test lint --parallel=1 -p @ptah-extension/memory-curator-ui
```

Header: `Running target test for project @ptah-extension/memory-curator-ui:` — **1 project**.

Output summary:

- `typecheck` (`npx ngc --noEmit`) — **passed**, no errors.
- `test` — **17 suites passed / 17 total, 182 tests passed / 182 total** (28.1 s).
- `lint` — **0 errors, 27 warnings**; every warning is pre-existing in `db-health-panel.component.ts` and `vec-embedder-recovery.service.ts`(+spec), files this batch did not touch. No warning names any file edited here.
- Nx: `Successfully ran targets typecheck, test, lint for project @ptah-extension/memory-curator-ui`.

Per-file runs done via direct jest invocations against `libs/frontend/memory-curator-ui/jest.config.ts` with the four spec paths (summary lines printed to stderr); counts in the table above.

## Notes

- `formatCount` uses `toLocaleString()` for row counts (matches `formatSnapshot` in the accordion, which already relies on locale formatting). Node's full-ICU grouping is asserted by the `6,204` expectation.
- Relative-time rendering is deterministic in specs through the `now` input; the accordion does not bind it, so production uses the real clock (same trade-off as the event feed's `now`).
- No backend imports, no new public API entries, no `index.ts` change — the panel is internal like `DbHealthPanelComponent`, imported directly by the accordion.