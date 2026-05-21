import { TestBed } from '@angular/core/testing';

import { MemoryTriggerToggleComponent } from './memory-trigger-toggle.component';

describe('MemoryTriggerToggleComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MemoryTriggerToggleComponent],
    }).compileComponents();
  });

  it('renders label and checkbox state', () => {
    const fixture = TestBed.createComponent(MemoryTriggerToggleComponent);
    fixture.componentRef.setInput('label', 'PreCompact');
    fixture.componentRef.setInput('enabled', true);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent ?? '').toContain('PreCompact');
    const checkbox = root.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('emits change when checkbox toggled', () => {
    const fixture = TestBed.createComponent(MemoryTriggerToggleComponent);
    fixture.componentRef.setInput('label', 'IdleMs');
    fixture.componentRef.setInput('enabled', true);
    const emissions: Array<{ enabled: boolean; value?: number }> = [];
    fixture.componentInstance.triggerChange.subscribe((c) => emissions.push(c));
    fixture.detectChanges();

    const checkbox = (fixture.nativeElement as HTMLElement).querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));

    expect(emissions.length).toBe(1);
    expect(emissions[0]).toEqual({ enabled: false });
  });

  it('renders numeric input when value is provided and emits on change', () => {
    const fixture = TestBed.createComponent(MemoryTriggerToggleComponent);
    fixture.componentRef.setInput('label', 'IdleMs');
    fixture.componentRef.setInput('enabled', true);
    fixture.componentRef.setInput('value', 600000);
    fixture.componentRef.setInput('valueLabel', 'ms');
    const emissions: Array<{ enabled: boolean; value?: number }> = [];
    fixture.componentInstance.triggerChange.subscribe((c) => emissions.push(c));
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent ?? '').toContain('ms');
    const number = root.querySelector(
      'input[type="number"]',
    ) as HTMLInputElement;
    number.value = '120000';
    number.dispatchEvent(new Event('change'));

    expect(emissions.length).toBe(1);
    expect(emissions[0]).toEqual({ enabled: true, value: 120000 });
  });

  it('disables numeric input when toggle is off', () => {
    const fixture = TestBed.createComponent(MemoryTriggerToggleComponent);
    fixture.componentRef.setInput('label', 'IdleMs');
    fixture.componentRef.setInput('enabled', false);
    fixture.componentRef.setInput('value', 600000);
    fixture.detectChanges();

    const number = (fixture.nativeElement as HTMLElement).querySelector(
      'input[type="number"]',
    ) as HTMLInputElement;
    expect(number.disabled).toBe(true);
  });
});
