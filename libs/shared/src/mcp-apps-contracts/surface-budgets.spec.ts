/**
 * Surface v2 budgets through the boundary validator: a value EXACTLY at the
 * limit is accepted and one step above it is rejected. Numbers are read from
 * `SURFACE_LIMITS`, never retyped. Rejections by the structural walk or the
 * byte checks name the budget; rejections by the schema name the path.
 *
 * Write-log budgets are pinned in `surface-concurrency.spec.ts`.
 * `maxRpcRequestBytes` and `maxSubmitMessageBytes` are enforced by the RPC
 * handler and the submit formatter, which land in later batches.
 */
import {
  dashboardJsonBytes,
  makeDashboardSpec,
} from '../testing/fixtures/dashboard-spec';
import {
  makeSurfaceDataAtDepth,
  makeSurfaceTextInput,
} from '../testing/fixtures/surface';
import { validateDashboardSpec } from './dashboard-spec.validator';
import { SURFACE_LIMITS } from './surface-catalog';
import { applyDataModelOps } from './surface-data-model';
import type { SurfaceDataModelOp } from './surface-data-model';
import type {
  SurfaceComponent,
  SurfaceDataModel,
  SurfaceEnvelope,
} from './surface.types';
import {
  validateSurfaceDocument,
  validateSurfaceUpdateInput,
} from './surface.validator';

const L = SURFACE_LIMITS;
const documentOf = (doc: unknown) =>
  validateSurfaceDocument(doc, dashboardJsonBytes);
const update = (input: unknown) =>
  validateSurfaceUpdateInput(input, dashboardJsonBytes);
const create = (surface: SurfaceEnvelope) =>
  update({ operation: 'create', surface });
const patch = (ops: unknown[]) =>
  update({ operation: 'patch', surfaceId: 'profile', baseRevision: 1, ops });

function envelope(
  components: SurfaceComponent[],
  dataModel?: SurfaceDataModel,
  surfaceId = 'profile',
): SurfaceEnvelope {
  return {
    schemaVersion: 'dashboard-spec/2',
    catalogVersion: 'dashboard-catalog/2',
    surfaceId,
    title: { text: 'Budgets' },
    components,
    ...(dataModel === undefined ? {} : { dataModel }),
  };
}
const stat = (id: string, extra: Partial<SurfaceComponent> = {}) =>
  ({ kind: 'stat', id, value: 1, ...extra }) as SurfaceComponent;
const stats = (count: number, prefix = 's') =>
  Array.from({ length: count }, (_v, i) => stat(`${prefix}${i}`));
function chain(depth: number): SurfaceComponent {
  let node: SurfaceComponent = stat('leaf');
  for (let level = depth - 1; level >= 1; level--)
    node = { kind: 'stack', id: `d${level}`, children: [node] };
  return node;
}
const options = (count: number, valueLength = 3) =>
  Array.from({ length: count }, (_v, i) => ({
    value: `${i}`.padStart(valueLength, 'v'),
    label: `Option ${i}`,
  }));
const keys = (count: number) =>
  Object.fromEntries(Array.from({ length: count }, (_v, i) => [`k${i}`, i]));

/**
 * Build a value whose UTF-8 JSON is EXACTLY `target` bytes: `slots` strings
 * whose total length is the only variable, so bytes grow by one per character.
 */
function exactBytes<T>(
  target: number,
  slots: number,
  build: (strings: string[]) => T,
): T {
  const base = dashboardJsonBytes(
    build(Array.from({ length: slots }, () => '')),
  );
  const extra = target - base;
  const each = Math.floor(extra / slots);
  const strings = Array.from({ length: slots }, (_v, i) =>
    'x'.repeat(each + (i < extra % slots ? 1 : 0)),
  );
  if (extra < 0 || strings.some((s) => s.length > L.maxStringLength))
    throw new Error(`cannot build ${target} bytes with ${slots} slots`);
  const value = build(strings);
  expect(dashboardJsonBytes(value)).toBe(target);
  return value;
}

function expectAccepted(result: { ok: boolean; reason?: string }) {
  expect(result.reason).toBeUndefined();
  expect(result.ok).toBe(true);
}
function expectRejected(
  result: { ok: boolean; reason?: string },
  fragment: string,
) {
  expect(result.ok).toBe(false);
  expect(result.reason).toContain(fragment);
}

type Case = [
  budget: string,
  build: (atLimit: boolean) => ReturnType<typeof update>,
  fragment: string,
];

