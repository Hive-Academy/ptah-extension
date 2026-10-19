import { TestBed } from '@angular/core/testing';
import type { SessionStatsEntry } from '@ptah-extension/shared';
import { CommandSessionStatsComponent } from './command-session-stats.component';

const snapshot: SessionStatsEntry = {
  sessionId: 'root', model: null, totalCost: 0.012,
  tokens: { input: 1000, output: 200, cacheRead: 0, cacheCreation: 0 },
  tokenCount: 1200, messageCount: 2, agentSessionCount: 2,
  durationMs: 125000, status: 'ok',
};

describe('CommandSessionStatsComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [CommandSessionStatsComponent] }));

  it('omits unknown values', () => {
    const fixture = TestBed.createComponent(CommandSessionStatsComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement.textContent as string).trim()).toBe('');
  });

  it('formats four known cells and marks live estimates', () => {
    const fixture = TestBed.createComponent(CommandSessionStatsComponent);
    fixture.componentRef.setInput('snapshot', { ...snapshot, provisional: true });
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('~$0.01');
    expect(text).toContain('~1.2k');
    expect(text).toContain('Agents 2');
    expect(text).toContain('2m 5s');
  });

  it('labels a known subtotal and omits other missing values', () => {
    const fixture = TestBed.createComponent(CommandSessionStatsComponent);
    fixture.componentRef.setInput('snapshot', {
      ...snapshot, totalCost: null, knownCost: 0.005,
      pricingCoverage: 'partial', tokenCount: undefined,
      agentSessionCount: 0, durationMs: null,
    });
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('$0.0050 known subtotal');
    expect(text).not.toContain('Tokens');
    expect(text).not.toContain('Agents');
    expect(text).not.toContain('Duration');
  });
});
