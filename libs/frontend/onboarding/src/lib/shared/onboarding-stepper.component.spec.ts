import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { OnboardingStepperComponent, type OnboardingStep } from './onboarding-stepper.component';

describe('OnboardingStepperComponent', () => {
  const steps: readonly OnboardingStep[] = [
    { id: 'analyze', label: 'Analyze', state: 'completed', link: { commands: ['/onboarding', 'analyze'], queryParams: { analysis: 'saved' } } },
    { id: 'agents', label: 'Choose agents', state: 'current' },
    { id: 'generate', label: 'Generate agents', state: 'upcoming' },
  ];

  it('labels the list, current step, and completed link', () => {
    TestBed.configureTestingModule({ imports: [OnboardingStepperComponent], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(OnboardingStepperComponent);
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('nav')?.getAttribute('aria-label')).toBe('Progress');
    expect(el.querySelector('li[data-state="current"]')?.getAttribute('aria-current')).toBe('step');
    expect(el.querySelector('a')?.textContent?.trim()).toBe('Analyze, completed');
    expect(el.querySelector('a')?.getAttribute('href')).toContain('analysis=saved');
    expect(el.querySelector('li[data-state="upcoming"] a')).toBeNull();
    expect(el.querySelector('li[data-state="completed"] a')?.className).toContain('focus-visible:outline');
  });

  it('uses the same text name for a completed step without a link', () => {
    TestBed.configureTestingModule({ imports: [OnboardingStepperComponent], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(OnboardingStepperComponent);
    fixture.componentRef.setInput('steps', [{ id: 'analyze', label: 'Analyze', state: 'completed' } satisfies OnboardingStep]);
    fixture.detectChanges();
    const completed = (fixture.nativeElement as HTMLElement).querySelector('li[data-state="completed"]') as HTMLLIElement;
    expect(completed.querySelector('a')).toBeNull();
    expect(completed.querySelector('span')?.textContent?.trim()).toBe('Analyze, completed');
    expect(completed.querySelector('span span')?.className).toContain('max-[720px]:sr-only');
  });

  it('collapses noncurrent labels in the narrow strip', () => {
    TestBed.configureTestingModule({ imports: [OnboardingStepperComponent], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(OnboardingStepperComponent);
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('ol')?.className).toContain('min-[720px]:flex-col');
    expect(el.querySelector('li[data-state="completed"] a span')?.className).toContain('max-[720px]:sr-only');
    expect(el.querySelector('li[data-state="upcoming"] span span')?.className).toContain('max-[720px]:sr-only');
    expect(el.querySelector('li[data-state="current"] span span')?.className).not.toContain('max-[720px]:sr-only');
  });
});
