# Batches - TASK_2026_594_31ff

Total tasks: 34 | Batches: 12 | Waves: 4 | Complete: 10/12

Worktree root (W): `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds`, branch
`feat/task-594-status-kinds`. All paths below are absolute. Source: implementation-plan.md
Revision 3 (Team-leader handoff, plan:409-443) and implementation-plan-review.md round 2
(notes 1 and 2, plan:262-268).

## Execution defaults (recorded)

- Waves run in order. Batches inside a wave are file-disjoint and run in parallel, with at most
  3 lanes in flight. When a wave has 4 batches, start the 4th as soon as a slot frees.
- Code batches: CLI lane `Glm`. Mechanical `dashboard-catalog/2` sweep batches: CLI lane
  `opencode`. Fallback: the subagent named on each batch. Lanes never run git and never edit
  batches.md or task.md.
- Plan batch ids map to these batches: A1+D0 -> 1, G-sweep -> 2/3/4, A2 -> 5, E -> 6, C1 -> 7,
  C2 -> 8, B -> 9, D -> 10, F -> 11, H -> 12.
- **Commit grouping.** Wave 1 (Batches 1-4) is verified together and committed as ONE commit.
  The version value (Batch 1) and the literal sites that assert it (Batches 2-4) are only
  consistent together. From Wave 2 on, there is one commit per batch. Every commit uses
  Conventional Commits and ends with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never bare `git stash`. Never push.
- **Test-gate sequencing (review note 1).** Until a site is fixed, its spec still holds a literal
  `/2`. Early gates are therefore narrowed to typecheck + lint + every spec that can already
  pass, with the named not-yet-fixed specs excluded by `--testPathIgnorePatterns`. Each
  exclusion is lifted by the batch that owns the file:
  - shared contract/validator/budgets specs: lifted by Batch 9
  - `surface-node.component.spec.ts`: lifted by Batch 10
  - `surface-tools.spec.ts`: lifted by Batch 6

  Batch 12 runs every project unnarrowed.
- **Renderer (review note 2).** `surface-renderer.component.ts` is edited in Batch 10 only if
  typecheck requires it. Its `isRenderableNode` reads `SURFACE_NODE_KINDS` from surface-node
  (`surface-renderer.component.ts:28,86`), and its selection equality is generic. The plan prose
  at plan:224-225 is superseded by the handoff.
- Phase: the whole run is one phase, `status-kinds`. Phase review is due after Batch 12 commits:
  code-logic, plus style (new public API: exported contract types and schemas, and six
  `Dashboard*Component` renderers). Rendered dark + light evidence is a completion requirement
  (visual-reviewer), not a per-batch gate.

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- Short project names (`shared`, `declarative-dashboard`, ...) resolve to the scoped Nx projects.
  Verified: `npx nx show projects -p ...` returned all nine, including `ptah-extension-webview`.
- `shared` typecheck excludes specs and `src/testing/**`. Verified:
  `libs/shared/tsconfig.lib.json` exclude list. A1 alone can pass the shared typecheck.
- Exactly 41 `*.ts` files under libs/apps contain `dashboard-catalog/2`, matching the plan
  table. Verified with grep. There are no non-`.ts` hits.
- No spec in the affected projects cross-checks `content-manifest.json`; the only one is in
  platform-core. Verified with grep. Batch 11 can pass before Batch 12 regenerates the manifest.
- The renderer needs no badge edit (see Execution defaults). Verified at
  `surface-renderer.component.ts:28,68-99`. Task 10.1 confirms it with typecheck.
- surface-node's computed guards narrow by kind equality, so adding `StatusNode` to
  `SurfaceNode` typechecks without editing surface-node. Verified at
  `surface-node.component.ts:203-238`. Batch 1's declarative-dashboard typecheck confirms it.
- The webview production build runs from the worktree against the hoisted
  `D:/projects/ptah-extension/node_modules`. Unverified: `dist/.../stats.json` does not exist
  yet. Task 12.2 checks it.
- Several `Glm` lanes may run concurrently. Unverified: the orchestrator checks with
  `ptah_agent_list` and falls back to subagents.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Once A1 sets the `catalogVersion` type to `/3`, `surface-view-model.ts:113` (`!== 'dashboard-catalog/2'`) and its `default` branch (`:139-141`, which passes the new kinds to `mapDisplayNode`) break the declarative-dashboard and mcp-apps-page typecheck until D0 lands. | HIGH | A1 and D0 are one sequential batch (Batch 1: 6 files, 2 libs). The Wave 1 commit typechecks across all eight projects. |
| Version bump turns 41 literal sites red until swept (review note 1) | HIGH | Sweep Batches 2-4 run in Wave 1 next to Batch 1. The wave is verified and committed together. The remaining owned sites are excluded by name until their batch lands (Execution defaults). |
| `surface-tools.spec.ts:61-89` caps `JSON.stringify(buildSurfaceUpdateTool()).length` at 68,449 chars (65,190 measured + 5%). The definition embeds the Zod-generated input schema, so A1's six schemas grow it before any prose is added. The plan does not mention this guard. | MEDIUM | Task 6.2 measures the size after A1 + E. If it exceeds the ceiling, it re-baselines `SURFACE_UPDATE_MEASURED_CHARS` to the new measured size with a dated `TASK_2026_594` comment, and updates the pinned ceiling assertion to match. This is the deliberate, documented raise the guard's own comment requires (`:55-60`). The executor reports the before/after sizes. Wave 1 excludes this spec until Batch 6. |
| The eager-closure gate could fail if a new renderer or a contract value is imported eagerly | MEDIUM | New renderer imports go only into `surface-node.component.ts` (Batch 10). Task 12.2 runs the production webview build, then `npm run gate:eager-closure`. No allowlist edit is allowed. |
| Tailwind purge drops classes that are built by concatenation | MEDIUM | Batches 7-8 use complete literal class records. Specs assert the exact classes. Concatenation is rejected at verification. |
| Badge selection target is half-wired (type/schema in A1, switches in A2, emitter in C1/D) | MEDIUM | Task 1.3 adds the target type and schema. Task 5.2 adds the `checkSurfaceSelection` / `sameSelection` / `describeSurfaceSelection` cases (their `default` branches keep the interim state safe). Task 7.2 emits the target. Task 10.2 asserts `aria-pressed`. |
| Status node reaches surface-node before Batch 10 registers its kind, and renders `renderFailed` | LOW | This is transient and fail-closed (`surface-node.component.ts:240-250`). Batch 10 closes it, with a dispatch test per kind. |
| Skill-shape specs (`skill-description-shape.spec.ts`, `lane-rule-single-home.spec.ts`) scan plugin skills | LOW | Batch 11 keeps the SKILL.md frontmatter shape intact. Its gate runs the full vscode-lm-tools suite. |

