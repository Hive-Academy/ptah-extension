import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ClaudeRpcService, RpcResult, ProvidersSettingsStateService, type ProvidersSettingsSection, type ProvidersEffectiveRoute,
  type ProvidersSettingsCommit, type ProvidersConnection, type ProvidersExternalAuth,
} from '@ptah-extension/core';
import type { AuthVerifyDraftConnectionResult, ConfigGetScopesResult, SettingScope } from '@ptah-extension/shared';
import { PROVIDER_MODELS_LOADER, ProviderModelPickerComponent } from '@ptah-extension/ui';
import { ProvidersSettingsComponent } from './providers-settings.component';
import { ProviderConsumerAssignmentsComponent, type BackgroundConsumerId } from './provider-consumer-assignments.component';
import {
  ProviderSetupWizardComponent, type DraftVerifyConnectionFn, type DraftCancelVerificationFn,
  type ProviderWizardCommit, type WizardCommitState, type WizardExternalAction,
} from './provider-setup-wizard.component';

@Component({ selector: 'ptah-provider-consumer-assignments', standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush, template: '<p>Background child</p>' })
class ConsumerStub {
  readonly disabled = input(false);
  readonly initialEditingConsumerId = input<BackgroundConsumerId | null>(null);
  readonly setupProviderRequested = output<string>();
  readonly assignmentSaved = output<{ id: BackgroundConsumerId; provider: string; model: string }>();
  readonly timeoutSaved = output<number>();
}
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
const connection = (id: string): ProvidersConnection => ({ id, name: id, authMode: 'apiKey', configured: true, hasKey: true, custom: false, defaultsResolvable: true });
const draft: ProviderWizardCommit = { providerId: 'first', displayName: 'First', authMode: 'apiKey', customName: null,
  customProtocol: null, credential: { kind: 'apiKey', value: 'private-draft-key' }, existingKeyReused: false,
  baseUrl: null, verified: { probeId: 'probe', checkedAt: '2026-09-22T10:00:00Z', latencyMs: 1, modelUsed: 'one' },
  tiers: { everyday: 'one', complex: 'two', fast: 'three' }, tierSnapshot: { everyday: null, complex: null, fast: null },
  editedTiers: ['everyday', 'complex', 'fast'], saveTo: 'global', activation: 'connect-only' };

class StateStub {
  readonly connectionSetup = signal(unloaded());
  readonly cliTest = signal(unloaded());
  readonly refreshConnectionSetup = jest.fn(async () => undefined);
  readonly testCliConnection = jest.fn(async () => undefined);
  readonly saveCursorCredential = jest.fn(async () => undefined);
  readonly route = signal<ProvidersSettingsSection<ProvidersEffectiveRoute>>(unloaded());
  readonly scopes = signal<ProvidersSettingsSection<ConfigGetScopesResult>>(ready({ activePath: '/workspace', entries: [] }));
  readonly model = signal(ready({ model: 'model-a' }));
  readonly effort = signal(ready({ effort: undefined }));
  readonly connections = signal<ProvidersSettingsSection<readonly ProvidersConnection[]>>(ready([connection('first'), connection('second')]));
  readonly cliAgents = signal(ready([]));
  readonly cliModels = signal(ready({}));
  readonly mainSources = signal(ready({}));
  readonly orchestration = signal(ready({ codexModel: '', copilotModel: '', cursorModel: '', antigravityModel: '', opencodeModel: '', piModel: '' }));
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
  readonly groupScope = jest.fn(() => null);
  readonly writeScopes = jest.fn((): SettingScope[] => ['global', 'app', 'workspace']);
  readonly saveSettings = jest.fn(async () => undefined);
  readonly clearScopeOverride = jest.fn(async () => undefined);
  readonly connectProvider = jest.fn(async () => undefined);
  readonly activateConnection = jest.fn(async () => undefined);
  readonly verifyDraft = jest.fn(async () => undefined);
  readonly cancelVerification = jest.fn(async () => ({ cancelled: false }));
  readonly performExternalAuth = jest.fn(async () => undefined);
}

