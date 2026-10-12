# Batch 1 report: S1 catalog `/4` contract (TASK_2026_623_3492)

Executor: backend-developer. Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel`.
I made no git operations and did not edit `batches.md`.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\surface-catalog.ts`
  - Adds the `/4` version constant and pair.
  - Adds per-version kind lists. The `/3` lists keep their values.
  - Adds the trend enums, the spark minimum and the `SurfaceCatalogVersion` type.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\surface.types.ts`
  - Adds `SurfaceAccordionComponent`, `SurfaceAvatarComponent` and `SurfaceStatTrend`.
  - Adds stat `trend?` and `spark?`.
  - Widens `SurfaceEnvelope.catalogVersion` to `SurfaceCatalogVersion`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\surface.schemas.ts`
  - Adds the `/4` schemas: accordion, trend, `/4` stat, avatar, the `/4` component union and the `/4` envelope.
  - Every `/3` schema is byte-for-byte unchanged.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\surface.validator.ts`
  - The version check matches the whole pair and returns `catalog`.
  - Adds a named rejection of `/4` features on `/3` trees.
  - Picks the schema by catalog version.
  - Update input stays `/3` only.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\surface-validator.spec.ts`
  - Adds a new `dashboard-catalog/4` describe block. The existing cases are untouched.
- MODIFIED (plan deviation, see below) `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\surface-bindings.ts`
  - The layout-kind set now uses the `/4` superset, so the tree walk goes into `accordion` children.

## Task 1.1: catalog `/4` constants, types and schemas (done)

Evidence in `surface-catalog.ts`:

- `:14`: `SURFACE_CATALOG_VERSION = 'dashboard-catalog/3'` is unchanged. The Apps tool text, the Apps prompt and every
  spec that pins `/3` still see `/3`.
- `:20`: `SURFACE_CATALOG_VERSION_4 = 'dashboard-catalog/4'`.
- `SURFACE_SUPPORTED_CATALOG_VERSIONS = [/3, /4]`.
- `DASHBOARD_CONTRACT_VERSION_PAIRS` gains `[SURFACE_SCHEMA_VERSION, SURFACE_CATALOG_VERSION_4]` (`:32`).
- Per-version kinds: `SURFACE_LAYOUT_KINDS`, `SURFACE_DISPLAY_KINDS` and `SURFACE_COMPONENT_KINDS` keep the `/3` values
  (still 19 kinds).
- New lists:
  - `SURFACE_CATALOG_4_ONLY_LAYOUT_KINDS = ['accordion']` (`:69`)
  - `SURFACE_CATALOG_4_ONLY_DISPLAY_KINDS = ['avatar']` (`:70`)
  - `SURFACE_CATALOG_4_ONLY_STAT_FIELDS = ['trend','spark']` (`:71`)
  - `SURFACE_CATALOG_4_LAYOUT_KINDS`, `SURFACE_CATALOG_4_DISPLAY_KINDS` and `SURFACE_CATALOG_4_COMPONENT_KINDS` (`:73-85`)
- Closed enums: `SURFACE_TREND_DIRECTIONS = ['up','down']` and `SURFACE_TREND_POLARITIES = ['good','bad']` (`:87-88`).
  `SURFACE_SPARK_MIN_POINTS = 2` (`:90`).
- The types `SurfaceLayoutKind`, `SurfaceDisplayKind` and `SurfaceComponentKind` now span the `/4` superset (`:105-110`).
  They were only used inside `shared` (`surface-bindings.ts`, `surface.index.ts`).

Evidence in `surface.types.ts`:

- `SurfaceAccordionComponent {id, kind:'accordion', title: SurfaceRichText (required), children, actions?}`. This is D2.
- `SurfaceStatTrend {direction, amount, percent, polarity?}`.
- `SurfaceStatComponent` gains `trend?` and `spark?: readonly number[]`.
- `SurfaceAvatarComponent {id, kind:'avatar', name: string, subtitle?: string}` is plain text, with no
  url/colour/icon/class/style field.
- Both new kinds are in the `SurfaceComponent` union.
- `SurfaceEnvelope.catalogVersion: SurfaceCatalogVersion`.
- Only type imports are used, as `surface-contract.spec.ts:598-616` requires.

Evidence in `surface.schemas.ts`:

- `:536-597`, after the `/3` `SurfaceComponentSchema`, which is unchanged:
  - `catalog4Children()`
  - `SurfaceAccordionComponentSchema` (strict, title required)
  - `SurfaceStatTrendSchema` (strict, `z.enum` direction and polarity, `amount` nonnegative, `percent` boolean)
  - `SurfaceCatalog4StatComponentSchema = SurfaceStatComponentSchema.extend({trend, spark: z.array(z.number()).min(2).max(maxSeriesPoints)})`
  - `SurfaceAvatarComponentSchema` (strict, `name` 1..maxStringLength, `subtitle` a bounded plain string)
  - `SurfaceCatalog4ComponentSchema`: the `/3` leaf schemas plus the `/3` layout schemas re-pointed at `/4` children
    with `.extend`, plus accordion, the `/4` stat and avatar.
