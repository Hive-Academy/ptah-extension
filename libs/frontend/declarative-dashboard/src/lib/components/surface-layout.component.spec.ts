import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SURFACE_ACTIONS, type SurfaceAction, type SurfaceComponent } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { SurfaceActionInvoke, SurfaceActionUiState } from '../surface-interaction';
import { buildSurfaceViewModel } from '../view-model/surface-view-model';
import type { LayoutNode } from '../view-model/view-model.types';
import { SurfaceLayoutComponent } from './surface-layout.component';

const markup = '<img src=x onerror=alert(1)><script>alert(2)</script>';
const submit: SurfaceAction = { id: 'send', action: 'surface.submit', label: { text: 'Submit rollback request' } };

/** Builds through the real v2 view model so the layout sees what the renderer will pass it. */
function layout(component: SurfaceComponent): LayoutNode {
  const result = buildSurfaceViewModel({ contract: 'dashboard-spec/2', dataModel: {}, surface: {
    schemaVersion: 'dashboard-spec/2', catalogVersion: 'dashboard-catalog/2', surfaceId: 's', title: { text: 'T' },
    components: [component] } });
  if (result.renderFailed) throw new Error(result.reason);
  return result.viewModel.components[0] as LayoutNode;
}

/** The host supplies the child template, as the recursive node component will (R5). */
@Component({
  standalone: true,
  imports: [SurfaceLayoutComponent],
  template: `
    <ng-template #childTemplate let-child let-index="index">
      <p class="host-child" [attr.data-index]="index">{{ child.id }}</p>
    </ng-template>
    <ptah-surface-layout [node]="node()" [childTemplate]="childTemplate" surfaceId="surface"
      [actionStates]="states()" [submitDisabled]="disabled()" (actionInvoke)="invoked.push($event)" />
  `,
})
class LayoutHostComponent {
  public readonly node = signal<LayoutNode>(layout({ id: 'form', kind: 'card', children: [] }));
  public readonly states = signal<ReadonlyMap<string, SurfaceActionUiState>>(new Map());
  public readonly disabled = signal(false);
  public readonly invoked: SurfaceActionInvoke[] = [];
}

