# Implementation plan review — TASK_2026_594_31ff

- Artifact: `implementation-plan.md`
- Revision: 3
- Author: codex CLI lane (CLI side)
- Reviewer: software-architect subagent (in-process side)
- Round: 2 of max 2
- Checked against: `task-description.md` Revision 3 (user-approved, criteria 1-15) and `context.md` "User Decisions (2026-10-05)" and "Gate 1" (Q1 reject spec/2 + catalog/2; Q2 badge actions limited to `dashboard.select`; Q3 progress values are literals only)

**Verdict: REVISE**

Most of the plan is sound. It decouples v1 from v2, keeps the pair table as the single source of legality, adds no gate allowlist and puts the version-literal sweep into the batches. But two seams the plan treats as existing do not exist in the code: the renderer view model and badge selection. As written, every new kind renders `renderFailed`, and a badge selection is rejected by the host. Several renderer details would also ship broken or invisible styling. All file:line references below are relative to the worktree root `W = D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds`.

## Findings

### 1. BLOCKING — the renderer view model cannot represent or map the new kinds
- Evidence:
  - `libs/frontend/declarative-dashboard/src/lib/view-model/view-model.types.ts:21-25` defines `DisplayNode = DisplayOf<DashboardComponent>`, which covers only the v1 kinds. So the plan's input type `Extract<DisplayNode, { kind: 'alert' }>` (plan lines 154-155) is `never`.
  - `surface-view-model.ts:140-142` sends every non-layout, non-input v2 component to `checkDisplayShape` and then `mapDisplayNode`. `dashboard-view-model.ts:9-11` types that mapper's input to v1 kinds only, and `dashboard-view-model.ts:80-81` throws `'Unknown dashboard component kind.'`. Even after a type fix, every new kind would therefore produce `renderFailed` at runtime (`surface-view-model.ts:187-189`). This breaks criteria 1, 2, 3 and 5.
  - The plan lists `surface-view-model.ts` only as a version-literal site, and does not list `view-model.types.ts` at all.
- Change:
  - Add a v2-only node type to `view-model.types.ts`. For example, `StatusNode = (SurfaceAlertComponent | … | SurfaceTextBlockComponent) & { readonly selectable: boolean }`, included in `SurfaceNode` and **not** in `DisplayNode`, so the v1 types and `DashboardViewModel` stay unchanged.
  - Add an explicit `case 'alert' | 'badge' | 'progress' | 'radial-progress' | 'divider' | 'text-block'` branch to `buildSurface` in `surface-view-model.ts`, before `default`. It calls a v2-only mapper that copies only the contract fields and performs defensive checks: `typeof value === 'number'` and `Number.isFinite`, tone and role membership, and `isRichText`. The mapper throws a fixed-text `TypeError` on hostile input, matching the existing fail-closed pattern at `surface-view-model.ts:94-106`.
  - Keep `mapDisplayNode` as the v1/v2 legacy mapper; do not widen it.
  - Each renderer's input type becomes `Extract<StatusNode, { kind: … }>`.
  - Add `view-model.types.ts` to a batch: the same batch as `surface-view-model.ts`, and before or together with Batch C, because Batch C compiles against it.

### 2. BLOCKING — badge `dashboard.select` has no selection target, so the host rejects it
- Evidence:
  - `SurfaceSelectionTarget` contains only `stat | table-row | list-item | chart-point` (`surface.types.ts:174-182`; `surface.schemas.ts:578-615`).
  - `checkSurfaceSelection` accepts the `stat` target only when `component.kind === 'stat'`, and its `default` branch fails (`surface-patch.ts:382-413`).
  - `sameSelection` (`surface-patch.ts:421-436`) and `describeSurfaceSelection` (`surface-selection.ts:56-91`, which returns `null` for anything else) are also closed sets.
  - The renderer also branches on `target.kind` in `declarative-dashboard/src/lib/components/surface-renderer.component.ts`.
  - The plan says the badge will "emit the existing `SurfaceSelection`/`dashboard.select` pathway" (plan lines 191-193), but no existing target is legal for a badge. Q2/criterion 4 require badge selection to work.
