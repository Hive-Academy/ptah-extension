import { tmpdir } from 'node:os';
import type {
  ClaudeAccountNamedRoute,
  ClaudeCertifiedLaunchContext,
} from '@ptah-extension/auth-providers-tokens';
import {
  CLAUDE_CERTIFIED_ENV_KEYS,
  CLAUDE_PERSONAL_SUBSCRIPTIONS,
  ClaudeCertifiedLaunchRefusal,
  assertCertifiedLaunch,
  buildCertifiedClaudeEnv,
  certifiedEnvDigest,
  certifiedNamedEnv,
  claudeSettingsOverride,
  isCertifiedClaudeEnvKey,
  type ClaudeActualLaunch,
} from './claude-certified-launch';

// Admission is outside this unit. Routes are already-admitted fixtures; the
// certification brand is not constructible through the public API.
function route(dir: string): ClaudeAccountNamedRoute {
  return {
    kind: 'named',
    provider: 'claude',
    profileId: 'fixture',
    canonicalConfigDir: dir,
    routeFingerprint: 'fixture',
    routeRevision: 1,
    authEpoch: 1,
    runId: 'fixture-run',
  } as ClaudeAccountNamedRoute;
}

const DIR_A = 'D:/accounts/a';
const DIR_B = 'D:/accounts/b';
const SOURCE_ENV: Record<string, string | undefined> = {
  Path: 'C:/bin',
  SystemRoot: 'C:/Windows',
  HOME: 'C:/Users/fixture',
  UNSET_VALUE: undefined,
};

function launchFor(
  dir: string,
  overrides: Partial<ClaudeCertifiedLaunchContext> = {},
): ClaudeCertifiedLaunchContext {
  const env = buildCertifiedClaudeEnv(SOURCE_ENV, dir);
  return {
    executable: {
      command: 'C:/claude/claude.exe',
      prefixArgs: [],
      sdkExecutablePath: 'C:/claude/claude.exe',
      version: '2.1.310',
      fingerprint: { size: 10, mtimeMs: 20 },
    },
    env,
    envDigest: certifiedEnvDigest(env),
    cwd: 'D:/workspace',
    settingSources: ['user', 'project', 'local'],
    policy: {
      coverage: 'win32@2.1.310',
      managedFile: 'absent',
      managedDropIn: 'absent',
      registry: 'absent',
      remoteSignals: 'absent',
    },
    accountClass: 'personal',
    identityReference: 'fixture-identity',
    ...overrides,
  };
}

function finalActual(
  launch: ClaudeCertifiedLaunchContext,
  overrides: Partial<ClaudeActualLaunch> = {},
): ClaudeActualLaunch {
  return {
    executablePath: launch.executable.sdkExecutablePath,
    env: { ...launch.env },
    cwd: launch.cwd,
    settingSources: [...launch.settingSources],
    ...overrides,
  };
}

function bootstrapActual(
  launch: ClaudeCertifiedLaunchContext,
  overrides: Partial<ClaudeActualLaunch> = {},
): ClaudeActualLaunch {
  return finalActual(launch, {
    cwd: tmpdir(),
    settingSources: [],
    ...overrides,
  });
}

function refusalCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof ClaudeCertifiedLaunchRefusal) return error.code;
    throw error;
  }
  return undefined;
}

