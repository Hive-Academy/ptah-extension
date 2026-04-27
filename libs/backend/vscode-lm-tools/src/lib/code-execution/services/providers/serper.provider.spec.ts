/**
 * Unit tests for SerperSearchProvider.
 *
 * Serper uses native fetch() — no SDK. We stub `global.fetch` directly and
 * verify request shape (URL, headers, body), response parsing, and error
 * mapping for 401/429/5xx/timeout/non-Error.
 */

import 'reflect-metadata';

import { SerperSearchProvider } from './serper.provider';

type FetchArgs = Parameters<typeof fetch>;
type FetchReturn = ReturnType<typeof fetch>;

const SERPER_URL = 'https://google.serper.dev/search';

// Minimal Response shape we care about
interface StubResponseInit {
  ok: boolean;
  status: number;
  statusText?: string;
  body: unknown;
}

function stubResponse(init: StubResponseInit): Response {
  return {
    ok: init.ok,
    status: init.status,
    statusText: init.statusText ?? '',
    json: jest.fn().mockResolvedValue(init.body),
  } as unknown as Response;
}

const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('SerperSearchProvider', () => {
  describe('basic metadata', () => {
    it('exposes provider name "serper"', () => {
      const p = new SerperSearchProvider('k');
      expect(p.name).toBe('serper');
    });
  });

  describe('request shape', () => {
    it('POSTs to the Serper search endpoint', async () => {
      const fetchMock = jest.fn<FetchReturn, FetchArgs>();
      fetchMock.mockResolvedValue(
        stubResponse({ ok: true, status: 200, body: { organic: [] } }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const p = new SerperSearchProvider('my-serper-key');
      await p.search('typescript tips', 4);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(SERPER_URL);
      expect(init?.method).toBe('POST');
    });

    it('sends X-API-KEY and JSON Content-Type headers', async () => {
      const fetchMock = jest.fn<FetchReturn, FetchArgs>();
      fetchMock.mockResolvedValue(
        stubResponse({ ok: true, status: 200, body: { organic: [] } }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const p = new SerperSearchProvider('my-serper-key');
      await p.search('q', 3);

      const [, init] = fetchMock.mock.calls[0];
      expect(init?.headers).toEqual({
        'X-API-KEY': 'my-serper-key',
        'Content-Type': 'application/json',
      });
    });

    it('serializes { q, num } JSON body with query and maxResults', async () => {
      const fetchMock = jest.fn<FetchReturn, FetchArgs>();
      fetchMock.mockResolvedValue(
        stubResponse({ ok: true, status: 200, body: { organic: [] } }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const p = new SerperSearchProvider('k');
      await p.search('hello', 9);

      const [, init] = fetchMock.mock.calls[0];
      expect(init?.body).toBe(JSON.stringify({ q: 'hello', num: 9 }));
    });

    it('attaches an AbortController signal', async () => {
      const fetchMock = jest.fn<FetchReturn, FetchArgs>();
      fetchMock.mockResolvedValue(
        stubResponse({ ok: true, status: 200, body: { organic: [] } }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const p = new SerperSearchProvider('k');
      await p.search('q', 3);

      const [, init] = fetchMock.mock.calls[0];
      expect(init?.signal).toBeDefined();
    });
  });

  describe('response parsing', () => {
    it('maps organic results into canonical shape', async () => {
      const fetchMock = jest.fn<FetchReturn, FetchArgs>();
      fetchMock.mockResolvedValue(
        stubResponse({
          ok: true,
          status: 200,
          body: {
            organic: [
              {
                title: 'Serper Result',
                link: 'https://example.com',
                snippet: 'Some content',
                position: 1,
              },
              {
                title: 'Second',
                link: 'https://example.com/2',
                snippet: 'More',
                position: 2,
              },
            ],
          },
        }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const p = new SerperSearchProvider('k');
      const res = await p.search('q', 5);
      expect(res.results).toEqual([
        {
          title: 'Serper Result',
          url: 'https://example.com',
          snippet: 'Some content',
        },
        {
          title: 'Second',
          url: 'https://example.com/2',
          snippet: 'More',
        },
      ]);
      expect(res.summary).toBeUndefined();
    });

    it('coalesces missing fields into empty strings', async () => {
      const fetchMock = jest.fn<FetchReturn, FetchArgs>();
      fetchMock.mockResolvedValue(
        stubResponse({
          ok: true,
          status: 200,
          body: { organic: [{}] },
        }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const p = new SerperSearchProvider('k');
      const res = await p.search('q', 5);
      expect(res.results[0]).toEqual({ title: '', url: '', snippet: '' });
    });

    it('returns empty results when organic field absent', async () => {
      const fetchMock = jest.fn<FetchReturn, FetchArgs>();
      fetchMock.mockResolvedValue(
        stubResponse({ ok: true, status: 200, body: {} }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const p = new SerperSearchProvider('k');
      const res = await p.search('q', 5);
      expect(res.results).toEqual([]);
    });
  });

  describe('error mapping', () => {
    it('maps HTTP 401 to invalid-API-key guidance', async () => {
      const fetchMock = jest.fn<FetchReturn, FetchArgs>();
      fetchMock.mockResolvedValue(
        stubResponse({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          body: {},
        }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const p = new SerperSearchProvider('k');
      await expect(p.search('q', 5)).rejects.toThrow(
        /Serper API error: invalid or expired API key/,
      );
    });

    it('maps HTTP 429 to rate-limit guidance', async () => {
      const fetchMock = jest.fn<FetchReturn, FetchArgs>();
      fetchMock.mockResolvedValue(
        stubResponse({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          body: {},
        }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const p = new SerperSearchProvider('k');
      await expect(p.search('q', 5)).rejects.toThrow(
        /Serper API error: rate limit exceeded/,
      );
    });

    it('maps other non-ok status codes to generic HTTP error', async () => {
      const fetchMock = jest.fn<FetchReturn, FetchArgs>();
      fetchMock.mockResolvedValue(
        stubResponse({
          ok: false,
          status: 502,
          statusText: 'Bad Gateway',
          body: {},
        }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const p = new SerperSearchProvider('k');
      await expect(p.search('q', 5)).rejects.toThrow(
        /Serper API error: HTTP 502 Bad Gateway/,
      );
    });

    it('maps AbortError to a timeout message', async () => {
      const fetchMock = jest.fn<FetchReturn, FetchArgs>();
      const abortErr = new Error('aborted');
      abortErr.name = 'AbortError';
      fetchMock.mockRejectedValue(abortErr);
      global.fetch = fetchMock as unknown as typeof fetch;

      const p = new SerperSearchProvider('k');
      await expect(p.search('q', 5)).rejects.toThrow(
        /Serper API error: request timed out/,
      );
    });

    it('preserves already-formatted Serper API errors', async () => {
      // If something inside the method throws an already-formatted error,
      // it should pass through unchanged rather than being re-wrapped.
      const fetchMock = jest.fn<FetchReturn, FetchArgs>();
      fetchMock.mockResolvedValue(
        stubResponse({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          body: {},
        }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const p = new SerperSearchProvider('k');
      try {
        await p.search('q', 5);
        fail('expected throw');
      } catch (err) {
        expect((err as Error).message).toBe(
          'Serper API error: invalid or expired API key. Please check your API key in Ptah Settings > Web Search.',
        );
      }
    });

    it('wraps generic network errors', async () => {
      const fetchMock = jest.fn<FetchReturn, FetchArgs>();
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      global.fetch = fetchMock as unknown as typeof fetch;

      const p = new SerperSearchProvider('k');
      await expect(p.search('q', 5)).rejects.toThrow(
        /Serper API error: ECONNREFUSED/,
      );
    });

    it('handles non-Error rejections by stringifying', async () => {
      const fetchMock = jest.fn<FetchReturn, FetchArgs>();
      fetchMock.mockRejectedValue('raw-failure');
      global.fetch = fetchMock as unknown as typeof fetch;

      const p = new SerperSearchProvider('k');
      await expect(p.search('q', 5)).rejects.toThrow(
        /Serper API error: raw-failure/,
      );
    });
  });

  describe('timeout lifecycle', () => {
    it('clears its fetch timeout on success', async () => {
      const clearSpy = jest.spyOn(global, 'clearTimeout');
      const fetchMock = jest.fn<FetchReturn, FetchArgs>();
      fetchMock.mockResolvedValue(
        stubResponse({ ok: true, status: 200, body: { organic: [] } }),
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const p = new SerperSearchProvider('k');
      await p.search('q', 5);

      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });
  });
});
