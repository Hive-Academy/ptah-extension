# Batch 15F report: `isRenderableNode()` fails closed on `/4` atom fields

Executor: frontend-developer. Reference: `code-logic-review-phase3.md` Serious #1 (lines 10-16).

## Task 15F.1: done

### Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\view-model\surface-view-model.ts`.
  Adds four shared boolean predicates: `isSurfaceStatTrend`, `isSurfaceSpark`, `isSurfaceAvatarName` and
  `isSurfaceAvatarSubtitle`. The module exports them, but `src/index.ts` does not, so they stay internal to the lib.
  `checkTrend`, `checkSpark` and `mapAvatar` now call these predicates. Their error texts and their projected output
  have not changed.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\components\surface-renderer.component.ts`.
  Adds a new `hasRenderableAtomFields(kind, value)` check, which `isRenderableNode()` calls next to its existing
  kind, id and `selectable` gate:
  - An avatar needs a non-blank string `name`. Its `subtitle` must be absent or a string.
  - A stat's `trend`, when present, must pass `isSurfaceStatTrend`.
  - A stat's `spark`, when present, must pass `isSurfaceSpark`.
  - Every other kind passes this check unchanged.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\components\surface-renderer.component.spec.ts`.
  Adds a new describe block (`:192`) and imports `SURFACE_SPARK_MIN_POINTS`.

### Rules (identical to the mapper, now one implementation)

- **Trend:** a plain object (`isObject`). `direction` is in `SURFACE_TREND_DIRECTIONS`. `amount` is a number, finite
  and `>= 0`. `percent` is a boolean. `polarity` is absent or in `SURFACE_TREND_POLARITIES`.
- **Spark:** `Array.isArray`. Length is between `SURFACE_SPARK_MIN_POINTS` and `SURFACE_LIMITS.maxSeriesPoints`,
  inclusive. Every item is a finite number.
- **Avatar:** `typeof name === 'string' && name.trim().length > 0`. `subtitle === undefined || typeof subtitle === 'string'`.
- **Non-throwing:** the predicates only use `typeof`, `Array.isArray`, `includes` and `every` on plain data. A
  throwing getter is still caught by the existing try/catch in `attemptBuild()`.

### Regression tests

All of these live in `surface-renderer.component.spec.ts` under
`describe('a non-throwing override that returns malformed /4 atom fields')`. Each one overrides
`SURFACE_VIEW_MODEL_BUILDER` to return `{ renderFailed: false, viewModel }`.

Each case runs as `it.each(...)('renders nothing and reports renderFailed once for %s')` (`:216`). It asserts three
things:
- the renderer has no children;
- no `ptah-dashboard-avatar` or `ptah-dashboard-stat` element exists;
- `failures === 1`, checked after an extra re-render.

| Required case | `%s` test name |
|---|---|
| Avatar name as a rich-text object | an avatar with a rich-text name |
| Avatar subtitle as a rich-text object | an avatar with a rich-text subtitle |
| Blank avatar name | an avatar with a blank name |
| Trend direction `'sideways'` | a stat trend with direction "sideways" |
| Trend polarity `'danger'` | a stat trend with polarity "danger" |
| Trend amount NaN | a stat trend with a NaN amount |
| Trend amount -1 | a stat trend with a negative amount |
| Spark containing NaN | a spark containing NaN |
| Spark containing Infinity | a spark containing Infinity |
| Spark below the minimum length | a spark below the minimum point count |
| Spark over `maxSeriesPoints` | a spark over maxSeriesPoints |
| Extra case | a stat trend without a boolean percent flag |
| Extra case | a stat trend that is not an object |
| Extra case | a spark that is not an array |

The positive control is `still renders a well-formed avatar and a stat with a valid trend and spark` (`:225`). It
expects:
- `failures === 0`;
- the avatar name `Agent` and the subtitle `Reviewer` are rendered;
- the trend text contains `down 4.2%`;
- the `stat-spark` SVG is present.

## Verification (run one at a time, from the worktree)

1. `npx jest -c libs/frontend/declarative-dashboard/jest.config.ts libs/frontend/declarative-dashboard/src/lib/components/surface-renderer.component.spec.ts libs/frontend/declarative-dashboard/src/lib/view-model --coverage=false --maxWorkers=2 2>&1 | tail -n 40`
   gave `Test Suites: 3 passed, 3 total; Tests: 93 passed, 93 total`. The `marked` `--moduleNameMapper` override was
   not needed. The existing view-model specs also pass, which confirms the mapper's behaviour and error texts did not
   change.
2. `npx nx typecheck @ptah-extension/declarative-dashboard --parallel=1 2>&1 | tail -n 20` printed
   `Successfully ran target typecheck`.
3. `npx nx lint @ptah-extension/declarative-dashboard --parallel=1` (output filtered with `grep`) printed
   `127 problems (0 errors, 127 warnings)`, which equals the 127 baseline, and `Successfully ran target lint`.

## Constraints kept

The following are unchanged:
- the agent-content contract;
- the default mapper's behaviour and error texts;
- the 21-kind catalog;
- decision #51;
- the templates;
- `src/index.ts` (barrel);
- `sparklineGeometry()`.

No git operations were run, and `batches.md` and `task.md` were not edited.

## Out-of-scope observations

None.
