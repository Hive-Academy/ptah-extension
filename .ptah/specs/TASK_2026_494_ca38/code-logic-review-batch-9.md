# Code Logic Review — `TASK_2026_494` Batch 9 (Budget confirmation)

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 8/10                                 |
| Assessment          | APPROVED                             |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 1                                    |
| Failure modes found | 1 (accepted, not exploitable today)  |

Scope reviewed: `libs/frontend/declarative-dashboard/src/lib/budget-render.spec.ts` (full file, 371 lines),
`libs/shared/src/testing/index.ts` diff, `libs/shared/src/mcp-apps-contracts/dashboard-catalog.ts` diff,
`libs/shared/src/mcp-apps-contracts/surface-catalog.ts` diff, `budget-render-report.md`, the real
`SurfaceRendererComponent` (`components/surface-renderer.component.ts`), `surface.validator.ts`,
`surface.schemas.ts`, `dashboard-spec.ts` fixtures, `libs/shared/src/testing/fixtures/surface.ts`,
`libs/shared/src/index.ts`, `eslint.config.mjs` (root and lib), `src/test-setup.ts`. Re-ran
`npx jest -c libs/frontend/declarative-dashboard/jest.config.ts libs/frontend/declarative-dashboard/src/lib/budget-render.spec.ts`
myself: 13/13 passed, 6.359s, one `console.info` per case, no `console.error`/`console.warn` noise.

## Five logic questions

### 1. How does this fail silently?

The only place a false-positive "render succeeded" could occur is in `runCase` (`budget-render.spec.ts:172-183`),
which asserts only `expect(failures).toBe(0)`. `failures` increments only via the `(renderFailed)` output
(`budget-render.spec.ts:151`), which the real `SurfaceRendererComponent` fires when `attemptBuild` returns `null`
(`surface-renderer.component.ts:217-220, 264-267`). `attemptBuild` (`surface-renderer.component.ts:109-124`)
treats an array of **zero** components as a structurally valid build (`Array.isArray(components) &&
components.every(...)` is vacuously true on `[]`). So if `buildSurfaceViewModel`/`buildDashboardViewModel` ever
regressed to silently drop every node for a large document (e.g. an off-by-one in a depth or count guard) while
still returning `{ renderFailed: false, viewModel: { components: [] } }`, this spec would report
`renderFailed=false` and pass — a genuine "success-looking result for a failure." See Moderate-1 below. This is
not exploitable today (the builders are independently spec'd and empirically produced non-empty content on this
run), but the test itself does not defend against it.

### 2. What user action produces unexpected behaviour?

N/A in the ordinary sense — this batch adds no user-facing behaviour, only a render test, barrel exports and doc
comments. The closest analogue: a future contributor reading `DASHBOARD_LIMITS`/`SURFACE_LIMITS` and trusting the
"CONFIRMED" doc comment to mean "the UI never fails at this size" would be over-trusting a jsdom-only,
relative-only measurement — but the doc comment and the report both say this explicitly (A4), so this is
disclosed, not silent.

### 3. What input data produces a wrong answer?

None found. Every fixture is built from the shared constants (`DASHBOARD_LIMITS.maxComponents`,
`SURFACE_LIMITS.maxInputs`, etc. — see the per-case table below), not smaller literals, and each is validated by
the real validator (`validateDashboardSpec` / `validateSurfaceDocument`) with the SAME `dashboardJsonBytes` byte
counter the validator itself uses internally (`surface.validator.ts:582-601, 617-629` takes `countBytes` as a
parameter and the spec passes `dashboardJsonBytes` — `budget-render.spec.ts:192, 277` etc.), so there is no
byte-encoding mismatch between "what the test thinks is at-limit" and "what the validator measures." Re-running
the suite confirms all 13 `validation.ok === true` assertions actually pass against the real validator, not a
stub.

### 4. What happens when a dependency fails?

`attemptBuild` (`surface-renderer.component.ts:109-124`) already treats a throwing `SURFACE_VIEW_MODEL_BUILDER`,
a malformed build result, and a build with a malformed node identically — all become `renderFailed`. This batch
does not override the builder (deliberately: "no view-model builder override," `budget-render.spec.ts:13`), so
none of these paths are exercised here; they are already covered by Batch 8's specs. Nothing in this batch
introduces a new dependency to fail.

### 5. What is missing that the requirements never mentioned?

