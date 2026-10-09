import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { AppStateManager } from '@ptah-extension/core';
import type { ConnectionCheckRecord } from '@ptah-extension/shared';
import type { UsedBy } from '../connection-usage';
import {
  OverviewTabComponent,
  checkedAgo,
  overviewCheckedStatus,
  overviewStatus,
  usedByBadge,
  type OverviewStatus,
} from './overview-tab.component';
import { isDisabledControl } from '../../feedback/busy-disabled.testing';

const MAIN: UsedBy = {
  id: 'main-agent',
  label: 'Main agent',
  kind: 'main-agent',
  followsMain: false,
};
const ARCHAEOLOGIST: UsedBy = {
  id: 'archaeologist',
  label: 'Archaeologist lane',
  kind: 'background-role',
  followsMain: true,
};
const JUDGE: UsedBy = {
  id: 'judge',
  label: 'Judge lane',
  kind: 'background-role',
  followsMain: false,
};
const CODEX_CLI: UsedBy = {
  id: 'codex-cli',
  label: 'Codex CLI',
  kind: 'system-cli',
  followsMain: false,
};
const NOW = Date.parse('2026-10-01T12:00:00.000Z');
const verified = (
  latencyMs: number | null,
  checkedAt = new Date(NOW).toISOString(),
): ConnectionCheckRecord => ({
  status: 'verified',
  reason: null,
  latencyMs,
  checkedAt,
});
const failed = (
  reason: ConnectionCheckRecord['reason'],
  checkedAt = new Date(NOW).toISOString(),
): ConnectionCheckRecord => ({
  status: 'failed',
  reason,
  latencyMs: null,
  checkedAt,
});

describe('overviewCheckedStatus (Batch 28d: the recorded check on the status line)', () => {
  const CONNECTED: OverviewStatus = {
    label: 'Connected & verified',
    tone: 'success',
  };
  it.each<
    [
      string,
      OverviewStatus,
      Parameters<typeof overviewCheckedStatus>[1],
      ConnectionCheckRecord | null,
      OverviewStatus,
    ]
  >([
    [
      'no record: unchanged, never a latency',
      CONNECTED,
      'connected',
      null,
      CONNECTED,
    ],
    [
      'verified: the latency in the prototype format',
      CONNECTED,
      'connected',
      verified(92),
      { label: 'Connected & verified (92ms)', tone: 'success' },
    ],
    [
      'verified latency is whole ms',
      CONNECTED,
      'connected',
      verified(91.6),
      { label: 'Connected & verified (92ms)', tone: 'success' },
    ],
    [
      'verified without a timed request (CLI, sign-in): no latency',
      CONNECTED,
      'connected',
      verified(null),
      CONNECTED,
    ],
    ['never "0ms"', CONNECTED, 'connected', verified(0), CONNECTED],
    [
      'a negative or non-finite latency is not shown',
      CONNECTED,
      'connected',
      verified(Number.NaN),
      CONNECTED,
    ],
    [
      'verified confirms a route without a verdict',
      { label: 'Not checked', tone: 'neutral' },
      'unknown',
      verified(40),
      { label: 'Connected & verified (40ms)', tone: 'success' },
    ],
    [
      'the active driver keeps its label',
      { label: 'Active for main agent', tone: 'success' },
      'active',
      verified(30),
      { label: 'Active for main agent (30ms)', tone: 'success' },
    ],
    [
      'a route warning is never overridden by an earlier check',
      { label: 'Unreachable', tone: 'warning' },
      'unreachable',
      verified(92),
      { label: 'Unreachable', tone: 'warning' },
    ],
    [
      'a failed record reads "Check failed" (D15), never verified',
      CONNECTED,
      'connected',
      failed('credential-rejected'),
      { label: 'Check failed', tone: 'error' },
    ],
    [
      'a running check wins over a record',
      { label: 'Checking…', tone: 'neutral' },
      'checking',
      verified(92),
      { label: 'Checking…', tone: 'neutral' },
    ],
    [
      'a failed check request wins over an older verified record',
      { label: 'Check failed', tone: 'error' },
      'check-failed',
      verified(92),
      { label: 'Check failed', tone: 'error' },
    ],
  ])('%s', (_name, base, status, check, expected) => {
    expect(overviewCheckedStatus(base, status, check)).toEqual(expected);
  });
});

