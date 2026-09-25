import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  DASHBOARD_COMPONENT_KINDS,
  DASHBOARD_LIMITS,
  DASHBOARD_SUPPORTED_CATALOG_VERSIONS,
  DASHBOARD_SUPPORTED_SCHEMA_VERSIONS,
} from './dashboard-catalog';
import { DashboardSpecEnvelopeSchema } from './dashboard-spec.schemas';
import { makeDashboardSpec } from '../testing/fixtures/dashboard-spec';
import {
  makeSurfaceComponents,
  makeSurfaceDataAtDepth,
  makeSurfaceEnvelope,
  makeSurfaceTextInput,
} from '../testing/fixtures/surface';
import {
  DASHBOARD_CONTRACT_VERSION_PAIRS,
  SURFACE_COMPONENT_KINDS,
  SURFACE_DISPLAY_KINDS,
  SURFACE_HOST_SUPPORTED_ACTIONS,
  SURFACE_LIMITS,
  SURFACE_PATH_DENYLIST,
} from './surface-catalog';
import {
  SurfaceActionSchema,
  SurfaceAnyIdSchema,
  SurfaceComponentSchema,
  SurfaceDataModelSchema,
  SurfaceDataValueSchema,
  SurfaceEnvelopeSchema,
  SurfaceGetStateInputSchema,
  SurfaceIdSchema,
  SurfaceOperationIdSchema,
  SurfacePatchOpSchema,
  SurfacePathSchema,
  SurfaceSelectionSchema,
  SurfaceUpdateInputSchema,
} from './surface.schemas';
import type { SurfacePatchOp, SurfaceUpdateInput } from './surface.types';

