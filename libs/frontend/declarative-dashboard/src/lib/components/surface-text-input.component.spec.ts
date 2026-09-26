import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  SURFACE_LIMITS,
  type SurfaceComponent,
  type SurfaceDataModel,
  type SurfaceDataValue,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { SurfaceInputCommit } from '../surface-interaction';
import { buildSurfaceViewModel } from '../view-model/surface-view-model';
import {
  SURFACE_TEXT_COMMIT_DEBOUNCE_MS,
  SurfaceTextInputComponent,
  type SurfaceDraftWrite,
  type TextInputNode,
} from './surface-text-input.component';

const markup = '<img src=x onerror=alert(1)>';

/** Builds through the real v2 view model so the input sees what the renderer will pass it. */
function textNode(component: Partial<Extract<SurfaceComponent, { kind: 'text' }>> = {}, dataModel: SurfaceDataModel = {}): TextInputNode {
  const result = buildSurfaceViewModel({ contract: 'dashboard-spec/2', dataModel, surface: {
    schemaVersion: 'dashboard-spec/2', catalogVersion: 'dashboard-catalog/2', surfaceId: 's', title: { text: 'T' },
    components: [{ id: 'reason', kind: 'text', label: 'Reason', path: 'form.reason', ...component }] } });
  if (result.renderFailed) throw new Error(result.reason);
  return result.viewModel.components[0] as TextInputNode;
}

/** Wires drafts the way the renderer will: every draft write lands in view state. */
@Component({
  standalone: true,
  imports: [SurfaceTextInputComponent],
  template: `
    @if (shown()) {
      <ptah-surface-text-input [node]="node()" surfaceId="surface" [drafts]="drafts()" [pendingValues]="pending()"
        [issues]="issues()" (draftChange)="writeDraft($event)" (inputCommit)="commits.push($event)" />
    }
    @if (second()) { <ptah-surface-text-input [node]="node()" surfaceId="surface" /> }
  `,
})
class TextHostComponent {
  public readonly node = signal<TextInputNode>(textNode());
  public readonly drafts = signal<Readonly<Record<string, SurfaceDataValue>>>({});
  public readonly pending = signal<ReadonlyMap<string, SurfaceDataValue>>(new Map());
  public readonly issues = signal<ReadonlyMap<string, readonly string[]>>(new Map());
  public readonly shown = signal(true);
  public readonly second = signal(false);
  public readonly commits: SurfaceInputCommit[] = [];
  public readonly draftWrites: SurfaceDraftWrite[] = [];
  public writeDraft(write: SurfaceDraftWrite): void {
    this.draftWrites.push(write);
    const next = { ...this.drafts() };
    if (write.value === undefined) delete next[write.componentId];
    else next[write.componentId] = write.value;
    this.drafts.set(next);
  }
}