describe('ProvidersSettingsComponent', () => {
  let fixture: ComponentFixture<ProvidersSettingsComponent>;
  let state: StateStub;
  let element: HTMLElement;
  const listModels = jest.fn(async () => new RpcResult(true, { models: [{ id: 'catalog-model', name: 'Catalogue model' }] }));
  beforeEach(async () => {
    state = new StateStub();
    listModels.mockClear();
    await TestBed.configureTestingModule({ imports: [ProvidersSettingsComponent], providers: [
      { provide: ProvidersSettingsStateService, useValue: state },
      { provide: ClaudeRpcService, useValue: { call: listModels } },
    ] }).overrideComponent(ProvidersSettingsComponent, {
      remove: { imports: [ProviderConsumerAssignmentsComponent, ProviderSetupWizardComponent] },
      add: { imports: [ConsumerStub, WizardStub] },
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

  it('renders the real main model picker using only the page-owned loader provider', async () => {
    state.route.set(ready(route));
    await render();
    button('Edit model').click();
    await render();
    const picker = fixture.debugElement.query(By.directive(ProviderModelPickerComponent));
    expect(picker).not.toBeNull();
    expect(picker.injector.get(PROVIDER_MODELS_LOADER)).toBe(fixture.debugElement.injector.get(PROVIDER_MODELS_LOADER));
    expect(listModels).toHaveBeenCalledWith('provider:listModels', { providerId: 'first' });
    expect(picker.nativeElement.textContent).toContain('Catalogue model');
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
  it('distinguishes a loaded empty route from an unloaded route', async () => {
    await render(); expect(element.textContent).toContain('Loading providers…');
    state.route.set(ready({ ...route, driverProviderId: null, route: 'unresolved', ready: false }));
    state.activeProviderId.set(null); state.connections.set(ready([])); await render();
    expect(element.textContent).toContain('Choose a provider to start the main agent.');
    expect(element.textContent).toContain('No connections configured.');
  });
  it('renders each resolvedModel arm of the route switch', async () => {
    // The model arm is the default fixture: a concrete model id.
    state.route.set(ready(route));
    await render();
    expect(element.textContent).toContain('Model: model-a');
    expect(element.textContent).not.toContain('Model tier:');

    // The tier arm: a tier that only names an entry of the provider's catalogue.
    state.route.set(ready({ ...route, resolvedModel: { kind: 'tier', tier: 'haiku' } }));
    await render();
    expect(element.textContent).toContain('Model tier: haiku');
    expect(element.textContent).not.toContain('Model: model-a');

    // The unresolved arm on a resolved route: the SDK's own `default` model, not an error.
    state.route.set(ready({ ...route, resolvedModel: { kind: 'unresolved' } }));
    await render();
    expect(element.textContent).toContain('Default model (chosen by Claude)');
    expect(element.textContent).not.toContain('Model has not been resolved.');
    expect(element.textContent).not.toContain('Model tier: haiku');
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
    await render(); button('Connect provider').click(); await render();
    wizard().providerChanged.emit('first'); await render();
    expect(wizard().existingCredentialPresent()).toBe(true);
    wizard().providerChanged.emit('second'); await render();
    expect(wizard().existingCredentialPresent()).toBe(false);
  });
  it('opens the setup wizard for a deep-linked provider once', async () => {
    fixture.componentRef.setInput('requestedProviderId', 'second'); await render();
    expect(wizard().deepLinkProviderId()).toBe('second');
    wizard().closed.emit(); await render();
    expect(element.querySelector('ptah-provider-setup-wizard')).toBeNull();
    // Not reopened by an unrelated render.
    state.refresh(); await render();
    expect(element.querySelector('ptah-provider-setup-wizard')).toBeNull();
  });
  it('offers main-agent activation for an uncheckable local provider with a note', async () => {
    state.route.set(ready({ ...route, providers: [route.providers[0], { id: 'second', type: 'local-native', status: 'skipped' }] }));
    await render();
    const cards = Array.from(element.querySelectorAll('ptah-provider-connection-card'));
    const second = cards.find((card) => card.textContent?.includes('second'));
    const activate = second?.querySelector<HTMLButtonElement>('[data-testid="btn-activate-main"]');
    expect(activate).toBeTruthy();
    activate?.click(); await render();
    expect(element.querySelector('[data-testid="activation-unchecked-note"]')?.textContent).toContain('cannot check this connection');
    element.querySelector<HTMLButtonElement>('section[aria-label="Review main provider change"] button')?.click(); await render();
    expect(state.activateConnection).toHaveBeenCalledWith('second', 'global', { scopeKey: 'workspace', activePath: '/workspace' });
  });
  it('keeps successful sections usable when another read fails and retries only that read', async () => {
    state.route.set({ status: 'error', data: null, error: 'Could not load this section. Retry.' });
    await render();
    expect(element.querySelectorAll('ptah-provider-connection-card')).toHaveLength(2);
    expect(button('Connect provider').disabled).toBe(false);
    button('Retry main-agent route').click(); await render();
    expect(state.refreshRoute).toHaveBeenCalledTimes(1);
    expect(state.refreshConnections).not.toHaveBeenCalled();
    expect(element.textContent).toContain('Background child');
  });
  it('never renders raw stored authentication diagnostics', async () => {
    state.route.set(ready({ ...route, ...{ storedAuthMethodDiagnostic: 'secret-diagnostic-value' } }));
    await render(); expect(element.textContent).not.toContain('secret-diagnostic-value');
  });
  it('focuses the requested section after rendering and forwards consumer field targets', async () => {
    fixture.componentRef.setInput('focusTarget', 'cli-agents'); await render();
    expect(document.activeElement).toBe(element.querySelector('[data-focus="cli-agents"]'));
    fixture.componentRef.setInput('focusTarget', 'judging-enhancement'); await render();
    expect(fixture.debugElement.query(By.directive(ConsumerStub)).injector.get(ConsumerStub).initialEditingConsumerId()).toBe('judging-enhancement');
    expect(document.activeElement).toBe(element.querySelector('[data-focus="background-models"]'));
  });
  it('opens the catalogue before focusing its disclosure', async () => {
    fixture.componentRef.setInput('focusTarget', 'more-providers'); await render();
    expect(element.querySelector('details')?.open).toBe(true);
    expect(document.activeElement).toBe(element.querySelector('summary'));
  });
  it('passes the actual cancellation result and rejects missing verification results', async () => {
    await render(); button('Connect provider').click(); await render();
    expect(await wizard().cancelDraftVerification()({ probeId: 'old' })).toEqual({ cancelled: false });
    expect(state.cancelVerification).toHaveBeenCalledWith({ probeId: 'old' });
    await expect(wizard().verifyDraftConnection()({ probeId: 'probe', providerId: 'first', authMode: 'apiKey' })).rejects.toThrow('Connection check unavailable');
  });
  it('preserves the wizard draft and names saved, unsaved and unconfirmed fields after a partial commit', async () => {
    state.connectProvider.mockImplementation(async () => { state.commit.set({ ...idle, status: 'unconfirmed',
      saved: ['Custom connection'], unsaved: ['Main agent'], unconfirmed: ['Credential'] }); });
    await render(); button('Connect provider').click(); await render();
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
    await render(); button('Connect provider').click(); await render(); wizard().commitRequested.emit(draft); await render();
    expect(wizard().commitState()).toBe('failed');
  });
  it('does not block a refreshed connection commit because an unrelated section failed', async () => {
    state.route.set(ready(route));
    state.connectProvider.mockImplementation(async () => { state.commit.set({ ...idle, status: 'saved', refreshFailed: true }); });
    await render(); button('Connect provider').click(); await render(); wizard().commitRequested.emit(draft); await render();
    expect(wizard().commitState()).toBe('saved');
  });
  it('honours a new parent focus target after a local focus action', async () => {
    await render(); button('Change main provider').click(); await render();
    fixture.componentRef.setInput('focusTarget', 'cli-agents'); await render();
    expect(document.activeElement).toBe(element.querySelector('[data-focus="cli-agents"]'));
  });
  it('cancels without committing and restores the invoking control', async () => {
    await render(); const trigger = button('Connect provider'); trigger.focus(); trigger.click(); await render();
    wizard().closed.emit(); await render();
    expect(element.querySelector('ptah-provider-setup-wizard')).toBeNull();
    expect(state.connectProvider).not.toHaveBeenCalled(); expect(state.cancelVerification).toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });
  it('forwards the wizard provider identity with its login event', async () => {
    await render(); button('Connect provider').click(); await render(); wizard().externalActionRequested.emit({ providerId: 'github-copilot', action: 'sign-in' });
    expect(state.performExternalAuth).toHaveBeenCalledWith('github-copilot', 'sign-in');
  });
  it('retains a masked CLI setup draft after an unconfirmed write and discards it on cancel', async () => {
    state.saveSettings.mockImplementation(async () => { state.commit.set({ ...idle, status: 'unconfirmed', unconfirmed: ['CLI instance'] }); });
    await render(); button('Add CLI agent').click(); await render();
    for (const [id, value] of [['providers-cli-name', 'Worker'], ['providers-cli-key', 'private-cli-key']]) {
      const field = element.querySelector<HTMLInputElement>(`#${id}`);
      if (!field) throw new Error('Missing CLI input');
      field.value = value; field.dispatchEvent(new Event('input'));
    }
    const provider = element.querySelector<HTMLSelectElement>('#providers-cli-provider');
    if (!provider) throw new Error('Missing provider input');
    provider.value = 'first'; provider.dispatchEvent(new Event('change')); await render();
    button('Create CLI agent').click(); await render();
    expect(state.saveSettings).toHaveBeenCalledWith({ cli: [{ action: 'create', params: { name: 'Worker', providerId: 'first', apiKey: 'private-cli-key' } }] }, { scopeKey: 'workspace', activePath: '/workspace' });
    expect(element.querySelector<HTMLInputElement>('#providers-cli-key')?.type).toBe('password');
    expect(element.textContent).not.toContain('private-cli-key');
    button('Cancel CLI setup').click(); await render();
    button('Add CLI agent').click(); await render();
    expect(element.querySelector<HTMLInputElement>('#providers-cli-key')?.value).toBe('');
  });
  it('retries CLI model reads without disabling the CLI instance list', async () => {
    state.cliModels.set({ status: 'error', data: {}, error: 'Could not load this section. Retry.' });
    await render(); button('Retry CLI instance models').click(); await render();
    expect(state.refreshCliModels).toHaveBeenCalledTimes(1);
    expect(state.refreshCliAgents).not.toHaveBeenCalled();
    expect(element.textContent).toContain('No CLI agents configured.');
  });
  it('uses native controls with 36px height and a visible 2px focus outline', async () => {
    await render();
    for (const node of element.querySelectorAll('button')) {
      expect(node.classList.contains('min-h-9')).toBe(true);
      expect(node.classList.contains('focus-visible:outline-2')).toBe(true);
    }
  });
});
