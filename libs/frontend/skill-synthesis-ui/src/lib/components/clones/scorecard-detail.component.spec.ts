import { TestBed } from '@angular/core/testing';
import type { ScorecardInvocationRow } from '@ptah-extension/shared';

import { ScorecardDetailComponent } from './scorecard-detail.component';

function row(
  overrides: Partial<ScorecardInvocationRow> = {},
): ScorecardInvocationRow {
  return {
    taskId: 'TASK_2026_001',
    succeeded: true,
    exactAttribution: true,
    inputTokens: 100,
    outputTokens: 40,
    costUsd: 0.012,
    durationMs: 4200,
    invokedAt: 1,
    reconciledAt: 2,
    ...overrides,
  };
}

function render(inputs: {
  rows?: ScorecardInvocationRow[];
  findingsExcerpt?: string | null;
  loading?: boolean;
}) {
  const fixture = TestBed.createComponent(ScorecardDetailComponent);
  fixture.componentRef.setInput('rows', inputs.rows ?? []);
  fixture.componentRef.setInput(
    'findingsExcerpt',
    inputs.findingsExcerpt ?? null,
  );
  fixture.componentRef.setInput('loading', inputs.loading ?? false);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ScorecardDetailComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ScorecardDetailComponent] });
  });

  it('shows a loading state while detail is being fetched', () => {
    const el = render({ loading: true });
    expect(
      el.querySelector('[data-testid="scorecard-detail-loading"]'),
    ).toBeTruthy();
  });

  it('explains how data accrues when there are no rows (R7.3)', () => {
    const el = render({ rows: [] });
    const empty = el.querySelector('[data-testid="scorecard-detail-empty"]');
    expect(empty).toBeTruthy();
    expect(empty?.textContent).toContain('.ptah/specs');
  });

  it('renders graded rows with verdict, tokens, cost, and duration', () => {
    const el = render({ rows: [row()] });
    const cells = el.querySelectorAll('[data-testid="scorecard-detail-row"]');
    expect(cells.length).toBe(1);
    const text = cells[0].textContent ?? '';
    expect(text).toContain('TASK_2026_001');
    expect(text).toContain('COMPLETE');
    expect(text).toContain('140'); // 100 + 40 tokens
  });

  it('marks heuristically-attributed rows (exactAttribution=false)', () => {
    const el = render({ rows: [row({ exactAttribution: false })] });
    expect(
      el.querySelector('[data-testid="scorecard-heuristic-marker"]'),
    ).toBeTruthy();
  });

  it('renders "—" for null metrics rather than fabricated zeros', () => {
    const el = render({
      rows: [
        row({
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          durationMs: null,
        }),
      ],
    });
    const rowText =
      el.querySelector('[data-testid="scorecard-detail-row"]')?.textContent ??
      '';
    expect(rowText).toContain('—');
  });

  it('routes the findings excerpt through the markdown chokepoint', () => {
    const el = render({ rows: [row()], findingsExcerpt: '## Findings' });
    const findings = el.querySelector('[data-testid="scorecard-findings"]');
    expect(findings).toBeTruthy();
    expect(findings?.querySelector('ptah-markdown-block')).toBeTruthy();
  });
});
