import { dashboardJsonBytes } from '../testing/fixtures/dashboard-spec';
import {
  makeSurfaceComponents,
  makeSurfaceEnvelope,
  makeSurfaceTextInput,
} from '../testing/fixtures/surface';
import { SURFACE_LIMITS } from './surface-catalog';
import {
  SurfaceEnvelopeSchema,
  SurfaceUpdateInputSchema,
} from './surface.schemas';
import { applyDataModelOps } from './surface-data-model';
import type { SurfaceComponent, SurfaceEnvelope } from './surface.types';
import {
  SURFACE_MAX_RAW_JSON_DEPTH,
  formatSurfaceIssues,
  validateSurfaceDocument,
  validateSurfaceEnvelopeVersions,
  validateSurfaceUpdateInput,
} from './surface.validator';
import { formatDashboardSpecIssues } from './dashboard-spec.validator';

const update = (input: unknown) =>
  validateSurfaceUpdateInput(input, dashboardJsonBytes);
const documentOf = (doc: unknown) =>
  validateSurfaceDocument(doc, dashboardJsonBytes);
const withComponents = (components: SurfaceComponent[]): SurfaceEnvelope =>
  makeSurfaceEnvelope({ components });

/** Built iteratively: `levels` nested `{ children: [...] }` nodes. */
function deepComponent(levels: number): Record<string, unknown> {
  const root: Record<string, unknown> = {
    kind: 'stack',
    id: 'n0',
    children: [],
  };
  let node = root;
  for (let level = 1; level < levels; level++) {
    const child: Record<string, unknown> = { children: [] };
    (node['children'] as unknown[]).push(child);
    node = child;
  }
  return root;
}
function deepData(levels: number): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let node = root;
  for (let level = 1; level < levels; level++) {
    const child: Record<string, unknown> = {};
    node['a'] = child;
    node = child;
  }
  return root;
}

function expectRejected(result: { ok: boolean }, ...fragments: string[]) {
  expect(result.ok).toBe(false);
  const reason = (result as { reason?: string }).reason ?? '';
  for (const fragment of fragments) expect(reason).toContain(fragment);
}

describe('surface validator — accepted input', () => {
  it('accepts every update operation and returns the parsed input and its bytes', () => {
    const surface = withComponents(makeSurfaceComponents());
    for (const input of [
      { operation: 'create', surface },
      { operation: 'replace', baseRevision: 3, surface },
      {
        operation: 'patch',
        surfaceId: 'profile',
        baseRevision: 3,
        ops: [{ op: 'set-data', path: 'form.name', value: 'Grace' }],
      },
      { operation: 'delete', surfaceId: 'profile', baseRevision: 3 },
    ]) {
      const result = update(input);
      expect(result).toEqual({
        ok: true,
        input,
        bytes: dashboardJsonBytes(input),
      });
    }
  });

  it('accepts a populated document and reports both byte measurements', () => {
    const surface = withComponents(makeSurfaceComponents());
    const result = documentOf(surface);
    expect(result).toEqual({
      ok: true,
      surface,
      bytes: dashboardJsonBytes(surface),
      dataModelBytes: dashboardJsonBytes(surface.dataModel),
    });
  });

  it('re-uses the v1 issue formatter', () => {
    expect(formatSurfaceIssues).toBe(formatDashboardSpecIssues);
  });
});