- Change:
  - Add the target `{ kind: 'badge' }` (a no-index target mirroring `stat`) to `SurfaceSelectionTarget` and `SurfaceSelectionTargetSchema`.
  - Add a matching branch to `checkSurfaceSelection` (`component.kind === 'badge'`) and to `sameSelection`.
  - Add a `describeSurfaceSelection` branch that emits `Text: <badge text>` and `Tone: <tone>`.
  - Add `aria-pressed` handling in the badge renderer, mirroring `dashboard-stat.component.ts:31-35,67-69`.
  - Update the `surface-renderer.component.ts` target handling where it is exhaustive.
  - Name these files in Batch A (shared: `surface-patch.ts`, `surface-selection.ts`). This breaks Batch A's 6-file limit, so split it (see finding 9).
  - Add regression cases: badge selection accepted; a badge selection on a non-badge component rejected.
  - Update the Apps prompt's selectable-items line (`apps-system-prompt.ts:15`) to mention badges.
  - This is inside the approved catalog/3 bump. It does not change the schema version and does not add an action, so no user question is needed.

### 3. SERIOUS — `progress-neutral` does not exist in the installed daisyUI
- Evidence: the installed daisyUI is 4.12.24 (`node_modules/daisyui/package.json`). Searching `node_modules/daisyui/dist/full.css` and `styled.css` finds no `progress-neutral` rule. `badge-neutral`, `alert-info`, `radial-progress` and `divider-*` are present.
- Change: map progress tone `neutral` to the bare `progress` class (default base-content colour), not to a modifier. Keep `progress-primary|info|success|warning|error`. Add a renderer test asserting that `neutral` produces no `progress-*` modifier.

### 4. SERIOUS — the daisyUI divider modifiers are the opposite of the contract's `direction`
- Evidence: `node_modules/daisyui/dist/full.css:27855-27869`. `.divider-horizontal` draws a **vertical** line (`flex-direction: column`, `width: 0.125rem`). `.divider-vertical` draws a **horizontal** line. The plan says "Divider uses semantic Daisy `divider` plus its direction modifier" (plan line 175), which invites a literal `divider-${direction}`. That renders the opposite orientation.
- Change: specify the map explicitly:
  - `horizontal` → `divider` (default horizontal rule)
  - `vertical` → `divider divider-horizontal`

  Also require `role="separator"` with `aria-orientation` equal to the contract `direction`, and a test asserting class and orientation for each direction.

### 5. SERIOUS — the Tailwind/daisyUI class scan needs complete literal class strings
- Evidence:
  - `apps/ptah-extension-webview/tailwind.config.js:6-9` builds CSS only from classes found by the content globs: `src/**` plus `createGlobPatternsForDependencies`, which reaches `libs/frontend/declarative-dashboard`.
  - daisyUI is a Tailwind v3 plugin (`tailwind.config.js:66`), so unused component modifiers are purged.
  - The plan lists the class names but does not forbid building them by concatenation.
- Change: require each renderer file to hold a `const … = { info: 'alert-info', … } as const` record (one per kind, typed `Record<Tone, string>`) containing complete class strings, used through `[class]` or `[ngClass]` lookup. Forbid template or string concatenation such as `'alert-' + tone`. Add a renderer test that iterates every tone and asserts the exact class.

### 6. SERIOUS — radial progress needs a renderer-computed style binding, which the plan forbids
- Evidence: daisyUI `.radial-progress` reads the CSS variable `--value` (`full.css:3729-3741`; the default is `--value: 0`). Without it the ring always draws 0%. Plan line 156 says "never … a style value".
- Change: allow exactly one renderer-owned binding, `[style.--value]="node().value"`. The value comes from the validated finite number and passes through no agent string. Keep the prohibition on agent-supplied `style`. Assert the CSS variable in the radial spec.

### 7. SERIOUS — the badge action schema cannot be written as described under zod 4.6.5 plus the `satisfies` pattern
- Evidence:
  - `SurfaceActionSchema` is `z.object(...).strict().superRefine(...) satisfies z.ZodType<SurfaceAction>` (`surface.schemas.ts:134-180`).
  - A refinement on it cannot narrow the output type to a literal `'dashboard.select'`, so `satisfies z.ZodType<SurfaceBadgeComponent>` fails.
  - Extending a refined object is not a safe path in zod 4 either (zod 4.6.5 is installed).
- Change: specify a dedicated strict schema, `SurfaceBadgeActionSchema = z.object({ id: componentId(), action: z.literal('dashboard.select'), label: DashboardRichTextSchema, params: <the existing params schema> }).strict()`, with no `url`, because `url` is legal only on `dashboard.open-url` (`surface.schemas.ts:166-172`). Extract the existing `params` sub-schema (`surface.schemas.ts:140-155`) into a local `actionParams()` factory so both schemas share it. Badge `actions` = `z.array(SurfaceBadgeActionSchema).max(SURFACE_LIMITS.maxActionsPerComponent).optional()`. Define `SurfaceBadgeAction` in `surface.types.ts` as `Omit<SurfaceAction, 'action' | 'url'> & { readonly action: 'dashboard.select' }`.