describe('checkedAgo', () => {
  it.each([
    [0, 'Checked just now'],
    [44_000, 'Checked just now'],
    [-5_000, 'Checked just now'],
    [2 * 60_000, 'Checked 2 min ago'],
    [59 * 60_000, 'Checked 59 min ago'],
    [3 * 3_600_000, 'Checked 3 h ago'],
  ])('%d ms ago reads %s', (age, text) => {
    expect(checkedAgo(new Date(NOW - age).toISOString(), NOW)).toBe(text);
  });
  it('a day or more shows the date; an unreadable time shows nothing', () => {
    expect(
      checkedAgo(new Date(NOW - 2 * 86_400_000).toISOString(), NOW),
    ).toMatch(/^Checked on /);
    expect(checkedAgo('not a time', NOW)).toBeNull();
  });
});

describe('overviewStatus', () => {
  it.each([
    [
      'connected with evidence',
      'connected',
      true,
      false,
      'Connected & verified',
      'success',
    ],
    [
      'connected, host cannot check (no evidence either way)',
      'connected',
      null,
      false,
      'Connected',
      'success',
    ],
    [
      'connected without evidence is never Connected',
      'connected',
      false,
      false,
      'Not checked',
      'neutral',
    ],
    [
      'connected and the active driver',
      'connected',
      true,
      true,
      'Active for main agent',
      'success',
    ],
    [
      'reachable without evidence',
      'reachable',
      null,
      false,
      'Not checked',
      'neutral',
    ],
    [
      'unknown (host cannot check)',
      'unknown',
      null,
      false,
      'Not checked',
      'neutral',
    ],
    ['skipped', 'skipped', null, false, 'Check unavailable', 'neutral'],
    ['unreachable', 'unreachable', null, false, 'Unreachable', 'warning'],
    ['needs key', 'needs-key', null, false, 'Needs API key', 'warning'],
    ['a check in flight', 'checking', false, false, 'Checking…', 'neutral'],
    [
      'a failed check (route read error)',
      'check-failed',
      false,
      false,
      'Check failed',
      'error',
    ],
  ] as const)('%s', (_name, status, evidence, active, label, tone) => {
    expect(overviewStatus(status, evidence, active, 'api-key')).toEqual({
      label,
      tone,
    });
  });

  it('names a rejected key for key-based kinds and a sign-in for the others', () => {
    expect(
      overviewStatus('unauthenticated', null, false, 'api-key').label,
    ).toBe('Credential rejected');
    expect(overviewStatus('unauthenticated', null, false, 'oauth').label).toBe(
      'Sign-in required',
    );
  });
});

