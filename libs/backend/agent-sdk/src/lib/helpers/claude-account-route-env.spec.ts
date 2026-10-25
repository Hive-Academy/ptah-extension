import 'reflect-metadata';
import { tmpdir } from 'node:os';
import type {
  ClaudeAccountRoute,
  ClaudeAccountNamedRoute,
  ClaudeAccountAmbientRoute,
  ClaudeCertifiedLaunchContext,
} from '@ptah-extension/auth-providers-tokens';
import type { AISessionConfig, AuthEnv } from '@ptah-extension/shared';
import { applyClaudeAccountRouteEnv } from './claude-account-route-env';
import {
  CLAUDE_CERTIFIED_ENV_KEYS,
  ClaudeCertifiedLaunchRefusal,
  assertCertifiedLaunch,
  certifiedEnvDigest,
} from './claude-certified-launch';
import {
  SdkQueryOptionsBuilder,
  buildNamedAccountBootstrapOptions,
  namedActualLaunch,
} from './sdk-query-options-builder';

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

function launchFor(
  route: ClaudeAccountNamedRoute,
  overrides: Partial<ClaudeCertifiedLaunchContext> = {},
): ClaudeCertifiedLaunchContext {
  const env: Record<string, string> = {
    [CLAUDE_CERTIFIED_ENV_KEYS[0]]: 'certified-value',
    CLAUDE_CONFIG_DIR: route.canonicalConfigDir,
    CLAUDE_SECURESTORAGE_CONFIG_DIR: route.canonicalConfigDir,
  };
  return {
    executable: {
      command: 'claude-fixture',
      prefixArgs: [],
      sdkExecutablePath: 'D:/certified/claude.exe',
      version: '2.1.310',
      fingerprint: { size: 1, mtimeMs: 1 },
    },
    env,
    envDigest: certifiedEnvDigest(env),
    cwd: 'D:/certified-repo',
    settingSources: ['user', 'project', 'local'],
    policy: {
      coverage: 'win32@2.1.310',
      managedFile: 'absent',
      managedDropIn: 'absent',
      registry: 'absent',
      remoteSignals: 'absent',
    },
    accountClass: 'personal',
    identityReference: 'fixture-reference',
    ...overrides,
  };
}

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
  // Named routes validate against the account's own model list;
  // an empty list is "unknown" and does not refuse.
  getSupportedModels: jest.fn().mockResolvedValue([]),
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