describe('surface validator — check order (Batch 1 review item 1)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('rejects oversized bytes before the parse, naming the budget', () => {
    const parse = jest.spyOn(SurfaceUpdateInputSchema, 'safeParse');
    const input = {
      operation: 'nonsense',
      junk: 'x'.repeat(SURFACE_LIMITS.maxUpdateRequestBytes),
    };
    expectRejected(update(input), 'maxUpdateRequestBytes');
    expect(parse).not.toHaveBeenCalled();
  });

  it('counts raw ops before parsing them', () => {
    const parse = jest.spyOn(SurfaceUpdateInputSchema, 'safeParse');
    const input = {
      operation: 'patch',
      ops: Array.from({ length: SURFACE_LIMITS.maxPatchOps + 1 }, () => 7),
    };
    expectRejected(update(input), 'maxPatchOps');
    expect(parse).not.toHaveBeenCalled();
  });

  const deep = deepComponent(10_000);
  it.each<[string, unknown]>([
    [
      'create',
      { operation: 'create', surface: withComponents([deep as never]) },
    ],
    [
      'replace',
      {
        operation: 'replace',
        baseRevision: 1,
        surface: withComponents([deep as never]),
      },
    ],
    [
      'patch add-component',
      {
        operation: 'patch',
        surfaceId: 'profile',
        baseRevision: 1,
        ops: [{ op: 'add-component', parentId: null, component: deep }],
      },
    ],
    [
      'patch replace-component',
      {
        operation: 'patch',
        surfaceId: 'profile',
        baseRevision: 1,
        ops: [{ op: 'replace-component', component: deep }],
      },
    ],
  ])(
    'walks a 10,000-level component tree before any parse (%s): a clean rejection naming maxTreeDepth',
    (_label, input) => {
      const updateParse = jest.spyOn(SurfaceUpdateInputSchema, 'safeParse');
      const envelopeParse = jest.spyOn(SurfaceEnvelopeSchema, 'safeParse');
      let result: ReturnType<typeof update> | undefined;
      expect(() => {
        result = update(input);
      }).not.toThrow();
      expect(result).toMatchObject({ ok: false });
      expectRejected(
        result ?? { ok: true },
        `over the maxTreeDepth limit of ${SURFACE_LIMITS.maxTreeDepth}`,
      );
      expect(updateParse).not.toHaveBeenCalled();
      expect(envelopeParse).not.toHaveBeenCalled();
    },
  );

  it('walks a 10,000-level document before the envelope parse', () => {
    const parse = jest.spyOn(SurfaceEnvelopeSchema, 'safeParse');
    const result = documentOf(withComponents([deep as never]));
    expectRejected(result, 'components.0', 'maxTreeDepth');
    expect(parse).not.toHaveBeenCalled();
  });

  it.each<[string, unknown]>([
    [
      'a create data model',
      {
        operation: 'create',
        surface: makeSurfaceEnvelope({ dataModel: deepData(10_000) as never }),
      },
    ],
    [
      'a set-data value',
      {
        operation: 'patch',
        surfaceId: 'profile',
        baseRevision: 1,
        ops: [{ op: 'set-data', path: 'a', value: deepData(10_000) }],
      },
    ],
  ])('walks 10,000-level data nesting in %s before parsing', (_l, input) => {
    const parse = jest.spyOn(SurfaceUpdateInputSchema, 'safeParse');
    expectRejected(update(input), 'maxDataModelDepth');
    expect(parse).not.toHaveBeenCalled();
  });

  it('bounds total components across all ops of one request', () => {
    const half = () => ({
      kind: 'stack',
      id: 'x',
      children: Array.from(
        { length: SURFACE_LIMITS.maxChildrenPerNode },
        (_v, i) => ({
          kind: 'stat',
          id: `s${i}`,
          value: 1,
        }),
      ),
    });
    const ops = Array.from({ length: 4 }, () => ({
      op: 'add-component',
      parentId: null,
      component: half(),
    }));
    expectRejected(
      update({
        operation: 'patch',
        surfaceId: 'profile',
        baseRevision: 1,
        ops,
      }),
      'maxComponents',
    );
  });
});

