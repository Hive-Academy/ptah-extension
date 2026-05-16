/**
 * LLM RPC Handlers (Platform-Agnostic)
 *
 * Handles LLM provider management RPC methods: llm:getProviderStatus, llm:setApiKey,
 * llm:removeApiKey, llm:getDefaultProvider, llm:validateApiKeyFormat, llm:listVsCodeModels.
 *
 * Platform-agnostic — uses ISecretStorage directly instead of delegating to
 * vscode-core's LlmRpcHandlers interface.
 */

import { injectable, inject, DependencyContainer } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { ISecretStorage } from '@ptah-extension/platform-core';
import type {
  LlmListProviderModelsParams,
  LlmListProviderModelsResponse,
  LlmSetProviderBaseUrlParams,
  LlmSetProviderBaseUrlResponse,
  LlmGetProviderBaseUrlParams,
  LlmGetProviderBaseUrlResponse,
  LlmClearProviderBaseUrlParams,
  LlmClearProviderBaseUrlResponse,
  LlmGetProviderStatusEntry,
  LlmGetProviderStatusResponse,
  LlmProviderAuthMode,
} from '@ptah-extension/shared';
import type { IModelDiscovery } from '@ptah-extension/platform-core';
import type { RpcMethodName } from '@ptah-extension/shared';
import {
  getProviderBaseUrl as getRegistryProviderBaseUrl,
  ANTHROPIC_PROVIDERS,
  ANTHROPIC_DIRECT_PROVIDER_ID,
  type AnthropicProvider,
} from '@ptah-extension/agent-sdk';

/** Secret storage key prefix for provider API keys */
const API_KEY_PREFIX = 'ptah.apiKey';

/** Provider display information and env var mappings */
interface ProviderInfo {
  displayName: string;
  envVar: string;
  keyPrefix?: string;
  minLength: number;
}

const PROVIDER_INFO: Record<string, ProviderInfo> = {
  anthropic: {
    displayName: 'Anthropic (Claude)',
    envVar: 'ANTHROPIC_API_KEY',
    keyPrefix: 'sk-ant-',
    minLength: 20,
  },
  openrouter: {
    displayName: 'OpenRouter',
    envVar: 'OPENROUTER_API_KEY',
    keyPrefix: 'sk-or-',
    minLength: 20,
  },
  moonshot: {
    displayName: 'Moonshot AI',
    envVar: 'MOONSHOT_API_KEY',
    minLength: 10,
  },
  'z-ai': {
    displayName: 'Z.AI',
    envVar: 'Z_AI_API_KEY',
    minLength: 10,
  },
};

/**
 * Build the per-provider status entry list.
 *
 * Iterates the full ANTHROPIC_PROVIDERS registry plus the virtual
 * `anthropic` direct provider so callers see every available provider, not
 * just the legacy `['anthropic', 'openrouter']` pair. Each entry surfaces:
 *   - authType: derived from registry (`apiKey` is the default when undefined)
 *               — except `anthropic`, which is `'cli'` when the user picked
 *               authMethod=claudeCli/claude-cli, otherwise `'apiKey'`.
 *   - hasApiKey: secretStorage presence — only meaningful for apiKey providers
 *   - baseUrl: registry default OR per-provider override at
 *              `provider.<id>.baseUrl` in ~/.ptah/settings.json
 *   - baseUrlOverridden: true iff the override is set
 */
function buildStatusProviderList(): Array<{
  id: string;
  displayName: string;
  authTypeDefault: LlmProviderAuthMode;
  requiresProxy: boolean;
  isLocal: boolean;
  defaultBaseUrl: string | null;
}> {
  const entries: Array<{
    id: string;
    displayName: string;
    authTypeDefault: LlmProviderAuthMode;
    requiresProxy: boolean;
    isLocal: boolean;
    defaultBaseUrl: string | null;
  }> = [
    // Virtual "Anthropic Direct" entry — not in the registry but surfaced
    // so users see the route they hit when auth = direct API key.
    {
      id: ANTHROPIC_DIRECT_PROVIDER_ID,
      displayName:
        PROVIDER_INFO[ANTHROPIC_DIRECT_PROVIDER_ID]?.displayName ??
        'Anthropic (Claude)',
      authTypeDefault: 'apiKey',
      requiresProxy: false,
      isLocal: false,
      defaultBaseUrl: null,
    },
  ];

  // Widen the per-entry type to the registry's interface so optional fields
  // (`authType`, `requiresProxy`, `isLocal`) on entries that omit them
  // narrow to `undefined` instead of being absent at the type level.
  const registry: readonly AnthropicProvider[] = ANTHROPIC_PROVIDERS;
  for (const p of registry) {
    entries.push({
      id: p.id,
      displayName: p.name,
      authTypeDefault: (p.authType ?? 'apiKey') as LlmProviderAuthMode,
      requiresProxy: p.requiresProxy === true,
      isLocal: p.isLocal === true,
      defaultBaseUrl: p.baseUrl,
    });
  }
  return entries;
}

