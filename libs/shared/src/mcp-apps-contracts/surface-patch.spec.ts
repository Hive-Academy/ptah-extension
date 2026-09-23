import { makeDashboardSpec } from '../testing/fixtures/dashboard-spec';
import {
  makeSurfaceEnvelope,
  makeSurfaceTextInput,
} from '../testing/fixtures/surface';
import {
  applySurfaceOps,
  checkSurfaceSelection,
  revalidateSelection,
} from './surface-patch';
import type { SurfacePatchState } from './surface-patch';
import type {
  SurfaceComponent,
  SurfaceContent,
  SurfaceSelection,
  SurfaceStateOp,
  SurfaceSubmitRecord,
} from './surface.types';

function components(): SurfaceComponent[] {
  return [
    {
      kind: 'section',
      id: 'root',
      title: { text: 'Root' },
      children: [
        {
          kind: 'card',
          id: 'card',
          children: [
            {
              kind: 'table',
              id: 'table',
              columns: [{ key: 'name', label: { text: 'Name' } }],
              rows: [['Ada'], ['Grace']],
            },
          ],
        },
        { kind: 'stat', id: 'stat', value: 1 },
      ],
    },
    {
      kind: 'line-chart',
      id: 'chart',
      series: [{ name: 's', points: [{ x: 1, y: 2 }] }],
    },
    {
      kind: 'list',
      id: 'list',
      items: [{ text: { text: 'One' } }],
    },
    makeSurfaceTextInput({ id: 'name', path: 'form.name' }),
  ];
}

function state(selection: SurfaceSelection | null = null): SurfacePatchState {
  const { dataModel, ...surface } = makeSurfaceEnvelope({
    components: components(),
  });
  return {
    content: {
      contract: 'dashboard-spec/2',
      surface,
      dataModel: dataModel ?? {},
    },
    selection,
    lastSubmit: null,
  };
}

function v2(next: SurfacePatchState) {
  if (next.content.contract !== 'dashboard-spec/2') throw new Error('v1');
  return next.content;
}

function apply(prev: SurfacePatchState, ops: SurfaceStateOp[]) {
  const result = applySurfaceOps(prev, ops);
  if (!result.ok) throw new Error(result.reason);
  return result.next;
}

const tableRow: SurfaceSelection = {
  componentId: 'table',
  target: { kind: 'table-row', rowIndex: 1 },
};

