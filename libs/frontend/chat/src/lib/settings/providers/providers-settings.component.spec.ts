import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ClaudeRpcService, RpcResult, ProvidersSettingsStateService, type ProvidersSettingsSection, type ProvidersEffectiveRoute,
  type ProvidersSettingsCommit, type ProvidersConnection, type ProvidersExternalAuth,
} from '@ptah-extension/core';
import type { AuthVerifyDraftConnectionResult, ConfigGetScopesResult, SettingScope } from '@ptah-extension/shared';
import { PROVIDER_MODELS_LOADER } from '@ptah-extension/ui';
import { ProvidersSettingsComponent } from './providers-settings.component';
import { ProvidersModelsLoader } from './providers-models-loader.service';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import {
  ProviderSetupWizardComponent, type DraftVerifyConnectionFn, type DraftCancelVerificationFn,
  type ProviderWizardCommit, type WizardCommitState, type WizardExternalAction,
} from './provider-setup-wizard.component';

// jsdom has no <dialog> modal API (the catalog modal mounts with the page); the real behaviour is asserted in Playwright.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
});

/** SettingsComponent provides the loader for every tab; the page itself provides none. */
const SHELL_LOADER = { provide: PROVIDER_MODELS_LOADER, useClass: ProvidersModelsLoader };

@Component({ selector: 'ptah-provider-setup-wizard', standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush, template: '<p>Wizard draft stays mounted</p>' })
class WizardStub {
  readonly open = input(false);
  readonly deepLinkProviderId = input('');
  readonly existingCredentialPresent = input(false);
  readonly verifyDraftConnection = input.required<DraftVerifyConnectionFn>();
  readonly cancelDraftVerification = input.required<DraftCancelVerificationFn>();
  readonly supportedSaveTargets = input<readonly SettingScope[]>([]);
  readonly workspaceName = input<string | null>(null);
  readonly mainRouteExists = input(false);
  readonly defaultsResolvable = input(false);
  readonly commitState = input<WizardCommitState>('idle');
  readonly closed = output<void>();
  readonly commitRequested = output<ProviderWizardCommit>();
  readonly externalActionRequested = output<{ providerId: string; action: WizardExternalAction }>();
  readonly externalAuth = input<unknown>(null);
  readonly externalMessage = input<string | null>(null);
  readonly initialSetup = input<unknown>(null);
  readonly contextChanged = input(false);
  readonly commitDetail = input('');
  readonly providerChanged = output<string>();
  readonly reviewContextRequested = output<void>();
}

function ready<T>(data: T): ProvidersSettingsSection<T> { return { status: 'ready', data, error: null }; }
function unloaded<T>(): ProvidersSettingsSection<T> { return { status: 'unloaded', data: null, error: null }; }
const route: ProvidersEffectiveRoute = {
  route: 'api-key', ready: true, blockers: [], driverProviderId: 'first', resolvedAuthModality: 'api-key',
  resolvedModel: { kind: 'model', id: 'model-a' }, storedAuthMethodScope: 'global',
  providers: [{ id: 'first', type: 'apiKey', status: 'connected' }, { id: 'second', type: 'apiKey', status: 'connected' }],
  lastSuccessfulProbeAt: '2026-09-22T10:00:00Z', lastFailedProbeAt: null, probedAt: '2026-09-22T10:00:00Z', fromCache: false,
};
const idle: ProvidersSettingsCommit = { status: 'idle', saved: [], unsaved: [], unconfirmed: [], refreshFailed: false, message: null };
const connection = (id: string): ProvidersConnection => ({ id, name: id, authMode: 'apiKey', configured: true, hasKey: true, custom: false, defaultsResolvable: true, accountLabel: null, tokenStale: false });
const draft: ProviderWizardCommit = { providerId: 'first', displayName: 'First', authMode: 'apiKey', customName: null,
  customProtocol: null, credential: { kind: 'apiKey', value: 'private-draft-key' }, existingKeyReused: false,
  baseUrl: null, verified: { probeId: 'probe', checkedAt: '2026-09-22T10:00:00Z', latencyMs: 1, modelUsed: 'one' },
  tiers: { everyday: 'one', complex: 'two', fast: 'three' }, tierSnapshot: { everyday: null, complex: null, fast: null },
  editedTiers: ['everyday', 'complex', 'fast'], saveTo: 'global', activation: 'connect-only' };

class StateStub {
  readonly connectionSetup = signal<ProvidersSettingsSection<{ providerId: string; baseUrl: string | null; tiers: { sonnet: string | null; opus: string | null; haiku: string | null } }>>(unloaded());
  readonly cliTest = signal(unloaded());
  readonly refreshConnectionSetup = jest.fn(async () => undefined);
  readonly testCliConnection = jest.fn(async () => undefined);
  readonly saveCursorCredential = jest.fn(async () => undefined);
  readonly route = signal<ProvidersSettingsSection<ProvidersEffectiveRoute>>(unloaded());
  readonly scopes = signal<ProvidersSettingsSection<ConfigGetScopesResult>>(ready({ activePath: '/workspace', entries: [] }));
  readonly model = signal(ready({ model: 'model-a' }));
  readonly effort = signal(ready({ effort: undefined }));
  readonly connections = signal<ProvidersSettingsSection<readonly ProvidersConnection[]>>(ready([connection('first'), connection('second')]));
  // Read by the connection drawer's Used-by list.
  readonly memory = signal(ready({ curatorProvider: '' }));
  readonly lanes = signal(ready({}));
  readonly judging = signal(ready({ judgeProvider: '' }));
  readonly customEntry = jest.fn(() => null);
  readonly deleteStoredKey = jest.fn(async (_id: string, _context: unknown) => true);
  readonly disconnectCopilot = jest.fn(async (_context: unknown) => true);
  readonly cliAgents = signal(ready([]));
  readonly cliModels = signal(ready({}));
  readonly mainSources = signal(ready({}));
  readonly orchestration = signal<ProvidersSettingsSection<{ detectedClis: { cli: string; installed: boolean }[]; disabledClis: string[] }>>(
    ready({ detectedClis: [], disabledClis: [] }));
  /** The drawer's last check (Batch 28d); `checkProviderConnection` runs it. */
  readonly connectionCheck = signal<{ providerId: string; status: 'checking' | 'done' | 'failed' } | null>(null);
  readonly checkProviderConnection = jest.fn(async (_providerId: string) => undefined);
  readonly externalAuth = signal<ProvidersSettingsSection<ProvidersExternalAuth>>(unloaded());
  readonly delegatedModelOptions = signal(unloaded());
  readonly refreshDelegatedModelOptions = jest.fn(async () => undefined);
  readonly verification = signal<ProvidersSettingsSection<AuthVerifyDraftConnectionResult>>(unloaded());
  readonly commit = signal<ProvidersSettingsCommit>(idle);
  // Deliberately stale even during loading: the coordinator must defend the rendering boundary.
  readonly activeProviderId = signal<string | null>('first');
  readonly open = jest.fn(async () => undefined);
  readonly refresh = jest.fn(async () => undefined);
  readonly refreshRoute = jest.fn(async () => undefined);
  readonly checkConnection = jest.fn(async () => undefined);
  readonly refreshScopes = jest.fn(async () => undefined);
  readonly refreshMainSources = jest.fn(async () => undefined);
  readonly refreshModel = jest.fn(async () => undefined);
  readonly refreshEffort = jest.fn(async () => undefined);
  readonly refreshConnections = jest.fn(async () => undefined);
  readonly refreshCliAgents = jest.fn(async () => undefined);
  readonly refreshCliModels = jest.fn(async () => undefined);
  readonly refreshJudging = jest.fn(async () => undefined);
  readonly refreshOrchestration = jest.fn(async () => undefined);
  readonly reviewContext = jest.fn(() => ({ scopeKey: 'workspace', activePath: '/workspace' }));
  readonly scopeEntry = jest.fn(() => null);
  readonly writeScopes = jest.fn((): SettingScope[] => ['global', 'app', 'workspace']);
  readonly saveSettings = jest.fn(async () => undefined);
  readonly clearScopeOverride = jest.fn(async () => undefined);
  readonly connectProvider = jest.fn(async (_draft: unknown, _context: unknown): Promise<boolean | undefined> => undefined);
  readonly activateConnection = jest.fn(async () => undefined);
  readonly verifyDraft = jest.fn(async (_params: { probeId: string }) => undefined);
  readonly cancelVerification = jest.fn(async () => ({ cancelled: false }));
  readonly performExternalAuth = jest.fn(async () => undefined);
}