describe('surface validator — versions (Req 1.3, 1.4)', () => {
  it.each<[string, unknown, object]>([
    [
      'v2',
      {
        schemaVersion: 'dashboard-spec/2',
        catalogVersion: 'dashboard-catalog/2',
      },
      { ok: true, contract: 'dashboard-spec/2' },
    ],
    [
      'v1',
      {
        schemaVersion: 'dashboard-spec/1',
        catalogVersion: 'dashboard-catalog/1',
      },
      { ok: true, contract: 'dashboard-spec/1' },
    ],
    [
      'unknown schema',
      {
        schemaVersion: 'dashboard-spec/9',
        catalogVersion: 'dashboard-catalog/2',
      },
      { ok: false, field: 'schemaVersion' },
    ],
    [
      'missing schema',
      { catalogVersion: 'dashboard-catalog/2' },
      { ok: false, field: 'schemaVersion' },
    ],
    [
      'unknown catalog',
      {
        schemaVersion: 'dashboard-spec/2',
        catalogVersion: 'dashboard-catalog/9',
      },
      { ok: false, field: 'catalogVersion' },
    ],
    [
      'v2 schema with v1 catalog',
      {
        schemaVersion: 'dashboard-spec/2',
        catalogVersion: 'dashboard-catalog/1',
      },
      { ok: false, field: 'catalogVersion' },
    ],
    [
      'v1 schema with v2 catalog',
      {
        schemaVersion: 'dashboard-spec/1',
        catalogVersion: 'dashboard-catalog/2',
      },
      { ok: false, field: 'catalogVersion' },
    ],
    ['a non-object', 'dashboard-spec/2', { ok: false, field: 'schemaVersion' }],
  ])('%s', (_label, input, expected) => {
    const result = validateSurfaceEnvelopeVersions(input);
    expect(result).toMatchObject(expected);
    if (!result.ok) expect(result.reason).toContain(result.field);
  });

  it('names the version field when the v2 tool receives a v1 or mixed envelope', () => {
    const v1 = {
      ...makeSurfaceEnvelope(),
      schemaVersion: 'dashboard-spec/1',
      catalogVersion: 'dashboard-catalog/1',
    };
    expectRejected(
      update({ operation: 'create', surface: v1 }),
      'surface.schemaVersion',
      'ptah_dashboard_propose_spec',
    );
    expectRejected(
      update({
        operation: 'create',
        surface: {
          ...makeSurfaceEnvelope(),
          catalogVersion: 'dashboard-catalog/1',
        },
      }),
      'surface.catalogVersion',
    );
    expectRejected(
      documentOf({
        ...makeSurfaceEnvelope(),
        schemaVersion: 'dashboard-spec/7',
      }),
      'schemaVersion',
    );
  });

  it('refuses a v1 surface id in a v2 patch with the managing tool named', () => {
    expectRejected(
      update({
        operation: 'delete',
        surfaceId: 'v1:build-health',
        baseRevision: 1,
      }),
      'ptah_dashboard_propose_spec',
    );
  });
});