Edge cases:

- `dashboard-spec/2` + `dashboard-catalog/2` rejected through the unknown-catalog branch
  (`field: 'catalogVersion'`, reason names `/3`) — Task 9.2
- `dashboard-spec/1` + `dashboard-catalog/3` reaches the "does not pair" branch — Task 9.2
- v1 document naming a new kind is rejected; `DASHBOARD_COMPONENT_KINDS` and the propose-spec
  enum and prose still list exactly five — Tasks 9.1, 6.3
- Alert without `title` renders no title node; with `title`, the title comes before the text in
  the same element — Task 7.1
- Textless divider fallback line `Divider`; unrounded decimal percentage — Task 5.1
- Badge without actions is non-interactive; with `dashboard.select` it renders a button with
  `aria-pressed` — Tasks 7.2, 10.2
- Neutral progress maps to the bare `progress` class; vertical divider maps to
  `divider divider-horizontal` — Tasks 8.1, 7.3
- Radial `--value` is renderer-owned only — Task 8.2
- `text-block` empty or over `SURFACE_LIMITS.maxStringLength`, unknown role, or extra key is
  rejected — Tasks 1.3, 9.2, 9.3
- Hostile in-process status node (non-finite value, bad tone, non-RichText) gives an
  all-or-nothing `renderFailed` — Tasks 1.5, 1.6
- `class` / `style` / `html` / `path` / `data` / extra keys reject the whole document — Tasks
  1.3, 9.2

---

## WAVE 1 — version bump closure (Batches 1-4, one commit)

Wave 1 verification (run after all four batches report; all must pass before the single commit):

```bash
cd D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds
npx nx run-many -t typecheck,lint -p shared,declarative-dashboard,mcp-apps-page,vscode-lm-tools,rpc-handlers,cli-engine,ptah-extension-vscode,ptah-electron
npx nx run-many -t test -p mcp-apps-page,rpc-handlers,cli-engine,ptah-extension-vscode,ptah-electron
npx jest --config libs/shared/jest.config.ts --testPathIgnorePatterns "/node_modules/" "surface-(contract|validator|budgets)\.spec\.ts"
npx jest --config libs/frontend/declarative-dashboard/jest.config.ts --testPathIgnorePatterns "/node_modules/" "surface-node\.component\.spec\.ts"
npx jest --config libs/backend/vscode-lm-tools/jest.config.ts --testPathIgnorePatterns "/node_modules/" "surface-tools\.spec\.ts"
grep -rln "dashboard-catalog/2" libs apps --include=*.ts
```

The final grep must list exactly these five files:

- `surface-contract.spec.ts`, `surface-validator.spec.ts` and `surface-budgets.spec.ts` (Batch 9;
  the validator keeps its explicit `/2` negative case permanently)
- `surface-view-model.spec.ts`, only if Task 1.6 keeps a deliberate negative case
- `surface-node.component.spec.ts` (Batch 10)

Output is tailed, never pasted in full.

Wave 1 result (2026-10-05, team-leader): PASSED.
- typecheck + lint, 8 projects: 0 errors (pre-existing warnings only).
- nx test, 5 projects: rpc-handlers 144/144 suites, mcp-apps-page 16/16, cli-engine 22/22,
  ptah-electron 58 passed + 1 skipped, ptah-extension-vscode 12/12.
- jest shared (narrowed): 102/102 suites, 2784 tests. declarative-dashboard (narrowed): 16/16,
  220 tests. vscode-lm-tools (narrowed): 85/86. The one failure, `code-outliner.adapter.spec.ts`
  (real tree-sitter, includes a "<1 s" perf case), is a load flake that is not in the Wave 1 diff:
  run alone it passes 69/69.
- grep: only the five expected files hold `dashboard-catalog/2` (view-model spec :218,:222 is the
  deliberate negative case).
- Environment note: `jest.preset.js:31` resolves `marked` against `<worktree>/node_modules`, which
  a worktree does not have, so 35 vscode-lm-tools suites failed to load. Workaround: a gitignored
  directory junction `<worktree>/node_modules -> D:/projects/ptah-extension/node_modules`. It
  copies nothing. Later batches' gates need it, and so does Batch 12.

Wave 1 commit:
`feat(shared): bump surface catalog to dashboard-catalog/3 with status and text kinds`, with the
trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The same SHA is recorded on
Batches 1-4.

## Batch 1: Contract (catalog, types, schemas) + v2 StatusNode projection — COMPLETE (commit 2d18e0215)

- Recommended executor: CLI lane `Glm` (one lane, tasks in order)
- Fallback executor: backend-developer subagent
- Execution mode: sequential
- Rationale: plan A1 + D0. D0 must compile against A1's new types, and A1 alone leaves
  declarative-dashboard un-typecheckable (see Risk 1). Six tightly coupled files in 2 libs.
- Tasks: 6 | Depends on: none | Wave: 1 (parallel with Batches 2-4)
- AC: 1-5, 7-10
- Phase: status-kinds | Phase review: covered by the single phase review after Batch 12

### Task 1.1: Explicit v2 display tuple and catalog `/3` — COMPLETE

