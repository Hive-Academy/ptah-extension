import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { SurfaceDataModel, SurfaceDataValue } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { SurfaceInputCommit } from '../surface-interaction';
import { buildSurfaceViewModel } from '../view-model/surface-view-model';
import { type CheckboxInputNode, SurfaceCheckboxInputComponent } from './surface-checkbox-input.component';

const markup = '<img src=x onerror=alert(1)>';

/** Builds through the real v2 view model so the input sees what the renderer will pass it. */
function checkboxNode(extra: { readonly label?: string; readonly required?: boolean } = {},
  dataModel: SurfaceDataModel = {}): CheckboxInputNode {
  const result = buildSurfaceViewModel({ contract: 'dashboard-spec/2', dataModel, surface: {
    schemaVersion: 'dashboard-spec/2', catalogVersion: 'dashboard-catalog/2', surfaceId: 's', title: { text: 'T' },
    components: [{ id: 'notify', kind: 'checkbox', label: extra.label ?? 'Notify on-call channel', path: 'form.notify',
      ...(extra.required ? { hints: { required: true } } : {}) }] } });
  if (result.renderFailed) throw new Error(result.reason);
  return result.viewModel.components[0] as CheckboxInputNode;
}

@Component({
  standalone: true,
  imports: [SurfaceCheckboxInputComponent],
  template: `
    <ptah-surface-checkbox-input [node]="node()" surfaceId="surface" [drafts]="drafts()" [pendingValues]="pending()"
      [issues]="issues()" (inputCommit)="commit($event)" />
    @if (second()) { <ptah-surface-checkbox-input [node]="node()" surfaceId="surface" /> }
  `,
})
class CheckboxHostComponent {
  public readonly node = signal<CheckboxInputNode>(checkboxNode());
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

describe('SurfaceCheckboxInputComponent', () => {
  function setup(node: CheckboxInputNode = checkboxNode()) {
    const fixture = TestBed.createComponent(CheckboxHostComponent);
    fixture.componentInstance.node.set(node);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    const rerender = () => fixture.detectChanges();
    const box = () => element.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const click = () => { box().click(); rerender(); };
    return { fixture, host: fixture.componentInstance, element, rerender, box, click };
  }

  it('commits true and then false on change', () => {
    const { host, box, click } = setup();
    expect(box().checked).toBe(false);
    click();
    expect(host.commits).toEqual([{ componentId: 'notify', value: true }]);
    expect(box().checked).toBe(true);
    click();
    expect(host.commits[1]).toEqual({ componentId: 'notify', value: false });
    expect(box().checked).toBe(false);
  });

  it('keeps the DOM on the displayed value until the parent applies the commit', () => {
    const { host, box, click } = setup();
    host.applyCommits.set(false);
    click();
    expect(host.commits).toHaveLength(1);
    expect(box().checked).toBe(false);
  });

  it('does not commit an unchanged value', () => {
    const { host, box, rerender } = setup(checkboxNode({}, { form: { notify: true } }));
    box().dispatchEvent(new Event('change'));
    rerender();
    expect(host.commits).toEqual([]);
  });

  it('displays the draft over the pending value over the host value', () => {
    const { host, box, rerender } = setup(checkboxNode({}, { form: { notify: true } }));
    expect(box().checked).toBe(true);
    host.pending.set(new Map([['form.notify', false]])); rerender();
    expect(box().checked).toBe(false);
    host.drafts.set({ notify: true }); rerender();
    expect(box().checked).toBe(true);
  });

  it('marks a stored non-boolean value as a draft error and shows it unchecked', () => {
    const { element, box } = setup(checkboxNode({}, { form: { notify: 'yes' } }));
    expect(box().checked).toBe(false);
    expect(box().getAttribute('aria-invalid')).toBe('true');
    const error = element.querySelector(`#${box().id}-error`);
    expect(error?.textContent).toContain('notify');
    expect(box().getAttribute('aria-describedby')).toBe(error?.id);
  });

  it('ties the label to the checkbox and sets aria-required, aria-invalid, aria-describedby and the focus key', () => {
    const { host, element, box, rerender } = setup(checkboxNode({ required: true }));
    expect(element.querySelector('label')?.getAttribute('for')).toBe(box().id);
    expect(element.querySelector('label span[aria-hidden="true"]')?.textContent?.trim()).toBe('*');
    expect(box().getAttribute('aria-required')).toBe('true');
    expect(box().hasAttribute('aria-invalid')).toBe(false);
    expect(box().getAttribute('data-apps-focus-key')).toBe('surface:notify:input');
    host.issues.set(new Map([['notify', ['is required.']]])); rerender();
    expect(box().getAttribute('aria-invalid')).toBe('true');
    expect(box().getAttribute('aria-describedby')).toBe(`${box().id}-issue-0`);
  });

  it('gives each instance unique ids', () => {
    const { host, element, rerender } = setup();
    host.second.set(true); rerender();
    const ids = Array.from(element.querySelectorAll('input')).map(input => input.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('renders producer markup as literal text, with no inline style', () => {
    const { element, host, rerender } = setup(checkboxNode({ label: markup }));
    host.issues.set(new Map([['notify', [markup]]])); rerender();
    expect(element.querySelector('img')).toBeNull();
    expect(element.querySelector('label')?.textContent).toContain(markup);
    expect(element.querySelector('p')?.textContent).toBe(markup);
    expect(element.querySelector('[style], style')).toBeNull();
    expect(element.innerHTML).not.toMatch(/text-base-content\/\d+/);
  });
});
