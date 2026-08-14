import { TestBed } from '@angular/core/testing';
import type {
  SkillSynthesisCandidateSummary,
  SkillSynthesisInvocationEntry,
} from '@ptah-extension/shared';

import { SkillInvocationsPanelComponent } from './skill-invocations-panel.component';

const CANDIDATE: SkillSynthesisCandidateSummary = {
  id: 'cand-1',
  name: 'refactor-tests',
  description: 'Refactor jest configs into a shared preset',
  status: 'promoted',
  successCount: 3,
  failureCount: 1,
  createdAt: 1_700_000_000_000,
  promotedAt: 1_700_000_100_000,
  rejectedAt: null,
  rejectedReason: null,
  pinned: false,
  displayName: null,
  judgeScore: null,
  judgeStatus: null,
  judgeReason: null,
  judgeCriteria: null,
};

function invocation(
  overrides: Partial<SkillSynthesisInvocationEntry> = {},
): SkillSynthesisInvocationEntry {
  return {
    id: 'inv-1',
    skillId: 'cand-1',
    sessionId: 'session-abc',
    succeeded: true,
    invokedAt: 1_700_000_200_000,
    notes: null,
    ...overrides,
  };
}

function render(inputs: {
  candidate?: SkillSynthesisCandidateSummary | null;
  invocations?: readonly SkillSynthesisInvocationEntry[];
}) {
  const fixture = TestBed.createComponent(SkillInvocationsPanelComponent);
  fixture.componentRef.setInput(
    'candidate',
    inputs.candidate === undefined ? CANDIDATE : inputs.candidate,
  );
  fixture.componentRef.setInput('invocations', inputs.invocations ?? []);
  fixture.detectChanges();
  return {
    fixture,
    el: fixture.nativeElement as HTMLElement,
    component: fixture.componentInstance,
  };
}

describe('SkillInvocationsPanelComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SkillInvocationsPanelComponent],
    });
  });

  it('renders nothing when there is no selected candidate', () => {
    const { el } = render({ candidate: null });
    expect(el.textContent?.trim()).toBe('');
  });

  it('renders one card per invocation, newest list order preserved', () => {
    const { el } = render({
      invocations: [
        invocation({ id: 'inv-1' }),
        invocation({ id: 'inv-2', succeeded: false }),
      ],
    });

    const cards = el.querySelectorAll('[data-testid="skills-invocation-card"]');
    expect(cards.length).toBe(2);
    const outcomes = el.querySelectorAll(
      '[data-testid="skills-invocation-outcome"]',
    );
    expect(Array.from(outcomes).map((o) => o.textContent?.trim())).toEqual([
      'success',
      'failure',
    ]);
  });

  it('carries the outcome as the card tone so it reads without the label', () => {
    const { el } = render({
      invocations: [
        invocation({ id: 'inv-1', succeeded: true }),
        invocation({ id: 'inv-2', succeeded: false }),
      ],
    });

    const tones = Array.from(
      el.querySelectorAll('[data-testid="skills-invocation-card"] [data-tone]'),
    ).map((n) => n.getAttribute('data-tone'));
    expect(tones).toEqual(['success', 'error']);

    expect(
      el.querySelectorAll('[data-testid="native-card-spine"]').length,
    ).toBe(2);
  });

  it('renders notes only when the invocation has any', () => {
    const without = render({ invocations: [invocation()] });
    expect(
      without.el.querySelector('[data-testid="skills-invocation-notes"]'),
    ).toBeNull();

    const withNotes = render({
      invocations: [invocation({ notes: 'retried after a flaky fixture' })],
    });
    expect(
      withNotes.el
        .querySelector('[data-testid="skills-invocation-notes"]')
        ?.textContent?.trim(),
    ).toBe('retried after a flaky fixture');
  });

  it('explains an empty history instead of rendering an empty list', () => {
    const { el } = render({ invocations: [] });

    expect(
      el.querySelector('[data-testid="skills-invocation-card"]'),
    ).toBeNull();
    expect(
      el.querySelector('[data-testid="skills-invocations-empty"]')?.textContent,
    ).toContain('No invocations recorded for this candidate yet.');
  });

  it('offers no filter controls — the list is already scoped to one candidate', () => {
    const { el } = render({ invocations: [invocation()] });

    expect(el.querySelectorAll('[role="tab"]').length).toBe(0);
    const buttons = Array.from(el.querySelectorAll('button')).map((b) =>
      b.textContent?.trim(),
    );
    expect(buttons).toEqual(['Close']);
  });

  it('emits closed from the Close control', () => {
    const { el, component } = render({ invocations: [invocation()] });
    let closed = 0;
    component.closed.subscribe(() => (closed += 1));

    const close = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Close',
    );
    close?.click();

    expect(closed).toBe(1);
  });
});