describe('buildCertifiedClaudeEnv', () => {
  const SELECTORS: Record<string, string> = {
    CLAUDE_CONFIG_DIR: 'C:/ambient',
    claude_config_dir: 'C:/ambient-lower',
    CLAUDE_SECURESTORAGE_CONFIG_DIR: 'C:/ambient',
    CLAUDE_CODE_OAUTH_TOKEN: 'secret',
    CLAUDE_CODE_USE_BEDROCK: '1',
    CLAUDE_CODE_USE_VERTEX: '1',
    CLAUDE_CODE_FORCE_WINDOWS_CREDMAN: '1',
    CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
    CLAUDE_CODE_MANAGED_SETTINGS_PATH: 'C:/managed.json',
    CLAUDE_CODE_REMOTE_SETTINGS_PATH: 'C:/remote.json',
    CLAUDE_ANYTHING_NEW: 'x',
    ANTHROPIC_API_KEY: 'secret',
    ANTHROPIC_BASE_URL: 'https://proxy.example.test',
    anthropic_auth_token: 'secret',
    AWS_PROFILE: 'p',
    AWS_ACCESS_KEY_ID: 'k',
    GOOGLE_APPLICATION_CREDENTIALS: 'C:/g.json',
    CLOUD_ML_REGION: 'r',
    AZURE_CLIENT_SECRET: 's',
    NODE_OPTIONS: '--require x',
  };

  it('copies only allowlisted keys, keeps casing and drops every selector and prefix', () => {
    const env = buildCertifiedClaudeEnv({ ...SOURCE_ENV, ...SELECTORS }, DIR_A);
    expect(env).toEqual({
      Path: 'C:/bin',
      SystemRoot: 'C:/Windows',
      HOME: 'C:/Users/fixture',
      NO_PROXY: '127.0.0.1,localhost',
      CLAUDE_CONFIG_DIR: DIR_A,
      CLAUDE_SECURESTORAGE_CONFIG_DIR: DIR_A,
    });
    for (const key of Object.keys(SELECTORS)) {
      if (
        key === 'CLAUDE_CONFIG_DIR' ||
        key === 'CLAUDE_SECURESTORAGE_CONFIG_DIR'
      )
        continue;
      expect(env).not.toHaveProperty(key);
    }
    expect(
      Object.keys(env).some((key) =>
        /^(ANTHROPIC|AWS|GOOGLE|AZURE|CLOUD_ML)/i.test(key),
      ),
    ).toBe(false);
    expect(
      Object.keys(env)
        .filter((key) => /^CLAUDE/i.test(key))
        .sort(),
    ).toEqual(['CLAUDE_CONFIG_DIR', 'CLAUDE_SECURESTORAGE_CONFIG_DIR']);
    expect(Object.isFrozen(env)).toBe(true);
  });

  it('applies the NO_PROXY rule to every copied casing, an empty value and an absent one', () => {
    expect(
      buildCertifiedClaudeEnv({ NO_PROXY: 'corp' }, DIR_A)['NO_PROXY'],
    ).toBe('corp,127.0.0.1,localhost');
    expect(buildCertifiedClaudeEnv({ NO_PROXY: '' }, DIR_A)['NO_PROXY']).toBe(
      '127.0.0.1,localhost',
    );
    const lower = buildCertifiedClaudeEnv({ no_proxy: 'corp' }, DIR_A);
    expect(lower['no_proxy']).toBe('corp,127.0.0.1,localhost');
    expect(lower).not.toHaveProperty('NO_PROXY');
    expect(buildCertifiedClaudeEnv({}, DIR_A)['NO_PROXY']).toBe(
      '127.0.0.1,localhost',
    );
  });

  it('does not copy an allowlisted value carrying a line break', () => {
    const env = buildCertifiedClaudeEnv(
      {
        ALL_PROXY: 'proxy\nANTHROPIC_API_KEY=fixture-key',
        NO_PROXY: 'corp\nCLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1',
        HOME: 'C:/Users/fixture',
      },
      DIR_A,
    );
    expect(env).toEqual({
      HOME: 'C:/Users/fixture',
      NO_PROXY: '127.0.0.1,localhost',
      CLAUDE_CONFIG_DIR: DIR_A,
      CLAUDE_SECURESTORAGE_CONFIG_DIR: DIR_A,
    });
  });

  it('refuses an empty directory', () => {
    expect(refusalCode(() => buildCertifiedClaudeEnv({}, '  '))).toBe(
      'identity-unproved',
    );
  });

  it('gives two routes different directories and no shared object', () => {
    const source = { ...SOURCE_ENV };
    const envA = buildCertifiedClaudeEnv(source, DIR_A);
    const envB = buildCertifiedClaudeEnv(source, DIR_B);
    expect(envA['CLAUDE_CONFIG_DIR']).toBe(DIR_A);
    expect(envB['CLAUDE_CONFIG_DIR']).toBe(DIR_B);
    expect(envA).not.toBe(envB);
    expect(envA).not.toBe(source);
    const namedA = certifiedNamedEnv(route(DIR_A), launchFor(DIR_A));
    const namedB = certifiedNamedEnv(route(DIR_B), launchFor(DIR_B));
    namedA['MUTATED'] = 'x';
    expect(namedB).not.toHaveProperty('MUTATED');
    expect(namedB['CLAUDE_SECURESTORAGE_CONFIG_DIR']).toBe(DIR_B);
  });
});

