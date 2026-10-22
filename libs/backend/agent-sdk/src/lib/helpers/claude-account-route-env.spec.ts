import 'reflect-metadata';

import type {
  ClaudeAccountRoute,
  ClaudeAccountNamedRoute,
  ClaudeAccountAmbientRoute,
} from '@ptah-extension/auth-providers-tokens';
import type { AISessionConfig, AuthEnv } from '@ptah-extension/shared';
import { applyClaudeAccountRouteEnv } from './claude-account-route-env';
import { buildSafeEnv } from './build-safe-env';
import { buildTierEnvDefaults } from './sdk-model-service';
import {
  SdkQueryOptionsBuilder,
  unverifiedCapabilityPolicy,
} from './sdk-query-options-builder';
import { SdkQueryRunner } from './sdk-query-runner.service';

// Admission is outside this unit. Assertions represent already-admitted fixtures;
// production callers cannot construct the certification brand via the public API.
const named = {
  kind: 'named',
  provider: 'claude',
  profileId: 'fixture',
  canonicalConfigDir: 'D:/accounts/selected',
  routeFingerprint: 'fixture',
  routeRevision: 1,
  authEpoch: 1,
  runId: 'fixture-run',
} as ClaudeAccountNamedRoute;
const ambient = { kind: 'ambient' } as ClaudeAccountAmbientRoute;

// Independent enumeration pins every selector in the admission contract.
const conflictingSelectors = [
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  'CLAUDE_CODE_API_KEY_HELPER_TTL_MS',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
  'CLAUDE_CODE_SKIP_VERTEX_AUTH',
  'CLAUDE_CODE_SKIP_FOUNDRY_AUTH',
  'AWS_PROFILE',
  'AWS_DEFAULT_PROFILE',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
  'CLOUD_ML_REGION',
  'ANTHROPIC_VERTEX_PROJECT_ID',
  'ANTHROPIC_FOUNDRY_RESOURCE',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'AZURE_CLIENT_ID',
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_SECRET',
] as const;
const polluted = Object.fromEntries(
  conflictingSelectors.map((key) => [key, 'foreign']),
);
const inherited: Record<string, string | undefined> = {
  ...polluted,
  CLAUDE_CONFIG_DIR: 'D:/accounts/ambient',
  HOME: 'D:/home',
  USERPROFILE: 'D:/profile',
  XDG_CONFIG_HOME: 'D:/xdg',
  XDG_DATA_HOME: 'D:/data',
  XDG_CACHE_HOME: 'D:/cache',
  PATH: 'D:/bin',
  NODE_OPTIONS: '--no-warnings',
  CUSTOM: '',
  UNSET: undefined,
};
const authEnv: AuthEnv = {} as AuthEnv;
const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
const hooks = { createHooks: jest.fn().mockReturnValue({}) };
const compaction = {
  getConfig: () => ({ enabled: true, contextTokenThreshold: null }),
};
const model = {
  resolveModelId: (id: string) => id,
  hasCachedModels: () => false,
};

function makeBuilder(): SdkQueryOptionsBuilder {
  return Reflect.construct(SdkQueryOptionsBuilder, [
    logger,
    { createCallback: jest.fn() },
    hooks,
    compaction,
    hooks,
    hooks,
    authEnv,
    model,
    {
      buildBlock: async () => '',
      buildSessionStartBlock: async () => '',
      buildCorpusBlock: async () => '',
    },
    hooks,
    hooks,
    hooks,
    hooks,
    hooks,
    hooks,
    hooks,
    hooks,
    hooks,
    hooks,
  ]) as SdkQueryOptionsBuilder;
}

async function mainOptions(accountRoute?: ClaudeAccountRoute) {
  return (
    await makeBuilder().build({
      accountRoute,
      userMessageStream: (async function* () {
        /* no launch */
      })(),
      abortController: new AbortController(),
      mcpServerRunning: false,
      sessionConfig: {
        model: 'claude-sonnet-4',
        projectPath: 'D:/repo',
        workflowsDisabled: true,
      } as AISessionConfig,
    })
  ).options;
}

function oneShotOptions(accountRoute?: ClaudeAccountRoute) {
  const runner = Reflect.construct(SdkQueryRunner, [
    logger,
    {},
    {},
    hooks,
    compaction,
    authEnv,
    model,
    {},
    { spawn: jest.fn() },
  ]) as SdkQueryRunner;
  // Exercise the real constructor without loading or launching a vendor SDK.
  return runner['buildOneShotOptions'](
    {
      mode: 'oneShot',
      cwd: 'D:/repo',
      model: 'claude-sonnet-4',
      prompt: 'fixture',
      mcpServerRunning: false,
      toolAccess: 'none',
      accountRoute,
    },
    new AbortController(),
    null,
    unverifiedCapabilityPolicy('D:/repo', 'fixture'),
  );
}

