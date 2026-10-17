import {
  createMockSecretStorage,
  createMockStateStorage,
  createMockWorkspaceProvider,
  type MockSecretStorage,
  type MockStateStorage,
  type MockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import type { LaneRoutingLogger } from '../lane-routing-logger';
import { DecisionModelConfig } from './decision-model.config';
import { DECISION_MODEL_DETAIL } from './decision-model.detail';
import {
  DECISION_MODEL_CUSTOM_SECRET_KEY,
  DECISION_MODEL_JEV_SECRET_KEY,
  DECISION_MODEL_UNSUPPORTED_STORAGE_KEY,
  OLLAMA_CLOUD_SECRET_KEY,
  SYSTEM_ONE_CONTROL_PATH,
  type DecisionModelStatusDto,
} from './decision-model.types';
import { SYSTEM_ONE_PATH, type SystemOneFetch } from './system-one.client';

/*
 * Row status of the Ollama Cloud and custom endpoint kinds (criteria 3.1-3.5),
 * key changes between probes (1.4), a sentinel key that must stay out of every
 * DTO, log and stored value (1.6) and the stored-key indicator after a
 * restart (2.7). Fake fetch and in-memory ports only: no network.
 *
 * AbortSignal.timeout runs on Node's internal timers, which Jest's fake
 * timers do not drive; the timeout case uses a small real budget through the
 * `probeTimeoutMs` seam.
 */

/** A value that must never appear in a log call, DTO or stored value. */
const SENTINEL = 'sk-sentinel-5d7a-never-surfaced';
const VERSION_PATH = '/api/version';
const SELECTION_KEY = 'ptah.agentOrchestration.decisionModel';
const OLLAMA_CLOUD_OVERRIDE_KEY = 'ptah.provider.ollama-cloud.baseUrl';

const CLOUD = { kind: 'ollama-cloud', model: 'clef:27b' } as const;
const GATEWAY = 'https://gateway.example';
const CUSTOM = {
  kind: 'custom',
  baseUrl: `${GATEWAY}/gw`,
  model: 'laya-1',
} as const;
const CUSTOM_LAN = {
  kind: 'custom',
  baseUrl: 'http://192.168.1.20:11434',
  model: 'laya-1',
} as const;
const JEV = { kind: 'jev', model: 'jev-1.13.0' } as const;

const ROUTE_400 = { status: 400, body: '{"error":"model is required"}' };
/** Go `net/http` default answer for a path no handler serves. */
const GO_NOT_FOUND = { status: 404, body: '404 page not found' };

interface FakeAnswer {
  readonly status: number;
  readonly body: string;
}

type FakeRoute = FakeAnswer | 'network-error';

interface FakeCall {
  readonly url: string;
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
}

interface FakeServer {
  readonly fetch: SystemOneFetch;
  readonly calls: FakeCall[];
  paths(): string[];
}

/** The route whose key is the request path or its tail (a base path may precede it). */
function routeFor(
  routes: Record<string, FakeRoute>,
  path: string,
): FakeRoute | undefined {
  const key = Object.keys(routes).find((candidate) => path.endsWith(candidate));
  return key === undefined ? undefined : routes[key];
}

/** Answers per path; any other path gets the Go default not-found answer. */
function fakeServer(routes: Record<string, FakeRoute>): FakeServer {
  const calls: FakeCall[] = [];
  const fetchImpl: SystemOneFetch = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({
      url,
      method: init?.method ?? 'GET',
      path,
      headers: { ...(init?.headers ?? {}) },
      body: init?.body,
    });
    const route = routeFor(routes, path) ?? GO_NOT_FOUND;
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
    paths: () => calls.map((call) => call.path),
  };
}

/** The probe routes of a healthy endpoint: the route answers, the control 404s. */
const HEALTHY: Record<string, FakeRoute> = { [SYSTEM_ONE_PATH]: ROUTE_400 };

function fakeLogger(): jest.Mocked<LaneRoutingLogger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function customKeyValue(origin: string, key: string): string {
  return JSON.stringify({ origin, key });
}

interface HarnessOptions {
  readonly selection?: unknown;
  readonly cloudBaseUrl?: string;
  readonly routes?: Record<string, FakeRoute>;
  readonly fetch?: SystemOneFetch;
  readonly secrets?: Record<string, string>;
  readonly probeTimeoutMs?: number;
}

interface Harness {
  readonly config: DecisionModelConfig;
  readonly server: FakeServer;
  readonly storage: MockStateStorage;
  readonly secrets: MockSecretStorage;
  readonly workspace: MockWorkspaceProvider;
  readonly logger: jest.Mocked<LaneRoutingLogger>;
}

function harness(options: HarnessOptions = {}): Harness {
  const seed: Record<string, unknown> = {};
  if (options.selection !== undefined) {
    seed[SELECTION_KEY] = options.selection;
  }
  if (options.cloudBaseUrl !== undefined) {
    seed[OLLAMA_CLOUD_OVERRIDE_KEY] = options.cloudBaseUrl;
  }
  const workspace = createMockWorkspaceProvider({ config: seed });
  const secrets = createMockSecretStorage({ seed: options.secrets ?? {} });
  const storage = createMockStateStorage();
  const logger = fakeLogger();
  const server = fakeServer(options.routes ?? HEALTHY);
  const config = new DecisionModelConfig(
    workspace,
    secrets,
    storage,
    logger,
    undefined,
    {
      fetch: options.fetch ?? server.fetch,
      now: () => 1_000,
      probeTimeoutMs: options.probeTimeoutMs,
    },
  );
  return { config, server, storage, secrets, workspace, logger };
}

/** A new instance over the same settings and storage: an application restart. */
function restart(previous: Harness, fetchImpl: SystemOneFetch): Harness {
  const logger = fakeLogger();
  const config = new DecisionModelConfig(
    previous.workspace,
    previous.secrets,
    previous.storage,
    logger,
    undefined,
    { fetch: fetchImpl, now: () => 1_000 },
  );
  return { ...previous, config, logger };
}

const neverCalled: SystemOneFetch = async (url) => {
  throw new Error(`unexpected request to ${url}`);
};

/** Every argument the logger received, serialised for a substring search. */
function loggedText(logger: jest.Mocked<LaneRoutingLogger>): string {
  return JSON.stringify([
    logger.debug.mock.calls,
    logger.info.mock.calls,
    logger.warn.mock.calls,
    logger.error.mock.calls,
  ]);
}

