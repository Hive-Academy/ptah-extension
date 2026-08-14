import { TestBed } from '@angular/core/testing';
import type { SkillSynthesisCandidateSummary } from '@ptah-extension/shared';

import {
  SkillCandidatesTableComponent,
  type SkillCandidateAction,
} from './skill-candidates-table.component';

function candidate(
  overrides: Partial<SkillSynthesisCandidateSummary> = {},
): SkillSynthesisCandidateSummary {
  return {
    id: 'cand-1',
    name: 'refactor-tests',
    description: 'Refactor jest configs into a shared preset',
    status: 'candidate',
    successCount: 3,
    failureCount: 1,
    createdAt: 1_700_000_000_000,
    promotedAt: null,
    rejectedAt: null,
    rejectedReason: null,
    pinned: false,
    displayName: null,
    judgeScore: null,
    judgeStatus: null,
    judgeReason: null,
    judgeCriteria: null,
    ...overrides,
  };
}

function render(inputs: {
  candidates?: readonly SkillSynthesisCandidateSummary[];
  selectedCandidateId?: string | null;
  selectedIds?: ReadonlySet<string>;
  loading?: boolean;
}) {
  const fixture = TestBed.createComponent(SkillCandidatesTableComponent);
  fixture.componentRef.setInput('candidates', inputs.candidates ?? []);
  fixture.componentRef.setInput(
    'selectedCandidateId',
    inputs.selectedCandidateId ?? null,
  );
  fixture.componentRef.setInput(
    'selectedIds',
    inputs.selectedIds ?? new Set<string>(),
  );
  fixture.componentRef.setInput('loading', inputs.loading ?? false);
  fixture.detectChanges();
  return {
    fixture,
    el: fixture.nativeElement as HTMLElement,
    component: fixture.componentInstance,
  };
}

