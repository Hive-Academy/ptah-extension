import {
  createMockSecretStorage,
  createMockStateStorage,
  createMockWorkspaceProvider,
  type MockSecretStorage,
  type MockStateStorage,
  type MockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import type { LaneRoutingLogger } from '../lane-routing-logger';
import { DECISION_REQUEST_TIMEOUT_REMOTE_MS } from '../routing-constants';
import { DecisionModelConfig } from './decision-model.config';
import {
  DECISION_MODEL_JEV_SECRET_KEY,
  DECISION_MODEL_RECHECK_WINDOW_MS,
  DECISION_MODEL_UNSUPPORTED_STORAGE_KEY,
  JEV_BASE_URL,
  SYSTEM_ONE_CONTROL_PATH,
  type DecisionModelUnsupportedMark,
} from './decision-model.types';
import type { StructuredDecisionCompleter } from './structured-decision.port';
import { SYSTEM_ONE_PATH, type SystemOneFetch } from './system-one.client';

/*
 * AbortSignal.timeout runs on Node's internal timers, which Jest's fake
 * timers do not drive (same note as system-one.client.spec.ts). The clock
 * seam drives the 60 s re-check window; the timeout case uses a small real
 * budget through `probeTimeoutMs`.
 */

const BASE = 'http://127.0.0.1:11434';
const VERSION_PATH = '/api/version';
const KEY = DECISION_MODEL_UNSUPPORTED_STORAGE_KEY;
const SELECTION_KEY = 'ptah.agentOrchestration.decisionModel';
const BASE_URL_KEY = 'ptah.provider.ollama.baseUrl';
const OLLAMA = { kind: 'ollama', model: 'nimble' } as const;
const VERSION_OK = { status: 200, body: '{"version":"0.35.2"}' };
/** Go `net/http` default answer for a path no handler serves. */
const GO_NOT_FOUND = { status: 404, body: '404 page not found' };
const MODEL_REQUIRED = { status: 400, body: '{"error":"model is required"}' };
const LIVE_MODEL_NOT_FOUND = 'model "nimble" not found';

interface FakeAnswer {
  readonly status: number;
  readonly body: string;
}

type FakeRoute = FakeAnswer | 'network-error';

interface FakeCall {
  readonly method: string;
  readonly path: string;
  readonly body: string | undefined;
}

interface FakeServer {
  readonly fetch: SystemOneFetch;
  readonly calls: FakeCall[];
  count(path: string): number;
}

/** Answers per path; any other path gets the Go default not-found answer. */
function fakeServer(routes: Record<string, FakeRoute>): FakeServer {
  const calls: FakeCall[] = [];
  const fetchImpl: SystemOneFetch = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ method: init?.method ?? 'GET', path, body: init?.body });
    const route = routes[path] ?? GO_NOT_FOUND;
    if (route === 'network-error') {
      throw new TypeError('fetch failed');
    }
    return {
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      text: async () => route.body,
    };
  };
  return {
    fetch: fetchImpl,
    calls,
    count: (path) => calls.filter((call) => call.path === path).length,
  };
}

function fakeLogger(): jest.Mocked<LaneRoutingLogger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

interface HarnessOptions {
  readonly selection?: unknown;
  readonly baseUrl?: string;
  readonly routes?: Record<string, FakeRoute>;
  readonly fetch?: SystemOneFetch;
  readonly storage?: MockStateStorage;
  readonly secrets?: Record<string, string>;
  readonly structured?: StructuredDecisionCompleter;
  readonly probeTimeoutMs?: number;
}

interface Harness {
  readonly config: DecisionModelConfig;
  readonly server: FakeServer;
  readonly storage: MockStateStorage;
  readonly secrets: MockSecretStorage;
  readonly workspace: MockWorkspaceProvider;
  readonly logger: jest.Mocked<LaneRoutingLogger>;
  readonly clock: { now: number };
}