describe('surface validator — non-finite numbers (Batch 1 review item 2)', () => {
  const nonFinite = [Infinity, -Infinity, NaN];
  const stat = (field: 'value' | 'delta', value: number): SurfaceComponent =>
    field === 'value'
      ? { kind: 'stat', id: 'stat', value }
      : { kind: 'stat', id: 'stat', value: 1, delta: value };
  const chart = (axis: 'x' | 'y', value: number): SurfaceComponent => ({
    kind: 'line-chart',
    id: 'chart',
    series: [
      {
        name: 's',
        points: [axis === 'x' ? { x: value, y: 1 } : { x: 1, y: value }],
      },
    ],
  });

  it.each(nonFinite)('rejects %p in stat value and delta', (value) => {
    for (const field of ['value', 'delta'] as const) {
      expectRejected(
        update({
          operation: 'create',
          surface: withComponents([stat(field, value)]),
        }),
        `surface.components.0.${field}`,
      );
      expectRejected(
        documentOf(withComponents([stat(field, value)])),
        `components.0.${field}`,
      );
    }
  });

  it.each(nonFinite)('rejects %p in chart series x and y', (value) => {
    for (const axis of ['x', 'y'] as const) {
      expectRejected(
        update({
          operation: 'create',
          surface: withComponents([chart(axis, value)]),
        }),
        `series.0.points.0.${axis}`,
      );
      expectRejected(
        documentOf(withComponents([chart(axis, value)])),
        `series.0.points.0.${axis}`,
      );
    }
  });

  it.each(nonFinite)(
    'rejects %p in data-model values and set-data values',
    (value) => {
      expectRejected(
        update({
          operation: 'create',
          surface: makeSurfaceEnvelope({ dataModel: { n: value } }),
        }),
        'surface.dataModel.n',
      );
      expectRejected(
        documentOf(makeSurfaceEnvelope({ dataModel: { list: [1, value] } })),
        'dataModel.list',
      );
      expectRejected(
        update({
          operation: 'patch',
          surfaceId: 'profile',
          baseRevision: 1,
          ops: [{ op: 'set-data', path: 'n', value }],
        }),
        'ops.0.value',
      );
    },
  );

  it('accepts the finite extremes', () => {
    expect(
      documentOf(
        withComponents([
          {
            kind: 'stat',
            id: 'stat',
            value: Number.MAX_VALUE,
            delta: -Number.MAX_VALUE,
          },
        ]),
      ).ok,
    ).toBe(true);
  });
});

describe('surface validator — document semantics', () => {
  const submitSection = (children: SurfaceComponent[]): SurfaceComponent => ({
    kind: 'section',
    id: 'form',
    title: { text: 'Form' },
    children,
    actions: [
      { id: 'save', action: 'surface.submit', label: { text: 'Save' } },
    ],
  });

  it.each<[string, SurfaceEnvelope, string]>([
    [
      'duplicate component ids',
      withComponents([
        { kind: 'stat', id: 'same', value: 1 },
        {
          kind: 'card',
          id: 'c',
          children: [{ kind: 'stat', id: 'same', value: 2 }],
        },
      ]),
      'Duplicate component id "same"',
    ],
    [
      'duplicate action ids',
      withComponents([
        {
          kind: 'stat',
          id: 'a',
          value: 1,
          actions: [
            { id: 'go', action: 'dashboard.select', label: { text: 'Go' } },
          ],
        },
        {
          kind: 'stat',
          id: 'b',
          value: 1,
          actions: [
            { id: 'go', action: 'dashboard.select', label: { text: 'Go' } },
          ],
        },
      ]),
      'Duplicate action id "go"',
    ],
    [
      'a number stored at a checkbox path (Req 3.4)',
      makeSurfaceEnvelope({
        components: [
          { kind: 'checkbox', id: 'agree', label: 'Agree', path: 'form.agree' },
        ],
        dataModel: { form: { agree: 1 } },
      }),
      'Input "agree" at "form.agree" expects true or false.',
    ],
    [
      'a non-option stored at a select path (Req 3.4)',
      makeSurfaceEnvelope({
        components: [
          {
            kind: 'select',
            id: 'size',
            label: 'Size',
            path: 'form.size',
            options: [{ value: 'a', label: 'A' }],
          },
        ],
        dataModel: { form: { size: 'b' } },
      }),
      'does not declare the option value "b"',
    ],
    [
      'a bound path through a non-object',
      makeSurfaceEnvelope({ dataModel: { form: 'flat' } }),
      '"form" holds a non-object value',
    ],
    [
      'incompatible shared bindings (Req 3.7)',
      withComponents([
        makeSurfaceTextInput({ id: 'a', path: 'x' }),
        { kind: 'checkbox', id: 'b', label: 'B', path: 'x' },
      ]),
      'different value types',
    ],
    [
      'overlapping bindings (Req 3.7)',
      withComponents([
        makeSurfaceTextInput({ id: 'a', path: 'form' }),
        makeSurfaceTextInput({ id: 'b', path: 'form.name' }),
      ]),
      'overlapping ancestor and descendant paths',
    ],
    [
      'submit on a display component (Req 10.6)',
      withComponents([
        makeSurfaceTextInput(),
        {
          kind: 'stat',
          id: 's',
          value: 1,
          actions: [
            { id: 'save', action: 'surface.submit', label: { text: 'Save' } },
          ],
        },
      ]),
      'surface.submit is allowed only on section, stack, grid or card',
    ],
    [
      'submit with an empty scope (Req 10.6)',
      withComponents([submitSection([])]),
      'has no bound inputs',
    ],
  ])('rejects %s', (_label, surface, text) => {
    expectRejected(documentOf(surface), text);
    expectRejected(update({ operation: 'create', surface }), 'surface: ', text);
  });

  it('accepts an empty required field and short text as a stored draft (Req 3.6)', () => {
    const surface = makeSurfaceEnvelope({
      components: [
        submitSection([
          makeSurfaceTextInput({ hints: { required: true, minLength: 5 } }),
        ]),
      ],
      dataModel: { form: { name: 'ab' } },
    });
    expect(documentOf(surface).ok).toBe(true);
    expect(documentOf({ ...surface, dataModel: {} }).ok).toBe(true);
  });

  it('accepts a missing bound path as the empty value (Req 4.4)', () => {
    expect(
      documentOf(makeSurfaceEnvelope({ dataModel: { other: 1 } })).ok,
    ).toBe(true);
  });
});

