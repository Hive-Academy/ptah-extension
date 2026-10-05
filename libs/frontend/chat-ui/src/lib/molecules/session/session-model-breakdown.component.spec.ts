import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ModelStateService } from '@ptah-extension/core';
import type { SessionStatsEntry } from '@ptah-extension/shared';
import { SessionModelBreakdownComponent } from './session-model-breakdown.component';

const SNAPSHOT: SessionStatsEntry = {
  sessionId: 'session-1',
  model: 'claude-opus-4-7',
  totalCost: 38.18,
  knownCost: 38.18,
  tokens: {
    input: 15_200,
    output: 396_700,
    cacheRead: 14_388_100,
    cacheCreation: 100_000,
  },
  tokenCount: 14_900_000,
  messageCount: 0,
  agentSessionCount: 9,
  modelUsageList: [
    {
      model: 'claude-opus-4-7',
      inputTokens: 15_000,
      outputTokens: 396_000,
      cacheRead: 14_000_000,
      cacheCreation: 90_000,
      costUSD: 38,
    },
    {
      model: 'claude-haiku-4-5',
      inputTokens: 200,
      outputTokens: 700,
      cacheRead: 388_100,
      cacheCreation: 10_000,
      costUSD: 0.18,
    },
  ],
  status: 'ok',
  pricingCoverage: 'full',
  scope: 'session',
  revision: 4,
};

describe('SessionModelBreakdownComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders the named per-model table with its snapshot rows and totals', () => {
    TestBed.configureTestingModule({
      imports: [SessionModelBreakdownComponent],
      providers: [
        {
          provide: ModelStateService,
          useValue: {
            availableModels: signal([
              { id: 'claude-opus-4-7', name: 'Opus 4.7' },
              { id: 'claude-haiku-4-5', name: 'Haiku 4.5' },
            ]),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(SessionModelBreakdownComponent);
    fixture.componentRef.setInput('snapshot', SNAPSHOT);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const table = root.querySelector<HTMLElement>(
      '[data-testid="model-usage-table"]',
    );
    const rows = root.querySelectorAll('[data-testid="model-usage-row"]');

    expect(table?.getAttribute('aria-label')).toBe('Per-model usage');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Opus 4.7');
    expect(rows[1].textContent).toContain('Haiku 4.5');
    expect(
      root.querySelector('[data-testid="model-usage-total"]')?.textContent,
    ).toContain('$38.18');
  });
});
