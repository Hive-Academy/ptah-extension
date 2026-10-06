# Batch 1 report — Contract (catalog, types, schemas) + v2 StatusNode projection

Status: DONE. All 6 tasks implemented with real code. No stubs, placeholders or TODO markers.
Touched only the six files listed for Batch 1.

## Verification (batch-local, from batches.md)

| Command | Result |
| --- | --- |
| `npx nx run-many -t typecheck -p shared,declarative-dashboard --skip-nx-cache` | PASS — "Successfully ran target typecheck for 2 projects" |
| `npx nx run-many -t lint -p shared,declarative-dashboard --skip-nx-cache` | PASS — "Successfully ran target lint for 2 projects" |
| `npx jest --config libs/frontend/declarative-dashboard/jest.config.ts surface-view-model` | PASS — "Test Suites: 1 passed, 1 total; Tests: 19 passed, 19 total" (11 existing + 8 new) |

Extra runtime evidence (not a gate; a one-off ts-node script in the OS temp dir, deleted after
use; no repo file created): drove `validateSurfaceDocument` from
`surface.validator.ts` directly. Results:

- A `/3` envelope containing one minimal component of each of the six kinds: `ok`.
- `dashboard-spec/2` + `dashboard-catalog/2`: rejected, `ok: false`, `field: 'catalogVersion'`,
  reason `"catalogVersion \"dashboard-catalog/2\" is unknown; supported: dashboard-catalog/1, dashboard-catalog/3."`
  — the unknown-catalog branch names `/3`, as the plan requires (Batch 9 will pin this in a spec).
- Rejected: extra `class` key, alert `tone: 'violet'`, progress `value: 101`, progress `value: 'NaN'`
  (string), empty `text-block` text, badge action carrying `url`, badge action `surface.submit`
  instead of `dashboard.select`.

## Tasks

### Task 1.1 — Explicit v2 display tuple and catalog `/3` — DONE

File: `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-catalog.ts`

- `SURFACE_CATALOG_VERSION` is exactly `'dashboard-catalog/3'` (surface-catalog.ts:10).
- `SURFACE_SCHEMA_VERSION` stays `'dashboard-spec/2'` (surface-catalog.ts:9).
- `SURFACE_DISPLAY_KINDS` is an explicit `as const` tuple (surface-catalog.ts:35-47): the five
  v1 kinds in `DASHBOARD_COMPONENT_KINDS` order (`stat`, `line-chart`, `bar-chart`, `table`,
  `list` — the v1 kinds stay a prefix), then `alert`, `badge`, `progress`, `radial-progress`,
  `divider`, `text-block`. The alias to `DASHBOARD_COMPONENT_KINDS` is gone, and its now-unused
  import was removed from the import list.
- `SURFACE_COMPONENT_KINDS` (surface-catalog.ts:49-53) concatenates layout (4) + input (4) +
  display (11) = 19 entries.
- Pair table (surface-catalog.ts:18-21) still holds exactly `spec/1`+`catalog/1` and
  `spec/2`+`catalog/3`; `dashboard-catalog.ts` (v1) untouched. No budget constant was changed
  and `surface.validator.ts` was not edited.

### Task 1.2 — Six component interfaces, badge action type, badge selection target — DONE

File: `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface.types.ts`

- `SurfaceAlertComponent` (surface.types.ts:101), `SurfaceBadgeAction` (:112,
  `Omit<SurfaceAction, 'action' | 'url'> & { readonly action: 'dashboard.select' }`),
  `SurfaceBadgeComponent` (:116), `SurfaceProgressComponent` (:122),
  `SurfaceRadialProgressComponent` (:128, `extends Omit<SurfaceProgressComponent, 'kind'>`),
  `SurfaceDividerComponent` (:133), `SurfaceTextBlockComponent` (:138) — all readonly fields,
  RichText (not string) for every text field, exactly the plan:105-136 shapes.
