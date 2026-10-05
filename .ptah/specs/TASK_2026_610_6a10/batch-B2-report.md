# Batch B2 report

Implemented the display-only `ptah-ui` converter, host-data resolver and safe render pipeline.

## Public API

```ts
convertPtahUi(doc: PtahUiDocument, surfaceId: string): PtahUiConversion
resolvePtahUi(conversion: PtahUiConversion, snapshot: TurnSourceSnapshot | null): ResolvedPtahUiContent
renderPtahUiBlock(body: string, input: RenderPtahUiBlockInput): RenderPtahUiBlockResult
```

`RenderPtahUiBlockInput` supplies `surfaceId`, `snapshot`, and the existing validator's `countBytes` function. The pipeline order is parser caps, parse, convert, resolve, then `validateSurfaceDocument`; its only unexpected-error catch returns `internal error`.

| ptah-ui element | Surface display kind |
| --- | --- |
| `stats` | one `stat` per item |
| literal `table` | `table` |
| source `table` | `table` |
| literal `list` | `list` |
| source `list` | `list` |
| `chart line` | `line-chart` |
| `chart bar` | `bar-chart` |

The converter uses `dashboard-spec/2` / `dashboard-catalog/2` from the surface catalog, emits no actions, inputs, data refs, or data model, and keeps source bindings typed until resolution.

## Resolution rules

- A pending source resolves to literal `pending`; unavailable sources, including every source with a null snapshot, resolve to literal `unavailable`.
- These states never become numeric zero, formatted cost, or blank text.
- Usage cost and duration use `formatUsdCost` and `formatDurationMs`.
- Diff per-file null counts render `unknown`, binary counts render `binary`; truncation and missing baselines become table descriptions; empty rows receive an empty-state description/item.
- Literal components are never merged with source-bound rows. Source lookup checks own snapshot keys before indexed access.

## Verification

- `npx jest -c libs/shared/jest.config.ts libs/shared/src/mcp-apps-contracts/ptah-ui-converter.spec.ts libs/shared/src/mcp-apps-contracts/ptah-ui-resolver.spec.ts libs/shared/src/index.zod-free.spec.ts` — passed: 3 suites, 20 tests (6 converter fixtures, 6 resolver/pipeline cases, 8 zod-free checks).
- `npx tsc -p libs/shared/tsconfig.lib.json --noEmit` — passed with no output.
- Scoped TypeScript diagnostics — 0 errors, 0 warnings.

Pipeline success/failure cases live in the resolver spec because B2 owns this pipeline implementation; B3 retains the UI trust/rendering cases. No deviations.

## Review fix 1

Pending and unavailable source tables now emit a row whose first cell is the literal status and whose remaining cells are empty strings. This preserves the declared column count, so it satisfies the table schema while meeting Req 3.2-3.4's visible pending/unavailable requirement. Empty available source tables retain `rows: []`, which the schema permits, and expose their empty state through `description`.

The pipeline now returns `validated.surface` and its parsed data model, not the pre-validation conversion. Dedicated pipeline state-matrix tests cover every source-binding element across null, pending, unavailable, empty and populated snapshots.

Review-fix verification: the four requested Jest suites pass with 53 tests, `npx tsc -p libs/shared/tsconfig.lib.json --noEmit` passes, and scoped diagnostics report zero errors and warnings.