describe('surface validator — never throws', () => {
  it('turns a throwing byte counter into a rejection', () => {
    const counter = () => {
      throw new RangeError('Maximum call stack size exceeded');
    };
    expect(validateSurfaceUpdateInput({}, counter)).toEqual({
      ok: false,
      reason: expect.stringContaining('could not be validated'),
    });
    expect(validateSurfaceDocument({}, counter)).toMatchObject({ ok: false });
  });

  it('turns a throwing getter into a rejection', () => {
    const hostile = Object.defineProperty({ operation: 'create' }, 'surface', {
      enumerable: false,
      get() {
        throw new Error('boom');
      },
    });
    expect(update(hostile)).toEqual({
      ok: false,
      reason: expect.stringContaining('could not be validated: boom'),
    });
  });

  it('caps the walk on a shared-subtree object graph instead of expanding it', () => {
    // 200^4 virtual leaves; JSON.stringify would never finish. The walk stops
    // after one visit per request byte and names the budget.
    let value: unknown = 0;
    for (let level = 0; level < 4; level++)
      value = Array.from(
        { length: SURFACE_LIMITS.maxDataModelArrayLength },
        () => value,
      );
    const result = update({
      operation: 'patch',
      surfaceId: 'profile',
      baseRevision: 1,
      ops: [{ op: 'set-data', path: 'a', value }],
    });
    expectRejected(result, 'maxUpdateRequestBytes');
    expect(result).not.toHaveProperty('bytes');
  });

  it('rejects non-object input without throwing', () => {
    for (const input of [null, 3, 'x', [], undefined])
      expect(update(input).ok).toBe(false);
  });
});