function harness(options: HarnessOptions = {}): Harness {
  const seed: Record<string, unknown> = {};
  if (options.selection !== undefined) {
    seed[SELECTION_KEY] = options.selection;
  }
  if (options.baseUrl !== undefined) {
    seed[BASE_URL_KEY] = options.baseUrl;
  }
  const workspace = createMockWorkspaceProvider({ config: seed });
  const secrets = createMockSecretStorage({ seed: options.secrets ?? {} });
  const storage = options.storage ?? createMockStateStorage();
  const logger = fakeLogger();
  const server = fakeServer(options.routes ?? {});
  const clock = { now: 1_000 };
  const config = new DecisionModelConfig(
    workspace,
    secrets,
    storage,
    logger,
    options.structured,
    {
      fetch: options.fetch ?? server.fetch,
      now: () => clock.now,
      probeTimeoutMs: options.probeTimeoutMs,
    },
  );
  return { config, server, storage, secrets, workspace, logger, clock };
}

/** A new instance over the same settings and storage: an application restart. */
function restart(
  previous: Harness,
  fetchImpl: SystemOneFetch,
): DecisionModelConfig {
  return new DecisionModelConfig(
    previous.workspace,
    previous.secrets,
    previous.storage,
    fakeLogger(),
    undefined,
    { fetch: fetchImpl, now: () => previous.clock.now },
  );
}

const neverCalled: SystemOneFetch = async (url) => {
  throw new Error(`unexpected request to ${url}`);
};

function unsupportedMark(
  overrides: Partial<DecisionModelUnsupportedMark> = {},
): DecisionModelUnsupportedMark {
  return {
    selection: OLLAMA,
    baseUrl: BASE,
    detail: 'endpoint does not serve /v1/systemone',
    at: 500,
    ...overrides,
  };
}

