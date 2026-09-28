# Batch 16 executor report — TASK_2026_559_8ca9 (Lane A)

Executor: backend-developer (sub-agent), 2026-09-26, worktree `task-559-mcp-tool-contract`, base HEAD 4cd9a91da.

## Changes

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/dashboard-propose-spec.tool.ts`
  - :43 `buildInputSchema()` now returns a hand-written schema with no `$ref`. It covers the argument object (`spec` required, closed); the envelope (the 7 required keys, the enums of supported `schemaVersion` and `catalogVersion`, `revision` as an integer ≥ 1, `title` and `description` as `{text}`, closed); and `components` (an array with minItems 1 and maxItems `DASHBOARD_LIMITS.maxComponents`, where each item is an object that needs `id` and a `kind` taken from the enum `DASHBOARD_COMPONENT_KINDS`). It no longer calls `z.toJSONSchema` and uses no `as` cast.
  - :104 the description is now short. It names the kinds, tells the agent to run `ptah.help('dashboard')` through `execute_code` BEFORE the first call, and keeps the PLAIN TEXT and ALL-OR-NOTHING rules plus the replace/bump-revision rule. Zod (`DashboardProposeSpecInputSchema`) is still where input is enforced. The namespace path is unchanged.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts`
  - :12-19 imports the dashboard constants from `@ptah-extension/shared/mcp-apps-contracts`. This is the same import `dashboard-namespace.builder.ts` in the same directory already uses.
  - :58-98 `HELP_DOCS.dashboard` now carries the detail that was removed from the tool description. That covers the envelope, the fields for each kind, the rule that ids are unique, the either/or `data: { resultId }` choice, the plain-text rule, the action allowlist, the URL scheme rules and `describeDashboardLimits()`, all filled in from the contract constants. The old line claiming the tool's "input schema is generated from the zod contract, so it teaches you the exact shape" is removed, because it would be false now.
- `.../mcp-core/dashboard-propose-spec.tool.spec.ts` — :94-274 hold the budget constant, the structural checker (`conformsTo`, `keywordsIn`) and the fixture tables. :276 has the rewritten "the tool definition" block and :390 the new `ptah.help('dashboard')` block. Removed: the "byte for byte equals z.toJSONSchema" spec and the "NAMED definition plus $ref" spec. Both pinned the old design, which Task 16.1 replaces.
- `.../mcp-core/surface-tools.spec.ts` :55-90 — growth guard. `surface-tools.ts` is unchanged.

## Sizes (`JSON.stringify(tool).length`)

| Tool                                | Before (HEAD) | After                   |
| ----------------------------------- | ------------- | ----------------------- |
| ptah_dashboard_propose_spec (whole) | 15,183        | 1,539 (budget 3,000)    |
| — description                       | 2,470         | 601                     |
| — inputSchema                       | 12,567        | 806                     |
| ptah_surface_update                 | 65,190        | 65,190 (ceiling 68,449) |
| ptah_surface_get_state              | 2,141         | 2,141 (ceiling 2,248)   |

The measured sizes and the date 2026-09-26 are written into `surface-tools.spec.ts:61-62`, and the ceilings are pinned at :87-88.

## Validator

No JSON-schema validator appears in any manifest or in any repository source file. I searched for `ajv`, `@cfworker/json-schema` and `jsonschema` and got 0 hits. So the check is structural: `conformsTo` in the spec implements `type`, `properties`, `required`, `additionalProperties:false`, `items`, `enum`, `minItems`, `maxItems` and `minimum`. A second spec asserts that the advertised schema uses no keyword outside that set, so the checker cannot pass a fixture by skipping a constraint it does not understand. A third spec compares the envelope's `required` keys and property names with the zod-generated schema, which is the drift guard for the key set.

## Fixture results (after the fix)

- VALID, 5 cases: the advertised schema accepts each one with zero violations, and zod accepts each one too. The cases are `makeDashboardSpec()`, a single stat, every kind together (stat with an https action, line-chart, table, list, plus a description), `makeNestedStats(3)` and `makeStatPairs(5)`.
- INVALID, 6 cases: zod rejects each one. The cases are `{spec:{}}` and `{}` (the existing routing fixtures), a `javascript:` URL, duplicate ids, a stat with no `value`, and an unknown top-level key.

## Fails-before (new specs run against the unchanged HEAD source)

