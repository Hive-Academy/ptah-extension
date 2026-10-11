import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type {
  SessionBudgetState,
  SessionHandoverState,
} from '@ptah-extension/shared';
import { SessionBudgetBannerComponent } from './session-budget-banner.component';

const BASE: SessionBudgetState = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  stage: 'normal',
  unit: 'tokens',
  measure: 'tokens',
  used: 25_000_000,
  limit: 50_000_000,
  percent: 50,
  lowerBound: false,
  revision: 7,
  compactions: 0,
  extensions: 0,
  blocked: false,
};

const HANDOFF = {
  path: '/workspace/.ptah/handoffs/source.md',
  chars: 6_000,
  truncated: false,
  writtenAt: 1,
};

describe('SessionBudgetBannerComponent', () => {
  let fixture: ComponentFixture<SessionBudgetBannerComponent>;

  function render(
    budget: SessionBudgetState | null,
    extra: {
      handover?: SessionHandoverState | null;
      preview?: string | null;
      previewFailed?: boolean;
      contextTokens?: number | null;
      usage?: readonly {
        readonly at: number;
        readonly used: number;
        readonly percent: number | null;
      }[];
      busy?: boolean;
    } = {},
  ): HTMLElement {
    TestBed.configureTestingModule({ imports: [SessionBudgetBannerComponent] });
    fixture = TestBed.createComponent(SessionBudgetBannerComponent);
    fixture.componentRef.setInput('budget', budget);
    if (extra.handover !== undefined) {
      fixture.componentRef.setInput('handover', extra.handover);
    }
    if (extra.preview !== undefined) {
      fixture.componentRef.setInput('preview', extra.preview);
    }
    if (extra.previewFailed !== undefined) {
      fixture.componentRef.setInput('previewFailed', extra.previewFailed);
    }
    if (extra.contextTokens !== undefined) {
      fixture.componentRef.setInput('contextTokens', extra.contextTokens);
    }
    if (extra.usage !== undefined) {
      fixture.componentRef.setInput('usage', extra.usage);
    }
    if (extra.busy !== undefined) {
      fixture.componentRef.setInput('busy', extra.busy);
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function banner(root: HTMLElement): HTMLElement | null {
    return root.querySelector('[data-testid="session-budget-banner"]');
  }

  function text(root: HTMLElement, testId: string): string {
    return (root.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function button(root: HTMLElement, label: string): HTMLButtonElement {
    const found = Array.from(root.querySelectorAll('button')).find(
      (candidate) => (candidate.textContent ?? '').trim() === label,
    );
    if (!found) throw new Error(`No button "${label}"`);
    return found;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('does not render a notification before the configured handoff stage', () => {
    expect(banner(render(null))).toBeNull();
    TestBed.resetTestingModule();
    expect(banner(render({ ...BASE, stage: 'tighten' }))).toBeNull();
    TestBed.resetTestingModule();
    expect(banner(render({ ...BASE, stage: 'normal' }))).toBeNull();
  });

  it('does not create a notification for a rotation advisory', () => {
    const root = render({
      ...BASE,
      rotation: { contextTokens: 210_000, threshold: 200_000 },
    });

    expect(banner(root)).toBeNull();
  });

  it('shows one message when the configured budget reaches handoff', () => {
    const root = render({
      ...BASE,
      stage: 'handoff',
      used: 40_000_000,
      limit: 50_000_000,
      percent: 80,
      handoff: HANDOFF,
    });

    expect(root.querySelectorAll('[data-testid="session-budget-banner"]')).toHaveLength(1);
    expect(text(root, 'session-budget-title')).toBe(
      'Preparing to continue in a new session…',
    );
    expect(text(root, 'session-budget-percent')).toBe('80%');
    expect(button(root, 'Continue now')).toBeInstanceOf(HTMLButtonElement);
  });

  it('updates the handoff notification in place at the limit', () => {
    const root = render({ ...BASE, stage: 'handoff', handoff: HANDOFF });
    const original = banner(root);

    fixture.componentRef.setInput('budget', {
      ...BASE,
      stage: 'limit',
      used: 50_000_000,
      percent: 100,
      blocked: true,
      handoff: HANDOFF,
    });
    fixture.detectChanges();

    expect(root.querySelectorAll('[data-testid="session-budget-banner"]')).toHaveLength(1);
    expect(banner(root)).toBe(original);
    expect(text(root, 'session-budget-title')).toBe('This session reached its budget');
    expect(text(root, 'session-budget-body')).toContain(
      'Limit reached — new turns are held until you continue',
    );
  });

  it('keeps a dismissed handoff hidden and restores one message at the limit', () => {
    const root = render({
      ...BASE,
      stage: 'handoff',
      handoff: HANDOFF,
      dismissedStage: 'handoff',
    });
    expect(banner(root)).toBeNull();

    fixture.componentRef.setInput('budget', {
      ...BASE,
      stage: 'limit',
      handoff: HANDOFF,
      dismissedStage: 'handoff',
      blocked: true,
    });
    fixture.detectChanges();

    expect(root.querySelectorAll('[data-testid="session-budget-banner"]')).toHaveLength(1);
    expect(text(root, 'session-budget-title')).toBe('This session reached its budget');
  });

  it('uses Continue now only while automatic handover has not armed', () => {
    const root = render({ ...BASE, stage: 'handoff', handoff: HANDOFF });
    const continueInNewSession = jest.fn();
    fixture.componentInstance.continueInNewSession.subscribe(continueInNewSession);

    button(root, 'Continue now').click();

    expect(continueInNewSession).toHaveBeenCalledTimes(1);
    expect(root.querySelectorAll('button')).toHaveLength(1);
  });

  // TASK_2026_627 Component 9: the waiting copy names the work in flight.
  describe('automatic handover waiting at the handoff stage', () => {
    const HANDOFF_BUDGET: SessionBudgetState = {
      ...BASE,
      stage: 'handoff',
      used: 40_000_000,
      percent: 80,
      handoff: HANDOFF,
    };
    const WAITING: SessionHandoverState = {
      operationId: 'handover-1',
      sourceSessionId: BASE.sessionId,
      reason: 'budget-auto',
      phase: 'waiting-for-turn-end',
      revision: 2,
      heldInputCount: 0,
      waitingFor: { subagents: 2, lanes: 1 },
    };
    const PLAIN_COPY =
      'Waiting for handover to start at 40.0M of 50.0M tokens. You can continue now if needed.';

    function buttons(root: HTMLElement): (string | undefined)[] {
      return Array.from(root.querySelectorAll('button')).map((item) =>
        item.textContent?.trim(),
      );
    }

    it('shows the subagent and lane counts and keeps Continue now', () => {
      const root = render(HANDOFF_BUDGET, { handover: WAITING });
      const continueInNewSession = jest.fn();
      fixture.componentInstance.continueInNewSession.subscribe(continueInNewSession);

      expect(text(root, 'session-budget-body')).toBe(
        'Waiting for 2 subagents and 1 CLI lane before continuing in a new session.',
      );
      expect(buttons(root)).toEqual(['Continue now', 'Cancel (keep working)']);
      const continueNow = button(root, 'Continue now');
      expect(continueNow.getAttribute('aria-label')).toBe(
        'Start new session from handoff',
      );
      continueNow.click();
      expect(continueInNewSession).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['a negative count', { subagents: -1, lanes: 1 }],
      ['a fractional count', { subagents: 1.5, lanes: 0 }],
      ['an infinite count', { subagents: Infinity, lanes: 0 }],
      ['NaN', { subagents: Number.NaN, lanes: 1 }],
      ['a non-number', { subagents: '2' as unknown as number, lanes: 1 }],
      ['nothing in flight', { subagents: 0, lanes: 0 }],
    ])('(a) falls back to the plain copy for %s', (_what, waitingFor) => {
      const root = render(HANDOFF_BUDGET, {
        handover: { ...WAITING, waitingFor },
      });

      expect(text(root, 'session-budget-body')).toBe(PLAIN_COPY);
      expect(buttons(root)).toEqual(['Continue now', 'Cancel (keep working)']);
    });

    it('falls back to the plain copy without waitingFor', () => {
      const root = render(HANDOFF_BUDGET, {
        handover: { ...WAITING, waitingFor: undefined },
      });

      expect(text(root, 'session-budget-body')).toBe(PLAIN_COPY);
    });

    it.each(['cancelled', 'armed'] as const)(
      '(b) a %s state with a stale waitingFor never shows waiting copy',
      (phase) => {
        const root = render(HANDOFF_BUDGET, {
          handover: { ...WAITING, phase, revision: 3 },
        });

        expect(text(root, 'session-budget-body')).toBe(PLAIN_COPY);
        expect(text(root, 'session-budget-body')).not.toContain('subagent');
      },
    );

    it('(b) a failed state with a stale waitingFor shows the failure, not waiting copy', () => {
      const root = render(HANDOFF_BUDGET, {
        handover: { ...WAITING, phase: 'failed', revision: 3, error: 'handover unavailable' },
      });

      expect(text(root, 'session-budget-title')).toBe('Could not continue in a new session');
      expect(text(root, 'session-budget-body')).toBe('handover unavailable');
    });

    it('(c) awaiting confirmation after the wait limit offers Continue now and Cancel', () => {
      const root = render(HANDOFF_BUDGET, {
        handover: { ...WAITING, phase: 'awaiting-confirmation', revision: 4, waitingFor: undefined },
      });
      const continueInNewSession = jest.fn();
      const cancel = jest.fn();
      fixture.componentInstance.continueInNewSession.subscribe(continueInNewSession);
      fixture.componentInstance.cancelHandover.subscribe(cancel);

      expect(text(root, 'session-budget-title')).toBe('Preparing to continue in a new session…');
      expect(text(root, 'session-budget-body')).toBe(
        'Work is still running in this session. Continue now in a new session, or cancel to keep working here.',
      );
      expect(buttons(root)).toEqual(['Continue now', 'Cancel (keep working)']);
      button(root, 'Continue now').click();
      button(root, 'Cancel (keep working)').click();
      expect(continueInNewSession).toHaveBeenCalledTimes(1);
      expect(cancel).toHaveBeenCalledTimes(1);
    });

    it('(c) a dismissed handoff still shows a handover awaiting confirmation', () => {
      const root = render(
        { ...HANDOFF_BUDGET, dismissedStage: 'handoff' },
        { handover: { ...WAITING, phase: 'awaiting-confirmation', revision: 4 } },
      );

      expect(banner(root)).not.toBeNull();
      expect(buttons(root)).toEqual(['Continue now', 'Cancel (keep working)']);
    });

    // 627 6F M3: the coordinator moves a `budget-limit` op from `armed` to
    // `awaiting-confirmation`, so the limit stage needs a Cancel too.
    it('the limit stage awaiting confirmation keeps New session and offers Cancel', () => {
      const root = render(
        { ...HANDOFF_BUDGET, stage: 'limit', blocked: true, percent: 100.2 },
        {
          handover: {
            ...WAITING,
            reason: 'budget-limit',
            phase: 'awaiting-confirmation',
            revision: 4,
            waitingFor: undefined,
          },
        },
      );
      const cancel = jest.fn();
      fixture.componentInstance.cancelHandover.subscribe(cancel);

      expect(buttons(root)).toEqual([
        'New session',
        'Cancel handover',
        'Preview handoff',
        'Allow 20% more',
      ]);
      expect(button(root, 'New session').getAttribute('aria-label')).toBe(
        'Continue in new session',
      );
      button(root, 'Cancel handover').click();
      expect(cancel).toHaveBeenCalledTimes(1);
    });

    it('the limit stage without a pending handover offers no Cancel', () => {
      const root = render({
        ...HANDOFF_BUDGET,
        stage: 'limit',
        blocked: true,
        percent: 100.2,
      });

      expect(buttons(root)).toEqual(['New session', 'Preview handoff', 'Allow 20% more']);
    });

    // 627 6F S2: a compact or an extension drops the budget below the handoff
    // stage while the coordinator still holds the handover.
    it.each(['normal', 'tighten', 'unknown'] as const)(
      '(S2) awaiting confirmation stays visible at the %s stage with Continue now and Cancel',
      (stage) => {
        const root = render(
          { ...HANDOFF_BUDGET, stage, used: 10_000_000, percent: 20 },
          { handover: { ...WAITING, phase: 'awaiting-confirmation', revision: 5, waitingFor: undefined } },
        );
        const continueInNewSession = jest.fn();
        const cancel = jest.fn();
        fixture.componentInstance.continueInNewSession.subscribe(continueInNewSession);
        fixture.componentInstance.cancelHandover.subscribe(cancel);

        expect(banner(root)).not.toBeNull();
        expect(buttons(root)).toEqual(['Continue now', 'Cancel (keep working)']);
        button(root, 'Continue now').click();
        button(root, 'Cancel (keep working)').click();
        expect(continueInNewSession).toHaveBeenCalledTimes(1);
        expect(cancel).toHaveBeenCalledTimes(1);
      },
    );

    it('(S2) a handover waiting for running work stays visible without a budget', () => {
      const root = render(null, {
        handover: { ...WAITING, waitingFor: undefined },
      });

      expect(banner(root)).not.toBeNull();
      expect(text(root, 'session-budget-body')).toBe(
        'Waiting for the handover to start. You can continue now if needed.',
      );
      expect(buttons(root)).toEqual(['Continue now', 'Cancel (keep working)']);
    });

    it('(S2) a dismissed handoff still shows a handover waiting for running work', () => {
      const root = render(
        { ...HANDOFF_BUDGET, dismissedStage: 'handoff' },
        { handover: WAITING },
      );

      expect(banner(root)).not.toBeNull();
      expect(buttons(root)).toEqual(['Continue now', 'Cancel (keep working)']);
    });

    it('(S2) a cancelled handover below the handoff stage shows nothing', () => {
      const root = render(
        { ...HANDOFF_BUDGET, stage: 'normal' },
        { handover: { ...WAITING, phase: 'cancelled', revision: 6 } },
      );

      expect(banner(root)).toBeNull();
    });
  });

  it('renders limit stats and its sparkline in the same notification', () => {
    const root = render(
      {
        ...BASE,
        stage: 'limit',
        used: 50_100_000,
        percent: 100.2,
        blocked: true,
        handoff: HANDOFF,
      },
      {
        usage: [
          { at: 1, used: 35_000_000, percent: 70 },
          { at: 2, used: 50_100_000, percent: 100.2 },
        ],
      },
    );

    expect(text(root, 'session-budget-used')).toBe('50.1M');
    expect(root.querySelector('[data-testid="session-budget-sparkline"]')).not.toBeNull();
    expect(button(root, 'Allow 20% more')).toBeInstanceOf(HTMLButtonElement);
  });

  it('names the compactions when they count', () => {
    const root = render({
      ...BASE,
      stage: 'limit',
      compactions: 2,
      blocked: true,
      handoff: HANDOFF,
    });

    expect(text(root, 'session-budget-compactions')).toBe('2');
  });

  it('shows the write failure line and no "saved" claim', () => {
    const root = render({
      ...BASE,
      stage: 'handoff',
      handoff: { ...HANDOFF, writeError: 'disk full' },
    });

    expect(text(root, 'session-budget-write-error')).toContain(
      'could not save the handoff file (disk full)',
    );
    expect(text(root, 'session-budget-write-error')).not.toContain('saved');
  });

  it('warns when the transcript was not read', () => {
    const root = render({
      ...BASE,
      stage: 'handoff',
      handoff: { ...HANDOFF, readStatus: 'read-failed' },
    });

    expect(text(root, 'session-budget-read-status')).toBe(
      'The transcript could not be read; the handoff may be incomplete.',
    );
  });

  it('no transcript warning when the read succeeded', () => {
    const root = render({ ...BASE, stage: 'handoff', handoff: HANDOFF });

    expect(root.querySelector('[data-testid="session-budget-read-status"]')).toBeNull();
  });

  it('says sends are not paused when blocking is off', () => {
    const root = render({
      ...BASE,
      stage: 'limit',
      handoff: HANDOFF,
      blocked: false,
    });

    expect(text(root, 'session-budget-body')).toContain(
      'New messages are not paused (blocking is off in settings).',
    );
  });

  it('lower-bound cost wording', () => {
    const root = render({
      ...BASE,
      stage: 'handoff',
      unit: 'cost',
      measure: 'cost-lower-bound',
      used: 4.2,
      limit: 10,
      percent: 42,
      lowerBound: true,
      handoff: HANDOFF,
    });

    expect(text(root, 'session-budget-body')).toContain(
      'Waiting for handover to start at \u2265 $4.20 of $10 of cost.',
    );
    expect(text(root, 'session-budget-used')).toBe('\u2265 $4.20');
  });

  it('Allow 20% more emits extend; busy disables every button', () => {
    const root = render(
      { ...BASE, stage: 'limit', blocked: true, handoff: HANDOFF },
      { busy: false },
    );
    const extend = jest.fn();
    fixture.componentInstance.extend.subscribe(extend);

    button(root, 'Allow 20% more').click();
    expect(extend).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();

    expect(
      Array.from(root.querySelectorAll('button')).every((item) => item.disabled),
    ).toBe(true);
  });

  it('opening emits previewRequested once and shows a loading line', () => {
    const root = render({ ...BASE, stage: 'limit', handoff: HANDOFF });
    const previewRequested = jest.fn();
    fixture.componentInstance.previewRequested.subscribe(previewRequested);

    button(root, 'Preview handoff').click();
    fixture.detectChanges();

    expect(previewRequested).toHaveBeenCalledTimes(1);
    expect(text(root, 'session-budget-preview')).toBe('Loading the handoff\u2026');
  });

  it('a failed load shows the error and Try again re-requests', () => {
    const root = render(
      { ...BASE, stage: 'limit', handoff: HANDOFF },
      { previewFailed: true },
    );
    const previewRequested = jest.fn();
    fixture.componentInstance.previewRequested.subscribe(previewRequested);

    button(root, 'Preview handoff').click();
    fixture.detectChanges();

    expect(text(root, 'session-budget-preview-error')).toContain(
      'Could not load the handoff.',
    );
    button(root, 'Try again').click();
    expect(previewRequested).toHaveBeenCalledTimes(2);
  });

  it('keeps the preview as text', () => {
    const root = render(
      { ...BASE, stage: 'limit', handoff: HANDOFF },
      { preview: '<img src=x onerror=alert(1)>' },
    );

    button(root, 'Preview handoff').click();
    fixture.detectChanges();

    const preview = root.querySelector('[data-testid="session-budget-preview"]');
    expect(preview?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(preview?.querySelector('img')).toBeNull();
  });

  it('renders handover failure inside the existing handoff notification', () => {
    const root = render(
      { ...BASE, stage: 'handoff', handoff: HANDOFF },
      {
        handover: {
          operationId: 'handover-1',
          sourceSessionId: BASE.sessionId,
          reason: 'budget-limit',
          phase: 'failed',
          revision: 3,
          heldInputCount: 1,
          error: 'The successor could not start.',
        },
      },
    );
    const retry = jest.fn();
    const keepWorking = jest.fn();
    fixture.componentInstance.continueInNewSession.subscribe(retry);
    fixture.componentInstance.cancelHandover.subscribe(keepWorking);

    expect(root.querySelectorAll('[data-testid="session-budget-banner"]')).toHaveLength(1);
    button(root, 'Retry').click();
    button(root, 'Keep working').click();

    expect(retry).toHaveBeenCalledTimes(1);
    expect(keepWorking).toHaveBeenCalledTimes(1);
  });

  it('returns bounded lost source text to the composer on request', () => {
    const root = render(
      { ...BASE, stage: 'handoff', handoff: HANDOFF },
      {
        handover: {
          operationId: 'handover-1',
          sourceSessionId: BASE.sessionId,
          reason: 'budget-limit',
          phase: 'failed',
          revision: 3,
          heldInputCount: 2,
          lostInputCount: 2,
          lostInputTexts: ['first lost message', 'second lost message'],
        },
      },
    );
    const restore = jest.fn();
    fixture.componentInstance.restoreLostInputs.subscribe(restore);

    button(root, 'Put back in composer').click();

    expect(restore).toHaveBeenCalledWith([
      'first lost message',
      'second lost message',
    ]);
  });

  it('renders automatic progress in the same message and cancels once', () => {
    const root = render(
      { ...BASE, stage: 'handoff', handoff: HANDOFF },
      {
        handover: {
          operationId: 'handover-1',
          sourceSessionId: BASE.sessionId,
          reason: 'budget-limit',
          phase: 'writing-handoff',
          revision: 2,
          heldInputCount: 0,
        },
      },
    );
    const cancel = jest.fn();
    fixture.componentInstance.cancelHandover.subscribe(cancel);

    expect(root.querySelectorAll('[data-testid="session-budget-banner"]')).toHaveLength(1);
    expect(text(root, 'session-budget-title')).toBe('Continuing in a new session…');
    expect(text(root, 'session-handover-progress')).toBe('Writing the handoff…');
    button(root, 'Cancel (keep working)').click();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(root.querySelectorAll('button')).toHaveLength(1);

    fixture.componentRef.setInput('handover', {
      operationId: 'handover-1',
      sourceSessionId: BASE.sessionId,
      reason: 'budget-limit',
      phase: 'starting-successor',
      revision: 3,
      heldInputCount: 0,
    });
    fixture.detectChanges();

    expect(root.querySelectorAll('[data-testid="session-budget-banner"]')).toHaveLength(1);
    expect(text(root, 'session-handover-progress')).toBe(
      'Starting the new session…',
    );
  });

  it('renders a failed handover before the budget handoff stage', () => {
    const root = render(
      { ...BASE, stage: 'tighten' },
      {
        handover: {
          operationId: 'handover-1',
          sourceSessionId: BASE.sessionId,
          reason: 'budget-limit',
          phase: 'failed',
          revision: 3,
          heldInputCount: 1,
          error: 'The successor could not start.',
        },
      },
    );

    expect(text(root, 'session-budget-title')).toBe('Could not continue in a new session');
    expect(button(root, 'Retry')).toBeInstanceOf(HTMLButtonElement);
  });

  it('renders handover progress without a budget', () => {
    const root = render(null, {
      handover: {
        operationId: 'handover-1',
        sourceSessionId: BASE.sessionId,
        reason: 'successor',
        phase: 'starting-successor',
        revision: 3,
        heldInputCount: 0,
      },
    });

    expect(text(root, 'session-budget-title')).toBe('Continuing in a new session…');
    expect(text(root, 'session-handover-progress')).toBe('Starting the new session…');
  });

  // Main-side coverage retained for the merged handoff/limit surface.
  it('renders nothing without a budget or below tighten', () => {
    expect(banner(render(null))).toBeNull();
    TestBed.resetTestingModule();
    expect(banner(render({ ...BASE, stage: 'unknown' }))).toBeNull();
    TestBed.resetTestingModule();
    expect(banner(render({ ...BASE, stage: 'tighten' }))).toBeNull();
  });

  it('draws a sparkline once two usage samples exist', () => {
    const root = render(
      { ...BASE, stage: 'handoff', handoff: HANDOFF },
      {
        usage: [
          { at: 1, used: 10, percent: 10 },
          { at: 2, used: 25_000_000, percent: 50 },
        ],
      },
    );

    const spark = root.querySelector('[data-testid="session-budget-sparkline"]');
    expect(spark?.getAttribute('aria-label')).toBe(
      'Budget use over this session, 2 samples',
    );
    expect(spark?.querySelector('polyline')?.getAttribute('points')).toContain(',');
    expect(spark?.querySelector('polyline')?.classList.contains('stroke-error')).toBe(
      true,
    );
  });

  it('hides the sparkline with fewer than two samples', () => {
    const root = render(
      { ...BASE, stage: 'handoff', handoff: HANDOFF },
      { usage: [{ at: 1, used: 10, percent: 10 }] },
    );

    expect(
      root.querySelector('[data-testid="session-budget-sparkline"]'),
    ).toBeNull();
  });

  it('stays hidden once dismissed at this stage', () => {
    const root = render({
      ...BASE,
      stage: 'handoff',
      handoff: HANDOFF,
      dismissedStage: 'handoff',
    });

    expect(banner(root)).toBeNull();
  });

  it('status role, percent text, saved handoff, one Continue now button', () => {
    const root = render({
      ...BASE,
      stage: 'handoff',
      used: 40_000_000,
      percent: 80,
      handoff: HANDOFF,
    });

    expect(banner(root)?.getAttribute('role')).toBe('status');
    expect(banner(root)?.classList).toContain('surface-2');
    expect(banner(root)?.classList).toContain('rounded-lg');
    expect(banner(root)?.classList).toContain('border-error');
    expect(text(root, 'session-budget-percent')).toBe('80%');
    expect(text(root, 'session-budget-body')).toBe(
      'Waiting for handover to start at 40.0M of 50.0M tokens. You can continue now if needed.',
    );
    expect(Array.from(root.querySelectorAll('button')).map((item) => item.textContent?.trim())).toEqual([
      'Continue now',
    ]);
  });

  it('keeps a meaningful body when no compaction has completed and the handoff write failed', () => {
    const root = render({
      ...BASE,
      stage: 'handoff',
      used: 40_000_000,
      handoff: { ...HANDOFF, path: null, writeError: 'EACCES' },
    });

    expect(text(root, 'session-budget-body')).toContain(
      'Waiting for handover to start at 40.0M of 50.0M tokens.',
    );
    expect(text(root, 'session-budget-write-error')).toContain('EACCES');
  });

  it('alert role, F7 pause sentence, handoff size, three buttons', () => {
    const root = render(
      {
        ...BASE,
        stage: 'limit',
        used: 50_100_000,
        percent: 100.2,
        blocked: true,
        handoff: HANDOFF,
      },
      { contextTokens: 180_000 },
    );

    expect(banner(root)?.getAttribute('role')).toBe('alert');
    expect(banner(root)?.classList).toContain('surface-2');
    expect(banner(root)?.classList).toContain('border-error');
    expect(text(root, 'session-budget-body')).toContain(
      'Limit reached — new turns are held until you continue',
    );
    expect(text(root, 'session-budget-body')).toContain(
      'about 1.5k tokens instead of 180.0k',
    );
    expect(text(root, 'session-budget-percent')).toBe('100.2%');
    expect(Array.from(root.querySelectorAll('button')).map((item) => item.textContent?.trim())).toEqual([
      'New session',
      'Preview handoff',
      'Allow 20% more',
    ]);
  });

  it('cannot be dismissed away', () => {
    const root = render({
      ...BASE,
      stage: 'limit',
      blocked: true,
      handoff: HANDOFF,
      dismissedStage: 'limit',
    });

    expect(banner(root)).not.toBeNull();
  });

  it('renders the handoff as plain text in a <pre>, never as HTML', () => {
    const hostile = '# Goal\n<img src=x onerror="alert(1)"><b>bold</b>';
    const root = render(
      { ...BASE, stage: 'limit', handoff: HANDOFF },
      { preview: hostile },
    );

    button(root, 'Preview handoff').click();
    fixture.detectChanges();

    const pre = root.querySelector('[data-testid="session-budget-preview"]');
    expect(pre?.tagName).toBe('PRE');
    expect(pre?.textContent).toBe(hostile);
    expect(pre?.querySelector('img')).toBeNull();
    expect(pre?.querySelector('b')).toBeNull();
  });
});
