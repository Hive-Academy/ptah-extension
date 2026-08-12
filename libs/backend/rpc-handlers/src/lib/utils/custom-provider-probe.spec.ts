/**
 * probeCustomProvider — unit specs (TASK_2026_236, batch C3).
 *
 * NO REAL NETWORK: every case injects a `fetchImpl`.
 *
 * Coverage:
 *   lane routing        — anthropic → /v1/messages, openai → /v1/chat/completions
 *   auth headers        — Bearer vs x-api-key, and omitted when no key is stored
 *   url joining         — a base already ending in /v1 does not become /v1/v1
 *   success             — a tool_use / tool_calls response passes
 *   NO TOOL SUPPORT     — a 200 that ignores the tool definition FAILS (the point)
 *   401/403             — bad key
 *   404                 — wrong base URL
 *   5xx                 — upstream failure
 *   DNS / refused / TLS — distinguished via the nested `cause.code`
 *   timeout             — AbortError
 *   model resolution    — tiers first, then the models endpoint, then a clear error
 *
 * Source-under-test:
 *   libs/backend/rpc-handlers/src/lib/utils/custom-provider-probe.ts
 */

import type { CustomProviderEntry } from '@ptah-extension/shared';

import {
  joinUrl,
  probeCustomProvider,
  type ProbeFetch,
  type ProbeResponse,
} from './custom-provider-probe';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function entry(over: Partial<CustomProviderEntry> = {}): CustomProviderEntry {
  return {
    id: 'my-gateway',
    name: 'My Gateway',
    baseUrl: 'https://gateway.example.com',
    lane: 'anthropic',
    authEnvVar: 'ANTHROPIC_AUTH_TOKEN',
    keyPrefix: '',
    helpUrl: '',
    defaultTiers: { sonnet: 'model-s', opus: 'model-o', haiku: 'model-h' },
    ...over,
  };
}

function response(status: number, body: unknown): ProbeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

const ANTHROPIC_TOOL_OK = {
  content: [
    { type: 'text', text: 'sure' },
    { type: 'tool_use', name: 'ptah_connection_probe', input: { ok: true } },
  ],
};

const OPENAI_TOOL_OK = {
  choices: [
    {
      message: {
        tool_calls: [
          {
            function: {
              name: 'ptah_connection_probe',
              arguments: '{"ok":true}',
            },
          },
        ],
      },
    },
  ],
};

/** Node's fetch hides the real reason one level down, on `cause.code`. */
function transportError(code: string): Error {
  const cause = Object.assign(new Error(`${code} raw`), { code });
  return Object.assign(new TypeError('fetch failed'), { cause });
}

