import type { LaneRoutingLogger } from '../lane-routing-logger';
import {
  DECISION_MODEL_CATALOG_ANSWER_TTL_MS,
  DECISION_MODEL_CATALOG_FAILURE_TTL_MS,
  DECISION_MODEL_CATALOG_MAX_IN_FLIGHT,
  DecisionModelCatalog,
  OLLAMA_CLOUD_TAGS_URL,
  type DecisionModelCatalogConfig,
} from './decision-model.catalog';
import type { SystemOneFetch } from './system-one.client';

/*
 * Fixtures use invented model ids and none of them is clef: the list must
 * come from the host, never from a fixed list in code (4.6). Budget cases use
 * real timers and a small budget (the catalog uses `setTimeout` + abort).
 */

const BASE = 'http://127.0.0.1:11434';
const OTHER_BASE = 'http://10.0.0.7:11434';
const SENTINEL = 'sentinel-host-text-9d2e';

type Answer =
  | { readonly status: number; readonly body: string }
  | 'throw'
  /** Rejects when the request signal aborts. */
  | 'hang'
  /** Never settles, ignoring the signal. */
  | 'ignore-abort';

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
}

interface TagFixture {
  readonly name?: string;
  readonly model?: string;
  readonly digest?: string;
  readonly capabilities?: readonly string[];
}

const json = (value: unknown): Answer => ({
  status: 200,
  body: JSON.stringify(value),
});

const tags = (models: readonly TagFixture[]): Answer => json({ models });

const show = (capabilities?: readonly string[]): Answer =>
  json(capabilities === undefined ? { license: 'x' } : { capabilities });

function harness(
  route: (url: string, body: string | undefined) => Answer,
  options: { timeoutMs?: number; baseUrl?: () => string } = {},
) {
  const calls: Call[] = [];
  let clock = 1_000_000;
  let inFlight = 0;
  let maxInFlight = 0;
  const fetch: SystemOneFetch = async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: init?.headers ?? {},
      body: init?.body,
    });
    const answer = route(url, init?.body);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await Promise.resolve();
      if (answer === 'throw') {
        throw new TypeError(`fetch failed ${SENTINEL} ${url}`);
      }
      if (answer === 'ignore-abort') {
        return await new Promise<never>(() => undefined);
      }
      if (answer === 'hang') {
        return await new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error(`aborted ${SENTINEL}`);
            error.name = 'AbortError';
            reject(error);
          });
        });
      }
      return {
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        text: async () => answer.body,
      };
    } finally {
      inFlight -= 1;
    }
  };
  const logger: jest.Mocked<LaneRoutingLogger> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const config: DecisionModelCatalogConfig = {
    ollamaBaseUrl: options.baseUrl ?? (() => BASE),
  };
  const catalog = new DecisionModelCatalog(config, logger, {
    fetch,
    now: () => clock,
    timeoutMs: options.timeoutMs ?? 2000,
  });
  return {
    catalog,
    calls,
    logger,
    advance: (ms: number) => {
      clock += ms;
    },
    maxInFlight: () => maxInFlight,
    showCalls: (model?: string) =>
      calls.filter(
        (call) =>
          call.url.endsWith('/api/show') &&
          (model === undefined || modelOf(call.body) === model),
      ).length,
  };
}

function modelOf(body: string | undefined): string {
  const parsed: unknown = JSON.parse(body ?? '{}');
  return typeof parsed === 'object' &&
    parsed !== null &&
    'model' in parsed &&
    typeof parsed.model === 'string'
    ? parsed.model
    : '';
}

/** Routes `/api/tags` to `tagList()` and `/api/show` by model id. */
function daemon(
  tagList: () => Answer,
  shows: Record<string, Answer>,
): (url: string, body: string | undefined) => Answer {
  return (url, body) => {
    if (url.endsWith('/api/tags')) return tagList();
    return shows[modelOf(body)] ?? { status: 404, body: SENTINEL };
  };
}

function loggedText(logger: jest.Mocked<LaneRoutingLogger>): string {
  return JSON.stringify([
    logger.debug.mock.calls,
    logger.info.mock.calls,
    logger.warn.mock.calls,
    logger.error.mock.calls,
  ]);
}