describe('surface catalog and version separation', () => {
  it('reuses display kinds and inherited budgets without widening the v1 lists', () => {
    expect(SURFACE_DISPLAY_KINDS).toBe(DASHBOARD_COMPONENT_KINDS);
    expect(SURFACE_COMPONENT_KINDS).toHaveLength(13);
    for (const key of [
      'maxComponents',
      'maxTreeDepth',
      'maxStringLength',
      'maxTableRows',
      'maxTableColumns',
      'maxSeriesPoints',
    ] as const) {
      expect(SURFACE_LIMITS[key]).toBe(DASHBOARD_LIMITS[key]);
    }
    expect(DASHBOARD_SUPPORTED_SCHEMA_VERSIONS).toEqual(['dashboard-spec/1']);
    expect(DASHBOARD_SUPPORTED_CATALOG_VERSIONS).toEqual([
      'dashboard-catalog/1',
    ]);
    expect(DASHBOARD_CONTRACT_VERSION_PAIRS).toEqual([
      ['dashboard-spec/1', 'dashboard-catalog/1'],
      ['dashboard-spec/2', 'dashboard-catalog/2'],
    ]);
    expect(SURFACE_HOST_SUPPORTED_ACTIONS).toEqual([
      'surface.submit',
      'dashboard.select',
    ]);
  });
  it('round-trips v1 unchanged and rejects a v2 select inside v1', () => {
    const v1 = makeDashboardSpec();
    expect(DashboardSpecEnvelopeSchema.parse(v1)).toEqual(v1);
    expect(
      DashboardSpecEnvelopeSchema.safeParse({
        ...v1,
        components: [makeSurfaceComponents()[5]],
      }).success,
    ).toBe(false);
  });
  it.each([
    ['schemaVersion', 'dashboard-spec/1'],
    ['schemaVersion', 'dashboard-spec/999'],
    ['catalogVersion', 'dashboard-catalog/1'],
    ['catalogVersion', 'dashboard-catalog/999'],
  ])('names %s on a mixed or unknown pair (%s)', (field, value) => {
    const parsed = SurfaceEnvelopeSchema.safeParse({
      ...makeSurfaceEnvelope(),
      [field]: value,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues.some((issue) => issue.path[0] === field)).toBe(
        true,
      );
  });
  it('round-trips a populated envelope and rejects extra envelope keys', () => {
    const surface = makeSurfaceEnvelope({
      components: makeSurfaceComponents(),
    });
    expect(SurfaceEnvelopeSchema.parse(surface)).toEqual(surface);
    expect(
      SurfaceEnvelopeSchema.safeParse({ ...surface, revision: 1 }).success,
    ).toBe(false);
    expect(
      SurfaceEnvelopeSchema.safeParse({ ...surface, components: [] }).success,
    ).toBe(false);
  });
  it('keeps ids disjoint, preserves v1 read ids and names the v1 management tool', () => {
    expect(SurfaceIdSchema.safeParse('abc-12.name_3').success).toBe(true);
    for (const id of ['v1:legacy', ':legacy', 'a:b', 'a b', ''])
      expect(SurfaceIdSchema.safeParse(id).success).toBe(false);
    const v1 = SurfaceIdSchema.safeParse('v1:legacy');
    if (!v1.success)
      expect(v1.error.message).toContain('ptah_dashboard_propose_spec');
    expect(SurfaceAnyIdSchema.safeParse('v1:old:slug').success).toBe(true);
    expect(SurfaceAnyIdSchema.safeParse('v1:').success).toBe(false);
    expect(
      SurfaceIdSchema.safeParse('a'.repeat(SURFACE_LIMITS.maxSurfaceIdLength))
        .success,
    ).toBe(true);
    expect(
      SurfaceIdSchema.safeParse(
        'a'.repeat(SURFACE_LIMITS.maxSurfaceIdLength + 1),
      ).success,
    ).toBe(false);
  });
});

describe('surface per-kind shapes', () => {
  it.each(makeSurfaceComponents())(
    'round-trips populated $kind and rejects undeclared styling',
    (component) => {
      expect(SurfaceComponentSchema.parse(component)).toEqual(component);
      for (const key of ['unexpected', 'style', 'className']) {
        const result = SurfaceComponentSchema.safeParse({
          ...component,
          [key]: 'x',
        });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.message).toContain(key);
      }
    },
  );
  it('permits children only on layouts and actions only on layouts/displays', () => {
    for (const component of makeSurfaceComponents()) {
      if (!('children' in component))
        expect(
          SurfaceComponentSchema.safeParse({ ...component, children: [] })
            .success,
        ).toBe(false);
      if ('path' in component)
        expect(
          SurfaceComponentSchema.safeParse({ ...component, actions: [] })
            .success,
        ).toBe(false);
    }
    expect(
      SurfaceComponentSchema.safeParse({ kind: 'script', id: 'bad' }).success,
    ).toBe(false);
  });
  it('bounds children, grid columns, actions and root components', () => {
    const children = Array.from(
      { length: SURFACE_LIMITS.maxChildrenPerNode },
      (_, i) => ({ kind: 'stat', id: `s${i}`, value: i }),
    );
    expect(
      SurfaceComponentSchema.safeParse({ kind: 'card', id: 'card', children })
        .success,
    ).toBe(true);
    expect(
      SurfaceComponentSchema.safeParse({
        kind: 'card',
        id: 'card',
        children: [...children, children[0]],
      }).success,
    ).toBe(false);
    for (const columns of [0, 1.5, SURFACE_LIMITS.maxGridColumns + 1])
      expect(
        SurfaceComponentSchema.safeParse({
          kind: 'grid',
          id: 'g',
          children: [],
          columns,
        }).success,
      ).toBe(false);
    expect(
      SurfaceComponentSchema.safeParse({
        kind: 'grid',
        id: 'g',
        children: [],
        columns: SURFACE_LIMITS.maxGridColumns,
      }).success,
    ).toBe(true);
    const actions = Array.from(
      { length: SURFACE_LIMITS.maxActionsPerComponent },
      (_, i) => ({
        id: `a${i}`,
        action: 'dashboard.select',
        label: { text: 'Select' },
      }),
    );
    expect(
      SurfaceComponentSchema.safeParse({
        kind: 'stat',
        id: 's',
        value: 1,
        actions,
      }).success,
    ).toBe(true);
    expect(
      SurfaceComponentSchema.safeParse({
        kind: 'stat',
        id: 's',
        value: 1,
        actions: [...actions, actions[0]],
      }).success,
    ).toBe(false);
    const components = Array.from(
      { length: SURFACE_LIMITS.maxComponents },
      (_, i) => ({ kind: 'stat' as const, id: `s${i}`, value: i }),
    );
    expect(
      SurfaceEnvelopeSchema.safeParse(makeSurfaceEnvelope({ components }))
        .success,
    ).toBe(true);
    expect(
      SurfaceEnvelopeSchema.safeParse(
        makeSurfaceEnvelope({ components: [...components, components[0]] }),
      ).success,
    ).toBe(false);
  });
  it.each(['line-chart', 'bar-chart', 'table', 'list'] as const)(
    'retains %s data-source invariants',
    (kind) => {
      const component = makeSurfaceComponents().find(
        (item) => item.kind === kind,
      );
      expect(component).toBeDefined();
      expect(
        SurfaceComponentSchema.safeParse({
          ...component,
          data: { resultId: 'query' },
        }).success,
      ).toBe(false);
      const base = {
        kind,
        id: 'referenced',
        ...(kind === 'table'
          ? { columns: [{ key: 'x', label: { text: 'X' } }] }
          : {}),
      };
      expect(SurfaceComponentSchema.safeParse(base).success).toBe(false);
      expect(
        SurfaceComponentSchema.safeParse({
          ...base,
          data: { resultId: 'query', rowCount: 100, truncated: true },
        }).success,
      ).toBe(true);
    },
  );
  it('checks table row width and summed chart points', () => {
    expect(
      SurfaceComponentSchema.safeParse({
        kind: 'table',
        id: 't',
        columns: [{ key: 'x', label: { text: 'X' } }],
        rows: [[1, 2]],
      }).success,
    ).toBe(false);
    const points = Array.from(
      { length: SURFACE_LIMITS.maxSeriesPoints },
      () => ({ x: 1, y: 1 }),
    );
    const chart = {
      kind: 'line-chart',
      id: 'c',
      series: [{ name: 'one', points }],
    };
    expect(SurfaceComponentSchema.safeParse(chart).success).toBe(true);
    expect(
      SurfaceComponentSchema.safeParse({
        ...chart,
        series: [...chart.series, { name: 'two', points: [{ x: 1, y: 2 }] }],
      }).success,
    ).toBe(false);
  });
});

