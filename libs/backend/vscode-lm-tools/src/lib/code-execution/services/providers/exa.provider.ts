/**
 * Exa Search Provider Adapter
 *
 * Implements IWebSearchProvider using the official exa-js SDK.
 * Exa provides high-quality AI-powered search with optional text content
 * extraction via the searchAndContents() method.
 *
 * SDK API (verified from exa-js@2.10.x .d.ts):
 *   new Exa(apiKey) -> Exa instance
 *   exa.searchAndContents<T>(query, options?) -> SearchResponse<T>
 *   SearchResponse: { results: SearchResult<T>[], requestId, ... }
 *   SearchResult: { title: string | null, url: string, text: string (when text option used), ... }
 *   ExaError: extends Error with statusCode, timestamp, path
 */

import Exa, { ExaError } from 'exa-js';
import type {
  IWebSearchProvider,
  WebSearchProviderResult,
  WebSearchProviderType,
  WebSearchResultItem,
} from '../web-search-provider.interface';

export class ExaSearchProvider implements IWebSearchProvider {
  readonly name: WebSearchProviderType = 'exa';
  private readonly client: Exa;

  constructor(apiKey: string) {
    this.client = new Exa(apiKey);
  }

  async search(
    query: string,
    maxResults: number,
  ): Promise<WebSearchProviderResult> {
    try {
      const response = await this.client.searchAndContents(query, {
        numResults: maxResults,
        text: { maxCharacters: 300 },
      });

      const results: WebSearchResultItem[] = (response.results ?? []).map(
        (r) => ({
          title: r.title ?? '',
          url: r.url ?? '',
          snippet: (r as unknown as { text?: string }).text ?? '',
        }),
      );

      return {
        results,
        // Exa does not provide a native narrative summary
        summary: undefined,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode =
        error instanceof ExaError ? error.statusCode : undefined;

      if (
        statusCode === 401 ||
        message.toLowerCase().includes('unauthorized') ||
        message.toLowerCase().includes('invalid api key') ||
        message.toLowerCase().includes('authentication')
      ) {
        throw new Error(
          `Exa API error: invalid or expired API key. Please check your API key in Ptah Settings > Web Search.`,
        );
      }

      if (statusCode === 429 || message.toLowerCase().includes('rate limit')) {
        throw new Error(
          `Exa API error: rate limit exceeded. Please wait a moment and try again.`,
        );
      }

      throw new Error(`Exa API error: ${message}`);
    }
  }
}