describe('surface budgets — at the limit passes, one above is rejected', () => {
  const cases: Case[] = [
    [
      'maxComponents (root list)',
      (at) =>
        create(envelope(stats(at ? L.maxComponents : L.maxComponents + 1))),
      'maxComponents',
    ],
    [
      'maxComponents (nested total)',
      (at) => {
        const perStack = L.maxComponents / 4 - 1; // 4 stacks + 196 children = 200
        const components: SurfaceComponent[] = Array.from(
          { length: 4 },
          (_v, i) => ({
            kind: 'stack',
            id: `stack${i}`,
            children: stats(perStack + (!at && i === 0 ? 1 : 0), `c${i}-`),
          }),
        );
        return create(envelope(components));
      },
      'maxComponents',
    ],
    [
      'maxTreeDepth',
      (at) =>
        create(envelope([chain(at ? L.maxTreeDepth : L.maxTreeDepth + 1)])),
      `over the maxTreeDepth limit of ${L.maxTreeDepth}`,
    ],
    [
      'maxChildrenPerNode',
      (at) =>
        create(
          envelope([
            {
              kind: 'stack',
              id: 'wide',
              children: stats(
                at ? L.maxChildrenPerNode : L.maxChildrenPerNode + 1,
              ),
            },
          ]),
        ),
      'maxChildrenPerNode',
    ],
    [
      'maxGridColumns',
      (at) =>
        create(
          envelope([
            {
              kind: 'grid',
              id: 'grid',
              columns: at ? L.maxGridColumns : L.maxGridColumns + 1,
              children: [],
            },
          ]),
        ),
      'components.0.columns',
    ],
    [
      'maxActionsPerComponent',
      (at) =>
        create(
          envelope([
            stat('s', {
              actions: Array.from(
                {
                  length: at
                    ? L.maxActionsPerComponent
                    : L.maxActionsPerComponent + 1,
                },
                (_v, i) => ({
                  id: `a${i}`,
                  action: 'dashboard.select' as const,
                  label: { text: 'Pick' },
                }),
              ),
            }),
          ]),
        ),
      'components.0.actions',
    ],
    [
      'maxInputs',
      (at) =>
        create(
          envelope(
            Array.from(
              { length: at ? L.maxInputs : L.maxInputs + 1 },
              (_v, i) => makeSurfaceTextInput({ id: `i${i}`, path: `f.i${i}` }),
            ),
          ),
        ),
      'maxInputs',
    ],
    [
      'maxOptions',
      (at) =>
        create(
          envelope([
            {
              kind: 'select',
              id: 'pick',
              label: 'Pick',
              path: 'pick',
              options: options(at ? L.maxOptions : L.maxOptions + 1),
            },
          ]),
        ),
      'components.0.options',
    ],
    [
      'maxOptionValueLength',
      (at) =>
        create(
          envelope([
            {
              kind: 'radio-group',
              id: 'pick',
              label: 'Pick',
              path: 'pick',
              options: options(
                2,
                at ? L.maxOptionValueLength : L.maxOptionValueLength + 1,
              ),
            },
          ]),
        ),
      'components.0.options.0.value',
    ],
    [
      'maxStringLength',
      (at) =>
        create({
          ...envelope(stats(1)),
          title: {
            text: 'x'.repeat(at ? L.maxStringLength : L.maxStringLength + 1),
          },
        }),
      'surface.title.text',
    ],
    [
      'maxSurfaceIdLength',
      (at) =>
        create(
          envelope(
            stats(1),
            undefined,
            's'.repeat(at ? L.maxSurfaceIdLength : L.maxSurfaceIdLength + 1),
          ),
        ),
      'surface.surfaceId',
    ],
    [
      'maxComponentIdLength',
      (at) =>
        create(
          envelope([
            stat(
              'c'.repeat(
                at ? L.maxComponentIdLength : L.maxComponentIdLength + 1,
              ),
            ),
          ]),
        ),
      'components.0.id',
    ],
    [
      // Path grammar on a request path; bindings are held to the tighter
      // maxDataModelDepth, pinned below.
      'maxPathSegments (request path grammar)',
      (at) =>
        patch([
          {
            op: 'remove-data',
            path: Array.from(
              { length: at ? L.maxPathSegments : L.maxPathSegments + 1 },
              () => 'p',
            ).join('.'),
          },
        ]),
      'maxPathSegments',
    ],
    [
      'input binding segments (maxDataModelDepth)',
      (at) =>
        create(
          envelope([
            makeSurfaceTextInput({
              path: Array.from(
                { length: at ? L.maxDataModelDepth : L.maxDataModelDepth + 1 },
                () => 'p',
              ).join('.'),
            }),
          ]),
        ),
      `within the maxDataModelDepth limit of ${L.maxDataModelDepth}`,
    ],
    [
      'maxPathSegmentLength',
      (at) =>
        create(
          envelope([
            makeSurfaceTextInput({
              path: `form.${'p'.repeat(at ? L.maxPathSegmentLength : L.maxPathSegmentLength + 1)}`,
            }),
          ]),
        ),
      'maxPathSegmentLength',
    ],
    [
      'maxDataModelDepth (model root counts as 1)',
      (at) =>
        create(
          envelope(stats(1), {
            a: makeSurfaceDataAtDepth(
              at ? L.maxDataModelDepth - 1 : L.maxDataModelDepth,
            ),
          }),
        ),
      `over the maxDataModelDepth limit of ${L.maxDataModelDepth}`,
    ],
    [
      'maxDataModelDepth (set-data value is its own root)',
      (at) =>
        patch([
          {
            op: 'set-data',
            path: 'a',
            value: makeSurfaceDataAtDepth(
              at ? L.maxDataModelDepth : L.maxDataModelDepth + 1,
            ),
          },
        ]),
      'maxDataModelDepth',
    ],
    [
      'maxDataModelArrayLength',
      (at) =>
        create(
          envelope(stats(1), {
            list: Array.from(
              {
                length: at
                  ? L.maxDataModelArrayLength
                  : L.maxDataModelArrayLength + 1,
              },
              (_v, i) => i,
            ),
          }),
        ),
      'maxDataModelArrayLength',
    ],
    [
      'maxDataModelObjectKeys',
      (at) =>
        create(
          envelope(stats(1), {
            wide: keys(
              at ? L.maxDataModelObjectKeys : L.maxDataModelObjectKeys + 1,
            ),
          }),
        ),
      'maxDataModelObjectKeys',
    ],
    [
      'maxTableRows',
      (at) =>
        create(
          envelope([
            {
              kind: 'table',
              id: 't',
              columns: [{ key: 'a', label: { text: 'A' } }],
              rows: Array.from(
                { length: at ? L.maxTableRows : L.maxTableRows + 1 },
                () => [1],
              ),
            },
          ]),
        ),
      'components.0.rows',
    ],
    [
      'maxTableColumns',
      (at) => {
        const width = at ? L.maxTableColumns : L.maxTableColumns + 1;
        return create(
          envelope([
            {
              kind: 'table',
              id: 't',
              columns: Array.from({ length: width }, (_v, i) => ({
                key: `c${i}`,
                label: { text: `C${i}` },
              })),
              rows: [Array.from({ length: width }, () => 1)],
            },
          ]),
        );
      },
      'components.0.columns',
    ],
    [
      'maxSeriesPoints (summed across series)',
      (at) => {
        const half = L.maxSeriesPoints / 2;
        const points = (count: number) =>
          Array.from({ length: count }, (_v, i) => ({ x: i, y: i }));
        return create(
          envelope([
            {
              kind: 'bar-chart',
              id: 'chart',
              series: [
                { name: 'a', points: points(half) },
                { name: 'b', points: points(at ? half : half + 1) },
              ],
            },
          ]),
        );
      },
      'components.0',
    ],
    [
      'maxPatchOps',
      (at) =>
        patch(
          Array.from(
            { length: at ? L.maxPatchOps : L.maxPatchOps + 1 },
            (_v, i) => ({
              op: 'set-data',
              path: `p${i}`,
              value: i,
            }),
          ),
        ),
      `over the maxPatchOps limit of ${L.maxPatchOps}`,
    ],
  ];

  it.each(cases)('%s', (_budget, build, fragment) => {
    expectAccepted(build(true));
    expectRejected(build(false), fragment);
  });
});

