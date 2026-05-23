import { TestBed } from '@angular/core/testing';
import { Component, ChangeDetectionStrategy, signal } from '@angular/core';

import {
  SkillTriggerChange,
  SkillTriggerToggleComponent,
} from './skill-trigger-toggle.component';

type HostKey =
  | 'sessionEnd'
  | 'idleMs'
  | 'bootScan'
  | 'subagentStop'
  | 'postToolUse'
  | 'postToolUseMinEditCount'
  | 'maxAnalyzesPerHour';

@Component({
  selector: 'ptah-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SkillTriggerToggleComponent],
  template: `
    <ptah-skill-trigger-toggle
      [key]="key()"
      [label]="label()"
      [enabled]="enabled()"
      [numericValue]="numericValue()"
      [min]="min()"
      [max]="max()"
      (triggerChange)="onChange($event)"
    />
  `,
})
class HostComponent {
  public readonly key = signal<HostKey>('idleMs');
  public readonly label = signal('Idle (ms)');
  public readonly enabled = signal(true);
  public readonly numericValue = signal<number | null>(600_000);
  public readonly min = signal<number | null>(null);
  public readonly max = signal<number | null>(null);

  public lastChange: SkillTriggerChange | null = null;
  public onChange(change: SkillTriggerChange): void {
    this.lastChange = change;
  }
}

describe('SkillTriggerToggleComponent', () => {
  it('renders checkbox + numeric input when numericValue provided', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('input[type="checkbox"]')).toBeTruthy();
    expect(el.querySelector('input[type="number"]')).toBeTruthy();
  });

  it('emits change with checkbox value', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const host = fixture.componentInstance;
    const checkbox = fixture.nativeElement.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(host.lastChange).toEqual({ key: 'idleMs', value: false });
  });

  it('emits change with numeric value', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const host = fixture.componentInstance;
    const numberInput = fixture.nativeElement.querySelector(
      'input[type="number"]',
    ) as HTMLInputElement;
    numberInput.value = '120000';
    numberInput.dispatchEvent(new Event('change'));
    expect(host.lastChange).toEqual({ key: 'idleMs', value: 120_000 });
  });

  it('emits subagentStop toggle change', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    const host = fixture.componentInstance;
    host.key.set('subagentStop');
    host.label.set('Subagent stop');
    host.enabled.set(false);
    host.numericValue.set(null);
    fixture.detectChanges();
    const checkbox = fixture.nativeElement.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(host.lastChange).toEqual({ key: 'subagentStop', value: true });
  });

  it('emits postToolUseMinEditCount numeric change', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    const host = fixture.componentInstance;
    host.key.set('postToolUseMinEditCount');
    host.label.set('Min edit count');
    host.enabled.set(true);
    host.numericValue.set(1);
    host.min.set(1);
    host.max.set(20);
    fixture.detectChanges();
    const numberInput = fixture.nativeElement.querySelector(
      'input[type="number"]',
    ) as HTMLInputElement;
    expect(numberInput.getAttribute('min')).toBe('1');
    expect(numberInput.getAttribute('max')).toBe('20');
    numberInput.value = '5';
    numberInput.dispatchEvent(new Event('change'));
    expect(host.lastChange).toEqual({
      key: 'postToolUseMinEditCount',
      value: 5,
    });
  });

  it('emits maxAnalyzesPerHour numeric change', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    const host = fixture.componentInstance;
    host.key.set('maxAnalyzesPerHour');
    host.label.set('Max analyzes per hour');
    host.enabled.set(true);
    host.numericValue.set(60);
    host.min.set(0);
    host.max.set(1000);
    fixture.detectChanges();
    const numberInput = fixture.nativeElement.querySelector(
      'input[type="number"]',
    ) as HTMLInputElement;
    numberInput.value = '120';
    numberInput.dispatchEvent(new Event('change'));
    expect(host.lastChange).toEqual({
      key: 'maxAnalyzesPerHour',
      value: 120,
    });
  });
});
