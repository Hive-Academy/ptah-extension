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

/**
 * Machine-readable cause of a single provider's failure.
 * `missing-api-key` is a configuration problem the user can fix; `timeout` is
 * transient and worth a retry; `provider-error` is anything the adapter threw.
 */
export type WebSearchFailureReason =
  | 'missing-api-key'
  | 'timeout'
  | 'provider-error';

/**
 * Per-provider outcome. Present for EVERY selected provider, ok or not, so an
 * empty result set and a failed provider never look the same to the agent.
 */
export interface WebSearchProviderOutcome {
  provider: WebSearchProviderType;
  status: 'ok' | 'failed';
  durationMs: number;
  resultCount: number;
  /** Present only when status is 'failed'. */
  reason?: WebSearchFailureReason;
  /** Present only when status is 'failed'. Human-readable cause. */
  message?: string;
}

/** A result item tagged with the providers that returned it. */
export interface WebSearchAttributedResultItem extends WebSearchResultItem {
  /** Every provider that returned this URL, in selection order. */
  sources: WebSearchProviderType[];
}