/** Everything a harness persisted: settings writes and storage entries. */
function persistedText(h: Harness): string {
  return JSON.stringify([
    h.workspace.setConfiguration.mock.calls,
    Array.from(h.storage.__state.entries.entries()),
  ]);
}

/** The headers of one call, lower-cased for a case-insensitive lookup. */
function authorizationOf(call: FakeCall): string | undefined {
  const entry = Object.entries(call.headers).find(
    ([name]) => name.toLowerCase() === 'authorization',
  );
  return entry?.[1];
}

function probePosts(server: FakeServer): FakeCall[] {
  return server.calls.filter((call) => call.method === 'POST');
}

interface KindCase {
  readonly name: string;
  readonly selection: unknown;
  readonly secrets: Record<string, string>;
  /** Origin and path prefix the probe must reach. */
  readonly routeUrl: string;
  readonly controlUrl: string;
  /** The key the probe sends, or `undefined` for no Authorization header. */
  readonly sentKey: string | undefined;
  /** 401/403 detail for this case. */
  readonly refusedDetail: string;
  /** Expected `apiKeyStored`: `undefined` means the property is absent. */
  readonly apiKeyStored: boolean | undefined;
  readonly keyed: boolean;
}

const KIND_CASES: readonly KindCase[] = [
  {
    name: 'ollama-cloud with a stored key',
    selection: CLOUD,
    secrets: { [OLLAMA_CLOUD_SECRET_KEY]: SENTINEL },
    routeUrl: `https://ollama.com${SYSTEM_ONE_PATH}`,
    controlUrl: `https://ollama.com${SYSTEM_ONE_CONTROL_PATH}`,
    sentKey: SENTINEL,
    refusedDetail: DECISION_MODEL_DETAIL.keyRefused,
    apiKeyStored: undefined,
    keyed: true,
  },
  {
    name: 'custom https endpoint with a stored key',
    selection: CUSTOM,
    secrets: {
      [DECISION_MODEL_CUSTOM_SECRET_KEY]: customKeyValue(GATEWAY, SENTINEL),
    },
    routeUrl: `${GATEWAY}/gw${SYSTEM_ONE_PATH}`,
    controlUrl: `${GATEWAY}/gw${SYSTEM_ONE_CONTROL_PATH}`,
    sentKey: SENTINEL,
    refusedDetail: DECISION_MODEL_DETAIL.keyRefused,
    apiKeyStored: true,
    keyed: true,
  },
  {
    name: 'custom http LAN endpoint without a key',
    selection: CUSTOM_LAN,
    secrets: {},
    routeUrl: `http://192.168.1.20:11434${SYSTEM_ONE_PATH}`,
    controlUrl: `http://192.168.1.20:11434${SYSTEM_ONE_CONTROL_PATH}`,
    sentKey: undefined,
    refusedDetail: DECISION_MODEL_DETAIL.keyRequired,
    apiKeyStored: false,
    keyed: false,
  },
];

function expectApiKeyStored(
  status: DecisionModelStatusDto,
  expected: boolean | undefined,
): void {
  if (expected === undefined) {
    expect(status).not.toHaveProperty('apiKeyStored');
  } else {
    expect(status.apiKeyStored).toBe(expected);
  }
}

describe.each(KIND_CASES)('endpoint status: $name', (kase) => {
  describe('3.1 no /api/version call', () => {
    it('probes the route and the control only, and never asks for a daemon version', async () => {
      const h = harness({
        selection: kase.selection,
        secrets: kase.secrets,
      });

      const status = await h.config.getStatus();

      expect(status.state).toBe('ready');
      expect(h.server.paths()).not.toContain(VERSION_PATH);
      expect(h.server.calls.map((call) => call.url).sort()).toEqual(
        [kase.routeUrl, kase.controlUrl].sort(),
      );
      expect(h.server.calls.every((call) => call.method === 'POST')).toBe(true);
      expect(h.server.calls.every((call) => call.body === '{}')).toBe(true);
    });

    it('does not mark the endpoint unsupported because a version is missing', async () => {
      // /api/version answers 404 (as a gateway would); the route is served.
      const h = harness({
        selection: kase.selection,
        secrets: kase.secrets,
        routes: { ...HEALTHY, [VERSION_PATH]: GO_NOT_FOUND },
      });

      const status = await h.config.getStatus();

      expect(status.state).toBe('ready');
      expect(h.storage.update).not.toHaveBeenCalled();
    });

    it('sends the stored key as a bearer header on both probe POSTs, and no header otherwise', async () => {
      const h = harness({
        selection: kase.selection,
        secrets: kase.secrets,
      });

      await h.config.getStatus();

      const posts = probePosts(h.server);
      expect(posts).toHaveLength(2);
      for (const call of posts) {
        expect(authorizationOf(call)).toBe(
          kase.sentKey === undefined ? undefined : `Bearer ${kase.sentKey}`,
        );
      }
    });
  });

  describe('3.2 401 and 403', () => {
    it.each([401, 403])(
      'an endpoint answering %i shows no-credential with a fixed text',
      async (httpStatus) => {
        const h = harness({
          selection: kase.selection,
          secrets: kase.secrets,
          routes: {
            [SYSTEM_ONE_PATH]: { status: httpStatus, body: 'denied' },
          },
        });

        const status = await h.config.getStatus();

        expect(status.state).toBe('no-credential');
        expect(status.detail).toBe(kase.refusedDetail);
        expectApiKeyStored(status, kase.apiKeyStored);
        expect(JSON.stringify(status)).not.toContain(SENTINEL);
      },
    );
  });

  describe('3.3 unreachable and timed out', () => {
    it('a transport failure shows unreachable with a fixed text', async () => {
      const h = harness({
        selection: kase.selection,
        secrets: kase.secrets,
        routes: { [SYSTEM_ONE_PATH]: 'network-error' },
      });

      const status = await h.config.getStatus();

      expect(status.state).toBe('unreachable');
      expect(status.detail).toBe(DECISION_MODEL_DETAIL.unreachable);
      expect(status.detail).not.toContain('fetch failed');
      expectApiKeyStored(status, kase.apiKeyStored);
    });

    it('an expired probe budget shows unreachable with the timeout text', async () => {
      const hang: SystemOneFetch = (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        });
      const h = harness({
        selection: kase.selection,
        secrets: kase.secrets,
        fetch: hang,
        probeTimeoutMs: 25,
      });

      const status = await h.config.getStatus();

      expect(status.state).toBe('unreachable');
      expect(status.detail).toBe(DECISION_MODEL_DETAIL.timedOut);
    });
  });

  describe('3.4 unsupported endpoint', () => {
    it('a route that answers like the control shows unsupported-endpoint (state set unchanged)', async () => {
      const h = harness({
        selection: kase.selection,
        secrets: kase.secrets,
        routes: {},
      });

      const status = await h.config.getStatus();

      expect(status.state).toBe('unsupported-endpoint');
      expect(status.detail).toBe('endpoint does not serve /v1/systemone');
      expect([
        'unset',
        'ready',
        'no-credential',
        'unreachable',
        'unsupported-endpoint',
      ]).toContain(status.state);
      expectApiKeyStored(status, kase.apiKeyStored);
    });
  });

  describe('3.5 ready', () => {
    it.each([
      ['400 against a 404 control', ROUTE_400],
      ['200 against a 404 control', { status: 200, body: '{"ok":true}' }],
    ])('a valid key and route (%s) shows ready', async (_label, route) => {
      const h = harness({
        selection: kase.selection,
        secrets: kase.secrets,
        routes: { [SYSTEM_ONE_PATH]: route },
      });

      const status = await h.config.getStatus();

      expect(status.state).toBe('ready');
      expect(status.detail).toBeNull();
      expect(status.selection).toEqual(kase.selection);
      expectApiKeyStored(status, kase.apiKeyStored);
    });
  });
});

