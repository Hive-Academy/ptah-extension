import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ClaudeRpcService, AuthStateService } from '@ptah-extension/core';
import {
  createMockRpcService,
  rpcSuccess,
  type MockRpcService,
} from '@ptah-extension/core/testing';
import { AuthConfigComponent } from './auth-config.component';

function makeAuthStateStub(
  overrides: Partial<ReturnType<typeof buildAuthStateStub>> = {},
): ReturnType<typeof buildAuthStateStub> {
  return { ...buildAuthStateStub(), ...overrides };
}

function buildAuthStateStub() {
  const activeScopePath = signal<string | null>(null);
  const authScope = signal<'global' | 'app' | 'workspace'>('global');
  const providerScope = signal<'global' | 'app' | 'workspace'>('global');

  const hasWorkspaceOverride = signal(false);
  const hasAppOverride = signal(false);
  const activeScope = signal<'global' | 'app' | 'workspace'>('global');

  return {
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
    availableProviders: signal([]).asReadonly(),
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

    it('returns "App override" when activeScope is "app"', () => {
      authState._activeScope.set('app');
      const { component } = mount(rpc, authState);
      expect(component.scopeBadgeLabel()).toBe('App override');
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
      expect(component.scopeBadgeLabel()).toBe('App override');

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
    it('sets applyTo to "global" unconditionally', () => {
      const { component } = mount(rpc, authState);
      component.setApplyTo('global');
      expect(component.applyTo()).toBe('global');
    });

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
      component.setApplyTo('global');
      component.setApplyTo('workspace');
      expect(component.applyTo()).toBe('global');
    });

    it('applyTo defaults to "global" on construction', () => {
      const { component } = mount(rpc, authState);
      expect(component.applyTo()).toBe('global');
    });
  });

  describe('resetToGlobalDefault()', () => {
    it('delegates to authState.clearWorkspaceOverride and resets applyTo to global', async () => {
      authState._activeScopePath.set('D:/projects/foo');
      const { component, fixture } = mount(rpc, authState);

      component.setApplyTo('workspace');
      expect(component.applyTo()).toBe('workspace');

      await component.resetToGlobalDefault();
      await settle(fixture);

      expect(authState.clearWorkspaceOverride).toHaveBeenCalledTimes(1);
      expect(component.applyTo()).toBe('global');
    });
  });
});