### 8. SERIOUS — substring "completeness" checks cannot detect a missing `progress`
- Evidence: the existing test `surface-tools.spec.ts:154-159` checks `description.toContain(kind)` for each kind. The kind `progress` is a substring of `radial-progress`, and `text` is a substring of `text-block` and of ordinary prose. Omitting `progress` or `text` would therefore still pass, which defeats criteria 11, 12 and 14.
- Change: in the tool spec, the prompt spec and the catalog-reference spec, parse the emitted list into tokens before comparing:
  - Tool description: split the `display …` / `input …` / `layout …` lists produced at `surface-tools.ts:173` on `, ` and compare as sets.
  - Prompt: compare the one kinds line as a set.
  - Catalog: use heading or fence keys.

  Each check is a set equality against `SURFACE_COMPONENT_KINDS`. Also assert the literal string `'dashboard-catalog/3'` in the tool spec (criterion 11 asks for the literal; the current test only checks the constant).

### 9. SERIOUS — batch boundaries and verification fixes
- Batch A grows to 8 or more files (catalog, types, schemas, text fallback, patch, selection; the validator needs no change, see finding 11). Split it:
  - A1: `surface-catalog.ts`, `surface.types.ts`, `surface.schemas.ts`
  - A2: `surface-text-fallback.ts`, `surface-patch.ts`, `surface-selection.ts`

  A2 depends on A1's types, so the two run serially.
- Batch C only creates components. The existing pattern has one spec per display renderer (`components/dashboard-stat.component.spec.ts`, `dashboard-list.component.spec.ts`). Criteria 1-3 and the accessibility NFR need per-kind tests: classes for every tone, dark and light theme roots, ARIA, and "no title element when `title` is absent". Split C:
  - C1: alert, badge and divider components plus their 3 specs (6 files)
  - C2: progress, radial-progress and text-block components plus their 3 specs (6 files)

  Both depend on the new `view-model.types.ts` from finding 1.
- Batch D: add `view-model.types.ts` and, if the renderer's target handling changes, `surface-renderer.component.ts`. This pushes D past 6 files, so move the literal-only specs (`budget-render.spec.ts`, `trust-boundary.spec.ts`) into a G sub-batch. Move `view-model.types.ts` plus the `surface-view-model.ts` mapping into a new batch (call it D0) that runs **before** C1 and C2, because C compiles against it.
- Batch E lists `dashboard-propose-spec.tool.ts` as MODIFY, but plan lines 221-224 say it is unchanged, and it holds no catalog/2 literal (grep confirms). Replace it with `dashboard-propose-spec.tool.spec.ts`, adding an assertion that the enum and description contain exactly the five v1 kinds and none of the six new ones (criterion 8). The existing loop at `dashboard-propose-spec.tool.spec.ts:450` checks inclusion only.
- Batch G: enumerate its sub-batches in the plan with absolute paths. Criterion 10 requires every site to be assigned, and the plan's literal table drops subdirectories: for example `state/apps-surface-intake.spec.ts`, `services/apps-surface-lanes.spec.ts`, `services/apps-session.service.spec.ts`, `services/apps-submit-flow.spec.ts`, `services/apps-surface-operations.service.spec.ts` and `components/apps-page.component.spec.ts` / `components/apps-page-conversation.spec.ts`. A file-disjoint split that works:
  - G1: the 5 declarative-dashboard component specs (layout, choice, checkbox, text-input, renderer)
  - G2 and G3: the 10 mcp-apps-page specs, as 6 + 4
  - G4: vscode-lm-tools — `surface-state.service.submit`, `.failure`, `surface-state-reader`, `.budget`, `register`, `surface-namespace.builder`
  - G5: `protocol-dispatcher.surface.spec.ts`, `surface-rpc-harness.ts` (rpc-handlers), `cli-engine/surface-composition.spec.ts`
  - G6: the two `apps/*/src/di/surface-composition.spec.ts` files plus D's displaced `budget-render.spec.ts` and `trust-boundary.spec.ts`

  G6 spans 3 projects, so split it further if the two-library rule is strict.
- Batch H: the gate reads `dist/apps/ptah-extension-webview/stats.json` (`package.json:70`). The stats file comes from a build with `statsJson: true` (`apps/ptah-extension-webview/project.json:71`). Put the build command explicitly into H's verification, before `npm run gate:eager-closure`: `npx nx build ptah-extension-webview` with the configuration that sets `statsJson`.

