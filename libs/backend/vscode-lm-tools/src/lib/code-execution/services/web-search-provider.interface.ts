/**
 * Web Search Provider Interface
 *
 * Common adapter interface for all web search providers (Tavily, Serper, Exa).
 * Providers implement this interface to normalize search results into a
 * consistent format consumed by WebSearchService.
 */

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchProviderResult {
  results: WebSearchResultItem[];
  /** Optional narrative summary (Tavily provides this natively via includeAnswer) */
  summary?: string;
}

export type WebSearchProviderType = 'tavily' | 'serper' | 'exa';

export interface IWebSearchProvider {
  readonly name: WebSearchProviderType;
  search(query: string, maxResults: number): Promise<WebSearchProviderResult>;
}
