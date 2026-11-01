import {
  createMockSecretStorage,
  createMockWorkspaceProvider,
  type MockSecretStorage,
  type MockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import {
  DECISION_MODEL_TIMEOUT_MAX_MS,
  DECISION_MODEL_TIMEOUT_MIN_MS,
  DECISION_MODEL_TIMEOUT_SETTING_KEY,
  OLLAMA_CLOUD_DIRECT_BASE_URL,
  OLLAMA_CLOUD_PROVIDER_ENTRY,
} from '@ptah-extension/shared';
import type { LaneRoutingLogger } from '../lane-routing-logger';
import {
  DECISION_REQUEST_TIMEOUT_MS,
  DECISION_REQUEST_TIMEOUT_REMOTE_MS,
} from '../routing-constants';
import { DECISION_MODEL_DETAIL } from './decision-model.detail';
import { DecisionModelKeys } from './decision-model.keys';
import {
  isBlockedDecisionEndpoint,
  localityOfSelection,
  resolveDecisionEndpoint,
  type DecisionEndpoint,
  type DecisionEndpointDeps,
  type DecisionEndpointResolution,
  type DecisionEndpointSelection,
} from './decision-model.target';
import {
  DECISION_MODEL_CUSTOM_SECRET_KEY,
  DECISION_MODEL_JEV_SECRET_KEY,
  JEV_BASE_URL,
  OLLAMA_CLOUD_SECRET_KEY,
} from './decision-model.types';

/** Keys that must reach only the base URL resolved for them. */
const CLOUD_KEY = 'sk-cloud-sentinel-7f3a';
const JEV_KEY = 'sk-jev-sentinel-91c2';
const CUSTOM_KEY = 'sk-custom-sentinel-0d4e';

const LOCAL_DAEMON = 'http://127.0.0.1:11434';
const OVERRIDE_CONFIG = 'ptah.provider.ollama-cloud.baseUrl';

interface Harness {
  readonly deps: DecisionEndpointDeps;
  readonly secrets: MockSecretStorage;
  readonly workspace: MockWorkspaceProvider;
  readonly logger: jest.Mocked<LaneRoutingLogger>;
  ollamaBase: string;
}

function harness(
  options: {
    readonly secrets?: Record<string, string>;
    readonly config?: Record<string, unknown>;
    readonly ollamaBase?: string;
  } = {},
): Harness {
  const secrets = createMockSecretStorage({ seed: options.secrets ?? {} });
  const workspace = createMockWorkspaceProvider({
    config: options.config ?? {},
  });
  const logger: jest.Mocked<LaneRoutingLogger> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const h: Harness = {
    secrets,
    workspace,
    logger,
    ollamaBase: options.ollamaBase ?? LOCAL_DAEMON,
    deps: {
      workspace,
      keys: new DecisionModelKeys(secrets, logger),
      ollamaBaseUrl: () => h.ollamaBase,
    },
  };
  return h;
}

function customSecret(origin: string, key: string): string {
  return JSON.stringify({ origin, key });
}

/** Narrows a resolution to an endpoint, failing the test otherwise. */
function asEndpoint(resolution: DecisionEndpointResolution): DecisionEndpoint {
  if (resolution === null || isBlockedDecisionEndpoint(resolution)) {
    throw new Error('expected an endpoint');
  }
  return resolution;
}

const REMOTE = DECISION_REQUEST_TIMEOUT_REMOTE_MS;
const LOCAL = DECISION_REQUEST_TIMEOUT_MS;

describe('resolveDecisionEndpoint', () => {
  describe('kinds without System One', () => {
    it.each<DecisionEndpointSelection>([
      { kind: 'unset' },
      { kind: 'structured', providerId: 'anthropic', model: 'claude' },
      { kind: 'structured', providerId: 'ollama', model: 'llama3' },
    ])('returns null for %j', async (selection) => {
      await expect(
        resolveDecisionEndpoint(selection, harness().deps),
      ).resolves.toBeNull();
    });
  });

  describe('ollama', () => {
    it('uses the daemon base URL, no key, daemon probe, local timeout', async () => {
      const h = harness({
        secrets: { [OLLAMA_CLOUD_SECRET_KEY]: CLOUD_KEY },
      });
      const result = asEndpoint(
        await resolveDecisionEndpoint(
          { kind: 'ollama', model: 'clef:27b' },
          h.deps,
        ),
      );
      expect(result).toEqual({
        baseUrl: LOCAL_DAEMON,
        model: 'clef:27b',
        probe: 'daemon',
        locality: 'local',
        timeoutMs: LOCAL,
      });
      expect('apiKey' in result).toBe(false);
    });

    it('reads remote for a cloud-tag model on a loopback daemon (DC7, 1.5)', async () => {
      const result = asEndpoint(
        await resolveDecisionEndpoint(
          { kind: 'ollama', model: 'clef:27b-cloud' },
          harness().deps,
        ),
      );
      expect(result.locality).toBe('remote');
      expect(result.timeoutMs).toBe(REMOTE);
      expect(result.model).toBe('clef:27b-cloud');
    });

    it('reads remote for a non-loopback daemon', async () => {
      const h = harness({ ollamaBase: 'http://gpu-box.lan:11434' });
      const result = asEndpoint(
        await resolveDecisionEndpoint(
          { kind: 'ollama', model: 'clef:27b' },
          h.deps,
        ),
      );
      expect(result.baseUrl).toBe('http://gpu-box.lan:11434');
      expect(result.locality).toBe('remote');
      expect(result.timeoutMs).toBe(REMOTE);
    });
  });

  describe('jev', () => {
    it('sends the stored Jev key to JEV_BASE_URL, no probe, remote', async () => {
      const h = harness({
        secrets: { [DECISION_MODEL_JEV_SECRET_KEY]: JEV_KEY },
      });
      await expect(
        resolveDecisionEndpoint({ kind: 'jev', model: 'jev-1.13.0' }, h.deps),
      ).resolves.toEqual({
        baseUrl: JEV_BASE_URL,
        model: 'jev-1.13.0',
        apiKey: JEV_KEY,
        probe: 'none',
        locality: 'remote',
        timeoutMs: REMOTE,
      });
    });

    it('omits the key when none is stored', async () => {
      const result = asEndpoint(
        await resolveDecisionEndpoint(
          { kind: 'jev', model: 'jev-1.13.0' },
          harness().deps,
        ),
      );
      expect('apiKey' in result).toBe(false);
      expect(result.baseUrl).toBe(JEV_BASE_URL);
    });
  });

  describe('ollama-cloud', () => {
    it('with a key: direct API, the cloud key, endpoint probe, canonical id', async () => {
      const h = harness({ secrets: { [OLLAMA_CLOUD_SECRET_KEY]: CLOUD_KEY } });
      await expect(
        resolveDecisionEndpoint(
          { kind: 'ollama-cloud', model: 'clef:27b' },
          h.deps,
        ),
      ).resolves.toEqual({
        baseUrl: OLLAMA_CLOUD_DIRECT_BASE_URL,
        model: 'clef:27b-cloud',
        apiKey: CLOUD_KEY,
        probe: 'endpoint',
        locality: 'remote',
        timeoutMs: REMOTE,
      });
    });

    it('without a key: the provider daemon, no key, daemon probe, still remote', async () => {
      const result = asEndpoint(
        await resolveDecisionEndpoint(
          { kind: 'ollama-cloud', model: 'clef:27b' },
          harness().deps,
        ),
      );
      expect(result).toEqual({
        baseUrl: OLLAMA_CLOUD_PROVIDER_ENTRY.baseUrl,
        model: 'clef:27b-cloud',
        probe: 'daemon',
        locality: 'remote',
        timeoutMs: REMOTE,
      });
      expect('apiKey' in result).toBe(false);
    });

    it('sends an id that is already canonical unchanged (DC5)', async () => {
      const result = asEndpoint(
        await resolveDecisionEndpoint(
          { kind: 'ollama-cloud', model: 'gpt-oss:120b-cloud' },
          harness().deps,
        ),
      );
      expect(result.model).toBe('gpt-oss:120b-cloud');
    });

    it('never reads the jev or custom slots', async () => {
      const h = harness({
        secrets: {
          [DECISION_MODEL_JEV_SECRET_KEY]: JEV_KEY,
          [DECISION_MODEL_CUSTOM_SECRET_KEY]: customSecret(
            OLLAMA_CLOUD_DIRECT_BASE_URL,
            CUSTOM_KEY,
          ),
        },
      });
      const result = asEndpoint(
        await resolveDecisionEndpoint(
          { kind: 'ollama-cloud', model: 'clef:27b' },
          h.deps,
        ),
      );
      expect('apiKey' in result).toBe(false);
    });

    describe('base URL override (DC6)', () => {
      it('with a key: sends the key to an https override', async () => {
        const h = harness({
          secrets: { [OLLAMA_CLOUD_SECRET_KEY]: CLOUD_KEY },
          config: { [OVERRIDE_CONFIG]: ' https://proxy.example/ollama/ ' },
        });
        const result = asEndpoint(
          await resolveDecisionEndpoint(
            { kind: 'ollama-cloud', model: 'clef:27b' },
            h.deps,
          ),
        );
        expect(result.baseUrl).toBe('https://proxy.example/ollama');
        expect(result.apiKey).toBe(CLOUD_KEY);
        expect(result.probe).toBe('endpoint');
      });

      it('with a key: sends the key to a loopback http override', async () => {
        const h = harness({
          secrets: { [OLLAMA_CLOUD_SECRET_KEY]: CLOUD_KEY },
          config: { [OVERRIDE_CONFIG]: 'http://localhost:11500' },
        });
        const result = asEndpoint(
          await resolveDecisionEndpoint(
            { kind: 'ollama-cloud', model: 'clef:27b' },
            h.deps,
          ),
        );
        expect(result.baseUrl).toBe('http://localhost:11500');
        expect(result.apiKey).toBe(CLOUD_KEY);
        expect(result.locality).toBe('remote');
      });

      it.each(['http://proxy.lan:11434', 'http://10.0.0.9'])(
        'with a key: blocks the override %s with the fixed detail',
        async (override) => {
          const h = harness({
            secrets: { [OLLAMA_CLOUD_SECRET_KEY]: CLOUD_KEY },
            config: { [OVERRIDE_CONFIG]: override },
          });
          const result = await resolveDecisionEndpoint(
            { kind: 'ollama-cloud', model: 'clef:27b' },
            h.deps,
          );
          expect(result).toEqual({
            blocked: true,
            reason: 'key-needs-https',
            detail: DECISION_MODEL_DETAIL.keyNeedsHttps,
          });
          expect(JSON.stringify(result)).not.toContain(CLOUD_KEY);
          expect(JSON.stringify(result)).not.toContain('proxy.lan');
        },
      );

      describe('an override refused by the base URL policy (review defect 2)', () => {
        const INVALID: ReadonlyArray<readonly [string, string]> = [
          ['userinfo', 'https://user:url-secret@gateway.example/gw'],
          ['query', 'https://gateway.example/gw?token=url-secret'],
          ['fragment', 'https://gateway.example/gw#url-secret'],
          ['no http scheme', 'gateway.example/url-secret'],
        ];

        it.each(INVALID)(
          'with a key: blocks a %s override before reading the key',
          async (_component, override) => {
            const h = harness({
              secrets: { [OLLAMA_CLOUD_SECRET_KEY]: CLOUD_KEY },
              config: { [OVERRIDE_CONFIG]: override },
            });
            const read = jest.spyOn(h.secrets, 'get');
            const result = await resolveDecisionEndpoint(
              { kind: 'ollama-cloud', model: 'clef:27b' },
              h.deps,
            );
            expect(result).toEqual({
              blocked: true,
              reason: 'invalid-base-url',
              detail: DECISION_MODEL_DETAIL.invalidCloudBaseUrl,
            });
            expect(read).not.toHaveBeenCalled();
            expect(JSON.stringify(result)).not.toContain('url-secret');
            expect(JSON.stringify(result)).not.toContain(CLOUD_KEY);
          },
        );

        it.each(INVALID)(
          'without a key: blocks a %s override instead of probing it',
          async (_component, override) => {
            const h = harness({ config: { [OVERRIDE_CONFIG]: override } });
            const result = await resolveDecisionEndpoint(
              { kind: 'ollama-cloud', model: 'clef:27b' },
              h.deps,
            );
            expect(result).toEqual({
              blocked: true,
              reason: 'invalid-base-url',
              detail: DECISION_MODEL_DETAIL.invalidCloudBaseUrl,
            });
          },
        );

        it('normalises a valid override with the same policy', async () => {
          const h = harness({
            secrets: { [OLLAMA_CLOUD_SECRET_KEY]: CLOUD_KEY },
            config: { [OVERRIDE_CONFIG]: ' HTTPS://Gateway.Example:443/gw/ ' },
          });
          const result = asEndpoint(
            await resolveDecisionEndpoint(
              { kind: 'ollama-cloud', model: 'clef:27b' },
              h.deps,
            ),
          );
          expect(result.baseUrl).toBe('https://gateway.example/gw');
          expect(result.apiKey).toBe(CLOUD_KEY);
        });
      });

      it('without a key: uses a plain-http override with no key', async () => {
        const h = harness({
          config: { [OVERRIDE_CONFIG]: 'http://proxy.lan:11434/' },
        });
        const result = asEndpoint(
          await resolveDecisionEndpoint(
            { kind: 'ollama-cloud', model: 'clef:27b' },
            h.deps,
          ),
        );
        expect(result.baseUrl).toBe('http://proxy.lan:11434');
        expect(result.probe).toBe('daemon');
        expect('apiKey' in result).toBe(false);
      });

      it('ignores a blank or non-string override', async () => {
        for (const value of ['   ', 42]) {
          const h = harness({
            secrets: { [OLLAMA_CLOUD_SECRET_KEY]: CLOUD_KEY },
            config: { [OVERRIDE_CONFIG]: value },
          });
          const result = asEndpoint(
            await resolveDecisionEndpoint(
              { kind: 'ollama-cloud', model: 'clef:27b' },
              h.deps,
            ),
          );
          expect(result.baseUrl).toBe(OLLAMA_CLOUD_DIRECT_BASE_URL);
        }
      });
    });

    it('sees a key added or removed between two calls (1.4)', async () => {
      const h = harness();
      const selection: DecisionEndpointSelection = {
        kind: 'ollama-cloud',
        model: 'clef:27b',
      };

      const before = asEndpoint(
        await resolveDecisionEndpoint(selection, h.deps),
      );
      expect(before.probe).toBe('daemon');
      expect('apiKey' in before).toBe(false);

      await h.secrets.store(OLLAMA_CLOUD_SECRET_KEY, CLOUD_KEY);
      const added = asEndpoint(
        await resolveDecisionEndpoint(selection, h.deps),
      );
      expect(added.baseUrl).toBe(OLLAMA_CLOUD_DIRECT_BASE_URL);
      expect(added.apiKey).toBe(CLOUD_KEY);
      expect(added.probe).toBe('endpoint');

      await h.secrets.delete(OLLAMA_CLOUD_SECRET_KEY);
      const removed = asEndpoint(
        await resolveDecisionEndpoint(selection, h.deps),
      );
      expect(removed).toEqual(before);
    });

    it('propagates a rejected secret read', async () => {
      const h = harness();
      h.secrets.get.mockRejectedValueOnce(new Error('store locked'));
      await expect(
        resolveDecisionEndpoint(
          { kind: 'ollama-cloud', model: 'clef:27b' },
          h.deps,
        ),
      ).rejects.toThrow('store locked');
    });
  });

  describe('custom', () => {
    const HTTPS_BASE = 'https://gateway.example/gw';

    it('sends the key bound to its origin, endpoint probe, remote', async () => {
      const h = harness({
        secrets: {
          [DECISION_MODEL_CUSTOM_SECRET_KEY]: customSecret(
            'https://gateway.example',
            CUSTOM_KEY,
          ),
        },
      });
      await expect(
        resolveDecisionEndpoint(
          { kind: 'custom', baseUrl: HTTPS_BASE, model: 'clef:27b' },
          h.deps,
        ),
      ).resolves.toEqual({
        baseUrl: HTTPS_BASE,
        model: 'clef:27b',
        apiKey: CUSTOM_KEY,
        probe: 'endpoint',
        locality: 'remote',
        timeoutMs: REMOTE,
      });
    });

    it('does not send a key stored for another origin (DC3)', async () => {
      const h = harness({
        secrets: {
          [DECISION_MODEL_CUSTOM_SECRET_KEY]: customSecret(
            'https://other.example',
            CUSTOM_KEY,
          ),
        },
      });
      const result = asEndpoint(
        await resolveDecisionEndpoint(
          { kind: 'custom', baseUrl: HTTPS_BASE, model: 'clef:27b' },
          h.deps,
        ),
      );
      expect('apiKey' in result).toBe(false);
      expect(JSON.stringify(result)).not.toContain(CUSTOM_KEY);
    });

    it('never sends the Ollama Cloud or Jev key', async () => {
      const h = harness({
        secrets: {
          [OLLAMA_CLOUD_SECRET_KEY]: CLOUD_KEY,
          [DECISION_MODEL_JEV_SECRET_KEY]: JEV_KEY,
        },
      });
      const result = asEndpoint(
        await resolveDecisionEndpoint(
          { kind: 'custom', baseUrl: OLLAMA_CLOUD_DIRECT_BASE_URL, model: 'm' },
          h.deps,
        ),
      );
      expect('apiKey' in result).toBe(false);
    });

    it('reads local for a loopback base and a local model (DC7)', async () => {
      const h = harness({
        secrets: {
          [DECISION_MODEL_CUSTOM_SECRET_KEY]: customSecret(
            'http://127.0.0.1:8080',
            CUSTOM_KEY,
          ),
        },
      });
      const result = asEndpoint(
        await resolveDecisionEndpoint(
          {
            kind: 'custom',
            baseUrl: 'http://127.0.0.1:8080',
            model: 'clef:27b',
          },
          h.deps,
        ),
      );
      expect(result.apiKey).toBe(CUSTOM_KEY);
      expect(result.locality).toBe('local');
      expect(result.timeoutMs).toBe(LOCAL);
    });

    it('reads remote for a cloud-tag model on a loopback base (1.5)', async () => {
      const result = asEndpoint(
        await resolveDecisionEndpoint(
          {
            kind: 'custom',
            baseUrl: 'http://localhost:11434',
            model: 'clef:27b-cloud',
          },
          harness().deps,
        ),
      );
      expect(result.locality).toBe('remote');
      expect(result.timeoutMs).toBe(REMOTE);
    });

    it('allows plain http to a LAN host without a key (D4)', async () => {
      const result = asEndpoint(
        await resolveDecisionEndpoint(
          { kind: 'custom', baseUrl: 'http://gpu-box.lan:11434', model: 'm' },
          harness().deps,
        ),
      );
      expect(result.baseUrl).toBe('http://gpu-box.lan:11434');
      expect('apiKey' in result).toBe(false);
      expect(result.locality).toBe('remote');
    });

    it('blocks a key that would cross plain http to a LAN host (D4)', async () => {
      const h = harness({
        secrets: {
          [DECISION_MODEL_CUSTOM_SECRET_KEY]: customSecret(
            'http://gpu-box.lan:11434',
            CUSTOM_KEY,
          ),
        },
      });
      const result = await resolveDecisionEndpoint(
        { kind: 'custom', baseUrl: 'http://gpu-box.lan:11434', model: 'm' },
        h.deps,
      );
      expect(result).toEqual({
        blocked: true,
        reason: 'key-needs-https',
        detail: DECISION_MODEL_DETAIL.keyNeedsHttps,
      });
      expect(JSON.stringify(result)).not.toContain(CUSTOM_KEY);
      expect(JSON.stringify(result)).not.toContain('gpu-box');
    });

    it('sees a custom key added or removed between two calls (1.4)', async () => {
      const h = harness();
      const selection: DecisionEndpointSelection = {
        kind: 'custom',
        baseUrl: HTTPS_BASE,
        model: 'm',
      };
      const before = asEndpoint(
        await resolveDecisionEndpoint(selection, h.deps),
      );
      expect('apiKey' in before).toBe(false);

      await h.secrets.store(
        DECISION_MODEL_CUSTOM_SECRET_KEY,
        customSecret('https://gateway.example', CUSTOM_KEY),
      );
      const added = asEndpoint(
        await resolveDecisionEndpoint(selection, h.deps),
      );
      expect(added.apiKey).toBe(CUSTOM_KEY);

      await h.secrets.delete(DECISION_MODEL_CUSTOM_SECRET_KEY);
      const removed = asEndpoint(
        await resolveDecisionEndpoint(selection, h.deps),
      );
      expect(removed).toEqual(before);
    });
  });

  it('never logs a key', async () => {
    const h = harness({
      secrets: {
        [OLLAMA_CLOUD_SECRET_KEY]: CLOUD_KEY,
        [DECISION_MODEL_JEV_SECRET_KEY]: JEV_KEY,
        [DECISION_MODEL_CUSTOM_SECRET_KEY]: customSecret(
          'http://gpu-box.lan:11434',
          CUSTOM_KEY,
        ),
      },
    });
    const selections: DecisionEndpointSelection[] = [
      { kind: 'ollama', model: 'm' },
      { kind: 'jev', model: 'jev-1.13.0' },
      { kind: 'ollama-cloud', model: 'clef:27b' },
      { kind: 'custom', baseUrl: 'http://gpu-box.lan:11434', model: 'm' },
    ];
    for (const selection of selections) {
      await resolveDecisionEndpoint(selection, h.deps);
    }
    const logged = JSON.stringify([
      h.logger.debug.mock.calls,
      h.logger.info.mock.calls,
      h.logger.warn.mock.calls,
      h.logger.error.mock.calls,
    ]);
    for (const key of [CLOUD_KEY, JEV_KEY, CUSTOM_KEY]) {
      expect(logged).not.toContain(key);
    }
  });
});

describe('resolveDecisionEndpoint request timeout setting', () => {
  const TIMEOUT_CONFIG = `ptah.${DECISION_MODEL_TIMEOUT_SETTING_KEY}`;
  const local = { kind: 'ollama', model: 'clef:27b' } as const;
  const remote = { kind: 'ollama', model: 'clef:27b-cloud' } as const;

  async function timeoutWith(
    selection: DecisionEndpointSelection,
    value: unknown,
    secrets: Record<string, string> = {},
  ): Promise<number> {
    const config = value === undefined ? {} : { [TIMEOUT_CONFIG]: value };
    const h = harness({ config, secrets });
    return asEndpoint(await resolveDecisionEndpoint(selection, h.deps))
      .timeoutMs;
  }

  it('keeps the locality defaults when the setting is unset', async () => {
    await expect(timeoutWith(local, undefined)).resolves.toBe(LOCAL);
    await expect(timeoutWith(remote, undefined)).resolves.toBe(REMOTE);
  });

  it('uses a configured value for both localities and every System One kind', async () => {
    await expect(timeoutWith(local, 30_000)).resolves.toBe(30_000);
    await expect(timeoutWith(remote, 30_000)).resolves.toBe(30_000);
    await expect(
      timeoutWith({ kind: 'jev', model: 'jev-1.13.0' }, 30_000, {
        [DECISION_MODEL_JEV_SECRET_KEY]: JEV_KEY,
      }),
    ).resolves.toBe(30_000);
    await expect(
      timeoutWith({ kind: 'ollama-cloud', model: 'clef:27b' }, 30_000),
    ).resolves.toBe(30_000);
    await expect(
      timeoutWith(
        { kind: 'custom', baseUrl: 'http://10.0.0.5:8080', model: 'd3:4b' },
        30_000,
      ),
    ).resolves.toBe(30_000);
  });

  it.each<[number, number]>([
    [1, DECISION_MODEL_TIMEOUT_MIN_MS],
    [999.4, DECISION_MODEL_TIMEOUT_MIN_MS],
    [12_345.6, 12_346],
    [60_001, DECISION_MODEL_TIMEOUT_MAX_MS],
    [Number.MAX_SAFE_INTEGER, DECISION_MODEL_TIMEOUT_MAX_MS],
  ])('rounds and clamps %p to %p', async (value, expected) => {
    await expect(timeoutWith(local, value)).resolves.toBe(expected);
  });

  it.each<unknown>([null, '15000', 0, -5, Number.NaN, Infinity, true, {}])(
    'ignores the invalid value %p',
    async (value) => {
      await expect(timeoutWith(local, value)).resolves.toBe(LOCAL);
      await expect(timeoutWith(remote, value)).resolves.toBe(REMOTE);
    },
  );
});

describe('localityOfSelection', () => {
  const base = (url: string): Pick<DecisionEndpointDeps, 'ollamaBaseUrl'> => ({
    ollamaBaseUrl: () => url,
  });

  it.each<[DecisionEndpointSelection, string, 'local' | 'remote' | null]>([
    [{ kind: 'unset' }, LOCAL_DAEMON, null],
    [{ kind: 'jev', model: 'jev-1.13.0' }, LOCAL_DAEMON, 'remote'],
    [{ kind: 'ollama-cloud', model: 'clef:27b' }, LOCAL_DAEMON, 'remote'],
    [{ kind: 'ollama', model: 'clef:27b' }, LOCAL_DAEMON, 'local'],
    [{ kind: 'ollama', model: 'clef:27b-cloud' }, LOCAL_DAEMON, 'remote'],
    [{ kind: 'ollama', model: 'gpt-oss:cloud' }, LOCAL_DAEMON, 'remote'],
    [
      { kind: 'ollama', model: 'clef:27b' },
      'http://gpu-box.lan:11434',
      'remote',
    ],
    [
      { kind: 'structured', providerId: 'ollama', model: 'llama3' },
      LOCAL_DAEMON,
      'local',
    ],
    [
      { kind: 'structured', providerId: 'ollama', model: 'qwen3:480b-cloud' },
      LOCAL_DAEMON,
      'remote',
    ],
    [
      { kind: 'structured', providerId: 'anthropic', model: 'claude' },
      LOCAL_DAEMON,
      'remote',
    ],
    [
      { kind: 'custom', baseUrl: 'http://[::1]:8080', model: 'clef:27b' },
      'http://gpu-box.lan:11434',
      'local',
    ],
    [
      { kind: 'custom', baseUrl: 'https://gateway.example', model: 'm' },
      LOCAL_DAEMON,
      'remote',
    ],
  ])('%j with daemon %s reads %s', (selection, daemon, expected) => {
    expect(localityOfSelection(selection, base(daemon))).toBe(expected);
  });

  it('matches the locality the resolver returns', async () => {
    const h = harness({ secrets: { [OLLAMA_CLOUD_SECRET_KEY]: CLOUD_KEY } });
    const selections: DecisionEndpointSelection[] = [
      { kind: 'ollama', model: 'clef:27b' },
      { kind: 'ollama', model: 'clef:27b-cloud' },
      { kind: 'jev', model: 'jev-1.13.0' },
      { kind: 'ollama-cloud', model: 'clef:27b' },
      { kind: 'custom', baseUrl: 'http://127.0.0.1:8080', model: 'm' },
    ];
    for (const selection of selections) {
      const result = asEndpoint(
        await resolveDecisionEndpoint(selection, h.deps),
      );
      expect(result.locality).toBe(localityOfSelection(selection, h.deps));
    }
  });

  it('reads no key', () => {
    const h = harness({ secrets: { [OLLAMA_CLOUD_SECRET_KEY]: CLOUD_KEY } });
    localityOfSelection({ kind: 'ollama-cloud', model: 'clef:27b' }, h.deps);
    localityOfSelection(
      { kind: 'custom', baseUrl: 'https://gateway.example', model: 'm' },
      h.deps,
    );
    expect(h.secrets.get).not.toHaveBeenCalled();
  });
});