describe('DecisionModelConfig status probe (route discriminator)', () => {
  it('route 400 differing from the control 404 → ready, both POSTs send {}', async () => {
    const h = harness({
      selection: OLLAMA,
      routes: { [VERSION_PATH]: VERSION_OK, [SYSTEM_ONE_PATH]: MODEL_REQUIRED },
    });

    const status = await h.config.getStatus();

    expect(status).toEqual({
      selection: OLLAMA,
      locality: 'local',
      reportsConfidence: true,
      state: 'ready',
      detail: null,
    });
    const posts = h.server.calls.filter((call) => call.method === 'POST');
    expect(posts.map((call) => call.path).sort()).toEqual(
      [SYSTEM_ONE_CONTROL_PATH, SYSTEM_ONE_PATH].sort(),
    );
    expect(posts.every((call) => call.body === '{}')).toBe(true);
    expect(h.storage.update).not.toHaveBeenCalled();
  });

  it('route 404 differing from the control → ready, detail "route answered 404"', async () => {
    const h = harness({
      selection: OLLAMA,
      routes: {
        [VERSION_PATH]: VERSION_OK,
        [SYSTEM_ONE_PATH]: {
          status: 404,
          body: `{"error":"${LIVE_MODEL_NOT_FOUND.replace(/"/g, '\\"')}"}`,
        },
      },
    });

    const status = await h.config.getStatus();

    expect(status.state).toBe('ready');
    expect(status.detail).toBe('route answered 404');
  });

  it('route answer equal to the control (both 404 page not found) → unsupported and marked', async () => {
    const h = harness({
      selection: OLLAMA,
      routes: { [VERSION_PATH]: VERSION_OK },
    });

    const status = await h.config.getStatus();

    expect(status.state).toBe('unsupported-endpoint');
    expect(status.detail).toBe('endpoint does not serve /v1/systemone');
    expect(h.storage.__state.entries.get(KEY)).toEqual(
      unsupportedMark({ at: 1_000 }),
    );
  });

  it('masks the echoed request path and compares JSON by value', async () => {
    const h = harness({
      selection: OLLAMA,
      routes: {
        [VERSION_PATH]: VERSION_OK,
        [SYSTEM_ONE_PATH]: {
          status: 404,
          body: `{"path":"${SYSTEM_ONE_PATH}","error":"not found"}`,
        },
        [SYSTEM_ONE_CONTROL_PATH]: {
          status: 404,
          body: ` {"error":"not found","path":"${SYSTEM_ONE_CONTROL_PATH}"} `,
        },
      },
    });

    expect((await h.config.getStatus()).state).toBe('unsupported-endpoint');
  });

  it('control request failing while the route answered 404 → unsupported (ambiguous)', async () => {
    const h = harness({
      selection: OLLAMA,
      routes: {
        [VERSION_PATH]: VERSION_OK,
        [SYSTEM_ONE_PATH]: { status: 404, body: '{"error":"not found"}' },
        [SYSTEM_ONE_CONTROL_PATH]: 'network-error',
      },
    });

    const status = await h.config.getStatus();

    expect(status.state).toBe('unsupported-endpoint');
    expect(status.detail).toContain(
      'control request failed: The model endpoint could not be reached.',
    );
    expect(status.detail).not.toContain('fetch failed');
  });

  it('control request failing while the route answered 400 → ready', async () => {
    const h = harness({
      selection: OLLAMA,
      routes: {
        [VERSION_PATH]: VERSION_OK,
        [SYSTEM_ONE_PATH]: MODEL_REQUIRED,
        [SYSTEM_ONE_CONTROL_PATH]: 'network-error',
      },
    });

    expect((await h.config.getStatus()).state).toBe('ready');
  });

  it.each([
    [
      'network error',
      'network-error' as const,
      'unreachable',
      'The model endpoint could not be reached.',
    ],
    [
      '401',
      { status: 401, body: '' },
      'no-credential',
      'route answered http 401',
    ],
    [
      '503',
      { status: 503, body: 'busy' },
      'unreachable',
      'route answered http 503',
    ],
  ])(
    'route %s is not route evidence → %s, no mark',
    async (_label, route, state, detail) => {
      const h = harness({
        selection: OLLAMA,
        routes: { [VERSION_PATH]: VERSION_OK, [SYSTEM_ONE_PATH]: route },
      });

      const status = await h.config.getStatus();

      expect(status.state).toBe(state);
      expect(status.detail).toBe(detail);
      expect(h.storage.update).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['nimble', '0.34.2', 'Ollama 0.34.2 < 0.35.0'],
    ['laya', '0.38.0', 'Ollama 0.38.0 < 0.40.0'],
  ])(
    'old Ollama for %s reports its version and sends neither POST',
    async (model, version, detail) => {
      const h = harness({
        selection: { kind: 'ollama', model },
        routes: {
          [VERSION_PATH]: { status: 200, body: `{"version":"${version}"}` },
        },
      });

      const status = await h.config.getStatus();

      expect(status).toMatchObject({ state: 'unsupported-endpoint', detail });
      expect(h.server.calls.map((call) => call.path)).toEqual([VERSION_PATH]);
    },
  );

  it('version check network error → unreachable, no POSTs', async () => {
    const h = harness({
      selection: OLLAMA,
      routes: { [VERSION_PATH]: 'network-error' },
    });

    expect((await h.config.getStatus()).state).toBe('unreachable');
    expect(h.server.count(SYSTEM_ONE_PATH)).toBe(0);
  });

  it('the shared budget expiring → unreachable with a timeout detail', async () => {
    const hanging: SystemOneFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('aborted')),
        );
      });
    const h = harness({
      selection: OLLAMA,
      fetch: hanging,
      probeTimeoutMs: 20,
    });

    const status = await h.config.getStatus();

    expect(status).toMatchObject({
      state: 'unreachable',
      detail: 'The request timed out.',
    });
    expect(status.detail).not.toContain('aborted');
    expect(h.logger.warn).toHaveBeenCalledWith(
      '[lane-routing] decision model probe request failed',
      expect.objectContaining({ timedOut: true, error: expect.any(String) }),
    );
  });
});