describe('SkillCandidatesTableComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SkillCandidatesTableComponent],
    });
  });

  describe('e2e DOM contract', () => {
    it('renders exactly one skills-candidate-row per candidate', () => {
      const { el } = render({
        candidates: [
          candidate({ id: 'a', name: 'skill a' }),
          candidate({ id: 'b', name: 'skill b' }),
        ],
      });

      expect(
        el.querySelectorAll('[data-testid="skills-candidate-row"]').length,
      ).toBe(2);
    });

    it('renders the raw backend status word and nothing else in the status node', () => {
      const { el } = render({
        candidates: [candidate({ status: 'promoted' })],
      });

      const status = el.querySelector(
        '[data-testid="skills-candidate-status"]',
      );
      expect(status?.textContent?.trim()).toBe('promoted');
    });

    it('keeps the bulk-selection controls addressable', () => {
      const { el } = render({ candidates: [candidate()] });

      expect(
        el.querySelector('[data-testid="skills-select-all"]'),
      ).toBeTruthy();
      expect(
        el.querySelector('[data-testid="skills-select-row"]'),
      ).toBeTruthy();
      expect(
        el.querySelector('[data-testid="skills-promote-btn"]'),
      ).toBeTruthy();
      expect(
        el.querySelector('[data-testid="skills-reject-btn"]'),
      ).toBeTruthy();
    });
  });

  describe('emptiness', () => {
    it('renders the explanatory empty state with no candidates', () => {
      const { el } = render({ candidates: [] });

      const empty = el.querySelector('[data-testid="skills-empty-state"]');
      expect(empty).toBeTruthy();
      const text = empty?.textContent ?? '';
      expect(text).toContain('No candidates for this filter.');
      expect(text).toContain('5 turns');
      expect(text).toContain('promoted');
    });

    it('shows a loading placeholder instead of the empty state while loading', () => {
      const { el } = render({ candidates: [], loading: true });

      expect(el.querySelector('[data-testid="skills-empty-state"]')).toBeNull();
      expect(el.querySelector('[role="status"]')).toBeTruthy();
    });

    it('explains a never-invoked candidate rather than rendering 0 / 0', () => {
      const { el } = render({
        candidates: [candidate({ successCount: 0, failureCount: 0 })],
      });

      const row = el.querySelector('[data-testid="skills-candidate-row"]');
      expect(
        row?.querySelector('[data-testid="skills-candidate-no-runs"]'),
      ).toBeTruthy();
      expect(
        row?.querySelector('[data-testid="skills-candidate-metrics"]'),
      ).toBeNull();
      expect(row?.textContent).toContain('Never invoked yet');
    });

    it('renders only the counters that are non-zero', () => {
      const { el } = render({
        candidates: [candidate({ successCount: 4, failureCount: 0 })],
      });

      const row = el.querySelector('[data-testid="skills-candidate-row"]');
      expect(
        row
          ?.querySelector('[data-testid="skills-candidate-successes"]')
          ?.textContent?.trim(),
      ).toBe('4');
      expect(
        row?.querySelector('[data-testid="skills-candidate-failures"]'),
      ).toBeNull();
    });
  });

  describe('selection', () => {
    it('reports aria-pressed for the open candidate, not the bulk set', () => {
      const { el } = render({
        candidates: [candidate({ id: 'a' }), candidate({ id: 'b' })],
        selectedCandidateId: 'b',
        // 'a' is bulk-ticked but NOT open — it must not read as pressed.
        selectedIds: new Set(['a']),
      });

      const cards = el.querySelectorAll<HTMLElement>(
        '[data-testid="skills-candidate-row"] [role="button"]',
      );
      expect(cards[0].getAttribute('aria-pressed')).toBe('false');
      expect(cards[1].getAttribute('aria-pressed')).toBe('true');
    });

    it('emits selectRow when the card surface is activated', () => {
      const { el, component } = render({
        candidates: [candidate({ id: 'a' })],
      });
      const seen: string[] = [];
      component.selectRow.subscribe((id) => seen.push(id));

      const card = el.querySelector<HTMLElement>(
        '[data-testid="skills-candidate-row"] [role="button"]',
      );
      card?.click();

      expect(seen).toEqual(['a']);
    });

    it('emits toggleSelect but never selectRow from the bulk checkbox', () => {
      const { el, fixture, component } = render({
        candidates: [candidate({ id: 'a' })],
      });
      const toggled: string[] = [];
      const opened: string[] = [];
      component.toggleSelect.subscribe((id) => toggled.push(id));
      component.selectRow.subscribe((id) => opened.push(id));

      const box = el.querySelector<HTMLInputElement>(
        '[data-testid="skills-select-row"]',
      );
      box?.click();
      fixture.detectChanges();

      expect(toggled).toEqual(['a']);
      expect(opened).toEqual([]);
    });

    it('checks select-all only when every candidate is bulk-selected', () => {
      const all = new Set(['a', 'b']);
      const { el } = render({
        candidates: [candidate({ id: 'a' }), candidate({ id: 'b' })],
        selectedIds: all,
      });
      const box = el.querySelector<HTMLInputElement>(
        '[data-testid="skills-select-all"]',
      );
      expect(box?.checked).toBe(true);
    });
  });

  describe('actions', () => {
    it('emits promote with the originating candidate', () => {
      const { el, component } = render({
        candidates: [candidate({ id: 'a', name: 'skill a' })],
      });
      const seen: SkillCandidateAction[] = [];
      component.promote.subscribe((a) => seen.push(a));

      el.querySelector<HTMLButtonElement>(
        '[data-testid="skills-promote-btn"]',
      )?.click();

      expect(seen.length).toBe(1);
      expect(seen[0].candidate.id).toBe('a');
    });

    it('disables the action that would be a no-op for the current status', () => {
      const { el } = render({
        candidates: [candidate({ status: 'promoted' })],
      });

      expect(
        el.querySelector<HTMLButtonElement>(
          '[data-testid="skills-promote-btn"]',
        )?.disabled,
      ).toBe(true);
      expect(
        el.querySelector<HTMLButtonElement>('[data-testid="skills-reject-btn"]')
          ?.disabled,
      ).toBe(false);
    });

    it('offers pinning only for promoted candidates', () => {
      const pending = render({
        candidates: [candidate({ status: 'candidate' })],
      });
      expect(
        pending.el.querySelector('[data-testid="skills-pin-btn"]'),
      ).toBeNull();

      const promoted = render({
        candidates: [candidate({ status: 'promoted', pinned: true })],
      });
      expect(
        promoted.el
          .querySelector('[data-testid="skills-pin-btn"]')
          ?.textContent?.trim(),
      ).toBe('Unpin');
    });

    it('disables every action while an operation is in flight', () => {
      const { el } = render({
        candidates: [candidate()],
        loading: true,
      });

      const buttons = el.querySelectorAll<HTMLButtonElement>(
        '[data-testid="skills-candidate-row"] button',
      );
      expect(buttons.length).toBeGreaterThan(0);
      expect(Array.from(buttons).every((b) => b.disabled)).toBe(true);
    });
  });

  // ── P1-1: an unscored candidate never renders a number ────────────────────

  describe('judge badge (P1-1)', () => {
    it('renders an "unscored" badge and NO score node when judgeScore is null', () => {
      const { el } = render({
        candidates: [candidate({ judgeStatus: 'unscored', judgeScore: null })],
      });

      const badge = el.querySelector(
        '[data-testid="skills-candidate-judge-badge"]',
      );
      expect(badge).not.toBeNull();
      expect(badge?.textContent?.trim()).toBe('unscored');

      // The whole point of the phase: a fabricated 0 is indistinguishable from
      // a genuine bottom score, so there must be no number at all.
      expect(
        el.querySelector('[data-testid="skills-candidate-judge-score"]'),
      ).toBeNull();
    });

    it('never prints a 0 anywhere in the judge block of an unscored candidate', () => {
      const { el } = render({
        candidates: [
          candidate({
            judgeStatus: 'unscored',
            judgeScore: null,
            judgeReason: 'rate limited',
            judgeCriteria: null,
            successCount: 0,
            failureCount: 0,
          }),
        ],
      });

      const badge = el.querySelector(
        '[data-testid="skills-candidate-judge-badge"]',
      );
      const judgeBlock = badge?.closest('div')?.parentElement;
      expect(judgeBlock?.textContent ?? '').not.toContain('0');
    });

    it('surfaces the failure text as the reason for an unscored candidate', () => {
      const { el } = render({
        candidates: [
          candidate({
            judgeStatus: 'unscored',
            judgeScore: null,
            judgeReason: 'judge call timed out',
          }),
        ],
      });

      expect(
        el
          .querySelector('[data-testid="skills-candidate-judge-reason"]')
          ?.textContent?.trim(),
      ).toBe('judge call timed out');
    });

    it('renders the score node with the exact score when the candidate IS scored', () => {
      const { el } = render({
        candidates: [candidate({ judgeStatus: 'scored', judgeScore: 7.5 })],
      });

      expect(
        el
          .querySelector('[data-testid="skills-candidate-judge-badge"]')
          ?.textContent?.trim(),
      ).toBe('scored');
      expect(
        el
          .querySelector('[data-testid="skills-candidate-judge-score"]')
          ?.textContent?.trim(),
      ).toBe('7.5');
    });

    it('renders a genuine zero score, which is NOT the same as unscored', () => {
      const { el } = render({
        candidates: [candidate({ judgeStatus: 'scored', judgeScore: 0 })],
      });

      expect(
        el
          .querySelector('[data-testid="skills-candidate-judge-score"]')
          ?.textContent?.trim(),
      ).toBe('0');
    });

    it('renders a "disabled" badge with no score when the gate was off', () => {
      const { el } = render({
        candidates: [candidate({ judgeStatus: 'disabled', judgeScore: null })],
      });

      expect(
        el
          .querySelector('[data-testid="skills-candidate-judge-badge"]')
          ?.textContent?.trim(),
      ).toBe('disabled');
      expect(
        el.querySelector('[data-testid="skills-candidate-judge-score"]'),
      ).toBeNull();
    });

    it('renders no judge block at all when judgeStatus is null', () => {
      const { el } = render({ candidates: [candidate({ judgeStatus: null })] });

      expect(
        el.querySelector('[data-testid="skills-candidate-judge-badge"]'),
      ).toBeNull();
      expect(
        el.querySelector('[data-testid="skills-candidate-judge-score"]'),
      ).toBeNull();
    });
  });

  // ── P1-2: the five-criterion scorecard ────────────────────────────────────

  describe('judge scorecard (P1-2)', () => {
    const SCORED = {
      judgeStatus: 'scored' as const,
      judgeScore: 8,
      judgeCriteria: {
        novelty: 7,
        actionability: 9,
        scope: 6,
        generalization: 8,
        triggerClarity: 10,
      },
    };

    it('renders exactly five criterion nodes for a scored summary', () => {
      const { el } = render({ candidates: [candidate(SCORED)] });

      expect(
        el.querySelectorAll('[data-testid="skills-candidate-criterion"]')
          .length,
      ).toBe(5);
    });

    it('renders the correct label and value for every criterion', () => {
      const { el } = render({ candidates: [candidate(SCORED)] });

      const rendered = Array.from(
        el.querySelectorAll('[data-testid="skills-candidate-criterion"]'),
      ).map((node) => ({
        label: node.querySelector('dt')?.textContent?.trim(),
        value: node.querySelector('dd')?.textContent?.trim(),
      }));

      expect(rendered).toEqual([
        { label: 'Novelty', value: '7' },
        { label: 'Actionability', value: '9' },
        { label: 'Scope', value: '6' },
        { label: 'Generalization', value: '8' },
        { label: 'Trigger clarity', value: '10' },
      ]);
    });

    it('renders an em dash for an individual criterion the judge left null', () => {
      const { el } = render({
        candidates: [
          candidate({
            ...SCORED,
            judgeCriteria: { ...SCORED.judgeCriteria, scope: null },
          }),
        ],
      });

      const scope = el.querySelector(
        '[data-testid="skills-candidate-criterion"][data-criterion="scope"]',
      );
      expect(scope?.querySelector('dd')?.textContent?.trim()).toBe('—');
    });

    it('renders no scorecard at all when judgeCriteria is null', () => {
      const { el } = render({
        candidates: [
          candidate({
            judgeStatus: 'scored',
            judgeScore: 8,
            judgeCriteria: null,
          }),
        ],
      });

      expect(
        el.querySelectorAll('[data-testid="skills-candidate-criterion"]')
          .length,
      ).toBe(0);
      expect(
        el.querySelector('[data-testid="skills-candidate-scorecard"]'),
      ).toBeNull();
    });
  });

  // ── P1-10 (b): the title is never the prompt-echo slug ────────────────────

  describe('candidate title (P1-10 part b)', () => {
    it('renders displayName when the namer has produced one', () => {
      const { el } = render({
        candidates: [
          candidate({
            name: 'help-me-refactor-the-jest-configs-please',
            displayName: 'Share one Jest preset across libs',
          }),
        ],
      });

      expect(
        el
          .querySelector('[data-testid="skills-candidate-title"]')
          ?.textContent?.trim(),
      ).toBe('Share one Jest preset across libs');
    });

    it('falls back to "Captured workflow · date" — NEVER the raw slug', () => {
      const slug = 'help-me-refactor-the-jest-configs-please';
      const createdAt = new Date(2026, 7, 13, 10, 30).getTime();
      const { el } = render({
        candidates: [candidate({ name: slug, displayName: null, createdAt })],
      });

      const title = el.querySelector('[data-testid="skills-candidate-title"]');
      const text = title?.textContent ?? '';

      expect(text).toContain('Captured workflow · 2026-08-13');
      // The slug is a prompt fragment. It must not leak into the title.
      expect(text).not.toContain(slug);
      expect(text).not.toContain('refactor');
    });

    it('keeps the pinned marker alongside the fallback title', () => {
      const { el } = render({
        candidates: [candidate({ displayName: null, pinned: true })],
      });

      const text =
        el.querySelector('[data-testid="skills-candidate-title"]')
          ?.textContent ?? '';
      expect(text).toContain('Captured workflow');
      expect(text).toContain('pinned');
    });

    it('treats a whitespace-only displayName as absent', () => {
      const { el } = render({
        candidates: [candidate({ name: 'some-slug', displayName: '   ' })],
      });

      const text =
        el.querySelector('[data-testid="skills-candidate-title"]')
          ?.textContent ?? '';
      expect(text).toContain('Captured workflow');
      expect(text).not.toContain('some-slug');
    });

    it('uses the title, not the slug, in the row and checkbox aria labels', () => {
      const slug = 'help-me-refactor-the-jest-configs-please';
      const { el } = render({
        candidates: [
          candidate({ name: slug, displayName: 'Share one Jest preset' }),
        ],
      });

      const card = el.querySelector('ptah-native-card [role="button"]');
      expect(card).not.toBeNull();
      expect(card?.getAttribute('aria-label')).toBe(
        'Open details for Share one Jest preset',
      );

      const checkbox = el.querySelector('[data-testid="skills-select-row"]');
      expect(checkbox?.getAttribute('aria-label')).toBe(
        'Select Share one Jest preset',
      );
    });
  });
});