describe('input hints and options (R12)', () => {
  it.each(['text', 'select', 'radio-group', 'checkbox'])(
    'rejects regex/pattern and rich labels on %s',
    (kind) => {
      const input = makeSurfaceComponents().find(
        (component) => component.kind === kind,
      );
      for (const key of ['pattern', 'regex', 'unexpected'])
        expect(
          SurfaceComponentSchema.safeParse({ ...input, hints: { [key]: '.*' } })
            .success,
        ).toBe(false);
      expect(
        SurfaceComponentSchema.safeParse({ ...input, label: { text: 'Label' } })
          .success,
      ).toBe(false);
    },
  );
  it('rejects contradictory or out-of-budget text hints', () => {
    for (const hints of [
      { minLength: 3, maxLength: 2 },
      { minLength: -1 },
      { maxLength: 0.5 },
      { maxLength: SURFACE_LIMITS.maxStringLength + 1 },
    ]) {
      expect(
        SurfaceComponentSchema.safeParse({ ...makeSurfaceTextInput(), hints })
          .success,
      ).toBe(false);
    }
    expect(
      SurfaceComponentSchema.safeParse(
        makeSurfaceTextInput({ hints: { minLength: 0, maxLength: 0 } }),
      ).success,
    ).toBe(true);
  });
  it.each(['select', 'radio-group'])(
    'bounds %s options and rejects duplicate values',
    (kind) => {
      const options = Array.from(
        { length: SURFACE_LIMITS.maxOptions },
        (_, i) => ({ value: `v${i}`, label: 'Option' }),
      );
      const input = {
        kind,
        id: 'options',
        path: 'form.choice',
        label: 'Choice',
        options,
      };
      expect(SurfaceComponentSchema.safeParse(input).success).toBe(true);
      for (const invalid of [
        [],
        [...options, { value: 'extra', label: 'Extra' }],
        [options[0], options[0]],
        [
          {
            value: 'a'.repeat(SURFACE_LIMITS.maxOptionValueLength + 1),
            label: 'Long',
          },
        ],
      ]) {
        expect(
          SurfaceComponentSchema.safeParse({ ...input, options: invalid })
            .success,
        ).toBe(false);
      }
    },
  );
});