describe('DecisionModelConfig row detail never carries a raw error (P4 visual Moderate 1)', () => {
  it("a TypeError('fetch failed') shows fixed text; the logger gets the original error", async () => {
    const thrown = new TypeError('fetch failed');
    const failing: SystemOneFetch = async () => {
      throw thrown;
    };
    const h = harness({
      selection: OLLAMA,
      baseUrl: 'http://user:pw@127.0.0.1:1',
      fetch: failing,
    });

    const status = await h.config.getStatus();

    expect(status).toMatchObject({
      state: 'unreachable',
      detail: 'The model endpoint could not be reached.',
    });
    expect(status.detail).not.toContain('fetch failed');
    expect(h.logger.warn).toHaveBeenCalledWith(
      '[lane-routing] decision model probe request failed',
      expect.objectContaining({ timedOut: false, error: 'fetch failed' }),
    );
    const logged = JSON.stringify(h.logger.warn.mock.calls);
    expect(logged).not.toContain('127.0.0.1');
    expect(logged).not.toContain('pw@');
  });

  it('a non-Error rejection is logged and not shown', async () => {
    const failing: SystemOneFetch = async () => {
      throw 'socket hang up';
    };
    const h = harness({ selection: OLLAMA, fetch: failing });

    const status = await h.config.getStatus();

    expect(status.detail).toBe('The model endpoint could not be reached.');
    expect(h.logger.warn.mock.calls[0]?.[1]).toMatchObject({
      error: 'socket hang up',
    });
  });

  it('a Jev credential lookup failure shows fixed text; the logger gets the original error', async () => {
    const thrown = new Error('keychain locked at /home/someone/.secrets');
    const h = harness({ selection: { kind: 'jev' }, fetch: neverCalled });
    jest.spyOn(h.secrets, 'get').mockRejectedValue(thrown);

    const status = await h.config.getStatus();

    expect(status).toMatchObject({
      state: 'unreachable',
      detail: 'The credential store could not be read.',
    });
    expect(status.detail).not.toContain('keychain');
    expect(h.logger.warn).toHaveBeenCalledWith(
      '[lane-routing] Jev credential lookup failed',
      { error: thrown.message },
    );
  });

  it('a structured readiness failure shows fixed text; the logger gets the original error', async () => {
    const thrown = new Error('provider said: 500 internal at https://x.test');
    const structured: StructuredDecisionCompleter = {
      isReady: jest.fn(async () => {
        throw thrown;
      }),
      complete: jest.fn(async () => ({})),
    };
    const h = harness({
      selection: { kind: 'structured', providerId: 'ollama', model: 'qwen3' },
      structured,
      fetch: neverCalled,
    });

    const status = await h.config.getStatus();

    expect(status).toMatchObject({
      state: 'unreachable',
      detail: 'The provider readiness check failed.',
    });
    expect(status.detail).not.toContain('x.test');
    expect(h.logger.warn).toHaveBeenCalledWith(
      '[lane-routing] structured provider readiness failed',
      { providerId: 'ollama', error: thrown.message },
    );
  });
});

