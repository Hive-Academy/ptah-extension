import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ClaudeRpcService, AuthStateService } from '@ptah-extension/core';
import type {
  AnthropicProviderInfo,
  CustomProviderEntry,
} from '@ptah-extension/shared';
import {
  createMockRpcService,
  rpcSuccess,
  type MockRpcService,
} from '@ptah-extension/core/testing';
import { AuthConfigComponent } from './auth-config.component';

function makeProviderInfo(
  overrides: Partial<AnthropicProviderInfo> = {},
): AnthropicProviderInfo {
  return {
    id: 'openrouter',
    name: 'OpenRouter',
    description: '',
    helpUrl: '',
    keyPrefix: '',
    keyPlaceholder: '',
    maskedKeyDisplay: '',
    authType: 'apiKey',
    ...overrides,
  };
}

function makeCustomEntry(
  overrides: Partial<CustomProviderEntry> = {},
): CustomProviderEntry {
  return {
    id: 'my-gateway',
    name: 'My Gateway',
    baseUrl: 'https://gateway.example.com',
    lane: 'openai',
    authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
    keyPrefix: '',
    helpUrl: '',
    modelsEndpoint: null,
    defaultTiers: null,
    pricing: null,
    createdAt: '2026-08-12T00:00:00.000Z',
    ...overrides,
  };
}

function buildAuthStateStub() {
  const activeScopePath = signal<string | null>(null);
  const authScope = signal<'global' | 'app' | 'workspace'>('global');
  const providerScope = signal<'global' | 'app' | 'workspace'>('global');

  const hasWorkspaceOverride = signal(false);
  const hasAppOverride = signal(false);
  const activeScope = signal<'global' | 'app' | 'workspace'>('global');

  const availableProviders = signal<AnthropicProviderInfo[]>([]);
  const customEntries = signal<readonly CustomProviderEntry[]>([]);
  const customEntryError = signal('');
  const customTestState = signal<{
    id: string;
    ok: boolean;
    message: string;
    latencyMs?: number;
  } | null>(null);
  const customTestingId = signal<string | null>(null);

  return {
    customEntries: customEntries.asReadonly(),
    customEntryError: customEntryError.asReadonly(),
    customTestState: customTestState.asReadonly(),
    customTestingId: customTestingId.asReadonly(),
    customEntriesBusy: signal(false).asReadonly(),
    loadCustomEntries: jest.fn(async () => undefined),
    addCustomEntry: jest.fn(async () => ({ ok: true })),
    updateCustomEntry: jest.fn(async () => ({ ok: true })),
    removeCustomEntry: jest.fn(async () => true),
    testCustomEntry: jest.fn(async () => ({ ok: true, message: 'ok' })),
    clearCustomEntryError: jest.fn(),
    clearCustomTestState: jest.fn(),
    isCustomProvider: jest.fn((id: string) =>
      customEntries().some((entry) => entry.id === id),
    ),
    customEntry: jest.fn(
      (id: string) => customEntries().find((entry) => entry.id === id) ?? null,
    ),
    _customEntries: customEntries,
    _availableProviders: availableProviders,
    activeScopePath: activeScopePath.asReadonly(),
    authScope: authScope.asReadonly(),
    providerScope: providerScope.asReadonly(),
    hasWorkspaceOverride: hasWorkspaceOverride.asReadonly(),
    hasAppOverride: hasAppOverride.asReadonly(),
    activeScope: activeScope.asReadonly(),
    persistedTileId: signal<string | null>(null).asReadonly(),
    authMethod: signal<'apiKey' | 'thirdParty' | 'claudeCli'>(
      'apiKey',
    ).asReadonly(),
    selectedProviderId: signal('openrouter').asReadonly(),
    availableProviders: availableProviders.asReadonly(),
    isLoading: signal(false).asReadonly(),
    isSaving: signal(false).asReadonly(),
    connectionStatus: signal<
      'idle' | 'saving' | 'testing' | 'success' | 'error'
    >('idle').asReadonly(),
    errorMessage: signal('').asReadonly(),
    successMessage: signal('').asReadonly(),
    hasApiKey: signal(false).asReadonly(),
    hasProviderKey: signal(false).asReadonly(),
    hasAnyCredential: signal(false).asReadonly(),
    hasProviderCredential: signal(false).asReadonly(),
    showProviderModels: signal(false).asReadonly(),
    effectiveProviderId: signal('anthropic').asReadonly(),
    selectedProvider: signal(null).asReadonly(),
    copilotAuthenticated: signal(false).asReadonly(),
    copilotUsername: signal<string | null>(null).asReadonly(),
    copilotLoggingIn: signal(false).asReadonly(),
    codexAuthenticated: signal(false).asReadonly(),
    codexTokenStale: signal(false).asReadonly(),
    authRequiredBanner: signal(null).asReadonly(),
    claudeCliInstalled: signal(false).asReadonly(),
    persistedAuthMethod: signal<'apiKey' | 'thirdParty' | 'claudeCli'>(
      'apiKey',
    ).asReadonly(),
    persistedProviderId: signal('openrouter').asReadonly(),
    loadAuthStatus: jest.fn(async () => undefined),
    refreshAuthStatus: jest.fn(async () => undefined),
    saveAndTest: jest.fn(async () => undefined),
    clearWorkspaceOverride: jest.fn(async () => undefined),
    setAuthMethod: jest.fn(),
    setSelectedProviderId: jest.fn(),
    checkProviderKeyStatus: jest.fn(async () => false),
    deleteApiKey: jest.fn(async () => undefined),
    deleteProviderKey: jest.fn(async () => undefined),
    copilotLogin: jest.fn(async () => undefined),
    copilotLogout: jest.fn(async () => undefined),
    codexLogin: jest.fn(async () => undefined),
    flagAuthRequired: jest.fn(),
    clearAuthRequiredBanner: jest.fn(),
    clearStatus: jest.fn(),
    hasKeyForProvider: jest.fn(() => false),
    _activeScopePath: activeScopePath,
    _activeScope: activeScope,
  };
}

