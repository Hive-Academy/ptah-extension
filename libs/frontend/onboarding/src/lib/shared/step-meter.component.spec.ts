import { TestBed } from '@angular/core/testing';
import { StepMeterComponent } from './step-meter.component';

describe('StepMeterComponent', () => {
  it('exposes a labelled, bounded progressbar and visible value', () => {
    TestBed.configureTestingModule({ imports: [StepMeterComponent] });
    const fixture = TestBed.createComponent(StepMeterComponent);
    fixture.componentRef.setInput('label', 'Agent generation');
    fixture.componentRef.setInput('percent', 42);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const bar = el.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-label')).toBe('Agent generation');
    expect(bar?.getAttribute('aria-valuemin')).toBe('0');
    expect(bar?.getAttribute('aria-valuemax')).toBe('100');
    expect(bar?.getAttribute('aria-valuenow')).toBe('42');
    expect(el.textContent).toContain('42%');
    fixture.componentRef.setInput('percent', 110);
    fixture.detectChanges();
    expect(bar?.getAttribute('aria-valuenow')).toBe('100');
  });
});