- `:684`: `SurfaceCatalog4EnvelopeSchema = SurfaceEnvelopeSchema.extend({catalogVersion: literal /4, components: /4 union})`.
- `.extend` keeps `.strict()`. The tests prove it: `class`, `style` and `url` are rejected on the `/4` stat, accordion
  and avatar.
- `SurfaceEnvelopeSchema`, `SurfaceComponentSchema`, `SurfacePatchOpSchema` and `SurfaceUpdateInputSchema` are
  unchanged. The JSON schema that `ptah_surface_update` generates is therefore identical, and the `/4` kinds are not
  advertised to Apps agents (task-description.md:226).

## Task 1.2: validator whole-pair check and `/3` rejection (done)

Evidence in `surface.validator.ts`:

- Whole-pair match (`:170-184`): `find(([schema, catalog]) => schema === schemaVersion && catalog === catalogVersion)`.
  - On a miss the reason lists every partner of the schema version, for example
    `expected dashboard-catalog/3 or dashboard-catalog/4`.
  - The ok result now carries `catalog` (`SurfaceContractCatalogVersion`). The existing spec uses `toMatchObject`, so
    the extra field is compatible.
- `findCatalog4FeatureBreach` (`:367`) is an iterative raw walk over `children`. It runs only for `/3` trees, after the
  structural and byte checks and before the zod parse. It names the path, the field and the catalog. Examples:
  - `components.0.kind: "accordion" is a dashboard-catalog/4 kind; it is not part of dashboard-catalog/3.`
  - `components.0.trend: stat field "trend" is part of dashboard-catalog/4; ...`
- `validateSurfaceDocument` checks the `/3` features, then parses with `SurfaceCatalog4EnvelopeSchema` for `/4` and
  with the released `SurfaceEnvelopeSchema` for `/3`.
- `validateSurfaceUpdateInput` (`ptah_surface_update`):
  - A `/4` surface is rejected with `surface.catalogVersion: "dashboard-catalog/4" is the ptah-ui display catalog;
    ptah_surface_update accepts dashboard-catalog/3 only.`
  - A `/4` kind or field in the carried surface or in any op `component` is rejected with a named path, for example
    `ops.0.component.kind`.
- Spark points are counted per component (A7, below). A `/4` stat holds one series, so the array bound
  2..`maxSeriesPoints` is the per-component budget.

New spec cases in `surface-validator.spec.ts`, describe `surface validator — dashboard-catalog/4`:

- spec/2 pairs with `/3` and `/4` as whole pairs; spec/1 with `/4` does not pair; spec/2 with catalog/1 names both
  partners.
- A `/4` document with accordion, avatar, stat trend and spark is accepted, including nesting.
- Every `/3` kind is still valid under `/4` (`makeSurfaceComponents`).
- A `/3` document is rejected, with the field named, for avatar, accordion, trend, spark, and an avatar nested in a
  `/3` card.
- `ptah_surface_update` rejects a `/3` create with a trend, a patch `add-component` with an accordion, and a `/4`
  create.
- `class`, `style` and `url` are rejected on the avatar, the accordion and the stat with a trend. `class`, `style`,
  `url`, `color` and `icon` are rejected inside a trend.
- Closed enums: a bad direction, a bad polarity, a negative amount, a non-boolean percent and a missing `percent` are
  all rejected.
- Spark: 0 points, 1 point, `maxSeriesPoints`+1 points and a non-number are rejected. Exactly `maxSeriesPoints` points
  are accepted, and so are two stats each at `maxSeriesPoints` (the budget is per component).
- The accordion needs a title. The avatar name must not be empty. An avatar subtitle must be a plain string.
- The semantic walk goes into accordion children: a duplicate id inside an accordion is rejected.

## Verification (run once each, foreground, one at a time)

`npx jest -c libs/shared/jest.config.ts libs/shared/src/mcp-apps-contracts/surface-validator.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40`

```
Test Suites: 1 passed, 1 total
Tests:       109 passed, 109 total
Time:        5.825 s
```

`npx nx typecheck @ptah-extension/shared --parallel=1 2>&1 | tail -n 20`

```
> tsc --noEmit --project libs/shared/tsconfig.lib.json
NX  Successfully ran target typecheck for project @ptah-extension/shared
```

`npx nx lint @ptah-extension/shared --parallel=1 2>&1 | tail -n 20`

```
757:1  warning  File has too many lines (758). Maximum allowed is 700  max-lines
✖ 6 problems (0 errors, 6 warnings)
NX  Successfully ran target lint for project @ptah-extension/shared
```

