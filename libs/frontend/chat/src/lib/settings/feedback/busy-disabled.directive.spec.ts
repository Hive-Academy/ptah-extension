/**
 * SettingsBusyDisabledDirective (TASK_2026_555 Batch 54.1): a control disabled while a save or check runs keeps focus
 * (aria-disabled, never native disabled), and its own handlers do not run.
 */
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { SettingsBusyDisabledDirective } from './busy-disabled.directive';

@Component({
  standalone: true,
  imports: [SettingsBusyDisabledDirective],
  template: `
    <button type="button" [ptahBusyDisabled]="busy()" (click)="clicks = clicks + 1" (keydown)="keys.push($event.key)" data-testid="button">Save</button>
    <input type="checkbox" [ptahBusyDisabled]="busy()" (change)="changes = changes + 1" data-testid="checkbox" />
    <input type="text" [ptahBusyDisabled]="busy()" (input)="inputs = inputs + 1" data-testid="text" />
    <select [ptahBusyDisabled]="busy()" (change)="changes = changes + 1" data-testid="select"><option>a</option><option>b</option></select>
  `,
})
class Host {
  readonly busy = signal(true);
  clicks = 0;
  changes = 0;
  inputs = 0;
  readonly keys: string[] = [];
}

describe('SettingsBusyDisabledDirective', () => {
  let fixture: ComponentFixture<Host>;
  const q = <T extends HTMLElement>(id: string) => fixture.nativeElement.querySelector(`[data-testid="${id}"]`) as T;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [Host] });
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  it('busy: aria-disabled, never native disabled, so a focused control keeps focus', () => {
    const button = q<HTMLButtonElement>('button');
    button.focus();
    expect(document.activeElement).toBe(button);
    for (const id of ['button', 'checkbox', 'text', 'select']) {
      expect(q<HTMLElement>(id).getAttribute('aria-disabled')).toBe('true');
      expect((q<HTMLElement>(id) as HTMLInputElement).disabled).toBe(false);
    }
    expect(document.activeElement).toBe(button);
    expect(q<HTMLInputElement>('text').readOnly).toBe(true);
    expect(q<HTMLInputElement>('checkbox').readOnly).toBe(false);
  });

  it('busy: clicks, toggles, typing and changes are cancelled before the control\'s own handlers; Tab and Esc pass', () => {
    q<HTMLButtonElement>('button').click();
    const checkbox = q<HTMLInputElement>('checkbox');
    checkbox.click();
    expect(checkbox.checked).toBe(false);
    q<HTMLInputElement>('text').dispatchEvent(new Event('input'));
    q<HTMLSelectElement>('select').dispatchEvent(new Event('change'));
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    q<HTMLButtonElement>('button').dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    for (const key of ['Tab', 'Escape']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      q<HTMLButtonElement>('button').dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    const host = fixture.componentInstance;
    expect([host.clicks, host.changes, host.inputs]).toEqual([0, 0, 0]);
    expect(host.keys).toEqual(['Tab', 'Escape']);
  });

  it('m-4 (Batch 55b): copy and select-all pass on any busy control; caret keys and a mouse press pass only in a text field', () => {
    const pressed = (id: string, init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      q<HTMLElement>(id).dispatchEvent(event);
      return event.defaultPrevented;
    };
    for (const id of ['button', 'checkbox', 'text', 'select']) {
      expect(pressed(id, { key: 'c', ctrlKey: true })).toBe(false);
      expect(pressed(id, { key: 'a', metaKey: true })).toBe(false);
      expect(pressed(id, { key: 'v', ctrlKey: true })).toBe(true);
    }
    for (const key of ['ArrowLeft', 'ArrowDown', 'Home', 'End']) {
      expect(pressed('text', { key })).toBe(false);
      expect(pressed('select', { key })).toBe(true);
    }
    expect(pressed('text', { key: 'Enter' })).toBe(true);
    const textDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    q<HTMLInputElement>('text').dispatchEvent(textDown);
    expect(textDown.defaultPrevented).toBe(false);
    const selectDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    q<HTMLSelectElement>('select').dispatchEvent(selectDown);
    expect(selectDown.defaultPrevented).toBe(true);
  });

  it('m-4: a field whose type changes to a non-text type is read as such (type read lazily)', () => {
    const text = q<HTMLInputElement>('text');
    text.type = 'color';
    fixture.componentInstance.busy.set(false);
    fixture.detectChanges();
    fixture.componentInstance.busy.set(true);
    fixture.detectChanges();
    expect(text.readOnly).toBe(false);
    const caret = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
    text.dispatchEvent(caret);
    expect(caret.defaultPrevented).toBe(true);
  });

  it('not busy: no attribute, and every handler runs', () => {
    fixture.componentInstance.busy.set(false);
    fixture.detectChanges();
    expect(q<HTMLElement>('button').hasAttribute('aria-disabled')).toBe(false);
    expect(q<HTMLInputElement>('text').readOnly).toBe(false);
    q<HTMLButtonElement>('button').click();
    q<HTMLInputElement>('checkbox').click();
    expect(q<HTMLInputElement>('checkbox').checked).toBe(true);
    q<HTMLInputElement>('text').dispatchEvent(new Event('input'));
    const host = fixture.componentInstance;
    expect([host.clicks, host.changes, host.inputs]).toEqual([1, 1, 1]);
  });
});
