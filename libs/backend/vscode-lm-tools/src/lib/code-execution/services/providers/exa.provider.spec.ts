/**
 * Unit tests for ExaSearchProvider.
 *
 * Exa uses the `exa-js` SDK. We mock the SDK module to avoid network calls
 * and to simulate the `ExaError` class for status-code error paths.
 */

import 'reflect-metadata';

// -- Mock the exa-js SDK ----------------------------------------------------
const mockSearchAndContents = jest.fn();

class MockExaError extends Error {
  statusCode: number;
  timestamp?: string;
  path?: string;
  constructor(
    message: string,
    statusCode: number,
    timestamp?: string,
    path?: string,
  ) {
    super(message);
    this.name = 'ExaError';
    this.statusCode = statusCode;
    this.timestamp = timestamp;
    this.path = path;
  }
}

jest.mock('exa-js', () => {
  const constructorFn = jest.fn().mockImplementation((_apiKey: string) => ({
    searchAndContents: mockSearchAndContents,
  }));
  return {
    __esModule: true,
    default: constructorFn,
    ExaError: MockExaError,
  };
});

// Imported AFTER jest.mock so the mock is applied.
import ExaCtor from 'exa-js';
import { ExaSearchProvider } from './exa.provider';

const MockedExaCtor = ExaCtor as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ExaSearchProvider', () => {
  describe('construction', () => {
    it('exposes provider name "exa"', () => {
      const p = new ExaSearchProvider('key');
      expect(p.name).toBe('exa');
    });

    it('passes API key to Exa SDK constructor', () => {
      new ExaSearchProvider('sekret-exa-key');
      expect(MockedExaCtor).toHaveBeenCalledWith('sekret-exa-key');
    });
  });

  describe('request shape', () => {
    it('invokes searchAndContents with query, numResults, and text option', async () => {
      mockSearchAndContents.mockResolvedValue({ results: [] });
      const p = new ExaSearchProvider('k');
      await p.search('typescript patterns', 7);
      expect(mockSearchAndContents).toHaveBeenCalledWith(
        'typescript patterns',
        {
          numResults: 7,
          text: { maxCharacters: 300 },
        },
      );
    });
  });

  describe('response parsing', () => {
    it('normalizes Exa results into the canonical shape', async () => {
      mockSearchAndContents.mockResolvedValue({
        results: [
          {
            title: 'Result 1',
            url: 'https://example.com/1',
            text: 'content-1',
          },
          {
            title: 'Result 2',
            url: 'https://example.com/2',
            text: 'content-2',
          },
        ],
      });
      const p = new ExaSearchProvider('k');
      const res = await p.search('q', 5);
      expect(res.results).toEqual([
        {
          title: 'Result 1',
          url: 'https://example.com/1',
          snippet: 'content-1',
        },
        {
          title: 'Result 2',
          url: 'https://example.com/2',
          snippet: 'content-2',
        },
      ]);
      expect(res.summary).toBeUndefined();
    });

    it('coalesces null title/url/text into empty strings', async () => {
      mockSearchAndContents.mockResolvedValue({
        results: [{ title: null, url: null, text: null }],
      });
      const p = new ExaSearchProvider('k');
      const res = await p.search('q', 5);
      expect(res.results[0]).toEqual({ title: '', url: '', snippet: '' });
    });

    it('returns empty results when Exa payload has no results array', async () => {
      mockSearchAndContents.mockResolvedValue({});
      const p = new ExaSearchProvider('k');
      const res = await p.search('q', 5);
      expect(res.results).toEqual([]);
    });
  });

  describe('error mapping', () => {
    it('maps 401 ExaError to invalid-API-key guidance', async () => {
      mockSearchAndContents.mockRejectedValue(
        new MockExaError('Unauthorized', 401),
      );
      const p = new ExaSearchProvider('k');
      await expect(p.search('q', 5)).rejects.toThrow(
        /Exa API error: invalid or expired API key/,
      );
    });

    it('maps 429 ExaError to rate-limit guidance', async () => {
      mockSearchAndContents.mockRejectedValue(
        new MockExaError('Too Many Requests', 429),
      );
      const p = new ExaSearchProvider('k');
      await expect(p.search('q', 5)).rejects.toThrow(
        /Exa API error: rate limit exceeded/,
      );
    });

    it('maps plain Error with "unauthorized" substring to invalid-key guidance', async () => {
      mockSearchAndContents.mockRejectedValue(
        new Error('Request failed: unauthorized'),
      );
      const p = new ExaSearchProvider('k');
      await expect(p.search('q', 5)).rejects.toThrow(
        /invalid or expired API key/,
      );
    });

    it('maps plain Error with "rate limit" substring to rate-limit guidance', async () => {
      mockSearchAndContents.mockRejectedValue(new Error('Exa rate limit hit'));
      const p = new ExaSearchProvider('k');
      await expect(p.search('q', 5)).rejects.toThrow(/rate limit exceeded/);
    });

    it('maps "invalid api key" substring (case-insensitive) to invalid-key guidance', async () => {
      mockSearchAndContents.mockRejectedValue(
        new Error('INVALID API KEY provided'),
      );
      const p = new ExaSearchProvider('k');
      await expect(p.search('q', 5)).rejects.toThrow(/invalid or expired/);
    });

    it('wraps unknown errors generically', async () => {
      mockSearchAndContents.mockRejectedValue(
        new MockExaError('Internal Server Error', 500),
      );
      const p = new ExaSearchProvider('k');
      await expect(p.search('q', 5)).rejects.toThrow(
        /Exa API error: Internal Server Error/,
      );
    });

    it('handles non-Error rejections by stringifying', async () => {
      mockSearchAndContents.mockRejectedValue('raw-string-failure');
      const p = new ExaSearchProvider('k');
      await expect(p.search('q', 5)).rejects.toThrow(
        /Exa API error: raw-string-failure/,
      );
    });

    it('matches "authentication" substring', async () => {
      mockSearchAndContents.mockRejectedValue(
        new Error('authentication required'),
      );
      const p = new ExaSearchProvider('k');
      await expect(p.search('q', 5)).rejects.toThrow(
        /invalid or expired API key/,
      );
    });
  });
});
