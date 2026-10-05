import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { SessionBudgetState } from '@ptah-extension/shared';
import { SessionBudgetBannerComponent } from './session-budget-banner.component';
import { SessionRotationKeepService } from '../../../services/session-rotation-keep.service';

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
  path: '/home/u/.ptah/handoffs/x.md',
  chars: 6_000,
  truncated: false,
  writtenAt: 1,
};

describe('SessionBudgetBannerComponent', () => {
  let fixture: ComponentFixture<SessionBudgetBannerComponent>;

  function render(
    budget: SessionBudgetState | null,
    extra: { preview?: string | null; contextTokens?: number | null } = {},
  ): HTMLElement {
    TestBed.configureTestingModule({
      imports: [SessionBudgetBannerComponent],
    });
    fixture = TestBed.createComponent(SessionBudgetBannerComponent);
    fixture.componentRef.setInput('budget', budget);
    if (extra.preview !== undefined) {
      fixture.componentRef.setInput('preview', extra.preview);
    }
    if (extra.contextTokens !== undefined) {
      fixture.componentRef.setInput('contextTokens', extra.contextTokens);
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function text(root: HTMLElement, testId: string): string {
    return (root.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function buttons(root: HTMLElement): string[] {
    return Array.from(root.querySelectorAll('button')).map((b) =>
      (b.textContent ?? '').trim(),
    );
  }

  function button(root: HTMLElement, label: string): HTMLButtonElement {
    const found = Array.from(root.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === label,
    );
    if (!found) throw new Error(`No button "${label}"`);
    return found;
  }

  function banner(root: HTMLElement): HTMLElement | null {
    return root.querySelector('[data-testid="session-budget-banner"]');
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders nothing without a budget or below tighten', () => {
    expect(banner(render(null))).toBeNull();
    TestBed.resetTestingModule();
    expect(banner(render({ ...BASE, stage: 'unknown' }))).toBeNull();
    TestBed.resetTestingModule();
    expect(banner(render(BASE))).toBeNull();
  });

  describe('rotation', () => {
    const ROTATION = { contextTokens: 210_000, threshold: 200_000 };

    it('renders status role, context size and both buttons', () => {
      const root = render({ ...BASE, rotation: ROTATION });

      expect(banner(root)?.getAttribute('role')).toBe('status');
      expect(text(root, 'session-budget-body')).toContain('210.0k');
      expect(buttons(root)).toEqual(['Rotate session', 'Keep this session']);
    });

    it('Rotate emits rotate', () => {
      const root = render({ ...BASE, rotation: ROTATION });
      const spy = jest.fn();
      fixture.componentInstance.rotate.subscribe(spy);

      button(root, 'Rotate session').click();

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('Keep dismisses for the same key and reappears after rotation clears', () => {
      const root = render({ ...BASE, rotation: ROTATION });

      button(root, 'Keep this session').click();
      fixture.detectChanges();
      expect(banner(root)).toBeNull();

      // Same key, newer revision: still dismissed.
      fixture.componentRef.setInput('budget', {
        ...BASE,
        revision: 8,
        rotation: ROTATION,
      });
      fixture.detectChanges();
      expect(banner(root)).toBeNull();

      // Rotation clears, then a later crossing shows it again.
      fixture.componentRef.setInput('budget', BASE);
      fixture.detectChanges();
      fixture.componentRef.setInput('budget', {
        ...BASE,
        rotation: ROTATION,
      });
      fixture.detectChanges();
      expect(banner(root)).not.toBeNull();
    });

    it('Keep survives destroying and recreating the banner; clearing drops the keys', () => {
      const root = render({ ...BASE, rotation: ROTATION });
      button(root, 'Keep this session').click();
      fixture.detectChanges();
      expect(banner(root)).toBeNull();

      // A tab switch rebuilds the banner; the same TestBed keeps the root store.
      fixture.destroy();
      fixture = TestBed.createComponent(SessionBudgetBannerComponent);
      fixture.componentRef.setInput('budget', { ...BASE, rotation: ROTATION });
      fixture.detectChanges();
      const rebuilt = fixture.nativeElement as HTMLElement;
      expect(banner(rebuilt)).toBeNull();

      // Advisory cleared: keys are dropped, so a later crossing shows it again.
      fixture.componentRef.setInput('budget', BASE);
      fixture.detectChanges();
      expect(
        TestBed.inject(SessionRotationKeepService).isKept(
          BASE.sessionId,
          ROTATION.threshold,
        ),
      ).toBe(false);
      fixture.componentRef.setInput('budget', { ...BASE, rotation: ROTATION });
      fixture.detectChanges();
      expect(banner(rebuilt)).not.toBeNull();
    });

    it.each(['handoff', 'limit'] as const)(
      'is hidden under the %s stage (N8 banner wins)',
      (stage) => {
        const root = render({
          ...BASE,
          stage,
          handoff: HANDOFF,
          rotation: ROTATION,
        });

        expect(text(root, 'session-budget-title')).not.toBe(
          'This session is getting large',
        );
        expect(buttons(root)).not.toContain('Rotate session');
      },
    );
  });

  describe('tighten', () => {
    it('advisory (no window): status role, /compact advice, OK only', () => {
      const root = render({ ...BASE, stage: 'tighten' });

      expect(banner(root)?.getAttribute('role')).toBe('status');
      expect(text(root, 'session-budget-title')).toBe(
        "Half of this session's budget is used",
      );
      expect(text(root, 'session-budget-body')).toBe(
        '25.0M of 50.0M tokens. Run /compact or start a fresh session for unrelated work to slow the spend.',
      );
      expect(buttons(root)).toEqual(['OK']);
    });

    it('advisory when the window reason is disabled', () => {
      const root = render({
        ...BASE,
        stage: 'tighten',
        window: { target: 200_000, applied: false, reason: 'disabled' },
      });

      expect(text(root, 'session-budget-body')).toContain(
        'Run /compact or start a fresh session',
      );
    });

    it('applied: states the target (F14) and offers Restore auto-compact', () => {
      const root = render({
        ...BASE,
        stage: 'tighten',
        window: { target: 200_000, applied: true },
      });

      expect(text(root, 'session-budget-body')).toBe(
        '25.0M of 50.0M tokens. Ptah lowered auto-compact to 200.0k tokens for this session. If the context is already above that, the next request compacts first. More compactions bring the handoff step sooner.',
      );
      expect(buttons(root)).toEqual(['OK', 'Restore auto-compact']);
    });

    it.each([
      ['env-override', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW is set'],
      ['already-lower', 'it is already at or below 200.0k'],
      ['not-honoured', 'this model ignored the lower auto-compact setting'],
      ['failed', 'the change was rejected'],
    ] as const)('not applied (%s) explains why', (reason, reasonText) => {
      const root = render({
        ...BASE,
        stage: 'tighten',
        window: { target: 200_000, applied: false, reason },
      });

      expect(text(root, 'session-budget-body')).toBe(
        `25.0M of 50.0M tokens. Ptah could not lower auto-compact here (${reasonText}). Use /compact or start a fresh session to slow the spend.`,
      );
      expect(buttons(root)).toEqual(['OK']);
    });

    it('OK emits dismiss; Restore emits restoreWindow', () => {
      const root = render({
        ...BASE,
        stage: 'tighten',
        window: { target: 200_000, applied: true },
      });
      const dismiss = jest.fn();
      const restore = jest.fn();
      fixture.componentInstance.dismiss.subscribe(dismiss);
      fixture.componentInstance.restoreWindow.subscribe(restore);

      button(root, 'OK').click();
      button(root, 'Restore auto-compact').click();

      expect(dismiss).toHaveBeenCalledTimes(1);
      expect(restore).toHaveBeenCalledTimes(1);
    });

    it('stays hidden once dismissed at this stage', () => {
      const root = render({
        ...BASE,
        stage: 'tighten',
        dismissedStage: 'tighten',
      });
      expect(banner(root)).toBeNull();
    });
  });

  describe('handoff', () => {
    const STATE: SessionBudgetState = {
      ...BASE,
      stage: 'handoff',
      used: 40_000_000,
      percent: 80,
      handoff: HANDOFF,
    };

    it('status role, percent text, saved handoff, three buttons', () => {
      const root = render(STATE);

      expect(banner(root)?.getAttribute('role')).toBe('status');
      expect(text(root, 'session-budget-title')).toBe(
        'Time to hand off this session',
      );
      expect(text(root, 'session-budget-body')).toBe(
        '40.0M of 50.0M tokens (80%). Ptah saved a handoff with the goal, decisions, changed files, open items and next step. At 100% new messages in this session pause.',
      );
      expect(buttons(root)).toEqual([
        'Start new session from handoff',
        'Preview handoff',
        'Keep working',
      ]);
    });

    it('names the compactions when they count', () => {
      const root = render({
        ...STATE,
        used: 10_000_000,
        percent: 20,
        compactions: 3,
      });

      expect(text(root, 'session-budget-body')).toContain(
        'This session has compacted 3 times, and each compaction loses detail.',
      );
    });

    it('shows the write failure line and no "saved" claim', () => {
      const root = render({
        ...STATE,
        handoff: { ...HANDOFF, path: null, writeError: 'EACCES' },
      });

      expect(text(root, 'session-budget-body')).not.toContain('Ptah saved');
      expect(text(root, 'session-budget-write-error')).toBe(
        'Ptah could not save the handoff file (EACCES). You can still start a new session; the handoff text is kept until this session closes.',
      );
    });

    it('buttons emit continue and dismiss', () => {
      const root = render(STATE);
      const cont = jest.fn();
      const dismiss = jest.fn();
      fixture.componentInstance.continueInNewSession.subscribe(cont);
      fixture.componentInstance.dismiss.subscribe(dismiss);

      button(root, 'Start new session from handoff').click();
      button(root, 'Keep working').click();

      expect(cont).toHaveBeenCalledTimes(1);
      expect(dismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe('limit', () => {
    const STATE: SessionBudgetState = {
      ...BASE,
      stage: 'limit',
      used: 50_100_000,
      percent: 100.2,
      blocked: true,
      handoff: HANDOFF,
    };

    it('alert role, F7 pause sentence, handoff size, three buttons', () => {
      const root = render(STATE, { contextTokens: 180_000 });

      expect(banner(root)?.getAttribute('role')).toBe('alert');
      expect(text(root, 'session-budget-title')).toBe(
        'This session reached its budget',
      );
      expect(text(root, 'session-budget-body')).toBe(
        '50.1M of 50.0M tokens. New messages here are paused after the current turn (one queued message may still run). /compact and /clear still work. Continue in a new session that starts with only the handoff (about 1.5k tokens instead of 180.0k).',
      );
      expect(buttons(root)).toEqual([
        'Continue in new session',
        'Preview handoff',
        'Allow 20% more',
      ]);
    });

    it('says sends are not paused when blocking is off', () => {
      const root = render({ ...STATE, blocked: false });

      expect(text(root, 'session-budget-body')).toMatch(
        /New messages are not paused \(blocking is off in settings\)\.$/,
      );
    });

    it('cannot be dismissed away', () => {
      const root = render({ ...STATE, dismissedStage: 'limit' });
      expect(banner(root)).not.toBeNull();
    });

    it('lower-bound cost wording', () => {
      const root = render({
        ...STATE,
        unit: 'cost',
        measure: 'cost-lower-bound',
        used: 30.5,
        limit: 30,
        lowerBound: true,
      });

      expect(text(root, 'session-budget-body')).toMatch(
        /^≥ \$30\.50 of \$30 of cost\. /,
      );
    });

    it('Allow 20% more emits extend; busy disables every button', () => {
      const root = render(STATE);
      const extend = jest.fn();
      fixture.componentInstance.extend.subscribe(extend);
      button(root, 'Allow 20% more').click();
      expect(extend).toHaveBeenCalledTimes(1);

      fixture.componentRef.setInput('busy', true);
      fixture.detectChanges();
      for (const b of Array.from(root.querySelectorAll('button'))) {
        expect(b.disabled).toBe(true);
      }
    });
  });

  describe('preview', () => {
    const STATE: SessionBudgetState = {
      ...BASE,
      stage: 'limit',
      blocked: true,
      handoff: HANDOFF,
    };

    it('opening emits previewRequested once and shows a loading line', () => {
      const root = render(STATE);
      const requested = jest.fn();
      fixture.componentInstance.previewRequested.subscribe(requested);

      const toggle = button(root, 'Preview handoff');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      toggle.click();
      fixture.detectChanges();

      expect(requested).toHaveBeenCalledTimes(1);
      expect(text(root, 'session-budget-preview')).toBe('Loading the handoff…');
      expect(button(root, 'Hide handoff').getAttribute('aria-expanded')).toBe(
        'true',
      );

      button(root, 'Hide handoff').click();
      fixture.detectChanges();
      expect(
        root.querySelector('[data-testid="session-budget-preview"]'),
      ).toBeNull();
      expect(requested).toHaveBeenCalledTimes(1);
    });

    it('renders the handoff as plain text in a <pre>, never as HTML', () => {
      const hostile = '# Goal\n<img src=x onerror="alert(1)"><b>bold</b>';
      const root = render(STATE, { preview: hostile });
      button(root, 'Preview handoff').click();
      fixture.detectChanges();

      const pre = root.querySelector('[data-testid="session-budget-preview"]');
      expect(pre?.tagName).toBe('PRE');
      expect(pre?.textContent).toBe(hostile);
      expect(pre?.querySelector('img')).toBeNull();
      expect(pre?.querySelector('b')).toBeNull();
    });
  });
});