describe('ProvidersSettingsComponent', () => {
  let fixture: ComponentFixture<ProvidersSettingsComponent>;
  let state: StateStub;
  let element: HTMLElement;
  const listModels = jest.fn(async () => new RpcResult(true, { models: [{ id: 'catalog-model', name: 'Catalogue model' }] }));
  beforeEach(async () => {
    // jsdom has no scrollIntoView; the popover's model list scrolls its active row into view.
    Object.defineProperty(Element.prototype, 'scrollIntoView', { writable: true, configurable: true, value: jest.fn() });
    state = new StateStub();
    listModels.mockClear();
    await TestBed.configureTestingModule({ imports: [ProvidersSettingsComponent], providers: [
      { provide: ProvidersSettingsStateService, useValue: state },
      { provide: ClaudeRpcService, useValue: { call: listModels } },
      SHELL_LOADER, SettingsSaveFeedbackService,
    ] }).overrideComponent(ProvidersSettingsComponent, {
      remove: { imports: [ProviderSetupWizardComponent] },
      add: { imports: [WizardStub] },
    }).compileComponents();
    fixture = TestBed.createComponent(ProvidersSettingsComponent);
    element = fixture.nativeElement as HTMLElement;
  });
  afterEach(() => { fixture.destroy(); TestBed.resetTestingModule(); });
  async function render() { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); }
  function button(label: string): HTMLButtonElement {
    const result = Array.from(element.querySelectorAll('button')).find((node) => node.textContent?.trim() === label);
    if (!result) throw new Error(`Missing button: ${label}`);
    return result;
  }
  function activeBadges() {
    return Array.from(element.querySelectorAll('[data-testid="status-badge"]')).filter((node) => node.textContent?.includes('Active for main agent'));
  }
  function wizard(): WizardStub { return fixture.debugElement.query(By.directive(WizardStub)).injector.get(WizardStub); }
  const catalogDialog = () => element.querySelector<HTMLDialogElement>('ptah-provider-catalog-modal dialog');
  /** "Connect provider" opens the catalog; its custom endpoint row opens the wizard with nothing preselected. */
  async function openWizardThroughCatalog(trigger = button('Connect provider')) {
    trigger.focus(); trigger.click(); await render();
    element.querySelector<HTMLButtonElement>('[aria-label="Configure a custom endpoint"]')?.click(); await render();
  }

  describe('connection detail drawer', () => {
    const drawer = () => element.querySelector('[data-testid="connection-detail-drawer"]');
    const statusText = () => element.querySelector('[data-testid="connection-status"]')?.textContent?.trim();
    const checkButton = () => element.querySelector<HTMLButtonElement>('[data-testid="connection-check"]');
    async function openDrawer(id: string, opener?: HTMLElement) {
      opener?.focus();
      (fixture.componentInstance as unknown as { openDrawer(providerId: string): void }).openDrawer(id);
      await render();
    }

    it('removal (a loaded list without the id) closes the drawer, clears it, and returns focus to the opener', async () => {
      state.route.set(ready(route)); await render();
      const opener = element.querySelector<HTMLElement>('h2[data-focus="connections"]') as HTMLElement;
      await openDrawer('second', opener);
      expect(drawer()).not.toBeNull();
      (element.querySelector('[data-testid="connection-check"]') as HTMLElement).focus();

      state.connections.set(ready([connection('first')])); await render();
      expect(drawer()).toBeNull();
      expect(document.activeElement).toBe(opener);
      // Cleared, not parked: the connection coming back does not reopen the drawer by itself.
      state.connections.set(ready([connection('first'), connection('second')])); await render();
      expect(drawer()).toBeNull();
    });

    it('a refresh (list reloading with its data kept) leaves the drawer open', async () => {
      state.route.set(ready(route)); await render();
      await openDrawer('second');
      state.connections.set({ status: 'loading', data: [connection('first'), connection('second')], error: null }); await render();
      expect(drawer()).not.toBeNull();
      state.connections.set(ready([connection('first'), connection('second')])); await render();
      expect(drawer()).not.toBeNull();
    });

    it('during Check connection the status reads "Checking…" and the button is disabled', async () => {
      state.route.set(ready(route)); await render();
      await openDrawer('second');
      expect(statusText()).toBe('Connected & verified');
      state.route.set({ status: 'loading', data: route, error: null }); await render();
      expect(element.querySelector('[data-testid="connection-status-skeleton"]')).toBeNull();
      expect(statusText()).toBe('Checking…');
      expect(checkButton()?.disabled).toBe(true);
    });

    it('a failed check reads "Check failed" with no host error text, and the check stays retryable', async () => {
      state.route.set(ready(route)); await render();
      await openDrawer('second');
      state.route.set({ status: 'error', data: route, error: 'Could not load this section. Retry.' }); await render();
      expect(statusText()).toBe('Check failed');
      expect(element.querySelector('[data-testid="connection-overview"]')?.textContent).not.toContain('Could not load this section');
      expect(checkButton()?.disabled).toBe(false);
      checkButton()?.click();
      // Batch 28d: the drawer checks THIS connection (auth:checkConnection through the state), not a page refresh.
      expect(state.checkProviderConnection).toHaveBeenCalledWith('second');
      expect(state.checkConnection).not.toHaveBeenCalled();
    });

    describe('the recorded check and the key hint (Batch 28d)', () => {
      const lastChecked = () => element.querySelector('[data-testid="connection-last-checked"]')?.textContent?.trim();

      it('shows the route\'s recorded latency for this connection after a check', async () => {
        state.route.set(ready({ ...route, providers: [route.providers[0], { ...route.providers[1],
          lastCheck: { status: 'verified', reason: null, latencyMs: 92, checkedAt: new Date().toISOString() } }] }));
        await render();
        await openDrawer('second');
        expect(statusText()).toBe('Connected & verified (92ms)');
        expect(lastChecked()).toBe('Checked just now');
        // Another connection's record never shows here.
        await openDrawer('first');
        expect(statusText()).not.toMatch(/ms\)/);
        expect(lastChecked()).toBeUndefined();
      });

      it('its own running check reads "Checking…" with the button disabled; a failed request reads "Check failed" (D15)', async () => {
        state.route.set(ready({ ...route, providers: [route.providers[0], { ...route.providers[1],
          lastCheck: { status: 'verified', reason: null, latencyMs: 92, checkedAt: new Date().toISOString() } }] }));
        await render();
        await openDrawer('second');
        state.connectionCheck.set({ providerId: 'second', status: 'checking' }); await render();
        expect(statusText()).toBe('Checking…');
        expect(checkButton()?.disabled).toBe(true);
        state.connectionCheck.set({ providerId: 'second', status: 'failed' }); await render();
        expect(statusText()).toBe('Check failed');
        expect(element.querySelector('[data-testid="connection-overview"]')?.textContent).not.toContain('verified');
        expect(checkButton()?.textContent?.trim()).toBe('Retry check');
        // Another connection's failed check does not touch this one.
        state.connectionCheck.set({ providerId: 'first', status: 'failed' }); await render();
        expect(statusText()).toBe('Connected & verified (92ms)');
      });

      it('Overview "Credential storage" shows the stored key\'s masked hint', async () => {
        state.connections.set(ready([connection('first'), { ...connection('second'), keyHint: '•••• 8f21' }]));
        state.route.set(ready(route)); await render();
        await openDrawer('second');
        expect(element.querySelector('[data-testid="connection-credential-storage"]')?.textContent?.replace(/\s+/g, ' ').trim())
          .toBe('•••• 8f21 (stored on this machine)');
        await openDrawer('first');
        expect(element.querySelector('[data-testid="connection-credential-storage"]')?.textContent?.trim()).toBe('Stored on this machine');
      });

      it('counts the enabled Codex CLI under OpenAI Codex, and waits for the CLI read before counting', async () => {
        state.connections.set(ready([connection('first'), connection('second'), connection('openai-codex')]));
        state.memory.set(ready({ curatorProvider: 'openai-codex' }));
        state.orchestration.set({ status: 'loading', data: null, error: null });
        state.route.set(ready(route)); await render();
        const codexCount = () => Array.from(element.querySelectorAll('[data-testid="provider-connection-card"]'))
          .find((card) => card.textContent?.includes('openai-codex'))?.querySelector('[data-testid="used-by-count"]')?.textContent?.trim();
        expect(codexCount()).toBeUndefined();
        state.orchestration.set(ready({ detectedClis: [{ cli: 'codex', installed: true }], disabledClis: ['copilot'] })); await render();
        expect(codexCount()).toBe('Used by 2');
        await openDrawer('openai-codex');
        expect(element.querySelector('[data-used-by="codex-cli"]')?.textContent).toContain('Codex CLI');
        state.orchestration.set(ready({ detectedClis: [{ cli: 'codex', installed: true }], disabledClis: ['codex'] })); await render();
        expect(codexCount()).toBe('Used by 1');
        expect(element.querySelector('[data-used-by="codex-cli"]')).toBeNull();
      });
    });

    it('Check connection is disabled while a save is in flight', async () => {
      state.route.set(ready(route)); await render();
      await openDrawer('second');
      state.commit.set({ ...idle, status: 'saving' }); await render();
      expect(checkButton()?.disabled).toBe(true);
    });

    describe('Credentials writes (Batch 21)', () => {
      const byId = (id: string) => element.querySelector<HTMLElement>(`[data-testid="${id}"]`);
      async function credentialsTab(id: string) {
        state.route.set(ready(route)); await render();
        await openDrawer(id);
        Array.from(element.querySelectorAll<HTMLElement>('[role="tab"]')).find((tab) => tab.textContent?.trim() === 'Credentials')?.click();
        await render();
      }
      async function verifiedReplace(key: string) {
        byId('credentials-replace')?.click(); await render();
        const input = byId('credentials-new-key') as HTMLInputElement;
        input.value = key; input.dispatchEvent(new Event('input')); await render();
        state.verifyDraft.mockImplementationOnce(async (params: { probeId: string }) => {
          state.verification.set(ready({ probeId: params.probeId, outcome: 'verified', reason: null, detail: null,
            latencyMs: 40, modelUsed: null, checkedAt: '2026-09-30T10:00:00Z' }));
        });
        byId('credentials-verify')?.click(); await render(); await render();
      }

      it('opening the drawer reads the stored endpoint and tiers the Replace draft keeps', async () => {
        await credentialsTab('second');
        expect(state.refreshConnectionSetup).toHaveBeenCalledWith('second');
      });

      it('Replace saves through connectProvider, connect-only, with the verified probe and the stored tiers', async () => {
        state.connectionSetup.set(ready({ providerId: 'second', baseUrl: null, tiers: { sonnet: 'one', opus: 'two', haiku: 'three' } }));
        await credentialsTab('second');
        await verifiedReplace('sk-second');
        state.connectProvider.mockImplementationOnce(async () => { state.commit.set({ ...idle, status: 'saved', saved: ['Connection credential'] }); return true; });
        byId('credentials-save')?.click(); await render(); await render();
        const [draft] = state.connectProvider.mock.calls[0] as unknown as [Record<string, unknown>];
        expect(draft).toMatchObject({ providerId: 'second', activation: 'connect-only', saveTo: 'global', editedTiers: [],
          credential: { kind: 'apiKey', value: 'sk-second' }, tiers: { everyday: 'one', complex: 'two', fast: 'three' } });
        expect((draft['verified'] as { probeId: string }).probeId).toMatch(/^drawer-probe-/);
        expect(byId('credentials-commit')?.textContent).toContain('Key replaced.');
      });

      it('never reports Saved after a failed write, nor for an earlier save (D15)', async () => {
        state.commit.set({ ...idle, status: 'saved', saved: ['Something earlier'] });
        await credentialsTab('second');
        expect(byId('credentials-commit')).toBeNull();
        byId('credentials-delete')?.click(); await render();
        state.deleteStoredKey.mockImplementationOnce(async () => {
          state.commit.set({ ...idle, status: 'failed', unsaved: ['Stored key'], message: 'Stored key was not saved.' }); return true;
        });
        byId('credentials-delete-confirm-button')?.click(); await render(); await render();
        expect(state.deleteStoredKey).toHaveBeenCalledWith('second', { scopeKey: 'workspace', activePath: '/workspace' });
        expect(byId('credentials-commit')?.textContent).toContain('Not saved. Stored key was not saved.');
        expect(byId('credentials-commit')?.textContent).not.toContain('deleted');
      });

      it('a write refused because another save runs says so instead of Saved', async () => {
        await credentialsTab('second');
        byId('credentials-delete')?.click(); await render();
        state.deleteStoredKey.mockImplementationOnce(async () => false);
        byId('credentials-delete-confirm-button')?.click(); await render(); await render();
        expect(byId('credentials-commit')?.textContent).toContain('Another save is in progress');
      });

      // Batch 21 review, finding 3.
      it('a rejected write is reported, never left at Saving…', async () => {
        await credentialsTab('second');
        byId('credentials-delete')?.click(); await render();
        state.deleteStoredKey.mockImplementationOnce(async () => { throw new Error('host broke'); });
        byId('credentials-delete-confirm-button')?.click(); await render(); await render();
        expect(byId('credentials-commit')?.textContent).toContain('The save could not be completed. Retry.');
        expect((byId('credentials-delete') as HTMLButtonElement).disabled).toBe(false);
      });

      // Batch 21 review, finding 4 (interleavings).
      it('a write still running when the drawer closes never shows its outcome in the reopened drawer', async () => {
        await credentialsTab('second');
        byId('credentials-delete')?.click(); await render();
        let finish: (value: boolean) => void = () => undefined;
        state.deleteStoredKey.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
        byId('credentials-delete-confirm-button')?.click(); await render();
        expect(byId('credentials-commit')?.textContent).toContain('Saving…');
        byId('connection-drawer-close')?.click(); await render();
        await credentialsTab('second');
        state.commit.set({ ...idle, status: 'saved', saved: ['Stored key'] });
        finish(true); await render(); await render();
        expect(byId('credentials-commit')).toBeNull();
      });

      it('while a page save runs, the drawer\'s write controls are disabled', async () => {
        await credentialsTab('second');
        state.commit.set({ ...idle, status: 'saving' }); await render();
        expect((byId('credentials-delete') as HTMLButtonElement).disabled).toBe(true);
        expect((byId('credentials-replace') as HTMLButtonElement).disabled).toBe(true);
      });

      // Batch 21 review, finding 2.
      it('"drives the main agent" holds for a driver whose route is not ready and while a save runs', async () => {
        state.route.set(ready({ ...route, ready: false, driverProviderId: 'second' })); await render();
        await openDrawer('second');
        Array.from(element.querySelectorAll<HTMLElement>('[role="tab"]')).find((tab) => tab.textContent?.trim() === 'Credentials')?.click();
        await render();
        byId('credentials-delete')?.click(); await render();
        expect(byId('credentials-active-driver-warning')).not.toBeNull();
        state.route.set({ status: 'loading', data: null, error: null });
        state.commit.set({ ...idle, status: 'saving' }); await render();
        expect(byId('credentials-active-driver-warning')).not.toBeNull();
      });

      // Batch 21 review, finding 5.
      it('a failed setup read reaches the tab, whose Replace then cannot save', async () => {
        await credentialsTab('second');
        state.connectionSetup.set({ status: 'error', data: null, error: 'Could not load this section. Retry.' });
        await verifiedReplace('sk-second');
        expect(byId('credentials-setup-missing')?.textContent).toContain('Could not read the stored models');
        expect((byId('credentials-save') as HTMLButtonElement).disabled).toBe(true);
      });

      it('the drawer stacks above the page save toast, so the toast never covers its footer Close', async () => {
        await credentialsTab('second');
        expect(element.querySelector('ptah-connection-detail-drawer')?.parentElement?.className).toContain('z-[60]');
      });

      // Batch 21 review, finding 1.
      it('a sign-in the drawer started shows its progress and failure in the drawer', async () => {
        const codex: ProvidersConnection = { ...connection('openai-codex'), name: 'OpenAI Codex', authMode: 'oauth', hasKey: false };
        state.connections.set(ready([connection('first'), connection('second'), codex]));
        await credentialsTab('openai-codex');
        byId('credentials-open-login')?.click(); await render();
        expect(state.performExternalAuth).toHaveBeenCalledWith('openai-codex', 'sign-in');
        state.externalAuth.set({ status: 'loading', data: { providerId: 'openai-codex', signInState: 'in-flight', accountLabel: null, cliInstalled: null, message: null }, error: null });
        await render();
        expect((byId('credentials-open-login') as HTMLButtonElement).disabled).toBe(true);
        expect(byId('credentials-external-busy')).not.toBeNull();
        state.externalAuth.set({ status: 'error', data: { providerId: 'openai-codex', signInState: 'idle', accountLabel: null, cliInstalled: null, message: 'Sign-in detected.' }, error: 'Could not load this section. Retry.' });
        await render();
        expect(byId('credentials-external-error')?.textContent).toContain('Sign-in could not be checked. Retry.');
        expect(byId('credentials-external-message')).toBeNull();
      });
    });
  });

  describe('scope badges (Batch 23, D16)', () => {
    const effortKey = 'provider.first.reasoningEffort';
    const entry = (key: string, overridden: boolean) => ({ key, effectiveKey: key, scope: overridden ? 'workspace' : 'global',
      hasOverride: overridden, supportedTargets: ['global', 'app', 'workspace'],
      fallbackPreview: overridden ? { scope: 'global', value: 'medium' } : null, credentialSource: 'not-a-secret' });
    const badges = () => Array.from(element.querySelectorAll<HTMLElement>('[data-testid="scope-badge"]'));
    beforeEach(() => {
      state.route.set(ready(route));
      state.mainSources.set(ready({ model: entry('provider.first.selectedModel', false), effort: entry(effortKey, true) }));
      state.scopeEntry.mockImplementation(((key: string) => entry(key, key === 'anthropicProviderId')) as never);
    });

    it('shows one badge per overridden field, naming it, and nothing for the inherited ones (RUX-6)', async () => {
      await render();
      expect(element.querySelector('[data-testid="setting-scope-row"]')).toBeNull();
      expect(badges().map((badge) => badge.getAttribute('data-field'))).toEqual(['Reasoning effort', 'Main agent provider']);
      expect(badges()[0].textContent).toContain('Effort · Workspace');
      expect(badges()[1].textContent).toContain('Provider · Workspace');
      expect(element.textContent).not.toContain('Override for this workspace');
      expect(element.textContent).not.toContain('Main agent configuration');
    });

    it.each([
      ['a provider.* key', 0, effortKey],
      ['anthropicProviderId', 1, 'anthropicProviderId'],
    ])('clearing %s is reviewed with "ends running chat sessions" before it runs, with no Undo (D6)', async (_name, index, key) => {
      await render();
      badges()[index].click(); await render();
      element.querySelector<HTMLButtonElement>('[data-testid="scope-clear-override"]')?.click(); await render();
      expect(state.clearScopeOverride).not.toHaveBeenCalled();
      expect(element.querySelector('[data-testid="clear-ends-sessions"]')?.textContent).toContain('ends running chat sessions');
      expect(element.textContent).not.toContain('Undo');
      button('Confirm clear override').click(); await render();
      expect(state.clearScopeOverride).toHaveBeenCalledWith(key, 'nearest', { scopeKey: 'workspace', activePath: '/workspace' });
    });

  });

  describe('Main Agent popover (Batch 26)', () => {
    const popover = () => element.querySelector<HTMLElement>('[data-testid="main-agent-popover"]');
    async function reassign() {
      element.querySelector<HTMLButtonElement>('[data-testid="routing-node-main-agent"] [data-testid="routing-node-action"]')?.click();
      await render();
    }

    it('the old main-agent block is gone; the Main Agent node\'s Reassign opens the popover, anchored in that node', async () => {
      state.route.set(ready(route));
      await render();
      for (const gone of ['Edit model', 'Change main provider', 'Save reasoning effort', 'Save provider to…']) {
        expect(Array.from(element.querySelectorAll('button')).some((node) => node.textContent?.trim() === gone)).toBe(false);
      }
      expect(element.querySelector('#providers-main-heading')).toBeNull();
      expect(popover()).toBeNull();
      await reassign();
      expect(popover()?.closest('[data-testid="routing-node-main-agent"]')).not.toBeNull();
    });

    it('the cards carry no "Use for main agent" (prototype, Gate V 28); Reassign → provider select reaches the D6 confirm (uncheckable note kept)', async () => {
      state.route.set(ready({ ...route, providers: [route.providers[0], { id: 'second', type: 'local-native', status: 'skipped' }] }));
      // Loaded sources give the popover its "Save to" target (M1: no target, no write).
      state.mainSources.set(ready({ model: { key: 'provider.first.selectedModel', scope: 'global' }, effort: { key: 'provider.first.reasoningEffort', scope: 'global' } }) as never);
      await render();
      for (const card of Array.from(element.querySelectorAll('ptah-provider-connection-card'))) {
        expect(card.textContent).not.toContain('Use for main agent');
      }
      await reassign();
      const select = element.querySelector<HTMLSelectElement>('[data-testid="main-agent-provider"]');
      if (!select) throw new Error('Missing provider select');
      select.value = 'second'; select.dispatchEvent(new Event('change')); await render();
      const confirm = element.querySelector('[data-testid="main-agent-provider-confirm"]');
      expect(confirm?.textContent).toContain('New main-agent requests use second. Changing the provider ends running chat sessions.');
      expect(element.querySelector('[data-testid="activation-unchecked-note"]')?.textContent).toContain('cannot check this connection');
      Array.from(confirm?.querySelectorAll('button') ?? []).find((node) => node.textContent?.trim() === 'Use for main agent')?.click();
      await render();
      expect(state.activateConnection).toHaveBeenCalledWith('second', 'global', { scopeKey: 'workspace', activePath: '/workspace' });
    });

    it.each(['main-agent', 'main-model', 'main-effort'] as const)('the %s deep link opens the popover focused on that control', async (target) => {
      state.route.set(ready(route));
      fixture.componentRef.setInput('focusTarget', target); await render();
      // The popover positions itself (Floating UI, async), takes focus, then hands it to the requested control.
      await new Promise((resolve) => setTimeout(resolve)); await render();
      expect(popover()).not.toBeNull();
      expect(document.activeElement).toBe(popover()?.querySelector(`[data-focus="${target}"]`));
    });
  });

  it('the popover\'s model search lists the driver\'s catalogue through the loader the Settings shell provides', async () => {
    state.route.set(ready(route));
    // A loaded Save-to target enables the model control (M1).
    state.mainSources.set(ready({ model: { key: 'provider.first.selectedModel', scope: 'global' }, effort: { key: 'provider.first.reasoningEffort', scope: 'global' } }) as never);
    await render();
    element.querySelector<HTMLButtonElement>('[data-testid="routing-node-main-agent"] [data-testid="routing-node-action"]')?.click();
    await render(); await render();
    expect(listModels).toHaveBeenCalledWith('provider:listModels', { providerId: 'first' });
    // Batch 28b: the compact searchable control; opening it lists the options.
    const input = element.querySelector<HTMLInputElement>('[data-testid="main-agent-model"] input');
    input?.dispatchEvent(new Event('focus')); await render();
    const options = Array.from(element.querySelectorAll('[role="option"]')).map((option) => option.textContent?.trim());
    expect(options).toContain('Catalogue model [Tool: No]');
  });

  it('does not render an active provider while the route is unloaded or loading', async () => {
    await render(); expect(activeBadges()).toHaveLength(0);
    expect(element.textContent).not.toContain('Next request uses:');
    state.route.set({ status: 'loading', data: route, error: null });
    await render(); expect(activeBadges()).toHaveLength(0);
    expect(element.textContent).not.toContain('Next request uses:');
    expect(state.open).toHaveBeenCalledTimes(1);
  });
  it('renders at most one active badge when several connections are healthy', async () => {
    state.route.set(ready(route));
    state.connections.set(ready([connection('first'), connection('first'), connection('second')]));
    await render(); expect(activeBadges()).toHaveLength(1);
    expect(element.querySelectorAll('ptah-provider-connection-card')).toHaveLength(2);
    state.commit.set({ ...idle, status: 'saving' }); await render(); expect(activeBadges()).toHaveLength(0);
  });
  it('distinguishes a loaded empty route from an unloaded route (Main Agent node)', async () => {
    await render();
    expect(element.querySelector('[data-testid="routing-node-main-agent"] [data-testid="routing-node-skeleton"]')).not.toBeNull();
    state.route.set(ready({ ...route, driverProviderId: null, route: 'unresolved', ready: false }));
    state.activeProviderId.set(null); state.connections.set(ready([])); await render();
    expect(element.textContent).toContain('Choose a provider to start the main agent.');
    expect(element.textContent).toContain('No connections configured.');
  });
  it('renders each resolvedModel arm of the route (Main Agent node)', async () => {
    const model = () => element.querySelector('[data-testid="routing-main-model"]')?.textContent?.trim();
    state.route.set(ready(route)); await render();
    expect(model()).toBe('model-a');
    state.route.set(ready({ ...route, resolvedModel: { kind: 'tier', tier: 'haiku' } })); await render();
    expect(model()).toBe('haiku tier');
    // The unresolved arm on a resolved route: the SDK's own `default` model, not an error.
    state.route.set(ready({ ...route, resolvedModel: { kind: 'unresolved' } })); await render();
    expect(model()).toBe('Default (chosen by Claude)');
  });
  it('renders no duplicate sign-in row between connection cards', async () => {
    state.route.set(ready({ ...route, providers: [...route.providers, { id: 'github-copilot', type: 'oauth', status: 'unauthenticated' }] }));
    state.connections.set(ready([connection('first'), { ...connection('github-copilot'), name: 'Copilot', authMode: 'oauth', hasKey: false }]));
    await render();
    const labels = Array.from(element.querySelectorAll('button')).map((node) => node.textContent?.trim());
    expect(labels).not.toContain('Sign in to Copilot');
    expect(labels).not.toContain('Check Copilot sign-in');
    // The card's own action remains.
    expect(element.querySelectorAll('[data-testid="btn-sign-in"]')).toHaveLength(1);
  });
  it('tells the wizard whether the selected provider already has a stored key', async () => {
    state.connections.set(ready([connection('first'), { ...connection('second'), hasKey: false }]));
    await render(); await openWizardThroughCatalog();
    wizard().providerChanged.emit('first'); await render();
    expect(wizard().existingCredentialPresent()).toBe(true);
    wizard().providerChanged.emit('second'); await render();
    expect(wizard().existingCredentialPresent()).toBe(false);
  });
  it('opens the setup wizard for a deep-linked provider once', async () => {
    const consumed: string[] = [];
    fixture.componentInstance.requestedProviderConsumed.subscribe((id) => consumed.push(id));
    fixture.componentRef.setInput('requestedProviderId', 'second'); await render();
    expect(wizard().deepLinkProviderId()).toBe('second');
    // Not consumed until the wizard accepts the provider (the stub does not select on its own).
    expect(consumed).toEqual([]);
    wizard().providerChanged.emit('second'); await render();
    // PR 581: the page reports the request as consumed so the parent can clear it.
    expect(consumed).toEqual(['second']);
    wizard().closed.emit(); await render();
    expect(element.querySelector('ptah-provider-setup-wizard')).toBeNull();
    // Not reopened by an unrelated render.
    state.refresh(); await render();
    expect(element.querySelector('ptah-provider-setup-wizard')).toBeNull();
  });
  it('keeps successful sections usable when another read fails and retries only that read', async () => {
    state.route.set({ status: 'error', data: null, error: 'Could not load this section. Retry.' });
    await render();
    expect(element.querySelectorAll('ptah-provider-connection-card')).toHaveLength(2);
    expect(button('Connect provider').disabled).toBe(false);
    // Batch 28: the route's failure and Retry live in the Main Agent node (its region), not in a page list.
    element.querySelector<HTMLButtonElement>('[data-testid="routing-node-main-agent"] [data-testid="routing-node-retry"]')?.click(); await render();
    expect(state.refreshRoute).toHaveBeenCalledTimes(1);
    expect(state.refreshConnections).not.toHaveBeenCalled();
  });
  describe('page composition (Batch 28, prototype order)', () => {
    it('has no page title, no "Refresh settings" and no Reload (#21); the map comes before Connections', async () => {
      state.route.set(ready(route)); await render();
      expect(element.querySelector('h1')).toBeNull();
      const labels = Array.from(element.querySelectorAll('button')).map((node) => node.textContent?.trim() ?? '');
      expect(labels).not.toContain('Refresh settings');
      expect(labels.some((label) => /reload/i.test(label))).toBe(false);
      const map = element.querySelector('[data-testid="routing-map"]');
      const heading = element.querySelector('#providers-connections-heading');
      expect(heading?.textContent?.trim()).toBe('Connections');
      expect(map && heading && map.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(element.querySelector('[data-read-loading]')).toBeNull();
    });
    it('the header counts configured and catalog providers, and the primary "Connect provider" opens the catalog', async () => {
      state.connections.set(ready([connection('first'), connection('second'), { ...connection('openrouter'), name: 'OpenRouter', configured: false, hasKey: false }]));
      await render();
      expect(element.querySelector('[data-testid="connections-count"]')?.textContent?.replace(/\s+/g, ' ').trim())
        .toBe('2 configured · 1 available in catalog');
      const connect = element.querySelector<HTMLButtonElement>('[data-testid="connect-provider"]');
      expect(connect?.className).toContain('btn-primary');
      expect(connect?.textContent?.trim()).toBe('Connect provider');
      connect?.click(); await render();
      expect(catalogDialog()?.hasAttribute('open')).toBe(true);
    });
    it('the filter narrows the cards by name, says when nothing matches, and Clear filter restores them', async () => {
      state.connections.set(ready([connection('first'), { ...connection('second'), name: 'Moonshot' }])); await render();
      const input = element.querySelector<HTMLInputElement>('[data-testid="connections-filter"]');
      if (!input) throw new Error('Missing filter');
      expect(input.getAttribute('aria-label')).toBe('Filter connections');
      input.value = 'moon'; input.dispatchEvent(new Event('input')); await render();
      expect(element.querySelectorAll('ptah-provider-connection-card')).toHaveLength(1);
      input.value = 'zzz'; input.dispatchEvent(new Event('input')); await render();
      expect(element.querySelectorAll('ptah-provider-connection-card')).toHaveLength(0);
      expect(element.querySelector('[data-testid="connections-filter-empty"]')?.textContent).toContain('No connections match “zzz”.');
      button('Clear filter').click(); await render();
      expect(element.querySelectorAll('ptah-provider-connection-card')).toHaveLength(2);
    });
    it('the grid takes its columns from the container width, and the hint strip is one row directly under it', async () => {
      await render();
      expect(element.querySelector('[data-testid="connections-grid"]')?.className).toContain('grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]');
      const hint = element.querySelector('[data-testid="catalog-hint"]');
      expect(element.querySelector('[data-testid="connections-grid"]')?.nextElementSibling).toBe(hint);
      expect(hint?.className).not.toContain('flex-wrap');
      expect(element.querySelector('[data-testid="catalog-hint-text"]')?.className).toContain('truncate');
      expect(element.querySelector('[data-focus="more-providers"]')?.className).toContain('ml-auto');
    });
    it('a failed read shows "Retry {label}" in its own region and retries only that read', async () => {
      state.scopes.set({ status: 'error', data: null, error: 'Could not load this section. Retry.' });
      state.connections.set({ status: 'error', data: null, error: 'Could not load this section. Retry.' });
      await render();
      const region = element.querySelector('[data-testid="main-agent-region"]');
      expect(region?.querySelector('[data-read-error="scopes"]')?.textContent).toContain('Setting sources could not be loaded.');
      const connections = element.querySelector('section[aria-labelledby="providers-connections-heading"]');
      expect(connections?.querySelector('[data-read-error="connections"]')).not.toBeNull();
      button('Retry setting sources').click(); await render();
      expect(state.refreshScopes).toHaveBeenCalledTimes(1);
      expect(state.refreshConnections).not.toHaveBeenCalled();
      button('Retry providers').click(); await render();
      expect(state.refreshConnections).toHaveBeenCalledTimes(1);
    });
  });
  it('never renders raw stored authentication diagnostics', async () => {
    state.route.set(ready({ ...route, ...{ storedAuthMethodDiagnostic: 'secret-diagnostic-value' } }));
    await render(); expect(element.textContent).not.toContain('secret-diagnostic-value');
  });
  it('focuses the requested section after rendering', async () => {
    fixture.componentRef.setInput('focusTarget', 'connections'); await render();
    expect(document.activeElement).toBe(element.querySelector('#providers-connections-heading'));
  });
  it('no longer mounts the background roles, the CLI agents or their read states (moved to Orchestration, D14)', async () => {
    state.cliModels.set({ status: 'error', data: {}, error: 'Could not load this section. Retry.' });
    await render();
    expect(element.querySelector('ptah-provider-consumer-assignments')).toBeNull();
    expect(element.querySelector('ptah-cli-orchestration-matrix')).toBeNull();
    expect(element.querySelector('[data-focus="background-models"]')).toBeNull();
    expect(element.querySelector('[data-read-error="cli-models"]')).toBeNull();
  });
  it('the more-providers route focuses "Browse catalog" and opens the catalog modal (Batch 27)', async () => {
    fixture.componentRef.setInput('focusTarget', 'more-providers'); await render();
    expect(document.activeElement).toBe(element.querySelector('[data-focus="more-providers"]'));
    expect(element.querySelector('[data-focus="more-providers"]')?.textContent).toContain('Browse catalog');
    expect(catalogDialog()?.hasAttribute('open')).toBe(true);
    expect(element.querySelector('[data-testid="provider-catalog-modal"]')).not.toBeNull();
  });
  it('the header button, the "+ Connect another provider" tile and the hint strip all open the catalog; closing it keeps the page', async () => {
    state.connections.set(ready([connection('first'), { ...connection('openrouter'), name: 'OpenRouter', configured: false, hasKey: false }]));
    await render();
    expect(element.querySelector('[data-testid="catalog-hint"]')?.textContent).toContain('1 catalog provider ready to add: OpenRouter');
    for (const opener of [button('Connect provider'), element.querySelector<HTMLButtonElement>('[data-testid="connect-another-provider"]'),
      element.querySelector<HTMLButtonElement>('[data-focus="more-providers"]')]) {
      opener?.click(); await render();
      expect(catalogDialog()?.hasAttribute('open')).toBe(true);
      catalogDialog()?.dispatchEvent(new Event('cancel')); await render();
      expect(catalogDialog()?.hasAttribute('open')).toBe(false);
    }
    expect(element.querySelector('ptah-provider-setup-wizard')).toBeNull();
  });
  it('choosing a catalog provider closes the modal and opens the wizard for it; its sign-in goes to the external action', async () => {
    state.connections.set(ready([connection('first'), { ...connection('openrouter'), name: 'OpenRouter', configured: false, hasKey: false },
      { ...connection('github-copilot'), name: 'GitHub Copilot', authMode: 'oauth', configured: false, hasKey: false }]));
    await render(); button('Connect provider').click(); await render();
    element.querySelector<HTMLButtonElement>('[aria-label="Connect OpenRouter"]')?.click(); await render();
    expect(catalogDialog()?.hasAttribute('open')).toBe(false);
    expect(wizard().deepLinkProviderId()).toBe('openrouter');
    wizard().closed.emit(); await render();
    button('Connect provider').click(); await render();
    element.querySelector<HTMLButtonElement>('[aria-label="Sign in to GitHub Copilot"]')?.click(); await render();
    expect(catalogDialog()?.hasAttribute('open')).toBe(false);
    expect(state.performExternalAuth).toHaveBeenCalledWith('github-copilot', 'sign-in');
  });
  it('a failed connections read (incl. custom providers) is said in the catalog with Retry (Batch 2b)', async () => {
    state.connections.set({ status: 'error', data: null, error: 'Could not load this section. Retry.' });
    await render();
    // The hint strip never reads "0 providers" for a failed read; its Browse still opens the catalog.
    expect(element.querySelector('[data-testid="catalog-hint"]')?.textContent).toContain('The provider catalog could not be loaded.');
    element.querySelector<HTMLButtonElement>('[data-focus="more-providers"]')?.click(); await render();
    const alert = element.querySelector('[data-testid="provider-catalog-error"]');
    expect(alert?.textContent).toContain('Custom providers could not be loaded. Your saved settings have not changed.');
    (alert?.querySelector('button') as HTMLButtonElement).click();
    expect(state.refreshConnections).toHaveBeenCalled();
  });
  it('passes the actual cancellation result and rejects missing verification results', async () => {
    await render(); await openWizardThroughCatalog();
    expect(await wizard().cancelDraftVerification()({ probeId: 'old' })).toEqual({ cancelled: false });
    expect(state.cancelVerification).toHaveBeenCalledWith({ probeId: 'old' });
    await expect(wizard().verifyDraftConnection()({ probeId: 'probe', providerId: 'first', authMode: 'apiKey' })).rejects.toThrow('Connection check unavailable');
  });
  it('preserves the wizard draft and names saved, unsaved and unconfirmed fields after a partial commit', async () => {
    state.connectProvider.mockImplementation(async () => { state.commit.set({ ...idle, status: 'unconfirmed',
      saved: ['Custom connection'], unsaved: ['Main agent'], unconfirmed: ['Credential'] }); });
    await render(); await openWizardThroughCatalog();
    const child = wizard(); child.commitRequested.emit(draft); await render();
    expect(state.connectProvider).toHaveBeenCalledWith(draft, { scopeKey: 'workspace', activePath: '/workspace' });
    expect(wizard()).toBe(child); expect(child.commitState()).toBe('failed');
    expect(element.textContent).toContain('Saved: Custom connection');
    expect(element.textContent).toContain('Not saved: Main agent');
    expect(element.textContent).toContain('Save not confirmed: Credential');
    expect(element.textContent).not.toContain('private-draft-key');
  });
  it('does not convert an unrefreshed acknowledged commit into wizard success', async () => {
    state.connectProvider.mockImplementation(async () => {
      state.commit.set({ ...idle, status: 'saved', refreshFailed: true });
      state.connections.set({ status: 'error', data: null, error: 'Could not load this section. Retry.' });
    });
    await render(); await openWizardThroughCatalog(); wizard().commitRequested.emit(draft); await render();
    expect(wizard().commitState()).toBe('failed');
  });
  it('does not block a refreshed connection commit because an unrelated section failed', async () => {
    state.route.set(ready(route));
    state.connectProvider.mockImplementation(async () => { state.commit.set({ ...idle, status: 'saved', refreshFailed: true }); });
    await render(); await openWizardThroughCatalog(); wizard().commitRequested.emit(draft); await render();
    expect(wizard().commitState()).toBe('saved');
  });
  it('m2: a connection saved through the wizard clears the filter, so the new card is never hidden by old filter text', async () => {
    state.route.set(ready(route));
    await render();
    const input = element.querySelector<HTMLInputElement>('[data-testid="connections-filter"]');
    if (!input) throw new Error('Missing filter');
    input.value = 'first'; input.dispatchEvent(new Event('input')); await render();
    state.connectProvider.mockImplementation(async () => {
      state.commit.set({ ...idle, status: 'saved' });
      state.connections.set(ready([connection('first'), connection('second'), connection('openrouter')]));
    });
    await openWizardThroughCatalog(); wizard().commitRequested.emit(draft); await render();
    expect(wizard().commitState()).toBe('saved');
    expect(input.value).toBe('');
    expect(element.querySelectorAll('ptah-provider-connection-card')).toHaveLength(3);
  });
  it('m2: a failed wizard save keeps the filter as typed', async () => {
    await render();
    const input = element.querySelector<HTMLInputElement>('[data-testid="connections-filter"]');
    if (!input) throw new Error('Missing filter');
    input.value = 'first'; input.dispatchEvent(new Event('input')); await render();
    state.connectProvider.mockImplementation(async () => { state.commit.set({ ...idle, status: 'failed', unsaved: ['Credential'] }); });
    await openWizardThroughCatalog(); wizard().commitRequested.emit(draft); await render();
    expect(input.value).toBe('first');
  });
  it('honours a new parent focus target after an earlier one', async () => {
    fixture.componentRef.setInput('focusTarget', 'connections'); await render();
    expect(document.activeElement).toBe(element.querySelector('[data-focus="connections"]'));
    fixture.componentRef.setInput('focusTarget', 'more-providers'); await render();
    expect(document.activeElement).toBe(element.querySelector('[data-focus="more-providers"]'));
  });
  it('cancels without committing and restores the invoking control', async () => {
    await render(); const trigger = button('Connect provider'); await openWizardThroughCatalog(trigger);
    wizard().closed.emit(); await render();
    expect(element.querySelector('ptah-provider-setup-wizard')).toBeNull();
    expect(state.connectProvider).not.toHaveBeenCalled(); expect(state.cancelVerification).toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });
  it('forwards the wizard provider identity with its login event', async () => {
    await render(); await openWizardThroughCatalog(); wizard().externalActionRequested.emit({ providerId: 'github-copilot', action: 'sign-in' });
    expect(state.performExternalAuth).toHaveBeenCalledWith('github-copilot', 'sign-in');
  });
  it('uses native controls with 36px height and a visible 2px focus outline', async () => {
    // One card in a repair state, so the page shows a card's inline action (a connected card has none since Gate V 28).
    state.route.set(ready({ ...route, providers: [route.providers[0], { id: 'second', type: 'apiKey', status: 'unreachable' }] }));
    await render();
    // The compact card's one inline action is `btn-xs` by plan (:631): 24px, the WCAG 2.2 AA target size.
    const cardAction = (node: Element) => node.closest('[data-testid="provider-connection-card"]') !== null;
    // A routing-map node's action is stretched over the whole node (≥ 88px): the node is its target.
    const nodeAction = (node: Element) => node.getAttribute('data-testid') === 'routing-node-action';
    // The hint strip's "Browse catalog →" is an inline `btn-xs` link-button (24px); the grid tile is an 80px card.
    // Batch 28: "Clear filter" is the same inline btn-xs link-button as "Browse catalog →".
    const compact = (node: Element) => cardAction(node) || node.getAttribute('data-focus') === 'more-providers'
      || node.textContent?.trim() === 'Clear filter';
    const tile = (node: Element) => node.getAttribute('data-testid') === 'connect-another-provider';
    // The catalog modal's controls are asserted in its own spec (closed here; the backdrop is the modal primitive's).
    const actions = Array.from(element.querySelectorAll('button')).filter((node) => !node.closest('ptah-provider-catalog-modal'));
    expect(actions.some(cardAction)).toBe(true);
    expect(actions.filter(nodeAction)).toHaveLength(3);
    for (const node of actions.filter(nodeAction)) expect(node.classList.contains('after:inset-0')).toBe(true);
    for (const node of actions.filter((candidate) => !nodeAction(candidate))) {
      expect(node.classList.contains(tile(node) ? 'min-h-[80px]' : compact(node) ? 'min-h-6' : 'min-h-9')).toBe(true);
      expect(node.classList.contains('focus-visible:outline-2')).toBe(true);
    }
  });
});

