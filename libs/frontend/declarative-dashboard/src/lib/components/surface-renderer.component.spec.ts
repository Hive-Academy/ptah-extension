import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  SURFACE_LIMITS,
  type SurfaceComponent,
  type SurfaceDataModel,
  type SurfaceSelection,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { SurfaceInputCommit, SurfaceInteractionState } from '../surface-interaction';
import type { SurfaceRenderable, SurfaceViewState } from '../surface-view-state';
import { buildSurfaceViewModel } from '../view-model/surface-view-model';
import { SURFACE_TEXT_COMMIT_DEBOUNCE_MS } from './surface-text-input.component';
import {
  SURFACE_VIEW_MODEL_BUILDER,
  SurfaceRendererComponent,
  type SurfaceViewModelBuilder,
} from './surface-renderer.component';

function surface(components: readonly SurfaceComponent[], dataModel: SurfaceDataModel = {}): SurfaceRenderable {
  return { contract: 'dashboard-spec/2', dataModel, surface: { schemaVersion: 'dashboard-spec/2',
    catalogVersion: 'dashboard-catalog/2', surfaceId: 'surface', title: { text: 'Rollback request' },
    description: { text: 'Roll back the last deploy.' }, components } };
}
function interactionOf(patch: Partial<SurfaceInteractionState> = {}): SurfaceInteractionState {
  return { selection: null, selectionUnsynced: false, pendingValues: new Map(), issues: new Map(), actions: new Map(),
    submitDisabled: false, ...patch };
}

const reason: SurfaceComponent = { id: 'reason', kind: 'text', label: 'Reason', path: 'form.reason' };
const submit = { id: 'send', action: 'surface.submit' as const, label: { text: 'Submit' } };
const form = (children: readonly SurfaceComponent[] = [reason]) =>
  surface([{ id: 'form', kind: 'section', title: { text: 'Form' }, actions: [submit], children }]);
const TOO_LONG = 'x'.repeat(SURFACE_LIMITS.maxStringLength + 1);

const HOST_TEMPLATE = `
  <ptah-surface-renderer [renderable]="renderable()" [viewState]="viewState()" [interaction]="interaction()"
    (viewStateChange)="onViewState($event)" (inputCommit)="log.push(['commit', $event])"
    (actionInvoke)="log.push(['action', $event.actionId])" (selectionChange)="log.push(['select', $event])"
    (renderFailed)="failures = failures + 1" />
`;

@Component({ standalone: true, imports: [SurfaceRendererComponent], template: HOST_TEMPLATE })
class RendererHostComponent {
  public readonly renderable = signal<SurfaceRenderable>(form());
  public readonly viewState = signal<SurfaceViewState>({ components: {}, drafts: {} });
  public readonly interaction = signal<SurfaceInteractionState>(interactionOf());
  /** `true`: apply every emitted view state at once, as the Apps page does. */
  public feedBack = true;
  public readonly emitted: SurfaceViewState[] = [];
  public readonly log: [string, SurfaceInputCommit | SurfaceSelection | string | null][] = [];
  public failures = 0;
  public onViewState(state: SurfaceViewState): void {
    this.emitted.push(state);
    if (this.feedBack) this.viewState.set(state);
  }
}

const throwingBuilder: SurfaceViewModelBuilder = () => { throw new Error('builder exploded'); };

@Component({ standalone: true, imports: [SurfaceRendererComponent], template: HOST_TEMPLATE,
  providers: [{ provide: SURFACE_VIEW_MODEL_BUILDER, useValue: throwingBuilder }] })
class ThrowingBuilderHostComponent extends RendererHostComponent {}

