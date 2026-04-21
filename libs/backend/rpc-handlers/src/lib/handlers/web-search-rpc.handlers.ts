/**
 * Web Search RPC Handlers
 *
 * Handles web search settings management: API key storage, provider config,
 * and search testing via platform-agnostic abstractions.
 *
 * TASK_2025_235 Batch 3: Frontend Settings UI + Backend RPC Handlers
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

/** Secret key pattern for web search API keys */
const SECRET_KEY_PREFIX = 'ptah.webSearch.apiKey';

/** Valid provider names */
const VALID_PROVIDERS: ReadonlySet<string> = new Set([
  'tavily',
  'serper',
  'exa',
]);

/**
 * RPC handlers for web search settings management
 */
@injectable()
export class WebSearchRpcHandlers {
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

  /**
   * webSearch:test - Test current provider with a simple query
   */
  private registerTest(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      { success: boolean; provider: string; error?: string }
    >('webSearch:test', async () => {
      const provider = this.readProviderConfig();

      try {
        this.logger.debug('RPC: webSearch:test called', { provider });

        const apiKey = await this.secretStorage.get(
          `${SECRET_KEY_PREFIX}.${provider}`,
        );
        if (!apiKey) {
          return {
            success: false,
            provider,
            error: `No API key configured for ${provider}. Please add your API key first.`,
          };
        }

        const adapter = this.createProviderAdapter(
          provider as WebSearchProviderType,
          apiKey,
        );

        // Use Promise.race for a 10-second timeout, clearing the timer afterward
        const searchPromise = adapter.search('test', 1);
        let timeoutId: ReturnType<typeof setTimeout>;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('Search test timed out after 10 seconds')),
            10_000,
          );
        });

        try {
          await Promise.race([searchPromise, timeoutPromise]);
        } finally {
          clearTimeout(timeoutId!);
        }

        this.logger.info('Web search test succeeded', { provider });
        return { success: true, provider };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn('Web search test failed', {
          provider,
          error: message,
        });
        return { success: false, provider, error: message };
      }
    });
  }

  /**
   * webSearch:getConfig - Read current web search configuration
   */
  private registerGetConfig(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      { provider: string; maxResults: number }
    >('webSearch:getConfig', async () => {
      try {
        this.logger.debug('RPC: webSearch:getConfig called');

        const provider = this.readProviderConfig();
        const maxResults = this.readMaxResultsConfig();

        return { provider, maxResults };
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
      { provider?: string; maxResults?: number },
      { success: boolean }
    >('webSearch:setConfig', async (params) => {
      try {
        this.logger.debug('RPC: webSearch:setConfig called', params);

        if (params.provider !== undefined) {
          this.validateProvider(params.provider);
          await this.writeConfiguration('webSearch.provider', params.provider);
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

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

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

  /**
   * Read the currently configured search provider
   */
  private readProviderConfig(): string {
    return (
      this.workspaceProvider.getConfiguration<string>(
        'ptah',
        'webSearch.provider',
        'tavily',
      ) ?? 'tavily'
    );
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
      // Safety fallback: current platforms (VS Code, Electron) both implement
      // setConfiguration, but a future platform might not.
      this.logger.debug(
        'writeConfiguration: setConfiguration not available on this platform, skipping backend write',
        { key },
      );
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
