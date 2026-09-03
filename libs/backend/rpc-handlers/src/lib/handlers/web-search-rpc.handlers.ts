/**
 * Web Search RPC Handlers
 *
 * Handles web search settings management: API key storage, provider config,
 * and search testing via platform-agnostic abstractions.
 */

import { injectable, inject } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  ISecretStorage,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  TavilySearchProvider,
  SerperSearchProvider,
  ExaSearchProvider,
} from '@ptah-extension/vscode-lm-tools';
import type {
  WebSearchProviderType,
  IWebSearchProvider,
} from '@ptah-extension/vscode-lm-tools';
import {
  SECRET_KEY_PREFIX,
  VALID_PROVIDERS,
  WebSearchProvidersSchema,
} from './web-search-rpc.schema';
import type { RpcMethodName } from '@ptah-extension/shared';

interface WebSearchTestProviderResult {
  provider: string;
  success: boolean;
  error?: string;
}

/**
 * RPC handlers for web search settings management
 */
@injectable()
export class WebSearchRpcHandlers {
  static readonly METHODS = [
    'webSearch:getApiKeyStatus',
    'webSearch:setApiKey',
    'webSearch:deleteApiKey',
    'webSearch:test',
    'webSearch:getConfig',
    'webSearch:setConfig',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.SECRET_STORAGE)
    private readonly secretStorage: ISecretStorage,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
  ) {}

  /**
   * Register all web search RPC methods
   */
  register(): void {
    this.registerGetApiKeyStatus();
    this.registerSetApiKey();
    this.registerDeleteApiKey();
    this.registerTest();
    this.registerGetConfig();
    this.registerSetConfig();

    this.logger.debug('Web Search RPC handlers registered', {
      methods: [
        'webSearch:getApiKeyStatus',
        'webSearch:setApiKey',
        'webSearch:deleteApiKey',
        'webSearch:test',
        'webSearch:getConfig',
        'webSearch:setConfig',
      ],
    });
  }

  /**
   * webSearch:getApiKeyStatus - Check if API key is configured for a provider
   */
  private registerGetApiKeyStatus(): void {
    this.rpcHandler.registerMethod<
      { provider: string },
      { configured: boolean }
    >('webSearch:getApiKeyStatus', async (params) => {
      try {
        const { provider } = params;
        this.validateProvider(provider);

        const key = await this.secretStorage.get(
          `${SECRET_KEY_PREFIX}.${provider}`,
        );
        return { configured: key !== undefined && key !== null && key !== '' };
      } catch (error) {
        this.logger.error(
          'RPC: webSearch:getApiKeyStatus failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'WebSearchRpcHandlers.registerGetApiKeyStatus' },
        );
        throw error;
      }
    });
  }

  /**
   * webSearch:setApiKey - Store API key securely in SecretStorage
   */
  private registerSetApiKey(): void {
    this.rpcHandler.registerMethod<
      { provider: string; apiKey: string },
      { success: boolean }
    >('webSearch:setApiKey', async (params) => {
      try {
        const { provider, apiKey } = params;
        this.validateProvider(provider);

        if (!apiKey || apiKey.trim().length === 0) {
          throw new Error('API key cannot be empty');
        }

        await this.secretStorage.store(
          `${SECRET_KEY_PREFIX}.${provider}`,
          apiKey.trim(),
        );

        this.logger.info('Web search API key stored', { provider });
        return { success: true };
      } catch (error) {
        this.logger.error(
          'RPC: webSearch:setApiKey failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'WebSearchRpcHandlers.registerSetApiKey' },
        );
        throw error;
      }
    });
  }

  /**
   * webSearch:deleteApiKey - Remove API key from SecretStorage
   */
  private registerDeleteApiKey(): void {
    this.rpcHandler.registerMethod<{ provider: string }, { success: boolean }>(
      'webSearch:deleteApiKey',
      async (params) => {
        try {
          const { provider } = params;
          this.validateProvider(provider);

          await this.secretStorage.delete(`${SECRET_KEY_PREFIX}.${provider}`);

          this.logger.info('Web search API key deleted', { provider });
          return { success: true };
        } catch (error) {
          this.logger.error(
            'RPC: webSearch:deleteApiKey failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          this.sentryService.captureException(
            error instanceof Error ? error : new Error(String(error)),
            { errorSource: 'WebSearchRpcHandlers.registerDeleteApiKey' },
          );
          throw error;
        }
      },
    );
  }

  /** webSearch:test - Test every configured provider with a simple query. */
  private registerTest(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      { success: boolean; results: WebSearchTestProviderResult[] }
    >('webSearch:test', async () => {
      const providers = this.readProvidersConfig();
      this.logger.debug('RPC: webSearch:test called', { providers });

      const settled = await Promise.allSettled(
        providers.map((provider) => this.testProvider(provider)),
      );
      const results = settled.map<WebSearchTestProviderResult>(
        (result, index) => {
          if (result.status === 'fulfilled') {
            return result.value;
          }

          const provider = providers[index];
          const error =
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason);
          this.logger.warn('Web search test failed', { provider, error });
          return { provider, success: false, error };
        },
      );

      return {
        success: results.some((result) => result.success),
        results,
      };
    });
  }

  /**
   * webSearch:getConfig - Read current web search configuration
   */
  private registerGetConfig(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      { providers: string[]; maxResults: number }
    >('webSearch:getConfig', async () => {
      try {
        this.logger.debug('RPC: webSearch:getConfig called');

        const providers = this.readProvidersConfig();
        const maxResults = this.readMaxResultsConfig();

        return { providers, maxResults };
      } catch (error) {
        this.logger.error(
          'RPC: webSearch:getConfig failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'WebSearchRpcHandlers.registerGetConfig' },
        );
        throw error;
      }
    });
  }

  /**
   * webSearch:setConfig - Write web search configuration
   *
   * Delegates to writeConfiguration() which uses a runtime duck-type check for
   * setConfiguration support. All current platforms (VS Code, Electron) implement it.
   */
  private registerSetConfig(): void {
    this.rpcHandler.registerMethod<
      { providers?: string[]; maxResults?: number },
      { success: boolean }
    >('webSearch:setConfig', async (params) => {
      try {
        this.logger.debug('RPC: webSearch:setConfig called', params);

        if (params.providers !== undefined) {
          const providers = WebSearchProvidersSchema.parse(params.providers);
          await this.writeConfiguration('webSearch.providers', providers);
          await this.writeConfiguration('webSearch.provider', undefined);
        }

        if (params.maxResults !== undefined) {
          const clamped = Math.max(1, Math.min(20, params.maxResults));
          await this.writeConfiguration('webSearch.maxResults', clamped);
        }

        this.logger.info('Web search config updated', params);
        return { success: true };
      } catch (error) {
        this.logger.error(
          'RPC: webSearch:setConfig failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        this.sentryService.captureException(
          error instanceof Error ? error : new Error(String(error)),
          { errorSource: 'WebSearchRpcHandlers.registerSetConfig' },
        );
        throw error;
      }
    });
  }

  /**
   * Validate that a provider name is one of the supported values
   */
  private validateProvider(provider: string): void {
    if (!VALID_PROVIDERS.has(provider)) {
      throw new Error(
        `Invalid web search provider: "${provider}". Must be one of: ${[...VALID_PROVIDERS].join(', ')}`,
      );
    }
  }

  /** Read configured providers, with the one legacy single-value fallback. */
  private readProvidersConfig(): WebSearchProviderType[] {
    const configured = this.workspaceProvider.getConfiguration<unknown>(
      'ptah',
      'webSearch.providers',
    );
    const candidates =
      Array.isArray(configured) && configured.length > 0
        ? configured
        : this.readLegacyProviderConfig();
    const providers: WebSearchProviderType[] = [];

    for (const provider of candidates) {
      if (typeof provider === 'string' && VALID_PROVIDERS.has(provider)) {
        providers.push(provider as WebSearchProviderType);
        continue;
      }

      const invalidProvider = String(provider);
      this.logger.warn(
        `Ignoring invalid configured web search provider: ${invalidProvider}`,
        { provider: invalidProvider },
      );
    }

    return providers.length > 0 ? providers : ['tavily'];
  }

  /** Read the legacy single-provider key only when the list is absent/empty. */
  private readLegacyProviderConfig(): unknown[] {
    const legacyProvider = this.workspaceProvider.getConfiguration<unknown>(
      'ptah',
      'webSearch.provider',
    );
    return legacyProvider === undefined || legacyProvider === null
      ? []
      : [legacyProvider];
  }

  /**
   * Read the configured max results count
   */
  private readMaxResultsConfig(): number {
    return (
      this.workspaceProvider.getConfiguration<number>(
        'ptah',
        'webSearch.maxResults',
        5,
      ) ?? 5
    );
  }

  /**
   * Write a configuration value.
   *
   * IWorkspaceProvider (platform-core) only defines getConfiguration in its interface.
   * Both VS Code (VscodeWorkspaceProvider) and Electron (ElectronWorkspaceProvider)
   * implement setConfiguration at runtime, so the duck-type check below succeeds
   * on all current platforms.
   *
   * The duck-type guard is kept as a safety net for hypothetical future platforms
   * that might not implement setConfiguration.
   */
  private async writeConfiguration(key: string, value: unknown): Promise<void> {
    const provider = this.workspaceProvider as unknown as {
      setConfiguration?: (
        section: string,
        key: string,
        value: unknown,
      ) => Promise<void>;
    };

    if (typeof provider.setConfiguration === 'function') {
      await provider.setConfiguration('ptah', key, value);
    } else {
      this.logger.debug(
        'writeConfiguration: setConfiguration not available on this platform, skipping backend write',
        { key },
      );
    }
  }

  /** Run one isolated provider smoke test under its own 10-second timeout. */
  private async testProvider(
    provider: WebSearchProviderType,
  ): Promise<WebSearchTestProviderResult> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      const apiKey = await this.secretStorage.get(
        `${SECRET_KEY_PREFIX}.${provider}`,
      );
      if (!apiKey) {
        return {
          provider,
          success: false,
          error: `No API key configured for ${provider}. Please add your API key first.`,
        };
      }

      const adapter = this.createProviderAdapter(provider, apiKey);
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Search test timed out after 10 seconds')),
          10_000,
        );
      });

      await Promise.race([adapter.search('test', 1), timeoutPromise]);
      this.logger.info('Web search test succeeded', { provider });
      return { provider, success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('Web search test failed', {
        provider,
        error: message,
      });
      return { provider, success: false, error: message };
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Create the appropriate search provider adapter
   */
  private createProviderAdapter(
    provider: WebSearchProviderType,
    apiKey: string,
  ): IWebSearchProvider {
    switch (provider) {
      case 'tavily':
        return new TavilySearchProvider(apiKey);
      case 'serper':
        return new SerperSearchProvider(apiKey);
      case 'exa':
        return new ExaSearchProvider(apiKey);
      default: {
        const _exhaustive: never = provider;
        throw new Error(`Unknown web search provider: ${_exhaustive}`);
      }
    }
  }
}