describe('DecisionModelConfig.recheckAfterLiveNotFound (decision #46)', () => {
  it('(a) live model-not-found: route 400 vs control 404 page not found → no mark, nothing stored, row ready', async () => {
    const h = harness({
      selection: OLLAMA,
      routes: { [VERSION_PATH]: VERSION_OK, [SYSTEM_ONE_PATH]: MODEL_REQUIRED },
    });

    const status = await h.config.recheckAfterLiveNotFound(
      BASE,
      LIVE_MODEL_NOT_FOUND,
    );

    expect(status).toMatchObject({
      state: 'ready',
      detail: `last call failed: ${LIVE_MODEL_NOT_FOUND}`,
    });
    expect(h.storage.update).not.toHaveBeenCalled();
    expect(h.storage.__state.entries.has(KEY)).toBe(false);
    expect(await h.config.isMarkedUnsupported()).toBe(false);
    // The detail stays on the row until a success, a change or a restart.
    expect((await h.config.getStatus()).detail).toBe(
      `last call failed: ${LIVE_MODEL_NOT_FOUND}`,
    );
    h.config.recordLiveSuccess();
    expect((await h.config.getStatus()).detail).toBeNull();
  });

  it('(b) live route missing → mark persisted and still present after a restart', async () => {
    const h = harness({
      selection: OLLAMA,
      routes: { [VERSION_PATH]: VERSION_OK },
    });

    const status = await h.config.recheckAfterLiveNotFound(
      BASE,
      '404 page not found',
    );

    const expected = unsupportedMark({
      detail:
        'endpoint does not serve /v1/systemone; last call: 404 page not found',
      at: 1_000,
    });
    expect(status).toMatchObject({
      state: 'unsupported-endpoint',
      detail: expected.detail,
    });
    expect(h.storage.update).toHaveBeenCalledWith(KEY, expected);

    const restarted = restart(h, neverCalled);
    expect(await restarted.isMarkedUnsupported()).toBe(true);
    expect(h.storage.__state.entries.get(KEY)).toEqual(expected);

    // The restarted row re-probes the same server, keeps the stored detail
    // and writes nothing new.
    h.storage.update.mockClear();
    const again = restart(h, fakeServer({ [VERSION_PATH]: VERSION_OK }).fetch);
    expect(await again.getStatus()).toMatchObject({
      state: 'unsupported-endpoint',
      detail: expected.detail,
    });
    expect(h.storage.update).not.toHaveBeenCalled();
  });

  it('(c) two live 404s within 60 s → one re-check; the next window re-checks again', async () => {
    const h = harness({
      selection: OLLAMA,
      routes: { [VERSION_PATH]: VERSION_OK, [SYSTEM_ONE_PATH]: MODEL_REQUIRED },
    });

    await h.config.recheckAfterLiveNotFound(BASE, 'first');
    h.clock.now += DECISION_MODEL_RECHECK_WINDOW_MS - 1;
    const second = await h.config.recheckAfterLiveNotFound(BASE, 'second');

    expect(h.server.count(VERSION_PATH)).toBe(1);
    expect(h.server.count(SYSTEM_ONE_PATH)).toBe(1);
    expect(second).toMatchObject({
      state: 'ready',
      detail: 'last call failed: second',
    });

    h.clock.now += 1;
    await h.config.recheckAfterLiveNotFound(BASE, 'third');
    expect(h.server.count(VERSION_PATH)).toBe(2);
  });

  it('concurrent live 404s share one in-flight re-check', async () => {
    const h = harness({
      selection: OLLAMA,
      routes: { [VERSION_PATH]: VERSION_OK, [SYSTEM_ONE_PATH]: MODEL_REQUIRED },
    });

    await Promise.all([
      h.config.recheckAfterLiveNotFound(BASE, 'one'),
      h.config.recheckAfterLiveNotFound(BASE, 'two'),
    ]);

    expect(h.server.count(VERSION_PATH)).toBe(1);
  });

  it('a ready re-check clears an existing mark', async () => {
    const storage = createMockStateStorage({
      seed: { [KEY]: unsupportedMark() },
    });
    const h = harness({
      selection: OLLAMA,
      storage,
      routes: { [VERSION_PATH]: VERSION_OK, [SYSTEM_ONE_PATH]: MODEL_REQUIRED },
    });
    expect(await h.config.isMarkedUnsupported()).toBe(true);

    const status = await h.config.recheckAfterLiveNotFound(
      BASE,
      LIVE_MODEL_NOT_FOUND,
    );

    expect(status.state).toBe('ready');
    expect(storage.update).toHaveBeenCalledWith(KEY, undefined);
    expect(storage.__state.entries.has(KEY)).toBe(false);
    expect(await h.config.isMarkedUnsupported()).toBe(false);
  });

  it('an unreachable re-check neither writes nor clears a mark', async () => {
    const storage = createMockStateStorage({
      seed: { [KEY]: unsupportedMark() },
    });
    const h = harness({
      selection: OLLAMA,
      storage,
      routes: { [VERSION_PATH]: 'network-error' },
    });

    const status = await h.config.recheckAfterLiveNotFound(BASE, 'x');

    expect(status.state).toBe('unreachable');
    expect(storage.update).not.toHaveBeenCalled();
    expect(await h.config.isMarkedUnsupported()).toBe(true);
  });

  it('a Jev live 404 sends no probe and keeps the row ready with the live error', async () => {
    const h = harness({
      selection: { kind: 'jev' },
      fetch: neverCalled,
      secrets: { [DECISION_MODEL_JEV_SECRET_KEY]: 'ts-key' },
    });

    const status = await h.config.recheckAfterLiveNotFound(
      JEV_BASE_URL,
      'model not found',
    );

    expect(status).toMatchObject({
      state: 'ready',
      detail: 'last call failed: model not found',
    });
    expect(h.storage.update).not.toHaveBeenCalled();
  });

  it('a mark that cannot be persisted is logged at warn and still holds in memory', async () => {
    const storage = createMockStateStorage({
      update: async () => {
        throw new Error('disk full');
      },
    });
    const h = harness({
      selection: OLLAMA,
      storage,
      routes: { [VERSION_PATH]: VERSION_OK },
    });

    const status = await h.config.recheckAfterLiveNotFound(BASE, 'gone');

    expect(status.state).toBe('unsupported-endpoint');
    expect(await h.config.isMarkedUnsupported()).toBe(true);
    expect(h.logger.warn).toHaveBeenCalledWith(
      '[lane-routing] decision model unsupported mark was not persisted',
      { error: 'disk full' },
    );
  });
});

