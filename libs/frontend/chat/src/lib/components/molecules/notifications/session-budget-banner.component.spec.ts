import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type {
  SessionBudgetStage,
  SessionBudgetState,
} from '@ptah-extension/shared';
import { SessionBudgetBannerComponent } from './session-budget-banner.component';

const BASE: SessionBudgetState = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  stage: 'handoff',
  unit: 'tokens',
  measure: 'tokens',
  used: 41_200_000,
  limit: 50_000_000,
  percent: 82.4,
  lowerBound: false,
  revision: 7,
  compactions: 0,
  autoHandoff: false,
};

describe('SessionBudgetBannerComponent', () => {
  let fixture: ComponentFixture<SessionBudgetBannerComponent>;

  function render(
    budget: SessionBudgetState | null,
    extra: {
      dismissedStage?: SessionBudgetStage | null;
      wrapUpSent?: boolean;
      autoHandoffQueued?: boolean;
    } = {},
  ): HTMLElement {
    TestBed.configureTestingModule({ imports: [SessionBudgetBannerComponent] });
    fixture = TestBed.createComponent(SessionBudgetBannerComponent);
    fixture.componentRef.setInput('budget', budget);
    fixture.componentRef.setInput('displayStage', budget?.stage ?? null);
    if (extra.dismissedStage !== undefined) {
      fixture.componentRef.setInput('dismissedStage', extra.dismissedStage);
    }
    if (extra.wrapUpSent !== undefined) {
      fixture.componentRef.setInput('wrapUpSent', extra.wrapUpSent);
    }
    if (extra.autoHandoffQueued !== undefined) {
      fixture.componentRef.setInput(
        'autoHandoffQueued',
        extra.autoHandoffQueued,
      );
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function byTestId<T extends HTMLElement = HTMLElement>(
    host: HTMLElement,
    id: string,
  ): T | null {
    return host.querySelector<T>(`[data-testid="${id}"]`);
  }

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  describe('automatic hand-off', () => {
    const LIMIT: SessionBudgetState = { ...BASE, stage: 'limit' };

    it('shows nothing about it unless it is queued', () => {
      const host = render(LIMIT);
      expect(byTestId(host, 'session-budget-auto-queued')).toBeNull();
    });

    it('says it is queued inside the alert and emits Cancel', () => {
      const host = render(LIMIT, { autoHandoffQueued: true, wrapUpSent: true });
      const notice = byTestId(host, 'session-budget-auto-queued');
      expect(notice?.textContent).toContain('Auto hand-off queued');
      expect(
        byTestId(host, 'session-budget-banner')?.getAttribute('role'),
      ).toBe('alert');
      const cancel = byTestId<HTMLButtonElement>(
        host,
        'session-budget-auto-cancel',
      );
      expect(cancel?.getAttribute('aria-label')).toBe(
        'Cancel the automatic hand-off',
      );
      let cancelled = 0;
      fixture.componentInstance.cancelAutoHandoff.subscribe(() => cancelled++);
      cancel?.click();
      expect(cancelled).toBe(1);
    });

    it('stays visible while queued even when the limit notice was dismissed', () => {
      const host = render(LIMIT, {
        dismissedStage: 'limit',
        autoHandoffQueued: true,
      });
      expect(byTestId(host, 'session-budget-auto-cancel')).not.toBeNull();
    });
  });

  it.each(['normal', 'tighten', 'unknown'] as const)(
    'shows nothing at the %s stage',
    (stage) => {
      const host = render({ ...BASE, stage });
      expect(byTestId(host, 'session-budget-banner')).toBeNull();
    },
  );

  it('shows nothing without a budget', () => {
    const host = render(null);
    expect(byTestId(host, 'session-budget-banner')).toBeNull();
  });

  it('shows a live handoff over a lower authoritative stage', () => {
    const host = render({ ...BASE, stage: 'tighten' });
    expect(byTestId(host, 'session-budget-banner')).toBeNull();
    fixture.componentRef.setInput('displayStage', 'handoff');
    fixture.detectChanges();
    expect(byTestId(host, 'session-budget-banner')).not.toBeNull();
  });

  it('shows the handoff banner with the usage title, body, meter and two buttons', () => {
    const host = render(BASE);
    const banner = byTestId(host, 'session-budget-banner');
    expect(banner).not.toBeNull();
    expect(banner?.getAttribute('role')).toBe('status');
    expect(banner?.classList).toContain('border-warning');
    expect(byTestId(host, 'session-budget-title')?.textContent?.trim()).toBe(
      'Session used 41.2M of 50.0M tokens',
    );
    expect(byTestId(host, 'session-budget-body')?.textContent?.trim()).toBe(
      'Ask the agent to finish its running work, write a handoff document and give you a prompt for a new session.',
    );
    expect(
      byTestId<HTMLProgressElement>(host, 'session-budget-meter')?.value,
    ).toBe(82.4);
    const wrapUp = byTestId<HTMLButtonElement>(host, 'session-budget-wrap-up');
    expect(wrapUp?.textContent?.trim()).toBe('Wrap up & hand off');
    expect(wrapUp?.disabled).toBe(false);
    expect(byTestId(host, 'session-budget-dismiss')?.textContent?.trim()).toBe(
      'Dismiss',
    );
    expect(host.querySelectorAll('button')).toHaveLength(2);
  });

  it('emits wrapUp on the primary button', () => {
    const host = render(BASE);
    const emitted = jest.fn();
    fixture.componentInstance.wrapUp.subscribe(emitted);

    byTestId<HTMLButtonElement>(host, 'session-budget-wrap-up')?.click();

    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it('disables the primary button once the wrap-up was sent', () => {
    const host = render(BASE, { wrapUpSent: true });
    const wrapUp = byTestId<HTMLButtonElement>(host, 'session-budget-wrap-up');
    expect(wrapUp?.disabled).toBe(true);
    expect(wrapUp?.textContent?.trim()).toBe('Wrap-up requested');
  });

  it('emits dismiss and hides once the parent records the dismissed stage', () => {
    const host = render(BASE);
    const emitted = jest.fn();
    fixture.componentInstance.dismiss.subscribe(emitted);

    byTestId<HTMLButtonElement>(host, 'session-budget-dismiss')?.click();
    expect(emitted).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('dismissedStage', 'handoff');
    fixture.detectChanges();
    expect(byTestId(host, 'session-budget-banner')).toBeNull();
  });

  it('reappears at the limit stage with the error tone after a handoff dismissal', () => {
    const host = render(BASE, { dismissedStage: 'handoff' });
    expect(byTestId(host, 'session-budget-banner')).toBeNull();

    fixture.componentRef.setInput('budget', {
      ...BASE,
      stage: 'limit',
      used: 50_100_000,
      percent: 100.2,
    });
    fixture.componentRef.setInput('displayStage', 'limit');
    fixture.detectChanges();

    const banner = byTestId(host, 'session-budget-banner');
    expect(banner).not.toBeNull();
    expect(banner?.getAttribute('role')).toBe('alert');
    expect(banner?.classList).toContain('border-error');
    expect(
      byTestId<HTMLProgressElement>(host, 'session-budget-meter')?.value,
    ).toBe(100);
  });

  it('stays hidden at the limit once the limit stage was dismissed', () => {
    const host = render(
      { ...BASE, stage: 'limit' },
      { dismissedStage: 'limit' },
    );
    expect(byTestId(host, 'session-budget-banner')).toBeNull();
  });
});
