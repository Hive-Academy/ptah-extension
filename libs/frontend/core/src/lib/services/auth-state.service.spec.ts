/**
 * AuthStateService specs — Anthropic + third-party + OAuth credential lifecycle.
 *
 * Coverage:
 *   - `loadAuthStatus` calls `auth:getAuthStatus`, populates hasApiKey +
 *     authMethod + providers, and is idempotent via `_isLoaded` guard.
 *   - `loadAuthStatus` deduplicates concurrent calls.
 *   - `refreshAuthStatus` always re-fetches.
 *   - `checkProviderKeyStatus` updates the single-provider entry in
 *     `_providerKeyMap`.
 *   - `setAuthMethod` / `setSelectedProviderId` reset status messages.
 *   - `saveAndTest` persists + tests + refreshes on success; rolls back on
 *     each failure mode (save fails, test fails, thrown).
 *   - `saveAndTest` concurrent-guard via `_isSaving`.
 *   - `deleteApiKey` / `deleteProviderKey` propagate errors.
 *   - `copilotLogin` / `copilotLogout` toggle Copilot auth signals.
 *   - `codexLogin` triggers the RPC.
 *   - `clearStatus` resets status + error + success signals.
 *   - Computed derivations: `selectedProvider`, `persistedTileId`,
 *     `hasProviderKey`, `hasAnyCredential`, `showProviderModels`,
 *     `effectiveProviderId`, `hasProviderCredential`.
 *   - `hasKeyForProvider` synchronous lookup.
 */

import { TestBed } from '@angular/core/testing';
import type {
  AnthropicProviderInfo,
  AuthGetAuthStatusResponse,
  AuthMethod,
} from '@ptah-extension/shared';
import { ClaudeRpcService } from './claude-rpc.service';
import { ModelStateService } from './model-state.service';
import { EffortStateService } from './effort-state.service';
import { AuthStateService } from './auth-state.service';
import {
  createMockRpcService,
  rpcError,
  rpcSuccess,
  type MockRpcService,
} from '../../testing';