### 10. MINOR — the renderer class names collide with the new shared type names
- Evidence: the plan names both the shared interfaces (plan lines 62-88) and the Angular classes (plan lines 151-153) `SurfaceAlertComponent`, `SurfaceBadgeComponent`, and so on. Display renderers in this library follow `Dashboard*Component` with `ptah-dashboard-*` selectors (`surface-node.component.ts:26-29`; `dashboard-stat.component.ts:9-10,43`).
- Change: name the renderers `DashboardAlertComponent` … `DashboardTextBlockComponent` (files `dashboard-alert.component.ts`, …; selectors `ptah-dashboard-alert`, …), or `Surface*NodeComponent`. Never give a class the same name as a shared type.

### 11. MINOR — the version-pair rejection reason is the "unknown" branch, not "does not pair"
- Evidence: once `SURFACE_SUPPORTED_CATALOG_VERSIONS` holds only `/3`, `dashboard-catalog/2` is absent from `KNOWN_CATALOG_VERSIONS` (`surface.validator.ts:117-120`). Rejection therefore happens at `surface.validator.ts:145-153` (`field: 'catalogVersion'`, "… is unknown; supported: dashboard-catalog/1, dashboard-catalog/3"), not at the pairing branch (`:157-162`).
- Change: the plan must state this expected outcome. The negative `/2` test (`surface-validator.spec.ts`) should assert `ok: false`, `field: 'catalogVersion'`, and a reason naming `dashboard-catalog/3` as supported. Separately, assert that the cross-pair `spec/1` + `catalog/3` hits the "does not pair" branch. `surface.validator.ts` itself then needs no edit; drop it from Batch A, or say why it is touched.

### 12. MINOR — the location of the catalog-reference spec
- Evidence: specs that read `apps/ptah-extension-vscode/assets/plugins` already live in `vscode-lm-tools` (`code-execution/skill-description-shape.spec.ts:16`, `lane-rule-single-home.spec.ts:17`). No `shared` spec reads app assets.
- Change: move `surface-catalog-reference.spec.ts` into `libs/backend/vscode-lm-tools/src/lib/code-execution/`, following that precedent and its workspace-root path resolution. Batch F's verify then becomes `-p mcp-apps-page,vscode-lm-tools`, and F must stay file-disjoint from E. Alternatively, keep it in `shared` and record the cross-project file read as a deliberate exception.

### 13. MINOR — `surface-contract.spec.ts` assertions that the alias change breaks
- Evidence: `surface-contract.spec.ts:45` asserts `SURFACE_DISPLAY_KINDS` is the same object as `DASHBOARD_COMPONENT_KINDS` (`toBe`), and `:46` asserts `SURFACE_COMPONENT_KINDS` has length 13.
- Change: in Batch B, name both assertions. Replace the identity check with a "v1 five is a prefix of v2 display" check plus "the six new kinds are absent from `DASHBOARD_COMPONENT_KINDS`". Change the length to 19.

### 14. MINOR — the eager-closure placement passes the gate
- Evidence:
  - `scripts/eager-closure-gate.js:11-18` forbids `libs/frontend/declarative-dashboard/` and `libs/shared/src/mcp-apps-contracts/` in the `main.js` static closure.
  - The new renderer files sit inside the already-lazy declarative-dashboard library, are imported only by `surface-node.component.ts`, and are not under `/charts/`.
  - The Apps page reaches that code only through the dynamic `loadComponent` (`apps/ptah-extension-webview/src/app/app.routes.ts:59-62`).
  - `apps-system-prompt.ts` may import `SURFACE_COMPONENT_KINDS` as a value, because `mcp-apps-page` already imports contract values (`state/apps-surface-intake.ts:5`) behind that same lazy route.
- No change is required beyond the build step in finding 9.

## Criteria coverage

