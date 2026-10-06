# Batch 4 report — Literal sweep, vscode-lm-tools (TASK_2026_594_31ff, Wave 1)

Status: COMPLETE — 10/10 files swept, verification grep clean. Executor: Batch 4 lane
(opencode). All dispositions for these sites in the plan's Version-literal disposition
table (implementation-plan.md:386-395) are "import constant"; all 10 were applied as
imports of `SURFACE_CATALOG_VERSION`. No site required keeping an intentional `/2`
literal (the only deliberate `/2` negative cases in the plan belong to Batch 9's
shared spec files).

## Import source note (why the subpath specifier)

The batch rule says "import `SURFACE_CATALOG_VERSION` from `@ptah-extension/shared`".
The shared root barrel deliberately does NOT re-export v2 value constants
(`libs/shared/src/index.ts:30-36`: the zod-backed contract "live[s] behind
`@ptah-extension/shared/mcp-apps-contracts`, so this barrel stays zod-free"). The
constant is exported by `libs/shared/src/mcp-apps-contracts/surface.index.ts:17`, i.e.
the package subpath `@ptah-extension/shared/mcp-apps-contracts/surface`, which is the
documented v2 API entry (`mcp-apps-contracts/index.ts:113`). This matches the style
Batch 1 already landed in this wave
(`surface-view-model.ts:2-13`, `surface-view-model.spec.ts:4-10`). So every import
added or merged below uses `@ptah-extension/shared/mcp-apps-contracts/surface`.

Merging rule applied per file:
- File already had a value import from that subpath → name merged into it, in the
  existing sort position (4 files).
- File had only a type-only import from `@ptah-extension/shared` (a value cannot be
  merged into `import type`) → one value import line added directly after the
  existing type import (5 files; two adjacent imports from the same package are an
  existing repo pattern, e.g. `dashboard-namespace.builder.spec.ts:26-27`).
- File had no import from the package at all → one value import line added next to
  the other scoped-package imports (1 file: `register.spec.ts`).

## Lines changed (per file: original line → new line, old → new)

All literal sites were positive-envelope fixtures (`schemaVersion: 'dashboard-spec/2'`
stays; `catalogVersion` now uses the constant, which Batch 1 already set to
`'dashboard-catalog/3'`). Each assertion therefore keeps asserting an accepted
spec/2+catalog/3 pair under the version-3 contract; no mismatched-pair rejection
existed in this batch's file list, so no rejection case was altered.

1. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-trust-boundary.spec.ts`
   - Inserted after :39 (now :40): `import { SURFACE_CATALOG_VERSION } from '@ptah-extension/shared/mcp-apps-contracts/surface';`
   - :53 (now :54): `    catalogVersion: 'dashboard-catalog/2',` → `    catalogVersion: SURFACE_CATALOG_VERSION,`
2. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state.store.spec.ts`
   - Merged into the subpath import block (:6-9): added `  SURFACE_CATALOG_VERSION,` before `SURFACE_STORE_LIMITS,` (now :7)
   - :23 (now :24): `      catalogVersion: 'dashboard-catalog/2',` → `      catalogVersion: SURFACE_CATALOG_VERSION,`
3. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state.service.submit.spec.ts`
   - Inserted after :13 (now :14): `import { SURFACE_CATALOG_VERSION } from '@ptah-extension/shared/mcp-apps-contracts/surface';`
   - :85 (now :86): `    catalogVersion: 'dashboard-catalog/2',` → `    catalogVersion: SURFACE_CATALOG_VERSION,`
4. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state.service.spec.ts`
   - Inserted after :14 (now :15): `import { SURFACE_CATALOG_VERSION } from '@ptah-extension/shared/mcp-apps-contracts/surface';`
   - :83 (now :84): `    catalogVersion: 'dashboard-catalog/2',` → `    catalogVersion: SURFACE_CATALOG_VERSION,`
5. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state.service.failure.spec.ts`
   - Inserted after :14 (now :15): `import { SURFACE_CATALOG_VERSION } from '@ptah-extension/shared/mcp-apps-contracts/surface';`
   - :43 (now :44): `    catalogVersion: 'dashboard-catalog/2',` → `    catalogVersion: SURFACE_CATALOG_VERSION,`
6. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state-reader.spec.ts`
   - Merged into the subpath import block (:8-12): added `  SURFACE_CATALOG_VERSION,` before `SURFACE_LIMITS,` (now :9)
   - :70 (now :71): `      catalogVersion: 'dashboard-catalog/2',` → `      catalogVersion: SURFACE_CATALOG_VERSION,`
7. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state-reader.budget.spec.ts`
   - Merged into the subpath import block (:20-25): added `  SURFACE_CATALOG_VERSION,` before `SURFACE_LIMITS,` (now :21)
   - :50 (now :51): `      catalogVersion: 'dashboard-catalog/2',` → `      catalogVersion: SURFACE_CATALOG_VERSION,`
8. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/di/register.spec.ts`
   - Inserted after :53 (now :54): `import { SURFACE_CATALOG_VERSION } from '@ptah-extension/shared/mcp-apps-contracts/surface';`
   - :342 (now :343): `          catalogVersion: 'dashboard-catalog/2',` → `          catalogVersion: SURFACE_CATALOG_VERSION,`
9. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/surface-namespace.builder.spec.ts`
   - :4 (in place): `import { SURFACE_LIMITS } from '@ptah-extension/shared/mcp-apps-contracts/surface';` → `import { SURFACE_CATALOG_VERSION, SURFACE_LIMITS } from '@ptah-extension/shared/mcp-apps-contracts/surface';`
   - :15 (unchanged position): `    catalogVersion: 'dashboard-catalog/2',` → `    catalogVersion: SURFACE_CATALOG_VERSION,`
10. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.surface.spec.ts`
    - Inserted after :20 (now :21): `import { SURFACE_CATALOG_VERSION } from '@ptah-extension/shared/mcp-apps-contracts/surface';`
    - :39 (now :40): `    catalogVersion: 'dashboard-catalog/2',` → `    catalogVersion: SURFACE_CATALOG_VERSION,`

## Sites I could not change

None. All 10 listed sites were changed; nothing was left as an intentional `/2`
literal (batches.md names no such case for Batch 4).

## Verification (batch-local, per instructions; no test suites run)

- `grep "dashboard-catalog/2"` over
  `libs/backend/vscode-lm-tools` → **0 hits** (not just my 10 files: the whole lib,
  including the Batch-6-owned `surface-tools.ts`, `surface-tools.spec.ts` and
  `dashboard-propose-spec.tool.spec.ts`, which were NOT touched by me and already
  hold no `/2` literal).
- `grep "SURFACE_CATALOG_VERSION"` over the lib's `*.spec.ts` → each of my 10 files
  has exactly one import and one usage (23 hits total = my 20 + 3 pre-existing in
  Batch 6's `surface-tools.spec.ts:14,157,331`, untouched).
- No other lines were modified in any file; no reformatting; no files outside the
  Batch 4 list were touched (`batches.md`, `surface-tools.*`,
  `dashboard-propose-spec.tool.spec.ts`, and all Batch 1/2/3 files untouched by me).
- Per the task instructions and batches.md, the Wave 1 typecheck/test/lint gate is
  run by the team-leader after Batches 1-4 all report, so no suite was run here.

## Files modified (absolute paths, 10)

- D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-trust-boundary.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state.store.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state.service.submit.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state.service.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state.service.failure.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state-reader.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state-reader.budget.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/di/register.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/surface-namespace.builder.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.surface.spec.ts
