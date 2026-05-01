import { TestBed } from '@angular/core/testing';
import { TokenBadgeComponent } from './token-badge.component';
import type { MessageTokenUsage } from '@ptah-extension/shared';

describe('TokenBadgeComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TokenBadgeComponent],
    }).compileComponents();
  });

  function render() {
    return TestBed.createComponent(TokenBadgeComponent);
  }

  it('shows raw count for small token numbers', () => {
    const fixture = render();
    fixture.componentRef.setInput('tokens', 250);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('250 tokens');
  });

  it('formats >= 1k tokens with k suffix', () => {
    const fixture = render();
    fixture.componentRef.setInput('tokens', 1500);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('1.5k tokens');
  });

  it('formats >= 1M tokens with M suffix', () => {
    const fixture = render();
    fixture.componentRef.setInput('tokens', 2_500_000);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('2.5M tokens');
  });

  it('falls back to legacy count input', () => {
    const fixture = render();
    fixture.componentRef.setInput('count', 42);
    fixture.detectChanges();
    expect(fixture.componentInstance.totalCount()).toBe(42);
    expect(fixture.componentInstance.tooltipText()).toContain('42 tokens');
  });

  it('sums input + output for full MessageTokenUsage', () => {
    const fixture = render();
    const usage: MessageTokenUsage = {
      input: 100,
      output: 200,
      cacheRead: 50,
      cacheCreation: 25,
    };
    fixture.componentRef.setInput('tokens', usage);
    fixture.detectChanges();
    expect(fixture.componentInstance.totalCount()).toBe(300);
    const tooltip = fixture.componentInstance.tooltipText();
    expect(tooltip).toContain('Input: 100');
    expect(tooltip).toContain('Output: 200');
    expect(tooltip).toContain('Cache Read: 50');
    expect(tooltip).toContain('Cache Creation: 25');
    expect(tooltip).toContain('Total: 300');
  });

  it('handles missing tokens input as 0', () => {
    const fixture = render();
    fixture.detectChanges();
    expect(fixture.componentInstance.totalCount()).toBe(0);
    expect(fixture.componentInstance.tooltipText()).toBe('0 tokens');
  });
});