| AC | Plan element | Batch | Status |
| --- | --- | --- | --- |
| 1 | Schemas, renderers, dark and light coverage | A, C, D | **Gap**: the view model rejects the new kinds (F1); per-kind theme specs are missing (F9) |
| 2 | Alert with no title renders no title element; title before text | C, D | Covered by design; needs an alert spec (F9) and the view-model fix (F1) |
| 3 | Progress range, finite check, ARIA, no binding | A, C | Covered; radial `--value` is missing (F6); neutral class is wrong (F3) |
| 4 | Strict schemas reject extras, enums and non-select badge actions | A, B | Covered; the badge action schema shape must be fixed (F7) |
| 5 | Text block: non-empty, max length, fallback | A, B | Covered |
| 6 | Text fallback lines | A, B | Covered |
| 7 | v1 unchanged; `spec/2` + `/3` existing kinds unchanged; `/2` rejected | A, B | Covered; expected reason must be stated (F11) |
| 8 | v1 tool enum and description list five | E | **Weak**: E edits the tool file rather than its spec; inclusion-only check (F9) |
| 9 | `/3` constant; schema stays `/2` | A, D, G | Covered |
| 10 | Exhaustive literal sites | B, D, E, G | **Gap**: G is not enumerated and paths drop directories (F9) |
| 11 | Tool description names kinds plus literal `/3`; completeness spec | E | **Weak**: substring check (F8) |
| 12 | `catalog.md` with one valid example per kind; spec validates | F | Covered; set-based check (F8); location (F12) |
| 13 | Manifest regenerated; check passes | H | Covered |
| 14 | Prompt names the skill and lists all kinds; spec | F | Covered; set-based check (F8); badge selectable line (F2) |
| 15 | `nx test` on 8 projects plus eager gate | B-H | Covered; H needs an explicit build-with-stats step (F9) |

## Lane-introduced constraints

| Constraint (plan) | Judgment | Note |
| --- | --- | --- |
| New schemas do not spread `displayShape` | **Keep** | Matches task-description line 40 and closes the title/description/actions leak (`surface.schemas.ts:325-330`) |
| Six separate renderer components, with no mode input | **Keep, rename** | Keep the separation; rename to avoid the type collision (F10) |
| Fallback labels are stable and do not round values | **Keep** | Consistent with criterion 6 |
| No eager-closure allowlist change | **Keep** | Verified that the gate passes with the lazy placement (F14) |
| Text-block uses a local non-empty RichText schema, not a loosened shared one | **Keep** | `DashboardRichTextSchema` has no `min` (`dashboard-spec.schemas.ts:97-102`); a local schema is correct |
| `SurfaceBadgeAction` is a narrower type than `SurfaceAction` | **Change** | Use a dedicated strict literal schema; drop `url` (F7) |
| "No style value" in renderers | **Change** | Allow the renderer-owned `[style.--value]` for radial progress only (F6) |
| Badge uses the "existing" selection pathway | **Change** | Add a `badge` selection target; it is inside the approved bump, so no question to the user (F2) |
| Catalog-reference spec lives in `shared` | **Change (minor)** | Follow the `vscode-lm-tools` asset-spec precedent (F12) |
| Alert role: `role="alert"` for warning/error, `role="status"` for info/success | **Keep** | Satisfies the NFR at task-description line 64 |

No finding needs a user decision. Every change above stays inside the approved Revision 3 scope and the Gate 1 answers.

## Round 1 recheck (revision 2)

Scope: I checked every round-0 finding against Revision 2 and spot-checked the new contract claims against the source. File:line references are relative to `W`. daisyUI was checked in the hoisted `D:/projects/ptah-extension/node_modules/daisyui`, because the worktree has no `node_modules` of its own.

The user decisions are unchanged:
- Q1: `spec/2` + `catalog/2` is rejected through the unknown-catalog branch (plan "Version and catalog boundary").
- Q2: the badge accepts only `dashboard.select` (plan "Exact schema and validation seam").
- Q3: both progress values stay literal finite numbers in 0..100 with no binding (plan schema table, Progress and Radial rows).

### Resolution table