The command was `jest -c libs/backend/vscode-lm-tools/jest.config.ts dashboard-propose-spec.tool`. Result: 7 failed.

- the tool definition › fits the always-on budget of 3000 chars as JSON (15,183 > 3,000)
- the tool definition › advertises a $ref-free schema with no definitions
- the tool definition › uses only keywords the drift check below understands
- the tool definition › points to ptah.help("dashboard") and does not offer markdown
- ptah.help('dashboard') › teaches each kind, the actions and the text rule
- ptah.help('dashboard') › teaches the limits and the allowlists from the contract, not from prose
- ptah.help('dashboard') › no longer claims the tool schema teaches the exact shape

After the fix all of them pass. The 16.2 growth guard is a guard, not a behaviour change, so it passes at HEAD by design. Its sensitivity is covered by the pinned ceilings at :87-88.

## Verification (tails)

- `nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools --skip-nx-cache --parallel=2` → `Successfully ran targets test, lint, typecheck for project @ptah-extension/vscode-lm-tools`
- `nx run-many -t typecheck -p ptah-cli ptah-electron --skip-nx-cache` → `Successfully ran target typecheck for 2 projects`
- `nx run ptah-electron:validate-deps --skip-nx-cache` → `Successfully ran target validate-deps for project ptah-electron`. No `from "<word>"` appears in the new description or help text.
- `nx run degradation-audit:lint --skip-nx-cache` → `degradation-audit: TOTAL 300 unsuppressed site(s)`, Successfully
- `prettier --check` on the 4 changed files → `All matched files use Prettier code style!`
- `git status --short` → shows my 4 modified files, plus 2 untracked files that were already there and are not mine (`code-logic-review.md` and `research/diagnostics-worktree-repro.ts`). A temporary measurement spec I used was deleted.

## Deviations

1. `system-namespace.builders.ts` is not in the Batch 16 file list, but I edited it. The research fix design (agent-task-harness.md:427-429) moves the description's detail into `ptah.help('dashboard')`. The help at HEAD had no per-kind fields and said the tool schema "teaches you the exact shape", which would have made both the new pointer and that help line false claims. `HELP_DOCS` is not one of the frozen prompt constants (`ptah-core-prompt.ts`, `NATIVE_AGENT_TOOL_POLICY`).
2. I deleted two existing specs that asserted the generated `$ref` design ("byte for byte" and "NAMED definition plus $ref"). Task 16.1 removes that design on purpose. The drift guard and the required-keys comparison replace them.
3. Components are advertised as open objects, because their fields depend on `kind`. The arguments object and the envelope are closed, as they are in zod.

## Out-of-scope observations

- `ptah_surface_update` is 65,190 chars, more than 4 times the dashboard tool before this batch. Batch 16 only guards it against growth, as instructed.

## Revision round 1 (r1 REVISE 6/10)

Review: `reviews/batch-16-code-logic-review-r1.md` (S1 Serious, M1 Moderate). Both are fixed. The tool definition is still 1,539 chars (budget 3,000); none of the r1 changes touch it.

### S1: help now states every rule Zod enforces (the drift-proof option)

- NEW `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/dashboard-contract-help.ts`
  - `describeDashboardContract()` renders the shape at runtime from `z.toJSONSchema(DashboardProposeSpecInputSchema)` as TypeScript-like lines. The rendered shape covers:
    - `Arguments` and `Spec`
    - `DashboardComponent`: the shared fields once, then what each kind adds
    - `Action`, `Text`, `DataRef`, `Series`, `Column` and `ListItem`, named by matching the JSON of the exported Zod sub-schemas
  - The rendered detail includes every field and whether it is optional, the primitive types, every enum and const value, the slug pattern, the numeric bounds (`> 0`, `>= 0`), the array bounds and the string bounds that differ from the default.
  - It never hand-copies a field, so a field or enum value added to the contract shows up with no edit.
  - The renderer collects every JSON-schema keyword it does not understand. A spec requires that list to be empty.
  - `DASHBOARD_CONTRACT_RULES` holds the 7 rules JSON Schema cannot express, filled in from `DASHBOARD_LIMITS`:
    - chart, table and list need exactly one data source
    - a chart's points are counted across all its series against the limit
    - each table row has one cell per column
    - an action's url is required on open-url and forbidden on every other action
    - the URL scheme rule
    - the whole-tree count, depth and unique-id limits
    - the byte budget
