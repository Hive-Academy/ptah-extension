# Batch 3 Report — TASK_2026_594_31ff (Wave 1)

**Status: COMPLETE.** 12/12 listed files swept, 14 version-literal sites changed. No other lines touched; no files outside the list touched. No git commands run; batches.md untouched.

## Key finding (import-source decision)

The batch rule says to import `SURFACE_CATALOG_VERSION` "from `@ptah-extension/shared`". The package **root does not export it**: `libs/shared/src/index.ts:35-36` re-exports only `mcp-apps-contracts/dashboard-spec.types` (values) and `mcp-apps-contracts/surface.types` (types-only); the comment at `:32` states surface v2 APIs deliberately live behind the subpath. The constant is exported from:

- `libs/shared/src/mcp-apps-contracts/index.ts:116` → `@ptah-extension/shared/mcp-apps-contracts`
- `libs/shared/src/mcp-apps-contracts/surface.index.ts:17` → `@ptah-extension/shared/mcp-apps-contracts/surface`

The `.../mcp-apps-contracts/surface` subpath is the convention used by every already-swept file in Batches 2/4 (e.g. `surface-trust-boundary.spec.ts:40`, `apps-submit-flow.spec.ts:19`, `surface-state.service.spec.ts:15`, `register.spec.ts:54`). I therefore merged into each file's existing `.../surface` import where one exists, and added one `.../surface` import line where the file had only a root import (mirroring `surface-rpc-harness.ts:25-26`'s root-then-subpath layout). No eslint-disable was added anywhere.

Batch 1 has landed the constant value: `surface-catalog.ts:10` = `'dashboard-catalog/3'`, so every constant reference below means /3. `surface.schemas.ts:584` (`z.literal(SURFACE_CATALOG_VERSION)`) confirms the validator also derives from the constant.

## Lines changed (pre-edit line numbers; a `+1` insert shifts later lines by one)

### Task 3.1 — Apps literals I (plan G2)

1. `libs/frontend/mcp-apps-page/src/lib/state/apps-surface-reducer.spec.ts`
   - `:1` `import { SURFACE_STORE_LIMITS } from '@ptah-extension/shared/mcp-apps-contracts/surface';` → `import { SURFACE_CATALOG_VERSION, SURFACE_STORE_LIMITS } from '@ptah-extension/shared/mcp-apps-contracts/surface';` (merged, alphabetical)
   - `:49` `catalogVersion: 'dashboard-catalog/2',` → `catalogVersion: SURFACE_CATALOG_VERSION,`
