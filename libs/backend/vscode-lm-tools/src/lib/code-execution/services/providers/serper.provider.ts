/**
 * Serper Search Provider Adapter
 *
 * Implements IWebSearchProvider using the Serper.dev Google Search REST API.
 * No SDK required - uses native fetch() with JSON request/response.
 *
 * API: POST https://google.serper.dev/search
 * Auth: X-API-KEY header
 * Body: { q: string, num: number }
 * Response: { organic: Array<{ title, link, snippet, ... }>, ... }
 */

import type {
  IWebSearchProvider,
  WebSearchProviderResult,
  WebSearchProviderType,
  WebSearchResultItem,
} from '../web-search-provider.interface';

const SERPER_API_URL = 'https://google.serper.dev/search';
const SERPER_FETCH_TIMEOUT_MS = 15_000;

interface SerperOrganicResult {
  title?: string;
  link?: string;
  snippet?: string;
  position?: number;
}

interface SerperSearchResponse {
  organic?: SerperOrganicResult[];
  searchParameters?: Record<string, unknown>;
}

export class SerperSearchProvider implements IWebSearchProvider {
  readonly name: WebSearchProviderType = 'serper';

  constructor(private readonly apiKey: string) {}

  async search(
    query: string,
    maxResults: number,
  ): Promise<WebSearchProviderResult> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      SERPER_FETCH_TIMEOUT_MS,
    );

    try {
      const response = await fetch(SERPER_API_URL, {
        method: 'POST',
        headers: {
          'X-API-KEY': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: query, num: maxResults }),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error(
            `Serper API error: invalid or expired API key. Please check your API key in Ptah Settings > Web Search.`,
          );
        }
        if (response.status === 429) {
          throw new Error(
            `Serper API error: rate limit exceeded. Please wait a moment and try again.`,
          );
        }
        throw new Error(
          `Serper API error: HTTP ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as SerperSearchResponse;

      const results: WebSearchResultItem[] = (data.organic ?? []).map((r) => ({
        title: r.title ?? '',
        url: r.link ?? '',
        snippet: r.snippet ?? '',
      }));

      return {
        results,
        // Serper does not provide a native summary
        summary: undefined,
      };
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `Serper API error: request timed out after ${SERPER_FETCH_TIMEOUT_MS / 1000}s.`,
        );
      }

      // Re-throw errors we already formatted
      if (
        error instanceof Error &&
        error.message.startsWith('Serper API error:')
      ) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Serper API error: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