- File: MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-catalog.ts`
- Plan reference: implementation-plan.md:63-96, 358-359
- Pattern to follow: `surface-catalog.ts:10-35` (existing constants and the pair table)
- Quality requirements:
  - `SURFACE_CATALOG_VERSION` is exactly `'dashboard-catalog/3'`.
  - `SURFACE_SCHEMA_VERSION` stays `'dashboard-spec/2'`.
  - Replace the `SURFACE_DISPLAY_KINDS = DASHBOARD_COMPONENT_KINDS` alias with an explicit
    readonly tuple: the five existing kinds, then `alert`, `badge`, `progress`,
    `radial-progress`, `divider`, `text-block`.
  - `SURFACE_COMPONENT_KINDS` has 19 entries.
  - The pair table holds only `spec/1`+`catalog/1` and `spec/2`+`catalog/3`.
  - `dashboard-catalog.ts` (v1) is untouched.
- Validation notes: do not edit `surface.validator.ts`. Do not touch the budget constants.
- Implementation details: an `as const` tuple; the type `SurfaceDisplayKind` derives from it.

### Task 1.2: Six component interfaces, badge action type, badge selection target — COMPLETE

- File: MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface.types.ts`
- Plan reference: implementation-plan.md:98-142, 219-229 (target type only)
- Pattern to follow: `surface.types.ts:18-22,91-111`
- Quality requirements:
  - Add `SurfaceAlertComponent`, `SurfaceBadgeAction`, `SurfaceBadgeComponent`,
    `SurfaceProgressComponent`, `SurfaceRadialProgressComponent`, `SurfaceDividerComponent` and
    `SurfaceTextBlockComponent` exactly as in plan:105-136, and append them to `SurfaceComponent`.
  - Add `{ kind: 'badge' }` (no index) to `SurfaceSelectionTarget`.
  - Change the `catalogVersion` literal at line 124 to `'dashboard-catalog/3'`.
  - Export the new types through the existing barrel when the barrel re-exports by name.
- Validation notes: all fields readonly; RichText, not string.
- Implementation details: `SurfaceBadgeAction = Omit<SurfaceAction, 'action' | 'url'> & { readonly action: 'dashboard.select' }`.

### Task 1.3: Six strict Zod schemas, `actionParams()` factory, badge action and target schemas — COMPLETE

- File: MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface.schemas.ts`
- Plan reference: implementation-plan.md:144-181, 219-221
- Pattern to follow: `surface.schemas.ts:134-190` (actions), `:325-400` (component union)
- Quality requirements:
  - Six `z.object(...).strict()` schemas with exactly the keys in plan:154-161. They must not
    spread `displayShape`.
  - Progress and radial: `value: z.number().finite().min(0).max(100)`.
  - Text-block: a local non-empty, max-`SURFACE_LIMITS.maxStringLength` RichText schema. Do not
    loosen the shared schema.
  - Extract the existing `params` chain to `actionParams()`, with `SurfaceActionSchema` behaviour
    unchanged.
  - `SurfaceBadgeActionSchema` is a strict object: `id`, `action: z.literal('dashboard.select')`,
    `label`, optional `params`, and no `url`.
  - Badge `actions`: `z.array(...).max(SURFACE_LIMITS.maxActionsPerComponent).optional()`.
  - Add the six schemas to the `SurfaceComponentSchema` discriminated union, and add the `badge`
    target to `SurfaceSelectionTargetSchema`.
- Validation notes: strictness is the trust boundary (AC 4). Do not refine or extend
  `SurfaceActionSchema`. No budget constant changes.
- Implementation details: `componentId()` for ids, `DashboardRichTextSchema` for RichText.

### Task 1.4: `StatusNode` view-model type — COMPLETE

- Depends on: Task 1.2
- File: MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/view-model/view-model.types.ts`
- Plan reference: implementation-plan.md:201-217
- Pattern to follow: `view-model.types.ts:21-25`
- Quality requirements:
  - `StatusNode` = the union of the six shared component interfaces, each intersected with
    `{ readonly selectable: boolean }`.
  - Include it in `SurfaceNode`, but not in `DisplayNode` or `DashboardViewModel`.
- Validation notes: `DisplayNode` stays v1/legacy-only.

### Task 1.5: v2-only status mapper, and import the catalog constant — COMPLETE

- Depends on: Tasks 1.1-1.4
- File: MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/view-model/surface-view-model.ts`
- Plan reference: implementation-plan.md:205-217, 364
- Pattern to follow: `surface-view-model.ts:47-49` (`declaresSelect`), `:108-143` (`buildSurface`)
- Quality requirements:
  - Replace the `'dashboard-catalog/2'` literal at :113 with an imported
    `SURFACE_CATALOG_VERSION`.
  - In `buildSurface`, add six explicit `case`s before `default`. They call a v2-only mapper
    that copies only the declared fields and checks:
    - a finite numeric `value` (both progress kinds)
    - closed tone / direction / role membership
    - `isRichText` on every RichText field
    - badge actions are an array of `dashboard.select`

    The mapper sets `selectable` (from `declaresSelect` for badge, `false` otherwise) and throws
    `TypeError` on any failure.
  - Legacy kinds alone keep `checkDisplayShape` + `mapDisplayNode`.
- Validation notes: preserve all-or-nothing `renderFailed`. Never return a partial node.

### Task 1.6: View-model spec — COMPLETE

- Depends on: Task 1.5
- File: MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/view-model/surface-view-model.spec.ts`
- Plan reference: implementation-plan.md:195-217, 365
- Pattern to follow: existing cases in the same file
- Quality requirements:
  - Replace the literal at :21 with the imported constant.
  - Add one valid-projection case per new kind, asserting the exact copied fields and
    `selectable`.
  - Add hostile in-process cases (NaN value, unknown tone, non-RichText text, a badge action
    other than select) that each give `renderFailed`.
  - Add a case showing that a v2 envelope at `dashboard-catalog/2` fails.

### Batch 1 verification

- All six files contain real implementations, with no TODO or stub markers.
- Batch-local check (lane may run it):
  `npx nx run-many -t typecheck,lint -p shared,declarative-dashboard` and
  `npx jest --config libs/frontend/declarative-dashboard/jest.config.ts surface-view-model`
- The acceptance gate is the Wave 1 verification above.

## Batch 2: Literal sweep — declarative-dashboard specs + Apps literals II — COMPLETE (commit 2d18e0215)