describe('DecisionModelConfig selection and mark lifecycle', () => {
  it('unset → row unset, no network request', async () => {
    const h = harness({ fetch: neverCalled });

    expect(await h.config.getStatus()).toEqual({
      selection: { kind: 'unset' },
      locality: null,
      reportsConfidence: false,
      state: 'unset',
      detail: null,
    });
  });

  it('a hand-edited invalid selection reads as unset with a warning', () => {
    const h = harness({ selection: { kind: 'ollama', model: '' } });

    expect(h.config.getSelection()).toEqual({ kind: 'unset' });
    expect(h.logger.warn).toHaveBeenCalledTimes(1);
  });

  it('setSelection validates, applies the Jev default model and stores globally', async () => {
    const h = harness();

    await expect(
      h.config.setSelection({ kind: 'ollama', model: '' }),
    ).rejects.toThrow('invalid decision model selection at model');
    expect(h.workspace.setConfiguration).not.toHaveBeenCalled();

    const stored = await h.config.setSelection({ kind: 'jev' });

    expect(stored).toEqual({ kind: 'jev', model: 'jev-1.13.0' });
    expect(h.workspace.setConfiguration).toHaveBeenCalledWith(
      'ptah',
      'agentOrchestration.decisionModel',
      { kind: 'jev', model: 'jev-1.13.0' },
    );
  });

  it('a selection change clears the mark; the same selection keeps it', async () => {
    const storage = createMockStateStorage({
      seed: { [KEY]: unsupportedMark() },
    });
    const h = harness({ selection: OLLAMA, storage });

    await h.config.setSelection(OLLAMA);
    expect(storage.__state.entries.has(KEY)).toBe(true);

    await h.config.setSelection({ kind: 'ollama', model: 'clef' });
    expect(storage.__state.entries.has(KEY)).toBe(false);
  });

  it('a mark for another base URL does not apply', async () => {
    const storage = createMockStateStorage({
      seed: { [KEY]: unsupportedMark() },
    });
    const h = harness({
      selection: OLLAMA,
      storage,
      baseUrl: 'http://gpu-box:11434/',
    });

    expect(await h.config.isMarkedUnsupported()).toBe(false);
  });

  it('an invalid stored mark is ignored with a warning', async () => {
    const storage = createMockStateStorage({
      seed: { [KEY]: { selection: OLLAMA, baseUrl: BASE } },
    });
    const h = harness({ selection: OLLAMA, storage });

    expect(await h.config.isMarkedUnsupported()).toBe(false);
    expect(h.logger.warn).toHaveBeenCalledTimes(1);
  });
});