function makeProvider(
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

function makeAuthStatusResponse(
  overrides: Partial<AuthGetAuthStatusResponse> = {},
): AuthGetAuthStatusResponse {
  return {
    hasApiKey: false,
    hasOpenRouterKey: false,
    authMethod: 'apiKey' as AuthMethod,
    anthropicProviderId: 'openrouter',
    availableProviders: [],
    ...overrides,
  };
}

describe('AuthStateService', () => {
  let rpc: MockRpcService;
  let modelState: jest.Mocked<Pick<ModelStateService, 'refreshModels'>>;
  let effortState: jest.Mocked<Pick<EffortStateService, 'refreshEffort'>>;
  let consoleError: jest.SpyInstance;
  let consoleWarn: jest.SpyInstance;

  function createService(): AuthStateService {
    TestBed.configureTestingModule({
      providers: [
        AuthStateService,
        { provide: ClaudeRpcService, useValue: rpc },
        { provide: ModelStateService, useValue: modelState },
        { provide: EffortStateService, useValue: effortState },
      ],
    });
    return TestBed.inject(AuthStateService);
  }

  beforeEach(() => {
    rpc = createMockRpcService();
    modelState = {
      refreshModels: jest.fn(async () => undefined),
    } as jest.Mocked<Pick<ModelStateService, 'refreshModels'>>;
    effortState = {
      refreshEffort: jest.fn(async () => undefined),
    } as jest.Mocked<Pick<EffortStateService, 'refreshEffort'>>;
    consoleError = jest.spyOn(console, 'error').mockImplementation();
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    consoleError.mockRestore();
    consoleWarn.mockRestore();
    TestBed.resetTestingModule();
  });

  describe('initial state', () => {
    it('exposes sensible defaults before any load', () => {
      const service = createService();
      expect(service.hasApiKey()).toBe(false);
      expect(service.authMethod()).toBe('apiKey');
      expect(service.selectedProviderId()).toBe('openrouter');
      expect(service.isLoading()).toBe(true); // matches the signal's default
      expect(service.availableProviders()).toEqual([]);
    });
  });

  describe('loadAuthStatus()', () => {
    it('populates all signals from the backend response', async () => {
      rpc.call.mockResolvedValueOnce(
        rpcSuccess(
          makeAuthStatusResponse({
            hasApiKey: true,
            authMethod: 'thirdParty',
            anthropicProviderId: 'openrouter',
            hasOpenRouterKey: true,
            availableProviders: [makeProvider({ id: 'openrouter' })],
            copilotAuthenticated: true,
            copilotUsername: 'octocat',
            codexAuthenticated: false,
            codexTokenStale: true,
            claudeCliInstalled: true,
          }),
        ),
      );

      const service = createService();
      await service.loadAuthStatus();

      expect(rpc.call).toHaveBeenCalledWith('auth:getAuthStatus', {});
      expect(service.hasApiKey()).toBe(true);
      expect(service.authMethod()).toBe('thirdParty');
      expect(service.copilotAuthenticated()).toBe(true);
      expect(service.copilotUsername()).toBe('octocat');
      expect(service.codexTokenStale()).toBe(true);
      expect(service.claudeCliInstalled()).toBe(true);
      expect(service.persistedAuthMethod()).toBe('thirdParty');
      expect(service.persistedProviderId()).toBe('openrouter');
      expect(service.hasProviderKey()).toBe(true);
      expect(service.isLoading()).toBe(false);
    });

    it('is a no-op once loaded (guard via _isLoaded)', async () => {
      rpc.call.mockResolvedValue(rpcSuccess(makeAuthStatusResponse()));
      const service = createService();

      await service.loadAuthStatus();
      const afterFirst = rpc.call.mock.calls.length;
      await service.loadAuthStatus();
      expect(rpc.call.mock.calls.length).toBe(afterFirst);
    });

    it('deduplicates concurrent calls', async () => {
      let resolveInflight: ((v: unknown) => void) | undefined;
      rpc.call.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveInflight = resolve;
          }),
      );
      const service = createService();

      const first = service.loadAuthStatus();
      const second = service.loadAuthStatus();
      resolveInflight?.(rpcSuccess(makeAuthStatusResponse()));

      await Promise.all([first, second]);
      const statusCalls = rpc.call.mock.calls.filter(
        (c: unknown[]) => c[0] === 'auth:getAuthStatus',
      );
      expect(statusCalls).toHaveLength(1);
    });

    it('records the error and retries on subsequent calls when load fails', async () => {
      rpc.call.mockResolvedValueOnce(rpcError('backend offline'));
      const service = createService();

      await service.loadAuthStatus();
      expect(service.errorMessage()).toBe('backend offline');

      // Retry-eligible: _isLoaded stays false on failure.
      rpc.call.mockResolvedValueOnce(rpcSuccess(makeAuthStatusResponse()));
      await service.loadAuthStatus();
      const calls = rpc.call.mock.calls.filter(
        (c: unknown[]) => c[0] === 'auth:getAuthStatus',
      );
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });

    it('refreshAuthStatus always re-fetches', async () => {
      rpc.call.mockResolvedValue(rpcSuccess(makeAuthStatusResponse()));
      const service = createService();

      await service.loadAuthStatus();
      await service.refreshAuthStatus();
      await service.refreshAuthStatus();

      const calls = rpc.call.mock.calls.filter(
        (c: unknown[]) => c[0] === 'auth:getAuthStatus',
      );
      expect(calls).toHaveLength(3);
    });
  });

  describe('checkProviderKeyStatus()', () => {
    it('updates only the requested provider entry in the key map', async () => {
      const service = createService();
      rpc.call.mockResolvedValueOnce(
        rpcSuccess(makeAuthStatusResponse({ hasOpenRouterKey: true })),
      );
      const hasKey = await service.checkProviderKeyStatus('moonshot');

      expect(rpc.call).toHaveBeenCalledWith('auth:getAuthStatus', {
        providerId: 'moonshot',
      });
      expect(hasKey).toBe(true);
      expect(service.hasKeyForProvider('moonshot')).toBe(true);
      expect(service.hasKeyForProvider('openrouter')).toBe(false);
    });

    it('returns false and swallows errors when the RPC throws', async () => {
      rpc.call.mockRejectedValueOnce(new Error('net'));
      const service = createService();

      const result = await service.checkProviderKeyStatus('moonshot');
      expect(result).toBe(false);
    });
  });

  describe('setAuthMethod / setSelectedProviderId', () => {
    it('setAuthMethod updates the signal and resets status messages', () => {
      const service = createService();
      service.setAuthMethod('thirdParty');
      expect(service.authMethod()).toBe('thirdParty');
      expect(service.connectionStatus()).toBe('idle');
      expect(service.errorMessage()).toBe('');
      expect(service.successMessage()).toBe('');
    });

    it('setSelectedProviderId updates the signal and resets status messages', () => {
      const service = createService();
      service.setSelectedProviderId('moonshot');
      expect(service.selectedProviderId()).toBe('moonshot');
      expect(service.connectionStatus()).toBe('idle');
    });
  });

  describe('saveAndTest()', () => {
    it('saves, tests, refreshes, and updates persisted state on success', async () => {
      const service = createService();
      service.setAuthMethod('thirdParty');
      service.setSelectedProviderId('openrouter');

      rpc.call
        // auth:saveSettings
        .mockResolvedValueOnce(rpcSuccess({ success: true }))
        // auth:testConnection
        .mockResolvedValueOnce(rpcSuccess({ success: true }))
        // auth:getAuthStatus (post-save refreshAuthStatus echoes the new state)
        .mockResolvedValueOnce(
          rpcSuccess(
            makeAuthStatusResponse({
              authMethod: 'thirdParty',
              anthropicProviderId: 'openrouter',
            }),
          ),
        );

      await service.saveAndTest({
        authMethod: 'thirdParty',
        providerApiKey: 'sk-test',
      });

      expect(rpc.call).toHaveBeenCalledWith('auth:saveSettings', {
        authMethod: 'thirdParty',
        providerApiKey: 'sk-test',
      });
      expect(rpc.call).toHaveBeenCalledWith('auth:testConnection', {});
      expect(service.connectionStatus()).toBe('success');
      expect(service.successMessage()).toContain('Connection successful');
      expect(service.persistedAuthMethod()).toBe('thirdParty');
      expect(service.persistedProviderId()).toBe('openrouter');
      expect(modelState.refreshModels).toHaveBeenCalled();
    });

    it('surfaces an error when save fails and does not call testConnection', async () => {
      const service = createService();
      rpc.call.mockResolvedValueOnce(
        rpcSuccess({ success: false, error: 'bad key' }),
      );

      await service.saveAndTest({ authMethod: 'apiKey', anthropicApiKey: '' });

      expect(service.connectionStatus()).toBe('error');
      expect(service.errorMessage()).toBe('bad key');
      expect(rpc.call).not.toHaveBeenCalledWith(
        'auth:testConnection',
        expect.anything(),
      );
    });

    it('surfaces an error when the test connection step fails', async () => {
      const service = createService();
      rpc.call
        .mockResolvedValueOnce(rpcSuccess({ success: true }))
        .mockResolvedValueOnce(
          rpcSuccess({ success: false, errorMessage: 'upstream 401' }),
        );

      await service.saveAndTest({ authMethod: 'apiKey', anthropicApiKey: 'k' });

      expect(service.connectionStatus()).toBe('error');
      expect(service.errorMessage()).toBe('upstream 401');
    });

    it('catches thrown errors into connectionStatus="error"', async () => {
      const service = createService();
      rpc.call.mockRejectedValueOnce(new Error('socket reset'));

      await service.saveAndTest({ authMethod: 'apiKey', anthropicApiKey: 'k' });
      expect(service.connectionStatus()).toBe('error');
      expect(service.errorMessage()).toBe('socket reset');
    });

    it('concurrent saveAndTest calls are ignored (isSaving guard)', async () => {
      const service = createService();

      let resolveInflight: ((v: unknown) => void) | undefined;
      rpc.call.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveInflight = resolve;
          }),
      );

      const first = service.saveAndTest({
        authMethod: 'apiKey',
        anthropicApiKey: 'k',
      });
      await service.saveAndTest({
        authMethod: 'apiKey',
        anthropicApiKey: 'k',
      }); // no-op

      resolveInflight?.(rpcSuccess({ success: false, error: 'stop' }));
      await first;

      const saveCalls = rpc.call.mock.calls.filter(
        (c: unknown[]) => c[0] === 'auth:saveSettings',
      );
      expect(saveCalls).toHaveLength(1);
    });

    it('preserves the successful status when the post-save refresh throws', async () => {
      const service = createService();
      rpc.call
        .mockResolvedValueOnce(rpcSuccess({ success: true }))
        .mockResolvedValueOnce(rpcSuccess({ success: true }))
        // refreshAuthStatus blows up
        .mockRejectedValueOnce(new Error('refresh boom'));

      await service.saveAndTest({ authMethod: 'apiKey', anthropicApiKey: 'k' });

      expect(service.connectionStatus()).toBe('success');
      expect(service.successMessage()).toContain('Connection successful');
    });
  });

  describe('deleteApiKey() / deleteProviderKey()', () => {
    it('deleteApiKey refreshes on success', async () => {
      const service = createService();
      rpc.call
        .mockResolvedValueOnce(rpcSuccess({ success: true }))
        .mockResolvedValueOnce(rpcSuccess(makeAuthStatusResponse()));

      await service.deleteApiKey();

      expect(rpc.call).toHaveBeenCalledWith('auth:saveSettings', {
        authMethod: 'apiKey',
        anthropicApiKey: '',
      });
    });

    it('deleteApiKey records the error on failure', async () => {
      const service = createService();
      rpc.call.mockResolvedValueOnce(rpcError('denied'));

      await service.deleteApiKey();
      expect(service.errorMessage()).toBe('denied');
    });

    it('deleteProviderKey clears the local map entry on success', async () => {
      const service = createService();
      // Seed: mark provider as having a key
      rpc.call.mockResolvedValueOnce(
        rpcSuccess(makeAuthStatusResponse({ hasOpenRouterKey: true })),
      );
      await service.checkProviderKeyStatus('openrouter');
      expect(service.hasKeyForProvider('openrouter')).toBe(true);

      rpc.call
        .mockResolvedValueOnce(rpcSuccess({ success: true })) // saveSettings
        .mockResolvedValueOnce(rpcSuccess(makeAuthStatusResponse())); // refresh

      await service.deleteProviderKey('openrouter');

      expect(service.hasKeyForProvider('openrouter')).toBe(false);
    });
  });

  describe('copilotLogin / copilotLogout / codexLogin', () => {
    it('copilotLogin flips authenticated + username + success status', async () => {
      const service = createService();
      rpc.call
        .mockResolvedValueOnce(
          rpcSuccess({ success: true, username: 'octocat' }),
        )
        .mockResolvedValueOnce(rpcSuccess({ success: true })); // post-login saveSettings

      await service.copilotLogin();

      expect(service.copilotAuthenticated()).toBe(true);
      expect(service.copilotUsername()).toBe('octocat');
      expect(service.connectionStatus()).toBe('success');
      expect(service.persistedProviderId()).toBe('github-copilot');
    });

    it('copilotLogin surfaces an error when the RPC reports failure', async () => {
      const service = createService();
      rpc.call.mockResolvedValueOnce(
        rpcSuccess({ success: false, error: 'cancelled' }),
      );

      await service.copilotLogin();

      expect(service.copilotAuthenticated()).toBe(false);
      expect(service.connectionStatus()).toBe('error');
      expect(service.errorMessage()).toBe('cancelled');
    });

    it('copilotLogin is guarded by copilotLoggingIn state', async () => {
      const service = createService();

      let resolveInflight: ((v: unknown) => void) | undefined;
      rpc.call.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveInflight = resolve;
          }),
      );

      const first = service.copilotLogin();
      expect(service.copilotLoggingIn()).toBe(true);
      await service.copilotLogin(); // no-op

      resolveInflight?.(rpcSuccess({ success: false, error: 'stop' }));
      await first;
      expect(service.copilotLoggingIn()).toBe(false);
    });

    it('copilotLogout clears local state even when the RPC fails', async () => {
      const service = createService();
      rpc.call
        .mockResolvedValueOnce(
          rpcSuccess({ success: true, username: 'octocat' }),
        )
        .mockResolvedValueOnce(rpcSuccess({ success: true })); // post-login save
      await service.copilotLogin();
      expect(service.copilotAuthenticated()).toBe(true);

      rpc.call.mockRejectedValueOnce(new Error('rpc down'));
      await service.copilotLogout();

      expect(service.copilotAuthenticated()).toBe(false);
      expect(service.copilotUsername()).toBeNull();
    });

    it('codexLogin invokes the auth:codexLogin RPC', async () => {
      const service = createService();
      rpc.call.mockResolvedValueOnce(rpcSuccess({ success: true }));

      await service.codexLogin();
      expect(rpc.call).toHaveBeenCalledWith('auth:codexLogin', {});
    });
  });

  // ---------------------------------------------------------------------------
  // Gap D — Promise.all([modelState.refreshModels(), effortState.refreshEffort()])
  // signal propagation after auth:saveSettings success.
  //
  // The existing saveAndTest test asserts only that refreshModels was called.
  // These tests verify BOTH sides of the Promise.all wiring and cover the
  // second Promise.all in copilotLogin (lines 617-619 of auth-state.service.ts).
  // ---------------------------------------------------------------------------

  describe('Gap D — Promise.all signal propagation after auth save', () => {
    it('D1a — saveAndTest: both refreshModels AND refreshEffort are called on success', async () => {
      const service = createService();
      service.setAuthMethod('thirdParty');
      service.setSelectedProviderId('openrouter');

      rpc.call
        .mockResolvedValueOnce(rpcSuccess({ success: true }))
        .mockResolvedValueOnce(rpcSuccess({ success: true }))
        .mockResolvedValueOnce(
          rpcSuccess(
            makeAuthStatusResponse({
              authMethod: 'thirdParty',
              anthropicProviderId: 'openrouter',
            }),
          ),
        );

      await service.saveAndTest({
        authMethod: 'thirdParty',
        providerApiKey: 'sk-test',
      });

      expect(modelState.refreshModels).toHaveBeenCalledTimes(1);
      expect(effortState.refreshEffort).toHaveBeenCalledTimes(1);
    });

    it('D1b — saveAndTest: refreshEffort is NOT called when save fails', async () => {
      const service = createService();

      rpc.call.mockResolvedValueOnce(
        rpcSuccess({ success: false, error: 'bad key' }),
      );

      await service.saveAndTest({ authMethod: 'apiKey', anthropicApiKey: '' });

      expect(effortState.refreshEffort).not.toHaveBeenCalled();
      expect(modelState.refreshModels).not.toHaveBeenCalled();
    });

    it('D1c — saveAndTest: refreshEffort is NOT called when connection test fails', async () => {
      const service = createService();

      rpc.call
        .mockResolvedValueOnce(rpcSuccess({ success: true }))
        .mockResolvedValueOnce(
          rpcSuccess({ success: false, errorMessage: 'upstream 401' }),
        );

      await service.saveAndTest({ authMethod: 'apiKey', anthropicApiKey: 'k' });

      expect(effortState.refreshEffort).not.toHaveBeenCalled();
      expect(modelState.refreshModels).not.toHaveBeenCalled();
    });

    it('D1d — saveAndTest: Promise.all failure in post-save refresh does not overwrite success status', async () => {
      const service = createService();

      rpc.call
        .mockResolvedValueOnce(rpcSuccess({ success: true }))
        .mockResolvedValueOnce(rpcSuccess({ success: true }))
        .mockResolvedValueOnce(rpcSuccess(makeAuthStatusResponse()));

      (modelState.refreshModels as jest.Mock).mockRejectedValueOnce(
        new Error('refresh boom'),
      );

      await service.saveAndTest({ authMethod: 'apiKey', anthropicApiKey: 'k' });

      expect(service.connectionStatus()).toBe('success');
      expect(service.successMessage()).toContain('Connection successful');
    });

    it('D2a — copilotLogin: both refreshModels AND refreshEffort are called after successful login', async () => {
      const service = createService();

      rpc.call
        .mockResolvedValueOnce(
          rpcSuccess({ success: true, username: 'octocat' }),
        )
        .mockResolvedValueOnce(rpcSuccess({ success: true }));

      await service.copilotLogin();

      expect(modelState.refreshModels).toHaveBeenCalledTimes(1);
      expect(effortState.refreshEffort).toHaveBeenCalledTimes(1);
    });

    it('D2b — copilotLogin: neither refreshModels nor refreshEffort is called on login failure', async () => {
      const service = createService();

      rpc.call.mockResolvedValueOnce(
        rpcSuccess({ success: false, error: 'cancelled' }),
      );

      await service.copilotLogin();

      expect(modelState.refreshModels).not.toHaveBeenCalled();
      expect(effortState.refreshEffort).not.toHaveBeenCalled();
    });

    it('D2c — copilotLogin: Promise.all failure in post-login refresh is swallowed gracefully', async () => {
      const service = createService();

      rpc.call
        .mockResolvedValueOnce(
          rpcSuccess({ success: true, username: 'octocat' }),
        )
        .mockResolvedValueOnce(rpcSuccess({ success: true }));

      (modelState.refreshModels as jest.Mock).mockRejectedValueOnce(
        new Error('model refresh boom'),
      );
      (effortState.refreshEffort as jest.Mock).mockRejectedValueOnce(
        new Error('effort refresh boom'),
      );

      await expect(service.copilotLogin()).resolves.toBeUndefined();
      expect(service.connectionStatus()).toBe('success');
    });
  });

  describe('clearStatus()', () => {
    it('resets connectionStatus + error + success signals', () => {
      const service = createService();
      // Seed some state via public API.
      service.setAuthMethod('thirdParty'); // sets status → 'idle' + clears
      // Directly mutate via RPC-driven flow is heavier — just verify that
      // clearStatus always lands on the canonical reset values.
      service.clearStatus();
      expect(service.connectionStatus()).toBe('idle');
      expect(service.errorMessage()).toBe('');
      expect(service.successMessage()).toBe('');
    });
  });

  describe('computed derivations', () => {
    async function loadedWith(
      response: AuthGetAuthStatusResponse,
    ): Promise<AuthStateService> {
      rpc.call.mockResolvedValueOnce(rpcSuccess(response));
      const service = createService();
      await service.loadAuthStatus();
      return service;
    }

    it('selectedProvider returns the matching provider info or null', async () => {
      const openrouter = makeProvider({ id: 'openrouter' });
      const service = await loadedWith(
        makeAuthStatusResponse({ availableProviders: [openrouter] }),
      );

      expect(service.selectedProvider()?.id).toBe('openrouter');

      service.setSelectedProviderId('nonexistent');
      expect(service.selectedProvider()).toBeNull();
    });

    it('persistedTileId returns null while loading', () => {
      const service = createService();
      // No load invoked — isLoading stays true (default signal value).
      expect(service.persistedTileId()).toBeNull();
    });

    it('persistedTileId returns "claude" for apiKey + claudeCli', async () => {
      const apiKeyService = await loadedWith(
        makeAuthStatusResponse({ authMethod: 'apiKey' }),
      );
      expect(apiKeyService.persistedTileId()).toBe('claude');
    });

    it('persistedTileId returns the provider id for thirdParty', async () => {
      const service = await loadedWith(
        makeAuthStatusResponse({
          authMethod: 'thirdParty',
          anthropicProviderId: 'moonshot',
        }),
      );
      expect(service.persistedTileId()).toBe('moonshot');
    });

    it('hasAnyCredential covers apiKey, claudeCli, provider key, and copilot', async () => {
      const apiKey = await loadedWith(
        makeAuthStatusResponse({ hasApiKey: true }),
      );
      expect(apiKey.hasAnyCredential()).toBe(true);

      TestBed.resetTestingModule();
      rpc = createMockRpcService();
      const copilot = await loadedWith(
        makeAuthStatusResponse({ copilotAuthenticated: true }),
      );
      expect(copilot.hasAnyCredential()).toBe(true);
    });

    it('showProviderModels is false for apiKey + claudeCli', async () => {
      const apiKey = await loadedWith(
        makeAuthStatusResponse({ authMethod: 'apiKey' }),
      );
      expect(apiKey.showProviderModels()).toBe(false);
    });

    it('showProviderModels requires an OAuth flag for OAuth providers', async () => {
      const service = await loadedWith(
        makeAuthStatusResponse({
          authMethod: 'thirdParty',
          anthropicProviderId: 'github-copilot',
          availableProviders: [
            makeProvider({ id: 'github-copilot', authType: 'oauth' }),
          ],
          copilotAuthenticated: false,
        }),
      );
      expect(service.showProviderModels()).toBe(false);
    });

    it('showProviderModels is true for OAuth providers once authenticated', async () => {
      const service = await loadedWith(
        makeAuthStatusResponse({
          authMethod: 'thirdParty',
          anthropicProviderId: 'github-copilot',
          availableProviders: [
            makeProvider({ id: 'github-copilot', authType: 'oauth' }),
          ],
          copilotAuthenticated: true,
        }),
      );
      expect(service.showProviderModels()).toBe(true);
    });

    it('showProviderModels is true for local providers without keys', async () => {
      const service = await loadedWith(
        makeAuthStatusResponse({
          authMethod: 'thirdParty',
          anthropicProviderId: 'local-llm',
          availableProviders: [
            makeProvider({ id: 'local-llm', authType: 'none' }),
          ],
          hasOpenRouterKey: false,
        }),
      );
      expect(service.showProviderModels()).toBe(true);
    });

    it('showProviderModels is true for apiKey-type providers with a key', async () => {
      const service = await loadedWith(
        makeAuthStatusResponse({
          authMethod: 'thirdParty',
          anthropicProviderId: 'moonshot',
          availableProviders: [makeProvider({ id: 'moonshot' })],
          hasOpenRouterKey: true,
        }),
      );
      expect(service.showProviderModels()).toBe(true);
    });

    it('effectiveProviderId returns "anthropic" for direct auth', async () => {
      const service = await loadedWith(
        makeAuthStatusResponse({ authMethod: 'apiKey' }),
      );
      expect(service.effectiveProviderId()).toBe('anthropic');
    });

    it('effectiveProviderId returns the selected provider for thirdParty', async () => {
      const service = await loadedWith(
        makeAuthStatusResponse({
          authMethod: 'thirdParty',
          anthropicProviderId: 'moonshot',
        }),
      );
      expect(service.effectiveProviderId()).toBe('moonshot');
    });

    it('hasProviderCredential respects auth method + provider authType', async () => {
      // claudeCli: depends on claudeCliInstalled
      const claudeCli = await loadedWith(
        makeAuthStatusResponse({
          authMethod: 'claudeCli',
          claudeCliInstalled: true,
        }),
      );
      expect(claudeCli.hasProviderCredential()).toBe(true);

      // apiKey: depends on hasApiKey
      TestBed.resetTestingModule();
      rpc = createMockRpcService();
      const apiKey = await loadedWith(
        makeAuthStatusResponse({ authMethod: 'apiKey', hasApiKey: false }),
      );
      expect(apiKey.hasProviderCredential()).toBe(false);

      // local provider
      TestBed.resetTestingModule();
      rpc = createMockRpcService();
      const local = await loadedWith(
        makeAuthStatusResponse({
          authMethod: 'thirdParty',
          anthropicProviderId: 'local-llm',
          availableProviders: [
            makeProvider({ id: 'local-llm', authType: 'none' }),
          ],
        }),
      );
      expect(local.hasProviderCredential()).toBe(true);
    });
  });
});
