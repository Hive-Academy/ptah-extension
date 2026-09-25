import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  SurfaceDataModel,
  SurfaceDataValue,
  SurfaceInputOption,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { SurfaceInputCommit } from '../surface-interaction';
import { buildSurfaceViewModel } from '../view-model/surface-view-model';
import { type ChoiceInputNode, SurfaceChoiceInputComponent } from './surface-choice-input.component';

const markup = '<img src=x onerror=alert(1)>';
const OPTIONS: readonly SurfaceInputOption[] = [
  { value: 'production', label: 'Production' },
  { value: 'staging', label: 'Staging' },
  { value: 'preview', label: 'Preview' },
];

/** Builds through the real v2 view model so the input sees what the renderer will pass it. */
function choiceNode(kind: 'select' | 'radio-group', extra: { readonly label?: string; readonly required?: boolean;
  readonly options?: readonly SurfaceInputOption[] } = {}, dataModel: SurfaceDataModel = {}): ChoiceInputNode {
  const result = buildSurfaceViewModel({ contract: 'dashboard-spec/2', dataModel, surface: {
    schemaVersion: 'dashboard-spec/2', catalogVersion: 'dashboard-catalog/2', surfaceId: 's', title: { text: 'T' },
    components: [{ id: 'env', kind, label: extra.label ?? 'Target environment', path: 'form.env',
      options: extra.options ?? OPTIONS, ...(extra.required ? { hints: { required: true } } : {}) }] } });
  if (result.renderFailed) throw new Error(result.reason);
  return result.viewModel.components[0] as ChoiceInputNode;
}

@Component({
  standalone: true,
  imports: [SurfaceChoiceInputComponent],
  template: `
    <ptah-surface-choice-input [node]="node()" surfaceId="surface" [drafts]="drafts()" [pendingValues]="pending()"
      [issues]="issues()" (inputCommit)="commit($event)" />
    @if (second()) { <ptah-surface-choice-input [node]="node()" surfaceId="surface" /> }
  `,
})
class ChoiceHostComponent {
  public readonly node = signal<ChoiceInputNode>(choiceNode('select'));
  public readonly drafts = signal<Readonly<Record<string, SurfaceDataValue>>>({});
  public readonly pending = signal<ReadonlyMap<string, SurfaceDataValue>>(new Map());
  public readonly issues = signal<ReadonlyMap<string, readonly string[]>>(new Map());
  public readonly second = signal(false);
  /** When true the host applies each commit as a pending overlay, as the page will. */
  public readonly applyCommits = signal(true);
  public readonly commits: SurfaceInputCommit[] = [];
  public commit(commit: SurfaceInputCommit): void {
    this.commits.push(commit);
    if (this.applyCommits()) this.pending.set(new Map([[this.node().path, commit.value]]));
  }
}

