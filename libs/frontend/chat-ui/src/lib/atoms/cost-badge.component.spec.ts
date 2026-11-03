import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CostBadgeComponent } from './cost-badge.component';

describe('CostBadgeComponent', () => {
  let fixture: ComponentFixture<CostBadgeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CostBadgeComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(CostBadgeComponent);
  });

  it('creates with required cost input', () => {
    fixture.componentRef.setInput('cost', 0.0042);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('$0.0042');
  });

  it('formats costs >= $0.01 with 2 decimals', () => {
    fixture.componentRef.setInput('cost', 1.234);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('$1.23');
  });

  it('formats costs == $0.01 with 2 decimals', () => {
    fixture.componentRef.setInput('cost', 0.01);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('$0.01');
  });

  it('exposes raw USD value via title tooltip', () => {
    fixture.componentRef.setInput('cost', 0.5);
    fixture.detectChanges();
    const span = fixture.nativeElement.querySelector('span');
    expect(span.getAttribute('title')).toBe('$0.5000 USD');
  });

  it.each([
    ['estimated', 'estimated'],
    ['covered-by-subscription', 'covered by subscription'],
  ] as const)('labels a %s final cost in the badge and tooltip', (basis, label) => {
    fixture.componentRef.setInput('cost', 0.5);
    fixture.componentRef.setInput('costBasis', basis);
    fixture.detectChanges();

    const badge = fixture.nativeElement.querySelector('.badge');
    expect(badge.textContent).toContain(label);
    expect(badge.getAttribute('title')).toContain(label);
  });

  it('keeps a null cost unavailable even with a final basis', () => {
    fixture.componentRef.setInput('cost', null);
    fixture.componentRef.setInput('costBasis', 'covered-by-subscription');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('cost unavailable');
    expect(fixture.nativeElement.textContent).not.toContain('covered by subscription');
  });

  it('says "cost unavailable" when cost is null (no pricing known)', () => {
    fixture.componentRef.setInput('cost', null);
    expect(() => fixture.detectChanges()).not.toThrow();
    expect(fixture.nativeElement.textContent).toContain('cost unavailable');
    expect(fixture.nativeElement.textContent).not.toContain('$0.00');
  });

  it('says "cost unavailable" when cost is undefined', () => {
    fixture.componentRef.setInput('cost', undefined);
    expect(() => fixture.detectChanges()).not.toThrow();
    expect(fixture.nativeElement.textContent).toContain('cost unavailable');
  });

  it('says "cost unavailable" when cost is NaN', () => {
    fixture.componentRef.setInput('cost', Number.NaN);
    expect(() => fixture.detectChanges()).not.toThrow();
    expect(fixture.nativeElement.textContent).toContain('cost unavailable');
    expect(fixture.nativeElement.textContent).not.toContain('NaN');
  });

  it('still renders a genuine $0.00 turn as zero, not as unavailable', () => {
    // Copilot and local Ollama really are free — "unavailable" would be as
    // wrong for them as "$0.00" is for an unpriced custom provider.
    fixture.componentRef.setInput('cost', 0);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('$0.0000');
    expect(fixture.nativeElement.textContent).not.toContain('unavailable');
  });

  it('says "not priced" when the backend names a missing rate', () => {
    fixture.componentRef.setInput('cost', null);
    fixture.componentRef.setInput('costUnavailableReason', 'rate-missing');
    fixture.detectChanges();

    const badge = fixture.nativeElement.querySelector('[data-testid="cost-not-priced"]');
    expect(badge.textContent).toContain('not priced');
    expect(badge.getAttribute('title')).toContain('no published rate');
    expect(fixture.nativeElement.querySelector('[data-testid="cost-unavailable"]')).toBeNull();
  });

  it.each([
    ['billing-unknown'],
    ['usage-incomplete'],
    [undefined],
  ] as const)('keeps "cost unavailable" for a %s null cost', (reason) => {
    fixture.componentRef.setInput('cost', null);
    fixture.componentRef.setInput('costUnavailableReason', reason);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('cost unavailable');
    expect(fixture.nativeElement.textContent).not.toContain('not priced');
  });
});