function abortError(): Error {
  const error = new Error('This operation was aborted');
  error.name = 'AbortError';
  return error;
}

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function recordingFetch(reply: ProbeResponse | Error): {
  fetchImpl: ProbeFetch;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const fetchImpl: ProbeFetch = async (url, init) => {
    calls.push({
      url,
      method: init.method,
      headers: init.headers,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    });
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { fetchImpl, calls };
}

// ---------------------------------------------------------------------------
// joinUrl
// ---------------------------------------------------------------------------

describe('joinUrl', () => {
  it('appends the path to a bare base', () => {
    expect(joinUrl('https://router.requesty.ai', 'v1/messages')).toBe(
      'https://router.requesty.ai/v1/messages',
    );
  });

  it('collapses a duplicated version segment', () => {
    expect(joinUrl('https://api.sakana.ai/v1', 'v1/chat/completions')).toBe(
      'https://api.sakana.ai/v1/chat/completions',
    );
  });

  it('tolerates trailing slashes', () => {
    expect(joinUrl('https://api.moonshot.ai/anthropic/', 'v1/messages')).toBe(
      'https://api.moonshot.ai/anthropic/v1/messages',
    );
  });
});

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

describe('probeCustomProvider — success', () => {
  it('sends an Anthropic Messages request with a forced tool choice', async () => {
    const { fetchImpl, calls } = recordingFetch(
      response(200, ANTHROPIC_TOOL_OK),
    );

    const result = await probeCustomProvider(entry(), 'sk-test', {
      fetchImpl,
      now: makeClock(),
    });

    expect(result.ok).toBe(true);
    expect(result.failure).toBeUndefined();
    expect(result.latencyMs).toEqual(expect.any(Number));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://gateway.example.com/v1/messages');
    expect(calls[0].headers['authorization']).toBe('Bearer sk-test');
    expect(calls[0].headers['anthropic-version']).toBe('2023-06-01');
    const body = calls[0].body as {
      model: string;
      tools: Array<{ name: string }>;
      tool_choice: { type: string; name: string };
    };
    // Cheapest tier first — the user pays for this round trip.
    expect(body.model).toBe('model-h');
    expect(body.tools[0].name).toBe('ptah_connection_probe');
    expect(body.tool_choice).toEqual({
      type: 'tool',
      name: 'ptah_connection_probe',
    });
  });

  it('uses x-api-key when the entry declares ANTHROPIC_API_KEY', async () => {
    const { fetchImpl, calls } = recordingFetch(
      response(200, ANTHROPIC_TOOL_OK),
    );

    await probeCustomProvider(
      entry({ authEnvVar: 'ANTHROPIC_API_KEY' }),
      'sk-test',
      { fetchImpl, now: makeClock() },
    );

    expect(calls[0].headers['x-api-key']).toBe('sk-test');
    expect(calls[0].headers['authorization']).toBeUndefined();
  });

  it('sends no auth header at all when no key is stored', async () => {
    const { fetchImpl, calls } = recordingFetch(
      response(200, ANTHROPIC_TOOL_OK),
    );

    await probeCustomProvider(entry(), undefined, {
      fetchImpl,
      now: makeClock(),
    });

    expect(calls[0].headers['authorization']).toBeUndefined();
    expect(calls[0].headers['x-api-key']).toBeUndefined();
  });

  it('sends an OpenAI chat-completions request on the openai lane', async () => {
    const { fetchImpl, calls } = recordingFetch(response(200, OPENAI_TOOL_OK));

    const result = await probeCustomProvider(
      entry({ lane: 'openai', baseUrl: 'http://192.168.1.50:8000' }),
      'sk-test',
      { fetchImpl, now: makeClock() },
    );

    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe('http://192.168.1.50:8000/v1/chat/completions');
    const body = calls[0].body as {
      tools: Array<{ type: string; function: { name: string } }>;
    };
    expect(body.tools[0].type).toBe('function');
    expect(body.tools[0].function.name).toBe('ptah_connection_probe');
  });
});

// ---------------------------------------------------------------------------
// The failure this probe exists for
// ---------------------------------------------------------------------------

describe('probeCustomProvider — responded but ignored the tool definition', () => {
  it('fails a 200 Anthropic response with only text content', async () => {
    const { fetchImpl } = recordingFetch(
      response(200, { content: [{ type: 'text', text: 'hello' }] }),
    );

    const result = await probeCustomProvider(entry(), 'sk-test', {
      fetchImpl,
      now: makeClock(),
    });

    expect(result.ok).toBe(false);
    expect(result.failure).toBe('no-tool-support');
    expect(result.message).toContain('ignored the tool definition');
  });

  it('fails a 200 OpenAI response with no tool_calls, and names the vLLM flags', async () => {
    const { fetchImpl } = recordingFetch(
      response(200, { choices: [{ message: { content: 'hello' } }] }),
    );

    const result = await probeCustomProvider(entry({ lane: 'openai' }), 'k', {
      fetchImpl,
      now: makeClock(),
    });

    expect(result.failure).toBe('no-tool-support');
    expect(result.message).toContain('--enable-auto-tool-choice');
  });

  it('fails a 200 whose body is not JSON at all', async () => {
    const { fetchImpl } = recordingFetch(response(200, '<html>hello</html>'));

    const result = await probeCustomProvider(entry(), 'k', {
      fetchImpl,
      now: makeClock(),
    });

    expect(result.failure).toBe('malformed-response');
    expect(result.message).toContain('not JSON');
  });
});

// ---------------------------------------------------------------------------
// HTTP status classification
// ---------------------------------------------------------------------------

describe('probeCustomProvider — HTTP status classification', () => {
  it.each([401, 403])('reports %i as a bad API key', async (status) => {
    const { fetchImpl } = recordingFetch(
      response(status, { error: 'invalid api key' }),
    );

    const result = await probeCustomProvider(
      entry({ helpUrl: 'https://help.example/keys' }),
      'sk-bad',
      { fetchImpl, now: makeClock() },
    );

    expect(result.ok).toBe(false);
    expect(result.failure).toBe('unauthorized');
    expect(result.message).toContain('rejected the API key');
    expect(result.message).toContain('https://help.example/keys');
  });

  it('reports 404 as a wrong base URL, mentioning the /v1 segment trap', async () => {
    const { fetchImpl } = recordingFetch(response(404, 'Not Found'));

    const result = await probeCustomProvider(entry(), 'k', {
      fetchImpl,
      now: makeClock(),
    });

    expect(result.failure).toBe('not-found');
    expect(result.message).toContain('base URL is probably wrong');
    expect(result.message).toContain('/v1');
  });

  it('reports 5xx as an upstream failure', async () => {
    const { fetchImpl } = recordingFetch(response(503, 'upstream down'));

    const result = await probeCustomProvider(entry(), 'k', {
      fetchImpl,
      now: makeClock(),
    });

    expect(result.failure).toBe('server-error');
    expect(result.message).toContain('failing on its own side');
  });

  it('reports a 400 as a rejected probe request', async () => {
    const { fetchImpl } = recordingFetch(
      response(400, { error: 'tools not supported' }),
    );

    const result = await probeCustomProvider(entry(), 'k', {
      fetchImpl,
      now: makeClock(),
    });

    expect(result.failure).toBe('rejected-request');
    expect(result.message).toContain('tool definition');
  });

  it('truncates a very long error body instead of echoing it whole', async () => {
    const { fetchImpl } = recordingFetch(response(400, 'x'.repeat(5000)));

    const result = await probeCustomProvider(entry(), 'k', {
      fetchImpl,
      now: makeClock(),
    });

    expect(result.message.length).toBeLessThan(600);
    expect(result.message).toContain('…');
  });
});

// ---------------------------------------------------------------------------
// Transport classification
// ---------------------------------------------------------------------------

describe('probeCustomProvider — transport classification', () => {
  it.each(['ENOTFOUND', 'EAI_AGAIN'])(
    'reports %s as an unresolvable host',
    async (code) => {
      const { fetchImpl } = recordingFetch(transportError(code));

      const result = await probeCustomProvider(entry(), 'k', {
        fetchImpl,
        now: makeClock(),
      });

      expect(result.failure).toBe('dns');
      expect(result.message).toContain('could not be resolved');
    },
  );

  it.each(['ECONNREFUSED', 'EHOSTUNREACH', 'ETIMEDOUT'])(
    'reports %s as an unreachable host',
    async (code) => {
      const { fetchImpl } = recordingFetch(transportError(code));

      const result = await probeCustomProvider(entry(), 'k', {
        fetchImpl,
        now: makeClock(),
      });

      expect(result.failure).toBe('unreachable');
      expect(result.message).toContain('could not connect');
    },
  );

  it.each([
    'CERT_HAS_EXPIRED',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  ])(
    'reports %s as a TLS failure, not a generic network error',
    async (code) => {
      const { fetchImpl } = recordingFetch(transportError(code));

      const result = await probeCustomProvider(entry(), 'k', {
        fetchImpl,
        now: makeClock(),
      });

      expect(result.failure).toBe('tls');
      expect(result.message).toContain('TLS handshake failed');
      expect(result.message).toContain(code);
    },
  );

  it('reports an aborted request as a timeout with the budget in seconds', async () => {
    const { fetchImpl } = recordingFetch(abortError());

    const result = await probeCustomProvider(entry(), 'k', {
      fetchImpl,
      timeoutMs: 10_000,
      now: makeClock(),
    });

    expect(result.failure).toBe('timeout');
    expect(result.message).toContain('within 10s');
  });

  it('falls back to `unknown` for an unrecognised error', async () => {
    const { fetchImpl } = recordingFetch(new Error('something odd'));

    const result = await probeCustomProvider(entry(), 'k', {
      fetchImpl,
      now: makeClock(),
    });

    expect(result.failure).toBe('unknown');
    expect(result.message).toContain('something odd');
  });
});

// ---------------------------------------------------------------------------
// Guard rails
// ---------------------------------------------------------------------------

describe('probeCustomProvider — pre-flight', () => {
  it('refuses a non-http(s) base URL without touching the network', async () => {
    const { fetchImpl, calls } = recordingFetch(
      response(200, ANTHROPIC_TOOL_OK),
    );

    const result = await probeCustomProvider(
      entry({ baseUrl: 'ftp://gateway.example.com' }),
      'k',
      { fetchImpl, now: makeClock() },
    );

    expect(result.failure).toBe('invalid-base-url');
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

describe('probeCustomProvider — model resolution', () => {
  it('falls back to the first id from the models endpoint when no tier is mapped', async () => {
    const calls: Recorded[] = [];
    const fetchImpl: ProbeFetch = async (url, init) => {
      calls.push({
        url,
        method: init.method,
        headers: init.headers,
        body: init.body === undefined ? undefined : JSON.parse(init.body),
      });
      if (init.method === 'GET') {
        return response(200, { data: [{ id: 'discovered-model' }] });
      }
      return response(200, ANTHROPIC_TOOL_OK);
    };

    const result = await probeCustomProvider(
      entry({ defaultTiers: null }),
      'k',
      { fetchImpl, now: makeClock() },
    );

    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe('https://gateway.example.com/v1/models');
    expect((calls[1].body as { model: string }).model).toBe('discovered-model');
  });

  it('prefers an explicit modelsEndpoint over the derived one', async () => {
    const calls: string[] = [];
    const fetchImpl: ProbeFetch = async (url, init) => {
      calls.push(url);
      if (init.method === 'GET') {
        return response(200, { data: [{ id: 'm' }] });
      }
      return response(200, ANTHROPIC_TOOL_OK);
    };

    await probeCustomProvider(
      entry({
        defaultTiers: null,
        modelsEndpoint: 'https://gateway.example.com/openai/v1/models',
      }),
      'k',
      { fetchImpl, now: makeClock() },
    );

    expect(calls[0]).toBe('https://gateway.example.com/openai/v1/models');
  });

  it('says exactly what to fix when no model can be resolved', async () => {
    const fetchImpl: ProbeFetch = async () => response(404, 'nope');

    const result = await probeCustomProvider(
      entry({ defaultTiers: null }),
      'k',
      { fetchImpl, now: makeClock() },
    );

    expect(result.ok).toBe(false);
    expect(result.failure).toBe('no-model');
    expect(result.message).toContain('Sonnet tier');
  });
});

/** Monotonic fake clock so latency assertions are deterministic. */
function makeClock(): () => number {
  let t = 1_000;
  return () => {
    t += 5;
    return t;
  };
}