- Recommended executor: CLI lane `opencode`
- Fallback executor: frontend-developer subagent
- Execution mode: sequential within the lane (Wave 1 runs it in parallel with Batches 1, 3, 4)
- Rationale: plan G1 + G6b + G3. These are single-literal replacements: 11 files, 2 frontend libs.
- Tasks: 2 | Depends on: none (the constant already exists; Batch 1 changes its value) | Wave: 1
- AC: 9, 10, 15
- Rule for every file:
  - Replace each `'dashboard-catalog/2'` string literal with the imported
    `SURFACE_CATALOG_VERSION` from `@ptah-extension/shared`, merging into the existing import.
  - Change nothing else.
  - If a file has no other import from that package, add one.
  - Report each file with its before/after line.

### Task 2.1: declarative-dashboard literal specs (plan G1 + G6b) — COMPLETE

- Files (MODIFY):
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-layout.component.spec.ts` (:17)
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-choice-input.component.spec.ts` (:23)
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-checkbox-input.component.spec.ts` (:14)
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-text-input.component.spec.ts` (:23)
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-renderer.component.spec.ts` (:22)
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/budget-render.spec.ts` (:93)
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/trust-boundary.spec.ts` (:30)
- Plan reference: implementation-plan.md:366-373, 428, 436
- Validation notes: do NOT touch `surface-node.component.spec.ts` (Batch 10) or the view-model
  files (Batch 1).

### Task 2.2: Apps literals II (plan G3) — COMPLETE

- Files (MODIFY):
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/services/apps-submit-flow.spec.ts` (:65)
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/components/apps-surface-panel.component.spec.ts` (:38)
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/components/apps-page.component.spec.ts` (:134)
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/components/apps-page-conversation.spec.ts` (:126)
- Plan reference: implementation-plan.md:380-383, 430

### Batch 2 verification

- Each of the 11 files has no `dashboard-catalog/2` left, and imports the constant.
- Acceptance gate: Wave 1 verification.

## Batch 3: Literal sweep — Apps literals I, hosts, shared fixture + converter spec — COMPLETE (commit 2d18e0215)

- Recommended executor: CLI lane `opencode`
- Fallback executor: backend-developer subagent
- Execution mode: sequential within the lane (parallel with Batches 1, 2, 4)
- Rationale: plan G2 + G5b + G6a, plus the two literal-only files moved here from plan B. The
  shared fixture `makeSurfaceEnvelope` (`libs/shared/src/testing/fixtures/surface.ts:31`) feeds
  nine shared specs, so it must flip in the same wave as the version. The converter spec is a
  literal-only expectation. Moving them keeps the batches file-disjoint and lets Wave 1 run
  every other shared spec. 12 files.
- Tasks: 3 | Depends on: none | Wave: 1
- AC: 9, 10, 15
- Rule: same as Batch 2, except Task 3.3's converter spec, which edits the expected literal.

### Task 3.1: Apps literals I (plan G2) — COMPLETE

- Files (MODIFY):
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/state/apps-surface-reducer.spec.ts` (:49)
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/state/apps-surface-intake.spec.ts` (:37)
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/services/apps-surface-sync.spec.ts` (:31)
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/services/apps-surface-operations.service.spec.ts` (:74)
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/services/apps-surface-lanes.spec.ts` (:55)
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.spec.ts` (:46)
- Plan reference: implementation-plan.md:374-379, 429

### Task 3.2: RPC, CLI and app composition literals (plan G5b + G6a) — COMPLETE

- Files (MODIFY):
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/rpc-handlers/src/test-utils/surface-rpc-harness.ts` (:111)
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/cli-engine/src/lib/surface-composition.spec.ts` (:81, :93)
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/apps/ptah-extension-vscode/src/di/surface-composition.spec.ts` (:102)
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/apps/ptah-electron/src/di/surface-composition.spec.ts` (:106, :117)
- Plan reference: implementation-plan.md:355-356, 384-385, 434-435
- Validation notes: if an app spec cannot import `@ptah-extension/shared` under its lint
  module-boundary rules, stop and report. Do not add an eslint-disable.

### Task 3.3: Shared fixture and converter spec (moved from plan B) — COMPLETE

- Files (MODIFY):
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/testing/fixtures/surface.ts`
    (:31): import the constant. Use a relative import from `../../mcp-apps-contracts`, following
    the file's existing import style.
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/ptah-ui-converter.spec.ts`
    (:132): edit the expected v2 output literal to `'dashboard-catalog/3'`. The literal is the
    subject under test (plan:363).
- Plan reference: implementation-plan.md:357, 363

### Batch 3 verification

- 12 files swept. Acceptance gate: Wave 1 verification.

## Batch 4: Literal sweep — vscode-lm-tools — COMPLETE (commit 2d18e0215)

- Recommended executor: CLI lane `opencode` (start when a Wave 1 slot frees)
- Fallback executor: backend-developer subagent
- Execution mode: sequential within the lane (parallel with Batches 1-3)
- Rationale: plan G4a + G4b + G5a. 10 single-literal replacements in one lib.
- Tasks: 2 | Depends on: none | Wave: 1
- AC: 9, 10, 15
- Rule: same as Batch 2.

### Task 4.1: vscode-lm-tools surface literals (plan G4a + G4b) — COMPLETE

- Files (MODIFY):
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-trust-boundary.spec.ts` (:53)
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state.store.spec.ts` (:23)
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state.service.submit.spec.ts` (:85)
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state.service.spec.ts` (:83)
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state.service.failure.spec.ts` (:43)
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state-reader.spec.ts` (:70)
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state-reader.budget.spec.ts` (:50)
- Plan reference: implementation-plan.md:386-392, 431-432

### Task 4.2: vscode-lm-tools remaining literals (plan G5a) — COMPLETE

- Files (MODIFY):
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/di/register.spec.ts` (:342)
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/surface-namespace.builder.spec.ts` (:15)
  - `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.surface.spec.ts` (:39)
- Plan reference: implementation-plan.md:393-395, 433
- Validation notes: do NOT touch `surface-tools.spec.ts`, `surface-tools.ts` or
  `dashboard-propose-spec.tool.spec.ts` (Batch 6).