| Round-0 finding | Status | Plan section | Evidence checked |
| --- | --- | --- | --- |
| F1 BLOCKING — view model cannot map new kinds | **Resolved** | "V2 view-model projection and badge selection"; batch D0 | The `buildSurface` switch at `surface-view-model.ts:129-143` sends `default` to `checkDisplayShape` and then `mapDisplayNode`. The plan adds six explicit cases before `default` and a v2-only `StatusNode` that is outside `DisplayNode`. `selectable` can reuse `declaresSelect` (`surface-view-model.ts:47-49`). D0 runs before C1 and C2. |
| F2 BLOCKING — badge selection has no target | **Resolved (design)**; test files unassigned (see N1) | Same section; batches A2 and D; prompt bullet in "Agent-facing…" | `checkSurfaceSelection` (`surface-patch.ts:371-413`) and `sameSelection` (`:416-436`) are the closed switches the plan extends. `findSelectable` (`:346-360`) already finds any v2 component. The other non-spec sites with target-kind switches are `surface-selection.ts`, `surface.schemas.ts` and `surface.types.ts`, which are all in A1 and A2. `dashboard-chart.component.ts` handles only its own target. The prompt selectable line is `apps-system-prompt.ts:15`. |
| F3 SERIOUS — `progress-neutral` absent | **Resolved** | "Renderer design / Tone map" | daisyUI 4.12.24: `.progress-neutral` has 0 matches in `full.css`; `.progress-primary` has 3. Neutral maps to the bare `progress` class. |
| F4 SERIOUS — divider orientation inverted | **Resolved** | Tone-map paragraph | The plan uses `horizontal: 'divider'` and `vertical: 'divider divider-horizontal'`, plus `role="separator"` and `aria-orientation`. |
| F5 SERIOUS — Tailwind scan needs literal classes | **Resolved** | Tone-map paragraph | Complete literal class records are required, concatenation is forbidden, and the specs assert exact classes. `.text-neutral`, `.text-info`, `.badge-neutral`, `.alert-info` and `.radial-progress` all exist in `full.css`. |
| F6 SERIOUS — radial `--value` | **Resolved** | "Accessibility contracts" closing paragraph; **listed under Lane-introduced constraints** (plan lines 399-400) | The binding is renderer-owned, sourced from the validated finite number, and asserted in the spec. |
| F7 SERIOUS — zod 4 badge action schema | **Resolved** | "Exact schema and validation seam" | The `params` chain at `surface.schemas.ts:140-155` (`preprocess` → `record` → `refine`) extracts cleanly into a factory. A dedicated `.strict()` object with `z.literal('dashboard.select')` and no `url` avoids the `superRefine` at `:157-180`. The `SurfaceBadgeAction` type is consistent with that schema. |
| F8 SERIOUS — substring completeness | **Resolved** | "Agent-facing documentation…", bullets 1, 4 and 5 | The tool, prompt and catalog checks use exact tokens and set equality. The literal `'dashboard-catalog/3'` is asserted. |
| F9 SERIOUS — batch boundaries and verification | **Partly resolved** | "Team-leader handoff" | Resolved: A1/A2 split; C1/C2 hold 6 files each, with specs; D0 added; E now edits the spec file, not the tool; G is enumerated with absolute paths; every batch has 6 or fewer files; the parallel marks are file-disjoint (I checked that G1 `surface-renderer.component.spec.ts` and D `surface-renderer.component.ts` differ); H builds before the gate, and `defaultConfiguration: "production"` with `statsJson: true` is at `apps/ptah-extension-webview/project.json:71,93`. Still open: one G2 path is wrong, and the A2 spec files are missing (N1, N2). |
| F10 MINOR — class/type name collision | **Resolved** | "Renderer design" | The renderers become `Dashboard*Component` with `ptah-dashboard-*` selectors. |
| F11 MINOR — `/2` rejection branch | **Resolved** | "Version and catalog boundary", final paragraph | The plan expects the unknown-catalog branch (`surface.validator.ts:145-153`), adds a separate cross-pair test, and makes no validator edit. |
| F12 MINOR — catalog spec location | **Resolved** | Batch F | The spec moves to `vscode-lm-tools/src/lib/code-execution/`, and F verifies `mcp-apps-page,vscode-lm-tools`. |
| F13 MINOR — alias identity and count assertions | **Resolved** | Batch B | The identity check is replaced by a v1-prefix check plus a "new kinds absent from v1" check, and the count becomes 19. |
| F14 MINOR — eager-closure placement | **Resolved** | "Eager-closure boundary"; batch H | Static imports appear only in `SurfaceNodeComponent`, there is no allowlist change, and the build runs before the gate. |

### New findings

1. **SERIOUS — the shared selection and fallback regression specs belong to no batch.**
   - Evidence: these spec files exist and are the established homes for the behaviour A2 changes:
     - `libs/shared/src/mcp-apps-contracts/surface-patch.spec.ts`
     - `libs/shared/src/mcp-apps-contracts/surface-selection.spec.ts`
     - `libs/shared/src/mcp-apps-contracts/surface-text-fallback.spec.ts`
   - The plan requires "Tests accept a badge target and reject that target on a non-badge" (plan:221-222), `describeSurfaceSelection` badge lines (plan:218-219), and the six fallback lines (plan:182-186, AC 6). None of these tests is assigned to a file or a batch. B lists only the contract, validator, budgets, fixture and converter specs (plan:416).
   - Exact change: add the three spec files as MODIFY to A2, which brings A2 to 6 files within one project, `shared`. The tests to add:
     - `surface-patch.spec.ts`: a `{ kind: 'badge' }` target on a badge is accepted; the same target on a non-badge is rejected; `sameSelection` treats two badge targets as equal.
     - `surface-selection.spec.ts`: the badge description emits `Text: <text>` and `Tone: <tone>`.
     - `surface-text-fallback.spec.ts`: one exact line per new kind, including `Divider` without text and a non-rounded decimal percentage.