- No assertion on the number of DOM nodes or view-model components actually produced per case (Moderate-1).
- `maxStringLength` is explicitly and correctly left out of scope (matches both `task-description.md` Req 8 and
  the doc comments) — not a gap, a documented boundary.
- No Electron/real-render timing column exists yet; the report and both doc comments say this is deliberate and
  that a later manual run would add a column rather than replace the jsdom numbers (`budget-render-report.md:14`,
  `dashboard-catalog.ts:150-151`).

## Failure modes

### Empty-viewModel false pass (defense-in-depth gap, not a demonstrated defect)

- Trigger: a future regression in `buildDashboardViewModel`/`buildSurfaceViewModel` that returns a successful
  build shape with `components: []` for a large/at-limit input (e.g. a depth or count guard that filters instead
  of accepting).
- Symptom: `budget-render.spec.ts` reports `renderFailed=false`, the case is green, but nothing rendered.
- Evidence: `attemptBuild` accepts `[]` as valid (`surface-renderer.component.ts:117`); `runCase` never checks
  component or DOM count (`budget-render.spec.ts:172-183`).
- Current handling: none — the assertion chain is validator-acceptance + `failures === 0` only.
- Recommendation: add one content assertion per case family, e.g. `fixture.nativeElement.querySelectorAll(...)`
  count for the DOM-heavy cases (`maxInputs`, `maxChildrenPerNode`, `maxComponents`), or at minimum expose and
  assert `viewModel()!.components.length` via a test-only accessor. The sibling spec in the same lib
  (`surface-renderer.component.spec.ts:87-100`) already does this kind of DOM assertion, so the pattern exists
  locally to copy.

No other failure mode is supported by the evidence read. The byte-exact builders (`exactBytes`,
`budget-render.spec.ts:102-119`) throw rather than silently under/over-shoot when a string would exceed
`maxStringLength` (`:113`), and both byte-exact cases assert the built byte count explicitly
(`budget-render.spec.ts:117, 256, 361`) before handing the fixture to the validator.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

### Moderate-1: No content/DOM assertion beyond the `renderFailed` counter

