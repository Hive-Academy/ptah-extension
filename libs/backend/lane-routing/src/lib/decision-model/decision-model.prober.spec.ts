import type { LaneRoutingLogger } from '../lane-routing-logger';
import { DECISION_MODEL_DETAIL } from './decision-model.detail';
import {
  DecisionEndpointProber,
  type DecisionProbeRequest,
} from './decision-model.prober';
import {
  DECISION_MODEL_PROBE_TIMEOUT_MS,
  SYSTEM_ONE_CONTROL_PATH,
} from './decision-model.types';
import { SYSTEM_ONE_PATH, type SystemOneFetch } from './system-one.client';

/*
 * AbortSignal.timeout runs on Node's internal timers, which Jest's fake
 * timers do not drive; the budget case uses real timers and a small budget.
 */

const VERSION_PATH = '/api/version';
const GO_NOT_FOUND = { status: 404, body: '404 page not found' };
const KEY = 'sentinel-key-4f1c';

interface FakeAnswer {
  readonly status: number;
  readonly body: string;
}

interface FakeCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
  readonly signal: AbortSignal | undefined;
}

/** Answers per URL path; any other path gets the Go default not-found. */
function fakeFetch(answers: Record<string, FakeAnswer | 'throw'>): {
  fetch: SystemOneFetch;
  calls: FakeCall[];
} {
  const calls: FakeCall[] = [];
  const fetch: SystemOneFetch = async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: init?.headers ?? {},
      body: init?.body,
      signal: init?.signal,
    });
    const answer = answers[new URL(url).pathname.replace(/^\/gw/, '')];
    if (answer === 'throw') {
      throw new TypeError(
        'Request cannot be constructed from a URL that includes credentials: http://user:pw@10.0.0.9/v1/systemone',
      );
    }
    const chosen = answer ?? GO_NOT_FOUND;
    return {
      ok: chosen.status >= 200 && chosen.status < 300,
      status: chosen.status,
      text: async () => chosen.body,
    };
  };
  return { fetch, calls };
}

function recordingLogger(): {
  logger: LaneRoutingLogger;
  entries: Array<{ message: string; meta: Record<string, unknown> }>;
} {
  const entries: Array<{ message: string; meta: Record<string, unknown> }> = [];
  const record = (message: string, meta?: Record<string, unknown>): void => {
    entries.push({ message, meta: meta ?? {} });
  };
  return {
    logger: { debug: record, info: record, warn: record, error: record },
    entries,
  };
}

function prober(
  fetch: SystemOneFetch,
  timeoutMs = DECISION_MODEL_PROBE_TIMEOUT_MS,
): {
  prober: DecisionEndpointProber;
  entries: Array<{ message: string; meta: Record<string, unknown> }>;
} {
  const { logger, entries } = recordingLogger();
  return {
    prober: new DecisionEndpointProber(logger, { fetch, timeoutMs }),
    entries,
  };
}

const ROUTE_OK = { status: 400, body: '{"error":"model is required"}' };
const VERSION_OK = { status: 200, body: '{"version":"0.41.0"}' };

const DAEMON: DecisionProbeRequest = {
  mode: 'daemon',
  baseUrl: 'http://127.0.0.1:11434',
  model: 'nimble',
};

const ENDPOINT: DecisionProbeRequest = {
  mode: 'endpoint',
  baseUrl: 'https://gateway.example.com/gw',
  model: 'gpt-oss:120b',
  apiKey: KEY,
};

