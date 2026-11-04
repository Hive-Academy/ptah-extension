import { signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthStateService, CodexSignInService, ProvidersSettingsStateService, VSCodeService } from '@ptah-extension/core';
import { OnboardingFlagService, type OnboardingFlag } from '../first-run/onboarding-flag.service';
import { OnboardingAnnouncerService } from '../shell/onboarding-announcer.service';
import type { ChosenConnectionView, ProviderReadinessState, ProviderReadinessView, SelectionView } from './provider-readiness.derive';
import { ProviderReadinessStore } from './provider-readiness.store';
import { ReadyConnectionStepPage } from './ready-connection-step.page';

const view = (provider: ProviderReadinessView['provider'], state: ProviderReadinessState): ProviderReadinessView => ({
  provider, state, errorCause: null, failedFact: null,
  path: state === 'ready' || state === 'signed-out' ? `/usr/bin/${provider === 'claude-cli' ? 'claude' : 'codex'}` : null,
  version: state === 'ready' || state === 'signed-out' ? '1.0' : null, source: 'installed',
});

describe('ReadyConnectionStepPage parity rows 20–38', () => {
  let fixture: ComponentFixture<ReadyConnectionStepPage>;
  let claude: WritableSignal<ProviderReadinessView>;
  let codex: WritableSignal<ProviderReadinessView>;
  let selection: WritableSignal<SelectionView>;
  let rechecking: WritableSignal<boolean>;
  let signIn: WritableSignal<{ status: 'succeeded' | 'failed' | 'cancelled' } | null>;
  let refresh: jest.Mock<Promise<void>, ['mount' | 'recheck']>;
  let recheckCodex: jest.Mock<Promise<void>, []>;
  let markReady: jest.Mock<void, ['connectionAt' | 'skippedAt']>;
  let announce: jest.Mock<void, [string]>;
  let navigate: jest.SpyInstance;

  function render(claudeState: ProviderReadinessState = 'checking', codexState: ProviderReadinessState = 'checking', chosen: SelectionView = { kind: 'claude-cli' }): HTMLElement {
    claude = signal(view('claude-cli', claudeState));
    codex = signal(view('openai-codex', codexState));
    selection = signal(chosen);
    rechecking = signal(false);
    signIn = signal(null);
    refresh = jest.fn<Promise<void>, ['mount' | 'recheck']>().mockResolvedValue(undefined);
    recheckCodex = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    markReady = jest.fn<void, ['connectionAt' | 'skippedAt']>();
    announce = jest.fn<void, [string]>();
    const chosenView = (): ChosenConnectionView => {
      const selected = selection();
      return { selection: selected, provider: selected.kind === 'claude-cli' || selected.kind === 'openai-codex' ? selected.kind : null,
        name: selected.kind === 'openai-codex' ? 'Codex' : 'Claude Code',
        readiness: selected.kind === 'claude-cli' ? claude() : selected.kind === 'openai-codex' ? codex() : null };
    };
    TestBed.configureTestingModule({ imports: [ReadyConnectionStepPage], providers: [
      provideRouter([]),
      { provide: ProviderReadinessStore, useValue: { claude, codex, selection, chosen: chosenView, rechecking, refresh, recheckCodex, available: true } },
      { provide: OnboardingFlagService, useValue: { flag: signal<OnboardingFlag>({}), markReady } },
      { provide: OnboardingAnnouncerService, useValue: { announce } },
      { provide: CodexSignInService, useValue: { state: signIn, nothingSeen: signal(false), refreshFailed: signal(false) } },
      { provide: VSCodeService, useValue: { isElectron: true, config: signal({ platform: 'linux' }) } },
      { provide: ProvidersSettingsStateService, useValue: { reviewContext: signal(null), open: jest.fn(), commit: signal({ status: 'idle' }) } },
      { provide: AuthStateService, useValue: { refreshAuthStatus: jest.fn() } },
    ] });
    navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(ReadyConnectionStepPage);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  const panel = (el: HTMLElement, provider: 'claude' | 'codex') => el.querySelector<HTMLElement>(`[data-testid="ready-${provider}-panel"]`);
  const button = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === label);
  afterEach(() => TestBed.resetTestingModule());

  it('row 20: mount reads host cache once for both providers', () => { render(); expect(refresh).toHaveBeenCalledTimes(1); expect(refresh).toHaveBeenCalledWith('mount'); });
  it('row 21: route heading is one focusable h1 for both providers', () => { const el = render(); expect(el.querySelectorAll('h1')).toHaveLength(1); expect(el.querySelector('h1')?.textContent).toContain('Claude Code and Codex'); expect(el.querySelector('h1')?.tabIndex).toBe(-1); });
  it('row 22: provider-neutral lead explains the main connection and later fix', () => { const el = render(); expect(el.textContent).toContain('Ptah works with Claude Code or Codex'); expect(el.textContent).toContain('fix it later'); });
  it('row 23: each provider has a status chip', () => { const el = render('ready', 'missing'); expect(panel(el, 'claude')?.textContent).toContain('Ready'); expect(panel(el, 'codex')?.textContent).toContain('Not installed'); });
  it('row 24: each provider keeps installed, version and signed-in facts', () => { const el = render('ready', 'ready'); for (const name of ['claude', 'codex'] as const) { expect(panel(el, name)?.textContent).toContain('Installed'); expect(panel(el, name)?.textContent).toContain('Version'); expect(panel(el, name)?.textContent).toContain('Signed in'); } });
  it('row 25: local error preserves a signed-in cause line', () => { const el = render('error'); expect(panel(el, 'claude')?.textContent).toContain('Ptah could not'); });
  it('row 26: checking panel is busy and exposes state', () => { const el = render(); expect(panel(el, 'claude')?.getAttribute('aria-busy')).toBe('true'); expect(panel(el, 'claude')?.dataset['state']).toBe('checking'); });
  it('row 27: Claude install help retains OS tabs', () => { const el = render('missing'); expect(panel(el, 'claude')?.querySelector('[role="tablist"]')).not.toBeNull(); });
  it('row 28: install help has copyable command rows', () => { const el = render('missing'); expect(panel(el, 'claude')?.querySelector('ptah-command-copy-row')).not.toBeNull(); });
  it('row 29: copy row remains a separate reusable component', () => { const el = render('missing'); expect(panel(el, 'claude')?.querySelector('ptah-command-copy-row')).not.toBeNull(); });
  it('row 30: missing help includes the PATH and restart hint', () => { const el = render('missing'); expect(panel(el, 'claude')?.textContent).toContain('PATH'); expect(panel(el, 'claude')?.textContent).toContain('restart Ptah'); });
  it('row 31: official install guide is an https safe link', () => { const el = render('missing'); const a = panel(el, 'claude')?.querySelector<HTMLAnchorElement>('[data-testid="ready-docs-link"]'); expect(a?.href).toMatch(/^https:/); expect(a?.rel).toContain('noopener'); });
  it('row 32: signed-out help retains the copyable claude command', () => { const el = render('signed-out'); expect(panel(el, 'claude')?.textContent).toContain('claude'); expect(panel(el, 'claude')?.querySelector('[data-testid="ready-sign-in-block"]')).not.toBeNull(); });
  it('row 33: named-account link targets the Claude Accounts drawer', () => { const el = render('signed-out'); expect(panel(el, 'claude')?.querySelector('[data-testid="ready-named-account-link"]')).not.toBeNull(); });
  it('row 34: error help remains distinct from signed-out help', () => { const el = render('error'); expect(panel(el, 'claude')?.querySelector('[data-testid="ready-error-block"]')).not.toBeNull(); expect(panel(el, 'claude')?.textContent).toContain('not the same'); });
  it('row 35: not-ready footer explains continuing without the connection', () => { expect(render('missing').textContent).toContain('A warning stays on the next screens'); });
  it('row 36: mount checking footer names the computer check', () => { expect(render().textContent).toContain('Checking your computer'); });
  it('row 37: Continue writes connectionAt and opens settings', () => { const el = render('ready'); button(el, 'Continue')?.click(); expect(markReady).toHaveBeenCalledWith('connectionAt'); expect(navigate).toHaveBeenCalled(); });
  it('row 38: Continue anyway writes skippedAt and opens settings', () => { const el = render('missing'); button(el, 'Continue anyway')?.click(); expect(markReady).toHaveBeenCalledWith('skippedAt'); expect(navigate).toHaveBeenCalled(); });

  it('Re-check announces Claude then Codex and refreshes both', async () => { const el = render('missing', 'ready'); button(el, 'Re-check')?.click(); await fixture.whenStable(); expect(refresh).toHaveBeenCalledWith('recheck'); expect(announce.mock.calls.map(([message]) => message)).toEqual(['Claude Code is still not installed.', 'Codex is ready.']); });
  it.each([
    ['Claude', 'claude-cli'],
    ['Codex', 'openai-codex'],
  ] as const)('(parity row 39) Re-check focuses Continue when chosen %s becomes ready', async (_name, provider) => {
    const el = render('missing', 'missing', { kind: provider });
    const recheckButton = button(el, 'Re-check');
    expect(recheckButton).toBeDefined();
    expect(button(el, 'Continue')).toBeUndefined();
    refresh.mockImplementation(async (reason) => {
      if (reason === 'recheck') {
        if (provider === 'claude-cli') claude.set(view('claude-cli', 'ready'));
        else codex.set(view('openai-codex', 'ready'));
      }
    });
    recheckButton?.focus();
    recheckButton?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    const continueButton = button(el, 'Continue');
    expect(continueButton).toBeDefined();
    expect(document.activeElement).toBe(continueButton);
  });

  it('(parity row 39) Re-check keeps focus when the chosen provider stays unready', async () => {
    const el = render('missing');
    const recheckButton = button(el, 'Re-check');
    expect(recheckButton).toBeDefined();
    recheckButton?.focus();
    recheckButton?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(button(el, 'Continue')).toBeUndefined();
    expect(document.activeElement).toBe(recheckButton);
  });
  it('Codex sign-in success starts a Codex recheck', async () => { render('missing', 'signed-out', { kind: 'openai-codex' }); signIn.set({ status: 'succeeded' }); fixture.detectChanges(); await fixture.whenStable(); expect(recheckCodex).toHaveBeenCalledTimes(1); });
  it('shows two panels in fixed Claude then Codex order', () => { const el = render('ready', 'missing'); expect([...el.querySelectorAll('[data-testid$="-panel"]')].map(node => node.getAttribute('data-testid'))).toEqual(['ready-claude-panel', 'ready-codex-panel']); });
  it('does not offer Continue for an unconfirmed or unready selection', () => { const el = render('ready', 'ready', { kind: 'unreadable' }); expect(button(el, 'Continue')).toBeUndefined(); expect(button(el, 'Continue anyway')).toBeDefined(); });
  it('bundled ready Codex has no install help', () => { const el = render('missing', 'ready', { kind: 'openai-codex' }); codex.set({ ...codex(), source: 'bundled' }); fixture.detectChanges(); expect(panel(el, 'codex')?.querySelector('[data-testid="ready-install-block"]')).toBeNull(); expect(button(el, 'Continue')).toBeDefined(); });
  it('Codex missing shows install rows and a safe official guide link', () => { const el = render('ready', 'missing', { kind: 'openai-codex' }); const codexPanel = panel(el, 'codex'); expect(codexPanel?.querySelector('ptah-command-copy-row')).not.toBeNull(); expect(codexPanel?.querySelector<HTMLAnchorElement>('a[href^="https:"]')?.rel).toContain('noopener'); });
  it('chosen ready provider shows no help and the other panel is information only', () => { const el = render('ready', 'missing'); expect(panel(el, 'claude')?.querySelector('[data-testid="ready-install-block"]')).toBeNull(); expect(panel(el, 'codex')?.textContent).toContain('Not your main connection'); expect(panel(el, 'codex')?.querySelector('details')?.open).toBe(false); });
  it('failed or cancelled Codex sign-in keeps the Re-check path', () => { const el = render('ready', 'signed-out', { kind: 'openai-codex' }); signIn.set({ status: 'failed' }); fixture.detectChanges(); expect(button(el, 'Re-check')).toBeDefined(); signIn.set({ status: 'cancelled' }); fixture.detectChanges(); expect(button(el, 'Continue anyway')).toBeDefined(); });
});