- The lint passes with 0 errors.
- I ran `eslint` directly on my six changed files. The only warning in them is `surface.schemas.ts` max-lines (758).
  The file was already 718 lines at HEAD, over the 700 limit, so this warning existed before the batch; it grew by 40
  lines.
- The other 5 warnings are in files I did not touch.
- Nx Cloud printed a 401 "organization disabled" notice. It does not affect local targets.

I did not run anything else. Other projects were not checked, as CLAUDE.md requires.

## Risks and edge cases

- **A7 (spark points count toward `maxSeriesPoints` per component): VERIFIED.**
  - `dashboard-catalog.ts:167` says "`maxSeriesPoints` is summed across all series of ONE chart component".
  - `checkChart` (`dashboard-spec.schemas.ts:279-298`) sums `series[].points.length` for one component and compares the
    total with `DASHBOARD_LIMITS.maxSeriesPoints`. There is no surface-wide sum.
  - A `/4` stat has exactly one spark series, so `z.array(z.number()).min(2).max(SURFACE_LIMITS.maxSeriesPoints)` is
    the same per-component rule.
  - The tests pin this: `maxSeriesPoints` is accepted, +1 is rejected, and two stats each at the limit are accepted.
- **`/3` regression (HIGH): handled.**
  - The `/3` constants, kind lists, schemas and update-input schema are unchanged. So are the tool JSON schema and the
    tool text inputs.
  - A `/3` document is still parsed by the released `/3` schema. The one new step before it only rejects `/3` trees
    that carry `/4` features, and those were already rejected by the strict `/3` schema. The accepted `/3` set is
    therefore identical. Only the wording of those rejections is more specific now.
  - All 90-odd existing cases in `surface-validator.spec.ts` pass unchanged. That includes the catalog/2 and
    does-not-pair cases, whose messages still contain the asserted fragments.
- **`ptah_surface_update` and `/4`.**
  - task-description.md:226 rules out exposing `/4` through the Apps tooling.
  - I kept the update input `/3`-only, with a named reason, rather than adding a `/4` update schema.
  - `validateSurfaceDocument`, which the ptah-ui pipeline uses (`ptah-ui-pipeline.ts:31`), accepts `/4`.
- **Trust:** no class/style/url/colour/icon field exists on any new kind. Every new object is `.strict()`, and the
  tests prove `.extend` keeps that.

## Plan deviations

1. **I changed `surface-bindings.ts`, which is not in the Batch 1 file list.**
   - The plan (A6) assumed `accordion` would be added to `SURFACE_LAYOUT_KINDS`. Doing that would change the `/3`
     vocabulary that the Apps tool text, the Apps prompt and `surface-contract.spec.ts:59` (`toHaveLength(19)`) read.
     That conflicts with "`/3` semantically unchanged" and with the instruction to add kinds per version.
   - So `SURFACE_LAYOUT_KINDS` stays `/3`, and `surface-bindings.ts` now builds its layout set from
     `SURFACE_CATALOG_4_LAYOUT_KINDS`.
   - Without this, `visitSurfaceComponents` would not go into accordion children. The validator would then miss
     duplicate ids, inputs and submit scope inside an accordion. The new test "walks accordion children" pins it.
   - A6 still holds: `add-component` and `locate` treat `accordion` as a parent.
   - The hard-coded patch error text at `surface-patch.ts:165` remains Task 2.2's job.
2. **The `/4` kinds use new constants instead of entries in the existing lists.** Batch 4 (converter) should import
   `SURFACE_CATALOG_VERSION_4`, and Batch 13 should use `SURFACE_CATALOG_4_*` where it needs the `/4` vocabulary.

## Out-of-scope observations (not touched)

- `libs/shared/src/mcp-apps-contracts/surface-contract.spec.ts:74-77` asserts `DASHBOARD_CONTRACT_VERSION_PAIRS` has
  exactly two pairs. That spec will now fail because D1 requires the third pair `[spec/2, catalog/4]`. It needs a
  one-line update. Task 6.2 runs that spec, so the owning batch should add the pair to the expectation.
- `libs/frontend/declarative-dashboard/src/lib/view-model/surface-view-model.ts:29-30,190-211`:
  - `SurfaceComponent` now includes `accordion` and `avatar`. `LayoutComponent` and `DisplayComponent`, and the
    `default:` branch that calls `mapDisplayNode`, will probably fail `@ptah-extension/declarative-dashboard`
    typecheck until Batch 13 maps the new kinds.
  - I did not run that check because the project is outside this batch, as CLAUDE.md requires.
  - No producer emits `/4` before Batch 4, so nothing breaks at runtime.
- `surface.schemas.ts` is over the 700-line lint warning (it was 718 at HEAD and is 758 now). If the phase review
  wants it fixed, the `/4` block (`:530-597`, `:679-691`) can move to its own file.