describe('DecisionModelCatalog — local Ollama (4.2, 4.3, 4.6)', () => {
  const fixture: readonly TagFixture[] = [
    { name: 'alpha:7b', digest: 'd-alpha' },
    { name: 'bravo:3b', digest: 'd-bravo' },
    { model: 'charlie', digest: 'd-charlie' },
  ];

  it('lists only the models whose /api/show capabilities include decision', async () => {
    const h = harness(
      daemon(() => tags(fixture), {
        'alpha:7b': show(['completion', 'decision']),
        'bravo:3b': show(['completion', 'tools']),
        charlie: show(['decision']),
      }),
    );

    const result = await h.catalog.list('ollama');

    expect(result).toEqual({
      models: ['alpha:7b', 'charlie'],
      filter: 'applied',
      undetermined: 0,
    });
    expect(result.models).not.toContain('clef');
    expect(h.calls[0]).toMatchObject({
      url: `${BASE}/api/tags`,
      method: 'GET',
    });
    const showCall = h.calls.find((call) => call.url === `${BASE}/api/show`);
    expect(showCall).toMatchObject({ method: 'POST' });
    expect(h.showCalls()).toBe(3);
  });

  it.each<[string, Answer]>([
    ['no capabilities field (older daemon)', show(undefined)],
    ['an HTTP failure', { status: 500, body: SENTINEL }],
    ['a transport failure', 'throw'],
    ['a body that is not JSON', { status: 200, body: `<html>${SENTINEL}` }],
    ['a malformed answer', json({ capabilities: 'decision' })],
  ])(
    'counts a model as undetermined after %s and does not list it',
    async (_label, answer) => {
      const h = harness(
        daemon(() => tags(fixture), {
          'alpha:7b': show(['decision']),
          'bravo:3b': answer,
          charlie: show(['completion']),
        }),
      );

      const result = await h.catalog.list('ollama');

      expect(result).toEqual({
        models: ['alpha:7b'],
        filter: 'partial',
        undetermined: 1,
      });
      expect(JSON.stringify(result)).not.toContain(SENTINEL);
      expect(loggedText(h.logger)).not.toContain(SENTINEL);
      expect(loggedText(h.logger)).not.toContain(BASE);
    },
  );

  it('counts a malformed tag entry as undetermined without failing the list', async () => {
    const h = harness(
      daemon(
        () =>
          json({
            models: [
              { name: 'alpha:7b' },
              { name: '' },
              { name: 'x'.repeat(129) },
              { digest: 'only-a-digest' },
              'not-an-object',
            ],
          }),
        { 'alpha:7b': show(['decision']) },
      ),
    );

    const result = await h.catalog.list('ollama');

    expect(result).toEqual({
      models: ['alpha:7b'],
      filter: 'partial',
      undetermined: 4,
    });
    expect(h.showCalls()).toBe(1);
  });

  it.each<[string, Answer]>([
    ['a transport failure', 'throw'],
    ['an HTTP failure', { status: 503, body: SENTINEL }],
    ['a body that is not JSON', { status: 200, body: SENTINEL }],
    ['a body without models', json({ items: [] })],
  ])(
    'reports unavailable after %s of /api/tags and never rejects',
    async (_label, answer) => {
      const h = harness(() => answer);

      await expect(h.catalog.list('ollama')).resolves.toEqual({
        models: [],
        filter: 'unavailable',
        undetermined: 0,
      });
      expect(h.showCalls()).toBe(0);
      expect(loggedText(h.logger)).not.toContain(SENTINEL);
    },
  );

  it('reports unavailable when the base URL source throws', async () => {
    const h = harness(() => tags([]), {
      baseUrl: () => {
        throw new Error(SENTINEL);
      },
    });

    await expect(h.catalog.list('ollama')).resolves.toEqual({
      models: [],
      filter: 'unavailable',
      undetermined: 0,
    });
    expect(loggedText(h.logger)).not.toContain(SENTINEL);
  });

  it('applies the filter to an empty daemon', async () => {
    const h = harness(() => tags([]));

    await expect(h.catalog.list('ollama')).resolves.toEqual({
      models: [],
      filter: 'applied',
      undetermined: 0,
    });
  });
});

