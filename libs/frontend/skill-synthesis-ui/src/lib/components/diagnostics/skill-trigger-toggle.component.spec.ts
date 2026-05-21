import { TestBed } from '@angular/core/testing';
import { Component, ChangeDetectionStrategy, signal } from '@angular/core';

import {
  SkillTriggerChange,
  SkillTriggerToggleComponent,
} from './skill-trigger-toggle.component';

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
      (triggerChange)="onChange($event)"
    />
  `,
})
class HostComponent {
  protected readonly key = signal<'sessionEnd' | 'idleMs' | 'bootScan'>(
    'idleMs',
  );
  protected readonly label = signal('Idle (ms)');
  protected readonly enabled = signal(true);
  protected readonly numericValue = signal<number | null>(600_000);

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
});