describe('SurfaceChoiceInputComponent', () => {
  function setup(node: ChoiceInputNode) {
    const fixture = TestBed.createComponent(ChoiceHostComponent);
    fixture.componentInstance.node.set(node);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    const rerender = () => fixture.detectChanges();
    return { fixture, host: fixture.componentInstance, element, rerender };
  }

  describe('select', () => {
    const select = (element: HTMLElement) => element.querySelector('select')!;
    const pick = (element: HTMLElement, index: number) => {
      select(element).selectedIndex = index;
      select(element).dispatchEvent(new Event('change'));
    };

    it('renders an empty "—" option first, then the options in spec order', () => {
      const { element } = setup(choiceNode('select'));
      expect(Array.from(select(element).options).map(option => option.textContent)).toEqual(['—', 'Production', 'Staging', 'Preview']);
      expect(select(element).selectedIndex).toBe(0);
      expect(select(element).className).toContain('select-sm');
    });

    it('commits on change, and "—" maps to null', () => {
      const { host, element, rerender } = setup(choiceNode('select', {}, { form: { env: 'staging' } }));
      expect(select(element).value).toBe('staging');
      pick(element, 3); rerender();
      expect(host.commits).toEqual([{ componentId: 'env', value: 'preview' }]);
      expect(select(element).value).toBe('preview');
      pick(element, 0); rerender();
      expect(host.commits[1]).toEqual({ componentId: 'env', value: null });
      expect(select(element).selectedIndex).toBe(0);
    });

    it('does not commit an unchanged value', () => {
      const { host, element } = setup(choiceNode('select', {}, { form: { env: 'staging' } }));
      pick(element, 2);
      expect(host.commits).toEqual([]);
    });

    it('keeps the DOM on the displayed value until the parent applies the commit', () => {
      const { host, element, rerender } = setup(choiceNode('select', {}, { form: { env: 'staging' } }));
      host.applyCommits.set(false);
      pick(element, 1); rerender();
      expect(host.commits).toHaveLength(1);
      expect(select(element).value).toBe('staging');
    });

    it('displays the draft over the pending value over the host value', () => {
      const { host, element, rerender } = setup(choiceNode('select', {}, { form: { env: 'production' } }));
      expect(select(element).value).toBe('production');
      host.pending.set(new Map([['form.env', 'staging']])); rerender();
      expect(select(element).value).toBe('staging');
      host.drafts.set({ env: 'preview' }); rerender();
      expect(select(element).value).toBe('preview');
    });

    it('ties the label to the select and sets aria-required, aria-invalid and aria-describedby', () => {
      const { host, element, rerender } = setup(choiceNode('select', { required: true }));
      const control = select(element);
      expect(element.querySelector('label')?.getAttribute('for')).toBe(control.id);
      expect(element.querySelector('label span[aria-hidden="true"]')?.textContent?.trim()).toBe('*');
      expect(control.getAttribute('aria-required')).toBe('true');
      expect(control.hasAttribute('aria-invalid')).toBe(false);
      host.issues.set(new Map([['env', ['is required.']]])); rerender();
      expect(control.getAttribute('aria-invalid')).toBe('true');
      expect(control.getAttribute('aria-describedby')).toBe(`${control.id}-issue-0`);
      expect(element.querySelector(`#${control.id}-issue-0`)?.textContent).toBe('is required.');
      expect(control.getAttribute('data-apps-focus-key')).toBe('surface:env:input');
    });

    it('marks a stored value outside the options as a draft error', () => {
      const { element } = setup(choiceNode('select', {}, { form: { env: 'mars' } }));
      const control = select(element);
      expect(control.selectedIndex).toBe(0);
      expect(control.getAttribute('aria-invalid')).toBe('true');
      expect(element.querySelector(`#${control.id}-error`)?.textContent).toContain('mars');
    });
  });

  describe('radio-group', () => {
    const radios = (element: HTMLElement) => Array.from(element.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    const choose = (element: HTMLElement, index: number) => {
      radios(element)[index].checked = true;
      radios(element)[index].dispatchEvent(new Event('change'));
    };

    it('uses fieldset + legend, with a label tied to each radio', () => {
      const { element } = setup(choiceNode('radio-group', { label: 'Rollback strategy', required: true }));
      const fieldset = element.querySelector('fieldset')!;
      expect(fieldset.querySelector('legend')?.textContent).toContain('Rollback strategy');
      expect(fieldset.getAttribute('aria-required')).toBe('true');
      const labels = Array.from(fieldset.querySelectorAll('label'));
      expect(labels.map(label => label.textContent?.trim())).toEqual(['Production', 'Staging', 'Preview']);
      radios(element).forEach((radio, index) => {
        expect(labels[index].getAttribute('for')).toBe(radio.id);
        expect(radio.getAttribute('data-apps-focus-key')).toBe(`surface:env:option-${index}`);
        expect(radio.name).toBe(radios(element)[0].name);
      });
    });

    it('commits on change and does not commit the value already shown', () => {
      const { host, element, rerender } = setup(choiceNode('radio-group', {}, { form: { env: 'production' } }));
      expect(radios(element).map(radio => radio.checked)).toEqual([true, false, false]);
      choose(element, 1); rerender();
      expect(host.commits).toEqual([{ componentId: 'env', value: 'staging' }]);
      expect(radios(element).map(radio => radio.checked)).toEqual([false, true, false]);
      choose(element, 1); rerender();
      expect(host.commits).toHaveLength(1);
    });

    it('restores the checked radio when the parent does not apply the commit', () => {
      const { host, element, rerender } = setup(choiceNode('radio-group', {}, { form: { env: 'production' } }));
      host.applyCommits.set(false);
      choose(element, 2); rerender();
      expect(radios(element).map(radio => radio.checked)).toEqual([true, false, false]);
    });

    it('checks no radio for null', () => {
      const { element } = setup(choiceNode('radio-group'));
      expect(radios(element).some(radio => radio.checked)).toBe(false);
    });
  });

  it('skips a malformed options entry instead of crashing', () => {
    const valid = choiceNode('select');
    const malformed = [null, { value: 1, label: 'Number' }, { value: 'ok', label: 'Fine' }, 'text'] as unknown as readonly SurfaceInputOption[];
    const { element } = setup({ ...valid, options: malformed });
    expect(Array.from(element.querySelectorAll('option')).map(option => option.textContent)).toEqual(['—', 'Fine']);
    const radioNode = choiceNode('radio-group');
    const radio = setup({ ...radioNode, options: 'not-an-array' as unknown as readonly SurfaceInputOption[] });
    expect(radio.element.querySelectorAll('input[type="radio"]')).toHaveLength(0);
  });

  describe.each(['select', 'radio-group'] as const)('malformed options validate like they render (F3, %s)', kind => {
    const chooseFirstRendered = (element: HTMLElement) => {
      if (kind === 'select') {
        const control = element.querySelector('select')!;
        control.selectedIndex = 1;
        control.dispatchEvent(new Event('change'));
        return;
      }
      const radio = element.querySelector<HTMLInputElement>('input[type="radio"]')!;
      radio.checked = true;
      radio.dispatchEvent(new Event('change'));
    };

    it('commits the valid option without throwing when a null entry sits beside it', () => {
      const malformed = [null, { value: 'ok', label: 'Fine' }] as unknown as readonly SurfaceInputOption[];
      const { host, element, rerender } = setup({ ...choiceNode(kind), options: malformed });
      expect(() => { chooseFirstRendered(element); rerender(); }).not.toThrow();
      expect(host.commits).toEqual([{ componentId: 'env', value: 'ok' }]);
    });

    it('treats non-array options as none and never throws for a string host, draft or pending value', () => {
      const node = { ...choiceNode(kind, {}, { form: { env: 'staging' } }), options: 'not-an-array' as unknown as readonly SurfaceInputOption[] };
      const fixture = TestBed.createComponent(ChoiceHostComponent);
      fixture.componentInstance.node.set(node);
      expect(() => fixture.detectChanges()).not.toThrow();
      const element: HTMLElement = fixture.nativeElement;
      expect(element.querySelector('[id$="-error"]')?.textContent).toContain('staging');
      fixture.componentInstance.pending.set(new Map([['form.env', 'preview']]));
      expect(() => fixture.detectChanges()).not.toThrow();
      expect(element.querySelector('[id$="-error"]')?.textContent).toContain('preview');
      fixture.componentInstance.drafts.set({ env: 'production' });
      expect(() => fixture.detectChanges()).not.toThrow();
      expect(element.querySelector('[id$="-error"]')?.textContent).toContain('production');
      expect(fixture.componentInstance.commits).toEqual([]);
    });
  });

  it('gives each instance unique ids', () => {
    const { host, element, rerender } = setup(choiceNode('select'));
    host.second.set(true); rerender();
    const ids = Array.from(element.querySelectorAll('select')).map(select => select.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    host.node.set(choiceNode('radio-group')); rerender();
    const radioIds = Array.from(element.querySelectorAll('input[type="radio"]')).map(radio => radio.id);
    expect(new Set(radioIds).size).toBe(radioIds.length);
    const names = new Set(Array.from(element.querySelectorAll<HTMLInputElement>('input[type="radio"]')).map(radio => radio.name));
    expect(names.size).toBe(2);
  });

  it('renders producer markup in labels and options as literal text, with no inline style', () => {
    const options = [{ value: 'x', label: markup }];
    const { element, host, rerender } = setup(choiceNode('select', { label: markup, options }));
    expect(element.querySelector('img')).toBeNull();
    expect(element.querySelector('label')?.textContent).toContain(markup);
    expect(element.querySelectorAll('option')[1].textContent).toBe(markup);
    host.node.set(choiceNode('radio-group', { label: markup, options })); rerender();
    expect(element.querySelector('img')).toBeNull();
    expect(element.querySelector('legend')?.textContent).toContain(markup);
    expect(element.querySelector('fieldset label')?.textContent).toContain(markup);
    expect(element.querySelector('[style], style')).toBeNull();
    expect(element.innerHTML).not.toMatch(/text-base-content\/\d+/);
  });
});
