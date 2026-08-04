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
});