/**
 * RPC handlers for LLM provider operations (platform-agnostic)
 *
 * Uses ISecretStorage directly for API key management and IModelDiscovery
 * for platform-specific model listing. Works on both VS Code and Electron.
 */
@injectable()
export class LlmRpcHandlers {
  static readonly METHODS = [
    'llm:getProviderStatus',
    'llm:setApiKey',
    'llm:removeApiKey',
    'llm:getDefaultProvider',
    'llm:setDefaultProvider',
    'llm:setDefaultModel',
    'llm:validateApiKeyFormat',
    'llm:listVsCodeModels',
    'llm:listProviderModels',
    'llm:setProviderBaseUrl',
    'llm:getProviderBaseUrl',
    'llm:clearProviderBaseUrl',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.DI_CONTAINER)
    private readonly container: DependencyContainer,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
  ) {}

  /**
   * Register all LLM RPC methods
   */
  register(): void {
    this.registerGetProviderStatus();
    this.registerSetApiKey();
    this.registerRemoveApiKey();
    this.registerGetDefaultProvider();
    this.registerSetDefaultProvider();
    this.registerSetDefaultModel();
    this.registerValidateApiKeyFormat();
    this.registerListVsCodeModels();
    this.registerListProviderModels();
    this.registerSetProviderBaseUrl();
    this.registerGetProviderBaseUrl();
    this.registerClearProviderBaseUrl();

    this.logger.debug('LLM RPC handlers registered', {
      methods: [
        'llm:getProviderStatus',
        'llm:setApiKey',
        'llm:removeApiKey',
        'llm:getDefaultProvider',
        'llm:setDefaultProvider',
        'llm:setDefaultModel',
        'llm:validateApiKeyFormat',
        'llm:listVsCodeModels',
        'llm:listProviderModels',
        'llm:setProviderBaseUrl',
        'llm:getProviderBaseUrl',
        'llm:clearProviderBaseUrl',
      ],
    });
  }

  /**
   * Lazily resolve ISecretStorage from the DI container.
   * Uses lazy resolution because the container may not have all registrations
   * at construction time (factory pattern).
   */
  private getSecretStorage(): ISecretStorage {
    return this.container.resolve<ISecretStorage>(
      PLATFORM_TOKENS.SECRET_STORAGE,
    );
  }

  /**
   * Lazily resolve IModelDiscovery from the DI container.
   */
  private getModelDiscovery(): IModelDiscovery {
    return this.container.resolve<IModelDiscovery>(TOKENS.MODEL_DISCOVERY);
  }

  /**
   * Get the config manager shim for reading/writing settings.
   */
  private getConfigManager(): {
    get<T>(key: string): T | undefined;
    set<T>(key: string, value: T): Promise<void>;
  } {
    return this.container.resolve(TOKENS.CONFIG_MANAGER);
  }

  /**
   * llm:getProviderStatus - Get status of all LLM providers (without exposing API keys).
   *
   * Returns the full registry, not the legacy `['anthropic', 'openrouter']`
   * pair. Each entry includes auth mode (apiKey/oauth/cli/none), proxy +
   * locality flags, and the resolved base URL with override status.
   */
  private registerGetProviderStatus(): void {
    this.rpcHandler.registerMethod<void, LlmGetProviderStatusResponse>(
      'llm:getProviderStatus',
      async () => {
        try {
          this.logger.debug('RPC: llm:getProviderStatus called');

          const secretStorage = this.getSecretStorage();
          const configManager = this.getConfigManager();
          const defaultProvider =
            configManager.get<string>('llm.defaultProvider') ?? 'anthropic';

          // authMethod drives the virtual `anthropic` entry's authType:
          // 'claudeCli' / 'claude-cli' → 'cli' (no key needed), else 'apiKey'.
          const rawAuthMethod = configManager.get<string>('authMethod');
          const isClaudeCli =
            rawAuthMethod === 'claudeCli' || rawAuthMethod === 'claude-cli';

          const catalogue = buildStatusProviderList();

          const providers: LlmGetProviderStatusEntry[] = await Promise.all(
            catalogue.map(async (entry) => {
              const overrideRaw = configManager.get<string>(
                `provider.${entry.id}.baseUrl`,
              );
              const override =
                typeof overrideRaw === 'string' && overrideRaw.trim().length > 0
                  ? overrideRaw.trim()
                  : null;

              const baseUrlOverridden = override !== null;
              const baseUrl = override ?? entry.defaultBaseUrl;

              // Resolve auth type — virtual anthropic entry honors authMethod.
              let authType: LlmProviderAuthMode = entry.authTypeDefault;
              if (entry.id === ANTHROPIC_DIRECT_PROVIDER_ID && isClaudeCli) {
                authType = 'cli';
              }

              // hasApiKey is only meaningful when authType === 'apiKey'.
              let hasApiKey = false;
              if (authType === 'apiKey') {
                const stored = await secretStorage.get(
                  `${API_KEY_PREFIX}.${entry.id}`,
                );
                hasApiKey = !!stored;
              }

              return {
                name: entry.id,
                displayName: entry.displayName,
                hasApiKey,
                isDefault: entry.id === defaultProvider,
                authType,
                requiresProxy: entry.requiresProxy,
                isLocal: entry.isLocal,
                baseUrl,
                baseUrlOverridden,
              };
            }),
          );

          return { providers, defaultProvider };
        } catch (error) {
          this.logger.error(
            'RPC: llm:getProviderStatus failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'LlmRpcHandlers.registerGetProviderStatus' },
          );
          return { providers: [], defaultProvider: 'anthropic' };
        }
      },
    );
  }

  /**
   * llm:setApiKey - Set API key for a provider
   */
  private registerSetApiKey(): void {
    this.rpcHandler.registerMethod<
      { provider: string; apiKey: string },
      { success: boolean; error?: string }
    >(
      'llm:setApiKey',
      async (params: { provider: string; apiKey: string } | undefined) => {
        if (!params?.provider || !params?.apiKey) {
          return {
            success: false,
            error: 'provider and apiKey are required',
          };
        }

        try {
          // SECURITY: Never log the actual API key
          this.logger.debug('RPC: llm:setApiKey called', {
            provider: params.provider,
          });

          const secretStorage = this.getSecretStorage();
          const storageKey = `${API_KEY_PREFIX}.${params.provider}`;
          await secretStorage.store(storageKey, params.apiKey);

          // Set in environment for SDK adapters
          const providerInfo = PROVIDER_INFO[params.provider];
          if (providerInfo) {
            process.env[providerInfo.envVar] = params.apiKey;
          }

          return { success: true };
        } catch (error) {
          this.logger.error(
            'RPC: llm:setApiKey failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'LlmRpcHandlers.registerSetApiKey' },
          );
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
  }

  /**
   * llm:removeApiKey - Remove API key for a provider
   */
  private registerRemoveApiKey(): void {
    this.rpcHandler.registerMethod<
      { provider: string },
      { success: boolean; error?: string }
    >('llm:removeApiKey', async (params: { provider: string } | undefined) => {
      if (!params?.provider) {
        return { success: false, error: 'provider is required' };
      }

      try {
        this.logger.debug('RPC: llm:removeApiKey called', {
          provider: params.provider,
        });

        const secretStorage = this.getSecretStorage();
        await secretStorage.delete(`${API_KEY_PREFIX}.${params.provider}`);

        // Clear from environment
        const providerInfo = PROVIDER_INFO[params.provider];
        if (providerInfo) {
          delete process.env[providerInfo.envVar];
        }

        return { success: true };
      } catch (error) {
        this.logger.error(
          'RPC: llm:removeApiKey failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'LlmRpcHandlers.registerRemoveApiKey' },
        );
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  }

  /**
   * llm:getDefaultProvider - Get default provider from settings
   */
  private registerGetDefaultProvider(): void {
    this.rpcHandler.registerMethod<void, { provider: string }>(
      'llm:getDefaultProvider',
      async () => {
        try {
          this.logger.debug('RPC: llm:getDefaultProvider called');
          const configManager = this.getConfigManager();
          const provider =
            configManager.get<string>('llm.defaultProvider') ?? 'anthropic';
          return { provider };
        } catch (error) {
          this.logger.error(
            'RPC: llm:getDefaultProvider failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'LlmRpcHandlers.registerGetDefaultProvider' },
          );
          return { provider: 'anthropic' };
        }
      },
    );
  }

  /**
   * llm:setDefaultProvider - Set default LLM provider
   */
  private registerSetDefaultProvider(): void {
    this.rpcHandler.registerMethod<
      { provider: string },
      { success: boolean; error?: string }
    >(
      'llm:setDefaultProvider',
      async (params: { provider: string } | undefined) => {
        try {
          this.logger.debug('RPC: llm:setDefaultProvider called', {
            provider: params?.provider,
          });

          const configManager = this.getConfigManager();
          await configManager.set(
            'llm.defaultProvider',
            params?.provider ?? 'anthropic',
          );

          return { success: true };
        } catch (error) {
          this.logger.error(
            'RPC: llm:setDefaultProvider failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'LlmRpcHandlers.registerSetDefaultProvider' },
          );
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
  }

  /**
   * llm:setDefaultModel - Set default model for a provider
   */
  private registerSetDefaultModel(): void {
    this.rpcHandler.registerMethod<
      { provider: string; model: string },
      { success: boolean; error?: string }
    >(
      'llm:setDefaultModel',
      async (params: { provider: string; model: string } | undefined) => {
        try {
          this.logger.debug('RPC: llm:setDefaultModel called', {
            provider: params?.provider,
            model: params?.model,
          });

          const configManager = this.getConfigManager();
          const settingsKey = params?.provider ?? 'anthropic';
          await configManager.set(
            `llm.${settingsKey}.model`,
            params?.model ?? '',
          );

          return { success: true };
        } catch (error) {
          this.logger.error(
            'RPC: llm:setDefaultModel failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'LlmRpcHandlers.registerSetDefaultModel' },
          );
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
  }

  /**
   * llm:validateApiKeyFormat - Validate API key format (without storing)
   */
  private registerValidateApiKeyFormat(): void {
    this.rpcHandler.registerMethod<
      { provider: string; apiKey: string },
      { valid: boolean; error?: string }
    >(
      'llm:validateApiKeyFormat',
      async (params: { provider: string; apiKey: string } | undefined) => {
        if (!params?.provider || !params?.apiKey) {
          return {
            valid: false,
            error: 'provider and apiKey are required',
          };
        }

        try {
          // SECURITY: Never log the actual API key
          this.logger.debug('RPC: llm:validateApiKeyFormat called', {
            provider: params.provider,
          });

          const key = params.apiKey.trim();
          const providerInfo = PROVIDER_INFO[params.provider];

          if (providerInfo) {
            const valid = providerInfo.keyPrefix
              ? key.startsWith(providerInfo.keyPrefix) &&
                key.length > providerInfo.minLength
              : key.length > providerInfo.minLength;
            return valid
              ? { valid: true }
              : {
                  valid: false,
                  error: `API key should start with '${providerInfo.keyPrefix}' and be at least ${providerInfo.minLength} characters`,
                };
          }

          // Generic fallback for unknown providers
          return { valid: key.length > 10 };
        } catch (error) {
          this.logger.error(
            'RPC: llm:validateApiKeyFormat failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'LlmRpcHandlers.registerValidateApiKeyFormat' },
          );
          return {
            valid: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
  }

  /**
   * llm:listVsCodeModels - List available VS Code language models.
   * Delegates to IModelDiscovery.getCopilotModels() which returns real models
   * in VS Code and empty array in Electron.
   */
  private registerListVsCodeModels(): void {
    this.rpcHandler.registerMethod<void, unknown[]>(
      'llm:listVsCodeModels',
      async () => {
        try {
          this.logger.debug('RPC: llm:listVsCodeModels called');

          const modelDiscovery = this.getModelDiscovery();
          const models = await modelDiscovery.getCopilotModels();

          return models.map((m) => ({
            id: m.id,
            displayName: m.name,
            contextLength: m.contextLength,
          }));
        } catch (error) {
          this.logger.error(
            'RPC: llm:listVsCodeModels failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'LlmRpcHandlers.registerListVsCodeModels' },
          );
          return [];
        }
      },
    );
  }

  /**
   * llm:setProviderBaseUrl - Persist a per-provider base URL override.
   *
   * The override is stored at `provider.<id>.baseUrl` in
   * `~/.ptah/settings.json` (routed via `isFileBasedSettingKey`). The auth
   * strategies consult this override before falling back to the static
   * registry default. Used by the CLI parity commands `provider set-key
   * --base-url`, `provider base-url set`, and `provider ollama
   * set-endpoint`.
   */
  private registerSetProviderBaseUrl(): void {
    this.rpcHandler.registerMethod<
      LlmSetProviderBaseUrlParams,
      LlmSetProviderBaseUrlResponse
    >(
      'llm:setProviderBaseUrl',
      async (params: LlmSetProviderBaseUrlParams | undefined) => {
        if (!params?.provider || !params?.baseUrl) {
          return {
            success: false,
            error: 'provider and baseUrl are required',
          };
        }

        const trimmed = params.baseUrl.trim();
        if (trimmed.length === 0) {
          return {
            success: false,
            error: 'baseUrl must not be empty',
          };
        }

        // Light URL sanity check — accept http/https schemes only.
        try {
          const parsed = new URL(trimmed);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return {
              success: false,
              error: `baseUrl must use http(s) scheme (got '${parsed.protocol}')`,
            };
          }
        } catch {
          return {
            success: false,
            error: `baseUrl is not a valid URL: ${trimmed}`,
          };
        }

        try {
          this.logger.debug('RPC: llm:setProviderBaseUrl called', {
            provider: params.provider,
            // SECURITY: log host but not query/path which may contain tokens
            host: new URL(trimmed).host,
          });
          const configManager = this.getConfigManager();
          await configManager.set(
            `provider.${params.provider}.baseUrl`,
            trimmed,
          );
          return { success: true };
        } catch (error) {
          this.logger.error(
            'RPC: llm:setProviderBaseUrl failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'LlmRpcHandlers.registerSetProviderBaseUrl' },
          );
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
  }

  /**
   * llm:getProviderBaseUrl - Read the persisted override and the registry
   * default for a given provider. Returns `baseUrl: null` when no override
   * exists.
   */
  private registerGetProviderBaseUrl(): void {
    this.rpcHandler.registerMethod<
      LlmGetProviderBaseUrlParams,
      LlmGetProviderBaseUrlResponse
    >(
      'llm:getProviderBaseUrl',
      async (params: LlmGetProviderBaseUrlParams | undefined) => {
        if (!params?.provider) {
          return { baseUrl: null, defaultBaseUrl: null };
        }

        try {
          this.logger.debug('RPC: llm:getProviderBaseUrl called', {
            provider: params.provider,
          });
          const configManager = this.getConfigManager();
          const override = configManager.get<string>(
            `provider.${params.provider}.baseUrl`,
          );
          const trimmed =
            typeof override === 'string' && override.trim().length > 0
              ? override.trim()
              : null;
          let defaultBaseUrl: string | null = null;
          try {
            defaultBaseUrl = getRegistryProviderBaseUrl(params.provider);
          } catch {
            // Provider not in registry — leave default null.
            defaultBaseUrl = null;
          }
          return { baseUrl: trimmed, defaultBaseUrl };
        } catch (error) {
          this.logger.error(
            'RPC: llm:getProviderBaseUrl failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'LlmRpcHandlers.registerGetProviderBaseUrl' },
          );
          return { baseUrl: null, defaultBaseUrl: null };
        }
      },
    );
  }

  /**
   * llm:clearProviderBaseUrl - Remove the persisted override so the registry
   * default takes effect again.
   */
  private registerClearProviderBaseUrl(): void {
    this.rpcHandler.registerMethod<
      LlmClearProviderBaseUrlParams,
      LlmClearProviderBaseUrlResponse
    >(
      'llm:clearProviderBaseUrl',
      async (params: LlmClearProviderBaseUrlParams | undefined) => {
        if (!params?.provider) {
          return { success: false, error: 'provider is required' };
        }

        try {
          this.logger.debug('RPC: llm:clearProviderBaseUrl called', {
            provider: params.provider,
          });
          const configManager = this.getConfigManager();
          // Set to empty string so PtahFileSettingsManager removes the key
          // (its set() falls back to the default when given an empty value).
          await configManager.set(`provider.${params.provider}.baseUrl`, '');
          return { success: true };
        } catch (error) {
          this.logger.error(
            'RPC: llm:clearProviderBaseUrl failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'LlmRpcHandlers.registerClearProviderBaseUrl' },
          );
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
  }

  /**
   * llm:listProviderModels - List available models for a provider
   */
  private registerListProviderModels(): void {
    this.rpcHandler.registerMethod<
      LlmListProviderModelsParams,
      LlmListProviderModelsResponse
    >(
      'llm:listProviderModels',
      async (params: LlmListProviderModelsParams | undefined) => {
        if (!params?.provider) {
          return { models: [], error: 'provider is required' };
        }

        try {
          this.logger.debug('RPC: llm:listProviderModels called', {
            provider: params.provider,
          });

          const modelDiscovery = this.getModelDiscovery();

          // Route to appropriate discovery method based on provider
          const models =
            params.provider === 'copilot'
              ? await modelDiscovery.getCopilotModels()
              : await modelDiscovery.getCodexModels();

          return {
            models: models.map((m) => ({
              id: m.id,
              displayName: m.name,
            })),
          };
        } catch (error) {
          this.logger.error(
            'RPC: llm:listProviderModels failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'LlmRpcHandlers.registerListProviderModels' },
          );
          return {
            models: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
  }
}