2. **MINOR — wrong path for the intake spec in G2 and the literal table.**
   - Evidence: `libs/frontend/mcp-apps-page/src/lib/apps-surface-intake.spec.ts` does not exist. The actual file is `libs/frontend/mcp-apps-page/src/lib/state/apps-surface-intake.spec.ts`, which contains `dashboard-catalog/2`.
   - The literal table rows at plan:370 and 372-378 also drop their `state/`, `services/` and `components/` subdirectories. The G batch paths for those rows are correct; only the intake path is wrong.
   - Exact change:
     - In G2 (plan:424), replace the path with `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/state/apps-surface-intake.spec.ts`.
     - In the disposition table, correct the rows to include their subdirectories: `state/apps-surface-intake.spec.ts`, `services/apps-surface-operations.service.spec.ts`, `services/apps-surface-lanes.spec.ts`, `services/apps-session.service.spec.ts`, `services/apps-submit-flow.spec.ts`, `components/apps-page.component.spec.ts` and `components/apps-page-conversation.spec.ts`.

3. **MINOR — `surface-renderer.component.ts` has no exhaustive target switch.**
   - Evidence: the renderer's `sameSelection` (`surface-renderer.component.ts:154-157`) compares `target.kind` and then `JSON.stringify`, which is generic, so a badge target needs no renderer edit.
   - Exact change: in batch D, mark this file "MODIFY only if typecheck requires it". Otherwise drop it, and keep the badge pressed-state test in `surface-node.component.spec.ts`.

4. **MINOR — H's scoped verification does not cover AC 15's eight projects.**
   - Evidence: AC 15 (task-description.md:58) names 8 projects. H runs only `ptah-extension-vscode,ptah-electron,rpc-handlers,cli-engine` (plan:432).
   - Exact change: make H's final command `npx nx run-many -t typecheck,test,lint -p shared,declarative-dashboard,mcp-apps-page,vscode-lm-tools,rpc-handlers,cli-engine,ptah-extension-vscode,ptah-electron`, then the build, then `npm run gate:eager-closure`.

No new problem changes the architecture, the contracts or the user decisions. All four fixes are mechanical edits to the handoff file lists.

Verdict: REVISE

## Round 2 recheck (revision 3)

Scope: the four round-1 items (N1-N4) against Revision 3, plus a regression pass over the handoff. File:line references are relative to `W`; plan line numbers refer to Revision 3.

### Resolution table

| Round-1 item | Status | Plan location | Evidence checked |
| --- | --- | --- | --- |
| N1 SERIOUS: shared selection and fallback specs not assigned | **Resolved** | Handoff A2 (plan:420) | A2 now MODIFYs `surface-patch.spec.ts`, `surface-selection.spec.ts` and `surface-text-fallback.spec.ts`, each with the requested assertions. That is 6 files in one project (`shared`). All three files exist. |
| N2 MINOR: wrong intake path, and table rows missing subdirectories | **Resolved** | Literal table (plan:355-395); G2 (plan:429) | G2 and the table use `.../mcp-apps-page/src/lib/state/apps-surface-intake.spec.ts`, and the file exists. Every row in the table now has an absolute path that includes its subdirectory. |
| N3 MINOR: `surface-renderer.component.ts` has no exhaustive switch | **Resolved (handoff)** | D (plan:425) | D marks the file "only if typecheck requires it", and the badge pressed-state test is in `surface-node.component.spec.ts`. One leftover: the prose at plan:224-225 still says "Update the exhaustive target handling in `surface-renderer.component.ts`". This is a wording inconsistency, the handoff wins, and it is not blocking. |
| N4 MINOR: H does not cover AC 15's eight projects | **Resolved** | H (plan:437) | The final command lists exactly the eight projects in task-description AC 15: `shared, declarative-dashboard, mcp-apps-page, vscode-lm-tools, rpc-handlers, cli-engine, ptah-extension-vscode, ptah-electron`. It then runs `npx nx build ptah-extension-webview` and `npm run gate:eager-closure`, in that order. |

### Regression checks

- **Literal sites:** `grep -rl "dashboard-catalog/2"` over `libs` and `apps` (`*.ts`) returns 41 files. The plan table has 41 rows, and each one maps to exactly one batch:
  - A1: types, catalog
  - B: contract, validator, budgets, fixture, converter specs
  - D0: `surface-view-model.ts` and its spec
  - D: `surface-node.component.spec.ts`
  - G1, G2, G3, G4a, G4b, G5a, G5b, G6a, G6b: the remaining sites

  No site is missing and none is assigned twice. `dashboard-propose-spec.tool.ts` is correctly absent from the list.