2. `libs/frontend/mcp-apps-page/src/lib/state/apps-surface-intake.spec.ts`
   - `:2` `import { SURFACE_LIMITS } from '.../surface';` → `import { SURFACE_CATALOG_VERSION, SURFACE_LIMITS } from '.../surface';` (merged; the file's root `DASHBOARD_LIMITS` import at `:1` was left untouched)
   - `:37` literal → `catalogVersion: SURFACE_CATALOG_VERSION,`
3. `libs/frontend/mcp-apps-page/src/lib/services/apps-surface-sync.spec.ts`
   - new line at `:2` `import { SURFACE_CATALOG_VERSION } from '@ptah-extension/shared/mcp-apps-contracts/surface';` inserted before the existing `import type {...}` block from the same module (value-then-type, matching the reducer spec's own layout); no other import altered
   - `:31` literal → `catalogVersion: SURFACE_CATALOG_VERSION,` (now `:32`)
4. `libs/frontend/mcp-apps-page/src/lib/services/apps-surface-operations.service.spec.ts`
   - `:19` `import { SURFACE_OPERATION_ID_PATTERN } from '.../surface';` → `import { SURFACE_CATALOG_VERSION, SURFACE_OPERATION_ID_PATTERN } from '.../surface';` (merged; the root import at `:18` cannot hold the constant and was not touched)
   - `:74` literal → `catalogVersion: SURFACE_CATALOG_VERSION,`
5. `libs/frontend/mcp-apps-page/src/lib/services/apps-surface-lanes.spec.ts`
   - new line after the existing `.../surface` import block (whose closing line was `:8`): `import { SURFACE_CATALOG_VERSION } from '@ptah-extension/shared/mcp-apps-contracts/surface';` (the file's only other shared import, the type-only root import at `:3`, cannot hold a value)
   - `:55` literal → `catalogVersion: SURFACE_CATALOG_VERSION,` (now `:56`)
6. `libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.spec.ts`
   - new line after the existing `.../surface` import block (closing line was `:30`): `import { SURFACE_CATALOG_VERSION } from '@ptah-extension/shared/mcp-apps-contracts/surface';`
   - `:46` literal → `catalogVersion: SURFACE_CATALOG_VERSION,` (now `:47`)

### Task 3.2 — RPC, CLI and app composition literals (plan G5b + G6a)

7. `libs/backend/rpc-handlers/src/test-utils/surface-rpc-harness.ts`
   - `:26` `import { SURFACE_ACTIONS } from '@ptah-extension/shared/mcp-apps-contracts/surface';` → `import { SURFACE_ACTIONS, SURFACE_CATALOG_VERSION } from '@ptah-extension/shared/mcp-apps-contracts/surface';` (merged)
   - `:111` literal → `catalogVersion: SURFACE_CATALOG_VERSION,`
8. `libs/backend/cli-engine/src/lib/surface-composition.spec.ts`
   - new line after the root type import (`:58` `import type { SurfaceEnvelope } from '@ptah-extension/shared';`): `import { SURFACE_CATALOG_VERSION } from '@ptah-extension/shared/mcp-apps-contracts/surface';`
   - `:81` and `:93` (identical lines, both replaced) `catalogVersion: 'dashboard-catalog/2',` → `catalogVersion: SURFACE_CATALOG_VERSION,` (now `:82`/`:94`)
9. `apps/ptah-extension-vscode/src/di/surface-composition.spec.ts`
   - new line after the root type import (`:79`): `import { SURFACE_CATALOG_VERSION } from '@ptah-extension/shared/mcp-apps-contracts/surface';`
   - `:102` literal → `catalogVersion: SURFACE_CATALOG_VERSION,` (now `:103`)
10. `apps/ptah-electron/src/di/surface-composition.spec.ts`
    - new line after the root type import (`:47`): `import { SURFACE_CATALOG_VERSION } from '@ptah-extension/shared/mcp-apps-contracts/surface';`
    - `:106` and `:117` (identical lines, both replaced) → `catalogVersion: SURFACE_CATALOG_VERSION,` (now `:107`/`:118`)

Boundary note for the two app specs (Task 3.2 validation note): both already import from `@ptah-extension/shared` (root type import), so the package is an allowed dependency; the added line is a subpath of that same package resolved by the workspace tsconfig paths — not a new dependency, no eslint-disable, no boundary rule changed. Not blocked.

### Task 3.3 — Shared fixture + converter spec (moved from plan B)

11. `libs/shared/src/testing/fixtures/surface.ts`
    - new line after the header comment (`:1`): `import { SURFACE_CATALOG_VERSION } from '../../mcp-apps-contracts/surface-catalog';` — a relative import from `../../mcp-apps-contracts`, following the file's existing deep relative style (`'../../mcp-apps-contracts/surface.types'` at `:2-8`); the constant is defined and exported at `surface-catalog.ts:10`
    - `:31` `catalogVersion: 'dashboard-catalog/2',` → `catalogVersion: SURFACE_CATALOG_VERSION,` (now `:32`)
12. `libs/shared/src/mcp-apps-contracts/ptah-ui-converter.spec.ts`
    - `:132` expected v2 output literal `catalogVersion: 'dashboard-catalog/2',` → `catalogVersion: 'dashboard-catalog/3',` — literal kept (it is the subject under test, plan:363). Coherent because the converter derives its real output from the constant (`ptah-ui-converter.ts:59` `catalogVersion: SURFACE_CATALOG_VERSION`), which Batch 1 has already set to `/3`.

No site was left unchanged; nothing was blocked.

## Verification

`grep "dashboard-catalog/2" --include=*.ts` over the worktree: **zero hits in all 12 listed files**. The 14 remaining hits are exactly:

- the intentional keepers owned by other batches: `surface-contract.spec.ts:63`, `surface-validator.spec.ts:241,257,263,286` (explicit `/2` negative case, kept permanently), `surface-budgets.spec.ts:50` (Batch 9), `surface-view-model.spec.ts:218,222` (Task 1.6's deliberate negative case), `surface-node.component.spec.ts:15` (Batch 10)
- archived e2e specs under `.ptah/specs/TASK_2026_494_ca38/visual/` — outside `libs`/`apps`, outside this task's scope, untouched.

This matches the Wave 1 expected-remainder list (Batches 2/4 completed their sweeps in parallel while this batch ran; their files no longer appear).

No test/lint/typecheck run, per instructions — the team-leader verifies the wave together.

## Files modified (absolute paths, 12)

1. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/state/apps-surface-reducer.spec.ts`
2. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/state/apps-surface-intake.spec.ts`
3. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/services/apps-surface-sync.spec.ts`
4. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/services/apps-surface-operations.service.spec.ts`
5. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/services/apps-surface-lanes.spec.ts`
6. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.spec.ts`
7. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/rpc-handlers/src/test-utils/surface-rpc-harness.ts`
8. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/cli-engine/src/lib/surface-composition.spec.ts`
9. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/apps/ptah-extension-vscode/src/di/surface-composition.spec.ts`
10. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/apps/ptah-electron/src/di/surface-composition.spec.ts`
11. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/testing/fixtures/surface.ts`
12. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/ptah-ui-converter.spec.ts`