describe('surface byte budgets name the budget (Req 4.3)', () => {
  const modelOfBytes = (target: number) =>
    exactBytes(target, 40, (strings) => ({ blob: strings }));

  it('data model: exactly maxDataModelBytes passes, one byte more is rejected', () => {
    const at = envelope(stats(1), modelOfBytes(L.maxDataModelBytes));
    expectAccepted(documentOf(at));
    expectAccepted(create(at));
    const over = envelope(stats(1), modelOfBytes(L.maxDataModelBytes + 1));
    expectRejected(
      documentOf(over),
      `over the maxDataModelBytes limit of ${L.maxDataModelBytes}`,
    );
    expectRejected(create(over), 'maxDataModelBytes');
  });

  it('structure plus data model: exactly maxSurfaceBytes passes, one byte more is rejected', () => {
    const model = modelOfBytes(L.maxDataModelBytes);
    const surfaceOfBytes = (target: number) =>
      exactBytes(target, 150, (titles) =>
        envelope(
          titles.map((text, i) => stat(`s${i}`, { title: { text } })),
          model,
        ),
      );
    const at = surfaceOfBytes(L.maxSurfaceBytes);
    expectAccepted(documentOf(at));
    expectAccepted(create(at));
    const over = surfaceOfBytes(L.maxSurfaceBytes + 1);
    const result = documentOf(over);
    expectRejected(
      result,
      `over the maxSurfaceBytes limit of ${L.maxSurfaceBytes}`,
    );
    expect(result).toMatchObject({ bytes: L.maxSurfaceBytes + 1 });
    expectRejected(create(over), 'maxSurfaceBytes');
  });

  it('request: exactly maxUpdateRequestBytes passes, one byte more is rejected', () => {
    const requestOfBytes = (target: number) =>
      exactBytes(target, 200, (strings) => ({
        operation: 'patch',
        surfaceId: 'profile',
        baseRevision: 1,
        ops: Array.from({ length: 100 }, (_v, i) => ({
          op: 'set-data',
          path: `p${i}`,
          value: [strings[2 * i], strings[2 * i + 1]],
        })),
      }));
    expectAccepted(update(requestOfBytes(L.maxUpdateRequestBytes)));
    const result = update(requestOfBytes(L.maxUpdateRequestBytes + 1));
    expectRejected(
      result,
      `over the maxUpdateRequestBytes limit of ${L.maxUpdateRequestBytes}`,
    );
    expect(result).toMatchObject({ bytes: L.maxUpdateRequestBytes + 1 });
  });
});