describe('surface actions and requests', () => {
  const action = {
    id: 'open',
    action: 'dashboard.open-url',
    label: { text: 'Open' },
    url: 'https://example.com',
  };
  it('requires an allowlisted URL only for open-url and rejects submit params', () => {
    expect(SurfaceActionSchema.parse(action)).toEqual(action);
    for (const url of [
      'javascript:alert(1)',
      'data:text/plain,x',
      'file:///tmp/x',
      'http://example.com',
      'https://user:pass@example.com',
    ])
      expect(SurfaceActionSchema.safeParse({ ...action, url }).success).toBe(
        false,
      );
    expect(
      SurfaceActionSchema.safeParse({ ...action, url: undefined }).success,
    ).toBe(false);
    expect(
      SurfaceActionSchema.safeParse({ ...action, action: 'dashboard.select' })
        .success,
    ).toBe(false);
    expect(
      SurfaceActionSchema.safeParse({
        id: 'submit',
        action: 'surface.submit',
        label: { text: 'Save' },
        params: {},
      }).success,
    ).toBe(false);
    expect(
      SurfaceActionSchema.safeParse({ ...action, action: 'surface.change' })
        .success,
    ).toBe(false);
    expect(
      SurfaceActionSchema.safeParse({ ...action, toolName: 'exec' }).success,
    ).toBe(false);
  });
  it('round-trips every patch/update operation and rejects extra keys', () => {
    const ops: SurfacePatchOp[] = [
      { op: 'set-data', path: 'form.name', value: 'Grace' },
      { op: 'remove-data', path: 'form.old' },
      {
        op: 'add-component',
        parentId: null,
        index: 0,
        component: makeSurfaceTextInput(),
      },
      { op: 'replace-component', component: makeSurfaceTextInput() },
      { op: 'remove-component', componentId: 'name' },
      {
        op: 'set-title',
        title: { text: 'New' },
        description: { text: 'New description' },
      },
    ];
    for (const op of ops) {
      expect(SurfacePatchOpSchema.parse(op)).toEqual(op);
      expect(
        SurfacePatchOpSchema.safeParse({ ...op, extra: true }).success,
      ).toBe(false);
    }
    const updates: SurfaceUpdateInput[] = [
      { operation: 'create', surface: makeSurfaceEnvelope() },
      { operation: 'replace', surface: makeSurfaceEnvelope(), baseRevision: 1 },
      { operation: 'patch', surfaceId: 'profile', baseRevision: 1, ops },
      { operation: 'delete', surfaceId: 'profile', baseRevision: 1 },
    ];
    for (const update of updates) {
      expect(SurfaceUpdateInputSchema.parse(update)).toEqual(update);
      expect(
        SurfaceUpdateInputSchema.safeParse({ ...update, extra: true }).success,
      ).toBe(false);
    }
    expect(
      SurfaceUpdateInputSchema.safeParse({
        operation: 'patch',
        surfaceId: 'profile',
        baseRevision: 1,
        ops: Array(SURFACE_LIMITS.maxPatchOps + 1).fill(ops[0]),
      }).success,
    ).toBe(false);
  });
  it('allows state reads without an id, requires an id for structure and accepts v1 reads', () => {
    expect(SurfaceGetStateInputSchema.parse({})).toEqual({});
    expect(
      SurfaceGetStateInputSchema.safeParse({ view: 'structure' }).success,
    ).toBe(false);
    expect(
      SurfaceGetStateInputSchema.safeParse({
        view: 'structure',
        surfaceId: 'v1:legacy',
      }).success,
    ).toBe(true);
    expect(
      SurfaceGetStateInputSchema.safeParse({ view: 'state', extra: true })
        .success,
    ).toBe(false);
  });
  it('bounds selection indices and operation ids', () => {
    for (const target of [
      { kind: 'stat' },
      { kind: 'table-row', rowIndex: 0 },
      { kind: 'list-item', itemIndex: 0 },
      { kind: 'chart-point', seriesIndex: 0, pointIndex: 0 },
    ]) {
      expect(
        SurfaceSelectionSchema.safeParse({ componentId: 'tile', target })
          .success,
      ).toBe(true);
      expect(
        SurfaceSelectionSchema.safeParse({
          componentId: 'tile',
          target: { ...target, extra: true },
        }).success,
      ).toBe(false);
    }
    expect(
      SurfaceSelectionSchema.safeParse({
        componentId: 'tile',
        target: { kind: 'table-row', rowIndex: -1 },
      }).success,
    ).toBe(false);
    expect(
      SurfaceOperationIdSchema.safeParse('op-1790000000000-aB123456').success,
    ).toBe(true);
    for (const id of [
      'op-179000000000-aB123456',
      'op-1790000000000-short',
      `op-1790000000000-${'a'.repeat(41)}`,
      'other',
    ])
      expect(SurfaceOperationIdSchema.safeParse(id).success).toBe(false);
  });
});

