import type {
  DashboardComponent,
  DashboardSpecEnvelope,
} from '@ptah-extension/shared';
import {
  DASHBOARD_COMPONENT_KINDS,
  DASHBOARD_LIMITS,
} from '@ptah-extension/shared/mcp-apps-contracts';
import {
  buildDashboardViewModel,
  mapDisplayNode,
  SURFACE_PAGE_SIZE,
} from '../../index';

function spec(
  components: readonly DashboardComponent[],
): DashboardSpecEnvelope {
  return {
    schemaVersion: 'dashboard-spec/1',
    catalogVersion: 'dashboard-catalog/1',
    specId: 'example',
    revision: 1,
    generatedAt: '2026-09-25T00:00:00Z',
    title: { text: '<script>literal</script>' },
    description: { text: 'Description' },
    components,
  };
}

function freezeDeep(value: unknown): void {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
}

describe('buildDashboardViewModel', () => {
  const components: readonly DashboardComponent[] = [
    { id: 'stat', kind: 'stat', value: 42, unit: '%', delta: -2 },
    {
      id: 'line',
      kind: 'line-chart',
      xLabel: { text: 'Day' },
      yLabel: { text: 'Count' },
      series: [{ name: 'A', points: [{ x: 'Mon', y: 4 }] }],
    },
    {
      id: 'bar',
      kind: 'bar-chart',
      series: [{ name: 'B', points: [{ x: 1, y: 2 }] }],
    },
    {
      id: 'table',
      kind: 'table',
      columns: [{ key: 'name', label: { text: 'Name' }, align: 'left' }],
      rows: [['<img src=x>'], [null], [false], [3]],
    },
    {
      id: 'list',
      kind: 'list',
      ordered: true,
      items: [
        {
          text: { text: 'Item' },
          detail: { text: 'Detail' },
          url: 'https://example.com',
        },
      ],
    },
  ];

  it('maps every v1 catalog kind without losing display fields or interpreting text', () => {
    const input = spec(components);
    const result = buildDashboardViewModel(input);
    expect(result.components.map((node) => node.kind)).toEqual([
      ...DASHBOARD_COMPONENT_KINDS,
    ]);
    expect(result.title).toEqual(input.title);
    expect(result.description).toEqual(input.description);
    components.forEach((component, index) => {
      expect(result.components[index]).toMatchObject({
        ...component,
        selectable: false,
      });
      expect(result.components[index]).not.toBe(component);
    });
    expect(SURFACE_PAGE_SIZE).toBe(25);
  });

  it('sets selectable only for an exact declared dashboard.select action', () => {
    const result = buildDashboardViewModel(
      spec([
        {
          id: 'selected',
          kind: 'stat',
          value: 1,
          actions: [{ action: 'dashboard.select', label: { text: 'Select' } }],
        },
        { id: 'absent', kind: 'stat', value: 2 },
        { id: 'empty', kind: 'stat', value: 3, actions: [] },
        {
          id: 'other',
          kind: 'stat',
          value: 4,
          actions: [
            {
              action: 'dashboard.refresh',
              label: { text: 'dashboard.select' },
            },
          ],
        },
      ]),
    );
    expect(result.components.map((node) => node.selectable)).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  it('preserves nested order and selection and stops at maxTreeDepth', () => {
    let root: DashboardComponent = { id: 'beyond', kind: 'stat', value: 0 };
    for (let depth = DASHBOARD_LIMITS.maxTreeDepth; depth >= 1; depth--) {
      root = {
        id: `depth-${depth}`,
        kind: 'stat',
        value: depth,
        actions: [{ action: 'dashboard.select', label: { text: 'Select' } }],
        children: [root],
      };
    }
    const input = spec([root, { id: 'sibling', kind: 'stat', value: 9 }]);
    const result = buildDashboardViewModel(input);
    expect(result.components.map((node) => node.id)).toEqual([
      'depth-1',
      'sibling',
    ]);
    let nodes = result.components.slice(0, 1);
    let depth = 0;
    while (nodes.length > 0) {
      depth++;
      expect(nodes[0].id).toBe(`depth-${depth}`);
      expect(nodes[0].selectable).toBe(true);
      nodes = [...(nodes[0].children ?? [])];
    }
    expect(depth).toBe(DASHBOARD_LIMITS.maxTreeDepth);
  });

  it('accepts empty trees and retains data references without resolving them', () => {
    expect(buildDashboardViewModel(spec([])).components).toEqual([]);
    const data = { resultId: 'opaque', rowCount: 100, truncated: true };
    const refs: readonly DashboardComponent[] = [
      { id: 't', kind: 'table', columns: [], data },
      { id: 'l', kind: 'list', data },
      { id: 'b', kind: 'bar-chart', data },
      { id: 'c', kind: 'line-chart', data },
    ];
    expect(buildDashboardViewModel(spec(refs)).components).toEqual(
      refs.map((node) =>
        expect.objectContaining({ ...node, selectable: false }),
      ),
    );
  });

  it.each([
    null,
    {},
    { ...spec([]), components: null },
    { ...spec([]), title: {} },
    { ...spec([]), schemaVersion: 'dashboard-spec/2' },
    spec([null as unknown as DashboardComponent]),
    spec([{ id: 'bad', kind: 'unknown' } as unknown as DashboardComponent]),
    spec([
      {
        id: 'bad',
        kind: 'stat',
        value: 1,
        children: {},
      } as unknown as DashboardComponent,
    ]),
    spec([{ id: 'bad', kind: 'stat' } as unknown as DashboardComponent]),
    spec([{ id: 'bad', kind: 'table' } as unknown as DashboardComponent]),
    spec([
      {
        id: 'bad',
        kind: 'stat',
        value: 1,
        actions: {},
      } as unknown as DashboardComponent,
    ]),
  ])(
    'throws on invalid input shape %# for the renderer fallback',
    (input: unknown) => {
      expect(() =>
        buildDashboardViewModel(input as DashboardSpecEnvelope),
      ).toThrow(TypeError);
    },
  );

  it('does not mutate frozen source objects or arrays and produces repeatable results', () => {
    const input = spec([{ ...components[0], children: components }]);
    const before = JSON.stringify(input);
    freezeDeep(input);
    const first = buildDashboardViewModel(input);
    expect(buildDashboardViewModel(input)).toEqual(first);
    expect(JSON.stringify(input)).toBe(before);
    expect(first.components).not.toBe(input.components);
    expect(first.components[0].children).not.toBe(input.components[0].children);
  });

  it('shares display mapping with v2 while retaining action ids', () => {
    const node = mapDisplayNode({
      id: 'v2',
      kind: 'stat',
      value: 1,
      actions: [
        {
          id: 'select-v2',
          action: 'dashboard.select',
          label: { text: 'Select' },
        },
      ],
    });
    expect(node.selectable).toBe(true);
    expect(node.actions?.[0]).toMatchObject({ id: 'select-v2' });
    expect(node.children).toBeUndefined();
  });
});
