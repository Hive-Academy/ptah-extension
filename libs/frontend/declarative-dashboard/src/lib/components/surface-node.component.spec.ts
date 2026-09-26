import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { DashboardComponent } from '@ptah-extension/shared';
import type { SurfaceComponent, SurfaceDataModel, SurfaceSelection } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { SurfaceActionInvoke, SurfaceInputCommit } from '../surface-interaction';
import { buildSurfaceViewModel } from '../view-model/surface-view-model';
import type { SurfaceNode } from '../view-model/view-model.types';
import { SURFACE_NODE_KINDS, SurfaceNodeComponent, type SurfaceComponentViewStateWrite } from './surface-node.component';
import type { SurfaceDraftWrite } from './surface-text-input.component';

function v2Nodes(components: readonly SurfaceComponent[], dataModel: SurfaceDataModel = {}): readonly SurfaceNode[] {
  const result = buildSurfaceViewModel({ contract: 'dashboard-spec/2', dataModel, surface: {
    schemaVersion: 'dashboard-spec/2', catalogVersion: 'dashboard-catalog/2', surfaceId: 's', title: { text: 'T' },
    components } });
  if (result.renderFailed) throw new Error(result.reason);
  return result.viewModel.components;
}

function v1Nodes(components: readonly DashboardComponent[]): readonly SurfaceNode[] {
  const result = buildSurfaceViewModel({ contract: 'dashboard-spec/1', spec: { schemaVersion: 'dashboard-spec/1',
    catalogVersion: 'dashboard-catalog/1', specId: 'spec', revision: 1, generatedAt: '2026-09-25T00:00:00Z',
    title: { text: 'T' }, components } });
  if (result.renderFailed) throw new Error(result.reason);
  return result.viewModel.components;
}

const series = [{ name: 'Cost', points: [{ x: 'Mon', y: 1 }, { x: 'Tue', y: 2 }] }];
/** One component of each of the 13 kinds, and the element each must render. */
const EVERY_KIND: readonly (readonly [SurfaceComponent, string])[] = [
  [{ id: 'k-section', kind: 'section', title: { text: 'S' }, children: [] }, 'ptah-surface-layout section'],
  [{ id: 'k-stack', kind: 'stack', children: [] }, 'ptah-surface-layout'],
  [{ id: 'k-grid', kind: 'grid', columns: 2, children: [] }, 'ptah-surface-layout'],
  [{ id: 'k-card', kind: 'card', children: [] }, 'ptah-surface-layout .card'],
  [{ id: 'k-text', kind: 'text', label: 'T', path: 'a' }, 'ptah-surface-text-input input'],
  [{ id: 'k-select', kind: 'select', label: 'S', path: 'b', options: [{ value: 'x', label: 'X' }] }, 'ptah-surface-choice-input select'],
  [{ id: 'k-radio', kind: 'radio-group', label: 'R', path: 'c', options: [{ value: 'x', label: 'X' }] }, 'ptah-surface-choice-input fieldset'],
  [{ id: 'k-checkbox', kind: 'checkbox', label: 'C', path: 'd' }, 'ptah-surface-checkbox-input input[type=checkbox]'],
  [{ id: 'k-stat', kind: 'stat', value: 1 }, 'ptah-dashboard-stat'],
  [{ id: 'k-table', kind: 'table', columns: [{ key: 'a', label: { text: 'A' } }], rows: [] }, 'ptah-dashboard-table table'],
  [{ id: 'k-list', kind: 'list', items: [] }, 'ptah-dashboard-list'],
  [{ id: 'k-line', kind: 'line-chart', series }, 'ptah-dashboard-chart polyline'],
  [{ id: 'k-bar', kind: 'bar-chart', series }, 'ptah-dashboard-chart rect'],
];

@Component({
  standalone: true,
  imports: [SurfaceNodeComponent],
  template: `
    <ptah-surface-node [node]="node()" surfaceId="surface"
      (componentViewStateChange)="events.push(['state', $event])" (selectionChange)="events.push(['select', $event])"
      (inputCommit)="events.push(['commit', $event])" (draftChange)="events.push(['draft', $event])"
      (actionInvoke)="events.push(['action', $event])" (renderFailed)="failures = failures + 1" />
  `,
})
class NodeHostComponent {
  public readonly node = signal<SurfaceNode>(v2Nodes([{ id: 'stat', kind: 'stat', value: 1 }])[0]);
  public readonly events: [string, SurfaceComponentViewStateWrite | SurfaceSelection | SurfaceInputCommit
    | SurfaceDraftWrite | SurfaceActionInvoke][] = [];
  public failures = 0;
}