describe('surface JSON and path boundary', () => {
  it.each([undefined, NaN, Infinity, -Infinity, () => 1])(
    'rejects non-JSON %p at root and nested',
    (value) => {
      expect(SurfaceDataValueSchema.safeParse(value).success).toBe(false);
      expect(
        SurfaceDataModelSchema.safeParse({ form: { value } }).success,
      ).toBe(false);
    },
  );
  it.each(SURFACE_PATH_DENYLIST)(
    'rejects %s keys and path segments at every depth',
    (segment) => {
      for (const path of [segment, `form.${segment}.name`])
        expect(SurfacePathSchema.safeParse(path).success).toBe(false);
      for (const value of [{ [segment]: true }, { form: { [segment]: true } }])
        expect(SurfaceDataValueSchema.safeParse(value).success).toBe(false);
      expect(
        SurfaceDataModelSchema.safeParse({ [segment]: true }).success,
      ).toBe(false);
      expect(
        SurfaceActionSchema.safeParse({
          id: 'select',
          action: 'dashboard.select',
          label: { text: 'Pick' },
          params: { [segment]: true },
        }).success,
      ).toBe(false);
    },
  );
  it('bounds nesting before recursion and counts the model root as depth 1', () => {
    const atLimit = makeSurfaceDataAtDepth(SURFACE_LIMITS.maxDataModelDepth);
    expect(SurfaceDataValueSchema.safeParse(atLimit).success).toBe(true);
    expect(SurfaceDataModelSchema.safeParse(atLimit).success).toBe(true);
    expect(
      SurfaceDataValueSchema.safeParse(
        makeSurfaceDataAtDepth(SURFACE_LIMITS.maxDataModelDepth + 1),
      ).success,
    ).toBe(false);
    expect(SurfaceDataModelSchema.safeParse({ value: atLimit }).success).toBe(
      false,
    );
    const cycle: { self?: object } = {};
    cycle.self = cycle;
    expect(() => SurfaceDataValueSchema.safeParse(cycle)).not.toThrow();
    expect(SurfaceDataValueSchema.safeParse(cycle).success).toBe(false);
  });
  it('bounds strings, arrays and object widths at limit and limit + 1', () => {
    const atLimit = [
      'x'.repeat(SURFACE_LIMITS.maxStringLength),
      Array(SURFACE_LIMITS.maxDataModelArrayLength).fill(null),
      Object.fromEntries(
        Array.from(
          { length: SURFACE_LIMITS.maxDataModelObjectKeys },
          (_, i) => [`k${i}`, i],
        ),
      ),
    ];
    const overLimit = [
      'x'.repeat(SURFACE_LIMITS.maxStringLength + 1),
      Array(SURFACE_LIMITS.maxDataModelArrayLength + 1).fill(null),
      Object.fromEntries(
        Array.from(
          { length: SURFACE_LIMITS.maxDataModelObjectKeys + 1 },
          (_, i) => [`k${i}`, i],
        ),
      ),
    ];
    for (const value of atLimit)
      expect(SurfaceDataValueSchema.safeParse(value).success).toBe(true);
    for (const value of overLimit)
      expect(SurfaceDataValueSchema.safeParse(value).success).toBe(false);
    expect(SurfaceDataValueSchema.safeParse({ 'bad.key': true }).success).toBe(
      false,
    );
  });
  it('preserves named component definitions and record shapes in generated tool input schemas', () => {
    const generated = z.toJSONSchema(SurfaceUpdateInputSchema, { io: 'input' });
    const json = JSON.stringify(generated);
    expect(json).toContain('SurfaceComponent');
    expect(json).toContain('SurfaceDataValue');
    expect(json).toContain('propertyNames');
    expect(json).toContain('maxItems');
    expect(json).toContain('additionalProperties');
  });
  it('keeps the new source free of unchecked schema escape hatches and type-side value imports', () => {
    for (const file of [
      'surface-catalog.ts',
      'surface.types.ts',
      'surface.schemas.ts',
      'surface-data-model.ts',
    ]) {
      const source = readFileSync(join(__dirname, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      expect(source).not.toMatch(
        /:\s*any\b|\bas\s+any\b|\bz\.(?:any|unknown)\s*\(|\.(?:passthrough|loose|catchall)\s*\(/,
      );
      if (file === 'surface-catalog.ts' || file === 'surface.types.ts')
        expect(source).not.toMatch(/from\s+['"]zod['"]/);
      if (file === 'surface.types.ts')
        expect(source).not.toMatch(/import\s+(?!type\b)/);
    }
  });
});