describe('DecisionEndpointProber, daemon mode (unchanged behaviour)', () => {
  it('checks the version, then posts {} to the route and the control path', async () => {
    const { fetch, calls } = fakeFetch({
      [VERSION_PATH]: VERSION_OK,
      [SYSTEM_ONE_PATH]: ROUTE_OK,
    });

    const result = await prober(fetch).prober.probe(DAEMON);

    expect(result).toEqual({ outcome: 'ready', detail: null });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET http://127.0.0.1:11434/api/version',
      'POST http://127.0.0.1:11434/v1/systemone',
      `POST http://127.0.0.1:11434${SYSTEM_ONE_CONTROL_PATH}`,
    ]);
    for (const call of calls.slice(1)) {
      expect(call.body).toBe('{}');
      expect(call.headers).toEqual({ 'content-type': 'application/json' });
    }
  });

  it('never sends a key in daemon mode, even when one is passed', async () => {
    const { fetch, calls } = fakeFetch({
      [VERSION_PATH]: VERSION_OK,
      [SYSTEM_ONE_PATH]: ROUTE_OK,
    });

    await prober(fetch).prober.probe({ ...DAEMON, apiKey: KEY });

    expect(JSON.stringify(calls)).not.toContain(KEY);
  });

  it('keeps the 0.35.0 floor', async () => {
    const { fetch, calls } = fakeFetch({
      [VERSION_PATH]: { status: 200, body: '{"version":"0.34.9"}' },
    });

    const result = await prober(fetch).prober.probe(DAEMON);

    expect(result).toEqual({
      outcome: 'unsupported-endpoint',
      detail: 'Ollama 0.34.9 < 0.35.0',
    });
    expect(calls).toHaveLength(1);
  });

  it('keeps the 0.40.0 floor for laya models', async () => {
    const { fetch } = fakeFetch({
      [VERSION_PATH]: { status: 200, body: '{"version":"0.39.0"}' },
    });

    const result = await prober(fetch).prober.probe({
      ...DAEMON,
      model: 'laya-2',
    });

    expect(result).toEqual({
      outcome: 'unsupported-endpoint',
      detail: 'Ollama 0.39.0 < 0.40.0',
    });
  });

  it('a control answer equal to the route answer is unsupported', async () => {
    const { fetch } = fakeFetch({ [VERSION_PATH]: VERSION_OK });

    const result = await prober(fetch).prober.probe(DAEMON);

    expect(result.outcome).toBe('unsupported-endpoint');
  });
});

describe('DecisionEndpointProber, endpoint mode', () => {
  it('skips /api/version and sends the Bearer key on both POSTs, under the base path', async () => {
    const { fetch, calls } = fakeFetch({ [SYSTEM_ONE_PATH]: ROUTE_OK });

    const result = await prober(fetch).prober.probe(ENDPOINT);

    expect(result).toEqual({ outcome: 'ready', detail: null });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST https://gateway.example.com/gw/v1/systemone',
      `POST https://gateway.example.com/gw${SYSTEM_ONE_CONTROL_PATH}`,
    ]);
    for (const call of calls) {
      expect(call.headers).toEqual({
        'content-type': 'application/json',
        authorization: `Bearer ${KEY}`,
      });
      expect(call.body).toBe('{}');
    }
  });

  it('sends no authorization header without a key', async () => {
    const { fetch, calls } = fakeFetch({ [SYSTEM_ONE_PATH]: ROUTE_OK });

    await prober(fetch).prober.probe({
      ...ENDPOINT,
      baseUrl: 'http://192.168.1.20:11434',
      apiKey: undefined,
    });

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.headers).toEqual({ 'content-type': 'application/json' });
    }
  });

  it('401 with a key reads as a refused key', async () => {
    const { fetch } = fakeFetch({
      [SYSTEM_ONE_PATH]: { status: 401, body: '{"error":"unauthorized"}' },
    });

    expect(await prober(fetch).prober.probe(ENDPOINT)).toEqual({
      outcome: 'auth',
      detail: DECISION_MODEL_DETAIL.keyRefused,
    });
  });

  it('403 without a key reads as a required key', async () => {
    const { fetch } = fakeFetch({
      [SYSTEM_ONE_PATH]: { status: 403, body: 'forbidden' },
    });

    expect(
      await prober(fetch).prober.probe({ ...ENDPOINT, apiKey: undefined }),
    ).toEqual({ outcome: 'auth', detail: DECISION_MODEL_DETAIL.keyRequired });
  });

  it('refuses to send a key over plain http to a non-loopback host, with no request', async () => {
    const { fetch, calls } = fakeFetch({});

    const result = await prober(fetch).prober.probe({
      ...ENDPOINT,
      baseUrl: 'http://gateway.example.com',
    });

    expect(result).toEqual({
      outcome: 'auth',
      detail: DECISION_MODEL_DETAIL.keyNeedsHttps,
    });
    expect(calls).toHaveLength(0);
  });

  it('sends a key over plain http to a loopback host', async () => {
    const { fetch, calls } = fakeFetch({ [SYSTEM_ONE_PATH]: ROUTE_OK });

    await prober(fetch).prober.probe({
      ...ENDPOINT,
      baseUrl: 'http://127.0.0.2:8080',
    });

    expect(calls[0]?.headers['authorization']).toBe(`Bearer ${KEY}`);
  });

  it('a route answer equal to the control is unsupported', async () => {
    const { fetch } = fakeFetch({});

    expect((await prober(fetch).prober.probe(ENDPOINT)).outcome).toBe(
      'unsupported-endpoint',
    );
  });
});