describe('endpoint status: paths that keep the daemon behaviour (3.1)', () => {
  it('ollama-cloud without a key probes the local daemon, version first, with no Authorization header', async () => {
    const h = harness({
      selection: CLOUD,
      routes: {
        ...HEALTHY,
        [VERSION_PATH]: { status: 200, body: '{"version":"0.35.2"}' },
      },
    });

    const status = await h.config.getStatus();

    expect(status.state).toBe('ready');
    expect(status.locality).toBe('remote');
    expect(h.server.calls[0]).toMatchObject({
      method: 'GET',
      url: `http://127.0.0.1:11434${VERSION_PATH}`,
    });
    expect(h.server.calls.map(authorizationOf)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('ollama-cloud without a key and a daemon below the floor shows unsupported-endpoint', async () => {
    const h = harness({
      selection: CLOUD,
      routes: {
        ...HEALTHY,
        [VERSION_PATH]: { status: 200, body: '{"version":"0.34.0"}' },
      },
    });

    const status = await h.config.getStatus();

    expect(status.state).toBe('unsupported-endpoint');
    expect(status.detail).toBe('Ollama 0.34.0 < 0.35.0');
  });

  it('the local ollama kind still checks the version and sends no key', async () => {
    const h = harness({
      selection: { kind: 'ollama', model: 'nimble' },
      routes: {
        ...HEALTHY,
        [VERSION_PATH]: { status: 200, body: '{"version":"0.35.2"}' },
      },
      secrets: { [OLLAMA_CLOUD_SECRET_KEY]: SENTINEL },
    });

    const status = await h.config.getStatus();

    expect(status.state).toBe('ready');
    expect(h.server.paths()).toContain(VERSION_PATH);
    expect(
      h.server.calls.every((call) => authorizationOf(call) === undefined),
    ).toBe(true);
  });

  it('a daemon that answers 401 on the version check shows no-credential', async () => {
    const h = harness({
      selection: CLOUD,
      routes: { [VERSION_PATH]: { status: 401, body: '' } },
    });

    expect((await h.config.getStatus()).state).toBe('no-credential');
  });
});

describe('endpoint status: Ollama Cloud base URL override', () => {
  it('probes the override with the key when it is https', async () => {
    const h = harness({
      selection: CLOUD,
      cloudBaseUrl: 'https://proxy.example/ollama',
      secrets: { [OLLAMA_CLOUD_SECRET_KEY]: SENTINEL },
    });

    const status = await h.config.getStatus();

    expect(status.state).toBe('ready');
    expect(h.server.calls.map((call) => call.url).sort()).toEqual(
      [
        `https://proxy.example/ollama${SYSTEM_ONE_PATH}`,
        `https://proxy.example/ollama${SYSTEM_ONE_CONTROL_PATH}`,
      ].sort(),
    );
  });
});

describe('endpoint status: blocked and failing key reads', () => {
  it.each([
    [
      'custom http host with a stored key',
      CUSTOM_LAN,
      {
        [DECISION_MODEL_CUSTOM_SECRET_KEY]: customKeyValue(
          'http://192.168.1.20:11434',
          SENTINEL,
        ),
      },
      undefined,
      true,
    ],
    [
      'ollama-cloud override over http with a stored key',
      CLOUD,
      { [OLLAMA_CLOUD_SECRET_KEY]: SENTINEL },
      'http://proxy.example',
      undefined,
    ],
  ])(
    'a key that would cross plain http (%s) shows no-credential with the https text and sends nothing',
    async (_label, selection, secrets, cloudBaseUrl, apiKeyStored) => {
      const h = harness({
        selection,
        secrets,
        cloudBaseUrl,
        fetch: neverCalled,
      });

      const status = await h.config.getStatus();

      expect(status.state).toBe('no-credential');
      expect(status.detail).toBe(DECISION_MODEL_DETAIL.keyNeedsHttps);
      expect(status.detail).toContain('HTTPS');
      expectApiKeyStored(status, apiKeyStored);
      expect(JSON.stringify(status)).not.toContain(SENTINEL);
    },
  );

  it('a loopback http endpoint may carry a key', async () => {
    const selection = {
      kind: 'custom',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'm',
    };
    const h = harness({
      selection,
      secrets: {
        [DECISION_MODEL_CUSTOM_SECRET_KEY]: customKeyValue(
          'http://127.0.0.1:11434',
          SENTINEL,
        ),
      },
    });

    const status = await h.config.getStatus();

    expect(status.state).toBe('ready');
    expect(status.locality).toBe('local');
    expect(probePosts(h.server).map(authorizationOf)).toEqual([
      `Bearer ${SENTINEL}`,
      `Bearer ${SENTINEL}`,
    ]);
  });

  it.each([
    ['ollama-cloud', CLOUD],
    ['custom', CUSTOM],
  ])(
    '%s: a rejected credential-store read shows unreachable with a fixed text',
    async (_label, selection) => {
      const h = harness({ selection, fetch: neverCalled });
      jest
        .spyOn(h.secrets, 'get')
        .mockRejectedValue(new Error('keychain locked: /secret/path'));

      const status = await h.config.getStatus();

      expect(status.state).toBe('unreachable');
      expect(status.detail).toBe(DECISION_MODEL_DETAIL.credentialStore);
      expect(JSON.stringify(status)).not.toContain('keychain');
    },
  );
});

describe('1.4 a key added or removed between probes', () => {
  it('custom: the next probe follows the key with no step in the row', async () => {
    const h = harness({ selection: CUSTOM });

    const before = await h.config.getStatus();
    await h.secrets.store(
      DECISION_MODEL_CUSTOM_SECRET_KEY,
      customKeyValue(GATEWAY, SENTINEL),
    );
    const added = await h.config.getStatus();
    await h.secrets.delete(DECISION_MODEL_CUSTOM_SECRET_KEY);
    const removed = await h.config.getStatus();

    expect([
      before.apiKeyStored,
      added.apiKeyStored,
      removed.apiKeyStored,
    ]).toEqual([false, true, false]);
    const authorizations = probePosts(h.server).map(authorizationOf);
    expect(authorizations).toEqual([
      undefined,
      undefined,
      `Bearer ${SENTINEL}`,
      `Bearer ${SENTINEL}`,
      undefined,
      undefined,
    ]);
  });

  it('custom: a key bound to another origin is not sent and not reported', async () => {
    const h = harness({
      selection: CUSTOM,
      secrets: {
        [DECISION_MODEL_CUSTOM_SECRET_KEY]: customKeyValue(
          'https://other.example',
          SENTINEL,
        ),
      },
    });

    const status = await h.config.getStatus();

    expect(status.apiKeyStored).toBe(false);
    expect(probePosts(h.server).map(authorizationOf)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('ollama-cloud: the next probe switches between the daemon and ollama.com', async () => {
    const h = harness({
      selection: CLOUD,
      routes: {
        ...HEALTHY,
        [VERSION_PATH]: { status: 200, body: '{"version":"0.35.2"}' },
      },
    });

    await h.config.getStatus();
    const withoutKey = h.server.calls.splice(0);
    await h.secrets.store(OLLAMA_CLOUD_SECRET_KEY, SENTINEL);
    await h.config.getStatus();
    const withKey = h.server.calls.splice(0);
    await h.secrets.delete(OLLAMA_CLOUD_SECRET_KEY);
    await h.config.getStatus();
    const removed = h.server.calls.splice(0);

    expect(withoutKey.map((call) => new URL(call.url).origin)).toEqual([
      'http://127.0.0.1:11434',
      'http://127.0.0.1:11434',
      'http://127.0.0.1:11434',
    ]);
    expect(withoutKey.map((call) => call.path)).toContain(VERSION_PATH);
    expect(new Set(withKey.map((call) => new URL(call.url).origin))).toEqual(
      new Set(['https://ollama.com']),
    );
    expect(withKey.map((call) => call.path)).not.toContain(VERSION_PATH);
    expect(withKey.map(authorizationOf)).toEqual([
      `Bearer ${SENTINEL}`,
      `Bearer ${SENTINEL}`,
    ]);
    expect(removed.map((call) => new URL(call.url).origin)).toEqual([
      'http://127.0.0.1:11434',
      'http://127.0.0.1:11434',
      'http://127.0.0.1:11434',
    ]);
    expect(removed.map(authorizationOf)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('jev: apiKeyStored follows the key', async () => {
    const h = harness({ selection: JEV, fetch: neverCalled });

    const before = await h.config.getStatus();
    await h.secrets.store(DECISION_MODEL_JEV_SECRET_KEY, SENTINEL);
    const added = await h.config.getStatus();
    await h.secrets.delete(DECISION_MODEL_JEV_SECRET_KEY);
    const removed = await h.config.getStatus();

    expect([before.state, added.state, removed.state]).toEqual([
      'no-credential',
      'ready',
      'no-credential',
    ]);
    expect([
      before.apiKeyStored,
      added.apiKeyStored,
      removed.apiKeyStored,
    ]).toEqual([false, true, false]);
  });
});

describe('1.6 a sentinel key stays out of every DTO, log and stored value', () => {
  /** One scenario: how to build the harness and whether the key is in secret storage. */
  const SCENARIOS: ReadonlyArray<{
    readonly name: string;
    readonly options: HarnessOptions;
  }> = [
    {
      name: 'ollama-cloud ready',
      options: {
        selection: CLOUD,
        secrets: { [OLLAMA_CLOUD_SECRET_KEY]: SENTINEL },
      },
    },
    {
      name: 'ollama-cloud refused (401)',
      options: {
        selection: CLOUD,
        secrets: { [OLLAMA_CLOUD_SECRET_KEY]: SENTINEL },
        routes: { [SYSTEM_ONE_PATH]: { status: 401, body: 'denied' } },
      },
    },
    {
      name: 'ollama-cloud unreachable',
      options: {
        selection: CLOUD,
        secrets: { [OLLAMA_CLOUD_SECRET_KEY]: SENTINEL },
        routes: { [SYSTEM_ONE_PATH]: 'network-error' },
      },
    },
    {
      name: 'ollama-cloud unsupported (persists a mark)',
      options: {
        selection: CLOUD,
        secrets: { [OLLAMA_CLOUD_SECRET_KEY]: SENTINEL },
        routes: {},
      },
    },
    {
      name: 'ollama-cloud blocked over http',
      options: {
        selection: CLOUD,
        secrets: { [OLLAMA_CLOUD_SECRET_KEY]: SENTINEL },
        cloudBaseUrl: 'http://proxy.example',
      },
    },
    {
      name: 'custom ready',
      options: {
        selection: CUSTOM,
        secrets: {
          [DECISION_MODEL_CUSTOM_SECRET_KEY]: customKeyValue(GATEWAY, SENTINEL),
        },
      },
    },
    {
      name: 'custom refused (403)',
      options: {
        selection: CUSTOM,
        secrets: {
          [DECISION_MODEL_CUSTOM_SECRET_KEY]: customKeyValue(GATEWAY, SENTINEL),
        },
        routes: { [SYSTEM_ONE_PATH]: { status: 403, body: 'denied' } },
      },
    },
    {
      name: 'custom unreachable',
      options: {
        selection: CUSTOM,
        secrets: {
          [DECISION_MODEL_CUSTOM_SECRET_KEY]: customKeyValue(GATEWAY, SENTINEL),
        },
        routes: { [SYSTEM_ONE_PATH]: 'network-error' },
      },
    },
    {
      name: 'custom unsupported (persists a mark)',
      options: {
        selection: CUSTOM,
        secrets: {
          [DECISION_MODEL_CUSTOM_SECRET_KEY]: customKeyValue(GATEWAY, SENTINEL),
        },
        routes: {},
      },
    },
    {
      name: 'custom blocked over http',
      options: {
        selection: CUSTOM_LAN,
        secrets: {
          [DECISION_MODEL_CUSTOM_SECRET_KEY]: customKeyValue(
            'http://192.168.1.20:11434',
            SENTINEL,
          ),
        },
      },
    },
    {
      name: 'jev ready',
      options: {
        selection: JEV,
        secrets: { [DECISION_MODEL_JEV_SECRET_KEY]: SENTINEL },
        fetch: neverCalled,
      },
    },
  ];

  it.each(SCENARIOS)('$name', async ({ options }) => {
    const h = harness(options);

    const status = await h.config.getStatus();
    const target = await h.config.resolveSystemOneTarget();
    const dtos = JSON.stringify([status, h.config.getSelection()]);

    expect(dtos).not.toContain(SENTINEL);
    expect(loggedText(h.logger)).not.toContain(SENTINEL);
    expect(persistedText(h)).not.toContain(SENTINEL);
    // The resolved target is the only value that holds the key (for the
    // sender); a blocked or key-less selection resolves without it.
    if (target !== null && target.apiKey !== undefined) {
      expect(target.apiKey).toBe(SENTINEL);
    }
  });

  it('the key does travel in the Authorization header (the search is not vacuous)', async () => {
    const h = harness({
      selection: CUSTOM,
      secrets: {
        [DECISION_MODEL_CUSTOM_SECRET_KEY]: customKeyValue(GATEWAY, SENTINEL),
      },
    });

    await h.config.getStatus();

    expect(JSON.stringify(h.server.calls)).toContain(SENTINEL);
  });

  it('a refused probe whose body echoes nothing leaves the row detail and logs key-free after a live re-check', async () => {
    const h = harness({
      selection: CUSTOM,
      secrets: {
        [DECISION_MODEL_CUSTOM_SECRET_KEY]: customKeyValue(GATEWAY, SENTINEL),
      },
      routes: {},
    });

    const status = await h.config.recheckAfterLiveNotFound(
      { selection: CUSTOM, baseUrl: `${GATEWAY}/gw` },
      'http 404',
    );

    expect(status.state).toBe('unsupported-endpoint');
    expect(JSON.stringify(status)).not.toContain(SENTINEL);
    expect(loggedText(h.logger)).not.toContain(SENTINEL);
    expect(persistedText(h)).not.toContain(SENTINEL);
  });

  it('saving a custom selection stores no key in the settings write', async () => {
    const h = harness({
      secrets: {
        [DECISION_MODEL_CUSTOM_SECRET_KEY]: customKeyValue(GATEWAY, SENTINEL),
      },
    });

    await h.config.setSelection(CUSTOM);

    expect(persistedText(h)).not.toContain(SENTINEL);
    expect(loggedText(h.logger)).not.toContain(SENTINEL);
  });
});

describe('2.7 a fresh config reports the stored-key indicator', () => {
  it('a custom selection with a stored key reports apiKeyStored true on a fresh config', async () => {
    const first = harness({
      secrets: {
        [DECISION_MODEL_CUSTOM_SECRET_KEY]: customKeyValue(GATEWAY, SENTINEL),
      },
    });
    await first.config.setSelection(CUSTOM);

    const fresh = restart(first, first.server.fetch);

    expect(fresh.config.getSelection()).toEqual(CUSTOM);
    const status = await fresh.config.getStatus();
    expect(status.apiKeyStored).toBe(true);
    expect(status.state).toBe('ready');
    expect(JSON.stringify(status)).not.toContain(SENTINEL);
  });

  it('a custom selection without a key reports apiKeyStored false, not absent', async () => {
    const first = harness();
    await first.config.setSelection(CUSTOM);

    const fresh = restart(first, first.server.fetch);

    const status = await fresh.config.getStatus();
    expect(status).toHaveProperty('apiKeyStored', false);
    expect(status.selection).toEqual(CUSTOM);
  });

  it('the base URL, the model and the indicator all come back after a restart', async () => {
    const first = harness({
      secrets: {
        [DECISION_MODEL_CUSTOM_SECRET_KEY]: customKeyValue(GATEWAY, SENTINEL),
      },
    });
    await first.config.setSelection({
      kind: 'custom',
      baseUrl: `${GATEWAY}/gw/`,
      model: '  laya-1  ',
    });

    const fresh = restart(first, first.server.fetch);
    const status = await fresh.config.getStatus();

    expect(status.selection).toEqual({
      kind: 'custom',
      baseUrl: `${GATEWAY}/gw`,
      model: 'laya-1',
    });
    expect(status.apiKeyStored).toBe(true);
  });

  it('a fresh jev config reports apiKeyStored', async () => {
    const first = harness({
      selection: JEV,
      secrets: { [DECISION_MODEL_JEV_SECRET_KEY]: SENTINEL },
      fetch: neverCalled,
    });

    const fresh = restart(first, neverCalled);

    expect((await fresh.config.getStatus()).apiKeyStored).toBe(true);
  });

  it('ollama-cloud and unset rows never carry the indicator', async () => {
    const cloud = harness({
      selection: CLOUD,
      secrets: { [OLLAMA_CLOUD_SECRET_KEY]: SENTINEL },
    });
    const unset = harness({ fetch: neverCalled });

    expect(await cloud.config.getStatus()).not.toHaveProperty('apiKeyStored');
    expect(await unset.config.getStatus()).not.toHaveProperty('apiKeyStored');
  });
});

describe('review round 1: untrusted errors, invalid overrides, key rotation, stale 404s', () => {
  const MARK_KEY = DECISION_MODEL_UNSUPPORTED_STORAGE_KEY;
  const ROUTE_URL = `${GATEWAY}/gw${SYSTEM_ONE_PATH}`;
  const CONTROL_URL = `${GATEWAY}/gw${SYSTEM_ONE_CONTROL_PATH}`;
  const KEY_A = 'sk-rotate-a-1f0e';
  const KEY_B = 'sk-rotate-b-77c3';

  function customKeys(key: string): Record<string, string> {
    return { [DECISION_MODEL_CUSTOM_SECRET_KEY]: customKeyValue(GATEWAY, key) };
  }

  /**
   * Answers by the key in the Authorization header: `notServed` keys get the
   * Go not-found on both POSTs (unsupported), others the healthy route.
   * Requests with the `held` key wait for `release()`.
   */
  function keyedServer(options: {
    readonly notServed: readonly string[];
    readonly held?: string;
  }): {
    fetch: SystemOneFetch;
    calls: FakeCall[];
    heldPosts: () => number;
    release: () => void;
  } {
    const calls: FakeCall[] = [];
    let heldCount = 0;
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl: SystemOneFetch = async (url, init) => {
      const headers = { ...(init?.headers ?? {}) };
      calls.push({
        url,
        method: init?.method ?? 'GET',
        path: new URL(url).pathname,
        headers,
        body: init?.body,
      });
      const auth = headers['authorization'] ?? '';
      if (options.held !== undefined && auth === `Bearer ${options.held}`) {
        heldCount += 1;
        await gate;
      }
      const notServed = options.notServed.some((k) => auth === `Bearer ${k}`);
      const answer =
        notServed || url.endsWith(SYSTEM_ONE_CONTROL_PATH)
          ? GO_NOT_FOUND
          : ROUTE_400;
      return {
        ok: false,
        status: answer.status,
        text: async () => answer.body,
      };
    };
    return {
      fetch: fetchImpl,
      calls,
      heldPosts: () => heldCount,
      release: () => release(),
    };
  }

  async function flush(until: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (until()) {
        return;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error('condition not reached');
  }

  describe('defect 1: a rejection that echoes the key is never logged', () => {
    it('a fetch error echoing the Authorization header logs only its name', async () => {
      const calls: FakeCall[] = [];
      const echoing: SystemOneFetch = async (url, init) => {
        const headers = { ...(init?.headers ?? {}) };
        calls.push({
          url,
          method: init?.method ?? 'GET',
          path: new URL(url).pathname,
          headers,
          body: init?.body,
        });
        throw new Error(
          `proxy rejected Authorization: ${headers['authorization'] ?? ''}`,
        );
      };
      const h = harness({
        selection: CUSTOM,
        secrets: customKeys(SENTINEL),
        fetch: echoing,
      });

      const status = await h.config.getStatus();

      expect(status).toMatchObject({
        state: 'unreachable',
        detail: DECISION_MODEL_DETAIL.unreachable,
      });
      expect(calls.map((call) => call.url).sort()).toEqual(
        [ROUTE_URL, CONTROL_URL].sort(),
      );
      expect(calls.map(authorizationOf)).toEqual([
        `Bearer ${SENTINEL}`,
        `Bearer ${SENTINEL}`,
      ]);
      expect(h.logger.warn).toHaveBeenCalledWith(
        '[lane-routing] decision model probe request failed',
        expect.objectContaining({ errorName: 'Error', timedOut: false }),
      );
      expect(JSON.stringify(status)).not.toContain(SENTINEL);
      expect(loggedText(h.logger)).not.toContain(SENTINEL);
      expect(loggedText(h.logger)).not.toContain('proxy rejected');
      expect(persistedText(h)).not.toContain(SENTINEL);
      expect(h.storage.__state.entries.has(MARK_KEY)).toBe(false);
    });

    it('a key-store error echoing the key logs only its name', async () => {
      const h = harness({ selection: CUSTOM, fetch: neverCalled });
      jest
        .spyOn(h.secrets, 'get')
        .mockRejectedValue(new Error(`keychain dump: ${SENTINEL}`));

      const status = await h.config.getStatus();

      expect(status).toMatchObject({
        state: 'unreachable',
        detail: DECISION_MODEL_DETAIL.credentialStore,
      });
      expect(h.logger.warn).toHaveBeenCalledWith(
        '[lane-routing] decision model key lookup failed',
        { kind: 'custom', errorName: 'Error' },
      );
      expect(loggedText(h.logger)).not.toContain(SENTINEL);
      expect(loggedText(h.logger)).not.toContain('keychain');
      expect(JSON.stringify(status)).not.toContain(SENTINEL);
      expect(persistedText(h)).not.toContain(SENTINEL);
    });
  });

  describe('defect 2: an invalid Ollama Cloud override is refused', () => {
    const INVALID: ReadonlyArray<readonly [string, string]> = [
      ['userinfo', 'https://user:url-secret@proxy.example/ollama'],
      ['query', 'https://proxy.example/ollama?token=url-secret'],
      ['fragment', 'https://proxy.example/ollama#url-secret'],
    ];

    it.each(INVALID)(
      'a %s override is never called, logged or marked',
      async (_component, override) => {
        const server = fakeServer({});
        const h = harness({
          selection: CLOUD,
          cloudBaseUrl: override,
          secrets: { [OLLAMA_CLOUD_SECRET_KEY]: SENTINEL },
          fetch: server.fetch,
        });

        const status = await h.config.getStatus();
        const recheck = await h.config.recheckAfterLiveNotFound(
          { selection: CLOUD, baseUrl: override },
          'http 404',
        );

        expect(status).toMatchObject({
          state: 'unreachable',
          detail: DECISION_MODEL_DETAIL.invalidCloudBaseUrl,
        });
        expect(recheck).toMatchObject({
          state: 'unreachable',
          detail: DECISION_MODEL_DETAIL.invalidCloudBaseUrl,
        });
        expect(await h.config.resolveSystemOneTarget()).toBeNull();
        expect(await h.config.isMarkedUnsupported()).toBe(false);
        expect(server.calls).toEqual([]);
        expect(h.storage.update).not.toHaveBeenCalled();
        expect(h.storage.__state.entries.has(MARK_KEY)).toBe(false);
        for (const text of [
          loggedText(h.logger),
          persistedText(h),
          JSON.stringify([status, recheck]),
        ]) {
          expect(text).not.toContain('url-secret');
          expect(text).not.toContain(SENTINEL);
        }
      },
    );

    it.each(INVALID)(
      'a %s override is refused without a key too',
      async (_component, override) => {
        const server = fakeServer({});
        const h = harness({
          selection: CLOUD,
          cloudBaseUrl: override,
          fetch: server.fetch,
        });

        const status = await h.config.getStatus();

        expect(status.detail).toBe(DECISION_MODEL_DETAIL.invalidCloudBaseUrl);
        expect(server.calls).toEqual([]);
        expect(loggedText(h.logger)).not.toContain('url-secret');
      },
    );
  });

  describe('defect 3: probe, re-check and mark evidence is bound to the key', () => {
    it('a probe in flight under key A cannot mark the endpoint for key B', async () => {
      const server = keyedServer({ notServed: [KEY_A], held: KEY_A });
      const h = harness({
        selection: CUSTOM,
        secrets: customKeys(KEY_A),
        fetch: server.fetch,
      });

      const pending = h.config.recheckAfterLiveNotFound(
        { selection: CUSTOM, baseUrl: CUSTOM.baseUrl },
        'http 404',
      );
      await flush(() => server.heldPosts() === 2);
      await h.secrets.store(
        DECISION_MODEL_CUSTOM_SECRET_KEY,
        customKeyValue(GATEWAY, KEY_B),
      );
      server.release();
      const stale = await pending;

      expect(stale.state).not.toBe('unsupported-endpoint');
      expect(stale.detail).toBeNull();
      expect(await h.config.isMarkedUnsupported()).toBe(false);
      expect(h.storage.update).not.toHaveBeenCalled();
      expect(h.storage.__state.entries.has(MARK_KEY)).toBe(false);

      const fresh = await h.config.getStatus();
      expect(fresh).toMatchObject({ state: 'ready', detail: null });
      const lastPosts = server.calls.slice(-2);
      expect(lastPosts.map((call) => call.url).sort()).toEqual(
        [ROUTE_URL, CONTROL_URL].sort(),
      );
      expect(lastPosts.map(authorizationOf)).toEqual([
        `Bearer ${KEY_B}`,
        `Bearer ${KEY_B}`,
      ]);
      for (const text of [loggedText(h.logger), persistedText(h)]) {
        expect(text).not.toContain(KEY_A);
        expect(text).not.toContain(KEY_B);
      }
    });

    it('a key change inside the 60 s window re-checks with the new key', async () => {
      const server = keyedServer({ notServed: [KEY_B] });
      const h = harness({
        selection: CUSTOM,
        secrets: customKeys(KEY_A),
        fetch: server.fetch,
      });
      const live = { selection: CUSTOM, baseUrl: CUSTOM.baseUrl };

      const first = await h.config.recheckAfterLiveNotFound(live, 'http 404');
      expect(first).toMatchObject({
        state: 'ready',
        detail: 'last call failed: http 404',
      });

      await h.secrets.store(
        DECISION_MODEL_CUSTOM_SECRET_KEY,
        customKeyValue(GATEWAY, KEY_B),
      );
      const second = await h.config.recheckAfterLiveNotFound(live, 'http 404');

      const postsWithB = server.calls.filter(
        (call) => authorizationOf(call) === `Bearer ${KEY_B}`,
      );
      expect(postsWithB.map((call) => call.url).sort()).toEqual(
        [ROUTE_URL, CONTROL_URL].sort(),
      );
      expect(second.state).toBe('unsupported-endpoint');
      expect(h.storage.__state.entries.get(MARK_KEY)).toMatchObject({
        selection: CUSTOM,
        baseUrl: CUSTOM.baseUrl,
      });
      expect(await h.config.isMarkedUnsupported()).toBe(true);

      // The mark was written under key B: key A does not inherit it.
      await h.secrets.store(
        DECISION_MODEL_CUSTOM_SECRET_KEY,
        customKeyValue(GATEWAY, KEY_A),
      );
      expect(await h.config.isMarkedUnsupported()).toBe(false);

      for (const text of [
        loggedText(h.logger),
        persistedText(h),
        JSON.stringify([first, second]),
      ]) {
        expect(text).not.toContain(KEY_A);
        expect(text).not.toContain(KEY_B);
      }
    });
  });

  describe('defect 4: a late 404 does not attach to a newer selection', () => {
    it('a 404 for model laya-1 is dropped after a switch to laya-2 at the same base', async () => {
      const h = harness({ selection: CUSTOM, secrets: customKeys(KEY_A) });
      const switched = { ...CUSTOM, model: 'laya-2' } as const;
      await h.config.setSelection(switched);

      const status = await h.config.recheckAfterLiveNotFound(
        { selection: CUSTOM, baseUrl: CUSTOM.baseUrl },
        'http 404',
      );

      expect(status.selection).toEqual(switched);
      expect(status.detail).toBeNull();
      expect(h.server.calls).toEqual([]);
      expect(h.storage.__state.entries.has(MARK_KEY)).toBe(false);
      const next = await h.config.getStatus();
      expect(next).toMatchObject({ state: 'ready', detail: null });
      expect(loggedText(h.logger)).not.toContain(KEY_A);
    });
  });

  describe('round 2, R1-1: an error name that carries the key is never logged', () => {
    function hostile(text: string): Error {
      const error = new Error('rejected');
      error.name = text;
      return error;
    }

    it('a fetch rejection naming the Authorization header logs a fixed category', async () => {
      const h = harness({
        selection: CUSTOM,
        secrets: customKeys(SENTINEL),
        fetch: async (_url, init) => {
          throw hostile(
            `Authorization: ${init?.headers?.['authorization'] ?? ''}`,
          );
        },
      });

      const status = await h.config.getStatus();

      expect(status).toMatchObject({
        state: 'unreachable',
        detail: DECISION_MODEL_DETAIL.unreachable,
      });
      expect(h.logger.warn).toHaveBeenCalledWith(
        '[lane-routing] decision model probe request failed',
        expect.objectContaining({ errorName: 'other' }),
      );
      expect(loggedText(h.logger)).not.toContain(SENTINEL);
      expect(loggedText(h.logger)).not.toContain('Authorization');
      expect(JSON.stringify(status)).not.toContain(SENTINEL);
    });

    it('a key-store rejection naming the key logs a fixed category', async () => {
      const h = harness({ selection: CUSTOM, fetch: neverCalled });
      jest.spyOn(h.secrets, 'get').mockRejectedValue(hostile(SENTINEL));

      const status = await h.config.getStatus();

      expect(status.detail).toBe(DECISION_MODEL_DETAIL.credentialStore);
      expect(h.logger.warn).toHaveBeenCalledWith(
        '[lane-routing] decision model key lookup failed',
        { kind: 'custom', errorName: 'other' },
      );
      expect(loggedText(h.logger)).not.toContain(SENTINEL);
    });

    it('a key-store rejection whose name getter throws logs a fixed category', async () => {
      const h = harness({ selection: CUSTOM, fetch: neverCalled });
      const throwing = new Error('rejected');
      Object.defineProperty(throwing, 'name', {
        get(): string {
          throw new Error(SENTINEL);
        },
      });
      jest.spyOn(h.secrets, 'get').mockRejectedValue(throwing);

      const status = await h.config.getStatus();

      expect(status.detail).toBe(DECISION_MODEL_DETAIL.credentialStore);
      expect(h.logger.warn).toHaveBeenCalledWith(
        '[lane-routing] decision model key lookup failed',
        { kind: 'custom', errorName: 'other' },
      );
      expect(loggedText(h.logger)).not.toContain(SENTINEL);
    });

    it('a mark write rejected with the key in its name logs a fixed category', async () => {
      const server = keyedServer({ notServed: [KEY_A] });
      const h = harness({
        selection: CUSTOM,
        secrets: customKeys(KEY_A),
        fetch: server.fetch,
      });
      h.storage.update.mockRejectedValueOnce(hostile(`Bearer ${KEY_A}`));

      const status = await h.config.getStatus();

      expect(status.state).toBe('unsupported-endpoint');
      expect(h.logger.warn).toHaveBeenCalledWith(
        '[lane-routing] decision model unsupported mark was not persisted',
        { errorName: 'other' },
      );
      expect(loggedText(h.logger)).not.toContain(KEY_A);
    });

    it('a mark read rejected with the key in its name logs a fixed category', async () => {
      const first = harness({ selection: CUSTOM, fetch: neverCalled });
      jest.spyOn(first.storage, 'get').mockImplementation(() => {
        throw hostile(`Bearer ${SENTINEL}`);
      });

      const fresh = restart(first, neverCalled);

      expect(fresh.logger.warn).toHaveBeenCalledWith(
        '[lane-routing] decision model unsupported mark could not be read',
        { errorName: 'other' },
      );
      expect(loggedText(fresh.logger)).not.toContain(SENTINEL);
    });
  });

  describe('round 2, R1-2: a mark loaded after a restart is unverified until reprobed', () => {
    /** Marks CUSTOM unsupported under key A, with a live detail on the mark. */
    async function markedUnderA(): Promise<Harness> {
      const server = keyedServer({ notServed: [KEY_A] });
      const h = harness({
        selection: CUSTOM,
        secrets: customKeys(KEY_A),
        fetch: server.fetch,
      });
      const marked = await h.config.recheckAfterLiveNotFound(
        { selection: CUSTOM, baseUrl: CUSTOM.baseUrl },
        'old 404 under A',
      );
      expect(marked.state).toBe('unsupported-endpoint');
      expect(h.storage.__state.entries.get(MARK_KEY)).toMatchObject({
        selection: CUSTOM,
        detail: expect.stringContaining('old 404 under A'),
      });
      return h;
    }

    async function rotateToB(h: Harness): Promise<void> {
      await h.secrets.store(
        DECISION_MODEL_CUSTOM_SECRET_KEY,
        customKeyValue(GATEWAY, KEY_B),
      );
    }

    it('reports no mark for key B before any probe', async () => {
      const h = await markedUnderA();
      await rotateToB(h);
      const server = keyedServer({ notServed: [] });

      const fresh = restart(h, server.fetch);

      expect(await fresh.config.isMarkedUnsupported()).toBe(false);
      expect(server.calls).toEqual([]);
    });

    it('a ready probe under key B clears the old mark', async () => {
      const h = await markedUnderA();
      await rotateToB(h);
      const server = keyedServer({ notServed: [KEY_A] });
      const fresh = restart(h, server.fetch);

      const status = await fresh.config.getStatus();

      expect(status).toMatchObject({ state: 'ready', detail: null });
      expect(server.calls.map(authorizationOf)).toEqual([
        `Bearer ${KEY_B}`,
        `Bearer ${KEY_B}`,
      ]);
      expect(await fresh.config.isMarkedUnsupported()).toBe(false);
      expect(h.storage.__state.entries.get(MARK_KEY)).toBeUndefined();
    });

    it('an unsupported probe under key B replaces the mark and its detail', async () => {
      const h = await markedUnderA();
      await rotateToB(h);
      const server = keyedServer({ notServed: [KEY_A, KEY_B] });
      const fresh = restart(h, server.fetch);

      const status = await fresh.config.getStatus();

      expect(status.state).toBe('unsupported-endpoint');
      expect(status.detail).not.toContain('old 404 under A');
      expect(server.calls.map(authorizationOf)).toEqual([
        `Bearer ${KEY_B}`,
        `Bearer ${KEY_B}`,
      ]);
      const stored = h.storage.__state.entries.get(MARK_KEY);
      expect(stored).toMatchObject({
        selection: CUSTOM,
        detail: status.detail,
      });
      expect(JSON.stringify(stored)).not.toContain('old 404 under A');
      expect(await fresh.config.isMarkedUnsupported()).toBe(true);

      // The new mark is bound to key B: rotating back to A does not inherit it.
      await h.secrets.store(
        DECISION_MODEL_CUSTOM_SECRET_KEY,
        customKeyValue(GATEWAY, KEY_A),
      );
      expect(await fresh.config.isMarkedUnsupported()).toBe(false);
      for (const text of [loggedText(fresh.logger), persistedText(h)]) {
        expect(text).not.toContain(KEY_A);
        expect(text).not.toContain(KEY_B);
      }
    });

    it('an unreachable probe under key B leaves no usable mark', async () => {
      const h = await markedUnderA();
      await rotateToB(h);
      const unreachable: SystemOneFetch = async () => {
        throw new TypeError('fetch failed');
      };
      const fresh = restart(h, unreachable);

      const status = await fresh.config.getStatus();

      expect(status).toMatchObject({
        state: 'unreachable',
        detail: DECISION_MODEL_DETAIL.unreachable,
      });
      expect(JSON.stringify(status)).not.toContain('old 404 under A');
      expect(await fresh.config.isMarkedUnsupported()).toBe(false);
    });

    it('the same key A is unverified after a restart until a probe confirms it', async () => {
      const h = await markedUnderA();
      const server = keyedServer({ notServed: [KEY_A] });
      const fresh = restart(h, server.fetch);

      expect(await fresh.config.isMarkedUnsupported()).toBe(false);
      expect(server.calls).toEqual([]);

      const status = await fresh.config.getStatus();

      expect(status.state).toBe('unsupported-endpoint');
      expect(server.calls.map(authorizationOf)).toEqual([
        `Bearer ${KEY_A}`,
        `Bearer ${KEY_A}`,
      ]);
      expect(await fresh.config.isMarkedUnsupported()).toBe(true);
    });
  });
});
