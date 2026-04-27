/**
 * Unit tests for TavilySearchProvider.
 *
 * Tavily uses the `@tavily/core` SDK. We mock the SDK module and its
 * returned client, then verify request shape, response parsing (including
 * the native `answer`), and error mapping.
 */

import 'reflect-metadata';

const mockSearch = jest.fn();
const mockTavilyFactory = jest.fn().mockImplementation(() => ({
  search: mockSearch,
}));

jest.mock('@tavily/core', () => ({
  __esModule: true,
  tavily: mockTavilyFactory,
}));

// Imported AFTER jest.mock so the mock is applied.
import { TavilySearchProvider } from './tavily.provider';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TavilySearchProvider', () => {
  describe('construction', () => {
    it('exposes provider name "tavily"', () => {
      const p = new TavilySearchProvider('k');
      expect(p.name).toBe('tavily');
    });

    it('passes API key to tavily() SDK factory', () => {
      new TavilySearchProvider('sekret-tavily-key');
      expect(mockTavilyFactory).toHaveBeenCalledWith({
        apiKey: 'sekret-tavily-key',
      });
    });
  });

  describe('request shape', () => {
    it('invokes client.search with basic depth, maxResults, and includeAnswer', async () => {
      mockSearch.mockResolvedValue({ results: [], answer: '' });
      const p = new TavilySearchProvider('k');
      await p.search('news today', 8);
      expect(mockSearch).toHaveBeenCalledWith('news today', {
        searchDepth: 'basic',
        maxResults: 8,
        includeAnswer: true,
      });
    });
  });

  describe('response parsing', () => {
    it('maps results into canonical shape using `content` as snippet', async () => {
      mockSearch.mockResolvedValue({
        answer: 'Here is a summary',
        results: [
          {
            title: 'Article 1',
            url: 'https://example.com/1',
            content: 'body of article 1',
            score: 0.9,
            publishedDate: '2025-01-01',
          },
          {
            title: 'Article 2',
            url: 'https://example.com/2',
            content: 'body of article 2',
            score: 0.7,
          },
        ],
      });
      const p = new TavilySearchProvider('k');
      const res = await p.search('q', 5);
      expect(res.results).toEqual([
        {
          title: 'Article 1',
          url: 'https://example.com/1',
          snippet: 'body of article 1',
        },
        {
          title: 'Article 2',
          url: 'https://example.com/2',
          snippet: 'body of article 2',
        },
      ]);
    });

    it('returns Tavily `answer` as summary when non-empty', async () => {
      mockSearch.mockResolvedValue({
        answer: 'This is the native Tavily answer.',
        results: [],
      });
      const p = new TavilySearchProvider('k');
      const res = await p.search('q', 5);
      expect(res.summary).toBe('This is the native Tavily answer.');
    });

    it('returns undefined summary when answer is empty string', async () => {
      mockSearch.mockResolvedValue({ answer: '', results: [] });
      const p = new TavilySearchProvider('k');
      const res = await p.search('q', 5);
      expect(res.summary).toBeUndefined();
    });

    it('returns undefined summary when answer is missing', async () => {
      mockSearch.mockResolvedValue({ results: [] });
      const p = new TavilySearchProvider('k');
      const res = await p.search('q', 5);
      expect(res.summary).toBeUndefined();
    });

    it('coalesces missing fields into empty strings', async () => {
      mockSearch.mockResolvedValue({
        results: [{ title: null, url: null, content: null }],
      });
      const p = new TavilySearchProvider('k');
      const res = await p.search('q', 5);
      expect(res.results[0]).toEqual({ title: '', url: '', snippet: '' });
    });

    it('returns empty results when payload results field missing', async () => {
      mockSearch.mockResolvedValue({ answer: 'x' });
      const p = new TavilySearchProvider('k');
      const res = await p.search('q', 5);
      expect(res.results).toEqual([]);
    });
  });

  describe('error mapping', () => {
    it('maps errors containing "401" to invalid-API-key guidance', async () => {
      mockSearch.mockRejectedValue(new Error('Request failed with status 401'));
      const p = new TavilySearchProvider('k');
      await expect(p.search('q', 5)).rejects.toThrow(
        /Tavily API error: invalid or expired API key/,
      );
    });

    it('maps errors containing "unauthorized" (case-insensitive) to invalid-API-key', async () => {
      mockSearch.mockRejectedValue(new Error('UNAUTHORIZED request'));
      const p = new TavilySearchProvider('k');
      await expect(p.search('q', 5)).rejects.toThrow(
        /invalid or expired API key/,
      );
    });

    it('maps "invalid api key" substring to invalid-API-key guidance', async () => {
      mockSearch.mockRejectedValue(new Error('invalid api key detected'));
      const p = new TavilySearchProvider('k');
      await expect(p.search('q', 5)).rejects.toThrow(
        /invalid or expired API key/,
      );
    });

    it('maps "authentication" substring to invalid-API-key guidance', async () => {
      mockSearch.mockRejectedValue(new Error('authentication failed'));
      const p = new TavilySearchProvider('k');
      await expect(p.search('q', 5)).rejects.toThrow(
        /invalid or expired API key/,
      );
    });

    it('maps errors containing "429" to rate-limit guidance', async () => {
      mockSearch.mockRejectedValue(new Error('status 429 returned'));
      const p = new TavilySearchProvider('k');
      await expect(p.search('q', 5)).rejects.toThrow(
        /Tavily API error: rate limit exceeded/,
      );
    });

    it('maps "rate limit" substring to rate-limit guidance', async () => {
      mockSearch.mockRejectedValue(new Error('Tavily rate limit reached'));
      const p = new TavilySearchProvider('k');
      await expect(p.search('q', 5)).rejects.toThrow(/rate limit exceeded/);
    });

    it('wraps generic errors with Tavily prefix', async () => {
      mockSearch.mockRejectedValue(new Error('network down'));
      const p = new TavilySearchProvider('k');
      await expect(p.search('q', 5)).rejects.toThrow(
        /Tavily API error: network down/,
      );
    });

    it('handles non-Error rejections by stringifying', async () => {
      mockSearch.mockRejectedValue('raw-failure');
      const p = new TavilySearchProvider('k');
      await expect(p.search('q', 5)).rejects.toThrow(
        /Tavily API error: raw-failure/,
      );
    });
  });
});