describe('a large patch that cancels out is still rejected (Req 4.3)', () => {
  it('on request bytes, although applying it would leave an empty model', () => {
    const big = Array.from({ length: 150 }, () =>
      'x'.repeat(L.maxStringLength),
    );
    const ops: SurfaceDataModelOp[] = [];
    for (let round = 0; round < 2; round++)
      ops.push(
        { op: 'set-data', path: 'blob', value: big },
        { op: 'remove-data', path: 'blob' },
      );
    expect(applyDataModelOps({}, ops)).toEqual({ ok: true, next: {} });
    expectRejected(patch(ops), 'maxUpdateRequestBytes');
  });

  it('on op count, although the ops are tiny and cancel pairwise', () => {
    const ops = Array.from({ length: L.maxPatchOps + 1 }, (_v, i) =>
      i % 2 === 0
        ? { op: 'set-data', path: 'x', value: 1 }
        : { op: 'remove-data', path: 'x' },
    );
    expectRejected(
      patch(ops),
      `over the maxPatchOps limit of ${L.maxPatchOps}`,
    );
  });
});

describe('the complete state read fits maxStateReadBytes', () => {
  it('sums the constituent budgets at or under the read budget', () => {
    const formValueEntry = 1024; // ids and issues per input entry
    const selectionDescription = 8 * 1024;
    const fixedMetadata = 4 * 1024;
    const worstCase =
      L.maxDataModelBytes + // data model
      L.maxDataModelBytes + // form values: unique paths, bounded by the model
      L.maxInputs * formValueEntry +
      selectionDescription +
      L.maxSubmitMessageBytes + // last submit
      fixedMetadata;
    expect(worstCase).toBeLessThanOrEqual(L.maxStateReadBytes);
  });
});

describe('a v1-catalog envelope carrying a v2-only kind is rejected (Req 1.4)', () => {
  const select: SurfaceComponent = {
    kind: 'select',
    id: 'size',
    label: 'Size',
    path: 'form.size',
    options: [{ value: 'a', label: 'A' }],
  };

  it('by the v1 validator', () => {
    const result = validateDashboardSpec(
      { ...makeDashboardSpec(), components: [select] },
      dashboardJsonBytes,
    );
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain('components.0');
  });

  it('by the v2 validator, naming the version field', () => {
    const v1Catalog = {
      ...envelope([select]),
      schemaVersion: 'dashboard-spec/1',
      catalogVersion: 'dashboard-catalog/1',
    };
    expectRejected(
      update({ operation: 'create', surface: v1Catalog }),
      'surface.schemaVersion',
    );
    expectRejected(documentOf(v1Catalog), 'schemaVersion');
    const mixed = {
      ...envelope([select]),
      catalogVersion: 'dashboard-catalog/1',
    };
    expectRejected(
      update({ operation: 'create', surface: mixed }),
      'surface.catalogVersion',
    );
  });
});
