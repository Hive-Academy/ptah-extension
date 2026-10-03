import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { AgentScorecard, CloneSummary } from '@ptah-extension/shared';

import { CloneCardComponent } from './clone-card.component';
import type { AgentSyncChip } from './agent-sync-chips';

function clone(overrides: Partial<CloneSummary> = {}): CloneSummary {
  return {
    slug: 'deep-research',
    kind: 'skill',
    cloneStatus: 'clone',
    diverged: false,
    invocationCount: 10,
    successRate: 0.8,
    lastEnhancedAt: null,
    historyCount: 2,
    pendingSourceHash: null,
    enhanceMinInvocations: 5,
    enhanceCooldownUntil: null,
    ...overrides,
  };
}

describe('CloneCardComponent', () => {
  let fixture: ComponentFixture<CloneCardComponent>;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(testId: string): T | null =>
    el().querySelector<T>(`[data-testid="${testId}"]`);

  function render(
    c: CloneSummary,
    opts: { scorecard?: AgentScorecard | null; busy?: boolean } = {},
  ): void {
    fixture = TestBed.createComponent(CloneCardComponent);
    fixture.componentRef.setInput('clone', c);
    fixture.componentRef.setInput('scorecard', opts.scorecard ?? null);
    fixture.componentRef.setInput('busy', opts.busy ?? false);
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CloneCardComponent] });
  });

  it('renders the slug and the status label', () => {
    render(clone({ cloneStatus: 'authored' }));
    expect(el().textContent).toContain('deep-research');
    expect(q('clones-status-badge')?.textContent?.trim()).toBe('authored');
  });

  it('shows divergence as the status regardless of the stored value', () => {
    render(clone({ cloneStatus: 'clone', diverged: true }));
    expect(q('clones-status-badge')?.textContent?.trim()).toBe('diverged');
  });

  // ── Empty state ──────────────────────────────────────────────────────────

  it('reads as empty (one sentence) rather than four em dashes when unused', () => {
    render(
      clone({
        invocationCount: 0,
        successRate: 0,
        lastEnhancedAt: null,
        historyCount: 0,
      }),
    );
    expect(q('clone-card-metrics')).toBeNull();
    expect(q('clone-card-unused')?.textContent).toContain('Never invoked yet');
    expect(q('clone-metric-invocations')).toBeNull();
    expect(q('clone-metric-success')).toBeNull();
    expect(q('clone-metric-last-enhanced')).toBeNull();
    expect(q('clone-metric-history')).toBeNull();
  });

  it('renders only the metrics that carry data', () => {
    render(
      clone({
        invocationCount: 7,
        successRate: 0.5,
        lastEnhancedAt: null,
        historyCount: 0,
      }),
    );
    expect(q('clone-metric-invocations')?.textContent?.trim()).toBe('7');
    expect(q('clone-metric-success')?.textContent?.trim()).toBe('50%');
    expect(q('clone-metric-last-enhanced')).toBeNull();
    expect(q('clone-metric-history')).toBeNull();
  });

  it('renders history and last-enhanced when present', () => {
    render(
      clone({ historyCount: 3, lastEnhancedAt: Date.now() - 3 * 60 * 60_000 }),
    );
    expect(q('clone-metric-history')?.textContent?.trim()).toBe('3 snapshots');
    expect(q('clone-metric-last-enhanced')?.textContent?.trim()).toBe('3h ago');
  });

  // ── Contextual actions ───────────────────────────────────────────────────

  it('disables Enhance below the invocation threshold and puts the reason on the control', () => {
    render(clone({ invocationCount: 0, enhanceMinInvocations: 5 }));
    const btn = q<HTMLButtonElement>('clones-enhance-btn');
    expect(btn?.disabled).toBe(true);
    expect(btn?.getAttribute('title')).toContain('5 recorded runs');
    expect(q('clones-enhance-hint')?.textContent?.trim()).toBe('0/5 runs');
  });

  it('disables Enhance during cooldown and states the remaining time', () => {
    render(clone({ enhanceCooldownUntil: Date.now() + 3 * 60 * 60_000 }));
    const btn = q<HTMLButtonElement>('clones-enhance-btn');
    expect(btn?.disabled).toBe(true);
    expect(btn?.getAttribute('title')).toMatch(/available again in \d+h/);
  });

  it('enables Enhance when eligible', () => {
    render(clone());
    expect(q<HTMLButtonElement>('clones-enhance-btn')?.disabled).toBe(false);
    expect(q('clones-enhance-hint')?.textContent?.trim()).toBe('ready');
  });

  it('disables Revert when there are no history snapshots', () => {
    render(clone({ historyCount: 0 }));
    const btn = q<HTMLButtonElement>('clones-revert-btn');
    expect(btn?.disabled).toBe(true);
    expect(btn?.getAttribute('title')).toContain('No history snapshots');
  });

  it('offers no divergence actions for a healthy entry', () => {
    render(clone());
    expect(q('clones-rebase-btn')).toBeNull();
    expect(q('clones-keep-btn')).toBeNull();
    expect(q('clone-card-upstream-note')).toBeNull();
  });

  it('offers Rebase and Keep for a diverged plugin clone', () => {
    render(clone({ diverged: true, cloneStatus: 'diverged' }));
    expect(q('clones-rebase-btn')).toBeTruthy();
    expect(q('clones-keep-btn')).toBeTruthy();
    expect(q('clone-card-upstream-note')).toBeNull();
  });

  it('never offers Rebase for a diverged authored entry, and explains why on the card', () => {
    render(clone({ diverged: true, cloneStatus: 'authored' }));
    expect(q('clones-rebase-btn')).toBeNull();
    expect(q('clones-keep-btn')).toBeTruthy();
    expect(q('clone-card-upstream-note')?.textContent).toContain(
      'no upstream source',
    );
  });

  it('carries the "changes no file content" warning on Keep mine', () => {
    render(clone({ diverged: true }));
    expect(q('clones-keep-btn')?.getAttribute('title')).toContain(
      'changes no file content',
    );
  });

  // ── Events ───────────────────────────────────────────────────────────────

  it('emits opened when the card surface is activated', () => {
    render(clone());
    const opened: CloneSummary[] = [];
    fixture.componentInstance.opened.subscribe((c) => opened.push(c));
    (el().querySelector('[role="button"]') as HTMLElement).click();
    expect(opened.map((c) => c.slug)).toEqual(['deep-research']);
  });

  it('does NOT emit opened when an action button inside the card is pressed', () => {
    render(clone());
    const opened: CloneSummary[] = [];
    const enhanced: CloneSummary[] = [];
    fixture.componentInstance.opened.subscribe((c) => opened.push(c));
    fixture.componentInstance.enhance.subscribe((c) => enhanced.push(c));

    q<HTMLButtonElement>('clones-enhance-btn')?.click();

    expect(enhanced.length).toBe(1);
    expect(opened.length).toBe(0);
  });

  it('emits rebase and keep from their buttons', () => {
    render(clone({ diverged: true, cloneStatus: 'diverged' }));
    const events: string[] = [];
    fixture.componentInstance.rebase.subscribe(() => events.push('rebase'));
    fixture.componentInstance.keep.subscribe(() => events.push('keep'));

    q<HTMLButtonElement>('clones-rebase-btn')?.click();
    q<HTMLButtonElement>('clones-keep-btn')?.click();

    expect(events).toEqual(['rebase', 'keep']);
  });

  it('disables every action and shows a spinner while busy', () => {
    render(clone({ diverged: true, cloneStatus: 'diverged' }), { busy: true });
    expect(q('clone-card-busy')).toBeTruthy();
    expect(q<HTMLButtonElement>('clones-enhance-btn')?.disabled).toBe(true);
    expect(q<HTMLButtonElement>('clones-revert-btn')?.disabled).toBe(true);
    expect(q<HTMLButtonElement>('clones-rebase-btn')?.disabled).toBe(true);
    expect(q<HTMLButtonElement>('clones-keep-btn')?.disabled).toBe(true);
  });

  // ── Provider sync chips and ownership (TASK_2026_609) ────────────────────

  describe('sync chips', () => {
    const chips: AgentSyncChip[] = [
      { target: 'claude', state: 'source', label: 'source', path: null },
      {
        target: 'codex',
        state: 'in-sync',
        label: 'in sync',
        path: '.codex/agents/planner.toml',
      },
      {
        target: 'cursor',
        state: 'failed',
        label: 'failed',
        path: '.cursor/agents/planner.md',
        reason: 'EACCES: permission denied',
      },
    ];

    function renderAgent(syncChips: AgentSyncChip[], notOwned = false): void {
      fixture = TestBed.createComponent(CloneCardComponent);
      fixture.componentRef.setInput(
        'clone',
        clone({ kind: 'agent', slug: 'planner' }),
      );
      fixture.componentRef.setInput('syncChips', syncChips);
      fixture.componentRef.setInput('notOwned', notOwned);
      fixture.detectChanges();
    }

    it('renders nothing new with the default (empty) inputs', () => {
      render(clone({ kind: 'agent', slug: 'planner' }));
      expect(q('clone-card-sync-chips')).toBeNull();
      expect(q('clone-card-sync-failed')).toBeNull();
      expect(q('clone-card-not-owned')).toBeNull();
    });

    it('renders one chip per provider, in the given order, with its state', () => {
      renderAgent(chips);
      const rendered = Array.from(
        el().querySelectorAll('[data-testid="clone-card-sync-chip"]'),
      );
      expect(
        rendered.map((c) => c.textContent?.replace(/\s+/g, ' ').trim()),
      ).toEqual(['claude source', 'codex in sync', 'cursor failed']);
      expect(rendered.map((c) => c.getAttribute('data-state'))).toEqual([
        'source',
        'in-sync',
        'failed',
      ]);
      expect(rendered[1].getAttribute('title')).toContain(
        '.codex/agents/planner.toml',
      );
    });

    it('spells out the path and reason of a failed write on the card', () => {
      renderAgent(chips);
      const failed = q('clone-card-sync-failed')?.textContent ?? '';
      expect(failed).toContain('.cursor/agents/planner.md');
      expect(failed).toContain('EACCES: permission denied');
      expect(
        el().querySelectorAll('[data-testid="clone-card-sync-failed"]'),
      ).toHaveLength(1);
    });

    it('shows the not-owned note only when asked', () => {
      renderAgent([], true);
      expect(q('clone-card-not-owned')?.textContent).toContain(
        'no source file for this agent',
      );
    });

    it('keeps its outputs: the card still opens with chips present', () => {
      renderAgent(chips);
      const opened: CloneSummary[] = [];
      fixture.componentInstance.opened.subscribe((c) => opened.push(c));
      (el().querySelector('[role="button"]') as HTMLElement).click();
      expect(opened.map((c) => c.slug)).toEqual(['planner']);
    });
  });

  // ── Scorecard ────────────────────────────────────────────────────────────

  it('renders the scorecard badge only for agent-kind entries', () => {
    render(clone({ kind: 'skill' }));
    expect(q('scorecard-badge')).toBeNull();

    render(clone({ kind: 'agent', slug: 'planner' }));
    expect(q('scorecard-badge')).toBeTruthy();
    expect(q('scorecard-success')?.textContent?.trim()).toBe('no data yet');
  });
});