describe('SurfaceNodeComponent', () => {
  function setup(node: SurfaceNode) {
    const fixture = TestBed.createComponent(NodeHostComponent);
    fixture.componentInstance.node.set(node);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    return { fixture, host: fixture.componentInstance, element, rerender: () => fixture.detectChanges() };
  }

  it('switches over all 13 catalog kinds, each to its own component', () => {
    expect(SURFACE_NODE_KINDS.size).toBe(13);
    expect(new Set(EVERY_KIND.map(([component]) => component.kind))).toEqual(SURFACE_NODE_KINDS);
    for (const [component, selector] of EVERY_KIND) {
      const { element, host } = setup(v2Nodes([component])[0]);
      expect(element.querySelector(selector)).not.toBeNull();
      expect(host.failures).toBe(0);
    }
  });

  it('renders nothing for an unknown kind and emits renderFailed', () => {
    const unknown = { id: 'x', kind: 'iframe', selectable: false } as unknown as SurfaceNode;
    const { element, host } = setup(unknown);
    expect(element.querySelector('ptah-surface-node')?.children).toHaveLength(0);
    expect(element.querySelector('ptah-surface-node')?.textContent?.trim()).toBe('');
    expect(host.failures).toBe(1);
  });

  it('composes the layout with itself as the child template, recursively, in spec order (R5)', () => {
    const [grid] = v2Nodes([{ id: 'outer', kind: 'grid', columns: 2, children: [
      { id: 'inner', kind: 'card', title: { text: 'Inner' }, children: [{ id: 'deep', kind: 'stat', title: { text: 'Deep' }, value: 1 }] },
      { id: 'second', kind: 'stat', title: { text: 'Second' }, value: 2 },
    ] }]);
    const { element } = setup(grid);
    expect(Array.from(element.querySelectorAll('ptah-dashboard-stat h3')).map(h3 => h3.textContent)).toEqual(['Deep', 'Second']);
    expect(element.querySelectorAll('ptah-surface-node')).toHaveLength(4);
    const layout = readFileSync(join(__dirname, 'surface-layout.component.ts'), 'utf8');
    const node = readFileSync(join(__dirname, 'surface-node.component.ts'), 'utf8');
    expect(layout).not.toMatch(/SurfaceNodeComponent|surface-node/);
    expect(node).toMatch(/from '\.\/surface-layout\.component'/);
  });

  it('renders every child when ids repeat, and a new view when a position swaps to another id', () => {
    const [stack] = v2Nodes([{ id: 'stack', kind: 'stack', children: [
      { id: 'dup', kind: 'stat', title: { text: 'First' }, value: 1 },
      { id: 'dup', kind: 'stat', title: { text: 'Second' }, value: 2 },
    ] }]);
    const { element, host, rerender } = setup(stack);
    expect(Array.from(element.querySelectorAll('ptah-dashboard-stat h3')).map(h3 => h3.textContent)).toEqual(['First', 'Second']);
    const first = element.querySelector('ptah-dashboard-stat');
    host.node.set(v2Nodes([{ id: 'stack', kind: 'stack', children: [
      { id: 'other', kind: 'stat', title: { text: 'Swapped' }, value: 1 },
      { id: 'dup', kind: 'stat', title: { text: 'Second' }, value: 2 },
    ] }])[0]); rerender();
    expect(Array.from(element.querySelectorAll('ptah-dashboard-stat h3')).map(h3 => h3.textContent)).toEqual(['Swapped', 'Second']);
    expect(element.querySelector('ptah-dashboard-stat')).not.toBe(first);
  });

  it('renders v1 display children inside stat and list, and below table and chart', () => {
    const child = (id: string): DashboardComponent => ({ id, kind: 'stat', title: { text: id }, value: 1 });
    const [stat, table, list, chart] = v1Nodes([
      { id: 's', kind: 'stat', value: 1, children: [child('in-stat')] },
      { id: 't', kind: 'table', columns: [{ key: 'a', label: { text: 'A' } }], rows: [], children: [child('under-table')] },
      { id: 'l', kind: 'list', items: [], children: [child('in-list')] },
      { id: 'c', kind: 'line-chart', series, children: [child('under-chart')] },
    ]);
    const titles = (element: HTMLElement, selector: string) =>
      Array.from(element.querySelectorAll(selector)).map(h3 => h3.textContent);
    expect(titles(setup(stat).element, 'ptah-dashboard-stat ptah-dashboard-stat h3')).toEqual(['in-stat']);
    expect(titles(setup(list).element, 'ptah-dashboard-list ptah-dashboard-stat h3')).toEqual(['in-list']);
    const tableView = setup(table).element;
    expect(tableView.querySelector('ptah-dashboard-table ptah-dashboard-stat')).toBeNull();
    expect(titles(tableView, 'ptah-dashboard-table ~ div ptah-dashboard-stat h3')).toEqual(['under-table']);
    expect(titles(setup(chart).element, 'ptah-dashboard-chart ~ div ptah-dashboard-stat h3')).toEqual(['under-chart']);
  });

  it('forwards every child output unchanged, with the component id on presentation writes', () => {
    const [card] = v2Nodes([{ id: 'form', kind: 'card', actions: [{ id: 'send', action: 'surface.submit', label: { text: 'Send' } }],
      children: [
        { id: 'reason', kind: 'text', label: 'Reason', path: 'form.reason' },
        { id: 'notify', kind: 'checkbox', label: 'Notify', path: 'form.notify' },
        { id: 'tile', kind: 'stat', value: 3, actions: [{ id: 'pick', action: 'dashboard.select', label: { text: 'Pick' } }] },
      ] }]);
    const { element, host } = setup(card);
    const input = element.querySelector<HTMLInputElement>('input[type=text]')!;
    input.value = 'Hi'; input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    element.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
    element.querySelector<HTMLButtonElement>('[data-apps-focus-key="surface:tile:expand"]')!.click();
    element.querySelector<HTMLButtonElement>('[data-apps-focus-key="surface:tile:select"]')!.click();
    element.querySelector<HTMLButtonElement>('[data-apps-focus-key="surface:form:action-send"]')!.click();
    expect(host.events).toEqual([
      ['draft', { componentId: 'reason', value: 'Hi' }],
      ['commit', { componentId: 'reason', value: 'Hi' }],
      ['draft', { componentId: 'reason', value: undefined }],
      ['commit', { componentId: 'notify', value: true }],
      ['state', { componentId: 'tile', state: { expanded: true } }],
      ['select', { componentId: 'tile', target: { kind: 'stat' } }],
      ['action', { actionId: 'send' }],
    ]);
  });
});