type AuthStateStub = ReturnType<typeof buildAuthStateStub>;

function mount(
  rpc: MockRpcService,
  authState: AuthStateStub,
): {
  fixture: ComponentFixture<AuthConfigComponent>;
  component: AuthConfigComponent;
} {
  TestBed.configureTestingModule({
    imports: [AuthConfigComponent],
    providers: [
      { provide: ClaudeRpcService, useValue: rpc },
      { provide: AuthStateService, useValue: authState },
    ],
  });
  const fixture = TestBed.createComponent(AuthConfigComponent);
  const component = fixture.componentInstance;
  fixture.detectChanges();
  return { fixture, component };
}

async function settle(
  fixture: ComponentFixture<AuthConfigComponent>,
): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

describe('AuthConfigComponent', () => {
  let rpc: MockRpcService;
  let authState: AuthStateStub;

  beforeEach(() => {
    rpc = createMockRpcService();
    rpc.call.mockResolvedValue(rpcSuccess(undefined));
    authState = buildAuthStateStub();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('scopeBadgeLabel', () => {
    it('returns "Workspace override" when activeScope is "workspace"', () => {
      authState._activeScope.set('workspace');
      const { component } = mount(rpc, authState);
      expect(component.scopeBadgeLabel()).toBe('Workspace override');
    });

    it('returns "Global default" when activeScope is "app"', () => {
      authState._activeScope.set('app');
      const { component } = mount(rpc, authState);
      expect(component.scopeBadgeLabel()).toBe('Global default');
    });

    it('returns "Inherited" when activeScope is "global"', () => {
      authState._activeScope.set('global');
      const { component } = mount(rpc, authState);
      expect(component.scopeBadgeLabel()).toBe('Inherited');
    });

    it('re-evaluates reactively when activeScope changes after mount', async () => {
      authState._activeScope.set('global');
      const { component, fixture } = mount(rpc, authState);
      expect(component.scopeBadgeLabel()).toBe('Inherited');

      authState._activeScope.set('app');
      fixture.detectChanges();
      expect(component.scopeBadgeLabel()).toBe('Global default');

      authState._activeScope.set('workspace');
      fixture.detectChanges();
      expect(component.scopeBadgeLabel()).toBe('Workspace override');
    });
  });

  describe('canApplyToWorkspace', () => {
    it('is false when activeScopePath is null', () => {
      authState._activeScopePath.set(null);
      const { component } = mount(rpc, authState);
      expect(component.canApplyToWorkspace()).toBe(false);
    });

    it('is true when activeScopePath is a non-null path', () => {
      authState._activeScopePath.set('D:/projects/my-repo');
      const { component } = mount(rpc, authState);
      expect(component.canApplyToWorkspace()).toBe(true);
    });
  });

  describe('setApplyTo()', () => {
    it('sets applyTo to "app" unconditionally even without an active folder', () => {
      authState._activeScopePath.set(null);
      const { component } = mount(rpc, authState);
      component.setApplyTo('app');
      expect(component.applyTo()).toBe('app');
    });

    it('sets applyTo to "app" when an active folder exists', () => {
      authState._activeScopePath.set('D:/projects/foo');
      const { component } = mount(rpc, authState);
      component.setApplyTo('app');
      expect(component.applyTo()).toBe('app');
    });

    it('sets applyTo to "workspace" when canApplyToWorkspace is true', () => {
      authState._activeScopePath.set('D:/projects/foo');
      const { component } = mount(rpc, authState);
      component.setApplyTo('workspace');
      expect(component.applyTo()).toBe('workspace');
    });

    it('ignores setApplyTo("workspace") when canApplyToWorkspace is false', () => {
      authState._activeScopePath.set(null);
      const { component } = mount(rpc, authState);
      component.setApplyTo('app');
      component.setApplyTo('workspace');
      expect(component.applyTo()).toBe('app');
    });

    it('applyTo defaults to "app" when nothing is overridden (encapsulation default)', () => {
      const { component } = mount(rpc, authState);
      expect(component.applyTo()).toBe('app');
    });

    it('applyTo seeds to "workspace" when a workspace override is already resolved', () => {
      authState._activeScopePath.set('D:/projects/foo');
      authState._activeScope.set('workspace');
      const { component } = mount(rpc, authState);
      expect(component.applyTo()).toBe('workspace');
    });

    it('applyTo seeds to "app" when an app override is already resolved', () => {
      authState._activeScope.set('app');
      const { component } = mount(rpc, authState);
      expect(component.applyTo()).toBe('app');
    });
  });

  describe('resetToGlobalDefault()', () => {
    it('delegates to clearWorkspaceOverride and re-derives applyTo from the refreshed scope', async () => {
      authState._activeScopePath.set('D:/projects/foo');
      authState._activeScope.set('workspace');
      (authState.clearWorkspaceOverride as jest.Mock).mockImplementation(
        async () => {
          authState._activeScope.set('global');
        },
      );
      const { component, fixture } = mount(rpc, authState);
      expect(component.applyTo()).toBe('workspace');

      await component.resetToGlobalDefault();
      await settle(fixture);

      expect(authState.clearWorkspaceOverride).toHaveBeenCalledTimes(1);
      expect(component.applyTo()).toBe('app');
    });
  });

  describe('custom provider tiles (TASK_2026_236)', () => {
    beforeEach(() => {
      authState._availableProviders.set([
        makeProviderInfo({ id: 'openrouter', name: 'OpenRouter' }),
        makeProviderInfo({ id: 'moonshot', name: 'Moonshot' }),
        makeProviderInfo({ id: 'my-gateway', name: 'My Gateway' }),
      ]);
      authState._customEntries.set([makeCustomEntry({ id: 'my-gateway' })]);
    });

    it('renders an edit affordance on the custom tile only', () => {
      const { fixture } = mount(rpc, authState);

      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="edit-custom-provider-my-gateway"]',
        ),
      ).toBeTruthy();
      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="edit-custom-provider-openrouter"]',
        ),
      ).toBeNull();
      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="edit-custom-provider-moonshot"]',
        ),
      ).toBeNull();
    });

    it('renders exactly one edit affordance for one custom entry', () => {
      const { fixture } = mount(rpc, authState);
      const editButtons = fixture.nativeElement.querySelectorAll(
        '[data-testid^="edit-custom-provider-"]',
      );
      expect(editButtons.length).toBe(1);
    });

    it('gives built-in tiles no edit affordance even when no custom entries exist', () => {
      authState._customEntries.set([]);
      const { fixture } = mount(rpc, authState);
      expect(
        fixture.nativeElement.querySelectorAll(
          '[data-testid^="edit-custom-provider-"]',
        ).length,
      ).toBe(0);
    });

    it('offers an "Add custom provider" tile inside the provider grid', () => {
      const { fixture } = mount(rpc, authState);
      const addTile = fixture.nativeElement.querySelector(
        '[data-testid="add-custom-provider"]',
      );
      expect(addTile).toBeTruthy();
      expect(addTile.getAttribute('aria-label')).toBe('Add a custom provider');
    });

    it('opens the form in create mode from the add tile', () => {
      const { component, fixture } = mount(rpc, authState);
      fixture.nativeElement
        .querySelector('[data-testid="add-custom-provider"]')
        .click();
      fixture.detectChanges();

      expect(component.isCustomFormOpen()).toBe(true);
      expect(component.customFormEntry()).toBeNull();
      expect(
        fixture.nativeElement.querySelector(
          '[data-testid="custom-provider-form"]',
        ),
      ).toBeTruthy();
    });

    it('opens the form in edit mode and selects the tile it edits', () => {
      const { component, fixture } = mount(rpc, authState);
      fixture.nativeElement
        .querySelector('[data-testid="edit-custom-provider-my-gateway"]')
        .click();
      fixture.detectChanges();

      expect(component.isCustomFormOpen()).toBe(true);
      expect(component.customFormEntry()?.id).toBe('my-gateway');
      expect(authState.setSelectedProviderId).toHaveBeenCalledWith(
        'my-gateway',
      );
    });

    it('ignores an edit request for an id that is not a stored custom entry', () => {
      const { component } = mount(rpc, authState);
      component.openEditCustomProvider('openrouter');
      expect(component.isCustomFormOpen()).toBe(false);
    });

    it('selects the newly saved provider so the config below matches it', () => {
      const { component } = mount(rpc, authState);
      component.onCustomProviderSaved(makeCustomEntry({ id: 'fresh-gateway' }));

      expect(authState.setAuthMethod).toHaveBeenCalledWith('thirdParty');
      expect(authState.setSelectedProviderId).toHaveBeenCalledWith(
        'fresh-gateway',
      );
      expect(authState.checkProviderKeyStatus).toHaveBeenCalledWith(
        'fresh-gateway',
      );
    });

    it('closes the form after a delete', () => {
      const { component } = mount(rpc, authState);
      component.openEditCustomProvider('my-gateway');
      expect(component.isCustomFormOpen()).toBe(true);

      component.onCustomProviderDeleted();

      expect(component.isCustomFormOpen()).toBe(false);
      expect(component.customFormEntry()).toBeNull();
    });

    it('loads the custom entry list on init', async () => {
      const { component } = mount(rpc, authState);
      await component.ngOnInit();
      expect(authState.loadCustomEntries).toHaveBeenCalled();
    });
  });
});
