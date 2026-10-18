import { TestBed } from '@angular/core/testing';
import type { SessionStatsEntry } from '@ptah-extension/shared';
import { CommandSessionStatsComponent } from './command-session-stats.component';

const snapshot: SessionStatsEntry = {
  sessionId: 'root',
  model: null,
  totalCost: 0.012,
  tokens: { input: 1000, output: 200, cacheRead: 0, cacheCreation: 0 },
  tokenCount: 1200,
  messageCount: 2,
  agentSessionCount: 2,
  durationMs: 125000,
  status: 'ok',
};

describe('CommandSessionStatsComponent', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({ imports: [CommandSessionStatsComponent] }),
  );

  it('shows unknown for a missing snapshot', () => {
    const fixture = TestBed.createComponent(CommandSessionStatsComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toMatch(
      /Cost\s*—\s*Tokens\s*—\s*Agents\s*—\s*Duration\s*—/,
    );
  });

  it('formats root snapshot values and marks live estimates', () => {
    const fixture = TestBed.createComponent(CommandSessionStatsComponent);
    fixture.componentRef.setInput('snapshot', {
      ...snapshot,
      provisional: true,
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('~$0.01');
    expect(fixture.nativeElement.textContent).toContain('~1.2k');
    expect(fixture.nativeElement.textContent).toContain('Agents 2');
    expect(fixture.nativeElement.textContent).toContain('2m 5s');
  });

  it('labels priced partial usage as a known subtotal', () => {
    const fixture = TestBed.createComponent(CommandSessionStatsComponent);
    fixture.componentRef.setInput('snapshot', {
      ...snapshot,
      totalCost: null,
      knownCost: 0.005,
      pricingCoverage: 'partial',
      tokenCount: undefined,
      agentSessionCount: 0,
      durationMs: null,
    });
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('$0.0050 known subtotal');
    expect(text).toMatch(/Tokens\s*—\s*Agents\s*—\s*Duration\s*—/);
  });
});