describe('DecisionModelCatalog — /api/show cache (4.2)', () => {
  it('sends at most one lookup per model while the answer TTL holds', async () => {
    const h = harness(
      daemon(
        () =>
          tags([
            { name: 'alpha:7b', digest: 'a1' },
            { name: 'bravo:3b', digest: 'b1' },
          ]),
        {
          'alpha:7b': show(['decision']),
          'bravo:3b': show(['completion']),
        },
      ),
    );

    for (let open = 0; open < 4; open += 1) {
      await h.catalog.list('ollama');
      h.advance(DECISION_MODEL_CATALOG_ANSWER_TTL_MS / 5);
    }

    expect(h.showCalls('alpha:7b')).toBe(1);
    expect(h.showCalls('bravo:3b')).toBe(1);

    h.advance(DECISION_MODEL_CATALOG_ANSWER_TTL_MS);
    await h.catalog.list('ollama');
    expect(h.showCalls('alpha:7b')).toBe(2);
  });

  it('shares one lookup between concurrent calls', async () => {
    const h = harness(
      daemon(() => tags([{ name: 'alpha:7b' }]), {
        'alpha:7b': show(['decision']),
      }),
    );

    const [first, second] = await Promise.all([
      h.catalog.list('ollama'),
      h.catalog.list('ollama'),
    ]);

    expect(first.models).toEqual(['alpha:7b']);
    expect(second.models).toEqual(['alpha:7b']);
    expect(h.showCalls('alpha:7b')).toBe(1);
  });

  it('keeps a failure for the failure TTL only', async () => {
    let failing = true;
    const h = harness((url) => {
      if (url.endsWith('/api/tags')) return tags([{ name: 'alpha:7b' }]);
      return failing ? { status: 500, body: '' } : show(['decision']);
    });

    await h.catalog.list('ollama');
    failing = false;
    h.advance(DECISION_MODEL_CATALOG_FAILURE_TTL_MS / 2);
    const cached = await h.catalog.list('ollama');
    expect(cached.filter).toBe('partial');
    expect(h.showCalls()).toBe(1);

    h.advance(DECISION_MODEL_CATALOG_FAILURE_TTL_MS);
    const retried = await h.catalog.list('ollama');
    expect(retried).toEqual({
      models: ['alpha:7b'],
      filter: 'applied',
      undetermined: 0,
    });
    expect(h.showCalls()).toBe(2);
    expect(modelOf(h.calls[h.calls.length - 1]?.body)).toBe('alpha:7b');
  });

  it('looks a model up again when its digest changes', async () => {
    let digest = 'a1';
    const h = harness(
      daemon(() => tags([{ name: 'alpha:7b', digest }]), {
        'alpha:7b': show(['decision']),
      }),
    );

    await h.catalog.list('ollama');
    await h.catalog.list('ollama');
    digest = 'a2';
    await h.catalog.list('ollama');

    expect(h.showCalls('alpha:7b')).toBe(2);
  });

  it('prunes models missing from the latest tag list', async () => {
    let listed: TagFixture[] = [
      { name: 'alpha:7b', digest: 'a1' },
      { name: 'bravo:3b', digest: 'b1' },
    ];
    const h = harness(
      daemon(() => tags(listed), {
        'alpha:7b': show(['decision']),
        'bravo:3b': show(['decision']),
      }),
    );

    await h.catalog.list('ollama');
    listed = [{ name: 'alpha:7b', digest: 'a1' }];
    await h.catalog.list('ollama');
    listed = [
      { name: 'alpha:7b', digest: 'a1' },
      { name: 'bravo:3b', digest: 'b1' },
    ];
    await h.catalog.list('ollama');

    expect(h.showCalls('alpha:7b')).toBe(1);
    expect(h.showCalls('bravo:3b')).toBe(2);
  });

  it('clears the cache when the base URL changes', async () => {
    let base = BASE;
    const h = harness(
      daemon(() => tags([{ name: 'alpha:7b', digest: 'a1' }]), {
        'alpha:7b': show(['decision']),
      }),
      { baseUrl: () => base },
    );

    await h.catalog.list('ollama');
    base = OTHER_BASE;
    await h.catalog.list('ollama');
    base = BASE;
    await h.catalog.list('ollama');

    expect(h.calls.map((call) => call.url)).toEqual([
      `${BASE}/api/tags`,
      `${BASE}/api/show`,
      `${OTHER_BASE}/api/tags`,
      `${OTHER_BASE}/api/show`,
      `${BASE}/api/tags`,
      `${BASE}/api/show`,
    ]);
  });
});