describe('OverviewTabComponent', () => {
  let fixture: ComponentFixture<OverviewTabComponent>;
  let element: HTMLElement;
  const requestSettingsTab = jest.fn();

  beforeEach(() => {
    requestSettingsTab.mockReset();
    TestBed.configureTestingModule({
      imports: [OverviewTabComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: AppStateManager, useValue: { requestSettingsTab } },
      ],
    });
    fixture = TestBed.createComponent(OverviewTabComponent);
    element = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('kind', 'api-key');
    fixture.componentRef.setInput('authModeLabel', 'API key');
    fixture.componentRef.setInput('credentialLabel', 'Stored on this machine');
  });
  afterEach(() => TestBed.resetTestingModule());

  const query = (id: string) =>
    element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  function render(inputs: Record<string, unknown> = {}) {
    for (const [name, value] of Object.entries(inputs))
      fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
  }

  it('shows the status with its colour on the dot only, never on the text (deviation 6)', () => {
    render({ status: 'connected', positiveProbeEvidence: true });
    const status = query('connection-status');
    expect(status?.textContent?.trim()).toBe('Connected & verified');
    expect(status?.className).toContain('text-base-content');
    expect(status?.className).not.toMatch(/text-(success|error|primary)/);
    expect(status?.querySelector('[aria-hidden="true"]')?.className).toContain(
      'bg-success',
    );
    expect(query('connection-auth-mode')?.textContent?.trim()).toBe('API key');
    expect(query('connection-credential-storage')?.textContent?.trim()).toBe(
      'Stored on this machine',
    );
  });

  it('shows a busy skeleton instead of the status while loading, with Check connection disabled', () => {
    render({ loading: true });
    expect(query('connection-status')).toBeNull();
    expect(
      query('connection-status-skeleton')?.closest('[aria-busy="true"]'),
    ).not.toBeNull();
    expect(
      isDisabledControl(query('connection-check') as HTMLButtonElement),
    ).toBe(true);
  });

  it('Check connection asks the parent to check, and is disabled while a check runs', () => {
    const requested = jest.fn();
    fixture.componentInstance.checkConnectionRequested.subscribe(requested);
    render();
    query('connection-check')?.click();
    expect(requested).toHaveBeenCalledTimes(1);
    render({ checking: true });
    expect(
      isDisabledControl(query('connection-check') as HTMLButtonElement),
    ).toBe(true);
    expect(query('connection-check')?.textContent?.trim()).toBe('Checking…');
  });

  it('N1 (Batch 54.1): while the check runs the focused button keeps focus (aria-disabled, never native disabled) and a second click does nothing', () => {
    const requested = jest.fn();
    fixture.componentInstance.checkConnectionRequested.subscribe(requested);
    render();
    const check = query('connection-check') as HTMLButtonElement;
    check.focus();
    check.click();
    render({ checking: true });
    expect(check.getAttribute('aria-disabled')).toBe('true');
    expect(check.disabled).toBe(false);
    expect(document.activeElement).toBe(check);
    check.click();
    expect(requested).toHaveBeenCalledTimes(1);
    render({ checking: false });
    expect(check.hasAttribute('aria-disabled')).toBe(false);
    expect(document.activeElement).toBe(check);
  });

  it('during a check the status line reads "Checking…" (no skeleton) and Check connection is disabled', () => {
    render({ status: 'checking', checking: true, loading: false });
    expect(query('connection-status-skeleton')).toBeNull();
    expect(query('connection-status')?.textContent?.trim()).toBe('Checking…');
    expect(
      isDisabledControl(query('connection-check') as HTMLButtonElement),
    ).toBe(true);
  });

  it('a failed check reads "Check failed" with an error dot, base-content text, and stays retryable', () => {
    const requested = jest.fn();
    fixture.componentInstance.checkConnectionRequested.subscribe(requested);
    render({ status: 'check-failed' });
    const status = query('connection-status');
    expect(status?.textContent?.trim()).toBe('Check failed');
    expect(status?.className).toContain('text-base-content');
    expect(status?.className).not.toMatch(
      /text-(success|error|warning|primary)/,
    );
    expect(status?.querySelector('[aria-hidden="true"]')?.className).toContain(
      'bg-error',
    );
    const check = query('connection-check') as HTMLButtonElement;
    expect(isDisabledControl(check)).toBe(false);
    expect(check.textContent?.trim()).toBe('Retry check');
    check.click();
    expect(requested).toHaveBeenCalledTimes(1);
  });

  it('Check connection is disabled while a settings save is in flight', () => {
    render({ saving: true });
    expect(
      isDisabledControl(query('connection-check') as HTMLButtonElement),
    ).toBe(true);
  });

  describe('the last recorded check (Batch 28d)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(NOW);
    });
    afterEach(() => {
      jest.restoreAllMocks();
      jest.useRealTimers();
    });

    it('shows the latency on the status line and when it ran, in base-content text (deviation 6)', () => {
      render({
        status: 'connected',
        positiveProbeEvidence: true,
        lastCheck: verified(92),
      });
      const status = query('connection-status');
      expect(status?.textContent?.trim()).toBe('Connected & verified (92ms)');
      expect(status?.className).toContain('text-base-content');
      expect(status?.className).not.toMatch(
        /text-(success|error|warning|primary)/,
      );
      const when = query('connection-last-checked');
      expect(when?.textContent?.trim()).toBe('Checked just now');
      expect(when?.getAttribute('title')).toMatch(/^Last checked /);
    });

    it('shows no latency and no time line without a record', () => {
      render({
        status: 'connected',
        positiveProbeEvidence: true,
        lastCheck: null,
      });
      expect(query('connection-status')?.textContent?.trim()).toBe(
        'Connected & verified',
      );
      expect(query('connection-status')?.textContent).not.toMatch(/ms\)/);
      expect(query('connection-last-checked')).toBeNull();
    });

    it('a failed record reads "Check failed" with its fixed reason, never "verified" (D15)', () => {
      render({
        status: 'connected',
        positiveProbeEvidence: true,
        lastCheck: failed('credential-rejected'),
      });
      expect(query('connection-status')?.textContent?.trim()).toBe(
        'Check failed',
      );
      expect(
        query('connection-status')?.querySelector('[aria-hidden="true"]')
          ?.className,
      ).toContain('bg-error');
      expect(query('connection-last-checked')?.textContent?.trim()).toBe(
        'The provider rejected the stored key. Checked just now',
      );
      expect(element.textContent).not.toContain('verified');
      expect(query('connection-check')?.textContent?.trim()).toBe(
        'Check connection',
      );
    });

    it('an unknown reason from the host falls back to fixed copy, never the host value', () => {
      render({
        status: 'connected',
        lastCheck: failed('<raw host text>' as ConnectionCheckRecord['reason']),
      });
      expect(query('connection-last-checked')?.textContent?.trim()).toBe(
        'The check failed. Checked just now',
      );
      expect(element.textContent).not.toContain('raw host text');
    });

    it('while a new check runs the record is hidden behind "Checking…"', () => {
      render({ status: 'checking', checking: true, lastCheck: verified(92) });
      expect(query('connection-status')?.textContent?.trim()).toBe('Checking…');
      expect(query('connection-last-checked')).toBeNull();
    });

    /** The age timers this tab started (its 30 s interval), with their ids. */
    const ageTimers = (spy: jest.SpyInstance) =>
      spy.mock.calls
        .map((args, index) => ({
          ms: args[1] as unknown,
          id: spy.mock.results[index]?.value as unknown,
        }))
        .filter((timer) => timer.ms === 30000);

    it('refreshes the age while shown, and releases its one timer on destroy', () => {
      const started = jest.spyOn(globalThis, 'setInterval');
      const cleared = jest.spyOn(globalThis, 'clearInterval');
      render({
        status: 'connected',
        positiveProbeEvidence: true,
        lastCheck: verified(92),
      });
      expect(ageTimers(started)).toHaveLength(1);
      jest.advanceTimersByTime(2 * 60_000);
      fixture.detectChanges();
      expect(query('connection-last-checked')?.textContent?.trim()).toBe(
        'Checked 2 min ago',
      );
      fixture.destroy();
      expect(cleared).toHaveBeenCalledWith(ageTimers(started)[0].id);
    });

    it('runs no timer without a record, and stops it when the record goes', () => {
      const started = jest.spyOn(globalThis, 'setInterval');
      const cleared = jest.spyOn(globalThis, 'clearInterval');
      render({ status: 'connected', lastCheck: null });
      expect(ageTimers(started)).toHaveLength(0);
      render({ lastCheck: verified(92) });
      expect(ageTimers(started)).toHaveLength(1);
      render({ lastCheck: null });
      expect(cleared).toHaveBeenCalledWith(ageTimers(started)[0].id);
    });
  });

  it('Credential storage shows the masked key hint, not selectable; without one it keeps the label', () => {
    render({ keyHint: '•••• 8f21' });
    const hint = query('connection-key-hint');
    expect(hint?.textContent?.trim()).toBe('•••• 8f21');
    expect(hint?.className).toContain('select-none');
    expect(
      query('connection-credential-storage')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim(),
    ).toBe('•••• 8f21 (stored on this machine)');
    expect(
      element.querySelector(
        'button[aria-label*="Copy"], [data-testid*="copy"]',
      ),
    ).toBeNull();
    render({ keyHint: null });
    expect(query('connection-key-hint')).toBeNull();
    expect(query('connection-credential-storage')?.textContent?.trim()).toBe(
      'Stored on this machine',
    );
  });

  describe('Used-by states', () => {
    it('incomplete: Loading… with aria-busy, never "Not used yet", even with no entries', () => {
      render({ usageComplete: false, usedBy: [] });
      const loading = query('connection-used-by-loading');
      expect(loading?.textContent?.trim()).toBe('Loading…');
      expect(loading?.getAttribute('aria-busy')).toBe('true');
      expect(query('connection-used-by-empty')).toBeNull();
      expect(query('connection-used-by-count')).toBeNull();
    });

    it('complete and empty: Not used yet', () => {
      render({ usageComplete: true, usedBy: [] });
      const empty = query('connection-used-by-empty');
      expect(empty?.textContent).toContain('Not used yet');
      expect(empty?.textContent).toContain(
        'No active agents or lanes are currently routed through this provider.',
      );
      expect(query('connection-used-by-loading')).toBeNull();
      expect(query('connection-used-by-count')?.textContent?.trim()).toBe(
        '0 active routes',
      );
    });

    it('complete with entries: lists them in order with the count', () => {
      render({ usageComplete: true, usedBy: [MAIN, ARCHAEOLOGIST, JUDGE] });
      const rows = Array.from(element.querySelectorAll('[data-used-by]'));
      expect(rows.map((row) => row.getAttribute('data-used-by'))).toEqual([
        'main-agent',
        'archaeologist',
        'judge',
      ]);
      expect(query('connection-used-by-count')?.textContent?.trim()).toBe(
        '3 active routes',
      );
      expect(query('connection-used-by-empty')).toBeNull();
      // Own-provider rows carry a right-hand badge; a following row carries the chip instead.
      const badges = Array.from(
        element.querySelectorAll('[data-testid="connection-used-by-badge"]'),
      );
      expect(
        badges.map((badge) =>
          badge.closest('[data-used-by]')?.getAttribute('data-used-by'),
        ),
      ).toEqual(['main-agent', 'judge']);
      expect(badges.map((badge) => badge.textContent?.trim())).toEqual([
        'Active (Main agent)',
        'Active (Judge)',
      ]);
      expect(badges[1].className).toContain('text-base-content');
    });

    it('a failed source shows an alert with Retry instead of Loading…', () => {
      const retry = jest.fn();
      fixture.componentInstance.retryUsageRequested.subscribe(retry);
      render({ usageComplete: false, usageError: true });
      expect(query('connection-used-by-error')?.getAttribute('role')).toBe(
        'alert',
      );
      expect(query('connection-used-by-loading')).toBeNull();
      query('connection-used-by-error')?.querySelector('button')?.click();
      expect(retry).toHaveBeenCalledTimes(1);
    });
  });

  it('names the badge after the consumer', () => {
    expect(usedByBadge(JUDGE)).toBe('Active (Judge)');
    expect(
      usedByBadge({
        id: 'memory-curator',
        label: 'Memory curator',
        kind: 'background-role',
        followsMain: false,
      }),
    ).toBe('Active (Memory curator)');
    expect(
      usedByBadge({
        id: 'ptah-cli:a1',
        label: 'Reviewer (Ptah CLI agent)',
        kind: 'ptah-cli',
        followsMain: false,
      }),
    ).toBe('Active (Ptah CLI)');
    expect(usedByBadge(CODEX_CLI)).toBe('Active (Codex CLI)');
  });

  it('lists the Codex CLI under "Used by" with its own detail and badge, and no role link', () => {
    render({
      usageComplete: true,
      usedBy: [
        {
          id: 'memory-curator',
          label: 'Memory curator',
          kind: 'background-role',
          followsMain: false,
        },
        CODEX_CLI,
      ],
    });
    const row = element.querySelector<HTMLElement>(
      '[data-used-by="codex-cli"]',
    );
    expect(row?.textContent).toContain('Codex CLI');
    expect(row?.textContent).toContain('Uses this sign-in');
    expect(
      row
        ?.querySelector('[data-testid="connection-used-by-badge"]')
        ?.textContent?.trim(),
    ).toBe('Active (Codex CLI)');
    expect(
      row?.querySelector('[data-testid="connection-follows-main"]'),
    ).toBeNull();
    expect(query('connection-used-by-count')?.textContent?.trim()).toBe(
      '2 active routes',
    );
  });

  it('"Follows main agent →" opens that role on Agent Orchestration; own-provider rows have no chip', () => {
    render({ usageComplete: true, usedBy: [MAIN, ARCHAEOLOGIST, JUDGE] });
    const chips = element.querySelectorAll<HTMLButtonElement>(
      '[data-testid="connection-follows-main"]',
    );
    expect(chips).toHaveLength(1);
    expect(
      chips[0].closest('[data-used-by]')?.getAttribute('data-used-by'),
    ).toBe('archaeologist');
    expect(chips[0].getAttribute('aria-label')).toBe(
      'Archaeologist lane follows the main agent. Open it in Agent Orchestration',
    );
    chips[0].click();
    expect(requestSettingsTab).toHaveBeenCalledWith({
      tab: 'orchestration',
      section: 'archaeologist',
    });
  });
});