- **Path spot-check:** 7 plan paths exist on disk: `state/apps-surface-intake.spec.ts`, `dashboard-propose-spec.tool.spec.ts`, `test-utils/surface-rpc-harness.ts`, `components/apps-page-conversation.spec.ts`, `namespace-builders/surface-namespace.builder.spec.ts`, `surface-text-fallback.spec.ts` and `ptah-surface-authoring/SKILL.md`.
- **File-disjointness:** no file appears in more than one batch. G1 edits `surface-renderer.component.spec.ts`, while D conditionally edits `surface-renderer.component.ts`, which is a different file.
- **Batch size:** every batch has 6 or fewer files. The largest are A2, C1, C2, G1, G2 and G4a, with 6 each.
- **User decisions Q1-Q3:** unchanged.
  - Q1: `/2` is rejected through the unknown-catalog branch (plan:84-96).
  - Q2: badge actions are limited to `dashboard.select` (plan:111-113, 163-170).
  - Q3: values are literal finite numbers in 0..100 (plan:158-159).

### Remaining open items (for the user gate; none block the architecture)

1. **Test-gate sequencing (handoff note for the team-leader).** A1 changes `SURFACE_CATALOG_VERSION` to `/3`. From that point, any spec that still holds a literal `dashboard-catalog/2` fails, and those specs are only fixed in B and the G lanes. As currently ordered, several batches' scoped `test` gates cannot pass on their own:
   - A1's and A2's `nx test -p shared` (`surface-contract.spec.ts:46` still asserts 13 kinds, and the fixture is still `/2`).
   - D0, C1 and C2's `nx test -p declarative-dashboard`, which runs before G1 and G6b.
   - E's `nx test -p vscode-lm-tools`, which runs before G4a, G4b and G5a.

   Resolution: the team-leader either (a) moves all G lanes into the wave right after A1, before D0, C and E are verified, and runs `test` for `shared` only from B onward (`typecheck,lint` at A1 and A2), or (b) narrows the earlier batches' test gates to their own spec files. This is a matter of ordering, not architecture.
2. **Wording leftover (plan:224-225):** the prose still says to update `surface-renderer.component.ts`. The conditional wording in the D batch is the one that applies.

Verdict: APPROVED

### Batch summary (copied from plan Revision 3)

| Batch | Purpose | Files | Projects | Depends on | Parallel with |
| --- | --- | --- | --- | --- | --- |
| A1 | Catalog, types, schemas (version `/3`, six kinds, badge action) | 3 | shared | none | none |
| A2 | Text fallback, badge selection, and their specs | 6 | shared | A1 | D0 |
| B | Shared regressions (contract, validator, budgets, fixture, converter) | 5 | shared | A2 | E, C1/C2 |
| D0 | v2 `StatusNode` projection in the view model | 3 | declarative-dashboard | A1 | A2 |
| C1 | Alert, badge, divider renderers and their specs | 6 | declarative-dashboard | D0 | C2 |
| C2 | Progress, radial-progress, text-block renderers and their specs | 6 | declarative-dashboard | D0 | C1 |
| D | `surface-node` dispatch and badge pressed state (renderer edit only if needed) | 2-3 | declarative-dashboard | C1, C2 | G lanes |
| E | MCP tool description and v1 regression spec | 3 | vscode-lm-tools | A1 | B, C1/C2 |
| F | Skill, `catalog.md`, prompt, catalog-reference spec | 5 | mcp-apps-page, vscode-lm-tools (+ app assets) | E | D, G lanes |
| G1 | Dashboard literal specs | 6 | declarative-dashboard | A1 | E, F, D |
| G2 | Apps literals I | 6 | mcp-apps-page | A1 | G1 |
| G3 | Apps literals II | 4 | mcp-apps-page | A1 | G2 |
| G4a | vscode-lm-tools surface literals I | 6 | vscode-lm-tools | A1 | G1 |
| G4b | vscode-lm-tools state-service literal | 1 | vscode-lm-tools | A1 | G4a |
| G5a | vscode-lm-tools remaining literals | 3 | vscode-lm-tools | A1 | G4 |
| G5b | RPC and CLI literals | 2 | rpc-handlers, cli-engine | A1 | G5a |
| G6a | App composition literals | 2 | ptah-extension-vscode, ptah-electron | A1 | G1 |
| G6b | Dashboard trust-boundary literal | 1 | declarative-dashboard | A1 | G6a |
| H | Manifest regeneration, eight-project run, webview build, eager-closure gate | 1 (generated) | all eight in AC 15 | F, D, B, all G | none |
