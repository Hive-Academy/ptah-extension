import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  SURFACE_ACTIONS,
  SURFACE_CATALOG_VERSION,
  SURFACE_CATALOG_VERSION_4,
  type SurfaceAction,
  type SurfaceCatalogVersion,
  type SurfaceComponent,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { SurfaceActionInvoke, SurfaceActionUiState } from '../surface-interaction';
import { buildSurfaceViewModel } from '../view-model/surface-view-model';
import type { LayoutNode } from '../view-model/view-model.types';
import { SURFACE_CONTAINER_BODY_STYLES, SURFACE_CONTAINER_GRID_STYLES, SurfaceLayoutComponent, type SurfaceLayoutWidth } from './surface-layout.component';

const markup = '<img src=x onerror=alert(1)><script>alert(2)</script>';
const submit: SurfaceAction = { id: 'send', action: 'surface.submit', label: { text: 'Submit rollback request' } };

function build(component: SurfaceComponent, catalogVersion: SurfaceCatalogVersion) {
  return buildSurfaceViewModel({ contract: 'dashboard-spec/2', dataModel: {}, surface: {
    schemaVersion: 'dashboard-spec/2', catalogVersion, surfaceId: 's', title: { text: 'T' },
    components: [component] } });
}

/** Builds through the real v2 view model so the layout sees what the renderer will pass it. */
function layout(component: SurfaceComponent, catalogVersion: SurfaceCatalogVersion = SURFACE_CATALOG_VERSION): LayoutNode {
  const result = build(component, catalogVersion);
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
    <div (keydown.escape)="escapesSeen = escapesSeen + 1">
      <ptah-surface-layout [node]="node()" [childTemplate]="childTemplate" surfaceId="surface"
        [actionStates]="states()" [submitDisabled]="disabled()" [layoutWidth]="width()" [expanded]="expanded()"
        (actionInvoke)="invoked.push($event)" (expandedChange)="onExpanded($event)" />
    </div>
  `,
})
class LayoutHostComponent {
  public readonly node = signal<LayoutNode>(layout({ id: 'form', kind: 'card', children: [] }));
  public readonly states = signal<ReadonlyMap<string, SurfaceActionUiState>>(new Map());
  public readonly disabled = signal(false);
  public readonly width = signal<SurfaceLayoutWidth>('viewport');
  /** The parent's `viewState.components[id].expanded`. */
  public readonly expanded = signal<boolean | undefined>(undefined);
  /** When true the host stores each change, as the renderer does. */
  public feedBack = true;
  public escapesSeen = 0;
  public readonly invoked: SurfaceActionInvoke[] = [];
  public readonly expandedChanges: boolean[] = [];
  public onExpanded(expanded: boolean): void {
    this.expandedChanges.push(expanded);
    if (this.feedBack) this.expanded.set(expanded);
  }
}

describe('SurfaceLayoutComponent', () => {
  function setup(component: SurfaceComponent, options: { width?: SurfaceLayoutWidth; catalog?: SurfaceCatalogVersion } = {}) {
    const fixture = TestBed.createComponent(LayoutHostComponent);
    fixture.componentInstance.width.set(options.width ?? 'viewport');
    fixture.componentInstance.node.set(layout(component, options.catalog));
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

  it('uses an own-width responsive body for compact card children only in container mode', () => {
    const component: SurfaceComponent = { id: 'card', kind: 'card', children: [...stats(2), { id: 'agent', kind: 'avatar', name: 'Planner' }] };
    const { element, host, rerender } = setup(component, { width: 'container', catalog: SURFACE_CATALOG_VERSION_4 });
    const body = element.querySelector('.dp-container-body')!;
    expect(body).not.toBeNull();
    expect(body.querySelectorAll('.dp-container-body-child--compact')).toHaveLength(3);
    expect(SURFACE_CONTAINER_BODY_STYLES).toContain('container-type: inline-size');
    expect(SURFACE_CONTAINER_BODY_STYLES).toContain('minmax(min(100%, 8rem), 1fr)');
    host.width.set('viewport'); rerender();
    expect(element.querySelector('.dp-container-body')).toBeNull();
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

  describe('accordion and collapsible section (R4.6, R9.1-R9.4)', () => {
    const accordion = (id = 'acc', title = 'Release checklist'): SurfaceComponent =>
      ({ id, kind: 'accordion', title: { text: title }, children: stats(2) });
    function collapsible(element: HTMLElement) {
      const toggle = element.querySelector<HTMLButtonElement>('button[aria-controls]')!;
      const region = () => element.querySelector<HTMLElement>(`#${toggle.getAttribute('aria-controls')}`)!;
      return { toggle, region };
    }

    it('is a /4 kind: the view model rejects it on a /3 surface', () => {
      const result = build(accordion(), SURFACE_CATALOG_VERSION);
      expect(result.renderFailed).toBe(true);
      expect(result.renderFailed && result.reason).toBe('Surface kind accordion needs dashboard-catalog/4.');
      expect(build(accordion(), SURFACE_CATALOG_VERSION_4).renderFailed).toBe(false);
    });

    it('renders closed by default: a header button with aria-expanded and aria-controls, an inert hidden body', () => {
      const { element } = setup(accordion(), { catalog: SURFACE_CATALOG_VERSION_4 });
      const { toggle, region } = collapsible(element);
      expect(toggle.tagName).toBe('BUTTON');
      expect(toggle.type).toBe('button');
      expect(toggle.closest('h3')).not.toBeNull();
      expect(toggle.textContent?.trim()).toBe('Release checklist');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(region().hasAttribute('inert')).toBe(true);
      expect(region().getAttribute('data-open')).toBe('false');
      // Children stay in the DOM (hidden by inert and visibility), inside the controlled region.
      expect(Array.from(region().querySelectorAll('p.host-child')).map(child => child.textContent)).toEqual(['stat-0', 'stat-1']);
      expect(toggle.getAttribute('data-apps-focus-key')).toBe('surface:acc:toggle');
    });

    it('toggles on activation, reports each change, and keeps focus on the toggle', () => {
      const { element, host, rerender } = setup(accordion(), { catalog: SURFACE_CATALOG_VERSION_4 });
      const { toggle, region } = collapsible(element);
      toggle.focus();
      toggle.click(); rerender();
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(region().hasAttribute('inert')).toBe(false);
      expect(region().getAttribute('data-open')).toBe('true');
      expect(document.activeElement).toBe(toggle);
      toggle.click(); rerender();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(region().hasAttribute('inert')).toBe(true);
      expect(host.expandedChanges).toEqual([true, false]);
    });

    it('toggles even when the parent does not store the state', () => {
      const { element, host, rerender } = setup(accordion(), { catalog: SURFACE_CATALOG_VERSION_4 });
      host.feedBack = false;
      const { toggle } = collapsible(element);
      toggle.click(); rerender();
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(host.expandedChanges).toEqual([true]);
    });

    it('collapses on Escape inside the open body, refocuses the toggle, and stops the key there', () => {
      const { element, host, rerender } = setup(accordion(), { catalog: SURFACE_CATALOG_VERSION_4 });
      const { toggle, region } = collapsible(element);
      toggle.click(); rerender();
      const inside = region().querySelector<HTMLElement>('p.host-child')!;
      inside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); rerender();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(region().hasAttribute('inert')).toBe(true);
      expect(document.activeElement).toBe(toggle);
      expect(host.expandedChanges).toEqual([true, false]);
      expect(host.escapesSeen).toBe(0);
      // Closed: Escape is not consumed and nothing is reported.
      toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); rerender();
      expect(host.expandedChanges).toEqual([true, false]);
      expect(host.escapesSeen).toBe(1);
    });

    it('keeps its expansion across a re-render with the same view state, and follows a changed one', () => {
      const { element, host, rerender } = setup(accordion(), { catalog: SURFACE_CATALOG_VERSION_4 });
      collapsible(element).toggle.click(); rerender();
      expect(host.expanded()).toBe(true);
      // An in-place update: a new node object, same id, new title; the stored state is passed again.
      host.node.set(layout(accordion('acc', 'Release checklist v2'), SURFACE_CATALOG_VERSION_4)); rerender();
      expect(collapsible(element).toggle.textContent?.trim()).toBe('Release checklist v2');
      expect(collapsible(element).toggle.getAttribute('aria-expanded')).toBe('true');
      expect(collapsible(element).region().hasAttribute('inert')).toBe(false);
      // A parent reset (no stored state) falls back to closed.
      host.expanded.set(undefined); rerender();
      expect(collapsible(element).toggle.getAttribute('aria-expanded')).toBe('false');
    });

    it('renders the accordion title literally', () => {
      const { element } = setup(accordion('acc', markup), { catalog: SURFACE_CATALOG_VERSION_4 });
      expect(collapsible(element).toggle.textContent?.trim()).toBe(markup);
      expect(element.querySelector('img, script, style, [style]')).toBeNull();
    });

    it('collapses a section only in container mode, open by default; viewport mode is unchanged', () => {
      const section: SurfaceComponent = { id: 'sec', kind: 'section', title: { text: 'Details' },
        description: { text: 'About this' }, children: stats(1) };
      const viewport = setup(section).element;
      expect(viewport.querySelector('button[aria-controls]')).toBeNull();
      expect(viewport.querySelector('section > h3')?.textContent).toBe('Details');

      const { element, host, rerender } = setup(section, { width: 'container' });
      const { toggle, region } = collapsible(element);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(toggle.textContent).toContain('Details');
      expect(toggle.textContent).toContain('About this');
      expect(region().hasAttribute('inert')).toBe(false);
      toggle.click(); rerender();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(region().hasAttribute('inert')).toBe(true);
      expect(host.expandedChanges).toEqual([false]);
    });
  });

  describe('container layout (D9, R3.5)', () => {
    const gridOf = (element: HTMLElement) => element.querySelector('p.host-child')!.parentElement!;

    it('uses the container grid with the column ceiling and the stat variant, never the viewport sm: classes', () => {
      const { element, host, rerender } = setup({ id: 'g', kind: 'grid', columns: 4, children: stats(3) }, { width: 'container' });
      const classes = () => Array.from(gridOf(element).classList);
      expect(classes()).toEqual(expect.arrayContaining(['dp-grid', 'dp-cols-4', 'dp-gap-medium', 'dp-grid--stats']));
      expect(classes().some(name => name.startsWith('sm:') || name.startsWith('grid-cols'))).toBe(false);

      host.node.set({ ...layout({ id: 'g', kind: 'grid', columns: 2, gap: 'small', children: stats(1) }), columns: 9 } as LayoutNode);
      rerender();
      expect(classes()).toEqual(expect.arrayContaining(['dp-cols-4', 'dp-gap-small']));

      const mixed: SurfaceComponent = { id: 'g', kind: 'grid', columns: 2, children: [
        ...stats(1), { id: 'note', kind: 'alert', tone: 'info', text: { text: 'n' } }] };
      host.node.set(layout(mixed)); rerender();
      expect(classes()).toEqual(expect.arrayContaining(['dp-grid', 'dp-cols-2']));
      expect(classes()).not.toContain('dp-grid--stats');
    });

    it('keeps the viewport grid classes by default', () => {
      const { element } = setup({ id: 'g', kind: 'grid', columns: 3, children: stats(2) });
      expect(Array.from(gridOf(element).classList)).toEqual(expect.arrayContaining(['grid', 'grid-cols-1', 'sm:grid-cols-3']));
      expect(gridOf(element).classList.contains('dp-grid')).toBe(false);
    });

    it('lays out a container stack by direction without a viewport breakpoint', () => {
      const { element } = setup({ id: 'k', kind: 'stack', direction: 'horizontal', gap: 'large', children: stats(2) },
        { width: 'container' });
      expect(Array.from(gridOf(element).classList)).toEqual(expect.arrayContaining(['flex', 'flex-row', 'flex-wrap', 'gap-6']));
    });

    it('defines one column below 360 px, a 128 px auto-fit capped by columns above, and 3 stat columns from 700 px', () => {
      const css = SURFACE_CONTAINER_GRID_STYLES.replace(/\s+/g, ' ');
      expect(css).toContain('.dp-grid { display: grid; grid-template-columns: minmax(0, 1fr);');
      expect(css).toContain('@container dp (min-width: 360px)');
      expect(css).toContain('repeat(auto-fit, minmax(min(100%, max(128px, calc((100% - (var(--dp-cols) - 1) * var(--dp-gap)) / var(--dp-cols)))), 1fr))');
      expect(css).toContain('@container dp (min-width: 700px)');
      expect(css).toContain('.dp-grid--stats.dp-cols-3, .dp-grid--stats.dp-cols-4 { grid-template-columns: repeat(3, minmax(0, 1fr)); }');
      // jsdom has no layout and the Jest transform strips component styles: assert the rules are attached in
      // source, to the layout and to the renderer root (which is the `dp` container); V1 is the visual check.
      const layoutSource = readFileSync(join(__dirname, 'surface-layout.component.ts'), 'utf8');
      expect(layoutSource).toMatch(/styles: \[SURFACE_CONTAINER_GRID_STYLES, SURFACE_CONTAINER_BODY_STYLES, COLLAPSE_STYLES\]/);
      const rendererSource = readFileSync(join(__dirname, 'surface-renderer.component.ts'), 'utf8');
      expect(rendererSource).toMatch(/styles: \[DISPLAY_TOKEN_STYLES, SURFACE_CONTAINER_GRID_STYLES\]/);
      expect(rendererSource).toContain(':host(.dp-root) { display: block; min-width: 0; container-type: inline-size; container-name: dp; }');
    });
  });
});