async function mainOptions(
  accountRoute?: ClaudeAccountRoute,
  accountLaunch?: ClaudeCertifiedLaunchContext,
) {
  return (
    await makeBuilder().build({
      accountRoute,
      accountLaunch,
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

beforeEach(() => model.getSupportedModels.mockClear());

describe('applyClaudeAccountRouteEnv', () => {
  it.each([ambient, undefined])(
    'returns the ambient env object unchanged: %p',
    (route) => {
      const base = { PATH: 'x', CLAUDE_CONFIG_DIR: 'ambient-dir' };
      const env = applyClaudeAccountRouteEnv(base, route);
      expect(env).toBe(base);
      expect(env).toEqual({ PATH: 'x', CLAUDE_CONFIG_DIR: 'ambient-dir' });
    },
  );

  it('refuses a named route without deriving an env from the parent', () => {
    const base = { PATH: 'x' };
    expect(() => applyClaudeAccountRouteEnv(base, named)).toThrow(
      new ClaudeCertifiedLaunchRefusal('identity-unproved'),
    );
    expect(base).toEqual({ PATH: 'x' });
  });
});

describe('named main-chat options are built from the certified launch', () => {
  it('adds no account env to an ambient build', async () => {
    for (const route of [ambient, undefined]) {
      const options = await mainOptions(route);
      expect(options.env?.['CLAUDE_CONFIG_DIR']).toBe(
        process.env['CLAUDE_CONFIG_DIR'],
      );
      expect(options.env?.['CLAUDE_CODE_DISABLE_WORKFLOWS']).toBe('1');
      expect(options.cwd).toBe('D:/repo');
      expect(options.settingSources).toEqual(['user', 'project', 'local']);
    }
    expect(model.getSupportedModels).not.toHaveBeenCalled();
  });

  it('refuses a named route without a certified launch before model discovery', async () => {
    await expect(mainOptions(named)).rejects.toEqual(
      new ClaudeCertifiedLaunchRefusal('identity-unproved'),
    );
    expect(model.getSupportedModels).not.toHaveBeenCalled();
  });

  it('uses the certified env, cwd, sources and executable only (A-S12 pin)', async () => {
    const launch = launchFor(named);
    const options = await mainOptions(named, launch);
    expect(options.env).toEqual({
      ...launch.env,
      CLAUDE_CODE_DISABLE_WORKFLOWS: '1',
    });
    expect(options.cwd).toBe(launch.cwd);
    expect(options.settingSources).toEqual(launch.settingSources);
    expect(options.pathToClaudeCodeExecutable).toBe(
      launch.executable.sdkExecutablePath,
    );
    expect(options).not.toHaveProperty('managedSettings');
    expect(
      Object.keys(options.extraArgs ?? {}).filter((key) =>
        /managed-settings|^-*settings|setting-sources/i.test(key),
      ),
    ).toEqual([]);
    expect(() =>
      assertCertifiedLaunch(launch, namedActualLaunch(options), 'final'),
    ).not.toThrow();
    expect(model.getSupportedModels).toHaveBeenCalledWith(
      named,
      expect.any(AbortSignal),
      launch,
    );
  });

  it('refuses a launch whose env no longer matches its digest', async () => {
    const launch = launchFor(named, { envDigest: 'tampered' });
    await expect(mainOptions(named, launch)).rejects.toEqual(
      new ClaudeCertifiedLaunchRefusal('route-changed'),
    );
  });

  it('keeps simultaneous distinct routes independent', async () => {
    const other = { ...named, canonicalConfigDir: 'D:/accounts/other' };
    const [a, b] = await Promise.all([
      mainOptions(named, launchFor(named)),
      mainOptions(other, launchFor(other)),
    ]);
    expect(a.env?.['CLAUDE_CONFIG_DIR']).toBe(named.canonicalConfigDir);
    expect(b.env?.['CLAUDE_CONFIG_DIR']).toBe(other.canonicalConfigDir);
    expect(b.env?.['CLAUDE_SECURESTORAGE_CONFIG_DIR']).toBe(
      other.canonicalConfigDir,
    );
  });
});

describe('buildNamedAccountBootstrapOptions', () => {
  it('builds a control-only bootstrap that passes the bootstrap check', () => {
    const launch = launchFor(named);
    const options = buildNamedAccountBootstrapOptions(
      named,
      new AbortController(),
      launch,
    );
    expect(options.env).toEqual(launch.env);
    expect(options.cwd).toBe(tmpdir());
    expect(options.settingSources).toEqual([]);
    expect(options.pathToClaudeCodeExecutable).toBe(
      launch.executable.sdkExecutablePath,
    );
    expect(options).not.toHaveProperty('managedSettings');
    expect(options).not.toHaveProperty('extraArgs');
  });

  it('refuses without a launch and when the launch belongs to another route', () => {
    expect(() =>
      buildNamedAccountBootstrapOptions(named, new AbortController(), undefined),
    ).toThrow(new ClaudeCertifiedLaunchRefusal('identity-unproved'));
    const other = { ...named, canonicalConfigDir: 'D:/accounts/other' };
    expect(() =>
      buildNamedAccountBootstrapOptions(
        named,
        new AbortController(),
        launchFor(other),
      ),
    ).toThrow(new ClaudeCertifiedLaunchRefusal('route-changed'));
  });
});