- File: `libs/frontend/declarative-dashboard/src/lib/budget-render.spec.ts:158-183`
- See "Failure modes" above for the full trace. Rated Moderate, not Serious/Blocking, because: (a) `attemptBuild`
  still requires every emitted node to structurally match `isRenderableNode` when the array is non-empty
  (`surface-renderer.component.ts:83-101`), so a partial-but-malformed render is still caught; (b) the builders
  under test are independently spec'd elsewhere in the lib and did produce real, timed output on this run; (c) an
  all-empty regression of this shape would very likely also be caught by the builders' own specs before it
  reached this file. It remains a real gap in exactly the property this batch exists to prove ("the content
  rendered, not a vacuous pass"), so it is recorded rather than waived.

### Minor-1: Doc-comment measured numbers are a single sample, not a statistic

- File: `dashboard-catalog.ts:150` / `budget-render-report.md:14` (the "1175.01 ms... dropping by more than 3x"
  narrative).
- My own re-run produced different absolute numbers (589.37 ms for the same first case) while preserving the same
  relative shape (first case much slower, JIT/DI warm-up). This is exactly what A4 discloses and is not a defect,
  but a reader skimming only the number (not the caveat) could be misled into thinking it is a stable figure.
  No fix required; noted for completeness since the review brief asked whether doc comments "state measurements
  accurately per the report" — they do, faithfully transcribing that run's numbers, with the caveat attached both
  places.

## Data flow

1. `it()` builds a fixture from a shared budget constant (`DASHBOARD_LIMITS.X` / `SURFACE_LIMITS.X`), never a
   smaller literal — OK, confirmed per case in the table below.
2. `runCase` validates the fixture with the real validator and the real `dashboardJsonBytes` byte counter, and
   asserts `ok === true` and `reason === undefined` BEFORE rendering — OK, so a render failure can never be
   misread as validator noise (`budget-render.spec.ts:172-175`).
3. `renderAndMeasure` creates a real `BudgetHostComponent` via `TestBed.createComponent`, sets the `renderable`
   signal, and calls `fixture.detectChanges()` — OK, exercises the real `SurfaceRendererComponent` and its child
   `SurfaceNodeComponent` tree, not a mock.
4. `SurfaceRendererComponent` runs the real default `SURFACE_VIEW_MODEL_BUILDER` (no override provided anywhere
   in this file) and emits `renderFailed` through a real Angular `effect()` and event binding
   (`surface-renderer.component.ts:264-267`, `budget-render.spec.ts:151`) — OK, not a declared-but-unobserved
   output; `BudgetHostComponent.failures` is read directly off the component instance after `detectChanges()`.
5. `runCase` logs one `console.info` line and asserts `failures === 0` — OK for "no renderFailed fired"; gap for
   "content genuinely rendered" beyond the structural shape check inside `attemptBuild` (Moderate-1).
6. `budget-render-report.md` and the two catalog doc comments transcribe the 13 outcomes — OK, cross-checked
   against the file and against a fresh run; no constant changed, matching the report's "Constants changed: None."

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Req 8 AC1: render one spec at each of the six v1 provisional limits, recording outcome + timing | COMPLETE | none |
| Req 8 AC1 (plan "extended"): render the six v2 limits (maxInputs, maxOptions x2, maxChildrenPerNode, maxGridColumns, maxDataModelBytes, maxSurfaceBytes) | COMPLETE | none |
| Req 8 AC2: doc comment says "confirmed" + names the test, or constant changes with measurement as reason | COMPLETE | none — both catalogs say CONFIRMED and name the exact spec file; no constant changed, which is consistent with "None was slow enough to justify lowering a value" |
| `nx run-many -t test -p @ptah-extension/shared` passes unchanged, incl. `surface-budgets.spec.ts`/`dashboard-budgets.spec.ts` | COMPLETE | confirmed via `git diff`/`git status` — neither file appears in the diff |
| Each fixture "first accepted by the real validator, then rendered with no renderFailed" | COMPLETE | order enforced in `runCase` (validate, then render) |
| A4 (jsdom timing is relative only) | COMPLETE | stated in the spec file header, the report, and both catalog doc comments |
| v2 fixtures added to `testing/index.ts` per plan (`makeSurfaceEnvelope`, `makeSurfaceComponents`, `makeSurfaceTextInput`, `makeSurfaceDataAtDepth`) | COMPLETE | exactly these four, no more/fewer; testing barrel stays test-only (not re-exported from `libs/shared/src/index.ts`, confirmed empty grep) |
| "Content rendered" (not merely `renderFailed` absent) | PARTIAL | see Moderate-1 — no DOM/component-count assertion |

Implicit requirements not addressed: none found beyond Moderate-1.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| v1 `maxComponents` = 200, tree-wide count (not just roots) | YES | `makeStatPairs(200)`: 100 roots each with 1 child = 200 nodes total | none — doc comment "counts every node in the tree" matches the fixture shape |
| v1 `maxSpecBytes` exactly at limit | YES | `makeDashboardSpecOfExactBytes`, asserted `=== target` before validating | none |
| v2 `maxOptions` on `select` vs `radio-group` sharing one constant | YES | both schema branches call the same `options()` helper with `SURFACE_LIMITS.maxOptions` (`surface.schemas.ts:305, 313`) — verified they are not two independently-drifting limits | none |
| v2 `maxSurfaceBytes` = structure + data model combined, both budgets satisfied simultaneously | YES | `surfaceAtMaxBytes()` builds data model at exactly `maxDataModelBytes`, then pads structure so the WHOLE envelope hits exactly `maxSurfaceBytes`; explicit byte assertion at `:361` | none |
| Byte-exact fixture whose padding would exceed `maxStringLength` | YES | `exactBytes` throws instead of building an invalid fixture (`:113-115`) | none |
| Builder returns a structurally valid but empty component list | NO | `attemptBuild` accepts `[]`; `runCase` has no count assertion | Moderate-1 |
| Console noise / lint violation from `console.info` | YES | no `no-console` rule in root or lib `eslint.config.mjs`; no fail-on-console guard in `test-setup.ts`; empirically one line per case, no stray `console.error`/`console.warn` | none |
| Testing barrel leaking into production bundle | YES | `libs/shared/src/index.ts` has zero test-related exports; all non-spec repo-wide importers of `@ptah-extension/shared/testing` are `jest.setup.ts` files, a testing helper, and a migration tool script, none of them shipped webview/extension bundle code | none |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the render assertion proves "the validator accepted it and no failure signal fired," not "N
  components/DOM nodes actually appeared" — a real but currently unexploited gap (Moderate-1).
- What a robust implementation would add: a component-count or DOM-count assertion per case (mirroring
  `surface-renderer.component.spec.ts`'s existing `querySelector`-based assertions), and, when a manual Electron
  run is eventually taken, a second timing column in the report/doc comments as already planned rather than a
  replacement of the jsdom figures.
