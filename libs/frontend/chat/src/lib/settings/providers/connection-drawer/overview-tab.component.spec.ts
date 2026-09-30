import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { AppStateManager } from '@ptah-extension/core';
import type { UsedBy } from '../connection-usage';
import { OverviewTabComponent, overviewStatus, usedByBadge } from './overview-tab.component';

const MAIN: UsedBy = { id: 'main-agent', label: 'Main agent', kind: 'main-agent', followsMain: false };
const ARCHAEOLOGIST: UsedBy = { id: 'archaeologist', label: 'Archaeologist lane', kind: 'background-role', followsMain: true };
const JUDGE: UsedBy = { id: 'judge', label: 'Judge lane', kind: 'background-role', followsMain: false };

describe('overviewStatus', () => {
  it.each([
    ['connected with evidence', 'connected', true, false, 'Connected & verified', 'success'],
    ['connected, host cannot check (no evidence either way)', 'connected', null, false, 'Connected', 'success'],
    ['connected without evidence is never Connected', 'connected', false, false, 'Not checked', 'neutral'],
    ['connected and the active driver', 'connected', true, true, 'Active for main agent', 'success'],
    ['reachable without evidence', 'reachable', null, false, 'Not checked', 'neutral'],
    ['unknown (host cannot check)', 'unknown', null, false, 'Not checked', 'neutral'],
    ['skipped', 'skipped', null, false, 'Check unavailable', 'neutral'],
    ['unreachable', 'unreachable', null, false, 'Unreachable', 'warning'],
    ['needs key', 'needs-key', null, false, 'Needs API key', 'warning'],
    ['a check in flight', 'checking', false, false, 'Checking…', 'neutral'],
    ['a failed check (route read error)', 'check-failed', false, false, 'Check failed', 'error'],
  ] as const)('%s', (_name, status, evidence, active, label, tone) => {
    expect(overviewStatus(status, evidence, active, 'api-key')).toEqual({ label, tone });
  });

  it('names a rejected key for key-based kinds and a sign-in for the others', () => {
    expect(overviewStatus('unauthenticated', null, false, 'api-key').label).toBe('Credential rejected');
    expect(overviewStatus('unauthenticated', null, false, 'oauth').label).toBe('Sign-in required');
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
      providers: [{ provide: AppStateManager, useValue: { requestSettingsTab } }],
    });
    fixture = TestBed.createComponent(OverviewTabComponent);
    element = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('kind', 'api-key');
    fixture.componentRef.setInput('authModeLabel', 'API key');
    fixture.componentRef.setInput('credentialLabel', 'Stored on this machine');
  });
  afterEach(() => TestBed.resetTestingModule());

  const query = (id: string) => element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  function render(inputs: Record<string, unknown> = {}) {
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
  }

  it('shows the status with its colour on the dot only, never on the text (deviation 6)', () => {
    render({ status: 'connected', positiveProbeEvidence: true });
    const status = query('connection-status');
    expect(status?.textContent?.trim()).toBe('Connected & verified');
    expect(status?.className).toContain('text-base-content');
    expect(status?.className).not.toMatch(/text-(success|error|primary)/);
    expect(status?.querySelector('[aria-hidden="true"]')?.className).toContain('bg-success');
    expect(query('connection-auth-mode')?.textContent?.trim()).toBe('API key');
    expect(query('connection-credential-storage')?.textContent?.trim()).toBe('Stored on this machine');
  });

  it('shows a busy skeleton instead of the status while loading, with Check connection disabled', () => {
    render({ loading: true });
    expect(query('connection-status')).toBeNull();
    expect(query('connection-status-skeleton')?.closest('[aria-busy="true"]')).not.toBeNull();
    expect((query('connection-check') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Check connection asks the parent to check, and is disabled while a check runs', () => {
    const requested = jest.fn();
    fixture.componentInstance.checkConnectionRequested.subscribe(requested);
    render();
    query('connection-check')?.click();
    expect(requested).toHaveBeenCalledTimes(1);
    render({ checking: true });
    expect((query('connection-check') as HTMLButtonElement).disabled).toBe(true);
    expect(query('connection-check')?.textContent?.trim()).toBe('Checking…');
  });

  it('during a check the status line reads "Checking…" (no skeleton) and Check connection is disabled', () => {
    render({ status: 'checking', checking: true, loading: false });
    expect(query('connection-status-skeleton')).toBeNull();
    expect(query('connection-status')?.textContent?.trim()).toBe('Checking…');
    expect((query('connection-check') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a failed check reads "Check failed" with an error dot, base-content text, and stays retryable', () => {
    const requested = jest.fn();
    fixture.componentInstance.checkConnectionRequested.subscribe(requested);
    render({ status: 'check-failed' });
    const status = query('connection-status');
    expect(status?.textContent?.trim()).toBe('Check failed');
    expect(status?.className).toContain('text-base-content');
    expect(status?.className).not.toMatch(/text-(success|error|warning|primary)/);
    expect(status?.querySelector('[aria-hidden="true"]')?.className).toContain('bg-error');
    const check = query('connection-check') as HTMLButtonElement;
    expect(check.disabled).toBe(false);
    expect(check.textContent?.trim()).toBe('Retry check');
    check.click();
    expect(requested).toHaveBeenCalledTimes(1);
  });

  it('Check connection is disabled while a settings save is in flight', () => {
    render({ saving: true });
    expect((query('connection-check') as HTMLButtonElement).disabled).toBe(true);
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
      expect(empty?.textContent).toContain('No active agents or lanes are currently routed through this provider.');
      expect(query('connection-used-by-loading')).toBeNull();
      expect(query('connection-used-by-count')?.textContent?.trim()).toBe('0 active routes');
    });

    it('complete with entries: lists them in order with the count', () => {
      render({ usageComplete: true, usedBy: [MAIN, ARCHAEOLOGIST, JUDGE] });
      const rows = Array.from(element.querySelectorAll('[data-used-by]'));
      expect(rows.map((row) => row.getAttribute('data-used-by'))).toEqual(['main-agent', 'archaeologist', 'judge']);
      expect(query('connection-used-by-count')?.textContent?.trim()).toBe('3 active routes');
      expect(query('connection-used-by-empty')).toBeNull();
      // Own-provider rows carry a right-hand badge; a following row carries the chip instead.
      const badges = Array.from(element.querySelectorAll('[data-testid="connection-used-by-badge"]'));
      expect(badges.map((badge) => badge.closest('[data-used-by]')?.getAttribute('data-used-by'))).toEqual(['main-agent', 'judge']);
      expect(badges.map((badge) => badge.textContent?.trim())).toEqual(['Active (Main agent)', 'Active (Judge)']);
      expect(badges[1].className).toContain('text-base-content');
    });

    it('a failed source shows an alert with Retry instead of Loading…', () => {
      const retry = jest.fn();
      fixture.componentInstance.retryUsageRequested.subscribe(retry);
      render({ usageComplete: false, usageError: true });
      expect(query('connection-used-by-error')?.getAttribute('role')).toBe('alert');
      expect(query('connection-used-by-loading')).toBeNull();
      query('connection-used-by-error')?.querySelector('button')?.click();
      expect(retry).toHaveBeenCalledTimes(1);
    });
  });

  it('names the badge after the consumer', () => {
    expect(usedByBadge(JUDGE)).toBe('Active (Judge)');
    expect(usedByBadge({ id: 'memory-curator', label: 'Memory curator', kind: 'background-role', followsMain: false }))
      .toBe('Active (Memory curator)');
    expect(usedByBadge({ id: 'ptah-cli:a1', label: 'Reviewer (Ptah CLI agent)', kind: 'ptah-cli', followsMain: false }))
      .toBe('Active (Ptah CLI)');
  });

  it('"Follows main agent →" opens that role on Agent Orchestration; own-provider rows have no chip', () => {
    render({ usageComplete: true, usedBy: [MAIN, ARCHAEOLOGIST, JUDGE] });
    const chips = element.querySelectorAll<HTMLButtonElement>('[data-testid="connection-follows-main"]');
    expect(chips).toHaveLength(1);
    expect(chips[0].closest('[data-used-by]')?.getAttribute('data-used-by')).toBe('archaeologist');
    expect(chips[0].getAttribute('aria-label')).toBe('Archaeologist lane follows the main agent. Open it in Agent Orchestration');
    chips[0].click();
    expect(requestSettingsTab).toHaveBeenCalledWith({ tab: 'orchestration', section: 'archaeologist' });
  });
});
