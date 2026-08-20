/**
 * SkillDigestPanelComponent — TASK_2026_180 B4.5.1.
 *
 * Two properties are locked here, and both exist to catch a specific regression
 * rather than to describe the markup.
 *
 * ### 1. `null` is NEVER `0`
 *
 * `evidence.winRate` is `number | null` and the two values are different
 * statements: `null` means nobody measured the skill, `0` means it WAS measured
 * and lost every measured session. `0` is falsy, so a single `||` on the render
 * path retitles every measured failure as an absent measurement — and the
 * output is still a string, still renders, and nothing downstream can tell.
 *
 * So the three cases are asserted SEPARATELY and with different expectations:
 *
 *  - `winRate: null` → the WORDS `not measured`, and no digit.
 *  - `winRate: 0`    → `0%`, and explicitly NOT the words.
 *  - `winRate: 0.5`  → `50%`.
 *
 * A spec covering only `null` and a positive number would pass against the `||`
 * bug, which is the whole reason the middle case is written out.
 *
 * The same falsy trap is asserted for a `score` of `0` and for an
 * `evidence.counts` entry of `0`: both are measurements that happen to be zero,
 * and both must render rather than vanish.
 *
 * ### 2. The order is the backend's, not the component's
 *
 * `skillSynthesis:digest` returns items already sorted by `score` DESCENDING,
 * and the curator's tie-break is what makes two identical sweeps produce
 * identical digests. The panel must render the order it is handed. Both
 * directions are asserted — a descending input renders descending, and a
 * deliberately mis-ordered input renders MIS-ORDERED — because a component that
 * defensively re-sorted would pass the first assertion while silently owning an
 * ordering contract it must not own.
 */
import { TestBed } from '@angular/core/testing';
import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import type {
  SkillDigestEvidence,
  SkillDigestItem,
  SkillDigestItemKind,
} from '@ptah-extension/shared';

import { SkillDigestPanelComponent } from './skill-digest-panel.component';

/**
 * `evidence` is overridable FIELD BY FIELD, which `Partial<SkillDigestItem>`
 * alone would not allow — it makes `evidence` wholly optional, not partial, so
 * a test overriding only `winRate` would fail to typecheck while still passing
 * under Jest. This lib's specs are excluded from `tsconfig.lib.json`, so that
 * drift is invisible to both CI gates and has to be designed out here.
 */
type DigestItemOverrides = Partial<Omit<SkillDigestItem, 'evidence'>> & {
  readonly evidence?: Partial<SkillDigestEvidence>;
};

function digestItem(overrides: DigestItemOverrides = {}): SkillDigestItem {
  const { evidence, ...rest } = overrides;
  return {
    kind: 'missed-trigger' as SkillDigestItemKind,
    title: 'A skill that never fired',
    rationale: 'Three sessions matched the trigger and none invoked it.',
    score: 0.5,
    ...rest,
    evidence: {
      sessionIds: ['sess-a'],
      counts: { missedSessions: 3 },
      winRate: null,
      ...evidence,
    },
  };
}

@Component({
  selector: 'ptah-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SkillDigestPanelComponent],
  template: `<ptah-skill-digest-panel
    [items]="items()"
    [loading]="loading()"
  />`,
})
class HostComponent {
  public readonly items = signal<readonly SkillDigestItem[]>([]);
  public readonly loading = signal<boolean>(false);
}

function mount() {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  return {
    fixture,
    host: fixture.componentInstance,
    root: fixture.nativeElement as HTMLElement,
  };
}

function itemNodes(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('[data-testid="skills-digest-item"]'),
  );
}

