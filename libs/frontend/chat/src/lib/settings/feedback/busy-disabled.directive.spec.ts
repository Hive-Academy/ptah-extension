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