describe('SurfaceRendererComponent', () => {
  function setup(renderable: SurfaceRenderable = form(), hostType: typeof RendererHostComponent = RendererHostComponent) {
    const fixture: ComponentFixture<RendererHostComponent> = TestBed.createComponent(hostType);
    fixture.componentInstance.renderable.set(renderable);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    const renderer = fixture.debugElement.query(By.directive(SurfaceRendererComponent)).componentInstance as SurfaceRendererComponent;
    const rerender = () => fixture.detectChanges();
    const text = () => element.querySelector<HTMLInputElement>('input[type=text]')!;
    const type = (value: string, render = true) => {
      text().value = value;
      text().dispatchEvent(new Event('input'));
      if (render) rerender();
    };
    const blur = () => { text().dispatchEvent(new Event('blur')); rerender(); };
    const commits = () => fixture.componentInstance.log.filter(([kind]) => kind === 'commit').map(([, value]) => value);
    return { fixture, host: fixture.componentInstance, element, renderer, rerender, text, type, blur, commits };
  }

  it('builds through the root default builder and renders title, description and components', () => {
    expect(TestBed.inject(SURFACE_VIEW_MODEL_BUILDER)).toBe(buildSurfaceViewModel);
    const { element, host } = setup();
    expect(element.querySelector('h2')?.textContent).toBe('Rollback request');
    expect(element.querySelector('header p')?.textContent).toBe('Roll back the last deploy.');
    expect(element.querySelector('section h3')?.textContent).toBe('Form');
    expect(element.querySelector('[data-apps-focus-key="surface:reason:input"]')).not.toBeNull();
    expect(host.failures).toBe(0);
  });

  it('renders a v1 spec with its specId in focus keys', () => {
    const { element, host } = setup({ contract: 'dashboard-spec/1', spec: { schemaVersion: 'dashboard-spec/1',
      catalogVersion: 'dashboard-catalog/1', specId: 'spec-1', revision: 1, generatedAt: '2026-09-25T00:00:00Z',
      title: { text: 'Costs' }, components: [{ id: 'tile', kind: 'stat', value: 3 }] } });
    expect(element.querySelector('h2')?.textContent).toBe('Costs');
    expect(element.querySelector('[data-apps-focus-key="spec-1:tile:expand"]')).not.toBeNull();
    expect(host.failures).toBe(0);
  });

  it('renders the same empty subtree and one renderFailed for a throwing override and a default renderFailed build', () => {
    const invalid = { ...form(), surface: { ...(form() as Extract<SurfaceRenderable, { contract: 'dashboard-spec/2' }>).surface,
      title: 'not rich text' } } as unknown as SurfaceRenderable;
    expect(buildSurfaceViewModel(invalid).renderFailed).toBe(true);
    const byDefault = setup(invalid);
    const byThrow = setup(form(), ThrowingBuilderHostComponent);
    const content = (element: HTMLElement) => element.querySelector('ptah-surface-renderer')!;
    expect(content(byDefault.element).children).toHaveLength(0);
    expect(content(byDefault.element).textContent).toBe('');
    expect(content(byThrow.element).innerHTML).toBe(content(byDefault.element).innerHTML);
    expect(byDefault.host.failures).toBe(1);
    expect(byThrow.host.failures).toBe(1);
    // Each new failing renderable is reported once more; a re-render alone is not.
    byDefault.rerender(); byThrow.rerender();
    expect([byDefault.host.failures, byThrow.host.failures]).toEqual([1, 1]);
    byDefault.host.renderable.set({ ...invalid }); byThrow.host.renderable.set(form([]));
    byDefault.rerender(); byThrow.rerender();
    expect([byDefault.host.failures, byThrow.host.failures]).toEqual([2, 2]);
    expect(content(byThrow.element).innerHTML).toBe(content(byDefault.element).innerHTML);
  });

  it('treats a builder result that is not a successful build as a render failure', () => {
    TestBed.overrideProvider(SURFACE_VIEW_MODEL_BUILDER, { useValue: () => ({ renderFailed: false, viewModel: null }) });
    const { element, host } = setup();
    expect(element.querySelector('ptah-surface-renderer')?.children).toHaveLength(0);
    expect(host.failures).toBe(1);
  });

  describe('a non-throwing override that returns a malformed node', () => {
    const cyclic: Record<string, unknown> = { id: 'loop', kind: 'stack', selectable: false, submitActions: [] };
    cyclic['children'] = [cyclic];
    const stack = (children: unknown) => ({ id: 's', kind: 'stack', selectable: false, submitActions: [], children });
    it.each<[string, unknown[]]>([
      ['a null node', [null]],
      ['an unknown kind', [{ id: 'x', kind: 'iframe', selectable: false }]],
      ['a missing id', [{ kind: 'stat', value: 1, selectable: false }]],
      ['a missing selectable flag', [{ id: 'x', kind: 'stat', value: 1 }]],
      ['a text input without a path', [{ id: 'r', kind: 'text', label: 'R', selectable: false, hostValue: '' }]],
      ['an input without a host value', [{ id: 'r', kind: 'checkbox', label: 'R', path: 'p', selectable: false }]],
      ['a select with malformed options', [{ id: 'e', kind: 'select', label: 'E', path: 'p', selectable: false,
        hostValue: '', options: [null] }]],
      ['a layout without children', [{ id: 's', kind: 'stack', selectable: false, submitActions: [] }]],
      ['a layout without submit actions', [{ id: 's', kind: 'stack', selectable: false, children: [] }]],
      ['a malformed nested child', [stack([{ kind: 'stat' }])]],
      ['v1 display children that are not an array', [{ id: 't', kind: 'stat', value: 1, selectable: false, children: {} }]],
      ['a node that is its own descendant', [cyclic]],
    ])('renders nothing and reports renderFailed for %s', (_name, components) => {
      TestBed.overrideProvider(SURFACE_VIEW_MODEL_BUILDER, {
        useValue: () => ({ renderFailed: false, viewModel: { title: { text: 'Override' }, components } }),
      });
      const { element, host } = setup(form());
      expect(element.querySelector('ptah-surface-renderer')?.children).toHaveLength(0);
      expect(host.failures).toBe(1);
    });

    it('still renders a well-formed override result, including a submit that flushes its draft', () => {
      TestBed.overrideProvider(SURFACE_VIEW_MODEL_BUILDER, { useValue: (renderable: SurfaceRenderable) =>
        buildSurfaceViewModel(renderable) });
      const { element, host, type } = setup(form());
      expect(host.failures).toBe(0);
      type('fine');
      element.querySelector<HTMLButtonElement>('[data-apps-focus-key="surface:form:action-send"]')!.click();
      expect(host.log).toEqual([['commit', { componentId: 'reason', value: 'fine' }], ['action', 'send']]);
    });
  });

  it('writes every draft into its working copy synchronously, even when the parent never feeds it back', () => {
    const { host, renderer, text, type, blur, commits } = setup();
    host.feedBack = false;
    type('R', false);
    expect(renderer.state().drafts).toEqual({ reason: 'R' });
    expect(host.emitted.at(-1)?.drafts).toEqual({ reason: 'R' });
    type('Ro');
    expect(text().value).toBe('Ro');
    blur();
    expect(commits()).toEqual([{ componentId: 'reason', value: 'Ro' }]);
    expect(renderer.state().drafts).toEqual({});
    expect(host.emitted.at(-1)?.drafts).toEqual({});
  });

  it('treats an older emitted view state the parent passes back as authoritative, never as a stale echo', () => {
    const { host, renderer, text, type, blur, commits, rerender } = setup();
    host.feedBack = false;
    type('a'); type('ab');
    host.viewState.set(host.emitted[0]); rerender();
    expect(renderer.state()).toBe(host.emitted[0]);
    expect(renderer.state().drafts).toEqual({ reason: 'a' });
    expect(text().value).toBe('a');
    blur();
    expect(commits()).toEqual([{ componentId: 'reason', value: 'a' }]);
    // A view state the parent made itself still replaces the working copy.
    host.viewState.set({ components: {}, drafts: { reason: 'from parent' } }); rerender();
    expect(text().value).toBe('from parent');
  });

  describe('the parent view state is what renders', () => {
    const fresh = (): SurfaceViewState => ({ components: {}, drafts: {} });
    const withId = (surfaceId: string, renderable: SurfaceRenderable = form()): SurfaceRenderable => {
      const v2 = renderable as Extract<SurfaceRenderable, { contract: 'dashboard-spec/2' }>;
      return { ...v2, surface: { ...v2.surface, surfaceId } };
    };

    it('agent snapshot replace: the snapshot and the view state the parent passes with it', () => {
      const { host, renderer, text, type, rerender } = setup();
      type('a');
      const checkpoint = host.viewState();
      type('ab');
      host.renderable.set(form()); host.viewState.set(checkpoint); rerender();
      expect(renderer.state()).toBe(checkpoint);
      expect(text().value).toBe('a');
    });

    it('view state reset to empty: an empty object emitted earlier, or a fresh one', () => {
      const { host, renderer, text, type, blur, rerender } = setup();
      type('x'); blur();
      const emptied = host.viewState();
      expect(emptied.drafts).toEqual({});
      type('y');
      host.viewState.set(emptied); host.interaction.set(interactionOf()); rerender();
      expect(renderer.state()).toBe(emptied);
      expect(text().value).toBe('');
      type('z');
      const reset = fresh();
      host.viewState.set(reset); rerender();
      expect(renderer.state()).toBe(reset);
      expect(text().value).toBe('');
    });

    it("workspace switch: another slice's view state for the same surface id, then back", () => {
      const workspace = (n: number) => surface([{ ...reason, label: `Reason ${n}` }]);
      const { host, renderer, text, type, blur, commits, rerender } = setup(workspace(2));
      type('two');
      const two = host.viewState();
      host.renderable.set(workspace(1)); host.viewState.set(fresh()); rerender();
      expect(text().value).toBe('');
      type('one');
      host.renderable.set(workspace(2)); host.viewState.set(two); rerender();
      expect(renderer.state()).toBe(two);
      expect(text().value).toBe('two');
      blur();
      expect(commits()).toEqual([{ componentId: 'reason', value: 'two' }]);
    });

    it('same surface re-created: the state the parent restores, then a fresh one', () => {
      const { host, renderer, text, type, rerender } = setup();
      type('kept');
      const saved = host.viewState();
      type('kept more');
      host.renderable.set(form()); host.viewState.set(saved); rerender();
      expect(renderer.state()).toBe(saved);
      expect(text().value).toBe('kept');
      host.renderable.set(form()); host.viewState.set(fresh()); rerender();
      expect(renderer.state().drafts).toEqual({});
      expect(text().value).toBe('');
    });

    it('switching away and back between two surfaces with the renderer kept mounted', () => {
      const surfaces = new Map([['a', withId('a')], ['b', withId('b')]]);
      const { host, renderer, text, type, rerender } = setup(surfaces.get('a'));
      const stores = new Map<string, SurfaceViewState>();
      let active = 'a';
      const show = (id: string) => {
        stores.set(active, host.viewState());
        host.renderable.set(surfaces.get(id)!); host.viewState.set(stores.get(id) ?? fresh()); rerender();
        active = id;
      };
      type('in A');
      show('b');
      expect(text().value).toBe('');
      expect(text().getAttribute('data-apps-focus-key')).toBe('b:reason:input');
      type('in B');
      show('a');
      expect(renderer.state()).toBe(stores.get('a'));
      expect(text().value).toBe('in A');
      show('b');
      expect(renderer.state()).toBe(stores.get('b'));
      expect(text().value).toBe('in B');
    });

    it("re-adopts the parent's copy on a surface switch, even when the parent passes the same object", () => {
      const { host, text, type, rerender } = setup(withId('a'));
      host.feedBack = false;
      type('only in the working copy');
      host.renderable.set(withId('b')); rerender();
      expect(text().value).toBe('');
    });
  });

  describe('a node that keeps its id and kind but changes its path', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const notes: SurfaceComponent = { id: 'notes', kind: 'text', label: 'Notes', path: 'form.notes' };
    const moved: SurfaceComponent = { ...reason, path: 'form.moved' };
    function rebound() {
      const view = setup(form([reason, notes]));
      view.type('old field');
      const notesInput = () => view.element.querySelector<HTMLInputElement>('[data-apps-focus-key="surface:notes:input"]')!;
      notesInput().value = 'kept'; notesInput().dispatchEvent(new Event('input')); view.rerender();
      view.host.renderable.set(form([moved, notes])); view.rerender();
      return { ...view, notesInput };
    }

    it('drops the stale draft, keeps the unrelated one, and never commits it on blur', () => {
      const { renderer, text, blur, commits, host } = rebound();
      expect(renderer.state().drafts).toEqual({ notes: 'kept' });
      expect(host.emitted.at(-1)?.drafts).toEqual({ notes: 'kept' });
      expect(text().value).toBe('');
      blur();
      jest.advanceTimersByTime(SURFACE_TEXT_COMMIT_DEBOUNCE_MS * 2);
      // Only the unrelated input's own debounce commits.
      expect(commits()).toEqual([{ componentId: 'notes', value: 'kept' }]);
    });

    it('never commits it on Enter', () => {
      const { text, commits, rerender } = rebound();
      text().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); rerender();
      expect(commits()).toEqual([]);
      expect(JSON.stringify(commits())).not.toContain('old field');
    });

    it('never commits it on submit; the unrelated draft is flushed', () => {
      const { element, host } = rebound();
      element.querySelector<HTMLButtonElement>('[data-apps-focus-key="surface:form:action-send"]')!.click();
      expect(host.log).toEqual([['commit', { componentId: 'notes', value: 'kept' }], ['action', 'send']]);
    });

    it('keeps the draft across a host update that keeps the binding', () => {
      const { host, renderer, text, type, rerender } = setup(form([reason]));
      type('still mine');
      host.renderable.set(surface([{ id: 'form', kind: 'section', title: { text: 'Renamed' }, actions: [submit],
        children: [{ ...reason, label: 'Renamed reason' }] }], { form: { reason: 'host' } })); rerender();
      expect(renderer.state().drafts).toEqual({ reason: 'still mine' });
      expect(text().value).toBe('still mine');
    });
  });

  it('installs the pending overlay before the committed draft is discarded', () => {
    const { host, renderer, text, type, blur } = setup();
    const seen: unknown[] = [];
    renderer.inputCommit.subscribe(() => seen.push({
      draft: renderer.state().drafts['reason'],
      overlay: renderer.effectiveInteraction().pendingValues.get('form.reason'),
    }));
    type('Rollback'); blur();
    expect(seen).toEqual([{ draft: 'Rollback', overlay: 'Rollback' }]);
    expect(renderer.state().drafts).toEqual({});
    // The parent has not passed an overlay yet: the committed value stays shown.
    expect(host.interaction().pendingValues.size).toBe(0);
    expect(text().value).toBe('Rollback');
  });

  it('surfaces a host rejection of a commit as the input issue, not a silent revert', () => {
    const { host, text, type, blur, rerender, element } = setup();
    type('Rollback'); blur();
    host.interaction.set(interactionOf({ issues: new Map([['reason', ['The host refused this value.']]]) })); rerender();
    expect(text().value).toBe('');
    const issue = Array.from(element.querySelectorAll('p')).find(p => p.textContent === 'The host refused this value.');
    expect(issue).toBeDefined();
    expect(text().getAttribute('aria-invalid')).toBe('true');
    expect(text().getAttribute('aria-describedby')?.split(' ')).toContain(issue?.id);
  });

  it('propagates draft errors: a host-read error shows, an invalid draft shows its error and is never committed', () => {
    const { text, type, blur, commits, renderer, element } = setup(surface([reason], { form: { reason: 42 } }));
    const errorText = () => element.querySelector(`#${text().getAttribute('aria-describedby')?.split(' ')[0]}`)?.textContent;
    expect(text().getAttribute('aria-invalid')).toBe('true');
    expect(errorText()).toEqual(expect.any(String));
    type('ok');
    expect(text().getAttribute('aria-invalid')).toBeNull();
    type(TOO_LONG); blur();
    expect(commits()).toEqual([]);
    expect(renderer.state().drafts).toEqual({ reason: TOO_LONG });
    expect(text().getAttribute('aria-invalid')).toBe('true');
    expect(errorText()).toContain(String(SURFACE_LIMITS.maxStringLength));
  });

  describe('submit', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('flushes valid drafts as commits before the action, and the debounce never commits again', () => {
      const notes: SurfaceComponent = { id: 'notes', kind: 'text', label: 'Notes', path: 'form.notes' };
      const { host, element, renderer, type, rerender } = setup(form([reason, notes]));
      type('Bad deploy');
      const notesInput = element.querySelector<HTMLInputElement>('[data-apps-focus-key="surface:notes:input"]')!;
      notesInput.value = TOO_LONG; notesInput.dispatchEvent(new Event('input')); rerender();
      element.querySelector<HTMLButtonElement>('[data-apps-focus-key="surface:form:action-send"]')!.click();
      expect(host.log).toEqual([['commit', { componentId: 'reason', value: 'Bad deploy' }], ['action', 'send']]);
      expect(renderer.state().drafts).toEqual({ notes: TOO_LONG });
      rerender();
      jest.advanceTimersByTime(SURFACE_TEXT_COMMIT_DEBOUNCE_MS * 2); rerender();
      expect(host.log).toHaveLength(2);
      expect(element.querySelector<HTMLInputElement>('[data-apps-focus-key="surface:reason:input"]')!.value).toBe('Bad deploy');
    });

    it('does not re-commit a draft equal to the committed value, but still discards it', () => {
      const { host, element, renderer, type } = setup(surface([{ id: 'form', kind: 'card', actions: [submit],
        children: [reason] }], { form: { reason: 'same' } }));
      type('same');
      element.querySelector<HTMLButtonElement>('[data-apps-focus-key="surface:form:action-send"]')!.click();
      expect(host.log).toEqual([['action', 'send']]);
      expect(renderer.state().drafts).toEqual({});
    });
  });

  it('removes the draft of an input whose position now holds another id or kind, and keeps the rest', () => {
    const notes: SurfaceComponent = { id: 'notes', kind: 'text', label: 'Notes', path: 'form.notes' };
    const { host, type, rerender, renderer, element } = setup(surface([reason, notes]));
    type('draft');
    const notesInput = element.querySelector<HTMLInputElement>('[data-apps-focus-key="surface:notes:input"]')!;
    notesInput.value = 'kept'; notesInput.dispatchEvent(new Event('input')); rerender();
    host.renderable.set(surface([{ id: 'other', kind: 'text', label: 'Other', path: 'form.reason' }, notes])); rerender();
    expect(renderer.state().drafts).toEqual({ notes: 'kept' });
    expect(host.emitted.at(-1)?.drafts).toEqual({ notes: 'kept' });
    expect(element.querySelector<HTMLInputElement>('[data-apps-focus-key="surface:other:input"]')!.value).toBe('');
    host.renderable.set(surface([{ id: 'notes', kind: 'checkbox', label: 'Notes', path: 'form.notes' }])); rerender();
    expect(renderer.state().drafts).toEqual({});
    expect(element.querySelector<HTMLInputElement>('input[type=checkbox]')!.getAttribute('aria-invalid')).toBeNull();
  });

  it('renders both components when root ids repeat', () => {
    const { element } = setup(surface([{ id: 'dup', kind: 'stat', title: { text: 'One' }, value: 1 },
      { id: 'dup', kind: 'stat', title: { text: 'Two' }, value: 2 }]));
    expect(Array.from(element.querySelectorAll('ptah-dashboard-stat h3')).map(h3 => h3.textContent)).toEqual(['One', 'Two']);
  });

  it('flows root stats several across and gives every other root node a full row (R10 visual review)', () => {
    const { element } = setup(surface([{ id: 'a', kind: 'stat', value: 1 }, { id: 'b', kind: 'stat', value: 2 }, reason]));
    const root = element.querySelector<HTMLElement>('[data-testid="surface-root"]')!;
    expect(root.classList).toContain('grid');
    expect(root.classList).toContain('grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]');
    expect(root.querySelector('header')?.classList).toContain('col-span-full');
    const nodes = Array.from(root.querySelectorAll(':scope > ptah-surface-node'));
    expect(nodes.map(node => node.classList.contains('col-span-full'))).toEqual([false, false, true]);
  });

  it('writes presentation state per component and toggles a selection off when selected again', () => {
    const { host, element, rerender, renderer } = setup(surface([{ id: 'tile', kind: 'stat', value: 1,
      actions: [{ id: 'pick', action: 'dashboard.select', label: { text: 'Pick' } }] }]));
    const expand = () => element.querySelector<HTMLButtonElement>('[data-apps-focus-key="surface:tile:expand"]')!;
    expand().click(); rerender();
    expect(renderer.state().components).toEqual({ tile: { expanded: true } });
    expect(expand().getAttribute('aria-expanded')).toBe('true');
    const pick = () => element.querySelector<HTMLButtonElement>('[data-apps-focus-key="surface:tile:select"]')!;
    pick().click();
    host.interaction.set(interactionOf({ selection: { componentId: 'tile', target: { kind: 'stat' } } })); rerender();
    pick().click();
    expect(host.log).toEqual([['select', { componentId: 'tile', target: { kind: 'stat' } }], ['select', null]]);
  });

  it('shows a checkbox commit at once through the local overlay until the parent answers', () => {
    const { host, element, rerender, commits } = setup(surface([{ id: 'notify', kind: 'checkbox', label: 'Notify', path: 'form.notify' }]));
    const box = () => element.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    box().click(); rerender();
    expect(commits()).toEqual([{ componentId: 'notify', value: true }]);
    expect(box().checked).toBe(true);
    host.interaction.set(interactionOf()); rerender();
    expect(box().checked).toBe(false);
  });
});