/** Whitespace-collapsed text, so template line-wrapping cannot break a match. */
function text(node: Element | null | undefined): string {
  return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function winRateOf(node: HTMLElement): string {
  return text(node.querySelector('[data-testid="skills-digest-win-rate"]'));
}

function titlesOf(root: HTMLElement): string[] {
  return itemNodes(root).map((n) =>
    text(n.querySelector('[data-testid="skills-digest-title"]')),
  );
}

function sessionsOf(node: HTMLElement): string[] {
  return Array.from(
    node.querySelectorAll<HTMLElement>('[data-testid="skills-digest-session"]'),
  ).map((n) => text(n));
}

function countsOf(node: HTMLElement): string[] {
  return Array.from(
    node.querySelectorAll<HTMLElement>(
      '[data-testid="skills-digest-evidence-count"]',
    ),
  ).map((n) => text(n));
}

describe('SkillDigestPanelComponent — ranking', () => {
  it('renders one node per ranked item, in the order it is given', () => {
    const { fixture, host, root } = mount();
    host.items.set([
      digestItem({ title: 'first', score: 0.91 }),
      digestItem({ title: 'second', score: 0.62 }),
      digestItem({ title: 'third', score: 0.4 }),
      digestItem({ title: 'fourth', score: 0.11 }),
    ]);
    fixture.detectChanges();

    expect(itemNodes(root).length).toBe(4);
    expect(titlesOf(root)).toEqual(['first', 'second', 'third', 'fourth']);
    expect(
      itemNodes(root).map((n) =>
        text(n.querySelector('[data-testid="skills-digest-score"]')),
      ),
    ).toEqual(['score 0.91', 'score 0.62', 'score 0.40', 'score 0.11']);
  });

  it('renders exactly as many nodes as there are seeded items', () => {
    const { fixture, host, root } = mount();
    for (const count of [1, 3, 9]) {
      host.items.set(
        Array.from({ length: count }, (_, i) =>
          digestItem({ title: 'item-' + i, score: 1 - i / 100 }),
        ),
      );
      fixture.detectChanges();
      expect(itemNodes(root).length).toBe(count);
      expect(
        text(root.querySelector('[data-testid="skills-digest-count"]')),
      ).toBe(count + ' ranked');
    }
  });

  /**
   * The backend owns the order, so the panel must be transparent to it. A
   * component that re-sorted "to be safe" would repair this input and pass the
   * descending test above while quietly taking over a contract — and it would
   * drop the curator's kind-then-title tie-break, which is what makes two
   * identical sweeps produce identical digests.
   */
  it('does NOT re-sort — a mis-ordered input renders mis-ordered', () => {
    const { fixture, host, root } = mount();
    host.items.set([
      digestItem({ title: 'low', score: 0.1 }),
      digestItem({ title: 'high', score: 0.9 }),
      digestItem({ title: 'mid', score: 0.5 }),
    ]);
    fixture.detectChanges();

    expect(titlesOf(root)).toEqual(['low', 'high', 'mid']);
  });

  it('says there is nothing to look at rather than rendering an empty list', () => {
    const { root } = mount();
    expect(itemNodes(root).length).toBe(0);
    expect(
      text(root.querySelector('[data-testid="skills-digest-empty"]')),
    ).toBe('Nothing to look at this week.');
  });

  it('distinguishes a sweep in flight from a sweep that found nothing', () => {
    const { fixture, host, root } = mount();
    host.loading.set(true);
    fixture.detectChanges();

    expect(
      root.querySelector('[data-testid="skills-digest-loading"]'),
    ).not.toBeNull();
    expect(
      root.querySelector('[data-testid="skills-digest-empty"]'),
    ).toBeNull();

    host.loading.set(false);
    fixture.detectChanges();
    expect(
      root.querySelector('[data-testid="skills-digest-empty"]'),
    ).not.toBeNull();
  });

  it('names each sweep that filed an item', () => {
    const { fixture, host, root } = mount();
    host.items.set([
      digestItem({ kind: 'missed-trigger', title: 'a' }),
      digestItem({ kind: 'friction-opportunity', title: 'b' }),
      digestItem({ kind: 'win-rate', title: 'c' }),
      digestItem({ kind: 'memory-signal', title: 'd' }),
    ]);
    fixture.detectChanges();

    expect(
      itemNodes(root).map((n) =>
        text(n.querySelector('[data-testid="skills-digest-kind"]')),
      ),
    ).toEqual(['missed trigger', 'friction', 'win rate', 'memory signal']);
  });
});

describe('SkillDigestPanelComponent — win rate: null is NEVER 0', () => {
  it('renders an UNMEASURED win rate as the words "not measured"', () => {
    const { fixture, host, root } = mount();
    host.items.set([digestItem({ evidence: { winRate: null } })]);
    fixture.detectChanges();

    const [node] = itemNodes(root);
    expect(winRateOf(node)).toBe('win rate not measured');
    // The words, and no digit at all — `0%` here would state a measurement
    // that was never taken.
    expect(winRateOf(node)).not.toMatch(/\d/);
  });

  /**
   * THE mutation target. `winRate || 'not measured'` passes every other test in
   * this file and fails only this one, because `0` is the sole falsy value the
   * field can legitimately carry.
   */
  it('renders a MEASURED zero win rate as 0%, not as "not measured"', () => {
    const { fixture, host, root } = mount();
    host.items.set([digestItem({ evidence: { winRate: 0 } })]);
    fixture.detectChanges();

    const [node] = itemNodes(root);
    expect(winRateOf(node)).toBe('win rate 0%');
    expect(winRateOf(node)).not.toContain('not measured');
  });

  it('renders a middling win rate as a percentage', () => {
    const { fixture, host, root } = mount();
    host.items.set([digestItem({ evidence: { winRate: 0.5 } })]);
    fixture.detectChanges();

    expect(winRateOf(itemNodes(root)[0])).toBe('win rate 50%');
  });

  it('keeps null, zero and measured apart within one digest', () => {
    // The three cases side by side: whatever the render path does, it cannot
    // satisfy this by accident.
    const { fixture, host, root } = mount();
    host.items.set([
      digestItem({ title: 'unmeasured', evidence: { winRate: null } }),
      digestItem({ title: 'lost every time', evidence: { winRate: 0 } }),
      digestItem({ title: 'half', evidence: { winRate: 0.5 } }),
      digestItem({ title: 'perfect', evidence: { winRate: 1 } }),
    ]);
    fixture.detectChanges();

    expect(itemNodes(root).map(winRateOf)).toEqual([
      'win rate not measured',
      'win rate 0%',
      'win rate 50%',
      'win rate 100%',
    ]);
  });

  it('marks only the unmeasured item as unmeasured for styling', () => {
    // The tone hangs off `winRate !== null`, not off truthiness — a measured
    // zero must look like the result it is.
    const { fixture, host, root } = mount();
    host.items.set([
      digestItem({ title: 'unmeasured', evidence: { winRate: null } }),
      digestItem({ title: 'zero', evidence: { winRate: 0 } }),
    ]);
    fixture.detectChanges();

    const muted = itemNodes(root).map((n) =>
      n
        .querySelector('[data-testid="skills-digest-win-rate"]')
        ?.classList.contains('text-base-content-muted'),
    );
    expect(muted).toEqual([true, false]);
  });
});

describe('SkillDigestPanelComponent — evidence', () => {
  it('renders the session ids behind an item', () => {
    const { fixture, host, root } = mount();
    host.items.set([
      digestItem({
        evidence: { sessionIds: ['sess-a', 'sess-b', 'sess-c'] },
      }),
    ]);
    fixture.detectChanges();

    const [node] = itemNodes(root);
    expect(sessionsOf(node)).toEqual(['sess-a', 'sess-b', 'sess-c']);
    expect(
      text(node.querySelector('[data-testid="skills-digest-session-count"]')),
    ).toBe('3 sessions');
    // The full id stays reachable even though the chip truncates.
    expect(
      node
        .querySelector<HTMLElement>('[data-testid="skills-digest-session"]')
        ?.getAttribute('title'),
    ).toBe('sess-a');
  });

  it('folds a long evidence list into a counter without losing the total', () => {
    const { fixture, host, root } = mount();
    host.items.set([
      digestItem({
        evidence: {
          sessionIds: Array.from({ length: 10 }, (_, i) => 'sess-' + i),
        },
      }),
    ]);
    fixture.detectChanges();

    const [node] = itemNodes(root);
    expect(sessionsOf(node).length).toBe(6);
    expect(
      text(
        node.querySelector('[data-testid="skills-digest-session-overflow"]'),
      ),
    ).toBe('+4 more');
    expect(
      text(node.querySelector('[data-testid="skills-digest-session-count"]')),
    ).toBe('10 sessions');
  });

  it('omits the overflow counter when every session is shown', () => {
    const { fixture, host, root } = mount();
    host.items.set([
      digestItem({ evidence: { sessionIds: ['sess-a', 'sess-b'] } }),
    ]);
    fixture.detectChanges();

    expect(
      itemNodes(root)[0].querySelector(
        '[data-testid="skills-digest-session-overflow"]',
      ),
    ).toBeNull();
  });

  it('renders every counts entry, humanising the key', () => {
    const { fixture, host, root } = mount();
    host.items.set([
      digestItem({
        evidence: { counts: { missedSessions: 3, retry: 7, memoryHits: 2 } },
      }),
    ]);
    fixture.detectChanges();

    expect(countsOf(itemNodes(root)[0])).toEqual([
      'missed sessions 3',
      'retry 7',
      'memory hits 2',
    ]);
  });

  /**
   * The same falsy trap one level down. A `0` tally is a measurement — "we
   * looked and found none" — and filtering it out would make the receipts
   * disagree with the rationale printed above them.
   */
  it('keeps a counts entry whose value is zero', () => {
    const { fixture, host, root } = mount();
    host.items.set([
      digestItem({ evidence: { counts: { missedSessions: 0, retry: 4 } } }),
    ]);
    fixture.detectChanges();

    expect(countsOf(itemNodes(root)[0])).toEqual([
      'missed sessions 0',
      'retry 4',
    ]);
  });

  it('renders the rationale as measured facts beside the title', () => {
    const { fixture, host, root } = mount();
    host.items.set([
      digestItem({
        title: 'docker-compose skill never fired',
        rationale:
          '4 sessions edited compose files; the skill was not invoked.',
      }),
    ]);
    fixture.detectChanges();

    const [node] = itemNodes(root);
    expect(
      text(node.querySelector('[data-testid="skills-digest-title"]')),
    ).toBe('docker-compose skill never fired');
    expect(
      text(node.querySelector('[data-testid="skills-digest-rationale"]')),
    ).toBe('4 sessions edited compose files; the skill was not invoked.');
  });

  /** A zero-scored item still earned its place in the ranking. */
  it('renders a score of zero rather than dropping the figure', () => {
    const { fixture, host, root } = mount();
    host.items.set([digestItem({ score: 0 })]);
    fixture.detectChanges();

    expect(
      text(
        itemNodes(root)[0].querySelector('[data-testid="skills-digest-score"]'),
      ),
    ).toBe('score 0.00');
  });
});