describe('allowlist helpers', () => {
  it('matches allowlisted names case-insensitively', () => {
    expect(isCertifiedClaudeEnvKey('path')).toBe(true);
    expect(isCertifiedClaudeEnvKey('ProgramFiles(x86)')).toBe(true);
    expect(isCertifiedClaudeEnvKey('CLAUDE_CONFIG_DIR')).toBe(false);
    expect(
      isCertifiedClaudeEnvKey('CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST'),
    ).toBe(false);
    expect(
      CLAUDE_CERTIFIED_ENV_KEYS.some((key) => /^(CLAUDE|ANTHROPIC)/.test(key)),
    ).toBe(false);
  });

  it('lists the personal subscriptions', () => {
    expect(CLAUDE_PERSONAL_SUBSCRIPTIONS).toEqual(['pro', 'max']);
  });

  it('excludes run-policy keys and undefined values from the digest', () => {
    const env = { A: '1', B: '2' };
    expect(certifiedEnvDigest({ B: '2', A: '1' })).toBe(
      certifiedEnvDigest(env),
    );
    expect(
      certifiedEnvDigest({
        ...env,
        CLAUDE_CODE_DISABLE_WORKFLOWS: '1',
        X: undefined,
      }),
    ).toBe(certifiedEnvDigest(env));
    expect(certifiedEnvDigest({ ...env, C: '3' })).not.toBe(
      certifiedEnvDigest(env),
    );
  });
});

