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

  it('does not render a lifecycle notification before handoff', () => {
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

    expect(banner(root)).toBeNull();
  });
});
