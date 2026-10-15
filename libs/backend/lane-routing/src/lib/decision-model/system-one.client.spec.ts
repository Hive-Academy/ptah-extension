import type { LaneRoutingLogger } from '../lane-routing-logger';
import { buildDecisionPayload } from './decision-payload';
import {
  SYSTEM_ONE_MAX_REQUEST_BYTES,
  SYSTEM_ONE_PATH,
  SYSTEM_ONE_TIMEOUT_MS,
  SystemOneClient,
  type SystemOneCallFailure,
  type SystemOneCallResult,
  type SystemOneFetch,
} from './system-one.client';
import type { SystemOneResult } from './system-one.schema';

/*
 * AbortSignal.timeout runs on Node's internal timers, which Jest's fake
 * timers do not drive (the repo pinned this for OAuth discovery in
 * cli-agent-runtime/src/lib/mcp-directory/oauth/mcp-oauth-metadata.spec.ts).
 * The timeout spec below therefore uses real timers with a small bound
 * through the client's `timeoutMs` option.
 */

const payload = buildDecisionPayload({
  request: 'Fix the flaky auth e2e test',
  questions: [
    {
      kind: 'lane-choice',
      phaseId: 'implement',
      instructions: 'Which executor should implement?',
      options: [
        {
          laneId: 'codex',
          family: 'openai',
          model: 'gpt-5',
          limitState: 'unknown',
          score: 80,
        },
        {
          laneId: 'glm',
          family: 'zhipu',
          model: 'glm-5.3',
          limitState: 'unknown',
          score: 75,
        },
      ],
    },
  ],
  outcomeFigures: [],
});

const successBody = {
  model: 'nimble',
  answers: {
    implement: {
      type: 'choice',
      choice: 'o1',
      probabilities: { o1: 0.81, o2: 0.19 },
      confidence: 0.75,
    },
  },
  usage: { input_tokens: 1180, output_tokens: 4 },
};

type CapturedInit = NonNullable<Parameters<SystemOneFetch>[1]>;

function recordingFetch(
  status: number,
  body: unknown,
): {
  calls: Array<{ url: string; init: CapturedInit }>;
  fetch: SystemOneFetch;
} {
  const calls: Array<{ url: string; init: CapturedInit }> = [];
  const fetch: SystemOneFetch = (url, init) => {
    calls.push({ url, init: init ?? {} });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: async () =>
        typeof body === 'string' ? body : JSON.stringify(body),
    });
  };
  return { calls, fetch };
}

/** A fetch that never settles until its abort signal fires. */
function hangingFetch(): SystemOneFetch {
  return (_url, init) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error('test fetch requires an abort signal'));
        return;
      }
      signal.addEventListener(
        'abort',
        () => {
          reject(signal.reason);
        },
        { once: true },
      );
    });
}

function requireSuccess(result: SystemOneCallResult): SystemOneResult {
  if (result.ok) {
    return result.result;
  }
  throw new Error('expected a success result');
}

function requireFailure(result: SystemOneCallResult): SystemOneCallFailure {
  if (!result.ok) {
    return result;
  }
  throw new Error('expected a failure result');
}