### Batch 4 verification

- 10 files swept. Acceptance gate: Wave 1 verification.

---

## WAVE 2 — fallback/selection, tool description, renderers (Batches 5-8; one commit per batch)

Starts after the Wave 1 commit. The four batches are file-disjoint; run at most 3 at once.

## Batch 5: Text fallback and badge selection (plan A2) — COMPLETE (commit 58d0214f3)

- Recommended executor: CLI lane `Glm`
- Fallback executor: backend-developer subagent
- Execution mode: sequential
- Rationale: three source files and their three spec homes in `shared` (6 files). The switch
  cases and their tests are coupled.
- Tasks: 2 | Depends on: Batch 1 (Wave 1 commit) | Wave: 2
- AC: 1, 4, 6
- Phase: status-kinds

### Task 5.1: Fallback lines for the six kinds — COMPLETE

- Files: MODIFY
  `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-text-fallback.ts`;
  MODIFY
  `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-text-fallback.spec.ts`
- Plan reference: implementation-plan.md:185-192
- Pattern to follow: `surface-text-fallback.ts:18-31`
- Quality requirements: exactly one line per node:
  - `Alert (<tone>): <text>`
  - `Badge: <text>`
  - `Progress: <label> — <value>%`
  - `Radial progress: <label> — <value>%`
  - `Divider: <text>` or `Divider`
  - `Heading: <text>` or `Text: <text>`

  The value is `${value}%`, never rounded. The spec asserts each exact line, including the
  textless divider and a decimal such as 42.5.

### Task 5.2: Badge selection target cases — COMPLETE

- Files: MODIFY
  `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-patch.ts`;
  MODIFY
  `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-selection.ts`;
  MODIFY
  `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-patch.spec.ts`;
  MODIFY
  `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-selection.spec.ts`
- Plan reference: implementation-plan.md:219-229, 420
- Pattern to follow: the `stat` cases at `surface-patch.ts:383-386, 422-423`
- Quality requirements:
  - `checkSurfaceSelection` accepts `{kind:'badge'}` only when `component.kind === 'badge'`.
  - `sameSelection` treats two badge targets as equal.
  - `describeSurfaceSelection` emits `Text: <badge text>` and `Tone: <tone>`.
  - Specs cover: accepted on a badge, rejected on a non-badge, equality, and the description
    lines.

### Batch 5 verification

```bash
npx nx run-many -t typecheck,lint -p shared
npx jest --config libs/shared/jest.config.ts --testPathIgnorePatterns "/node_modules/" "surface-(contract|validator|budgets)\.spec\.ts"
```

Commit: `feat(shared): add status-kind text fallback and badge selection target`, plus the
trailer.

Batch 5 result (2026-10-05, team-leader): PASSED. Lane touched only the six listed files
(+176 lines, verified by `git diff --stat`). typecheck + lint `shared`: green. jest shared
(narrowed): 102/102 suites, 2789 tests (+5 over Wave 1). Report: `batch-5-report.md`.

## Batch 6: MCP tool description and v1 regression (plan E) — COMPLETE (commit e46a4acc0)

- Recommended executor: CLI lane `Glm`
- Fallback executor: backend-developer subagent
- Execution mode: sequential
- Rationale: one source file plus two specs in vscode-lm-tools. The growth-guard decision needs
  the measured size.
- Tasks: 3 | Depends on: Batch 1 | Wave: 2
- AC: 8, 11
- Phase: status-kinds

### Task 6.1: Tool prose for the six kinds — COMPLETE

- File: MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/surface-tools.ts`
- Plan reference: implementation-plan.md:313-320
- Pattern to follow: `surface-tools.ts:159-207`
- Quality requirements:
  - The vocabulary stays derived from `SURFACE_*_KINDS` and the version constants.
  - Add concise fields, ranges and the `dashboard.select`-only badge action for the six kinds.
  - The literal `dashboard-catalog/3` appears through the constant.
  - No independent kind tuple.
  - Keep the prose terse because of the size guard.

### Task 6.2: Completeness case and growth-guard decision — COMPLETE

- File: MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/surface-tools.spec.ts`
- Plan reference: implementation-plan.md:316-320
- Quality requirements:
  - Parse the emitted layout, input and display comma lists into exact tokens, and assert set
    equality with `SURFACE_COMPONENT_KINDS`. No substring checks.
  - Assert the literal `'dashboard-catalog/3'`.
- Validation notes (RISK, growth guard `:55-89`):
  - Measure `JSON.stringify(buildSurfaceUpdateTool()).length` before and after.
  - If it exceeds 68,449, set `SURFACE_UPDATE_MEASURED_CHARS` to the new measured size, with
    the comment `// 2026-10-05 TASK_2026_594: six status/text kinds`.
  - Update the pinned-ceiling assertion to the new `floor(measured * 1.05)`.
  - Report both numbers.
  - Do not delete or weaken the guard.

### Task 6.3: v1 propose-spec regression — COMPLETE