- All six appended to `SurfaceComponent` (surface.types.ts:144-161).
- `{ readonly kind: 'badge' }` (no index) added to `SurfaceSelectionTarget` (surface.types.ts:226).
- Envelope `catalogVersion` literal changed to `'dashboard-catalog/3'` (surface.types.ts:174).
- Barrel export: both `libs/shared/src/index.ts:36` and
  `libs/shared/src/mcp-apps-contracts/surface.index.ts:12` use `export type * from './surface.types'`,
  so the new types are exported by name automatically with no barrel edit.

### Task 1.3 — Six strict Zod schemas, `actionParams()` factory, badge action and target schemas — DONE

File: `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface.schemas.ts`

- `actionParams()` extracted (surface.schemas.ts:142-158); `SurfaceActionSchema` now uses
  `params: actionParams().optional()` (:169) with behaviour unchanged — same preprocess, record,
  key-count refinement and optionality.
- `SurfaceBadgeActionSchema` (surface.schemas.ts:193-201): strict object, `id: componentId()`,
  `action: z.literal('dashboard.select')`, `label: DashboardRichTextSchema`,
  `params: actionParams().optional()`, no `url`. `SurfaceActionSchema` was not refined or extended.
- Six `z.object(...).strict()` schemas, none spreading `displayShape`:
  `SurfaceAlertComponentSchema` (:439), `SurfaceBadgeComponentSchema` (:449, `actions` is
  `z.array(SurfaceBadgeActionSchema).max(SURFACE_LIMITS.maxActionsPerComponent).optional()`),
  `SurfaceProgressComponentSchema` (:462) and `SurfaceRadialProgressComponentSchema` (:472)
  (both `value: z.number().finite().min(0).max(100)` via the local `progressValue()` factory),
  `SurfaceDividerComponentSchema` (:482, `z.enum(['horizontal','vertical'])`),
  `SurfaceTextBlockComponentSchema` (:486, `role: z.enum(['heading','body'])`).
- Text-block text uses a local derived schema `textBlockRichText` (:431-436):
  `DashboardRichTextSchema.extend({ text: z.string().min(1).max(SURFACE_LIMITS.maxStringLength) })`
  — non-empty, bounded by `SURFACE_LIMITS.maxStringLength`, derived without loosening the shared
  schema. Runtime check above confirms empty text rejects and `.extend` kept the strict shape
  (an extra key on the component rejects).
- All six added to the `SurfaceComponentSchema` discriminated union (:508-545) and
  `{ kind: z.literal('badge') }` added to `SurfaceSelectionTargetSchema` (:679).
- No budget constant was changed.

### Task 1.4 — `StatusNode` view-model type — DONE

File: `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/view-model/view-model.types.ts`

- `StatusNode` (view-model.types.ts:53-60): the union of the six shared component interfaces,
  each intersected with `{ readonly selectable: boolean }` via the local `StatusNodeOf<T>` helper.
- Included in `SurfaceNode` (view-model.types.ts:61-66); `DisplayNode` and `DashboardViewModel`
  stay v1/legacy-only (unchanged).

### Task 1.5 — v2-only status mapper, imported catalog constant — DONE

File: `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/view-model/surface-view-model.ts`

- The literal at the old :113 is replaced by the imported `SURFACE_CATALOG_VERSION`
  (surface-view-model.ts:173).
- `mapStatus` (surface-view-model.ts:124-168): a v2-only mapper that copies only the declared
  fields per kind and throws `TypeError` on any failure:
  - finite numeric `value` for both progress kinds (`typeof value === 'number' && Number.isFinite(value)`, :144-146);
  - closed tone membership (`STATUS_TONES`/`ALERT_TONES`), direction (`DIVIDER_DIRECTIONS`)
    and role (`TEXT_BLOCK_ROLES`) — local `as const` tuples at :34-37;
  - `isRichText` on every RichText field (text, title, label, divider text);
  - badge actions are an array whose every entry is `dashboard.select` (:136-139).
  - `selectable` comes from `declaresSelect(component.actions ?? [])` for badge (:141) and is
    `false` for the other five kinds.
