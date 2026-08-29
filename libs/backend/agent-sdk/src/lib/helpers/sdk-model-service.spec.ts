/**
 * SdkModelService — model list composition tests.
 *
 * Covers the two ways the active provider used to bleed into a model picker:
 *  1. third-party auth surfacing Anthropic-only ids its proxy cannot serve
 *     (`claude-fable-5[1m]` / `opus[1m]`),
 *  2. the native Claude login being fetched under the ACTIVE provider's env.
 */

import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { AuthEnv } from '@ptah-extension/shared';
import { SdkModelService } from './sdk-model-service';
import type {
  ModelInfo,
  SpawnOptions,
  SpawnedProcess,
} from '../types/sdk-types/claude-sdk.types';
import type { SdkModuleLoader } from './sdk-module-loader';
import type { OffThreadProcessSpawner } from './off-thread-process-spawner';
import type { IModelResolver, IAuthEnvProvider } from '../auth-env.port';

type AuthMethod = 'claudeCli' | 'apiKey' | 'thirdParty';

/** The subset of the SDK query options these specs assert on. */
interface CapturedQueryOptions {
  env: Record<string, string | undefined>;
  spawnClaudeCodeProcess?: (options: SpawnOptions) => SpawnedProcess;
}

interface Harness {
  service: SdkModelService;
  /** Env the SDK bridge was actually spawned with, per call. */
  spawnEnvs: Array<Record<string, string | undefined>>;
  /** Full options the SDK bridge was launched with, per call. */
  queryOptions: CapturedQueryOptions[];
  /** The auth env object the service reads — mutated in place, as in production. */
  authEnv: AuthEnv;
  /** Swap the active auth method the way an auth strategy would. */
  setAuthMethod: (method: AuthMethod) => void;
  /** Records every call the service routes through `OffThreadProcessSpawner`. */
  offThreadSpawns: SpawnOptions[];
}