describe('surface validator — Revision 1 (review findings 2-4)', () => {
  const bindingAt = (segments: number) =>
    Array.from({ length: segments }, (_v, i) => `s${i}`).join('.');

  it('accepts a missing 6-segment binding as an empty draft, and it is writable', () => {
    const path = bindingAt(SURFACE_LIMITS.maxDataModelDepth);
    const { dataModel: _unused, ...surface } = makeSurfaceEnvelope({
      components: [makeSurfaceTextInput({ path })],
    });
    expect(documentOf(surface).ok).toBe(true);
    const written = applyDataModelOps({}, [
      { op: 'set-data', path, value: 'Ada' },
    ]);
    expect(written.ok).toBe(true);
    if (written.ok)
      expect(documentOf({ ...surface, dataModel: written.next }).ok).toBe(true);
  });

  it.each([
    SURFACE_LIMITS.maxDataModelDepth + 1,
    SURFACE_LIMITS.maxPathSegments,
  ])(
    'rejects a %i-segment binding that could never hold a value',
    (segments) => {
      const path = bindingAt(segments);
      const { dataModel: _unused, ...surface } = makeSurfaceEnvelope({
        components: [makeSurfaceTextInput({ id: 'deep', path })],
      });
      expectRejected(
        documentOf(surface),
        `Input "deep" binds "${path}"`,
        `maxDataModelDepth limit of ${SURFACE_LIMITS.maxDataModelDepth}`,
      );
      expectRejected(update({ operation: 'create', surface }), 'surface: ');
    },
  );

  it.each<[string, () => unknown]>([
    ['a null-prototype object', () => Object.create(null)],
    [
      'an Error with a throwing message accessor',
      () =>
        Object.defineProperty(new Error('x'), 'message', {
          get() {
            throw new Error('accessor');
          },
        }),
    ],
    [
      'a Proxy that throws on every trap',
      () =>
        new Proxy(
          {},
          {
            getPrototypeOf() {
              throw new Error('trap');
            },
            get() {
              throw new Error('trap');
            },
          },
        ),
    ],
  ])('returns a rejection when the counter throws %s', (_label, make) => {
    const counter = () => {
      throw make();
    };
    for (const result of [
      validateSurfaceUpdateInput({ operation: 'delete' }, counter),
      validateSurfaceDocument({}, counter),
    ])
      expect(result).toEqual({
        ok: false,
        reason: expect.stringContaining(
          'could not be validated: unexpected error',
        ),
      });
  });

  it('accepts the deepest legal nesting (8-level tree with a chart leaf)', () => {
    let leaf: SurfaceComponent = {
      kind: 'line-chart',
      id: 'leaf',
      series: [{ name: 's', points: [{ x: 1, y: 2 }] }],
      actions: [
        {
          id: 'pick',
          action: 'dashboard.select',
          label: { text: 'Pick' },
          params: { row: 1 },
        },
      ],
    };
    for (let level = SURFACE_LIMITS.maxTreeDepth - 1; level >= 1; level--)
      leaf = { kind: 'stack', id: `d${level}`, children: [leaf] };
    const surface = withComponents([leaf]);
    expect(documentOf(surface).ok).toBe(true);
    expect(update({ operation: 'create', surface }).ok).toBe(true);
    expect(
      update({
        operation: 'patch',
        surfaceId: 'profile',
        baseRevision: 1,
        ops: [{ op: 'add-component', parentId: null, component: leaf }],
      }).ok,
    ).toBe(true);
  });

  it.each<[string, (deep: unknown) => [unknown, 'update' | 'document']]>([
    [
      'an unknown document key',
      (deep) => [{ ...makeSurfaceEnvelope(), extra: deep }, 'document'],
    ],
    [
      'an unknown key of a create surface',
      (deep) => [
        {
          operation: 'create',
          surface: { ...makeSurfaceEnvelope(), extra: deep },
        },
        'update',
      ],
    ],
    [
      'action params of an added component',
      (deep) => [
        {
          operation: 'patch',
          surfaceId: 'profile',
          baseRevision: 1,
          ops: [
            {
              op: 'add-component',
              parentId: null,
              component: {
                kind: 'stat',
                id: 's',
                value: 1,
                actions: [
                  {
                    id: 'a',
                    action: 'dashboard.select',
                    label: { text: 'A' },
                    params: deep,
                  },
                ],
              },
            },
          ],
        },
        'update',
      ],
    ],
    [
      'table rows',
      (deep) => [
        withComponents([
          {
            kind: 'table',
            id: 't',
            columns: [{ key: 'a', label: { text: 'A' } }],
            rows: deep as never,
          },
        ]),
        'document',
      ],
    ],
  ])(
    'names the raw nesting budget for 10,000 levels under %s',
    (_label, build) => {
      const [value, entry] = build(deepData(10_000));
      const result = entry === 'update' ? update(value) : documentOf(value);
      expectRejected(
        result,
        `over the raw nesting limit SURFACE_MAX_RAW_JSON_DEPTH of ${SURFACE_MAX_RAW_JSON_DEPTH}`,
      );
      expect(result).not.toHaveProperty('bytes');
    },
  );
});

