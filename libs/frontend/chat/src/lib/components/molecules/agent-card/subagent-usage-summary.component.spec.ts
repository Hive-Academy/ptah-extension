import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  AgentMonitorStore,
  type SubagentRecord,
} from '@ptah-extension/chat-streaming';
import {
  resetPricingMapForTesting,
  updatePricingMap,
} from '@ptah-extension/shared';
import { SubagentUsageSummaryComponent } from './subagent-usage-summary.component';
import { NOT_REPORTED } from './stats-bar.utils';

function record(overrides: Partial<SubagentRecord> = {}): SubagentRecord {
  return {
    parentToolUseId: 'toolu_1',
    status: 'running',
    ...overrides,
  };
}

describe('SubagentUsageSummaryComponent', () => {
  let fixture: ComponentFixture<SubagentUsageSummaryComponent>;
  let loadSubagentCacheInfo: jest.Mock;
  let tick: ReturnType<typeof signal<number>>;

  function setup(rec: SubagentRecord): void {
    loadSubagentCacheInfo = jest.fn().mockResolvedValue(undefined);
    tick = signal(0);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SubagentUsageSummaryComponent],
      providers: [
        {
          provide: AgentMonitorStore,
          useValue: { tick, loadSubagentCacheInfo },
        },
      ],
    });
    fixture = TestBed.createComponent(SubagentUsageSummaryComponent);
    fixture.componentRef.setInput('record', rec);
    fixture.detectChanges();
  }

  function text(testId: string): string | undefined {
    const el = fixture.nativeElement.querySelector(
      `[data-testid="${testId}"]`,
    ) as HTMLElement | null;
    return el?.textContent?.trim();
  }

  beforeEach(() =>
    updatePricingMap({
      'test-subagent-model': {
        inputCostPerToken: 1e-6,
        outputCostPerToken: 1e-5,
        cacheReadCostPerToken: 1e-7,
        cacheCreationCostPerToken: 1e-6,
        provider: 'anthropic',
      },
    }),
  );

  afterEach(() => {
    resetPricingMapForTesting();
    jest.restoreAllMocks();
  });

  it('loads the cache info once when the row opens, not again on record churn', () => {
    setup(record());
    expect(loadSubagentCacheInfo).toHaveBeenCalledTimes(1);
    expect(loadSubagentCacheInfo).toHaveBeenCalledWith('toolu_1');

    fixture.componentRef.setInput('record', record({ toolUses: 3 }));
    fixture.detectChanges();
    expect(loadSubagentCacheInfo).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput(
      'record',
      record({ parentToolUseId: 'toolu_2' }),
    );
    fixture.detectChanges();
    expect(loadSubagentCacheInfo).toHaveBeenCalledTimes(2);
    expect(loadSubagentCacheInfo).toHaveBeenLastCalledWith('toolu_2');
  });

  it('shows every missing value as not reported and no badge before any usage or TTL', () => {
    setup(record());
    expect(text('subagent-context')).toBe(`ctx ${NOT_REPORTED}`);
    expect(text('subagent-cache-not-reported')).toBe('cache not reported');
    expect(text('subagent-output')).toBe(`out ${NOT_REPORTED}`);
    expect(text('subagent-cost')).toBe(NOT_REPORTED);
    expect(text('subagent-cache-badge')).toBeUndefined();
  });

  it('shows context, cache read / write, output and the estimate when reported', () => {
    setup(
      record({
        usage: {
          input: 10,
          output: 2_000,
          cacheRead: 40_000,
          cacheWrite: 1_500,
          lastRequestContextTokens: 41_510,
          model: 'test-subagent-model',
        },
      }),
    );
    expect(text('subagent-context')).toBe('ctx 41.5k');
    expect(text('subagent-cache-read')).toBe('cache read 40.0k');
    expect(text('subagent-cache-write')).toBe('cache write 1.5k');
    expect(text('subagent-output')).toBe('out 2.0k');
    // 10 * 1e-6 + 2000 * 1e-5 + 40000 * 1e-7 + 1500 * 1e-6 = 0.02551
    expect(text('subagent-cost')).toBe('~$0.03 est.');
    expect(text('subagent-cache-not-reported')).toBeUndefined();
  });

  it('keeps a cache field the subagent did not report as not reported', () => {
    setup(
      record({
        usage: { input: 10, output: 5, cacheRead: 300, model: 'claude-x' },
      }),
    );
    expect(text('subagent-cache-read')).toBe('cache read 300');
    expect(text('subagent-cache-write')).toBe(`cache write ${NOT_REPORTED}`);
    expect(text('subagent-context')).toBe(`ctx ${NOT_REPORTED}`);
  });

  it('shows not reported for the estimate when the model has no price', () => {
    setup(
      record({
        usage: { input: 10, output: 5, model: 'no-such-model-for-pricing' },
      }),
    );
    expect(text('subagent-cost')).toBe(NOT_REPORTED);
    const cost = fixture.nativeElement.querySelector(
      '[data-testid="subagent-cost"]',
    ) as HTMLElement;
    expect(cost.title).toBe(
      'No price is known for this model or its cache tokens',
    );
  });

  it('shows a warm badge with the TTL and idle time in its tooltip', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    setup(record({ cacheTtl: '5m', lastEventAt: 1_000_000 - 30_000 }));
    const badge = fixture.nativeElement.querySelector(
      '[data-testid="subagent-cache-badge"]',
    ) as HTMLElement;
    expect(badge.textContent?.trim()).toBe('warm');
    expect(badge.classList).toContain('badge-success');
    expect(badge.title).toBe('Prompt cache warm (TTL 5m, idle 30.0s)');
    expect(badge.getAttribute('aria-label')).toBe(badge.title);
  });

  it('turns cold on the shared tick once the TTL has passed', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    setup(record({ cacheTtl: '5m', lastEventAt: 1_000_000 }));
    expect(text('subagent-cache-badge')).toBe('warm');

    nowSpy.mockReturnValue(1_000_000 + 6 * 60_000);
    tick.set(1);
    fixture.detectChanges();
    expect(text('subagent-cache-badge')).toBe('cold');
  });

  it('shows cold with an unknown idle time for a record with no activity', () => {
    setup(record({ cacheTtl: '1h' }));
    const badge = fixture.nativeElement.querySelector(
      '[data-testid="subagent-cache-badge"]',
    ) as HTMLElement;
    expect(badge.textContent?.trim()).toBe('cold');
    expect(badge.title).toBe('Prompt cache cold (TTL 1h, idle unknown)');
  });

  it('keeps the state unknown when the cache info load throws', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {
      /* expected */
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SubagentUsageSummaryComponent],
      providers: [
        {
          provide: AgentMonitorStore,
          useValue: {
            tick: signal(0),
            loadSubagentCacheInfo: jest
              .fn()
              .mockRejectedValue(new Error('transport down')),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(SubagentUsageSummaryComponent);
    fixture.componentRef.setInput('record', record());
    fixture.detectChanges();
    await fixture.whenStable();
    expect(warn).toHaveBeenCalled();
    expect(text('subagent-cache-badge')).toBeUndefined();
  });
});
