import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { AgentRecommendation } from '@ptah-extension/shared';
import {
  AgentRecommendationListComponent,
  criteriaOf,
  matchPercent,
} from './agent-recommendation-list.component';

function rec(
  overrides: Partial<AgentRecommendation> &
    Pick<AgentRecommendation, 'agentId' | 'agentName' | 'category'>,
): AgentRecommendation {
  return {
    relevanceScore: 92,
    matchedCriteria: ['NestJS framework detected'],
    recommended: true,
    description: 'Implements APIs',
    ...overrides,
  };
}

describe('matchPercent', () => {
  it.each([0, 50, 92, 100])('returns a rounded percent for %s', (score) => {
    expect(matchPercent(score)).toBe(Math.round(score));
  });

  it.each([-1, 100.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'hides scores outside 0..100 (%s)',
    (score) => {
      expect(matchPercent(score)).toBeNull();
    },
  );
});

describe('AgentRecommendationListComponent', () => {
  let fixture: ComponentFixture<AgentRecommendationListComponent>;

  function render(
    recommendations: readonly AgentRecommendation[],
    extras: { selection?: ReadonlySet<string>; disabled?: boolean } = {},
  ): HTMLElement {
    TestBed.configureTestingModule({
      imports: [AgentRecommendationListComponent],
    });
    fixture = TestBed.createComponent(AgentRecommendationListComponent);
    fixture.componentRef.setInput('recommendations', recommendations);
    if (extras.selection) {
      fixture.componentRef.setInput('selection', extras.selection);
    }
    if (extras.disabled !== undefined) {
      fixture.componentRef.setInput('disabled', extras.disabled);
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => TestBed.resetTestingModule());

  const backend = rec({
    agentId: 'backend-developer',
    agentName: 'Backend Developer',
    category: 'development',
    relevanceScore: 92,
  });
  const planner = rec({
    agentId: 'software-architect',
    agentName: 'Software Architect',
    category: 'planning',
    relevanceScore: 40,
    recommended: false,
    matchedCriteria: [],
  });
  const unknown = rec({
    agentId: 'custom-agent',
    agentName: 'Custom Agent',
    category: 'planning',
  });

  it('groups agents like the legacy list and puts unknown categories in Other', () => {
    const stray: AgentRecommendation = {
      ...unknown,
      category: 'mystery' as AgentRecommendation['category'],
    };
    const el = render([backend, planner, stray]);
    const headings = [...el.querySelectorAll('h3')].map((node) =>
      (node.textContent ?? '').trim(),
    );
    expect(headings).toEqual([
      'Planning & Architecture',
      'Development',
      'Other',
    ]);
    expect(el.textContent).toContain('Software Architect');
    expect(el.textContent).toContain('Backend Developer');
    expect(el.textContent).toContain('Custom Agent');
  });

  it('shows 0% match when the score is 0', () => {
    const el = render([
      rec({
        agentId: 'zero-match',
        agentName: 'Zero Match',
        category: 'qa',
        relevanceScore: 0,
        recommended: false,
        matchedCriteria: [],
      }),
    ]);
    expect(
      el.querySelector('[data-testid="agent-recommendation-match"]')?.textContent,
    ).toContain('0% match');
  });

  it('shows match % and a meter only when the score is within 0..100', () => {
    const el = render([
      backend,
      rec({
        agentId: 'out-of-range',
        agentName: 'Out of Range',
        category: 'qa',
        relevanceScore: 100.5,
        recommended: false,
        matchedCriteria: [],
      }),
    ]);
    const matches = el.querySelectorAll(
      '[data-testid="agent-recommendation-match"]',
    );
    expect(matches.length).toBe(1);
    expect(matches[0].textContent).toContain('92% match');
    expect(el.querySelectorAll('[data-testid="agent-recommendation-meter"]').length).toBe(
      1,
    );
    expect(el.textContent).not.toContain('9200%');
    const hiddenRow = el.querySelector('[data-agent-id="out-of-range"]');
    expect(hiddenRow?.querySelector('[data-testid="agent-recommendation-match"]')).toBeNull();
  });

  it('renders criteria as chips', () => {
    const el = render([backend]);
    const chips = el.querySelector(
      '[data-testid="agent-recommendation-criteria"]',
    );
    expect(chips?.textContent).toContain('NestJS framework detected');
    expect(el.querySelector('details')).toBeNull();
  });

  it('treats a missing matchedCriteria as no chips', () => {
    const bare = {
      agentId: 'bare-agent',
      agentName: 'Bare Agent',
      category: 'development' as const,
      relevanceScore: 92,
      recommended: true,
      description: 'No criteria field',
    } as AgentRecommendation;
    expect(criteriaOf(bare)).toEqual([]);
    const el = render([bare]);
    expect(el.textContent).toContain('Bare Agent');
    expect(el.querySelector('[data-testid="agent-recommendation-criteria"]')).toBeNull();
  });

  it('emits toggle, selectRecommended and clear, and reports n selected', () => {
    const el = render([backend, planner], {
      selection: new Set(['backend-developer']),
    });
    const toggled = jest.fn();
    const selectRecommended = jest.fn();
    const clearSelection = jest.fn();
    fixture.componentInstance.toggled.subscribe(toggled);
    fixture.componentInstance.selectRecommended.subscribe(selectRecommended);
    fixture.componentInstance.clearSelection.subscribe(clearSelection);

    expect(
      el.querySelector('[data-testid="agent-recommendation-count"]')?.textContent,
    ).toContain('1 selected');

    (
      el.querySelector(
        '[data-agent-id="software-architect"] input',
      ) as HTMLInputElement
    ).dispatchEvent(new Event('change'));
    (
      el.querySelector(
        '[data-testid="agent-recommendation-select-recommended"]',
      ) as HTMLButtonElement
    ).click();
    (
      el.querySelector(
        '[data-testid="agent-recommendation-clear"]',
      ) as HTMLButtonElement
    ).click();

    expect(toggled).toHaveBeenCalledWith('software-architect');
    expect(selectRecommended).toHaveBeenCalledTimes(1);
    expect(clearSelection).toHaveBeenCalledTimes(1);
  });

  it('disables the toolbar and checkboxes when disabled', () => {
    const el = render([backend], { disabled: true });
    expect(
      (
        el.querySelector(
          '[data-testid="agent-recommendation-select-recommended"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        el.querySelector(
          '[data-testid="agent-recommendation-clear"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (el.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it('marks icons decorative and uses a glass tile on each row', () => {
    const el = render([backend]);
    const icon = el.querySelector('lucide-angular');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(
      el
        .querySelector('[data-testid="agent-recommendation-row"]')
        ?.getAttribute('data-glass-surface'),
    ).toBe('tile');
  });
});