- `system-namespace.builders.ts`: `HELP_DOCS.dashboard` now embeds `describeDashboardContract().text` (computed once at module load) and the rules list. It replaces the hand-written envelope, kind and action prose. The unused imports are removed. The rendered help is 4,953 chars and is fetched on demand only.
- New drift guards in `dashboard-propose-spec.tool.spec.ts`, in the block "ptah.help('dashboard') states every rule zod enforces":
  - A walk of the generated schema that does not use the renderer. It asserts every property name (`name?: `), every enum/const value (`"value"`) and every pattern (`/p/`) appears in the help, and that each `$ref` target is defined there.
  - Refinement tripwire: it reads `libs/shared/src/mcp-apps-contracts/dashboard-spec.schemas.ts` and pins the number of `.refine(` / `.superRefine(` sites at 7 (pinned 2026-09-26). Adding a refinement fails the spec until it is documented.
  - 14 help-guided rejections. Each asserts that the help states the exact rule and that Zod rejects the payload. They include the review's 6 reproductions:
    - id `Total users`
    - `delta: '+5%'`
    - `y: '3'`
    - `align: 'start'`
    - a list item with a string `detail`
    - open-url with no url
  - The other 8: a url on refresh, an object as a params value, a chart with both series and data, a table row that is short, a table with no columns, `revision: 0`, a date with no offset, and `format: 'markdown'`.
  - A new valid fixture covers bar-chart, data references on line-chart, table and list, column `align`, stat `unit`/`delta` and action `params`. It passes both the advertised schema and Zod, which closes the gap in bar-chart and data-reference coverage.
  - The old help assertion `not.toMatch(/format\??\s*:/)` is now `not.toContain('markdown"')`. The help correctly shows `format?: "plain"`, and the TASK_2026_493 concern was only about offering markdown.

### M1: checker uses own-property checks

- In `dashboard-propose-spec.tool.spec.ts`, `conformsTo` now uses `Object.prototype.hasOwnProperty.call` for the schema's property map and for required-key membership.
- New "the structural drift checker" block:
  - `constructor`, `__proto__`, `toString`, `hasOwnProperty` and `valueOf` as extra top-level keys each give exactly `$: unexpected key <k>`, and Zod rejects each one too.
  - A `toString` key inside the envelope is rejected as well.
  - Negative controls: a missing key, a wrong type, an unknown version enum, `revision` 0, an empty `components` and an ordinary extra key.

### Fails-before (new specs run on the r0 code, before the fix)

`jest -c libs/backend/vscode-lm-tools/jest.config.ts dashboard-propose-spec.tool` → **23 failed, 39 passed, 62 total**:

- 14 help-guided rejections
- "is what ptah.help returns"
- "names every field, enum value, literal and id pattern"
- "teaches each kind…"
- 5 prototype-key cases
- the prototype key inside the envelope

"renders with no keyword unexpressed" and "documents every refinement" passed from the start, because they test the new module itself. After the fix: 63 passed, 0 failed.

### Verification (tails)

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache --parallel=2` → `Successfully ran targets test, lint, typecheck`
- `nx run-many -t typecheck -p ptah-cli ptah-electron --skip-nx-cache` → `Successfully ran target typecheck for 2 projects`
- `nx run ptah-electron:validate-deps --skip-nx-cache` → Successfully. There is no `from "<word>"` in the help or the rules.
- `nx run degradation-audit:lint --skip-nx-cache` → `TOTAL 300`. No new catch site was added.
- `prettier --check` on the 5 changed files → all formatted
- `git status --short`:
  - mine: the 4 files modified in r0, plus the untracked `dashboard-contract-help.ts`
  - not mine: `context.md` is modified by another agent; `code-logic-review.md`, `research/diagnostics-worktree-repro.ts` and `reviews/batch-16-code-logic-review-r1.md` are untracked
  - I never touched `implementation-plan-languages.md`, and the temporary dump spec I used was deleted

### Deviations

- One new source file, `dashboard-contract-help.ts`, sits beside `system-namespace.builders.ts`, which is past its size ceiling. S1 asked for the help to be generated from the Zod schema, and the file holds that renderer.
- The refinement tripwire reads the source of the shared contract file with `fs` inside the spec. JSON Schema carries no refinements, and walking Zod internals would be more fragile.