- Six explicit `case`s before `default` in `mapComponents` (surface-view-model.ts:200-205),
  routing to `mapStatus`; the `default` branch still runs `checkDisplayShape` + `mapDisplayNode`
  for the legacy kinds only. All-or-nothing `renderFailed` is preserved: every failure throws
  before any node is returned.

### Task 1.6 — View-model spec — DONE

File: `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/view-model/surface-view-model.spec.ts`

- The literal in the `v2()` helper is replaced by the imported constant (surface-view-model.spec.ts:24).
- One valid-projection case per new kind (surface-view-model.spec.ts:150-201), each asserting the
  exact copied fields and `selectable` with `toEqual` — including a title-carrying alert, a
  `dashboard.select` badge (selectable true) beside a plain badge (selectable false), a decimal
  progress value (42.5), a text and a textless divider.
- Hostile in-process cases (:203-215): NaN progress value, unknown alert tone, non-RichText
  alert text, a badge action other than select — each yields `renderFailed: true` and
  `viewModel: null`.
- A v2 envelope still stamped `dashboard-catalog/2` fails (:218-224). This keeps a deliberate
  `/2` negative literal in this spec, as the Wave 1 grep allow-list anticipates.

## Files created or modified (all absolute)

1. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-catalog.ts` (MODIFIED)
2. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface.types.ts` (MODIFIED)
3. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface.schemas.ts` (MODIFIED)
4. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/view-model/view-model.types.ts` (MODIFIED)
5. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/view-model/surface-view-model.ts` (MODIFIED)
6. `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/view-model/surface-view-model.spec.ts` (MODIFIED)

No file outside this list was created, modified, reverted or reformatted.

## Risks and how they were handled

- **HIGH — A1 alone breaks declarative-dashboard typecheck until D0** (Risk 1 in batches.md):
  A1 and D0 landed together in this batch, exactly as planned. Both
  `shared` and `declarative-dashboard` typecheck green after the six edits, and the mapped
  default branch now only sees the five legacy display kinds.
- **HIGH — version bump turns 41 literal sites red until swept**: Batches 2-4 (other lanes)
  own those files; I touched none of them. My batch-local gate runs no spec that still asserts
  the `/2` literal except `surface-view-model.spec.ts`, whose helper now uses the imported
  constant. Consistency of the version value with the literal sites is a Wave 1 commit property.
- **MEDIUM — badge selection target half-wired**: Task 1.3 added the target type and schema
  only. `surface-patch.ts` / `surface-selection.ts` were not touched; their existing branches
  keep the interim state safe, confirmed by the passing `shared` typecheck and lint.
- **LOW — status node renders `renderFailed` until Batch 10 registers the kind**: fail-closed by
  design (`surface-node.component.ts` guard), not this batch's file; the view model now produces
  `StatusNode`s and dispatch wiring comes in Batch 10.
- **Edge cases**: hostile in-process status node (NaN value, bad tone, non-RichText, non-select
  badge action) gives all-or-nothing `renderFailed` — asserted in Task 1.6 and passing;
  `text-block` empty and over-length reject at the boundary (local derived schema, empty case
  runtime-verified); `class`/`style`/`html`/`path`/`data`/extra keys reject the whole document
  (strict objects, `class` runtime-verified); `dashboard-spec/2` + `dashboard-catalog/2`
  rejects through the unknown-catalog branch with `field: 'catalogVersion'` and a reason naming
  `/3` (runtime-verified above; Batch 9 pins it in `surface-validator.spec.ts`).

## Notes for the team-leader

- `SURFACE_DISPLAY_KINDS` keeps the five v1 kinds as a prefix, in `DASHBOARD_COMPONENT_KINDS`
  order, so Task 9.1's prefix assertion holds.
- `buildSurfaceUpdateTool()` size (surface-tools.spec.ts growth guard, Batch 6): six new schemas
  joined the Zod-generated union; the before/after measurement belongs to Task 6.2, which owns
  that spec. Wave 1 excludes it until then.
- Nothing outside my file list failed during my checks. I did not run the shared jest suite
  because the `/2` fixture (Batch 3) and the three named shared specs (Batch 9) are owned by
  other lanes and are excluded from early gates by design.