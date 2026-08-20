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
import type { ModelInfo } from '../types/sdk-types/claude-sdk.types';
import type { SdkModuleLoader } from './sdk-module-loader';
import type { IModelResolver, IAuthEnvProvider } from '../auth-env.port';

type AuthMethod = 'claudeCli' | 'apiKey' | 'thirdParty';

interface Harness {
  service: SdkModelService;
  /** Env the SDK bridge was actually spawned with, per call. */
  spawnEnvs: Array<Record<string, string | undefined>>;
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

  const moduleLoader = {
    getCliJsPath: jest.fn().mockResolvedValue('/fake/cli.js'),
    getQueryFunction: jest
      .fn()
      .mockResolvedValue(
        (args: { options: { env: Record<string, string> } }) => {
          spawnEnvs.push(args.options.env);
          return {
            supportedModels: async () => opts.sdkModels,
            close: () => undefined,
          };
        },
      ),
  } as unknown as SdkModuleLoader;

  const tiers = opts.tiers ?? {};
  const modelResolver: IModelResolver = {
    resolve: (model: string) => tiers[model] ?? model,
  } as unknown as IModelResolver;

  const authProvider = {
    resolveActiveAuth: () => ({ authMethod: opts.authMethod }),
  } as unknown as IAuthEnvProvider;

  return {
    service: new SdkModelService(
      logger,
      moduleLoader,
      opts.authEnv ?? {},
      modelResolver,
      authProvider,
    ),
    spawnEnvs,
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
});