describe('DecisionEndpointProber, failures and logs', () => {
  it('an unparseable base url is unreachable with no request', async () => {
    const { fetch, calls } = fakeFetch({});

    expect(
      await prober(fetch).prober.probe({ ...ENDPOINT, baseUrl: 'not a url' }),
    ).toEqual({
      outcome: 'unreachable',
      detail: 'base url is not a valid absolute url',
    });
    expect(calls).toHaveLength(0);
  });

  it('shares one abort signal across every request of a probe', async () => {
    const { fetch, calls } = fakeFetch({
      [VERSION_PATH]: VERSION_OK,
      [SYSTEM_ONE_PATH]: ROUTE_OK,
    });

    await prober(fetch).prober.probe(DAEMON);

    expect(calls).toHaveLength(3);
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(calls.every((c) => c.signal === calls[0]?.signal)).toBe(true);
  });

  it('the budget expiring reads as a timeout with fixed text', async () => {
    const hanging: SystemOneFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('aborted')),
        );
      });
    const { prober: p, entries } = prober(hanging, 20);

    const result = await p.probe(ENDPOINT);

    expect(result).toEqual({
      outcome: 'unreachable',
      detail: DECISION_MODEL_DETAIL.timedOut,
    });
    expect(entries).toContainEqual({
      message: '[lane-routing] decision model probe request failed',
      meta: expect.objectContaining({ timedOut: true, timeoutMs: 20 }),
    });
  });

  it('never rejects and never logs a key, a URL with userinfo or the host', async () => {
    const { fetch } = fakeFetch({
      [SYSTEM_ONE_PATH]: 'throw',
      [SYSTEM_ONE_CONTROL_PATH]: 'throw',
    });
    const { prober: p, entries } = prober(fetch);

    const result = await p.probe(ENDPOINT);

    expect(result).toEqual({
      outcome: 'unreachable',
      detail: DECISION_MODEL_DETAIL.unreachable,
    });
    const logged = JSON.stringify(entries);
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain('pw@');
    expect(logged).not.toContain('10.0.0.9');
    expect(logged).not.toContain('gateway.example.com');
    expect(logged).not.toContain('credentials');
    expect(entries).toContainEqual({
      message: '[lane-routing] decision model probe request failed',
      meta: {
        method: 'POST',
        timedOut: false,
        timeoutMs: DECISION_MODEL_PROBE_TIMEOUT_MS,
        errorName: 'TypeError',
      },
    });
  });

  it('a rejection that echoes the key without a URL logs only the error name (review defect 1)', async () => {
    const calls: string[] = [];
    const echoing: SystemOneFetch = async (url, init) => {
      calls.push(url);
      throw new Error(
        `upstream said: ${init?.headers?.['authorization'] ?? ''} rejected`,
      );
    };
    const { prober: p, entries } = prober(echoing);

    const result = await p.probe(ENDPOINT);

    expect(result).toEqual({
      outcome: 'unreachable',
      detail: DECISION_MODEL_DETAIL.unreachable,
    });
    expect(calls).toEqual([
      `https://gateway.example.com/gw${SYSTEM_ONE_PATH}`,
      `https://gateway.example.com/gw${SYSTEM_ONE_CONTROL_PATH}`,
    ]);
    const logged = JSON.stringify(entries);
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain('upstream said');
    expect(
      entries.filter(
        (e) =>
          e.message === '[lane-routing] decision model probe request failed',
      ),
    ).toEqual([
      expect.objectContaining({
        meta: expect.objectContaining({ errorName: 'Error' }),
      }),
      expect.objectContaining({
        meta: expect.objectContaining({ errorName: 'Error' }),
      }),
    ]);
  });

  it('a body read that rejects with the key logs only the error name', async () => {
    const reading: SystemOneFetch = async () => ({
      ok: false,
      status: 400,
      text: async () => {
        throw new RangeError(`bad header Bearer ${KEY}`);
      },
    });
    const { prober: p, entries } = prober(reading);

    const result = await p.probe(ENDPOINT);

    expect(result).toEqual({
      outcome: 'unreachable',
      detail: DECISION_MODEL_DETAIL.unreachable,
    });
    expect(JSON.stringify(entries)).not.toContain(KEY);
    expect(entries).toContainEqual({
      message: '[lane-routing] decision model probe request failed',
      meta: expect.objectContaining({ errorName: 'RangeError' }),
    });
  });
});