- File: MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/dashboard-propose-spec.tool.spec.ts`
- Plan reference: implementation-plan.md:321-324
- Quality requirements:
  - Assert that the JSON-schema enum and the prose list exactly the five v1 kinds.
  - Assert that none of the six new kinds appears.
  - The tool source stays unchanged.

### Batch 6 verification

```bash
npx nx run-many -t typecheck,test,lint -p vscode-lm-tools
```

This is the full suite: Wave 1 swept every vscode-lm-tools literal, and this batch lifts the
`surface-tools.spec.ts` exclusion.

Commit: `feat(vscode-lm-tools): describe status and text kinds in ptah_surface_update`, plus the
trailer.

Batch 6 result (2026-10-05, team-leader): PASSED. Lane touched only the three listed files
(+87/-3, `git diff --stat`). `npx nx run-many -t typecheck,test,lint -p vscode-lm-tools`
(--skip-nx-cache): green, no code-outliner flake this run. Verified on disk: prose at
`surface-tools.ts:174-178` derives kinds from `SURFACE_*_KINDS`, the cap from `SURFACE_LIMITS`;
the completeness case splits the three comma lists into exact tokens (array + set equality +
uniqueness, no substring checks) and pins `'dashboard-catalog/3'`; the v1 case pins the five
kinds in constant, schema enum and prose and asserts none of the six new kinds; the v1 tool
source is unchanged. Growth guard: measured 69,204 after the Wave 1 schemas alone (already over
the old 68,449 ceiling), 69,600 final; re-baselined with the dated `2026-10-05 TASK_2026_594`
comment, ceiling pinned at 73,080. Headroom 3,480 chars (5%) is the guard's standard rule and
no later batch edits `surface-tools.ts`; recorded as reasonable for the phase review. Side note
for the phase review: the description sits at 4,952 of the 4,956-char per-tool budget in
`mcp-contract.sweep.spec.ts` (4 chars spare). Report: `batch-6-report.md`.

## Batch 7: Alert, badge, divider renderers (plan C1) — COMPLETE (commit 911588cbf)

- Recommended executor: CLI lane `Glm`
- Fallback executor: frontend-developer subagent
- Execution mode: sequential
- Rationale: three standalone component + spec pairs (6 new files) in one lib.
- Tasks: 3 | Depends on: Batch 1 (StatusNode) | Wave: 2
- AC: 1-5
- Phase: status-kinds
- Shared requirements for every component:
  - Standalone, `ChangeDetectionStrategy.OnPush`, signal `input.required<Extract<StatusNode, {kind:...}>>()`.
  - Selector `ptah-dashboard-<kind>`.
  - Interpolation only: no `innerHTML`, no agent class, no agent style.
  - A typed `const` tone map of complete literal class strings, bound with `[class]`. No
    concatenation.
  - Each spec asserts every tone's exact class and the rendered text, under both existing theme
    roots (dark and light `data-theme`).
- Pattern to follow: `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-stat.component.ts:9-44`
- Plan reference: implementation-plan.md:231-293

### Task 7.1: DashboardAlertComponent — COMPLETE

- Files: CREATE
  `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-alert.component.ts`
  and `.../components/dashboard-alert.component.spec.ts`
- Quality requirements:
  - `alert alert-info|success|warning|error`.
  - `role="alert"` for warning/error, `role="status"` for info/success.
  - The tone word is in the accessible text.
  - No title node when `title` is absent. When present, the title comes before the text in the
    same element.
  - Reads well as a short inline note.

### Task 7.2: DashboardBadgeComponent — COMPLETE

- Files: CREATE
  `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-badge.component.ts`
  and `.../components/dashboard-badge.component.spec.ts`
- Quality requirements:
  - Six `badge badge-<tone>` literals.
  - Non-interactive when not selectable.
  - When `selectable`, render a `<button>` that emits a `SurfaceSelection` with target
    `{kind:'badge'}` on the existing selection output, and sets `aria-pressed` from the current
    selection. Mirror the stat component's selection handling.

### Task 7.3: DashboardDividerComponent — COMPLETE

- Files: CREATE
  `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-divider.component.ts`
  and `.../components/dashboard-divider.component.spec.ts`
- Quality requirements:
  - `horizontal: 'divider'`, `vertical: 'divider divider-horizontal'`.
  - `role="separator"`, and `aria-orientation` equal to the contract direction.
  - Optional text rendered as plain text.

### Batch 7 verification

```bash
npx nx run-many -t typecheck,lint -p declarative-dashboard
npx jest --config libs/frontend/declarative-dashboard/jest.config.ts "dashboard-(alert|badge|divider)\.component"
```

Commit: `feat(declarative-dashboard): add alert, badge and divider renderers`, plus the trailer.

Verified by team-leader: scoped typecheck+lint PASS; jest 3 suites / 9 tests PASS; literal tone and
direction maps, role by tone, no title node without title, badge selectable only via
`dashboard.select` with target `{kind:'badge'}`, divider inversion mapped, no `innerHTML`, no
hard-coded colours. Report: `batch-7-report.md`.

Carried to the phase review (not a commit blocker): `dashboard-alert.component.ts:25` conveys tone
only through an `sr-only` word; the NFR asks for tone in text, not colour alone, for sighted users
as well.

## Batch 8: Progress, radial-progress, text-block renderers (plan C2) — COMPLETE (commit 11124dc0a)

- Recommended executor: CLI lane `Glm`
- Fallback executor: frontend-developer subagent
- Execution mode: sequential
- Rationale: three component + spec pairs (6 new files), same shape as Batch 7, and
  file-disjoint from it.
- Tasks: 3 | Depends on: Batch 1 | Wave: 2
- AC: 1-5
- Phase: status-kinds
- Shared requirements: as Batch 7.

### Task 8.1: DashboardProgressComponent — COMPLETE

- Files: CREATE
  `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-progress.component.ts`
  and `.../components/dashboard-progress.component.spec.ts`
- Quality requirements:
  - Neutral maps to the bare `progress`; the other tones map to `progress progress-<tone>`
    literals. `progress-neutral` does not exist.
  - `role="progressbar"`, `aria-valuemin="0"`, `aria-valuemax="100"`, exact `aria-valuenow`.
  - The accessible label comes from `label`, and the visible label stays as text.

### Task 8.2: DashboardRadialProgressComponent — COMPLETE

- Files: CREATE
  `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-radial-progress.component.ts`
  and `.../components/dashboard-radial-progress.component.spec.ts`
- Quality requirements:
  - `radial-progress text-<tone>` literals for all six tones.
  - The same ARIA contract as progress.
  - Only `[style.--value]="node().value"` is allowed. The spec asserts the custom-property value.
  - The visible percentage is shown.

### Task 8.3: DashboardTextBlockComponent — COMPLETE

- Files: CREATE
  `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-text-block.component.ts`
  and `.../components/dashboard-text-block.component.spec.ts`
- Quality requirements:
  - `heading` renders a heading element; `body` renders a `<p>`.
  - Use base-content typography tokens only, with no hard-coded colours.

### Batch 8 verification

```bash
npx nx run-many -t typecheck,lint -p declarative-dashboard
npx jest --config libs/frontend/declarative-dashboard/jest.config.ts "dashboard-(progress|radial-progress|text-block)\.component"
```

Commit: `feat(declarative-dashboard): add progress, radial-progress and text-block renderers`,
plus the trailer.

---

## WAVE 3 — shared regressions, dispatch, skill/prompt (Batches 9-11; one commit per batch)

Batch 9 needs Batch 5. Batch 10 needs Batches 7 and 8. Batch 11 needs Batch 6. All three are
file-disjoint and can run together once Wave 2 is committed.

## Batch 9: Shared contract, validator and budget regressions (plan B) — COMPLETE

- Recommended executor: CLI lane `Glm`
- Fallback executor: backend-developer subagent
- Execution mode: sequential
- Rationale: three shared spec files. They lift the last shared exclusion. (The fixture and
  converter spec moved to Batch 3.)
- Tasks: 3 | Depends on: Batches 1, 5 | Wave: 3
- AC: 1-10
- Phase: status-kinds

### Task 9.1: Contract spec — COMPLETE

- File: MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-contract.spec.ts`
- Plan reference: implementation-plan.md:360, 421
- Quality requirements:
  - Replace the alias identity (`:45`) and the 13-count (`:46`) with three checks: the v1 kinds
    are a prefix of `SURFACE_DISPLAY_KINDS`; none of the six new kinds is in
    `DASHBOARD_COMPONENT_KINDS`; `SURFACE_COMPONENT_KINDS` has length 19.
  - Change the literal at `:63` to the imported constant.