function makeHarness(opts: {
  authMethod: AuthMethod;
  authEnv?: AuthEnv;
  sdkModels: ModelInfo[];
  tiers?: Record<string, string>;
}): Harness {
  const logger = {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;

  const spawnEnvs: Array<Record<string, string | undefined>> = [];
  const queryOptions: CapturedQueryOptions[] = [];

  const moduleLoader = {
    getCliJsPath: jest.fn().mockResolvedValue('/fake/cli.js'),
    getQueryFunction: jest
      .fn()
      .mockResolvedValue((args: { options: CapturedQueryOptions }) => {
        spawnEnvs.push(args.options.env);
        queryOptions.push(args.options);
        return {
          supportedModels: async () => opts.sdkModels,
          close: () => undefined,
        };
      }),
  } as unknown as SdkModuleLoader;

  const tiers = opts.tiers ?? {};
  const modelResolver: IModelResolver = {
    resolve: (model: string) => tiers[model] ?? model,
  } as unknown as IModelResolver;

  let authMethod = opts.authMethod;
  const authProvider = {
    resolveActiveAuth: () => ({ authMethod }),
  } as unknown as IAuthEnvProvider;

  const offThreadSpawns: SpawnOptions[] = [];
  const processSpawner = {
    spawn: (spawnOptions: SpawnOptions) => {
      offThreadSpawns.push(spawnOptions);
      return {} as SpawnedProcess;
    },
  } as unknown as OffThreadProcessSpawner;

  const authEnv: AuthEnv = opts.authEnv ?? {};

  return {
    service: new SdkModelService(
      logger,
      moduleLoader,
      authEnv,
      modelResolver,
      authProvider,
      processSpawner,
    ),
    spawnEnvs,
    queryOptions,
    authEnv,
    setAuthMethod: (method: AuthMethod) => {
      authMethod = method;
    },
    offThreadSpawns,
  };
}

/** The list the SDK reports through a third-party translation proxy. */
const SDK_LIST_VIA_PROXY: ModelInfo[] = [
  { value: 'default', displayName: 'Default (recommended)', description: '' },
  { value: 'opus', displayName: 'gpt-5.6-luna', description: '' },
  { value: 'claude-fable-5[1m]', displayName: 'Fable', description: '' },
  { value: 'sonnet', displayName: 'gpt-5.6-terra', description: '' },
  { value: 'haiku', displayName: 'gpt-5.5', description: '' },
  { value: 'opus[1m]', displayName: 'Opus (1M context)', description: '' },
];

describe('SdkModelService', () => {
  describe('third-party tier mapping', () => {
    it('drops Anthropic-only ids the provider proxy cannot serve', async () => {
      const h = makeHarness({
        authMethod: 'thirdParty',
        authEnv: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:58306' },
        sdkModels: SDK_LIST_VIA_PROXY,
        tiers: {
          opus: 'gpt-5.6-luna',
          sonnet: 'gpt-5.6-terra',
          haiku: 'gpt-5.5',
        },
      });

      const models = await h.service.getSupportedModels();

      expect(models.map((m) => m.value)).toEqual([
        'default',
        'gpt-5.6-luna',
        'gpt-5.6-terra',
        'gpt-5.5',
      ]);
      expect(models.map((m) => m.displayName)).not.toContain('Fable');
      expect(models.map((m) => m.displayName)).not.toContain(
        'Opus (1M context)',
      );
    });

    it('still collapses tiers that resolve to the same provider model', async () => {
      const h = makeHarness({
        authMethod: 'thirdParty',
        authEnv: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:58306' },
        sdkModels: SDK_LIST_VIA_PROXY,
        tiers: {
          opus: 'gpt-5.4',
          sonnet: 'gpt-5.3-codex',
          haiku: 'gpt-5.4',
        },
      });

      const models = await h.service.getSupportedModels();

      expect(models.map((m) => m.value)).toEqual([
        'default',
        'gpt-5.4',
        'gpt-5.3-codex',
      ]);
    });
  });

  describe('claudeCli auth', () => {
    it('returns the SDK list untouched — Anthropic ids are valid there', async () => {
      const h = makeHarness({
        authMethod: 'claudeCli',
        sdkModels: [
          {
            value: 'opus[1m]',
            displayName: 'Opus (1M context)',
            description: '',
          },
          {
            value: 'claude-fable-5[1m]',
            displayName: 'Fable',
            description: '',
          },
        ],
      });

      const models = await h.service.getSupportedModels();

      expect(models.map((m) => m.value)).toEqual([
        'opus[1m]',
        'claude-fable-5[1m]',
      ]);
    });
  });

  describe('getNativeClaudeModels', () => {
    const PROXY_URL = 'http://127.0.0.1:58306';

    it('spawns the SDK bridge with the proxy env unset even when process.env carries it', async () => {
      const previous = process.env['ANTHROPIC_BASE_URL'];
      process.env['ANTHROPIC_BASE_URL'] = PROXY_URL;
      try {
        const h = makeHarness({
          authMethod: 'thirdParty',
          authEnv: {
            ANTHROPIC_BASE_URL: PROXY_URL,
            ANTHROPIC_AUTH_TOKEN: 'proxy-token',
            ANTHROPIC_DEFAULT_OPUS_MODEL: 'gpt-5.6-luna',
          },
          sdkModels: [
            {
              value: 'opus[1m]',
              displayName: 'Opus (1M context)',
              description: '',
            },
            {
              value: 'claude-fable-5[1m]',
              displayName: 'Fable',
              description: '',
            },
          ],
        });

        const models = await h.service.getNativeClaudeModels();

        expect(models.map((m) => m.displayName)).toEqual([
          'Opus (1M context)',
          'Fable',
        ]);
        expect(h.spawnEnvs).toHaveLength(1);
        expect(h.spawnEnvs[0]['ANTHROPIC_BASE_URL']).toBeUndefined();
        expect(h.spawnEnvs[0]['ANTHROPIC_AUTH_TOKEN']).toBeUndefined();
        expect(h.spawnEnvs[0]['ANTHROPIC_DEFAULT_OPUS_MODEL']).toBeUndefined();
      } finally {
        if (previous === undefined) delete process.env['ANTHROPIC_BASE_URL'];
        else process.env['ANTHROPIC_BASE_URL'] = previous;
      }
    });

    it('never applies third-party tier mapping to the native list', async () => {
      const h = makeHarness({
        authMethod: 'thirdParty',
        authEnv: { ANTHROPIC_BASE_URL: PROXY_URL },
        sdkModels: [
          { value: 'opus', displayName: 'Claude Opus 4.8', description: '' },
          {
            value: 'sonnet',
            displayName: 'Claude Sonnet 4.6',
            description: '',
          },
        ],
        tiers: { opus: 'gpt-5.6-luna', sonnet: 'gpt-5.6-terra' },
      });

      const models = await h.service.getNativeClaudeModels();

      expect(models.map((m) => m.value)).toEqual(['opus', 'sonnet']);
    });

    it('caches the native list across calls', async () => {
      const h = makeHarness({
        authMethod: 'thirdParty',
        authEnv: { ANTHROPIC_BASE_URL: PROXY_URL },
        sdkModels: [
          {
            value: 'opus[1m]',
            displayName: 'Opus (1M context)',
            description: '',
          },
        ],
      });

      await h.service.getNativeClaudeModels();
      await h.service.getNativeClaudeModels();

      expect(h.spawnEnvs).toHaveLength(1);
    });

    it('delegates to the shared cache when the native login is already active', async () => {
      const h = makeHarness({
        authMethod: 'claudeCli',
        sdkModels: [
          {
            value: 'opus[1m]',
            displayName: 'Opus (1M context)',
            description: '',
          },
        ],
      });

      await h.service.getSupportedModels();
      const models = await h.service.getNativeClaudeModels();

      expect(models.map((m) => m.value)).toEqual(['opus[1m]']);
      expect(h.spawnEnvs).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // TASK_2026_353 — one spawn per auth identity, and never on the caller's
  // thread. `config:models-list` took 7095 ms on its first call and was asked
  // six more times per boot (tmp/logs/log.log:753, 868, 1195, ...), with the
  // blocking spawn showing as 1803 ms / 1992 ms of `[event-loop] lag`.
  // -------------------------------------------------------------------------
  describe('catalog caching', () => {
    const ONE_MODEL: ModelInfo[] = [
      { value: 'opus[1m]', displayName: 'Opus (1M context)', description: '' },
    ];

    /**
     * An API-key harness that reaches the SDK bridge and caches what it finds.
     *
     * Two constraints, both from `fetchSupportedModelsInternal`: a local base
     * URL makes `fetchApiModels` skip `/v1/models` (no network from a unit
     * spec), and the model id must start with `claude-` or the result is
     * classified as the degraded API-key fallback and deliberately not cached.
     */
    function apiKeyHarnessOpts(apiKey: string) {
      return {
        authMethod: 'apiKey' as const,
        authEnv: {
          ANTHROPIC_API_KEY: apiKey,
          ANTHROPIC_BASE_URL: 'http://127.0.0.1:58306',
        },
        sdkModels: [
          {
            value: 'claude-sonnet-4-5',
            displayName: 'Sonnet 4.5',
            description: '',
          },
        ],
      };
    }

    it('does not spawn the SDK bridge again for a second call', async () => {
      const h = makeHarness({ authMethod: 'claudeCli', sdkModels: ONE_MODEL });

      const first = await h.service.getSupportedModels();
      const second = await h.service.getSupportedModels();

      expect(h.spawnEnvs).toHaveLength(1);
      expect(second.map((m) => m.value)).toEqual(first.map((m) => m.value));
    });

    it('coalesces concurrent callers onto one spawn', async () => {
      const h = makeHarness({ authMethod: 'claudeCli', sdkModels: ONE_MODEL });

      await Promise.all([
        h.service.getSupportedModels(),
        h.service.getSupportedModels(),
        h.service.getSupportedModels(),
      ]);

      expect(h.spawnEnvs).toHaveLength(1);
    });

    it('re-fetches when the active auth method changes', async () => {
      const h = makeHarness({ authMethod: 'claudeCli', sdkModels: ONE_MODEL });

      await h.service.getSupportedModels();
      h.setAuthMethod('thirdParty');
      h.authEnv.ANTHROPIC_BASE_URL = 'http://127.0.0.1:58306';
      await h.service.getSupportedModels();

      expect(h.spawnEnvs).toHaveLength(2);
    });

    it('re-fetches when the credential changes under the same auth method', async () => {
      const h = makeHarness(apiKeyHarnessOpts('sk-first'));

      await h.service.getSupportedModels();
      h.authEnv.ANTHROPIC_API_KEY = 'sk-second';
      await h.service.getSupportedModels();

      expect(h.spawnEnvs).toHaveLength(2);
    });

    it('re-fetches when a tier remap changes under the same provider', async () => {
      const h = makeHarness({
        authMethod: 'thirdParty',
        authEnv: {
          ANTHROPIC_BASE_URL: 'http://127.0.0.1:58306',
          ANTHROPIC_DEFAULT_OPUS_MODEL: 'gpt-5.6-luna',
        },
        sdkModels: [
          { value: 'opus', displayName: 'gpt-5.6-luna', description: '' },
        ],
        tiers: { opus: 'gpt-5.6-luna' },
      });

      await h.service.getSupportedModels();
      h.authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL = 'gpt-5.7-luna';
      await h.service.getSupportedModels();

      expect(h.spawnEnvs).toHaveLength(2);
    });

    it('re-fetches after clearCache()', async () => {
      const h = makeHarness({ authMethod: 'claudeCli', sdkModels: ONE_MODEL });

      await h.service.getSupportedModels();
      h.service.clearCache();
      await h.service.getSupportedModels();

      expect(h.spawnEnvs).toHaveLength(2);
    });

    it('reports hasCachedModels() per auth identity, not globally', async () => {
      const h = makeHarness(apiKeyHarnessOpts('sk-first'));

      expect(h.service.hasCachedModels()).toBe(false);
      await h.service.getSupportedModels();
      expect(h.service.hasCachedModels()).toBe(true);

      h.authEnv.ANTHROPIC_API_KEY = 'sk-second';
      expect(h.service.hasCachedModels()).toBe(false);
    });
  });

  describe('off-thread bridge spawn', () => {
    it('hands the SDK a spawnClaudeCodeProcess backed by OffThreadProcessSpawner', async () => {
      const h = makeHarness({
        authMethod: 'claudeCli',
        sdkModels: [
          { value: 'sonnet', displayName: 'Sonnet', description: '' },
        ],
      });

      await h.service.getSupportedModels();

      const spawner = h.queryOptions[0]?.spawnClaudeCodeProcess;
      expect(typeof spawner).toBe('function');

      const spawnOptions = {
        command: 'claude',
        args: ['--print'],
        cwd: '/home/testuser',
        env: {},
        signal: new AbortController().signal,
      } as unknown as SpawnOptions;
      spawner?.(spawnOptions);

      expect(h.offThreadSpawns).toEqual([spawnOptions]);
    });
  });
});