describe('applyClaudeAccountRouteEnv', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(conflictingSelectors)(
    'clears certified conflicting selector %s for a named route',
    (key) => {
      const base = Object.freeze({ ...inherited });
      const result = applyClaudeAccountRouteEnv(base, named);
      expect(result).not.toBe(base);
      expect(result).not.toHaveProperty(key);
      expect(result['CLAUDE_CONFIG_DIR']).toBe(named.canonicalConfigDir);
      expect(base[key]).toBe('foreign');
    },
  );

  it('clears Windows selector casing without clearing unrelated keys', () => {
    const result = applyClaudeAccountRouteEnv(
      {
        anthropic_api_key: 'foreign',
        Claude_Config_Dir: 'foreign',
        AWS_UNRELATED: 'keep',
      },
      named,
    );
    expect(result).toEqual({
      CLAUDE_CONFIG_DIR: named.canonicalConfigDir,
      AWS_UNRELATED: 'keep',
    });
  });

  it.each([ambient, undefined])(
    'returns ambient or omitted env by identity including preconfigured directory',
    (route) => {
      expect(applyClaudeAccountRouteEnv(inherited, route)).toBe(inherited);
    },
  );

  it('does not mutate process.env or AuthEnv', () => {
    const before = { ...process.env };
    applyClaudeAccountRouteEnv(process.env, named);
    expect(process.env).toEqual(before);
    const auth = Object.freeze({ ANTHROPIC_API_KEY: 'fixture' });
    applyClaudeAccountRouteEnv(auth, named);
    expect(auth).toEqual({ ANTHROPIC_API_KEY: 'fixture' });
  });

  it('preserves the native safe allowlist and does not invent an ambient directory', () => {
    jest.replaceProperty(process, 'env', { ...inherited });
    const safe = buildSafeEnv(authEnv);
    expect(safe).not.toHaveProperty('CLAUDE_CONFIG_DIR');
    expect(safe).not.toHaveProperty('CUSTOM');
    expect(applyClaudeAccountRouteEnv(safe, ambient)).toBe(safe);
    expect(applyClaudeAccountRouteEnv(safe)).toBe(safe);
    const routed = applyClaudeAccountRouteEnv(safe, named);
    for (const [key, value] of Object.entries(safe)) {
      if (!conflictingSelectors.some((selector) => selector === key))
        expect(routed[key]).toBe(value);
    }
  });

  it('accepts only the admitted route and has no extra env or deletion options', () => {
    type Args = Parameters<typeof applyClaudeAccountRouteEnv>;
    type Same<A, B> =
      (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
        ? true
        : false;
    const exactRoute: Same<Args[1], ClaudeAccountRoute | undefined> = true;
    const closedArity: Same<Args['length'], 1 | 2> = true;
    const rejectsPath: string extends NonNullable<Args[1]> ? false : true =
      true;
    const rejectsUnadmitted: {
      kind: 'named';
      canonicalConfigDir: string;
    } extends NonNullable<Args[1]>
      ? false
      : true = true;
    expect([exactRoute, closedArity, rejectsPath, rejectsUnadmitted]).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  describe.each([
    ['main', mainOptions],
    ['one-shot', oneShotOptions],
  ] as const)('%s completed child env', (kind, options) => {
    beforeEach(() => jest.replaceProperty(process, 'env', { ...inherited }));

    it.each([ambient, undefined])(
      'keeps ambient/omitted env byte-equivalent to the existing constructor',
      async (route) => {
        const result = await options(route);
        const expected = {
          ...process.env,
          ...buildTierEnvDefaults(authEnv),
          ...authEnv,
          NO_PROXY: '127.0.0.1,localhost',
          ...(kind === 'main' ? { CLAUDE_CODE_DISABLE_WORKFLOWS: '1' } : {}),
        };
        expect(result.env).toEqual(expected);
        expect(JSON.stringify(result.env)).toBe(JSON.stringify(expected));
        expect(result.env?.['CLAUDE_CONFIG_DIR']).toBe(
          inherited['CLAUDE_CONFIG_DIR'],
        );
      },
    );

    it('applies the named route after all env spreads and preserves permission policy', async () => {
      const before = { ...process.env };
      const baseline = await options();
      const result = await options(named);
      expect(result.env?.['CLAUDE_CONFIG_DIR']).toBe(named.canonicalConfigDir);
      for (const key of conflictingSelectors)
        expect(result.env).not.toHaveProperty(key);
      expect(result.env?.['HOME']).toBe(inherited['HOME']);
      expect(result.env?.['NO_PROXY']).toBe('127.0.0.1,localhost');
      if (kind === 'main')
        expect(result.env?.['CLAUDE_CODE_DISABLE_WORKFLOWS']).toBe('1');
      expect(result.permissionMode).toBe(baseline.permissionMode);
      expect(result.allowDangerouslySkipPermissions).toBe(
        baseline.allowDangerouslySkipPermissions,
      );
      expect(result.tools).toEqual(baseline.tools);
      expect(process.env).toEqual(before);
    });
  });
});
