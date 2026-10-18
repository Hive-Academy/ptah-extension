import { TestBed } from '@angular/core/testing';
import { ContextRingComponent } from './context-ring.component';

describe('ContextRingComponent', () => {
  it('keeps the existing thresholds unless a tone is supplied', () => {
    TestBed.configureTestingModule({ imports: [ContextRingComponent] });
    const fixture = TestBed.createComponent(ContextRingComponent);
    fixture.componentRef.setInput('percent', 79);
    fixture.detectChanges();
    const svg = fixture.nativeElement.querySelector('svg') as SVGElement;
    expect(svg.style.color).toBe('var(--ptah-gold, var(--ptah-accent-ink))');
    fixture.componentRef.setInput('percent', 80);
    fixture.detectChanges();
    expect(svg.style.color).toBe('var(--state-ink-need)');
    fixture.componentRef.setInput('percent', 95);
    fixture.detectChanges();
    expect(svg.style.color).toBe('var(--state-ink-err)');
  });

  it('uses the semantic tone regardless of percent', () => {
    TestBed.configureTestingModule({ imports: [ContextRingComponent] });
    const fixture = TestBed.createComponent(ContextRingComponent);
    fixture.componentRef.setInput('percent', 95);
    fixture.componentRef.setInput('tone', 'normal');
    fixture.detectChanges();
    const svg = fixture.nativeElement.querySelector('svg') as SVGElement;
    expect(svg.style.color).toBe('var(--state-ink-done)');
    fixture.componentRef.setInput('tone', 'warning');
    fixture.detectChanges();
    expect(svg.style.color).toBe('var(--state-ink-need)');
    expect(fixture.nativeElement.getAttribute('aria-hidden')).toBe('true');
  });
});
