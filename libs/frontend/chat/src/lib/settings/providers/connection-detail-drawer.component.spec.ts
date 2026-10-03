import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { AppStateManager, ProvidersSettingsStateService, type ProvidersConnection } from '@ptah-extension/core';
import { PROVIDER_MODELS_LOADER } from '@ptah-extension/ui';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { ConnectionDetailDrawerComponent } from './connection-detail-drawer.component';
import { connectionInitials } from './provider-connection-card.state';

const connection = (overrides: Partial<ProvidersConnection>): ProvidersConnection => ({
  id: 'moonshot', name: 'Moonshot (Kimi)', authMode: 'apiKey', hasKey: true, configured: true, custom: false,
  defaultsResolvable: true, accountLabel: null, tokenStale: false, ...overrides,
});
const MOONSHOT = connection({});
const SOVEREIGNEG = connection({ id: 'sovereigneg', name: 'sovereigneg', custom: true });
const CLAUDE_CLI = connection({ id: 'claude-cli', name: 'Claude (Subscription)', authMode: 'cli', hasKey: false });

const verify = jest.fn(async (params: { probeId: string }) => ({ probeId: params.probeId, outcome: 'verified' as const,
  reason: null, detail: null, latencyMs: 50, modelUsed: null, checkedAt: '2026-09-30T10:00:00Z' }));