describe('surface validator — Revision 2 (review finding 5): raw preflight charges before reading', () => {
  afterEach(() => jest.restoreAllMocks());

  /** An array proxy that counts element reads. */
  function countedArray(length: number) {
    const counter = { reads: 0 };
    const proxy = new Proxy(new Array<unknown>(length), {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property))
          counter.reads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    return { proxy, counter };
  }

  it('rejects a wide array under an unknown key without reading one element', () => {
    const { proxy, counter } = countedArray(
      SURFACE_LIMITS.maxUpdateRequestBytes + 1,
    );
    const countBytes = jest.fn(dashboardJsonBytes);
    const parse = jest.spyOn(SurfaceUpdateInputSchema, 'safeParse');
    const result = validateSurfaceUpdateInput(
      {
        operation: 'create',
        surface: { ...makeSurfaceEnvelope(), extra: proxy },
      },
      countBytes,
    );
    expectRejected(
      result,
      'request.surface.extra',
      `the maxUpdateRequestBytes limit of ${SURFACE_LIMITS.maxUpdateRequestBytes}`,
    );
    expect(counter.reads).toBe(0);
    expect(countBytes).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
  });

  it('rejects wide table rows in a document without reading one row', () => {
    const { proxy, counter } = countedArray(SURFACE_LIMITS.maxSurfaceBytes + 1);
    const countBytes = jest.fn(dashboardJsonBytes);
    const parse = jest.spyOn(SurfaceEnvelopeSchema, 'safeParse');
    const result = validateSurfaceDocument(
      withComponents([
        {
          kind: 'table',
          id: 't',
          columns: [{ key: 'a', label: { text: 'A' } }],
          rows: proxy as never,
        },
      ]),
      countBytes,
    );
    expectRejected(result, 'rows', 'maxSurfaceBytes');
    expect(counter.reads).toBe(0);
    expect(countBytes).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
  });

  it('reads at most budget-many values of a wide object', () => {
    const max = SURFACE_LIMITS.maxSurfaceBytes;
    const keys = Array.from({ length: max + 1 }, (_v, i) => `k${i}`);
    const counter = { reads: 0 };
    const wide = new Proxy(
      {},
      {
        ownKeys: () => keys,
        getOwnPropertyDescriptor: () => ({
          value: 1,
          enumerable: true,
          configurable: true,
          writable: true,
        }),
        get: (_target, property) => {
          if (typeof property === 'string' && property.startsWith('k'))
            counter.reads += 1;
          return 1;
        },
      },
    );
    const countBytes = jest.fn(dashboardJsonBytes);
    const parse = jest.spyOn(SurfaceEnvelopeSchema, 'safeParse');
    const result = validateSurfaceDocument(
      { ...makeSurfaceEnvelope(), extra: wide },
      countBytes,
    );
    expectRejected(result, 'surface.extra', `maxSurfaceBytes limit of ${max}`);
    expect(counter.reads).toBeLessThanOrEqual(max);
    expect(countBytes).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
  });

  it('still accepts a wide but legal collection at the table-row budget', () => {
    expect(
      documentOf(
        withComponents([
          {
            kind: 'table',
            id: 't',
            columns: [{ key: 'a', label: { text: 'A' } }],
            rows: Array.from({ length: SURFACE_LIMITS.maxTableRows }, () => [
              1,
            ]),
          },
        ]),
      ).ok,
    ).toBe(true);
  });
});
