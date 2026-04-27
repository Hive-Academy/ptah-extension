/**
 * WebSearchService - Multi-Provider Web Search
 *
 * Routes search requests to the user-configured provider (Tavily, Serper, or Exa).
 * Reads provider configuration from IWorkspaceProvider and API keys from ISecretStorage.
 * Both dependencies are platform-abstracted, supporting VS Code and Electron equally.
 *
 * Configuration:
 *   - Provider: ptah.webSearch.provider (settings) -> 'tavily' | 'serper' | 'exa'
 *   - Max results: ptah.webSearch.maxResults (settings) -> number (default 5)
 *   - API keys: ptah.webSearch.apiKey.{provider} (SecretStorage, encrypted)
 */

import type { ISecretStorage } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';

import type {
  IWebSearchProvider,
  WebSearchProviderType,
  WebSearchResultItem,
} from './web-search-provider.interface';
import { TavilySearchProvider } from './providers/tavily.provider';
import { SerperSearchProvider } from './providers/serper.provider';
import { ExaSearchProvider } from './providers/exa.provider';

export interface WebSearchDependencies {
  secretStorage: ISecretStorage;
  workspaceProvider: IWorkspaceProvider;
  logger: Logger;
}

export interface WebSearchOptions {
  maxResults?: number;
  timeout?: number;
}

export interface WebSearchResult {
  query: string;
  summary: string;
  provider: WebSearchProviderType;
  durationMs: number;
  results: WebSearchResultItem[];
  resultCount: number;
}

const MAX_QUERY_LENGTH = 2000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RESULTS = 5;

/**
 * Secret key pattern for storing provider API keys.
 * Example: ptah.webSearch.apiKey.tavily
 */
function secretKeyForProvider(provider: WebSearchProviderType): string {
  return `ptah.webSearch.apiKey.${provider}`;
}

export class WebSearchService {
  constructor(private readonly deps: WebSearchDependencies) {}

  async search(
    query: string,
    options?: WebSearchOptions,
  ): Promise<WebSearchResult> {
    // Validate query
    const trimmed = query?.trim();
    if (!trimmed) {
      throw new Error('Web search query must not be empty');
    }
    const sanitizedQuery =
      trimmed.length > MAX_QUERY_LENGTH
        ? trimmed.substring(0, MAX_QUERY_LENGTH)
        : trimmed;

    // Clamp timeout: default 30s, max 60s
    const timeout = Math.min(
      options?.timeout ?? DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    );

    // Read provider from configuration
    const providerName = this.getProviderConfig();

    // Read maxResults: options override > config > default
    const configMaxResults =
      this.deps.workspaceProvider.getConfiguration<number>(
        'ptah',
        'webSearch.maxResults',
        DEFAULT_MAX_RESULTS,
      ) ?? DEFAULT_MAX_RESULTS;
    const maxResults = options?.maxResults ?? configMaxResults;

    // Retrieve API key from encrypted SecretStorage
    const apiKey = await this.deps.secretStorage.get(
      secretKeyForProvider(providerName),
    );
    if (apiKey == null) {
      throw new Error(
        `No API key configured for ${providerName}. ` +
          `Configure it in Ptah Settings > Web Search.`,
      );
    }

    // Create the provider adapter (instantiated per-search to always use latest key)
    const provider = this.createProvider(providerName, apiKey);

    const start = Date.now();

    try {
      // Execute search with timeout via Promise.race + AbortController pattern
      const providerResult = await Promise.race([
        provider.search(sanitizedQuery, maxResults),
        this.createTimeoutPromise(timeout),
      ]);

      const durationMs = Date.now() - start;

      // Build summary from provider or synthesize from top results
      const summary =
        providerResult.summary ||
        this.buildSummaryFromResults(providerResult.results);

      this.deps.logger.info('[WebSearch] Completed', 'WebSearchService', {
        provider: providerName,
        query: sanitizedQuery.substring(0, 80),
        resultCount: providerResult.results.length,
        durationMs,
      });

      return {
        query: sanitizedQuery,
        summary,
        provider: providerName,
        durationMs,
        results: providerResult.results,
        resultCount: providerResult.results.length,
      };
    } catch (error: unknown) {
      const durationMs = Date.now() - start;
      const message = error instanceof Error ? error.message : String(error);

      this.deps.logger.warn(
        `[WebSearch] Failed via ${providerName}`,
        'WebSearchService',
        {
          query: sanitizedQuery.substring(0, 80),
          durationMs,
          error: message,
        },
      );

      throw new Error(`Web search failed (${providerName}): ${message}`);
    }
  }

  /**
   * Read the configured provider from workspace settings.
   * Falls back to 'tavily' if not configured or invalid.
   */
  private getProviderConfig(): WebSearchProviderType {
    const raw = this.deps.workspaceProvider.getConfiguration<string>(
      'ptah',
      'webSearch.provider',
      'tavily',
    );

    const validProviders: WebSearchProviderType[] = ['tavily', 'serper', 'exa'];
    if (raw && validProviders.includes(raw as WebSearchProviderType)) {
      return raw as WebSearchProviderType;
    }

    this.deps.logger.warn(
      `[WebSearch] Unknown provider "${raw}", falling back to tavily`,
      'WebSearchService',
    );
    return 'tavily';
  }

  /**
   * Factory method to create the appropriate provider adapter.
   * Providers are cheap to instantiate (just stores API key).
   */
  private createProvider(
    providerName: WebSearchProviderType,
    apiKey: string,
  ): IWebSearchProvider {
    switch (providerName) {
      case 'tavily':
        return new TavilySearchProvider(apiKey);
      case 'serper':
        return new SerperSearchProvider(apiKey);
      case 'exa':
        return new ExaSearchProvider(apiKey);
      default: {
        // Exhaustive check - this should never happen since getProviderConfig validates
        const _exhaustive: never = providerName;
        throw new Error(`Unknown web search provider: ${_exhaustive}`);
      }
    }
  }

  /**
   * Build a fallback summary by concatenating top result snippets
   * when the provider does not supply a native summary.
   */
  private buildSummaryFromResults(results: WebSearchResultItem[]): string {
    if (!results || results.length === 0) {
      return 'No results found.';
    }

    const topResults = results.slice(0, 3);
    return topResults
      .map((r, i) => `${i + 1}. ${r.title}: ${r.snippet}`)
      .join('\n\n');
  }

  /**
   * Create a timeout promise that rejects after the specified duration.
   */
  private createTimeoutPromise(timeoutMs: number): Promise<never> {
    return new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(`Search timed out after ${(timeoutMs / 1000).toFixed(0)}s`),
        );
      }, timeoutMs);
    });
  }
}