describe('SurfaceTextInputComponent', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function setup(node: TextInputNode = textNode()) {
    const fixture = TestBed.createComponent(TextHostComponent);
    fixture.componentInstance.node.set(node);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    const rerender = () => fixture.detectChanges();
    const control = () => element.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')!;
    const type = (text: string) => {
      control().value = text;
      control().dispatchEvent(new Event('input'));
      rerender();
    };
    return { fixture, host: fixture.componentInstance, element, rerender, control, type };
  }

  it('drafts every keystroke into view state and sends no inputCommit per keystroke', () => {
    const { host, type } = setup();
    type('R'); type('Ro'); type('Rol');
    expect(host.commits).toEqual([]);
    expect(host.drafts()).toEqual({ reason: 'Rol' });
    jest.advanceTimersByTime(SURFACE_TEXT_COMMIT_DEBOUNCE_MS - 1);
    expect(host.commits).toEqual([]);
  });

  it('commits once 600 ms after the last keystroke, restarting the idle timer on each keystroke', () => {
    const { host, type, rerender } = setup();
    type('a');
    jest.advanceTimersByTime(400);
    type('ab');
    jest.advanceTimersByTime(400);
    expect(host.commits).toEqual([]);
    jest.advanceTimersByTime(200);
    rerender();
    expect(host.commits).toEqual([{ componentId: 'reason', value: 'ab' }]);
    expect(host.drafts()).toEqual({});
    jest.advanceTimersByTime(5000);
    expect(host.commits).toHaveLength(1);
  });

  it('commits on blur and clears the pending timer', () => {
    const { host, type, control } = setup();
    type('bad deploy');
    control().dispatchEvent(new Event('blur'));
    expect(host.commits).toEqual([{ componentId: 'reason', value: 'bad deploy' }]);
    jest.advanceTimersByTime(SURFACE_TEXT_COMMIT_DEBOUNCE_MS * 2);
    expect(host.commits).toHaveLength(1);
  });

  it('commits on Enter in a single-line input, but not on an Enter that ends an IME composition', () => {
    const { host, type, control } = setup();
    type('first');
    control().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }));
    expect(host.commits).toEqual([]);
    control().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(host.commits).toEqual([{ componentId: 'reason', value: 'first' }]);
  });

  it('renders a textarea when multiline, where Enter is a newline and blur commits', () => {
    const { host, element, type, control } = setup(textNode({ multiline: true }));
    expect(element.querySelector('textarea')).not.toBeNull();
    expect(element.querySelector('input')).toBeNull();
    type('line one');
    control().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(host.commits).toEqual([]);
    control().dispatchEvent(new Event('blur'));
    expect(host.commits).toEqual([{ componentId: 'reason', value: 'line one' }]);
  });

  it('never commits an invalid draft: it stays in view state and shows its error', () => {
    const { host, element, type, control } = setup();
    type('x'.repeat(SURFACE_LIMITS.maxStringLength + 1));
    control().dispatchEvent(new Event('blur'));
    control().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    jest.advanceTimersByTime(SURFACE_TEXT_COMMIT_DEBOUNCE_MS * 2);
    expect(host.commits).toEqual([]);
    expect(host.drafts()['reason']).toHaveLength(SURFACE_LIMITS.maxStringLength + 1);
    const error = element.querySelector(`#${control().id}-error`);
    expect(error?.textContent).toContain('exceeds maxStringLength');
    expect(control().getAttribute('aria-invalid')).toBe('true');
    expect(control().getAttribute('aria-describedby')).toContain(error!.id);
  });

  it('does not commit an unchanged value, and drops the draft so the host value shows again', () => {
    const { host, type, control, rerender } = setup(textNode({}, { form: { reason: 'keep' } }));
    type('keep!'); type('keep');
    control().dispatchEvent(new Event('blur'));
    rerender();
    expect(host.commits).toEqual([]);
    expect(host.drafts()).toEqual({});
    expect(control().value).toBe('keep');
  });

  it('compares against the pending overlay: a draft equal to the pending value is not committed', () => {
    const { host, type, control } = setup(textNode({}, { form: { reason: 'host' } }));
    host.pending.set(new Map([['form.reason', 'pending']]));
    type('pending');
    control().dispatchEvent(new Event('blur'));
    expect(host.commits).toEqual([]);
  });

  it('clears the timer on destroy: nothing fires after destroy', () => {
    const { host, type, rerender } = setup();
    type('half typed');
    host.shown.set(false);
    rerender();
    jest.advanceTimersByTime(SURFACE_TEXT_COMMIT_DEBOUNCE_MS * 5);
    expect(host.commits).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('displays the draft over the pending value over the host value', () => {
    const { host, control, rerender } = setup(textNode({}, { form: { reason: 'host' } }));
    expect(control().value).toBe('host');
    host.pending.set(new Map([['form.reason', 'pending']])); rerender();
    expect(control().value).toBe('pending');
    host.drafts.set({ reason: 'draft' }); rerender();
    expect(control().value).toBe('draft');
    host.drafts.set({}); rerender();
    expect(control().value).toBe('pending');
  });

  it('a missing path shows the empty value without an error (B6 decision)', () => {
    const { element, control } = setup(textNode({}, {}));
    expect(control().value).toBe('');
    expect(control().hasAttribute('aria-invalid')).toBe(false);
    expect(element.querySelector('p')).toBeNull();
  });

  it('shows a host read failure as a draft error until the user drafts a valid value', () => {
    const { element, control, type } = setup(textNode({}, { form: { reason: 42 } }));
    expect(control().value).toBe('');
    expect(control().getAttribute('aria-invalid')).toBe('true');
    expect(element.querySelector(`#${control().id}-error`)?.textContent).toContain('reason');
    type('fixed');
    expect(control().hasAttribute('aria-invalid')).toBe(false);
  });

  it('ties the label to the control and sets aria-required, the required marker and aria-describedby', () => {
    const { element, host, control, rerender } = setup(textNode({ hints: { required: true },
      description: { text: 'Why are you rolling back?' }, placeholder: 'Reason' }));
    const label = element.querySelector('label')!;
    expect(label.getAttribute('for')).toBe(control().id);
    expect(label.querySelector('span[aria-hidden="true"]')?.textContent?.trim()).toBe('*');
    expect(control().getAttribute('aria-required')).toBe('true');
    expect(control().getAttribute('placeholder')).toBe('Reason');
    expect(control().getAttribute('aria-describedby')).toBe(`${control().id}-hint`);
    expect(element.querySelector(`#${control().id}-hint`)?.className).toContain('text-base-content-muted');
    host.issues.set(new Map([['reason', ['is required.']]])); rerender();
    expect(control().getAttribute('aria-invalid')).toBe('true');
    expect(control().getAttribute('aria-describedby')).toBe(`${control().id}-hint ${control().id}-issue-0`);
    expect(element.querySelector(`#${control().id}-issue-0`)?.textContent).toBe('is required.');
  });

  it('omits aria-required when the input is optional', () => {
    const { control } = setup();
    expect(control().hasAttribute('aria-required')).toBe(false);
    expect(control().hasAttribute('aria-describedby')).toBe(false);
  });

  it('gives each instance unique ids', () => {
    const { host, element, rerender } = setup();
    host.second.set(true); rerender();
    const ids = Array.from(element.querySelectorAll('input')).map(input => input.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('carries data-apps-focus-key on the control', () => {
    const { control } = setup();
    expect(control().getAttribute('data-apps-focus-key')).toBe('surface:reason:input');
  });

  it('renders producer markup as literal text', () => {
    const { element, control, host, rerender } = setup(textNode({ label: markup, placeholder: markup,
      description: { text: markup } }, { form: { reason: markup } }));
    host.issues.set(new Map([['reason', [markup]]])); rerender();
    expect(element.querySelector('img')).toBeNull();
    expect(element.querySelector('label')?.textContent).toContain(markup);
    expect(control().value).toBe(markup);
    expect(control().getAttribute('placeholder')).toBe(markup);
    expect(element.textContent).toContain(markup);
  });

  it('uses no inline style and no alpha text utilities', () => {
    const { element, host, rerender } = setup(textNode({ description: { text: 'd' } }, { form: { reason: 1 } }));
    host.issues.set(new Map([['reason', ['bad']]])); rerender();
    expect(element.querySelector('[style], style')).toBeNull();
    expect(element.innerHTML).not.toMatch(/text-base-content\/\d+/);
  });

  describe('a consumed draft commits once (F1)', () => {
    it('commits once for Enter then blur with no change detection in between, and again for a new edit', () => {
      const { host, type, control, rerender } = setup();
      type('draft');
      control().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      control().dispatchEvent(new Event('blur'));
      expect(host.commits).toEqual([{ componentId: 'reason', value: 'draft' }]);
      rerender();
      control().dispatchEvent(new Event('blur'));
      jest.advanceTimersByTime(SURFACE_TEXT_COMMIT_DEBOUNCE_MS * 2);
      expect(host.commits).toHaveLength(1);
      type('draft');
      control().dispatchEvent(new Event('blur'));
      expect(host.commits).toEqual([{ componentId: 'reason', value: 'draft' }, { componentId: 'reason', value: 'draft' }]);
    });

    it('commits once when the debounce fires and a blur follows before the parent refreshes', () => {
      const { host, type, control, rerender } = setup();
      type('ab');
      jest.advanceTimersByTime(SURFACE_TEXT_COMMIT_DEBOUNCE_MS);
      control().dispatchEvent(new Event('blur'));
      control().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(host.commits).toEqual([{ componentId: 'reason', value: 'ab' }]);
      rerender();
      control().dispatchEvent(new Event('blur'));
      expect(host.commits).toHaveLength(1);
    });

    it.each([
      ['blur', () => new Event('blur')],
      ['Enter', () => new KeyboardEvent('keydown', { key: 'Enter' })],
    ])('commits a restored, previously consumed drafts object once a different one was seen (%s)', (_name, commitEvent) => {
      const { host, type, control, rerender } = setup();
      type('a');
      const checkpoint = host.drafts();
      control().dispatchEvent(commitEvent());
      host.node.set(textNode({}, { form: { reason: 'new host' } }));
      rerender();
      expect(control().value).toBe('new host');
      host.drafts.set(checkpoint);
      rerender();
      expect(control().value).toBe('a');
      control().dispatchEvent(commitEvent());
      control().dispatchEvent(commitEvent());
      jest.advanceTimersByTime(SURFACE_TEXT_COMMIT_DEBOUNCE_MS * 2);
      expect(host.commits).toEqual([{ componentId: 'reason', value: 'a' }, { componentId: 'reason', value: 'a' }]);
    });
  });

  describe('typed text is dropped when it is no longer what the UI shows (F2)', () => {
    it('does not commit after the host value is replaced and the draft cleared', () => {
      const { host, type, control, rerender } = setup(textNode({}, { form: { reason: 'old' } }));
      type('stale');
      host.node.set(textNode({}, { form: { reason: 'new host' } }));
      host.drafts.set({});
      rerender();
      expect(control().value).toBe('new host');
      control().dispatchEvent(new Event('blur'));
      jest.advanceTimersByTime(SURFACE_TEXT_COMMIT_DEBOUNCE_MS * 2);
      expect(host.commits).toEqual([]);
    });

    it('does not commit under either id after the node is swapped to another component', () => {
      const { host, type, control, rerender } = setup();
      type('typed');
      host.node.set(textNode({ id: 'other', path: 'form.other' }));
      rerender();
      control().dispatchEvent(new Event('blur'));
      control().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      jest.advanceTimersByTime(SURFACE_TEXT_COMMIT_DEBOUNCE_MS * 2);
      expect(host.commits).toEqual([]);
    });

    it('does not let a pending timer commit a draft the parent cleared externally', () => {
      const { host, type, control, rerender } = setup();
      type('pending text');
      host.drafts.set({});
      rerender();
      expect(control().value).toBe('');
      jest.advanceTimersByTime(SURFACE_TEXT_COMMIT_DEBOUNCE_MS * 2);
      expect(host.commits).toEqual([]);
    });

    it('commits the externally replaced draft the UI shows, not the old typed text', () => {
      const { host, type, control, rerender } = setup();
      type('mine');
      host.drafts.set({ reason: 'theirs' });
      rerender();
      control().dispatchEvent(new Event('blur'));
      expect(host.commits).toEqual([{ componentId: 'reason', value: 'theirs' }]);
    });

    it('keeps typed text across an unrelated drafts update', () => {
      const { host, type, control, rerender } = setup();
      type('keep me');
      host.drafts.set({ ...host.drafts(), other: 'x' });
      rerender();
      control().dispatchEvent(new Event('blur'));
      expect(host.commits).toEqual([{ componentId: 'reason', value: 'keep me' }]);
    });

    it('obeys a parent that restores the drafts object the text was typed against', () => {
      const { host, type, control, rerender } = setup();
      type('a');
      const typedAgainst = host.drafts();
      type('ab');
      host.drafts.set(typedAgainst);
      rerender();
      expect(control().value).toBe('a');
      control().dispatchEvent(new Event('blur'));
      jest.advanceTimersByTime(SURFACE_TEXT_COMMIT_DEBOUNCE_MS * 2);
      expect(host.commits).toEqual([{ componentId: 'reason', value: 'a' }]);
    });
  });
});
