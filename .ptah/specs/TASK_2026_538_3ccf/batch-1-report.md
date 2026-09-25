# Batch 1 implementation report — TASK_2026_538

Implemented Tasks 1.1–1.6 within the assigned file list. Final scoped verification passed: **67 suites, 1,882 tests, zero failures; typecheck and lint passed**. Lint has five warnings (two in the new data-model helper). No git commands were run.

## Files and work by task

### Task 1.1 — Catalog

CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\surface-catalog.ts`

- Added v2 versions, supported-version lists, the legal v1/v1 and v2/v2 pairs, 13 kinds, actions, host-supported actions, presentation enums and empty values.
- Added id, operation-id and path-segment patterns, dot separator and all three denied segments.
- Added every specified surface/store budget with PROVISIONAL documentation. Component count, tree depth, string length and table/series budgets read `DASHBOARD_LIMITS`; display kinds reuse `DASHBOARD_COMPONENT_KINDS` by reference.
- Validation: v1 lists remain unchanged; v2 ids reject colons, preventing collision with `v1:<specId>`. Tests pin both facts and the state-read budget arithmetic.

### Task 1.2 — Plain types

CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\surface.types.ts`

- Added layout/input/display components, rich text/actions, recursive JSON/data model, envelope, patch/update/get-state contracts, selection, content/state views, submission records, form values, host state operations, pushes, operation statuses and all ten rejection reasons.
- Display types retain the v1 fields through `Omit`, remove children and replace actions with v2 actions. Inputs have no actions or children.
- All imports are type-only; neither this file nor the catalog imports Zod. Source guards in the new contract spec check that separation.

### Task 1.3 — v1 helper exports

MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\dashboard-spec.schemas.ts`

- Only added `export` to `requireOneDataSource` and `checkChart`. No implementation or barrel changes.
- Existing v1 spec files were not edited. All existing v1 suites ran in the passing shared-project check, including contract, budget and trust-boundary specs; the new suite separately verifies an unchanged v1 round-trip and rejection of a v2 select in a v1 envelope.

### Task 1.4 — Schemas

CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\surface.schemas.ts`

- Added strict schemas for all 13 component kinds, actions, hints/options, bounded data values/model, envelope, patch/update/get-state inputs, selection, paths and ids.
- Reused the specified v1 leaf schemas and both exported helpers. Every declared object uses `.strict()`; arrays are capped; schemas bind to the plain types with `satisfies z.ZodType<...>` and explicit annotations at recursive seams. Named metadata is present for `SurfaceComponent` and `SurfaceDataValue`.
- Version literals name the offending version field. A v1 id passed to the v2 id schema names `ptah_dashboard_propose_spec`.
- Data recursion terminates at the depth budget before parsing another container, including cyclic in-process values. A root container counts as depth 1; scalar values add no level.
- R12: strict hints reject `pattern` and `regex`; contradictory text lengths reject; options are bounded/nonempty and duplicate values reject; URLs use only `DashboardUrlSchema`; submit params reject; data keys use the bounded segment grammar and denylist.
- The first verification found that Zod records skip `__proto__` before key-schema validation. Added a raw-object-key preprocessor before record parsing for both data records and action params. The regression now rejects that key at every tested nesting level. A JSON Schema generation test confirms the raw-key guard preserves named definitions and record constraints for future MCP tool schemas.

### Task 1.5 — Pure data model

CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\surface-data-model.ts`

- Implemented `parseSurfacePath`, `readSurfacePath`, segment-aware `pathsOverlap`, and sequential/atomic `applyDataModelOps` with copy-on-write ancestors and result unions.
- Set creates missing object parents; set through an existing scalar, null or array rejects with the path. Remove-missing succeeds without creating parents, including below a scalar.
- R12: every operation path and set payload is checked before assignment/spread. Existing data and final data are checked too. Nested denied payload keys reject, and specs compare all `Object.prototype` property descriptors before/after hostile writes.
- Inputs are never mutated; tests use frozen input and check identity preservation for untouched branches. Typed in-process accessors that throw produce a generic rejection, with no exception diagnostic exposed.
- `readSurfacePath(model, path, kind)` supplies the catalog's empty value when missing. The optional kind-free form returns `undefined` for absence, distinguishing absence from a stored `null`. Reads ignore inherited properties. Required-checkbox semantics are documented as checked/true; submit enforcement belongs to the binding batch.

### Task 1.6 — Fixtures and specs

CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\testing\fixtures\surface.ts`