describe('DecisionModelCatalog — concurrency and budget', () => {
  it(`keeps at most ${DECISION_MODEL_CATALOG_MAX_IN_FLIGHT} lookups in flight`, async () => {
    const names = Array.from({ length: 13 }, (_, i) => `model-${i}`);
    const h = harness((url) =>
      url.endsWith('/api/tags')
        ? tags(names.map((name) => ({ name })))
        : show(['decision']),
    );

    const result = await h.catalog.list('ollama');

    expect(result.models).toEqual(names);
    expect(h.showCalls()).toBe(names.length);
    // The tag request has finished before any lookup starts.
    expect(h.maxInFlight()).toBe(DECISION_MODEL_CATALOG_MAX_IN_FLIGHT);
  });

  it.each<['hang' | 'ignore-abort']>([['hang'], ['ignore-abort']])(
    'counts lookups unanswered within the budget as undetermined (%s) and retries them next time',
    async (stall) => {
      let stalled = true;
      const h = harness(
        (url, body) => {
          if (url.endsWith('/api/tags')) {
            return tags([{ name: 'alpha:7b' }, { name: 'bravo:3b' }]);
          }
          if (modelOf(body) === 'bravo:3b' && stalled) return stall;
          return show(['decision']);
        },
        { timeoutMs: 30 },
      );

      const first = await h.catalog.list('ollama');
      expect(first).toEqual({
        models: ['alpha:7b'],
        filter: 'partial',
        undetermined: 1,
      });

      stalled = false;
      const second = await h.catalog.list('ollama');
      // The cut-short lookup released its slot and was not cached as a
      // failure, even when the fetch ignored the abort.
      expect(second).toEqual({
        models: ['alpha:7b', 'bravo:3b'],
        filter: 'applied',
        undetermined: 0,
      });
      expect(h.showCalls('bravo:3b')).toBe(2);
    },
  );

  it('reports unavailable when /api/tags exceeds the budget', async () => {
    const h = harness(() => 'ignore-abort', { timeoutMs: 30 });

    await expect(h.catalog.list('ollama')).resolves.toEqual({
      models: [],
      filter: 'unavailable',
      undetermined: 0,
    });
  });
});

describe('DecisionModelCatalog — Ollama Cloud (4.1)', () => {
  it('lists decision-capable cloud tags as canonical cloud ids, with no key', async () => {
    const h = harness(() =>
      tags([
        { name: 'alpha-2', capabilities: ['completion', 'decision'] },
        { name: 'bravo:12b', capabilities: ['decision'] },
        { name: 'charlie:cloud', capabilities: ['decision'] },
        { name: 'delta:8b', capabilities: ['completion'] },
      ]),
    );

    const result = await h.catalog.list('ollama-cloud');

    expect(result).toEqual({
      models: ['alpha-2:cloud', 'bravo:12b-cloud', 'charlie:cloud'],
      filter: 'applied',
      undetermined: 0,
    });
    expect(result.models).not.toContain('clef');
    expect(h.calls).toEqual([
      {
        url: OLLAMA_CLOUD_TAGS_URL,
        method: 'GET',
        headers: {},
        body: undefined,
      },
    ]);
  });

  it('counts a cloud tag without capabilities as undetermined', async () => {
    const h = harness(() =>
      tags([{ name: 'alpha-2', capabilities: ['decision'] }, { name: 'echo' }]),
    );

    await expect(h.catalog.list('ollama-cloud')).resolves.toEqual({
      models: ['alpha-2:cloud'],
      filter: 'partial',
      undetermined: 1,
    });
  });

  it('caches the cloud list for the answer TTL on success only', async () => {
    let up = false;
    const h = harness(() =>
      up ? tags([{ name: 'alpha-2', capabilities: ['decision'] }]) : 'throw',
    );

    expect((await h.catalog.list('ollama-cloud')).filter).toBe('unavailable');
    up = true;
    expect((await h.catalog.list('ollama-cloud')).filter).toBe('applied');
    expect(h.calls).toHaveLength(2);

    h.advance(DECISION_MODEL_CATALOG_ANSWER_TTL_MS - 1);
    await h.catalog.list('ollama-cloud');
    expect(h.calls).toHaveLength(2);

    h.advance(2);
    await h.catalog.list('ollama-cloud');
    expect(h.calls).toHaveLength(3);
    expect(loggedText(h.logger)).not.toContain(SENTINEL);
  });
});
