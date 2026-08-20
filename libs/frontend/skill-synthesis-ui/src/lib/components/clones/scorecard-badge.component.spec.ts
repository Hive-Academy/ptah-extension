import { TestBed } from '@angular/core/testing';
import type { AgentScorecard } from '@ptah-extension/shared';

import { ScorecardBadgeComponent } from './scorecard-badge.component';

function scorecard(overrides: Partial<AgentScorecard> = {}): AgentScorecard {
  return {
    slug: 'planner',
    totalInvocations: 3,
    gradedCount: 2,
    gradedSuccessRate: 0.5,
    avgInputTokens: 100,
    avgOutputTokens: 40,
    avgCacheReadTokens: null,
    totalInputTokens: 300,
    totalOutputTokens: 120,
    avgCostUsd: 0.012,
    avgDurationMs: 4200,
    avgToolCount: 5,
    recentVerdicts: [
      { taskId: 'TASK_2026_001', succeeded: true, reconciledAt: 1 },
      { taskId: 'TASK_2026_002', succeeded: false, reconciledAt: 2 },
    ],
    ...overrides,
  };
}

function render(input: AgentScorecard | null) {
  const fixture = TestBed.createComponent(ScorecardBadgeComponent);
  fixture.componentRef.setInput('scorecard', input);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ScorecardBadgeComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ScorecardBadgeComponent] });
  });

  it('renders success rate, invocations, tokens, cost, and verdict dots', () => {
    const el = render(scorecard());
    expect(
      el
        .querySelector('[data-testid="scorecard-success"]')
        ?.textContent?.trim(),
    ).toBe('50% ok');
    expect(
      el.querySelector('[data-testid="scorecard-invocations"]')?.textContent,
    ).toContain('3 inv');
    expect(
      el.querySelector('[data-testid="scorecard-tokens"]')?.textContent,
    ).toContain('tok');
    expect(
      el.querySelector('[data-testid="scorecard-cost"]')?.textContent,
    ).toContain('$');
    const dots = el.querySelectorAll(
      '[data-testid="scorecard-verdict-dots"] > span',
    );
    expect(dots.length).toBe(2);
  });

  it('shows "no data yet" (never zeros) when metrics are null', () => {
    const el = render(
      scorecard({
        gradedSuccessRate: null,
        avgInputTokens: null,
        avgOutputTokens: null,
        avgCostUsd: null,
        recentVerdicts: [],
      }),
    );
    expect(
      el
        .querySelector('[data-testid="scorecard-success"]')
        ?.textContent?.trim(),
    ).toBe('no data yet');
    expect(
      el.querySelector('[data-testid="scorecard-tokens"]')?.textContent,
    ).toContain('no data yet');
    expect(
      el.querySelector('[data-testid="scorecard-cost"]')?.textContent,
    ).toContain('no data yet');
    expect(
      el.querySelector('[data-testid="scorecard-verdict-dots"]'),
    ).toBeNull();
  });

  it('treats tokens and cost independently (tokens present, cost null)', () => {
    const el = render(
      scorecard({ avgInputTokens: 120, avgOutputTokens: 30, avgCostUsd: null }),
    );
    expect(
      el.querySelector('[data-testid="scorecard-tokens"]')?.textContent,
    ).toContain('tok');
    expect(
      el.querySelector('[data-testid="scorecard-cost"]')?.textContent,
    ).toContain('no data yet');
  });

  it('renders a safe empty badge for a null scorecard input', () => {
    const el = render(null);
    expect(
      el
        .querySelector('[data-testid="scorecard-success"]')
        ?.textContent?.trim(),
    ).toBe('no data yet');
    expect(
      el.querySelector('[data-testid="scorecard-invocations"]')?.textContent,
    ).toContain('0 inv');
  });
});
