/**
 * Tavily Search Provider Adapter
 *
 * Implements IWebSearchProvider using the official @tavily/core SDK.
 * Tavily provides high-quality search results plus an optional narrative
 * answer/summary when includeAnswer is enabled.
 *
 * SDK API (verified from @tavily/core@0.7.x .d.ts):
 *   tavily({ apiKey }) -> TavilyClient
 *   TavilyClient.search(query, options?) -> TavilySearchResponse
 *   TavilySearchResponse: { results: TavilySearchResult[], answer?: string, ... }
 *   TavilySearchResult: { title, url, content, score, publishedDate }
 */

import { tavily } from '@tavily/core';
import type {
  IWebSearchProvider,
  WebSearchProviderResult,
  WebSearchProviderType,
  WebSearchResultItem,
} from '../web-search-provider.interface';

export class TavilySearchProvider implements IWebSearchProvider {
  readonly name: WebSearchProviderType = 'tavily';
  private readonly client: ReturnType<typeof tavily>;

  constructor(apiKey: string) {
    this.client = tavily({ apiKey });
  }

  async search(
    query: string,
    maxResults: number,
  ): Promise<WebSearchProviderResult> {
    try {
      const response = await this.client.search(query, {
        searchDepth: 'basic',
        maxResults,
        includeAnswer: true,
      });

      const results: WebSearchResultItem[] = (response.results ?? []).map(
        (r) => ({
          title: r.title ?? '',
          url: r.url ?? '',
          snippet: r.content ?? '',
        }),
      );

      return {
        results,
        summary: response.answer || undefined,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      // Detect common error patterns for better user messaging
      if (
        message.includes('401') ||
        message.toLowerCase().includes('unauthorized') ||
        message.toLowerCase().includes('invalid api key') ||
        message.toLowerCase().includes('authentication')
      ) {
        throw new Error(
          `Tavily API error: invalid or expired API key. Please check your API key in Ptah Settings > Web Search.`,
        );
      }

      if (
        message.includes('429') ||
        message.toLowerCase().includes('rate limit')
      ) {
        throw new Error(
          `Tavily API error: rate limit exceeded. Please wait a moment and try again.`,
        );
      }

      throw new Error(`Tavily API error: ${message}`);
    }
  }
}