- Added envelope/text-input builders, a populated component of each of the 13 kinds and a depth fixture.

CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\surface-contract.spec.ts`

- Round-trips each kind and all patch/update operations; rejects unknown keys and `style`/`className` on each kind; checks mixed versions, ids, selection, action URLs/params, hints/options, data sources, table widths, chart point totals and collection boundaries.
- Rejects non-finite numbers, undefined, functions, over-deep/cyclic data and denied keys. Adds source trust-boundary guards for the new files because the existing v1 scanner's file list is fixed and this batch must not edit v1 specs.

CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\shared\src\mcp-apps-contracts\surface-data-model.spec.ts`

- Covers path grammar/limits, overlaps, empty-value table, own-property reads, set/replace/remove/remove-missing, creation of parents, immutable/atomic failure, denied paths and nested payloads, Object.prototype integrity, depth/width and throwing accessors.

## Repository evidence and scope

- Runtime: Node 24.x (`package.json:5`); TypeScript 6.0.3 and Zod 4.6.5 in the root manifest/lockfile. `libs/shared/tsconfig.json` enables strict checking. This is a platform-neutral shared module, not a NestJS service; no DI registration applies.
- Wiring/validation precedent: `dashboard-catalog.ts`, `dashboard-spec.types.ts`, `dashboard-spec.schemas.ts` and `testing/fixtures/dashboard-spec.ts`. The shared project's `project.json` defines the scoped typecheck/test/lint targets.
- Boundaries: `libs/shared/project.json` tags it `scope:shared,type:util`; `eslint.config.mjs` restricts those tags to shared/util dependencies. New production imports stay local to the contract folder.
- All new source/spec files are below the 700-line soft ceiling (largest: schema and contract-spec files, each below 650 lines).
- No barrel/index, existing v1 spec, frontend, persistence, or concurrent `ai-provider.types.ts` edit was made.

## Verification

1. `ptah_get_diagnostics` after edits: final result **0 errors, 0 warnings** from the TypeScript compiler.
2. Initial requested command, using PowerShell's `Select-Object -Last 40` as the `tail -40` equivalent:

   `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared`

   Result: typecheck and lint passed; tests had **1 failed / 1,880 passed**, **1 failed / 66 passed suites**. The sole failure was the newly exposed raw `__proto__` record-key case described above. It was fixed in scope.
3. After the security correction and regression test, reran scoped verification with static output to retain test counts:

   `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared --output-style=static`

   Result: **exit 0; 3 targets passed; 67/67 suites and 1,882/1,882 tests passed; zero snapshots.** Captured output was tailed, not printed in full. Relevant final tail:

```text
241:12  warning  'error' is defined but never used  @typescript-eslint/no-unused-vars
✖ 5 problems (0 errors, 5 warnings)

> nx run @ptah-extension/shared:typecheck
> tsc --noEmit --project libs/shared/tsconfig.lib.json

> nx run @ptah-extension/shared:test
The @nx/jest:jest executor is deprecated and will be removed in Nx v24.
Warning: Failed to load the ES module: .../libs/shared/jest.config.ts.
A worker process has failed to exit gracefully and has been force exited.

Test Suites: 67 passed, 67 total
Tests:       1882 passed, 1882 total
Snapshots:   0 total
Time:        30.484 s
Ran all test suites.

NX Successfully ran targets typecheck, test, lint for project @ptah-extension/shared
Run duration: 43.5s
Cache: 0/3 hit (0%)
VERIFICATION_EXIT_CODE=0
```

The lint warnings include two new unused typed catch bindings in `surface-data-model.ts`, whose diagnostics are intentionally discarded at the trust boundary. Three other shared-project warnings and the existing executor/module-format/worker-teardown warnings were not changed outside this batch's ownership. No external-file verification failure blocked this batch.

## Handoff and work not performed

- No Batch 1 implementation task remains unfinished.
- Whole-document aggregate component count/depth, unique ids/actions, input counts, binding compatibility, draft/submit validation, submit scope and byte accounting remain with the explicitly assigned validator/binding/patch batches (plan Components 4–5). Envelope schemas cap their own collections; they do not replace those semantic checks.
- No generated tool descriptions, RPC/store integration or barrel exports were added; these belong to later batches.
- Cross-review and git operations remain with the invoking team-leader workflow. This report does not claim reviewer acceptance or a commit.