describe('ConnectionDetailDrawerComponent', () => {
  let fixture: ComponentFixture<ConnectionDetailDrawerComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ConnectionDetailDrawerComponent],
      providers: [
        { provide: AppStateManager, useValue: { requestSettingsTab: jest.fn() } },
        // Read by the Models & Tiers and Advanced tabs.
        { provide: ProvidersSettingsStateService, useValue: {
          tiers: signal({ status: 'unloaded', data: null, error: null }),
          commit: signal({ status: 'idle', saved: [], unsaved: [], unconfirmed: [], refreshFailed: false, message: null }),
          reviewContext: () => ({ scopeKey: 'workspace', activePath: '/workspace' }),
          refreshTiers: jest.fn(async () => undefined),
          customEntry: () => ({ id: 'sovereigneg', name: 'sovereigneg', baseUrl: 'https://gateway.example/v1', lane: 'openai',
            modelsEndpoint: null, helpUrl: '', pricing: null }),
        } },
        SettingsSaveFeedbackService,
        { provide: PROVIDER_MODELS_LOADER, useValue: { listModels: jest.fn().mockResolvedValue({ models: [], totalCount: 0 }) } },
      ],
    });
    fixture = TestBed.createComponent(ConnectionDetailDrawerComponent);
    fixture.componentRef.setInput('verifyDraftConnection', verify);
    fixture.componentRef.setInput('cancelDraftVerification', jest.fn(async () => ({ cancelled: true })));
  });
  afterEach(() => { fixture.destroy(); TestBed.resetTestingModule(); });

  /** The drawer renders through `NativeDrawerComponent`, fixed-position inside the host. */
  const query = (selector: string) => (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(selector);
  const byTestId = (id: string) => query(`[data-testid="${id}"]`);
  const tabLabels = () => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('[role="tab"]'))
    .map((tab) => tab.textContent?.trim());
  function render(inputs: Record<string, unknown>) {
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
  }
  function selectTab(label: string) {
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[role="tab"]'))
      .find((tab) => tab.textContent?.trim() === label)?.click();
    fixture.detectChanges();
  }

  it('renders nothing without a connection', () => {
    render({ connection: null });
    expect(byTestId('connection-detail-drawer')).toBeNull();
    expect(query('[role="dialog"]')).toBeNull();
  });

  it('projects the header and footer into the drawer slots, outside the scrolling body (NG8011 regression)', () => {
    render({ connection: MOONSHOT });
    const body = byTestId('native-drawer-body');
    expect(body?.contains(byTestId('connection-detail-drawer'))).toBe(false);
    expect(body?.contains(byTestId('connection-drawer-close'))).toBe(false);
    expect(body?.contains(query('[role="tablist"]'))).toBe(true);
  });

  it('is a labelled dialog showing this connection, opened on Overview', () => {
    render({ connection: MOONSHOT, canEdit: true });
    expect(query('[role="dialog"]')?.getAttribute('aria-label')).toBe('Moonshot (Kimi) connection details');
    expect(byTestId('connection-drawer-title')?.textContent?.trim()).toBe('Moonshot (Kimi)');
    expect(byTestId('connection-drawer-subtitle')?.textContent?.trim()).toBe('API key · Stored locally');
    expect(byTestId('connection-drawer-avatar')?.textContent?.trim()).toBe('MK');
    expect(byTestId('connection-drawer-avatar')?.className).toContain('text-base-content');
    expect(query('[role="tab"][aria-selected="true"]')?.textContent?.trim()).toBe('Overview & Used By');
    expect(byTestId('connection-overview')).not.toBeNull();
  });

  it.each([
    ['an API-key connection', MOONSHOT, ['Overview & Used By', 'Credentials', 'Models & Tiers']],
    ['the Claude CLI subscription', CLAUDE_CLI, ['Overview & Used By', 'Credentials', 'Models & Tiers']],
    ['a custom endpoint', SOVEREIGNEG, ['Overview & Used By', 'Credentials', 'Models & Tiers', 'Advanced']],
  ])('renders only the tabs that apply to %s', (_name, value, labels) => {
    render({ connection: value });
    expect(tabLabels()).toEqual(labels);
  });

  it('is per connection: mode and credential copy follow the connection, not Claude', () => {
    render({ connection: CLAUDE_CLI });
    expect(byTestId('connection-auth-mode')?.textContent?.trim()).toBe('CLI subscription');
    expect(byTestId('connection-credential-storage')?.textContent?.trim()).toBe('Claude CLI login session');
    expect(byTestId('connection-drawer-subtitle')?.textContent?.trim()).toBe('CLI subscription · Claude CLI login');
    render({ connection: SOVEREIGNEG });
    expect(byTestId('connection-auth-mode')?.textContent?.trim()).toBe('API key (custom endpoint)');
    expect(byTestId('connection-credential-storage')?.textContent?.trim()).toBe('Stored on this machine');
    render({ connection: connection({ id: 'keyless', name: 'keyless', custom: true, hasKey: false }) });
    expect(byTestId('connection-auth-mode')?.textContent?.trim()).toBe('Custom endpoint');
  });

  it('an unreadable stored key (final review M-6) reads as unknown on Overview and Credentials, never "No key stored", and Retry re-reads', () => {
    const unreadable = connection({ hasKey: false, keyUnreadable: true });
    render({ connection: unreadable });
    expect(byTestId('connection-drawer-subtitle')?.textContent?.trim()).toBe('API key · Stored key unreadable');
    expect(byTestId('connection-credential-storage')?.textContent?.trim()).toBe('Could not read the stored key.');
    selectTab('Credentials');
    expect(byTestId('credentials-key-unreadable')?.textContent?.trim()).toBe('Could not read the stored key.');
    const all = (fixture.nativeElement as HTMLElement).textContent ?? '';
    for (const wording of ['No key stored', 'Not set', 'Add API key', 'Add key']) expect(all).not.toContain(wording);
    const retried = jest.fn();
    fixture.componentInstance.keyRetryRequested.subscribe(retried);
    byTestId('credentials-key-unreadable-retry')?.click();
    expect(retried).toHaveBeenCalledTimes(1);
  });

  it("names a custom endpoint's protocol only when the state knows it", () => {
    render({ connection: SOVEREIGNEG });
    expect(byTestId('connection-drawer-subtitle')?.textContent?.trim()).toBe('Custom gateway');
    render({ customProtocol: 'openai' });
    expect(byTestId('connection-drawer-subtitle')?.textContent?.trim()).toBe('Custom gateway · OpenAI-compatible');
    render({ customProtocol: 'anthropic' });
    expect(byTestId('connection-drawer-subtitle')?.textContent?.trim()).toBe('Custom gateway · Anthropic-compatible');
    // Host data outside the type (a future protocol) never renders as "undefined".
    render({ customProtocol: 'grpc' });
    expect(byTestId('connection-drawer-subtitle')?.textContent?.trim()).toBe('Custom gateway');
  });

  it.each([
    ['Moonshot (Kimi)', 'MK'],
    ['sovereigneg', 'SO'],
    ['OpenAI Codex', 'OC'],
    ['', '?'],
    ['\u{1D400}lpha Beta', '\u{1D400}B'],
    ['\u{1D400}\u{1D401}', '\u{1D400}\u{1D401}'],
  ])('avatar initials of "%s" are %s', (name, initials) => {
    expect(connectionInitials(name)).toBe(initials);
  });

  it('the Overview footer has Close only; other tabs add one primary action, never a blanket Save (deviation 3)', () => {
    const setup = jest.fn();
    fixture.componentInstance.setupRequested.subscribe(setup);
    render({ connection: SOVEREIGNEG, canEdit: true });
    expect(byTestId('connection-edit-in-setup')).toBeNull();
    expect(byTestId('connection-drawer-close')).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Save Changes');

    // A custom gateway keeps setup (D14) for what its tabs do not hold: its address on Credentials, its
    // own default models on Models & Tiers, its name and protocol on Advanced.
    for (const label of ['Credentials', 'Models & Tiers', 'Advanced']) {
      selectTab(label);
      const buttons = Array.from(query('[drawer-footer]')?.querySelectorAll('button') ?? []);
      expect(buttons.map((button) => button.textContent?.trim())).toEqual(['Close', 'Edit in setup']);
      expect(byTestId('connection-setup-copy')?.textContent).toContain('in setup');
    }
    byTestId('connection-edit-in-setup')?.click();
    expect(setup).toHaveBeenCalledWith('sovereigneg');
  });

  it.each([
    ['an API-key connection', MOONSHOT],
    ['the Claude CLI subscription', CLAUDE_CLI],
  ])('Credentials of %s holds every credential path: the tab body, no setup fallback', (_name, value) => {
    render({ connection: value, canEdit: true });
    selectTab('Credentials');
    expect(byTestId('connection-credentials')).not.toBeNull();
    expect(byTestId('connection-edit-in-setup')).toBeNull();
    const buttons = Array.from(query('[drawer-footer]')?.querySelectorAll('button') ?? []);
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['Close']);
  });

  it('relays the Credentials tab requests', () => {
    const deleted = jest.fn();
    fixture.componentInstance.deleteKeyRequested.subscribe(deleted);
    render({ connection: MOONSHOT });
    selectTab('Credentials');
    byTestId('credentials-delete')?.click(); fixture.detectChanges();
    byTestId('credentials-delete-confirm-button')?.click();
    expect(deleted).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an API-key connection', MOONSHOT],
    ['the Claude CLI subscription', CLAUDE_CLI],
  ])('Models & Tiers of %s holds every tier edit: the tab body, no setup fallback', (_name, value) => {
    render({ connection: value, canEdit: true });
    selectTab('Models & Tiers');
    expect(byTestId('connection-models')).not.toBeNull();
    expect(byTestId('connection-edit-in-setup')).toBeNull();
  });

  it('mounts the Advanced tab for a custom gateway, with its driver state', () => {
    render({ connection: SOVEREIGNEG, isDriver: true });
    selectTab('Advanced');
    expect(byTestId('connection-advanced')).not.toBeNull();
    expect(byTestId('advanced-delete-blocked')?.textContent?.trim()).toBe('Switch the main agent first.');
  });

  it('Edit in setup is disabled while setup cannot start', () => {
    render({ connection: SOVEREIGNEG, canEdit: false });
    selectTab('Advanced');
    expect((byTestId('connection-edit-in-setup') as HTMLButtonElement).disabled).toBe(true);
  });

  it('the Models & Tiers tab shows a busy skeleton until its tiers load', () => {
    render({ connection: MOONSHOT });
    selectTab('Models & Tiers');
    expect(byTestId('models-skeleton')?.getAttribute('aria-busy')).toBe('true');
  });

  it('Close, Esc and the header close button all request closure', () => {
    const closed = jest.fn();
    fixture.componentInstance.closed.subscribe(closed);
    render({ connection: MOONSHOT });
    byTestId('connection-drawer-close')?.click();
    query('[role="dialog"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    byTestId('native-drawer-close')?.click();
    expect(closed).toHaveBeenCalledTimes(3);
  });

  it('opening another connection starts again on Overview, and a stale tab falls back to Overview', () => {
    render({ connection: SOVEREIGNEG });
    selectTab('Advanced');
    expect(query('[role="tab"][aria-selected="true"]')?.textContent?.trim()).toBe('Advanced');
    render({ connection: MOONSHOT });
    expect(query('[role="tab"][aria-selected="true"]')?.textContent?.trim()).toBe('Overview & Used By');
  });

  it('passes the Used-by state through to the Overview', () => {
    render({ connection: SOVEREIGNEG, usedBy: [], usageComplete: true });
    expect(byTestId('connection-used-by-empty')?.textContent).toContain('Not used yet');
    render({ usageComplete: false });
    expect(byTestId('connection-used-by-loading')?.getAttribute('aria-busy')).toBe('true');
  });
});
