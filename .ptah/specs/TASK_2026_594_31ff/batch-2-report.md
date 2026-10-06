# Batch 2 Report — Literal sweep: declarative-dashboard specs + Apps literals II

**Status: COMPLETE.** 11/11 files swept. Task 2.1 (plan G1 + G6b, 7 files) and Task 2.2 (plan G3, 4 files) both done. No site was left unchanged; no other lines were touched.

## Method

Per the batches.md Batch-2 rule, each `'dashboard-catalog/2'` string literal was replaced with the imported `SURFACE_CATALOG_VERSION`, merged into the file's existing import from the `@ptah-extension/shared` package. One deviation from the letter of the rule, with evidence:

- The root barrel `@ptah-extension/shared` (`libs/shared/src/index.ts:30-36`, comment "the zod schemas ... live behind `@ptah-extension/shared/mcp-apps-contracts`, so this barrel stays zod-free") deliberately does **not** re-export the contract's runtime constants. The constant is exported from `@ptah-extension/shared/mcp-apps-contracts` (`libs/shared/src/mcp-apps-contracts/index.ts:116`) and `@ptah-extension/shared/mcp-apps-contracts/surface` (`libs/shared/src/mcp-apps-contracts/surface.index.ts:17`).
- Therefore "merging into the existing import from that package" was applied to the subpath import each file already uses — the exact pattern Batch 1 landed in `libs/frontend/declarative-dashboard/src/lib/view-model/surface-view-model.ts:5` and `surface-view-model.spec.ts:6` (import from `@ptah-extension/shared/mcp-apps-contracts/surface`).
- Where the file's existing import from that path was type-only, it was converted to a value import with inline `type` markers (an existing repo style, e.g. `surface-layout.component.spec.ts:3` before this batch) rather than adding a second import statement. This keeps one import per module per file, as the rule's "merging into the existing import" intends.
- Member order follows the repo's case-insensitive alphabetical convention (matches Batch 1's landed import in `surface-view-model.spec.ts:4-10`).
- No lint import-sort rule exists at the root eslint config; no module-boundary rule was crossed (every file already imported from the same `@ptah-extension/shared*` paths).

Batch 1's `SURFACE_CATALOG_VERSION = 'dashboard-catalog/3'` (`libs/shared/src/mcp-apps-contracts/surface-catalog.ts:10`) was confirmed landed before this sweep, so every edited envelope now pairs `dashboard-spec/2` + `dashboard-catalog/3` (the valid v2 pair) and the acceptance assertions stay meaningful.

## Per-file changes (old → new)

All paths relative to `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds`. "Line" is the pre-edit line from batches.md; "(now :N)" is the post-edit line where the import block grew.

### Task 2.1 — declarative-dashboard literal specs

1. `libs/frontend/declarative-dashboard/src/lib/components/surface-layout.component.spec.ts`
   - `:3` (import, merged): `import { SURFACE_ACTIONS, type SurfaceAction, type SurfaceComponent } from '@ptah-extension/shared/mcp-apps-contracts/surface';` → `import { SURFACE_ACTIONS, SURFACE_CATALOG_VERSION, type SurfaceAction, type SurfaceComponent } from '@ptah-extension/shared/mcp-apps-contracts/surface';`
   - `:17` (literal): `catalogVersion: 'dashboard-catalog/2',` → `catalogVersion: SURFACE_CATALOG_VERSION,` (still :17)

2. `libs/frontend/declarative-dashboard/src/lib/components/surface-choice-input.component.spec.ts`
   - `:3-7` (type-only import converted to value import):
     - old: `import type {` / `  SurfaceDataModel,` / `  SurfaceDataValue,` / `  SurfaceInputOption,` / `} from '@ptah-extension/shared/mcp-apps-contracts/surface';`
     - new: `import {` / `  SURFACE_CATALOG_VERSION,` / `  type SurfaceDataModel,` / `  type SurfaceDataValue,` / `  type SurfaceInputOption,` / `} from '@ptah-extension/shared/mcp-apps-contracts/surface';`
   - `:23` (literal): `catalogVersion: 'dashboard-catalog/2',` → `catalogVersion: SURFACE_CATALOG_VERSION,` (now :24)

3. `libs/frontend/declarative-dashboard/src/lib/components/surface-checkbox-input.component.spec.ts`
   - `:3` (type-only import converted to value import): `import type { SurfaceDataModel, SurfaceDataValue } from '@ptah-extension/shared/mcp-apps-contracts/surface';` → `import { SURFACE_CATALOG_VERSION, type SurfaceDataModel, type SurfaceDataValue } from '@ptah-extension/shared/mcp-apps-contracts/surface';`
   - `:14` (literal): `catalogVersion: 'dashboard-catalog/2',` → `catalogVersion: SURFACE_CATALOG_VERSION,` (still :14)

4. `libs/frontend/declarative-dashboard/src/lib/components/surface-text-input.component.spec.ts`
   - `:3-8` (import, merged): added `  SURFACE_CATALOG_VERSION,` before `  SURFACE_LIMITS,` in the `import { ... } from '@ptah-extension/shared/mcp-apps-contracts/surface';` block
   - `:23` (literal): `catalogVersion: 'dashboard-catalog/2',` → `catalogVersion: SURFACE_CATALOG_VERSION,` (now :24)

