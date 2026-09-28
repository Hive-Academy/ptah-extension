/**
 * Budget confirmation render test — TASK_2026_494 Req 8 (implementation-plan.md
 * "Budget confirmation", 841-870).
 *
 * TASK_2026_493 shipped seven provisional budgets (`DASHBOARD_LIMITS`,
 * `SURFACE_LIMITS`) with no renderer to confirm them against. This spec is
 * that renderer. Every case:
 *
 * 1. Builds a document AT, not over, one provisional limit.
 * 2. Confirms the validator accepts it (`validateDashboardSpec` for v1,
 *    `validateSurfaceDocument` for v2) — the fixture must be a legal document,
 *    not merely something the renderer happens to survive.
 * 3. Renders it through the REAL `SurfaceRendererComponent` (no view-model
 *    builder override) and asserts no `renderFailed`.
 * 4. Logs one `console.info` line with the jsdom `performance.now()` delta.
 *
 * `renderFailed` alone is not proof that the content rendered: a builder that
 * regressed to `{ renderFailed: false, viewModel: { components: [] } }` for a
 * large input would still pass step 3 (`code-logic-review-batch-9.md`,
 * Moderate-1 — `attemptBuild` treats an empty array as structurally valid).
 * The count-based cases below (`maxComponents`, `maxInputs`, `maxOptions`,
 * `maxChildrenPerNode`, `maxGridColumns`, `maxTableRows`, `maxTableColumns`)
 * therefore also assert the expected number of rendered controls, children,
 * options or rows through the DOM — the same `data-apps-focus-key` /
 * `querySelectorAll` pattern `surface-renderer.component.spec.ts:87-100`
 * already uses — so a silent "rendered nothing" regression fails here, not
 * just a "rendered something malformed" one.
 *
 * A4 (batches.md "Plan validation"): jsdom has no layout, paint or GPU cost,
 * so every `jsdomMs` figure here is a RELATIVE signal between the cases in
 * THIS file only — evidence that no case is pathologically slower than its
 * neighbours, not a prediction of Electron wall-clock time. The measured
 * numbers are copied into `budget-render-report.md`, which states this
 * caveat again next to the table.
 *
 * A budget that fails to render is lowered in its ONE constant
 * (`dashboard-catalog.ts` / `surface-catalog.ts`), with the measurement from
 * this file as the stated reason; the renderer is never special-cased for a
 * failing budget (Req 8 acceptance criterion 2).
 */
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  DASHBOARD_LIMITS,
  validateDashboardSpec,
  type DashboardSpecEnvelope,
} from '@ptah-extension/shared/mcp-apps-contracts';
import {
  SURFACE_LIMITS,
  validateSurfaceDocument,
  type SurfaceComponent,
  type SurfaceEnvelope,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import {
  dashboardJsonBytes,
  makeChart,
  makeDashboardSpec,
  makeDashboardSpecOfExactBytes,
  makeNestedStats,
  makeStatPairs,
  makeSurfaceTextInput,
  makeTable,
} from '@ptah-extension/shared/testing';
import { SURFACE_PAGE_SIZE, type SurfaceRenderable } from './surface-view-state';
import { SurfaceRendererComponent } from './components/surface-renderer.component';

/**
 * Generous relative to the jest default (5,000 ms): a jsdom render of a
 * 1,000-row table or a 256 KiB document is slower than a unit test, and this
 * file measures that cost on purpose (A4) rather than optimizing it away.
 */
const TEST_TIMEOUT_MS = 30_000;

type ValidationOutcome = { readonly ok: boolean; readonly reason?: string };

const L = SURFACE_LIMITS;

// ---------------------------------------------------------------------------
// v2 fixture builders. `makeSurfaceEnvelope` / `makeSurfaceComponents` in
// `@ptah-extension/shared/testing` build ONE of each kind, not a document at a
// numeric limit, so the byte-exact and count-exact cases need their own
// builders here — the same reason `surface-budgets.spec.ts` keeps its `stat`,
// `stats`, `options` and `exactBytes` helpers local rather than exported.
// ---------------------------------------------------------------------------

function envelope(
  components: SurfaceComponent[],
  dataModel?: SurfaceEnvelope['dataModel'],
  surfaceId = 'budget',
): SurfaceEnvelope {
  return {
    schemaVersion: 'dashboard-spec/2',
    catalogVersion: 'dashboard-catalog/2',
    surfaceId,
    title: { text: 'Budget case' },
    components,
    ...(dataModel === undefined ? {} : { dataModel }),
  };
}

const stat = (id: string, extra: Partial<SurfaceComponent> = {}): SurfaceComponent =>
  ({ kind: 'stat', id, value: 1, ...extra }) as SurfaceComponent;
const stats = (count: number, prefix = 's'): SurfaceComponent[] =>
  Array.from({ length: count }, (_v, i) => stat(`${prefix}${i}`));
const options = (count: number) =>
  Array.from({ length: count }, (_v, i) => ({ value: `v${i}`, label: `Option ${i}` }));

/**
 * Build a value whose UTF-8 JSON is EXACTLY `target` bytes, the same
 * measure-then-pad technique as `surface-budgets.spec.ts` and
 * `makeDashboardSpecOfExactBytes`: `slots` strings carry the whole variable
 * part, so bytes grow by exactly one per padding character.
 */
function exactBytes<T>(
  target: number,
  slots: number,
  build: (strings: string[]) => T,
): T {
  const base = dashboardJsonBytes(build(Array.from({ length: slots }, () => '')));
  const extra = target - base;
  const each = Math.floor(extra / slots);
  const strings = Array.from({ length: slots }, (_v, i) =>
    'x'.repeat(each + (i < extra % slots ? 1 : 0)),
  );
  if (extra < 0 || strings.some((s) => s.length > L.maxStringLength)) {
    throw new Error(`cannot build ${target} bytes with ${slots} slots`);
  }
  const value = build(strings);
  expect(dashboardJsonBytes(value)).toBe(target);
  return value;
}

const modelOfBytes = (target: number) =>
  exactBytes(target, 40, (strings) => ({ blob: strings }));

/** Structure plus data model together, exactly `maxSurfaceBytes`. */
function surfaceAtMaxBytes(): SurfaceEnvelope {
  const model = modelOfBytes(L.maxDataModelBytes);
  return exactBytes(L.maxSurfaceBytes, 150, (titles) =>
    envelope(
      titles.map((text, i) => stat(`s${i}`, { title: { text } })),
      model,
    ),
  );
}

// ---------------------------------------------------------------------------
// Renderable adapters and the render harness.
// ---------------------------------------------------------------------------

function v1Renderable(spec: DashboardSpecEnvelope): SurfaceRenderable {
  return { contract: 'dashboard-spec/1', spec };
}

function v2Renderable(surface: SurfaceEnvelope): SurfaceRenderable {
  const { dataModel, ...rest } = surface;
  return { contract: 'dashboard-spec/2', surface: rest, dataModel: dataModel ?? {} };
}

@Component({
  standalone: true,
  imports: [SurfaceRendererComponent],
  template: `<ptah-surface-renderer [renderable]="renderable()" (renderFailed)="failures = failures + 1" />`,
})
class BudgetHostComponent {
  public readonly renderable = signal<SurfaceRenderable>(v1Renderable(makeDashboardSpec()));
  public failures = 0;
}

function renderAndMeasure(
  renderable: SurfaceRenderable,
): { readonly failures: number; readonly ms: number; readonly element: HTMLElement } {
  const fixture: ComponentFixture<BudgetHostComponent> = TestBed.createComponent(BudgetHostComponent);
  fixture.componentInstance.renderable.set(renderable);
  const start = performance.now();
  fixture.detectChanges();
  const ms = performance.now() - start;
  return { failures: fixture.componentInstance.failures, ms, element: fixture.nativeElement };
}

/**
 * Validate-then-render one case. Asserts acceptance (the fixture is AT, not
 * over, its limit) before asserting the render, so a failure here can never
 * be misread as the renderer failing on an already-invalid document. The
 * optional `assertRendered` runs AFTER `failures === 0` is confirmed, so a
 * count mismatch is never masked by (or mistaken for) a `renderFailed`.
 */
function runCase(
  label: string,
  validate: () => ValidationOutcome,
  renderable: () => SurfaceRenderable,
  assertRendered?: (element: HTMLElement) => void,
): void {
  const validation = validate();
  expect(validation.reason).toBeUndefined();
  expect(validation.ok).toBe(true);

  const { failures, ms, element } = renderAndMeasure(renderable());
  // A4: relative signal only, recorded here for budget-render-report.md.
  console.info(
    `[budget-render] ${label}: accepted=${validation.ok} renderFailed=${failures > 0} jsdomMs=${ms.toFixed(2)}`,
  );
  expect(failures).toBe(0);
  assertRendered?.(element);
}

describe('budget confirmation — v1 provisional limits render without renderFailed (Req 8.1)', () => {
  it(
    `maxComponents = ${DASHBOARD_LIMITS.maxComponents}`,
    () => {
      const spec = makeDashboardSpec({ components: makeStatPairs(DASHBOARD_LIMITS.maxComponents) });
      runCase(
        `v1 maxComponents=${DASHBOARD_LIMITS.maxComponents}`,
        () => validateDashboardSpec(spec, dashboardJsonBytes),
        () => v1Renderable(spec),
        // Every one of the 200 tree-wide nodes is its own `DashboardStatComponent`
        // with a distinct-id expand button; a builder that silently dropped nodes
        // would still pass `renderFailed === false` but fail this count.
        (element) =>
          expect(element.querySelectorAll('[data-apps-focus-key$=":expand"]')).toHaveLength(
            DASHBOARD_LIMITS.maxComponents,
          ),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `maxTreeDepth = ${DASHBOARD_LIMITS.maxTreeDepth}`,
    () => {
      const spec = makeDashboardSpec({ components: makeNestedStats(DASHBOARD_LIMITS.maxTreeDepth) });
      runCase(
        `v1 maxTreeDepth=${DASHBOARD_LIMITS.maxTreeDepth}`,
        () => validateDashboardSpec(spec, dashboardJsonBytes),
        () => v1Renderable(spec),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `maxTableRows = ${DASHBOARD_LIMITS.maxTableRows}`,
    () => {
      const spec = makeDashboardSpec({ components: [makeTable(DASHBOARD_LIMITS.maxTableRows, 2)] });
      const pageCount = Math.ceil(DASHBOARD_LIMITS.maxTableRows / SURFACE_PAGE_SIZE);
      runCase(
        `v1 maxTableRows=${DASHBOARD_LIMITS.maxTableRows}`,
        () => validateDashboardSpec(spec, dashboardJsonBytes),
        () => v1Renderable(spec),
        // The table paginates (`SURFACE_PAGE_SIZE`), so the DOM only ever holds
        // one page of <tr> at a time. The first-page row count and the pager's
        // own "N results" / "Page X of Y" text together prove all 1,000 rows
        // reached the table, not just the 25 rendered right now.
        (element) => {
          expect(element.querySelectorAll('tbody tr')).toHaveLength(SURFACE_PAGE_SIZE);
          expect(element.querySelector('p[role="status"]')?.textContent).toContain(
            `${DASHBOARD_LIMITS.maxTableRows} results`,
          );
          expect(element.querySelector('span[role="status"]')?.textContent).toBe(
            `Page 1 of ${pageCount}`,
          );
        },
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `maxTableColumns = ${DASHBOARD_LIMITS.maxTableColumns}`,
    () => {
      const spec = makeDashboardSpec({ components: [makeTable(1, DASHBOARD_LIMITS.maxTableColumns)] });
      runCase(
        `v1 maxTableColumns=${DASHBOARD_LIMITS.maxTableColumns}`,
        () => validateDashboardSpec(spec, dashboardJsonBytes),
        () => v1Renderable(spec),
        (element) => {
          expect(element.querySelectorAll('thead th')).toHaveLength(DASHBOARD_LIMITS.maxTableColumns);
          expect(element.querySelectorAll('tbody tr')).toHaveLength(1);
          expect(element.querySelectorAll('tbody td')).toHaveLength(DASHBOARD_LIMITS.maxTableColumns);
        },
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `maxSeriesPoints = ${DASHBOARD_LIMITS.maxSeriesPoints}`,
    () => {
      const half = DASHBOARD_LIMITS.maxSeriesPoints / 2;
      const spec = makeDashboardSpec({ components: [makeChart([half, half])] });
      runCase(
        `v1 maxSeriesPoints=${DASHBOARD_LIMITS.maxSeriesPoints}`,
        () => validateDashboardSpec(spec, dashboardJsonBytes),
        () => v1Renderable(spec),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `maxSpecBytes = ${DASHBOARD_LIMITS.maxSpecBytes}`,
    () => {
      const spec = makeDashboardSpecOfExactBytes(DASHBOARD_LIMITS.maxSpecBytes);
      expect(dashboardJsonBytes(spec)).toBe(DASHBOARD_LIMITS.maxSpecBytes);
      runCase(
        `v1 maxSpecBytes=${DASHBOARD_LIMITS.maxSpecBytes}`,
        () => validateDashboardSpec(spec, dashboardJsonBytes),
        () => v1Renderable(spec),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('budget confirmation — v2 provisional limits render without renderFailed (Req 8.1)', () => {
  it(
    `maxInputs = ${L.maxInputs}`,
    () => {
      const components = Array.from({ length: L.maxInputs }, (_v, i) =>
        makeSurfaceTextInput({ id: `i${i}`, path: `f.i${i}` }),
      );
      const surface = envelope(components);
      runCase(
        `v2 maxInputs=${L.maxInputs}`,
        () => validateSurfaceDocument(surface, dashboardJsonBytes),
        () => v2Renderable(surface),
        (element) => expect(element.querySelectorAll('input[type="text"]')).toHaveLength(L.maxInputs),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `maxOptions = ${L.maxOptions} on a select`,
    () => {
      const surface = envelope([
        { kind: 'select', id: 'pick', label: 'Pick', path: 'pick', options: options(L.maxOptions) },
      ]);
      runCase(
        `v2 maxOptions(select)=${L.maxOptions}`,
        () => validateSurfaceDocument(surface, dashboardJsonBytes),
        () => v2Renderable(surface),
        // The empty "—" placeholder option is a fixed extra, not one of the budget.
        (element) =>
          expect(element.querySelectorAll('select option')).toHaveLength(L.maxOptions + 1),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `maxOptions = ${L.maxOptions} on a radio-group`,
    () => {
      const surface = envelope([
        { kind: 'radio-group', id: 'pick', label: 'Pick', path: 'pick', options: options(L.maxOptions) },
      ]);
      runCase(
        `v2 maxOptions(radio-group)=${L.maxOptions}`,
        () => validateSurfaceDocument(surface, dashboardJsonBytes),
        () => v2Renderable(surface),
        (element) => expect(element.querySelectorAll('input[type="radio"]')).toHaveLength(L.maxOptions),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `maxChildrenPerNode = ${L.maxChildrenPerNode}`,
    () => {
      const surface = envelope([
        { kind: 'stack', id: 'wide', children: stats(L.maxChildrenPerNode) },
      ]);
      runCase(
        `v2 maxChildrenPerNode=${L.maxChildrenPerNode}`,
        () => validateSurfaceDocument(surface, dashboardJsonBytes),
        () => v2Renderable(surface),
        (element) =>
          expect(element.querySelectorAll('[data-apps-focus-key$=":expand"]')).toHaveLength(
            L.maxChildrenPerNode,
          ),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `maxGridColumns = ${L.maxGridColumns}`,
    () => {
      const surface = envelope([
        { kind: 'grid', id: 'grid', columns: L.maxGridColumns, children: stats(L.maxGridColumns) },
      ]);
      runCase(
        `v2 maxGridColumns=${L.maxGridColumns}`,
        () => validateSurfaceDocument(surface, dashboardJsonBytes),
        () => v2Renderable(surface),
        (element) =>
          expect(element.querySelectorAll('[data-apps-focus-key$=":expand"]')).toHaveLength(
            L.maxGridColumns,
          ),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `maxDataModelBytes = ${L.maxDataModelBytes}`,
    () => {
      const surface = envelope(stats(1), modelOfBytes(L.maxDataModelBytes));
      runCase(
        `v2 maxDataModelBytes=${L.maxDataModelBytes}`,
        () => validateSurfaceDocument(surface, dashboardJsonBytes),
        () => v2Renderable(surface),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `maxSurfaceBytes = ${L.maxSurfaceBytes}`,
    () => {
      const surface = surfaceAtMaxBytes();
      expect(dashboardJsonBytes(surface)).toBe(L.maxSurfaceBytes);
      runCase(
        `v2 maxSurfaceBytes=${L.maxSurfaceBytes}`,
        () => validateSurfaceDocument(surface, dashboardJsonBytes),
        () => v2Renderable(surface),
      );
    },
    TEST_TIMEOUT_MS,
  );
});