describe('SystemOneClient', () => {
  it('pins the client constants', () => {
    expect(SYSTEM_ONE_PATH).toBe('/v1/systemone');
    expect(SYSTEM_ONE_TIMEOUT_MS).toBe(3000);
    expect(SYSTEM_ONE_MAX_REQUEST_BYTES).toBe(65536);
  });

  it('posts the decision payload to the provider path and returns the answers', async () => {
    const { calls, fetch } = recordingFetch(200, successBody);
    const client = new SystemOneClient(
      { baseUrl: 'http://127.0.0.1:11434', model: 'nimble', apiKey: 'k1' },
      { fetch },
    );

    const result = requireSuccess(await client.decide(payload));

    expect(result.model).toBe('nimble');
    expect(result.answers.implement.choice).toBe('o1');
    expect(result.answers.implement.confidence).toBe(0.75);
    expect(result.usage?.input_tokens).toBe(1180);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe('http://127.0.0.1:11434/v1/systemone');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer k1',
    });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    const sent: unknown = JSON.parse(calls[0].init.body ?? 'null');
    expect(sent).toEqual({
      model: 'nimble',
      state: payload.state,
      questions: payload.questions,
    });
  });

  it('sends no authorization header when the key is absent', async () => {
    const { calls, fetch } = recordingFetch(200, successBody);
    const client = new SystemOneClient(
      { baseUrl: 'http://127.0.0.1:11434', model: 'nimble' },
      { fetch },
    );

    await client.decide(payload);

    expect(calls[0].init.headers).toEqual({
      'content-type': 'application/json',
    });
  });

  it('builds the url from a base with a trailing slash', async () => {
    const { calls, fetch } = recordingFetch(200, successBody);
    const client = new SystemOneClient(
      { baseUrl: 'https://api.typesafe.ai/', model: 'jev-1.13', apiKey: 'k1' },
      { fetch },
    );

    await client.decide(payload);

    expect(calls[0].url).toBe('https://api.typesafe.ai/v1/systemone');
  });

  it('flags a plain-text 404 as not-found with the body text', async () => {
    const { fetch } = recordingFetch(404, '404 page not found');
    const client = new SystemOneClient(
      { baseUrl: 'http://127.0.0.1:11434', model: 'nimble' },
      { fetch },
    );

    const failure = requireFailure(await client.decide(payload));

    expect(failure).toEqual({
      ok: false,
      cause: 'provider-error',
      detail: '404 page not found',
      notFound: true,
    });
  });

  it('reads the error field of a json 404 body and cuts the detail to 200 characters', async () => {
    const { fetch } = recordingFetch(404, {
      error: `model "qwen3:0.6b" not found ${'x'.repeat(300)}`,
    });
    const client = new SystemOneClient(
      { baseUrl: 'http://127.0.0.1:11434', model: 'nimble' },
      { fetch },
    );

    const failure = requireFailure(await client.decide(payload));

    expect(failure.cause).toBe('provider-error');
    expect(failure.notFound).toBe(true);
    const prefix = 'model "qwen3:0.6b" not found ';
    expect(failure.detail).toBe(`${prefix}${'x'.repeat(200 - prefix.length)}`);
    expect(failure.detail.length).toBe(200);
  });

  it('flags a 405 as not-found but never a 500', async () => {
    const methodNotAllowed = new SystemOneClient(
      { baseUrl: 'http://127.0.0.1:11434', model: 'nimble' },
      { fetch: recordingFetch(405, { error: 'method not allowed' }).fetch },
    );
    const serverError = new SystemOneClient(
      { baseUrl: 'http://127.0.0.1:11434', model: 'nimble' },
      { fetch: recordingFetch(500, 'internal error').fetch },
    );

    const notFound = requireFailure(await methodNotAllowed.decide(payload));
    const other = requireFailure(await serverError.decide(payload));

    expect(notFound.cause).toBe('provider-error');
    expect(notFound.notFound).toBe(true);
    expect(other.cause).toBe('provider-error');
    expect(other.notFound).toBe(false);
  });

  it('classifies 401 and 403 as auth without the not-found flag', async () => {
    const unauthorized = new SystemOneClient(
      { baseUrl: 'https://api.typesafe.ai', model: 'jev-1.13', apiKey: 'bad' },
      { fetch: recordingFetch(401, '').fetch },
    );
    const forbidden = new SystemOneClient(
      { baseUrl: 'https://api.typesafe.ai', model: 'jev-1.13', apiKey: 'bad' },
      { fetch: recordingFetch(403, '').fetch },
    );

    const unauthenticated = requireFailure(await unauthorized.decide(payload));
    const rejected = requireFailure(await forbidden.decide(payload));

    expect(unauthenticated).toEqual({
      ok: false,
      cause: 'auth',
      detail: 'http 401',
      notFound: false,
    });
    expect(rejected.cause).toBe('auth');
    expect(rejected.notFound).toBe(false);
  });

  it('classifies a transport rejection as unreachable', async () => {
    const fetch: SystemOneFetch = () =>
      Promise.reject(new TypeError('fetch failed'));
    const client = new SystemOneClient(
      { baseUrl: 'http://127.0.0.1:11434', model: 'nimble' },
      { fetch },
    );

    const failure = requireFailure(await client.decide(payload));

    expect(failure).toEqual({
      ok: false,
      cause: 'unreachable',
      detail: 'fetch failed',
      notFound: false,
    });
  });

  it('classifies an aborted request as a timeout', async () => {
    const client = new SystemOneClient(
      { baseUrl: 'http://127.0.0.1:11434', model: 'nimble', timeoutMs: 20 },
      { fetch: hangingFetch() },
    );

    const failure = requireFailure(await client.decide(payload));

    expect(failure).toEqual({
      ok: false,
      cause: 'timeout',
      detail: 'request timed out after 20 ms',
      notFound: false,
    });
  });

  it('rejects a non-json body as bad output', async () => {
    const { fetch } = recordingFetch(200, 'not json');
    const client = new SystemOneClient(
      { baseUrl: 'http://127.0.0.1:11434', model: 'nimble' },
      { fetch },
    );

    const failure = requireFailure(await client.decide(payload));

    expect(failure).toEqual({
      ok: false,
      cause: 'bad-output',
      detail: 'response body is not valid JSON',
      notFound: false,
    });
  });

  it('rejects an answer-less body as bad output', async () => {
    const { fetch } = recordingFetch(200, { model: 'nimble' });
    const client = new SystemOneClient(
      { baseUrl: 'http://127.0.0.1:11434', model: 'nimble' },
      { fetch },
    );

    const failure = requireFailure(await client.decide(payload));

    expect(failure.cause).toBe('bad-output');
    expect(failure.detail).toContain('answers');
  });

  it('accepts extra top-level fields in the response', async () => {
    const { fetch } = recordingFetch(200, { id: 'abc', ...successBody });
    const client = new SystemOneClient(
      { baseUrl: 'http://127.0.0.1:11434', model: 'nimble' },
      { fetch },
    );

    const result = requireSuccess(await client.decide(payload));

    expect(result.answers.implement.choice).toBe('o1');
  });

  it('accepts a minimal choice answer without probabilities, confidence or usage', async () => {
    const { fetch } = recordingFetch(200, {
      model: 'nimble',
      answers: { implement: { type: 'choice', choice: 'o2' } },
    });
    const client = new SystemOneClient(
      { baseUrl: 'http://127.0.0.1:11434', model: 'nimble' },
      { fetch },
    );

    const result = requireSuccess(await client.decide(payload));

    expect(result.answers.implement.choice).toBe('o2');
    expect(result.usage).toBeUndefined();
  });

  it('refuses to send a body over the size limit', async () => {
    const { calls, fetch } = recordingFetch(200, successBody);
    const client = new SystemOneClient(
      { baseUrl: 'http://127.0.0.1:11434', model: 'nimble' },
      { fetch },
    );
    const huge = buildDecisionPayload({
      request: 'Too big',
      questions: [
        {
          kind: 'fixed-criteria',
          phaseId: 'task_type',
          instructions: 'Pick',
          criteria: { o1: 'y'.repeat(70_000) },
        },
      ],
      outcomeFigures: [],
    });

    const failure = requireFailure(await client.decide(huge));

    expect(failure.cause).toBe('payload-too-large');
    expect(failure.detail).toContain('exceeds 65536 bytes');
    expect(failure.notFound).toBe(false);
    expect(calls.length).toBe(0);
  });

  it('classifies an invalid base url as unreachable before any request', async () => {
    const { calls, fetch } = recordingFetch(200, successBody);
    const client = new SystemOneClient(
      { baseUrl: 'not a url', model: 'nimble' },
      { fetch },
    );

    const failure = requireFailure(await client.decide(payload));

    expect(failure).toEqual({
      ok: false,
      cause: 'unreachable',
      detail: 'base url is not a valid absolute url',
      notFound: false,
    });
    expect(calls.length).toBe(0);
  });

  it('never writes the api key into a log entry', async () => {
    const entries: Array<{ message: string; meta: Record<string, unknown> }> =
      [];
    const record = (message: string, meta?: Record<string, unknown>): void => {
      entries.push({ message, meta: meta ?? {} });
    };
    const logger: LaneRoutingLogger = {
      debug: record,
      info: record,
      warn: record,
      error: record,
    };
    const { fetch } = recordingFetch(500, 'internal error');
    const client = new SystemOneClient(
      {
        baseUrl: 'https://api.typesafe.ai',
        model: 'jev-1.13',
        apiKey: 'secret-key-1',
      },
      { fetch, logger },
    );

    await client.decide(payload);

    expect(entries.length).toBeGreaterThan(0);
    expect(JSON.stringify(entries)).not.toContain('secret-key-1');
  });
});