### Task 9.2: Validator spec — COMPLETE

- File: MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-validator.spec.ts`
- Plan reference: implementation-plan.md:84-96, 172-181, 194-199, 362
- Quality requirements:
  - Lines :241, :257, :263 and :286 use the constant.
  - Keep an explicit `/2` negative case: `ok:false`, `field:'catalogVersion'`, and a reason that
    names `/3`.
  - Add a `spec/1` + `catalog/3` "does not pair" case.
  - Add a minimal valid case per kind.
  - Add rejection for every closed enum, for `class`/`style`/`html`/`path`/`data`/extra keys,
    for value -1, 101, NaN, Infinity and a string, for a non-select badge action and a badge
    action with `url`, and for an empty or over-length text-block.
  - A v1 document naming each new kind is rejected.
  - `spec/1` + `/1` is unchanged.

### Task 9.3: Budget spec — COMPLETE

- File: MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-budgets.spec.ts`
- Plan reference: implementation-plan.md:179-181, 361
- Quality requirements:
  - The literal at :50 uses the constant.
  - Add boundary cases for the new kinds against the existing component/string/byte limits
    (at limit accepted, over limit rejected), and badge actions at
    `maxActionsPerComponent` and one more.
  - No limit is widened.

### Batch 9 verification

```bash
npx nx run-many -t typecheck,test,lint -p shared
```

This is the full suite.

Commit: `test(shared): cover status and text kinds in contract, validator and budget specs`, plus
the trailer.

Batch 9 result (2026-10-05, team-leader): PASSED. Lane touched only the three spec files.
`npx nx run-many -t typecheck,test,lint -p shared --skip-nx-cache`: all 3 targets green, with no
exclusions. Run directly, the three specs give 3/3 suites and 176/176 tests, with nothing skipped
and no `testPathIgnorePatterns` in the shared jest config. Coverage was checked on disk: the 6 new
kinds are accepted on the document and create paths, and so are alert title, divider text,
value 0/100 and select-only badge actions. These are rejected: unknown tone, direction and role;
`class`/`style`/`html`/`path`/`data`/extra key on each kind; value -1, 101, NaN, Infinity and
`'50'`; badge `open-url`, `surface.submit` and select-with-`url`; empty and over-length
text-block. A v1 document with any new kind is rejected. `spec/2`+`catalog/2` is rejected
(`catalogVersion`, names `/3`), and `spec/1`+`catalog/3` gives "does not pair". Budget at-limit
and over-limit cases read `SURFACE_LIMITS`, and no limit was widened. Exactly one `/2` literal
remains, and it is the deliberate negative case. Report: `batch-9-report.md`.

## Batch 10: surface-node dispatch and badge pressed state (plan D) — COMPLETE (commit 8e457b495)

- Recommended executor: CLI lane `Glm`
- Fallback executor: frontend-developer subagent
- Execution mode: sequential
- Rationale: integration of the six renderers into the recursive dispatcher. 2 files, or 3 if
  typecheck forces the renderer edit.
- Tasks: 2 | Depends on: Batches 7, 8 | Wave: 3
- AC: 1-5, 15
- Phase: status-kinds

### Task 10.1: Dispatch wiring — COMPLETE

- File: MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-node.component.ts`
- Conditional file: MODIFY
  `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-renderer.component.ts`
  **only if typecheck requires it**. Report the exact error if the edit was needed.
- Plan reference: implementation-plan.md:247-250, 295-309, 425
- Pattern to follow: `surface-node.component.ts:60-92` (`SURFACE_NODE_KINDS`), `:135-185`
  (`@switch`), `:203-234` (computed guards)
- Quality requirements:
  - Static imports of the six components in this file only.
  - Add six values to `SURFACE_NODE_KINDS`.
  - Add six computed kind guards.
  - Add six `@case` branches, forwarding the badge `selectionChange` and the current selection.
  - No new eager imports anywhere else.

### Task 10.2: surface-node spec — COMPLETE

- File: MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-node.component.spec.ts`
- Quality requirements:
  - Change the literal at :15 to the constant.
  - Add one dispatch test per new kind (the correct child component renders and no
    `renderFailed`).
  - Add a badge `aria-pressed` test, true when selected and false otherwise, plus the emitted
    `{kind:'badge'}` selection.

### Batch 10 verification

```bash
npx nx run-many -t typecheck,test,lint -p declarative-dashboard
```

This is the full suite: it lifts the last dashboard exclusion.

Commit: `feat(declarative-dashboard): dispatch status and text kinds in surface-node`, plus the
trailer.

