import type {
  DashboardSpecEnvelope,
} from '@ptah-extension/shared';
import {
  SURFACE_ACTIONS,
  type SurfaceAction,
  type SurfaceComponent,
  type SurfaceDataModel,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { SurfaceRenderable } from '../surface-view-state';
import { buildSurfaceViewModel } from './surface-view-model';
import type { InputNode, LayoutNode, SurfaceNode } from './view-model.types';

type V2 = Extract<SurfaceRenderable, { contract: 'dashboard-spec/2' }>;

function v2(components: readonly SurfaceComponent[], dataModel: SurfaceDataModel = {}): V2 {
  return {
    contract: 'dashboard-spec/2',
    surface: {
      schemaVersion: 'dashboard-spec/2',
      catalogVersion: 'dashboard-catalog/2',
      surfaceId: 'rollback',
      title: { text: 'Rollback request' },
      components,
    },
    dataModel,
  };
}

function built(renderable: SurfaceRenderable): readonly SurfaceNode[] {
  const result = buildSurfaceViewModel(renderable);
  if (result.renderFailed) throw new Error(`unexpected renderFailed: ${result.reason}`);
  return result.viewModel.components;
}

function input(node: SurfaceNode | undefined): InputNode {
  if (!node || !['text', 'select', 'radio-group', 'checkbox'].includes(node.kind)) throw new Error('not an input');
  return node as InputNode;
}

function action(id: string, name: SurfaceAction['action']): SurfaceAction {
  return { id, action: name, label: { text: `Run ${id}` } };
}

const options = [{ value: 'production', label: 'Production' }, { value: 'staging', label: 'Staging' }];

describe('buildSurfaceViewModel', () => {
  it('reads each input host value through readSurfacePath', () => {
    const [text, select, radio, checkbox] = built(v2([
      { id: 'reason', kind: 'text', label: 'Reason', path: 'form.reason' },
      { id: 'env', kind: 'select', label: 'Environment', path: 'form.env', options },
      { id: 'env-radio', kind: 'radio-group', label: 'Environment', path: 'form.env', options },
      { id: 'notify', kind: 'checkbox', label: 'Notify', path: 'form.notify' },
    ], { form: { reason: 'Broken build', env: 'staging', notify: true } }));
    expect(input(text)).toMatchObject({ hostValue: 'Broken build', selectable: false });
    expect(input(select).hostValue).toBe('staging');
    expect(input(radio).hostValue).toBe('staging');
    expect(input(checkbox).hostValue).toBe(true);
    expect(input(text).draftError).toBeUndefined();
  });

  it('a missing path reads as the kind empty value, and an unreadable path adds a draft error', () => {
    const missing = built(v2([
      { id: 'reason', kind: 'text', label: 'Reason', path: 'form.reason' },
      { id: 'env', kind: 'select', label: 'Env', path: 'form.env', options },
      { id: 'mode', kind: 'radio-group', label: 'Mode', path: 'absent.deeper.mode', options },
      { id: 'notify', kind: 'checkbox', label: 'Notify', path: 'notify' },
    ]));
    expect(missing.map(node => input(node).hostValue)).toEqual(['', null, null, false]);
    expect(missing.every(node => input(node).draftError === undefined)).toBe(true);

    const [denied, invalid] = built(v2([
      { id: 'proto', kind: 'text', label: 'Proto', path: 'form.__proto__' },
      { id: 'bad', kind: 'checkbox', label: 'Bad', path: '1.bad path' },
    ]));
    expect(input(denied)).toMatchObject({ hostValue: '' });
    expect(input(denied).draftError).toEqual(expect.stringContaining('form.__proto__'));
    expect(input(invalid)).toMatchObject({ hostValue: false });
    expect(input(invalid).draftError).toEqual(expect.any(String));
  });

  it('a stored value of the wrong type falls back to the empty value with a draft error', () => {
    const [text, select] = built(v2([
      { id: 'reason', kind: 'text', label: 'Reason', path: 'reason' },
      { id: 'env', kind: 'select', label: 'Env', path: 'env', options },
    ], { reason: 42, env: 'not-an-option' }));
    expect(input(text).hostValue).toBe('');
    expect(input(text).draftError).toEqual(expect.stringContaining('expects a string'));
    expect(input(select).hostValue).toBeNull();
    expect(input(select).draftError).toEqual(expect.any(String));
  });

  it('gives two inputs sharing a path the same host value', () => {
    const nodes = built(v2([
      { id: 'card', kind: 'card', children: [{ id: 'first', kind: 'text', label: 'First', path: 'shared.value' }] },
      { id: 'second', kind: 'text', label: 'Second', path: 'shared.value' },
    ], { shared: { value: 'same' } }));
    const first = input((nodes[0] as LayoutNode).children[0]);
    const second = input(nodes[1]);
    expect(first.hostValue).toBe('same');
    expect(second.hostValue).toBe(first.hostValue);
  });

  it('marks a node selectable only when it declares dashboard.select', () => {
    for (const id of SURFACE_ACTIONS) {
      const [stat, table, grid] = built(v2([
        { id: 'stat', kind: 'stat', value: 3, actions: [action('a', id)] },
        { id: 'table', kind: 'table', columns: [{ key: 'k', label: { text: 'K' } }], rows: [[1]], actions: [action('b', id)] },
        { id: 'grid', kind: 'grid', columns: 2, children: [], actions: [action('c', id)] },
      ]));
      const expected = id === 'dashboard.select';
      expect([stat.selectable, table.selectable, grid.selectable]).toEqual([expected, expected, expected]);
    }
    const [plain] = built(v2([{ id: 'plain', kind: 'stat', value: 1 }]));
    expect(plain.selectable).toBe(false);
  });

  it('keeps only surface.submit as a layout submit action; unknown and unsupported ids are dropped', () => {
    const others = SURFACE_ACTIONS.filter(id => id !== 'surface.submit').map((id, index) => action(`other-${index}`, id));
    const unknown = { id: 'shell', action: 'shell.exec', label: { text: 'Run' } } as unknown as SurfaceAction;
    const [section] = built(v2([{ id: 'form', kind: 'section', title: { text: 'Form' }, children: [],
      actions: [...others, unknown, action('send', 'surface.submit')] }]));
    const layout = section as LayoutNode;
    expect(layout.submitActions.map(entry => entry.id)).toEqual(['send']);
    expect(layout.selectable).toBe(true);
  });

  it('maps layouts in spec order with their fields and nested children', () => {
    const [section] = built(v2([{ id: 's', kind: 'section', title: { text: 'S' }, description: { text: 'D' }, children: [
      { id: 'g', kind: 'grid', columns: 3, gap: 'small', children: [{ id: 'x', kind: 'stat', value: 1 }, { id: 'y', kind: 'stat', value: 2 }] },
      { id: 'k', kind: 'stack', direction: 'horizontal', children: [] },
    ] }]));
    const layout = section as LayoutNode;
    expect(layout).toMatchObject({ kind: 'section', title: { text: 'S' }, description: { text: 'D' } });
    expect(layout.children.map(child => child.id)).toEqual(['g', 'k']);
    expect(layout.children[0]).toMatchObject({ kind: 'grid', columns: 3, gap: 'small' });
    expect((layout.children[0] as LayoutNode).children.map(child => child.id)).toEqual(['x', 'y']);
    expect(layout.children[1]).toMatchObject({ kind: 'stack', direction: 'horizontal' });
  });

  it('keeps producer text literal', () => {
    const markup = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const [section] = built(v2([{ id: 's', kind: 'section', title: { text: markup }, children: [
      { id: 't', kind: 'text', label: markup, path: 'v' }] }], { v: markup }));
    expect((section as LayoutNode & { title: { text: string } }).title.text).toBe(markup);
    expect(input((section as LayoutNode).children[0])).toMatchObject({ label: markup, hostValue: markup });
  });

  it('still builds v1 content', () => {
    const spec: DashboardSpecEnvelope = { schemaVersion: 'dashboard-spec/1', catalogVersion: 'dashboard-catalog/1',
      specId: 'spec', revision: 1, generatedAt: '2026-09-25T00:00:00Z', title: { text: 'V1' },
      components: [{ id: 'stat', kind: 'stat', value: 1 }] };
    const result = buildSurfaceViewModel({ contract: 'dashboard-spec/1', spec });
    expect(result.renderFailed).toBe(false);
    expect(result.viewModel?.components.map(node => node.id)).toEqual(['stat']);
  });

  it('never throws: malformed content yields renderFailed and no view model', () => {
    const exotic = new Proxy({}, { get: () => { throw new Error('secret diagnostics'); } });
    const cases: unknown[] = [
      null,
      { contract: 'dashboard-spec/3' },
      { ...v2([]), surface: { ...v2([]).surface, schemaVersion: 'dashboard-spec/1' } },
      { ...v2([]), dataModel: null },
      v2([{ id: 'l', kind: 'stack', children: 'nope' } as unknown as SurfaceComponent]),
      v2([{ id: 'u', kind: 'mystery' } as unknown as SurfaceComponent]),
      v2([{ id: 'list', kind: 'list', items: [null] } as unknown as SurfaceComponent]),
      v2([{ id: 'chart', kind: 'line-chart', series: [{ name: 'a', points: 'nope' }] } as unknown as SurfaceComponent]),
      v2([{ id: 'sel', kind: 'select', label: 'S', path: 'p', options: {} } as unknown as SurfaceComponent]),
      { contract: 'dashboard-spec/2', surface: exotic, dataModel: {} },
    ];
    for (const content of cases) {
      let result: ReturnType<typeof buildSurfaceViewModel> | undefined;
      expect(() => { result = buildSurfaceViewModel(content as SurfaceRenderable); }).not.toThrow();
      expect(result).toMatchObject({ renderFailed: true, viewModel: null });
      expect(result?.renderFailed && result.reason).not.toContain('secret');
    }
  });

  it('bounds the mapped tree: cyclic children stop at maxTreeDepth, oversize trees fail closed', () => {
    const cyclic: { id: string; kind: 'stack'; children: SurfaceComponent[] } = { id: 'loop', kind: 'stack', children: [] };
    cyclic.children.push(cyclic);
    let depth = 0;
    let node: SurfaceNode | undefined = built(v2([cyclic]))[0];
    while (node && 'children' in node && node.children && node.children.length > 0) { depth++; node = node.children[0]; }
    expect(depth).toBeLessThan(10);

    const wide = Array.from({ length: 201 }, (_, index) => ({ id: `s${index}`, kind: 'stat' as const, value: index }));
    expect(buildSurfaceViewModel(v2(wide)).renderFailed).toBe(true);
  });
});