describe('DecisionModelConfig credential, locality and other kinds', () => {
  it('Jev without a key → no-credential, remote; with a key → ready', async () => {
    const h = harness({ selection: { kind: 'jev' }, fetch: neverCalled });

    expect(await h.config.getStatus()).toMatchObject({
      locality: 'remote',
      reportsConfidence: true,
      state: 'no-credential',
    });

    await h.config.keys.set('jev', '  ts-key  ');
    expect(h.secrets.__state.entries.get(DECISION_MODEL_JEV_SECRET_KEY)).toBe(
      'ts-key',
    );
    expect((await h.config.getStatus()).state).toBe('ready');
    expect(await h.config.resolveSystemOneTarget()).toEqual({
      baseUrl: JEV_BASE_URL,
      model: 'jev-1.13.0',
      apiKey: 'ts-key',
      probe: 'none',
      locality: 'remote',
      timeoutMs: DECISION_REQUEST_TIMEOUT_REMOTE_MS,
    });

    await h.config.keys.set('jev', null);
    expect(await h.config.keys.has('jev')).toBe(false);
  });

  it("keys.get('jev') returns the stored key trimmed, or null when none or blank", async () => {
    const h = harness({ selection: { kind: 'jev' }, fetch: neverCalled });

    expect(await h.config.keys.get('jev')).toBeNull();

    await h.config.keys.set('jev', '  ts-key  ');
    expect(await h.config.keys.get('jev')).toBe('ts-key');

    h.secrets.__state.seed(DECISION_MODEL_JEV_SECRET_KEY, '   ');
    expect(await h.config.keys.get('jev')).toBeNull();

    // Restoring "no key" through keys.set('jev', null) deletes the entry.
    await h.config.keys.set('jev', null);
    expect(h.secrets.__state.entries.has(DECISION_MODEL_JEV_SECRET_KEY)).toBe(
      false,
    );
  });

  it('a remote Ollama endpoint is disclosed as remote', () => {
    const h = harness({
      selection: OLLAMA,
      baseUrl: ' http://gpu-box:11434/ ',
    });

    expect(h.config.ollamaBaseUrl()).toBe('http://gpu-box:11434');
    expect(h.config.localityOf(OLLAMA)).toBe('remote');
  });

  it('structured: port missing → unreachable; isReady drives ready / no-credential', async () => {
    const selection = {
      kind: 'structured',
      providerId: 'ollama',
      model: 'qwen3',
    };
    const missing = harness({ selection, fetch: neverCalled });
    expect((await missing.config.getStatus()).state).toBe('unreachable');

    const isReady = jest.fn(
      async (providerId: string) => providerId === 'ollama',
    );
    const structured: StructuredDecisionCompleter = {
      isReady,
      complete: jest.fn(async () => ({})),
    };
    const ready = harness({ selection, structured, fetch: neverCalled });
    expect(await ready.config.getStatus()).toEqual({
      selection,
      locality: 'local',
      reportsConfidence: false,
      state: 'ready',
      detail: null,
    });

    const remote = harness({
      selection: { kind: 'structured', providerId: 'openrouter', model: 'x' },
      structured,
      fetch: neverCalled,
    });
    expect(await remote.config.getStatus()).toMatchObject({
      locality: 'remote',
      state: 'no-credential',
    });
  });
});