Batch 10 result (2026-10-05, team-leader): PASSED. Lane touched only `surface-node.component.ts`
and its spec; `surface-renderer.component.ts` untouched (no typecheck need). Six `@case`
branches verified; badge forwards `[surfaceId]`, `[selection]="interaction().selection"` and
`(selectionChange)`, matching the stat case; `aria-pressed` test covers false, true and the emitted
`{ kind: 'badge' }` target. The six renderers are static imports in `surface-node.component.ts`,
the same way the existing kind components (stat, table, list, chart) are imported, so the
existing eager/lazy boundary is unchanged by construction; the eager-closure gate proof stays
with Task 12.2. `npx nx run-many -t typecheck,test,lint -p declarative-dashboard
--skip-nx-cache`: green, no exclusions. Report: `batch-10-report.md`.

## Batch 11: Skill catalog reference, prompt pointer, catalog-reference spec (plan F) — IN_PROGRESS

- Recommended executor: CLI lane `Glm`
- Fallback executor: backend-developer subagent
- Execution mode: sequential
- Rationale: 5 files across mcp-apps-page, vscode-lm-tools and the app assets. The catalog
  reference and its spec must agree.
- Tasks: 3 | Depends on: Batch 6 | Wave: 3
- AC: 12, 14
- Phase: status-kinds

### Task 11.1: Apps prompt pointer — IN_PROGRESS

- Files: MODIFY
  `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/apps-system-prompt.ts`;
  MODIFY
  `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/apps-system-prompt.spec.ts`
- Plan reference: implementation-plan.md:336-341
- Pattern to follow: `apps-system-prompt.ts:9-27`
- Quality requirements:
  - One line names `ptah-surface-authoring` and lists every kind from `SURFACE_COMPONENT_KINDS`.
  - The selectable-items line (`:15`) includes badges.
  - The spec parses that one line into exact tokens and asserts set equality with
    `SURFACE_COMPONENT_KINDS`.

### Task 11.2: Skill link and `references/catalog.md` — IN_PROGRESS

- Files: MODIFY
  `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-surface-authoring/SKILL.md`;
  CREATE
  `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-surface-authoring/references/catalog.md`
- Plan reference: implementation-plan.md:325-335
- Quality requirements:
  - SKILL.md gains a link to `references/catalog.md` next to the existing `ptah-ui.md` link
    (`:12`). Frontmatter is unchanged.
  - catalog.md has one exact heading per kind in `SURFACE_COMPONENT_KINDS` (19). Each has
    exactly one fenced JSON component example, valid in a `dashboard-spec/2` +
    `dashboard-catalog/3` envelope, plus concise field, action and binding constraints.
  - No daisyUI class names.
- Validation notes: do NOT create `.claude/skills/ptah-surface-authoring/`.

### Task 11.3: Catalog-reference spec — IN_PROGRESS

- File: CREATE `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/code-execution/surface-catalog-reference.spec.ts`
- Plan reference: implementation-plan.md:328-335
- Pattern to follow:
  `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/code-execution/skill-description-shape.spec.ts:16`
  (asset path resolution)
- Quality requirements:
  - Key the examples by exact heading or fence id.
  - Assert that the key set equals `SURFACE_COMPONENT_KINDS` (so `progress` cannot be satisfied
    by `radial-progress`).
  - Assert exactly one example per kind.
  - Wrap each example in a v2 `/3` envelope and assert `validateSurfaceDocument(...).ok`.

### Batch 11 verification

```bash
npx nx run-many -t typecheck,test,lint -p mcp-apps-page,vscode-lm-tools
```

Commit: `feat(mcp-apps-page): point Apps agents to the ptah-surface-authoring catalog reference`,
plus the trailer.

---

## WAVE 4 — integration (Batch 12)

## Batch 12: Manifest regeneration, eight-project run, webview build, eager-closure gate (plan H) — PENDING

- Recommended executor: backend-developer subagent. These are commands plus one generated file,
  and the subagent needs shell and long timeouts.
- Fallback executor: devops-engineer subagent
- Execution mode: sequential
- Rationale: integration finish. Order matters: manifest, then tests, then build, then gate.
- Tasks: 2 | Depends on: Batches 1-11 | Wave: 4
- AC: 13, 15
- Phase: status-kinds (last batch; the phase review is due after its commit)

### Task 12.1: Regenerate the content manifest — PENDING

- File: MODIFY (generated only)
  `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/content-manifest.json`
- Commands, from the worktree root: `npm run manifest:generate`, then `npm run manifest:check`.
- Quality requirements:
  - The diff adds
    `ptah-core/skills/ptah-surface-authoring/references/catalog.md` beside the existing
    `ptah-ui.md` entry (`content-manifest.json:69-70`), plus any hash/version fields the
    generator owns.
  - No hand edits.

### Task 12.2: Full verification and eager-closure gate — PENDING

- Commands (worktree root, in order, output tailed):
  1. `npx nx run-many -t typecheck,test,lint -p shared,declarative-dashboard,mcp-apps-page,vscode-lm-tools,rpc-handlers,cli-engine,ptah-extension-vscode,ptah-electron`
  2. `npx nx build ptah-extension-webview` (the default production configuration has
     `statsJson: true`, `apps/ptah-extension-webview/project.json:71,93`). It writes
     `dist/apps/ptah-extension-webview/stats.json`.
  3. `npm run gate:eager-closure`
- Validation notes:
  - If the gate fails, report the newly eager modules. Do not edit the allowlist.
  - If the build cannot resolve from the worktree, report the error. Do not copy
    `node_modules`.
  - A final `grep -rln "dashboard-catalog/2" libs apps --include=*.ts` lists only
    `surface-validator.spec.ts` (the deliberate negative case), plus `surface-view-model.spec.ts`
    if Task 1.6 kept one.

### Batch 12 verification

- All three commands above pass. `npm run manifest:check` passes.

Commit: `chore(content): regenerate content manifest for the surface catalog reference`, plus
the trailer.

Then return `NEEDS REVIEW` for the phase `status-kinds`. The combined diff runs from the parent
of the Wave 1 commit to HEAD. Reviews: code-logic and style.