describe('certifiedNamedEnv', () => {
  it('returns a fresh copy plus the requested run-policy keys', () => {
    const launch = launchFor(DIR_A);
    const env = certifiedNamedEnv(route(DIR_A), launch, [
      'CLAUDE_CODE_DISABLE_WORKFLOWS',
    ]);
    expect(env).toEqual({ ...launch.env, CLAUDE_CODE_DISABLE_WORKFLOWS: '1' });
    expect(env).not.toBe(launch.env);
    expect(Object.isFrozen(env)).toBe(false);
  });

  it('refuses a missing launch', () => {
    expect(refusalCode(() => certifiedNamedEnv(route(DIR_A), undefined))).toBe(
      'identity-unproved',
    );
  });

  it('refuses a directory that differs from the route', () => {
    expect(
      refusalCode(() => certifiedNamedEnv(route(DIR_B), launchFor(DIR_A))),
    ).toBe('route-changed');
    const launch = launchFor(DIR_A);
    const split = { ...launch.env, CLAUDE_SECURESTORAGE_CONFIG_DIR: DIR_B };
    expect(
      refusalCode(() =>
        certifiedNamedEnv(route(DIR_A), {
          ...launch,
          env: split,
          envDigest: certifiedEnvDigest(split),
        }),
      ),
    ).toBe('route-changed');
  });

  it('refuses an env that no longer matches its digest', () => {
    const launch = launchFor(DIR_A);
    const env = { ...launch.env, ANTHROPIC_API_KEY: 'secret' };
    expect(
      refusalCode(() => certifiedNamedEnv(route(DIR_A), { ...launch, env })),
    ).toBe('route-changed');
  });

  it.each<[string, Record<string, string>]>([
    ['an embedded line break', { ALL_PROXY: 'proxy\nANTHROPIC_API_KEY=x' }],
    ['a credential selector', { ANTHROPIC_API_KEY: 'fixture-key' }],
    ['a parent-managed key', { CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1' }],
    ['a key with =', { 'PATH=x': 'y' }],
  ])('refuses a self-consistent launch env carrying %s', (_label, extra) => {
    const launch = launchFor(DIR_A);
    const env = { ...launch.env, ...extra };
    expect(
      refusalCode(() =>
        certifiedNamedEnv(route(DIR_A), {
          ...launch,
          env,
          envDigest: certifiedEnvDigest(env),
        }),
      ),
    ).toBe('route-changed');
  });
});

describe('assertCertifiedLaunch', () => {
  const launch = launchFor(DIR_A);

  it('accepts an unchanged launch at both boundaries', () => {
    expect(
      refusalCode(() =>
        assertCertifiedLaunch(launch, finalActual(launch), 'final'),
      ),
    ).toBeUndefined();
    expect(
      refusalCode(() =>
        assertCertifiedLaunch(launch, bootstrapActual(launch), 'bootstrap'),
      ),
    ).toBeUndefined();
    const withPolicy = finalActual(launch, {
      env: {
        ...launch.env,
        CLAUDE_CODE_DISABLE_WORKFLOWS: '1',
        CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
      },
      flagSettings: JSON.stringify({ autoMemoryEnabled: false }),
    });
    expect(
      refusalCode(() => assertCertifiedLaunch(launch, withPolicy, 'final')),
    ).toBeUndefined();
  });

  describe.each(['final', 'bootstrap'] as const)('%s drift', (mode) => {
    const base = mode === 'final' ? finalActual : bootstrapActual;

    it.each<[string, Partial<ClaudeActualLaunch>]>([
      ['executable', { executablePath: 'C:/other/claude.exe' }],
      ['missing executable', { executablePath: undefined }],
      ['digest', { env: { ...launch.env, ANTHROPIC_API_KEY: 'secret' } }],
      ['removed key', { env: { ...launch.env, HOME: undefined } }],
      ['cwd', { cwd: 'D:/elsewhere' }],
      ['setting sources', { settingSources: ['user'] }],
      ['missing setting sources', { settingSources: undefined }],
      [
        'run-policy value',
        { env: { ...launch.env, CLAUDE_CODE_DISABLE_WORKFLOWS: '0' } },
      ],
      [
        'run-policy casing value',
        {
          env: {
            ...launch.env,
            claude_code_disable_experimental_betas: 'true',
          },
        },
      ],
    ])('refuses %s', (_label, overrides) => {
      expect(
        refusalCode(() =>
          assertCertifiedLaunch(launch, base(launch, overrides), mode),
        ),
      ).toBe('route-changed');
    });

    it.each<[string, Partial<ClaudeActualLaunch>]>([
      ['managedSettings', { managedSettings: { permissions: {} } }],
      ['empty managedSettings', { managedSettings: {} }],
      [
        'managed-settings extra arg',
        { extraArgs: { 'managed-settings': '{}' } },
      ],
      [
        'valueless managed-settings extra arg',
        { extraArgs: { 'managed-settings': null } },
      ],
    ])('refuses the parent-managed channel: %s', (_label, overrides) => {
      expect(
        refusalCode(() =>
          assertCertifiedLaunch(launch, base(launch, overrides), mode),
        ),
      ).toBe('identity-unproved');
    });

    it.each<[string, Readonly<Record<string, string | null>>]>([
      ['settings', { settings: JSON.stringify({ apiKeyHelper: 'helper' }) }],
      ['empty settings', { settings: '{}' }],
      ['valueless settings', { settings: null }],
      ['dashed settings', { '--settings': '{}' }],
      ['inline settings value', { 'settings={}': null }],
      ['upper-case settings', { SETTINGS: '{}' }],
      ['setting-sources', { 'setting-sources': 'user,project,local' }],
      ['empty setting-sources', { 'setting-sources': '' }],
    ])(
      'refuses an extraArgs certified-input replacement: %s',
      (_label, extraArgs) => {
        expect(
          refusalCode(() =>
            assertCertifiedLaunch(launch, base(launch, { extraArgs }), mode),
          ),
        ).toBe('identity-unproved');
      },
    );

    it.each<[string, string]>([
      ['apiKeyHelper', JSON.stringify({ apiKeyHelper: 'fixture-helper' })],
      ['forceLoginOrgUUID', JSON.stringify({ forceLoginOrgUUID: 'org' })],
      ['selector env', JSON.stringify({ env: { ANTHROPIC_API_KEY: 'x' } })],
      ['plugins', JSON.stringify({ enabledPlugins: { plugin: true } })],
      ['malformed JSON', 'not json'],
      ['non-object JSON', '[]'],
      ['non-object env', JSON.stringify({ env: 'PATH=x' })],
    ])('refuses a flag settings tier: %s', (_label, flagSettings) => {
      expect(
        refusalCode(() =>
          assertCertifiedLaunch(launch, base(launch, { flagSettings }), mode),
        ),
      ).toBe('identity-unproved');
    });

    it('accepts a flag settings tier with no auth override', () => {
      const flagSettings = JSON.stringify({ autoMemoryEnabled: false });
      expect(
        refusalCode(() =>
          assertCertifiedLaunch(launch, base(launch, { flagSettings }), mode),
        ),
      ).toBeUndefined();
    });

    it('refuses an env that splits an embedded line break into a new selector', () => {
      // A hand-made launch whose certified value embeds a separator. The
      // split actual env serializes to the same digest lines, so only the
      // direct entry comparison and the encodability check catch it.
      const ambiguousEnv = {
        ...launch.env,
        ALL_PROXY: 'proxy\nANTHROPIC_API_KEY=fixture-key',
      };
      const ambiguous: ClaudeCertifiedLaunchContext = {
        ...launch,
        env: ambiguousEnv,
        envDigest: certifiedEnvDigest(ambiguousEnv),
      };
      const split = {
        ...launch.env,
        ALL_PROXY: 'proxy',
        ANTHROPIC_API_KEY: 'fixture-key',
      };
      expect(certifiedEnvDigest(split)).toBe(ambiguous.envDigest);
      expect(
        refusalCode(() =>
          assertCertifiedLaunch(
            ambiguous,
            base(ambiguous, { env: split }),
            mode,
          ),
        ),
      ).toBe('route-changed');
      expect(
        refusalCode(() =>
          assertCertifiedLaunch(ambiguous, base(ambiguous), mode),
        ),
      ).toBe('route-changed');
    });

    it.each<[string, Record<string, string>]>([
      ['a credential selector', { ANTHROPIC_API_KEY: 'fixture-key' }],
      ['a parent-managed key', { CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1' }],
    ])(
      'refuses an actual env adding %s even with a matching digest',
      (_label, extra) => {
        const env = { ...launch.env, ...extra };
        const forged: ClaudeCertifiedLaunchContext = {
          ...launch,
          envDigest: certifiedEnvDigest(env),
        };
        expect(
          refusalCode(() =>
            assertCertifiedLaunch(forged, base(forged, { env }), mode),
          ),
        ).toBe('route-changed');
      },
    );
  });

  it('bootstrap requires no setting sources and the temp cwd', () => {
    expect(
      refusalCode(() =>
        assertCertifiedLaunch(launch, finalActual(launch), 'bootstrap'),
      ),
    ).toBe('route-changed');
    expect(
      refusalCode(() =>
        assertCertifiedLaunch(
          launch,
          bootstrapActual(launch, { cwd: launch.cwd }),
          'bootstrap',
        ),
      ),
    ).toBe('route-changed');
  });

  it('allows other extraArgs keys at both boundaries', () => {
    const extraArgs = { 'debug-to-stderr': null, 'settings-note': 'x' };
    expect(
      refusalCode(() =>
        assertCertifiedLaunch(
          launch,
          finalActual(launch, { extraArgs }),
          'final',
        ),
      ),
    ).toBeUndefined();
    expect(
      refusalCode(() =>
        assertCertifiedLaunch(
          launch,
          bootstrapActual(launch, { extraArgs }),
          'bootstrap',
        ),
      ),
    ).toBeUndefined();
  });
});

describe('claudeSettingsOverride', () => {
  it.each<[string, unknown, 'none' | 'override' | 'malformed']>([
    ['empty object', {}, 'none'],
    ['unrelated keys', { model: 'x', permissions: { allow: [] } }, 'none'],
    ['claudeai login method', { forceLoginMethod: 'claudeai' }, 'none'],
    ['allowlisted env', { env: { PATH: 'x', no_proxy: 'y' } }, 'none'],
    ['empty plugins', { enabledPlugins: {} }, 'none'],
    ['apiKeyHelper', { apiKeyHelper: 'x' }, 'override'],
    ['awsAuthRefresh', { awsAuthRefresh: 'x' }, 'override'],
    ['awsCredentialExport', { awsCredentialExport: 'x' }, 'override'],
    ['gcpAuthRefresh', { gcpAuthRefresh: 'x' }, 'override'],
    ['console login method', { forceLoginMethod: 'console' }, 'override'],
    ['null login method', { forceLoginMethod: null }, 'override'],
    ['forceLoginOrgUUID', { forceLoginOrgUUID: '' }, 'override'],
    ['config dir env', { env: { CLAUDE_CONFIG_DIR: 'x' } }, 'override'],
    [
      'provider env',
      { env: { CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1' } },
      'override',
    ],
    ['plugins', { enabledPlugins: { 'p@m': true } }, 'override'],
    ['plugin list', { enabledPlugins: ['p'] }, 'override'],
    ['null', null, 'malformed'],
    ['array', [], 'malformed'],
    ['string', 'x', 'malformed'],
    ['non-object env', { env: 'PATH=x' }, 'malformed'],
  ])('%s', (_label, value, expected) => {
    expect(claudeSettingsOverride(value)).toBe(expected);
  });
});