describe('applySurfaceOps — structure', () => {
  it('adds at a parent index, appends by default and copies only the edited path', () => {
    const prev = state();
    const next = apply(prev, [
      {
        op: 'add-component',
        parentId: 'root',
        index: 0,
        component: { kind: 'stat', id: 'first', value: 0 },
      },
      {
        op: 'add-component',
        parentId: null,
        component: { kind: 'stat', id: 'last', value: 9 },
      },
    ]);
    const roots = v2(next).surface.components;
    expect(roots.map((component) => component.id)).toEqual([
      'root',
      'chart',
      'list',
      'name',
      'last',
    ]);
    const root = roots[0];
    expect(root.kind === 'section' && root.children.map((c) => c.id)).toEqual([
      'first',
      'card',
      'stat',
    ]);
    // Untouched branches keep identity; the input state is never mutated.
    expect(roots[1]).toBe(v2(prev).surface.components[1]);
    expect(v2(prev).surface.components).toHaveLength(4);
  });

  it('replaces and removes nested components by id', () => {
    const next = apply(state(), [
      {
        op: 'replace-component',
        component: { kind: 'stat', id: 'stat', value: 2 },
      },
      { op: 'remove-component', componentId: 'card' },
    ]);
    const root = v2(next).surface.components[0];
    expect(root.kind === 'section' && root.children).toEqual([
      { kind: 'stat', id: 'stat', value: 2 },
    ]);
  });

  it.each<[string, SurfaceStateOp, string]>([
    [
      'a missing parent',
      {
        op: 'add-component',
        parentId: 'ghost',
        component: { kind: 'stat', id: 'x', value: 1 },
      },
      'Component "ghost" does not exist in surface "profile".',
    ],
    [
      'a missing replace target',
      {
        op: 'replace-component',
        component: { kind: 'stat', id: 'ghost', value: 1 },
      },
      '"ghost"',
    ],
    [
      'a missing remove target',
      { op: 'remove-component', componentId: 'ghost' },
      '"ghost"',
    ],
    [
      'a non-layout parent',
      {
        op: 'add-component',
        parentId: 'stat',
        component: { kind: 'stat', id: 'x', value: 1 },
      },
      'only section, stack, grid and card take children',
    ],
    [
      'an index past the end',
      {
        op: 'add-component',
        parentId: 'card',
        index: 2,
        component: { kind: 'stat', id: 'x', value: 1 },
      },
      'Index 2 is out of range',
    ],
  ])('rejects %s, naming it, and applies nothing (Req 5.3)', (_l, op, text) => {
    const prev = state();
    const result = applySurfaceOps(prev, [
      { op: 'set-data', path: 'form.name', value: 'changed' },
      op,
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(text);
    expect(v2(prev).dataModel).toEqual({ form: { name: 'Ada' } });
  });

  it('sets the header wholesale: an omitted description clears it', () => {
    const titled = apply(state(), [
      { op: 'set-title', title: { text: 'New' } },
    ]);
    expect(v2(titled).surface.title).toEqual({ text: 'New' });
    expect('description' in v2(titled).surface).toBe(false);
    const described = apply(state(), [
      { op: 'set-title', title: { text: 'New' }, description: { text: 'D' } },
    ]);
    expect(v2(described).surface.description).toEqual({ text: 'D' });
  });
});

describe('applySurfaceOps — data, selection and last submit', () => {
  it('applies runs of data ops in order with set / replace / remove semantics', () => {
    const next = apply(state(), [
      { op: 'set-data', path: 'form.age', value: 3 },
      { op: 'set-data', path: 'form.age', value: 4 },
      { op: 'remove-data', path: 'form.name' },
      { op: 'set-title', title: { text: 'Between' } },
      { op: 'remove-data', path: 'form.missing' },
    ]);
    expect(v2(next).dataModel).toEqual({ form: { age: 4 } });
  });

  it('rejects denied data segments and leaves Object.prototype untouched', () => {
    const result = applySurfaceOps(state(), [
      { op: 'set-data', path: '__proto__.polluted', value: true },
    ]);
    expect(result.ok).toBe(false);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('stores a resolvable selection and rejects one that does not resolve', () => {
    expect(
      apply(state(), [{ op: 'set-selection', selection: tableRow }]).selection,
    ).toEqual(tableRow);
    const bad = applySurfaceOps(state(), [
      {
        op: 'set-selection',
        selection: {
          componentId: 'table',
          target: { kind: 'table-row', rowIndex: 2 },
        },
      },
    ]);
    expect(bad).toMatchObject({ ok: false });
    expect(
      apply(state(tableRow), [{ op: 'set-selection', selection: null }])
        .selection,
    ).toBeNull();
  });

  it('records the last submit', () => {
    const record: SurfaceSubmitRecord = {
      operationId: 'op-1700000000000-abcdefgh',
      actionId: 'save',
      scopeComponentId: 'root',
      baseRevision: 3,
      status: 'applied',
      submittedAt: 1_700_000_000_000,
      values: [{ componentId: 'name', path: 'form.name', value: 'Ada' }],
    };
    expect(
      apply(state(), [{ op: 'set-last-submit', record }]).lastSubmit,
    ).toEqual(record);
  });

  it('accepts only selection and last-submit ops on v1 content', () => {
    const spec = makeDashboardSpec();
    const v1: SurfacePatchState = {
      content: { contract: 'dashboard-spec/1', spec },
      selection: null,
      lastSubmit: null,
    };
    const statId = spec.components[0].id;
    expect(
      apply(v1, [
        {
          op: 'set-selection',
          selection: { componentId: statId, target: { kind: 'stat' } },
        },
      ]).selection,
    ).toMatchObject({ componentId: statId });
    const refused = applySurfaceOps(v1, [
      { op: 'set-data', path: 'a', value: 1 },
    ]);
    expect(refused).toMatchObject({ ok: false });
    if (!refused.ok) expect(refused.reason).toContain('dashboard-spec/1');
  });

  it('never throws on a hostile op list', () => {
    const hostile = [{ op: 'explode' }] as unknown as SurfaceStateOp[];
    expect(applySurfaceOps(state(), hostile)).toMatchObject({ ok: false });
    const throwing = Object.defineProperty({}, 'op', {
      get() {
        throw new Error('boom');
      },
    }) as SurfaceStateOp;
    expect(applySurfaceOps(state(), [throwing])).toEqual({
      ok: false,
      reason: 'Cannot apply surface operations.',
    });
  });
});

describe('selection revalidation (Req 5.9) — cleared, never remapped', () => {
  it('keeps a selection that an unrelated change does not touch', () => {
    const next = apply(state(tableRow), [
      { op: 'set-data', path: 'form.name', value: 'x' },
      {
        op: 'add-component',
        parentId: 'card',
        index: 0,
        component: { kind: 'stat', id: 'sibling', value: 1 },
      },
      {
        op: 'replace-component',
        component: { kind: 'stat', id: 'stat', value: 5 },
      },
    ]);
    expect(next.selection).toEqual(tableRow);
  });

  it.each<[string, SurfaceStateOp]>([
    [
      'replacing the selected component with identical content',
      {
        op: 'replace-component',
        component: {
          kind: 'table',
          id: 'table',
          columns: [{ key: 'name', label: { text: 'Name' } }],
          rows: [['Ada'], ['Grace']],
        },
      },
    ],
    [
      'replacing an ancestor',
      {
        op: 'replace-component',
        component: {
          kind: 'card',
          id: 'card',
          children: [
            {
              kind: 'table',
              id: 'table',
              columns: [{ key: 'name', label: { text: 'Name' } }],
              rows: [['Ada'], ['Grace']],
            },
          ],
        },
      },
    ],
    [
      'removing the component',
      { op: 'remove-component', componentId: 'table' },
    ],
    ['removing an ancestor', { op: 'remove-component', componentId: 'root' }],
  ])('clears on %s', (_label, op) => {
    expect(apply(state(tableRow), [op]).selection).toBeNull();
  });

  it('clears when the index falls out of range, even with a different component id', () => {
    const shrunk: SurfaceContent = v2(
      apply(state(), [
        {
          op: 'replace-component',
          component: {
            kind: 'table',
            id: 'table',
            columns: [{ key: 'name', label: { text: 'Name' } }],
            rows: [['Ada']],
          },
        },
      ]),
    );
    const prev = state(tableRow);
    expect(
      revalidateSelection(prev, { ...prev, content: shrunk }, []),
    ).toBeNull();
  });

  it('clears on a whole replacement', () => {
    const prev = state(tableRow);
    expect(revalidateSelection(prev, prev, 'replace')).toBeNull();
  });

  it('checks structure ops only after the last set-selection', () => {
    const next = apply(state(), [
      { op: 'remove-component', componentId: 'list' },
      { op: 'set-selection', selection: tableRow },
    ]);
    expect(next.selection).toEqual(tableRow);
  });
});

describe('selection through a transient ancestor (review Revision 1, Req 5.9)', () => {
  const table = (rows: string[][]): SurfaceComponent => ({
    kind: 'table',
    id: 't',
    columns: [{ key: 'name', label: { text: 'Name' } }],
    rows,
  });
  const start = (): SurfacePatchState => {
    const { dataModel: _unused, ...surface } = makeSurfaceEnvelope({
      components: [{ kind: 'stat', id: 'only', value: 1 }],
    });
    return {
      content: { contract: 'dashboard-spec/2', surface, dataModel: {} },
      selection: null,
      lastSubmit: null,
    };
  };
  const rowZero: SurfaceSelection = {
    componentId: 't',
    target: { kind: 'table-row', rowIndex: 0 },
  };
  const addTemporary: SurfaceStateOp = {
    op: 'add-component',
    parentId: null,
    component: { kind: 'stack', id: 'temporary', children: [table([['Ada']])] },
  };
  const addRootTable: SurfaceStateOp = {
    op: 'add-component',
    parentId: null,
    component: table([['Grace']]),
  };

  it('clears a selection whose ancestor is removed, even when an equal id and index reappear', () => {
    const ops: SurfaceStateOp[] = [
      addTemporary,
      { op: 'set-selection', selection: rowZero },
      { op: 'remove-component', componentId: 'temporary' },
      addRootTable,
    ];
    const prev = start();
    const next = apply(prev, ops);
    const roots = v2(next).surface.components;
    expect(roots.map((component) => component.id)).toEqual(['only', 't']);
    expect(next.selection).toBeNull();
    // The standalone revalidation replays the same per-op rule.
    expect(
      revalidateSelection(prev, { ...next, selection: rowZero }, ops),
    ).toBeNull();
  });

  it('clears a selection whose transient ancestor is replaced', () => {
    const next = apply(start(), [
      addTemporary,
      { op: 'set-selection', selection: rowZero },
      {
        op: 'replace-component',
        component: {
          kind: 'stack',
          id: 'temporary',
          children: [table([['Grace']])],
        },
      },
    ]);
    expect(next.selection).toBeNull();
  });

  it('keeps only a selection set explicitly after the ancestor change', () => {
    const next = apply(start(), [
      addTemporary,
      { op: 'set-selection', selection: rowZero },
      { op: 'remove-component', componentId: 'temporary' },
      addRootTable,
      { op: 'set-selection', selection: rowZero },
    ]);
    expect(next.selection).toEqual(rowZero);
  });
});

describe('checkSurfaceSelection', () => {
  const content = state().content;
  it.each<[SurfaceSelection, boolean]>([
    [{ componentId: 'stat', target: { kind: 'stat' } }, true],
    [{ componentId: 'table', target: { kind: 'stat' } }, false],
    [
      { componentId: 'list', target: { kind: 'list-item', itemIndex: 0 } },
      true,
    ],
    [
      { componentId: 'list', target: { kind: 'list-item', itemIndex: 1 } },
      false,
    ],
    [
      {
        componentId: 'chart',
        target: { kind: 'chart-point', seriesIndex: 0, pointIndex: 0 },
      },
      true,
    ],
    [
      {
        componentId: 'chart',
        target: { kind: 'chart-point', seriesIndex: 0, pointIndex: 1 },
      },
      false,
    ],
    [
      {
        componentId: 'chart',
        target: { kind: 'chart-point', seriesIndex: 1, pointIndex: 0 },
      },
      false,
    ],
    [
      { componentId: 'table', target: { kind: 'table-row', rowIndex: -1 } },
      false,
    ],
    [{ componentId: 'ghost', target: { kind: 'stat' } }, false],
  ])('%j resolves: %s', (selection, ok) => {
    expect(checkSurfaceSelection(content, selection).ok).toBe(ok);
  });

  it('refuses index selection on a data-reference table', () => {
    const { dataModel: _unused, ...surface } = makeSurfaceEnvelope({
      components: [
        {
          kind: 'table',
          id: 'ref',
          columns: [{ key: 'a', label: { text: 'A' } }],
          data: { resultId: 'r1' },
        },
      ],
    });
    expect(
      checkSurfaceSelection(
        { contract: 'dashboard-spec/2', surface, dataModel: {} },
        { componentId: 'ref', target: { kind: 'table-row', rowIndex: 0 } },
      ).ok,
    ).toBe(false);
  });
});

describe('standalone revalidation compares targets by field (review finding 6)', () => {
  it('keeps an unchanged selection whose target keys are in another order', () => {
    const prev = state(tableRow);
    const reordered = JSON.parse(
      '{"componentId":"table","target":{"rowIndex":1,"kind":"table-row"}}',
    ) as SurfaceSelection;
    expect(
      revalidateSelection(prev, { ...prev, selection: reordered }, []),
    ).toBe(reordered);
    const chart = JSON.parse(
      '{"target":{"pointIndex":0,"seriesIndex":0,"kind":"chart-point"},"componentId":"chart"}',
    ) as SurfaceSelection;
    const chartPrev = state({
      componentId: 'chart',
      target: { kind: 'chart-point', seriesIndex: 0, pointIndex: 0 },
    });
    expect(
      revalidateSelection(chartPrev, { ...chartPrev, selection: chart }, []),
    ).toBe(chart);
  });

  it('clears a selection whose index or kind changed', () => {
    const prev = state(tableRow);
    expect(
      revalidateSelection(
        prev,
        {
          ...prev,
          selection: {
            componentId: 'table',
            target: { kind: 'table-row', rowIndex: 0 },
          },
        },
        [],
      ),
    ).toBeNull();
    const statPrev = state({ componentId: 'stat', target: { kind: 'stat' } });
    expect(
      revalidateSelection(
        statPrev,
        {
          ...statPrev,
          selection: {
            componentId: 'stat',
            target: { kind: 'list-item', itemIndex: 0 },
          },
        },
        [],
      ),
    ).toBeNull();
  });
});