describe('SurfaceLayoutComponent', () => {
  function setup(component: SurfaceComponent) {
    const fixture = TestBed.createComponent(LayoutHostComponent);
    fixture.componentInstance.node.set(layout(component));
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    const rerender = () => fixture.detectChanges();
    return { fixture, host: fixture.componentInstance, element, rerender };
  }
  const stats = (count: number): SurfaceComponent[] =>
    Array.from({ length: count }, (_, index) => ({ id: `stat-${index}`, kind: 'stat', value: index }));

  it('projects children through the host template in spec order, without importing SurfaceNodeComponent', () => {
    const { element } = setup({ id: 'grid', kind: 'grid', columns: 2, children: stats(3) });
    const children = Array.from(element.querySelectorAll('p.host-child'));
    expect(children.map(child => child.textContent)).toEqual(['stat-0', 'stat-1', 'stat-2']);
    expect(children.map(child => child.getAttribute('data-index'))).toEqual(['0', '1', '2']);
    const source = readFileSync(join(__dirname, 'surface-layout.component.ts'), 'utf8');
    expect(source).not.toMatch(/SurfaceNodeComponent|surface-node/);
    expect(element.querySelector('ptah-surface-node')).toBeNull();
  });

  it('renders a section with an h3 title and description, and a bordered card', () => {
    const { element, host, rerender } = setup({ id: 's', kind: 'section', title: { text: 'Details' },
      description: { text: 'About this' }, children: stats(1) });
    expect(element.querySelector('section > h3')?.textContent).toBe('Details');
    expect(element.querySelector('section > p')?.textContent).toBe('About this');
    host.node.set(layout({ id: 'c', kind: 'card', title: { text: 'Card' }, children: stats(1) })); rerender();
    const card = element.querySelector('.card')!;
    expect(card.classList.contains('card-bordered')).toBe(true);
    expect(card.querySelector('h3')?.textContent).toBe('Card');
    host.node.set(layout({ id: 'c2', kind: 'card', children: stats(1) })); rerender();
    expect(element.querySelector('.card h3')).toBeNull();
  });

  it('caps the grid at four columns and collapses to one column below sm', () => {
    const { element, host, rerender } = setup({ id: 'g', kind: 'grid', columns: 3, gap: 'small', children: stats(2) });
    const grid = () => element.querySelector('p.host-child')!.parentElement!;
    expect(Array.from(grid().classList)).toEqual(expect.arrayContaining(['grid', 'grid-cols-1', 'sm:grid-cols-3', 'gap-2']));
    host.node.set({ ...layout({ id: 'g', kind: 'grid', columns: 4, children: stats(2) }), columns: 9 } as LayoutNode); rerender();
    expect(grid().classList.contains('sm:grid-cols-4')).toBe(true);
    expect(grid().classList.contains('grid-cols-1')).toBe(true);
    expect(Array.from(grid().classList).some(name => /grid-cols-(?:[5-9]|\d{2})/.test(name))).toBe(false);
    host.node.set({ ...layout({ id: 'g', kind: 'grid', columns: 1, children: stats(2) }), columns: Number.NaN } as LayoutNode); rerender();
    expect(grid().classList.contains('sm:grid-cols-1')).toBe(true);
  });

  it('lays out a stack by direction with the gap enum', () => {
    const { element, host, rerender } = setup({ id: 'k', kind: 'stack', children: stats(2) });
    const stack = () => element.querySelector('p.host-child')!.parentElement!;
    expect(Array.from(stack().classList)).toEqual(expect.arrayContaining(['flex', 'flex-col', 'gap-4']));
    host.node.set(layout({ id: 'k', kind: 'stack', direction: 'horizontal', gap: 'large', children: stats(2) })); rerender();
    expect(Array.from(stack().classList)).toEqual(expect.arrayContaining(['flex', 'flex-row', 'gap-6']));
    host.node.set(layout({ id: 'k', kind: 'stack', gap: 'none', children: stats(2) })); rerender();
    expect(stack().classList.contains('gap-0')).toBe(true);
  });

  it('renders surface.submit as btn btn-primary btn-sm, disabled while pending with the state text in role=status', () => {
    const { element, host, rerender } = setup({ id: 'form', kind: 'section', title: { text: 'Form' }, children: [], actions: [submit] });
    const button = () => element.querySelector<HTMLButtonElement>('[data-apps-focus-key="surface:form:action-send"]')!;
    const status = () => element.querySelector(`#${button().getAttribute('aria-describedby')}`)!;
    expect(Array.from(button().classList)).toEqual(['btn', 'btn-primary', 'btn-sm']);
    expect(button().type).toBe('button');
    expect(button().textContent).toBe('Submit rollback request');
    expect(status().getAttribute('role')).toBe('status');
    expect(status().textContent).toBe('');
    button().click();
    expect(host.invoked).toEqual([{ actionId: 'send' }]);

    host.states.set(new Map([['send', { status: 'pending' }]])); rerender();
    expect(button().disabled).toBe(true);
    expect(status().textContent).toBe('Sending…');
    button().click();
    expect(host.invoked).toHaveLength(1);

    host.states.set(new Map([['send', { status: 'applied' }]])); rerender();
    expect(status().textContent).toBe('Sent');
    expect(status().classList.contains('text-success')).toBe(true);
    expect(status().classList.contains('text-base-content')).toBe(false);

    host.states.set(new Map([['send', { status: 'rejected', reason: 'busy' }]])); rerender();
    expect(button().disabled).toBe(false);
    expect(status().textContent).toBe('The agent is busy; try again when it finishes.');
    // A rejection is never colored text (prototype proposal b).
    expect(status().classList.contains('text-base-content')).toBe(true);
    expect(status().classList.contains('text-success')).toBe(false);
    host.states.set(new Map([['send', { status: 'rejected', reason: 'invalid-value', detail: markup }]])); rerender();
    expect(status().textContent).toBe(markup);

    host.states.set(new Map([['send', { status: 'indeterminate' }]])); host.disabled.set(true); rerender();
    expect(button().disabled).toBe(true);
    expect(status().textContent).toBe('May have been sent - do not resend.');
  });

  it('renders no control for unknown or unsupported actions', () => {
    const others: SurfaceAction[] = SURFACE_ACTIONS.filter(action => action !== 'surface.submit')
      .map((action, index) => ({ id: `other-${index}`, action, label: { text: `Other ${index}` } }));
    const unknown = { id: 'shell', action: 'shell.exec', label: { text: 'Run shell' } } as unknown as SurfaceAction;
    const { element, host, rerender } = setup({ id: 'form', kind: 'card', children: [], actions: [...others, unknown, submit] });
    expect(Array.from(element.querySelectorAll('button')).map(button => button.textContent)).toEqual(['Submit rollback request']);
    // Even a node that skipped the view model cannot turn another id into a button.
    host.node.set({ ...host.node(), submitActions: [...others, unknown] }); rerender();
    expect(element.querySelectorAll('button')).toHaveLength(0);
  });

  it('renders producer text literally, with no style in the DOM', () => {
    const { element } = setup({ id: 's', kind: 'section', title: { text: markup }, description: { text: markup },
      children: stats(1), actions: [{ ...submit, label: { text: markup } }] });
    expect(element.querySelector('h3')?.textContent).toBe(markup);
    expect(element.querySelector('section > p')?.textContent).toBe(markup);
    expect(element.querySelector('button')?.textContent).toBe(markup);
    expect(element.querySelector('img, script, style, [style]')).toBeNull();
  });

  it('uses unique status ids across two instances', () => {
    const component: SurfaceComponent = { id: 'form', kind: 'card', children: [], actions: [submit] };
    const ids = [setup(component), setup(component)].map(({ element }) => {
      const button = element.querySelector('button')!;
      const id = button.getAttribute('aria-describedby')!;
      expect(element.querySelector(`#${id}`)?.getAttribute('role')).toBe('status');
      return id;
    });
    expect(ids[0]).not.toBe(ids[1]);
  });
});