5. `libs/frontend/declarative-dashboard/src/lib/components/surface-renderer.component.spec.ts`
   - `:4-9` (import, merged): added `  SURFACE_CATALOG_VERSION,` before `  SURFACE_LIMITS,` in the `import { ... } from '@ptah-extension/shared/mcp-apps-contracts/surface';` block
   - `:22` (literal): `catalogVersion: 'dashboard-catalog/2',` → `catalogVersion: SURFACE_CATALOG_VERSION,` (now :23)

6. `libs/frontend/declarative-dashboard/src/lib/budget-render.spec.ts`
   - `:48-53` (import, merged): added `  SURFACE_CATALOG_VERSION,` before `  SURFACE_LIMITS,` in the `import { ... } from '@ptah-extension/shared/mcp-apps-contracts/surface';` block (the surface-contract import; the `@ptah-extension/shared/mcp-apps-contracts` import at :43-47 and `@ptah-extension/shared/testing` at :54-63 were left untouched)
   - `:93` (literal): `catalogVersion: 'dashboard-catalog/2',` → `catalogVersion: SURFACE_CATALOG_VERSION,` (now :94)

7. `libs/frontend/declarative-dashboard/src/lib/trust-boundary.spec.ts`
   - `:4-9` (import, merged): added `  SURFACE_CATALOG_VERSION,` after `  SURFACE_ACTIONS,` in the `import { ... } from '@ptah-extension/shared/mcp-apps-contracts/surface';` block (root type-only import at :3 untouched — the root barrel does not export the constant)
   - `:30` (literal): `catalogVersion: 'dashboard-catalog/2',` → `catalogVersion: SURFACE_CATALOG_VERSION,` (now :31)

### Task 2.2 — Apps literals II

8. `libs/frontend/mcp-apps-page/src/lib/services/apps-submit-flow.spec.ts`
   - `:19` (import, merged): `import { SURFACE_OPERATION_ID_PATTERN } from '@ptah-extension/shared/mcp-apps-contracts/surface';` → `import { SURFACE_CATALOG_VERSION, SURFACE_OPERATION_ID_PATTERN } from '@ptah-extension/shared/mcp-apps-contracts/surface';`
   - `:65` (literal): `catalogVersion: 'dashboard-catalog/2',` → `catalogVersion: SURFACE_CATALOG_VERSION,` (still :65)

9. `libs/frontend/mcp-apps-page/src/lib/components/apps-surface-panel.component.spec.ts`
   - `:9` (import, merged): `import { renderDashboardSpecText } from '@ptah-extension/shared/mcp-apps-contracts';` → `import { renderDashboardSpecText, SURFACE_CATALOG_VERSION } from '@ptah-extension/shared/mcp-apps-contracts';`
   - `:38` (literal): `catalogVersion: 'dashboard-catalog/2',` → `catalogVersion: SURFACE_CATALOG_VERSION,` (still :38)

10. `libs/frontend/mcp-apps-page/src/lib/components/apps-page.component.spec.ts`
    - `:69-73` (import, merged): added `  SURFACE_CATALOG_VERSION,` after `  renderSurfaceText,` in the `import { ... } from '@ptah-extension/shared/mcp-apps-contracts/surface';` block (root import at :63-68 untouched — the root barrel does not export the constant)
    - `:134` (literal): `catalogVersion: 'dashboard-catalog/2',` → `catalogVersion: SURFACE_CATALOG_VERSION,` (now :135)

11. `libs/frontend/mcp-apps-page/src/lib/components/apps-page-conversation.spec.ts`
    - `:63` (type-only import converted to value import): `import type { SurfaceComponent } from '@ptah-extension/shared/mcp-apps-contracts/surface';` → `import { SURFACE_CATALOG_VERSION, type SurfaceComponent } from '@ptah-extension/shared/mcp-apps-contracts/surface';` (root import at :57-62 untouched)
    - `:126` (literal): `catalogVersion: 'dashboard-catalog/2',` → `catalogVersion: SURFACE_CATALOG_VERSION,` (still :126)

## Sites not changed

None — every listed literal site was changed. Files explicitly out of bounds for this batch (`surface-node.component.spec.ts`, view-model files, `surface-tools.spec.ts`/`surface-tools.ts`/`dashboard-propose-spec.tool.spec.ts`, Batch 3/4 files) were not touched.

## Verification (Batch-2 scoped)

`Select-String 'dashboard-catalog/2'` over all 11 listed files: **zero hits**. `Select-String 'SURFACE_CATALOG_VERSION'` over the same files: import + usage present in every file (import lines 3/4/3/4/5/49/6/19/9/71/63; usage lines 17/24/14/24/23/94/31/65/38/135/126). No test suites were run — the team-leader verifies Wave 1 together, per the task instructions.

## Absolute paths of all files modified

1. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-layout.component.spec.ts`
2. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-choice-input.component.spec.ts`
3. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-checkbox-input.component.spec.ts`
4. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-text-input.component.spec.ts`
5. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-renderer.component.spec.ts`
6. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/budget-render.spec.ts`
7. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/trust-boundary.spec.ts`
8. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/services/apps-submit-flow.spec.ts`
9. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/components/apps-surface-panel.component.spec.ts`
10. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/components/apps-page.component.spec.ts`
11. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/components/apps-page-conversation.spec.ts`