describe('DecisionModelConfig probe binding and mark read', () => {
  function heldProbe(): {
    readonly fetch: SystemOneFetch;
    readonly bothPosts: Promise<void>;
    releaseStale(): void;
  } {
    let releaseStale = false;
    let pendingPosts = 0;
    let bothWaiting: () => void = () => undefined;
    const bothPosts = new Promise<void>((resolve) => {
      bothWaiting = resolve;
    });
    const resumes: Array<() => void> = [];
    const fetchImpl: SystemOneFetch = async (url) => {
      const path = new URL(url).pathname;
      if (path === VERSION_PATH) {
        return { ok: true, status: 200, text: async () => VERSION_OK.body };
      }
      if (!releaseStale) {
        pendingPosts += 1;
        if (pendingPosts === 2) bothWaiting();
        await new Promise<void>((resolve) => {
          resumes.push(resolve);
        });
        return {
          ok: false,
          status: 404,
          text: async () => 'SECRET-PROMPT 404 page not found',
        };
      }
      if (path === SYSTEM_ONE_PATH) {
        return {
          ok: false,
          status: 400,
          text: async () => MODEL_REQUIRED.body,
        };
      }
      return { ok: false, status: 404, text: async () => GO_NOT_FOUND.body };
    };
    return {
      fetch: fetchImpl,
      bothPosts,
      releaseStale: () => {
        releaseStale = true;
        for (const resume of resumes) resume();
      },
    };
  }

  it('does not mark B when A probe resolves after the selection changes', async () => {
    const held = heldProbe();
    const h = harness({
      selection: { kind: 'ollama', model: 'alpha' },
      fetch: held.fetch,
    });
    const pending = h.config.getStatus();
    await held.bothPosts;
    await h.config.setSelection({ kind: 'ollama', model: 'beta' });
    held.releaseStale();

    const status = await pending;

    expect(status.selection).toEqual({ kind: 'ollama', model: 'beta' });
    expect(await h.config.isMarkedUnsupported()).toBe(false);
    expect(h.storage.update).not.toHaveBeenCalled();
    expect(h.storage.__state.entries.has(KEY)).toBe(false);
    expect(JSON.stringify(h.logger.info.mock.calls)).not.toContain(
      'SECRET-PROMPT',
    );
  });

  it('does not mark B when a live 404 recheck for A resolves after the selection changes', async () => {
    const held = heldProbe();
    const h = harness({
      selection: { kind: 'ollama', model: 'alpha' },
      fetch: held.fetch,
    });
    const pending = h.config.recheckAfterLiveNotFound(BASE, 'http 404');
    await held.bothPosts;
    await h.config.setSelection({ kind: 'ollama', model: 'beta' });
    held.releaseStale();

    await pending;

    expect(await h.config.isMarkedUnsupported()).toBe(false);
    expect(h.storage.update).not.toHaveBeenCalled();
    expect(h.storage.__state.entries.has(KEY)).toBe(false);
  });

  it('constructs with a null mark when storage.get throws', async () => {
    const storage = createMockStateStorage();
    jest.spyOn(storage, 'get').mockImplementation(() => {
      throw new Error('SECRET-PROMPT');
    });
    const h = harness({ storage, selection: OLLAMA });

    expect(await h.config.isMarkedUnsupported()).toBe(false);
    expect(h.logger.warn).toHaveBeenCalledTimes(1);
    expect(h.logger.warn).toHaveBeenCalledWith(
      '[lane-routing] decision model unsupported mark could not be read',
      { name: 'Error' },
    );
    expect(JSON.stringify(h.logger.warn.mock.calls)).not.toContain(
      'SECRET-PROMPT',
    );
  });

  async function flushUntil(ready: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (ready()) {
        return;
      }
      await Promise.resolve();
    }
    throw new Error('timed out waiting for the decision-model mark race');
  }

  it('does not leave A persisted when its storage write was held across a selection change', async () => {
    const h = harness({ selection: { kind: 'ollama', model: 'alpha' } });
    let releaseUpdate = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      releaseUpdate = resolve;
    });
    let entered = 0;
    const written: unknown[] = [];
    h.storage.update.mockImplementation(async (key: string, value: unknown) => {
      entered += 1;
      written.push(value);
      if (entered === 1) {
        await held;
      }
      if (value === undefined) {
        h.storage.__state.entries.delete(key);
      } else {
        h.storage.__state.entries.set(key, value);
      }
    });

    const marking = h.config.markUnsupported(
      BASE,
      'endpoint does not serve /v1/systemone',
      { kind: 'ollama', model: 'alpha' },
    );
    await flushUntil(() => entered === 1);
    const switching = h.config.setSelection({
      kind: 'ollama',
      model: 'beta',
    });
    await flushUntil(() =>
      JSON.stringify(h.logger.info.mock.calls).includes(
        'decision model unsupported mark cleared',
      ),
    );
    releaseUpdate();
    await marking;
    await switching;

    expect(await h.config.isMarkedUnsupported()).toBe(false);
    expect(h.storage.__state.entries.has(KEY)).toBe(false);
    expect(written[written.length - 1]).toBeUndefined();
  });

  it('probes the replacement selection once when the selection changes twice', async () => {
    let versionCount = 0;
    const versionReleases: Array<() => void> = [];
    const fetchImpl: SystemOneFetch = async (url) => {
      const path = new URL(url).pathname;
      if (path === VERSION_PATH) {
        versionCount += 1;
        await new Promise<void>((resolve) => {
          versionReleases.push(resolve);
        });
        return { ok: true, status: 200, text: async () => VERSION_OK.body };
      }
      if (path === SYSTEM_ONE_PATH) {
        return {
          ok: false,
          status: 400,
          text: async () => MODEL_REQUIRED.body,
        };
      }
      return { ok: false, status: 404, text: async () => GO_NOT_FOUND.body };
    };
    const h = harness({
      selection: { kind: 'ollama', model: 'alpha' },
      fetch: fetchImpl,
    });

    const pending = h.config.getStatus();
    await flushUntil(() => versionCount === 1);
    await h.config.setSelection({ kind: 'ollama', model: 'beta' });
    const releaseFirst = versionReleases[0];
    if (releaseFirst === undefined) {
      throw new Error('the first probe never waited on /api/version');
    }
    releaseFirst();
    await flushUntil(() => versionCount === 2);
    await h.config.setSelection({ kind: 'ollama', model: 'gamma' });
    const releaseSecond = versionReleases[1];
    if (releaseSecond === undefined) {
      throw new Error('the retry probe never waited on /api/version');
    }
    releaseSecond();

    const status = await pending;

    expect(versionCount).toBe(2);
    expect(status.selection).toEqual({ kind: 'ollama', model: 'gamma' });
    expect(status.state).toBe('unreachable');
    expect(status.detail).toBeNull();
  });
});
