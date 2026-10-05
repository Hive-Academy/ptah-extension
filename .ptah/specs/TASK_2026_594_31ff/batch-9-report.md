# Batch 9 report — shared contract, validator and budget regressions (plan B)

Executor: backend-developer lane. Worktree root:
`D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds`.
Files touched: exactly the three Batch 9 spec files. `batches.md` was not edited
by this lane (its working-tree diff is the orchestrator's Batch 10 bookkeeping).

## Tasks

### Task 9.1: Contract spec — DONE

File: `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-contract.spec.ts`

- Replaced the alias identity and the 13-count with three checks
  (`surface-contract.spec.ts:45-59`): the v1 `DASHBOARD_COMPONENT_KINDS` are a
  prefix of `SURFACE_DISPLAY_KINDS` (slice equality); none of the six new kinds
  (`alert`, `badge`, `progress`, `radial-progress`, `divider`, `text-block`)
  is in `DASHBOARD_COMPONENT_KINDS`; `SURFACE_COMPONENT_KINDS` has length 19.
- Added `expect(SURFACE_CATALOG_VERSION).toBe('dashboard-catalog/3')` (`:46`),
  pinning AC 9 directly.
- Pair-table literal at the old `:63` now uses the imported constant
  (`:76`: `['dashboard-spec/2', SURFACE_CATALOG_VERSION]`); the v1 pair row is
  unchanged.
- Import of the constant merged into the existing `./surface-catalog` import
  (`:20`).

### Task 9.2: Validator spec — DONE

File: `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-validator.spec.ts`

- The four `dashboard-catalog/2` sites (old `:241, :257, :263, :286`) now use
  `SURFACE_CATALOG_VERSION`. The old `:286` case is relabelled
  `'v1 schema with the v3 catalog (does not pair)'` (`:286`) and exercises the
  does-not-pair branch.
- Kept an explicit `/2` negative pair case (`:300-315`): `spec/2` +
  `catalog/2` returns `ok:false`, `field:'catalogVersion'`, and the reason names
  `dashboard-catalog/3` — through `validateSurfaceEnvelopeVersions` and through
  the full `update` create path (`surface.catalogVersion`). This is the only
  remaining `dashboard-catalog/2` literal in the file.
- Added a dedicated `spec/1` + `catalog/3` case asserting the reason contains
  `does not pair` (`:317-323`). `spec/1` + `/1` stays unchanged in the
  existing table (the `v1` row, `ok: true`).
- New describe `surface validator — status and text kinds (TASK_2026_594)`
  (`:460`-`:648`), covering every named acceptance case:
  - minimal valid case per kind, accepted by both `validateSurfaceDocument` and
    `validateSurfaceUpdateInput` (6 `it.each` cases);
  - optional `alert.title` and `divider.text` accepted; progress value
    extremes 0 and 100 accepted;
  - badge with only `dashboard.select` actions (with params) accepted;
  - unknown tone on all four toned kinds, unknown divider `direction`, unknown
    text-block `role` — each rejected with the `components.0.<field>` path;
  - per kind (6 `it.each` cases), `class`, `style`, `html`, `path`, `data` and
    an extra key each reject the whole document, on both the document and the
    create path, and the reason names the key;
  - progress and radial-progress value `-1`, `101`, `NaN`, `Infinity` and the
    string `'50'` rejected (`components.0.value`), 5 `it.each` cases;
  - badge action `dashboard.open-url`, `surface.submit`, and a
    `dashboard.select` action carrying `url` all rejected at
    `components.0.actions`;
  - empty and over-`maxStringLength` text-block text rejected, one exactly at
    the limit accepted;
  - a v1 document (`dashboard-spec/1` + `/1`) naming any of the six kinds is
    rejected by `validateDashboardSpec` with a `components.0` reason.
- `spec/2` + `catalog/3` accepting the pre-existing kinds is covered by the
  unchanged populated-document/create tests, which run on the `/3` fixture.
- Imports merged: `makeDashboardSpec`, `SURFACE_CATALOG_VERSION`,
  `validateDashboardSpec`.

### Task 9.3: Budget spec — DONE

File: `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-budgets.spec.ts`

- The `envelope()` literal at the old `:50` uses the imported constant (`:50`);
  import merged into the existing `./surface-catalog` import (`:20`).
- New boundary cases in the at-limit/one-over table (all values read from
  `SURFACE_LIMITS`, no limit widened):
  - `maxActionsPerComponent (badge select actions)` (`:202`) — badge actions at
    the limit accepted, one more rejected (`components.0.actions`);
  - `maxComponents (alert status kinds)` (`:229`) — 200 alert components
    accepted, 201 rejected;
  - `maxComponentIdLength (badge)` (`:247`);
  - `maxStringLength (text-block text)` (`:264`) — at 2000 accepted, 2001
    rejected.
- New byte case in the byte-budget describe (`:583`): a surface of alert
    components sized to exactly `maxSurfaceBytes` is accepted, one byte more is
    rejected naming `maxSurfaceBytes` — built with the existing `exactBytes`
    helper, on both the document and the create path.

## Verification (Batch 9 gate — full suite, no exclusions)

Command (worktree root):

```
npx nx run-many -t typecheck,test,lint -p shared
```

Result: `Successfully ran targets typecheck, test, lint for project
@ptah-extension/shared`. Jest inside the gate: `Test Suites: 105 passed, 105
total; Tests: 2965 passed, 2965 total` (the three specs were previously excluded;
they now run with no exclusions, lifting the last shared gate narrowing).

Literal sweep check:

```
grep -rln "dashboard-catalog/2" libs apps --include=*.ts
```

Result: only `libs/frontend/declarative-dashboard/src/lib/view-model/surface-view-model.spec.ts`
(Batch 1's deliberate negative case) and
`libs/shared/src/mcp-apps-contracts/surface-validator.spec.ts` (the deliberate
`/2` negative pair case required by the batch). The contract and budget specs no
longer hold the literal.

Working tree: only the three spec files are modified by this lane
(`git status --porcelain` shows them plus the orchestrator's `batches.md`).

## Risk handling

- **Test-gate narrowing (review note 1).** Lifted: the gate ran the full shared
  suite. Note discovered while verifying: in this jest version the positional
  pattern after `--testPathIgnorePatterns` is consumed as a second ignore
  pattern, so the Wave-1-style command silently still excludes the three specs;
  the nx gate (no ignore patterns) is the run that proves the lift. Both were
  run; the nx gate is the evidence above.
- **Version-literal drift (HIGH risk).** All four validator sites, the contract
  pair-table literal and the budgets envelope literal now derive from the one
  constant; exactly one deliberate `/2` negative remains, asserted to name `/3`.
  Confirmed by the final grep.
- **Q1 pair rejection.** `spec/2` + `catalog/2` is rejected through the
  unknown-catalog branch with `field:'catalogVersion'` and a reason naming
  `/3`, on both the version-check function and the full update path.
- **`spec/1` + `catalog/3` "does not pair"** — dedicated case asserts the reason
  text reaches the pair-mismatch branch, not the unknown branch.
- **Trust boundary (class/style/html/path/data/extra keys).** Rejected per kind
  on both entry paths, with the offending key named in the reason — strictness
  proven, no partial render.
- **Value range and finiteness.** -1, 101, NaN, Infinity and a string value are
  rejected for both progress kinds; 0 and 100 are accepted at the extremes.
- **Badge action restriction (Q2).** Only `dashboard.select` badge actions are
  accepted; `surface.submit`, `dashboard.open-url` and any action with `url`
  are rejected; the positive case includes params through `actionParams()`.
- **Text-block string budget.** Empty and over-`maxStringLength` text rejected,
  at-limit accepted — the shared RichText schema was not loosened.
- **v1 boundary (AC 8).** A `dashboard-spec/1` document naming any new kind is
  rejected; the contract spec asserts the v1 kind list is untouched and only a
  prefix of the v2 display tuple.
- **No budget widening.** Every new budget case reads `SURFACE_LIMITS`; no
  constant was changed (`git diff` touches no non-spec source).

## Files modified (absolute paths)

- `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-contract.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-validator.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-budgets.spec.ts`

All three tasks are done. Nothing was skipped and no stubs were left.