/**
 * PR 581 review round 1: deep links against the REAL page and the REAL wizard,
 * with a host that clears the request on consumption exactly as SettingsComponent does.
 */
describe('ProvidersSettingsComponent deep links with the real wizard', () => {
  @Component({ standalone: true, changeDetection: ChangeDetectionStrategy.OnPush, imports: [ProvidersSettingsComponent],
    template: `<ptah-providers-settings [requestedProviderId]="requested()" (requestedProviderConsumed)="consume($event)" />` })
  class Host {
    readonly requested = signal('');
    readonly consumed: string[] = [];
    consume(id: string): void {
      this.consumed.push(id);
      // SettingsComponent.consumeRequestedProvider
      if (this.requested() === id) this.requested.set('');
    }
  }

  let fixture: ComponentFixture<Host>;
  let host: Host;
  let state: StateStub;
  beforeEach(async () => {
    state = new StateStub();
    await TestBed.configureTestingModule({ imports: [Host], providers: [
      { provide: ProvidersSettingsStateService, useValue: state },
      { provide: ClaudeRpcService, useValue: { call: jest.fn(async () => new RpcResult(true, { models: [] })) } },
      SHELL_LOADER, SettingsSaveFeedbackService,
    ] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
  });
  afterEach(() => { fixture.destroy(); TestBed.resetTestingModule(); });

  async function render() {
    for (let i = 0; i < 3; i++) { fixture.detectChanges(); await fixture.whenStable(); }
  }
  function realWizard(): ProviderSetupWizardComponent | null {
    return fixture.debugElement.query(By.directive(ProviderSetupWizardComponent))?.componentInstance ?? null;
  }
  function selectedProvider(): string | null {
    const radio = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[name="wizard-provider"]:checked');
    return radio?.value ?? null;
  }
  async function discardWizard() {
    const wizard = realWizard();
    if (!wizard) throw new Error('wizard not open');
    // Cancel with a draft (the selection) asks for review; confirm the discard.
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="wizard-cancel"]')?.click(); await render();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="wizard-discard-confirm"]')?.click(); await render();
  }

  it('keeps a different request pending while the wizard is open and applies it on close — never merely acknowledged', async () => {
    host.requested.set('openrouter'); await render();
    expect(selectedProvider()).toBe('openrouter');
    expect(host.consumed).toEqual(['openrouter']);
    expect(host.requested()).toBe('');

    host.requested.set('requesty'); await render();
    // The open draft for OpenRouter is not switched away, and B is still pending in the parent.
    expect(selectedProvider()).toBe('openrouter');
    expect(host.requested()).toBe('requesty');
    expect(host.consumed).toEqual(['openrouter']);

    await discardWizard();
    // Closing applies the pending request: the wizard reopens on Requesty and only then consumes it.
    expect(realWizard()).not.toBeNull();
    expect(selectedProvider()).toBe('requesty');
    expect(host.consumed).toEqual(['openrouter', 'requesty']);
    expect(host.requested()).toBe('');
  });

  it('opens again for a fresh request for the same provider, but not on an unrelated re-render', async () => {
    host.requested.set('openrouter'); await render();
    expect(host.requested()).toBe('');
    await discardWizard();
    expect(realWizard()).toBeNull();

    // Unrelated re-render: nothing opens.
    state.refresh(); state.commit.set({ ...idle }); await render();
    expect(realWizard()).toBeNull();

    host.requested.set('openrouter'); await render();
    expect(realWizard()).not.toBeNull();
    expect(selectedProvider()).toBe('openrouter');
    expect(host.consumed).toEqual(['openrouter', 'openrouter']);
  });
});
