import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { container } from 'tsyringe';
import { createMockLogger } from '@ptah-extension/shared/testing';
import {
  TOKENS,
  type IAuthSecretsService,
  type Logger,
} from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  parseQuotaOwnerRef,
  type SessionQuotaProbe,
  type SessionQuotaRoute,
} from '@ptah-extension/agent-sdk';
import type { QuotaOwnerRef } from '@ptah-extension/shared';
import { CodexHomeResolver } from '../providers/codex/codex-home-resolver';
import { AUTH_PROVIDERS_TOKENS } from '../di/tokens';
import { CODEX_PROXY_TOKEN_PLACEHOLDER } from '../providers/codex/codex-provider.types';
import { OLLAMA_AUTH_TOKEN_PLACEHOLDER } from '../providers/local/local-provider.types';
import {
  ProviderOwnerResolver,
  accountOwnerKey,
  cliStoreOwnerKey,
  credentialFromHeaders,
  credentialOwnerKey,
  normaliseOwnerProviderId,
  ownerFingerprint,
  quotaOwnerRefFromKey,
  unknownOwnerKey,
  type ClaudeAccountInfo,
} from './provider-owner.resolver';

jest.mock('node:fs', () => ({ readFileSync: jest.fn() }));

const SECRET = 'sk-private-credential-123';
const EMAIL = 'private-user@example.test';

function harness(
  options: {
    keys?: Record<string, string | undefined>;
    keyReadFails?: boolean;
    route?: SessionQuotaRoute | null;
    account?: ClaudeAccountInfo;
    codexOwnerKey?: string | null;
    fileContent?: string;
    fileReadFails?: boolean;
  } = {},
) {
  const logger = createMockLogger();
  const getProviderKey = jest.fn(async (slot: string) => {
    if (options.keyReadFails) throw new Error(`store failure for ${SECRET}`);
    return options.keys?.[slot];
  });
  const probe = {
    readAccount: jest.fn(async () => options.account ?? null),
    readPlanUsage: jest.fn(async () => null),
    sessionRoute: jest.fn(() =>
      options.route === undefined ? null : options.route,
    ),
  } satisfies SessionQuotaProbe;
  const codexHome = new CodexHomeResolver(resolve('synthetic-codex-home'));
  const readFile = readFileSync as jest.MockedFunction<typeof readFileSync>;
  readFile.mockImplementation(() => {
    if (options.fileReadFails) throw new Error('account file unavailable');
    return options.fileContent ?? '';
  });
  const resolver = new ProviderOwnerResolver(
    logger as unknown as Logger,
    { getProviderKey } as unknown as IAuthSecretsService,
    probe,
    { currentOwnerKey: () => options.codexOwnerKey ?? null },
    codexHome,
  );
  return { resolver, logger, getProviderKey, probe, codexHome, readFile };
}

function expectRestorable(ref: QuotaOwnerRef): void {
  expect(parseQuotaOwnerRef(ref)).toEqual(ref);
  expect(ref.key).toMatch(
    /^[a-z0-9][a-z0-9._-]{0,63}#(account|credential|cli-store|unknown):[0-9a-f]{16}$/,
  );
  expect(ref.label).not.toContain('@');
}

describe('ownerFingerprint', () => {
  it('is the first 16 lowercase hex characters of the domain-tagged SHA-256', () => {
    const expected = createHash('sha256')
      .update(`ptah-quota-owner\0${SECRET}`)
      .digest('hex')
      .slice(0, 16);
    expect(ownerFingerprint(SECRET)).toBe(expected);
    expect(ownerFingerprint(SECRET)).toMatch(/^[0-9a-f]{16}$/);
    expect(ownerFingerprint('a')).not.toBe(ownerFingerprint('b'));
  });
});

describe('credentialFromHeaders (F78)', () => {
  it.each([
    ['lower-case bearer', { authorization: 'bearer K' }, 'K'],
    ['Bearer with two spaces', { Authorization: 'Bearer  K' }, 'K'],
    ['Basic scheme', { Authorization: 'Basic X' }, 'X'],
    ['raw authorization', { Authorization: 'K' }, 'K'],
    [
      'one scheme stripped only',
      { Authorization: 'Bearer Bearer K' },
      'Bearer K',
    ],
    [
      'x-api-key over authorization',
      { 'x-api-key': 'A', authorization: 'Bearer B' },
      'A',
    ],
    ['mixed-case X-Api-Key', { 'X-Api-Key': ' K ' }, 'K'],
    [
      'repeated header uses its first value',
      { authorization: ['Bearer K', 'Bearer Z'] },
      'K',
    ],
    [
      'scheme glued to the value is not a scheme',
      { authorization: 'BearerK' },
      'BearerK',
    ],
    [
      'empty x-api-key falls back to authorization',
      { 'x-api-key': '  ', authorization: 'Bearer K' },
      'K',
    ],
  ])('%s', (_name, headers, expected) => {
    expect(credentialFromHeaders(headers)).toBe(expected);
  });

  it.each([
    ['no headers', {}],
    ['empty authorization', { authorization: '' }],
    ['scheme only', { authorization: 'Bearer   ' }],
    ['undefined values', { authorization: undefined, 'x-api-key': undefined }],
  ])('%s gives null', (_name, headers) => {
    expect(credentialFromHeaders(headers)).toBeNull();
  });
});

describe('owner keys', () => {
  it('builds every kind as <providerId>#<kind>:<16 hex> and each ref restores (all four kinds)', () => {
    const refs = [
      quotaOwnerRefFromKey(accountOwnerKey('anthropic', `${EMAIL}\0org`)),
      quotaOwnerRefFromKey(credentialOwnerKey('ollama-cloud', SECRET)),
      quotaOwnerRefFromKey(cliStoreOwnerKey('opencode', resolve('store'))),
      quotaOwnerRefFromKey(unknownOwnerKey('openai-codex', resolve('home'))),
    ];
    expect(refs.map((ref) => ref.identityKind)).toEqual([
      'account',
      'credential',
      'cli-store',
      'unknown',
    ]);
    expect(refs.map((ref) => ref.label)).toEqual([
      'Claude account',
      'Ollama Cloud API key',
      'OpenCode CLI login',
      'Codex (owner unknown)',
    ]);
    for (const ref of refs) expectRestorable(ref);
  });

  it('trims the credential before hashing', () => {
    expect(credentialOwnerKey('p', `  ${SECRET} `)).toBe(
      credentialOwnerKey('p', SECRET),
    );
  });

  it('normalises provider ids into the restorable slug', () => {
    expect(normaliseOwnerProviderId('OpenAI-Codex')).toBe('openai-codex');
    expect(normaliseOwnerProviderId(' my provider/1 ')).toBe('my-provider-1');
    expect(normaliseOwnerProviderId('--x')).toBe('x');
    expect(normaliseOwnerProviderId('###')).toBe('unknown');
    expect(normaliseOwnerProviderId('a'.repeat(80))).toHaveLength(64);
    const ref = quotaOwnerRefFromKey(
      credentialOwnerKey('Custom Provider!', SECRET),
    );
    expect(ref.providerId).toBe('custom-provider-');
    expect(ref.label).toBe('Provider API key');
    expectRestorable(ref);
  });

  it('keys a CLI store path case-insensitively on Windows only', () => {
    const lower = cliStoreOwnerKey('opencode', 'C:\\Users\\Dev\\Store');
    const upper = cliStoreOwnerKey('opencode', 'c:\\users\\dev\\store');
    if (process.platform === 'win32') expect(lower).toBe(upper);
    else expect(lower).not.toBe(upper);
  });

  it('rejects a key that is not canonical', () => {
    expect(() => quotaOwnerRefFromKey('anthropic:abc')).toThrow(
      'Not a canonical quota owner key',
    );
  });
});

describe('ProviderOwnerResolver', () => {
  it('F67b: a proxy request key equals the stored-key owner (Bearer K and mixed-case X-Api-Key)', async () => {
    const { resolver } = harness({ keys: { 'ollama-cloud': SECRET } });
    const stored = await resolver.ownerForProviderKey('ollama-cloud');
    const bearer = credentialFromHeaders({ Authorization: `Bearer ${SECRET}` });
    const apiKey = credentialFromHeaders({ 'X-Api-Key': SECRET });
    expect(bearer).not.toBeNull();
    expect(apiKey).not.toBeNull();
    expect(credentialOwnerKey('ollama-cloud', bearer as string)).toBe(
      stored.key,
    );
    expect(credentialOwnerKey('ollama-cloud', apiKey as string)).toBe(
      stored.key,
    );
    expect(stored.identityKind).toBe('credential');
    expectRestorable(stored);
  });

  it.each([
    ['missing', undefined],
    ['blank', '   '],
    ['an Ollama placeholder', OLLAMA_AUTH_TOKEN_PLACEHOLDER],
    ['a proxy placeholder', CODEX_PROXY_TOKEN_PLACEHOLDER],
  ])(
    'gives an unknown owner when the stored key is %s',
    async (_name, stored) => {
      const { resolver } = harness({ keys: { 'ollama-cloud': stored } });
      const ref = await resolver.ownerForProviderKey('ollama-cloud');
      expect(ref.identityKind).toBe('unknown');
      expect(ref.key).toBe(
        unknownOwnerKey('ollama-cloud', 'provider-key:ollama-cloud'),
      );
      expectRestorable(ref);
    },
  );

  it('a failed secret read gives unknown and logs neither the error nor the secret', async () => {
    const { resolver, logger } = harness({ keyReadFails: true });
    const ref = await resolver.ownerForProviderKey('ollama-cloud');
    expect(ref.identityKind).toBe('unknown');
    expect(logger.warn).toHaveBeenCalledWith(
      '[ProviderOwnerResolver] provider key read failed',
      { providerId: 'ollama-cloud' },
    );
    expect(JSON.stringify((logger.warn as jest.Mock).mock.calls)).not.toContain(
      SECRET,
    );
  });

  it("reads a Ptah CLI agent's own slot and keys it under the lane's provider", async () => {
    const { resolver, getProviderKey } = harness({
      keys: { 'ptahCli.glm-1': SECRET },
    });
    const ref = await resolver.ownerForPtahCli('glm-1', 'ollama-cloud');
    expect(getProviderKey).toHaveBeenCalledWith('ptahCli.glm-1');
    expect(ref.key).toBe(credentialOwnerKey('ollama-cloud', SECRET));
    const missing = await harness().resolver.ownerForPtahCli(
      'glm-1',
      'ollama-cloud',
    );
    expect(missing.key).toBe(unknownOwnerKey('ollama-cloud', 'ptah-cli:glm-1'));
  });

  it('keys a Claude account by email plus organization, and unknown without an email', () => {
    const { resolver } = harness();
    const a = resolver.ownerForClaudeAccount(
      { email: EMAIL, organization: 'Org A' },
      'session:s1',
    );
    const b = resolver.ownerForClaudeAccount(
      { email: EMAIL, organization: 'Org B' },
      'session:s1',
    );
    expect(a).toEqual({
      providerId: 'anthropic',
      identityKind: 'account',
      label: 'Claude account',
      key: accountOwnerKey('anthropic', `${EMAIL}\0Org A`),
    });
    expect(b.key).not.toBe(a.key);
    const unknown = resolver.ownerForClaudeAccount(
      { apiKeySource: 'user' },
      'session:s1',
    );
    expect(unknown.key).toBe(unknownOwnerKey('anthropic', 'session:s1'));
    expect(
      resolver.ownerForClaudeAccount(null, 'session:s2').identityKind,
    ).toBe('unknown');
    for (const ref of [a, b, unknown]) expectRestorable(ref);
  });

  it('uses the Codex owner key when one was read, else an unknown owner keyed by CODEX_HOME', () => {
    const known = accountOwnerKey(
      'openai-codex',
      `${resolve('synthetic-codex-home')}\0${EMAIL}`,
    );
    expect(
      harness({ codexOwnerKey: known }).resolver.ownerForCodexHome(),
    ).toEqual({
      providerId: 'openai-codex',
      identityKind: 'account',
      label: 'Codex account',
      key: known,
    });
    const { resolver, codexHome } = harness();
    const unknown = resolver.ownerForCodexHome();
    expect(unknown.key).toBe(unknownOwnerKey('openai-codex', codexHome.path));
    expectRestorable(unknown);
  });

  it('keys CLI stores by their on-disk root', () => {
    const previous = process.env['XDG_DATA_HOME'];
    process.env['XDG_DATA_HOME'] = resolve('xdg-data');
    try {
      const { resolver } = harness();
      const opencode = resolver.ownerForCliStore('opencode');
      expect(opencode.key).toBe(
        cliStoreOwnerKey('opencode', join(resolve('xdg-data'), 'opencode')),
      );
      expect(opencode.label).toBe('OpenCode CLI login');
      const antigravity = resolver.ownerForCliStore('antigravity');
      expect(antigravity.identityKind).toBe('cli-store');
      expect(antigravity.label).toBe('Antigravity CLI login');
      for (const ref of [opencode, antigravity]) expectRestorable(ref);
    } finally {
      if (previous === undefined) delete process.env['XDG_DATA_HOME'];
      else process.env['XDG_DATA_HOME'] = previous;
    }
  });

  describe('ownerForAntigravity', () => {
    it('keys different active accounts on one root separately and stably', () => {
      const first = harness({
        fileContent: JSON.stringify({ active: 'first@example.test', old: [] }),
      }).resolver.ownerForAntigravity();
      const second = harness({
        fileContent: JSON.stringify({ active: 'second@example.test', old: [] }),
      }).resolver.ownerForAntigravity();
      const repeated = harness({
        fileContent: JSON.stringify({ active: 'first@example.test', old: [] }),
      }).resolver.ownerForAntigravity();

      expect(first.identityKind).toBe('account');
      expect(second.identityKind).toBe('account');
      expect(first.key).not.toBe(second.key);
      expect(repeated.key).toBe(first.key);
      expectRestorable(first);
      expectRestorable(second);
    });

    it('keys one account the same regardless of letter case or a missing old list', () => {
      const lower = harness({
        fileContent: JSON.stringify({ active: 'first@example.test', old: [] }),
      }).resolver.ownerForAntigravity();
      const mixed = harness({
        fileContent: JSON.stringify({ active: ' First@Example.TEST ' }),
      }).resolver.ownerForAntigravity();

      expect(mixed.identityKind).toBe('account');
      expect(mixed.key).toBe(lower.key);
    });

    it('constructs through tsyringe with all injected dependencies registered', () => {
      const child = container.createChildContainer();
      const logger = createMockLogger();
      const probe = {
        readAccount: jest.fn(async () => null),
        readPlanUsage: jest.fn(async () => null),
        sessionRoute: jest.fn(() => null),
      } satisfies SessionQuotaProbe;
      child.registerInstance(TOKENS.LOGGER, logger as unknown as Logger);
      child.registerInstance(TOKENS.AUTH_SECRETS_SERVICE, {
        getProviderKey: jest.fn(async () => undefined),
      } as unknown as IAuthSecretsService);
      child.registerInstance(SDK_TOKENS.SDK_SESSION_QUOTA_PROBE, probe);
      child.registerInstance(AUTH_PROVIDERS_TOKENS.SDK_CODEX_ACCOUNT_USAGE, {
        currentOwnerKey: () => null,
      });
      child.registerInstance(
        AUTH_PROVIDERS_TOKENS.SDK_CODEX_HOME_RESOLVER,
        new CodexHomeResolver(resolve('synthetic-codex-home')),
      );

      expect(child.resolve(ProviderOwnerResolver)).toBeInstanceOf(
        ProviderOwnerResolver,
      );
    });

    it.each([
      ['missing', { fileReadFails: true }],
      ['invalid', { fileContent: '{not json' }],
      [
        'empty active',
        { fileContent: JSON.stringify({ active: '', old: [] }) },
      ],
    ])(
      'falls back to the CLI store when the account file is %s',
      (_case, options) => {
        const { resolver } = harness(options);

        expect(resolver.ownerForAntigravity()).toEqual(
          resolver.ownerForCliStore('antigravity'),
        );
      },
    );

    it('never serializes or logs the active account email', () => {
      const email = 'antigravity-private@example.test';
      const { resolver, logger } = harness({
        fileContent: JSON.stringify({ active: email, old: [] }),
      });
      const owner = resolver.ownerForAntigravity();

      expect(JSON.stringify(owner)).not.toContain(email);
      expect(
        JSON.stringify([
          (logger.debug as jest.Mock).mock.calls,
          (logger.info as jest.Mock).mock.calls,
          (logger.warn as jest.Mock).mock.calls,
          (logger.error as jest.Mock).mock.calls,
        ]),
      ).not.toContain(email);
    });
  });

  describe('ownerForSession', () => {
    it('native: the Claude account read from that session', async () => {
      const { resolver, probe } = harness({
        route: { providerId: 'anthropic', routeKind: 'native' },
        account: { email: EMAIL, organization: 'Org' },
      });
      const ref = await resolver.ownerForSession('s1');
      expect(probe.readAccount).toHaveBeenCalledWith('s1');
      expect(ref.key).toBe(accountOwnerKey('anthropic', `${EMAIL}\0Org`));
    });

    it('native without an account: unknown, keyed by the session', async () => {
      const { resolver } = harness({
        route: { providerId: 'anthropic', routeKind: 'native' },
      });
      const ref = await resolver.ownerForSession('s1');
      expect(ref.key).toBe(unknownOwnerKey('anthropic', 'session:s1'));
    });

    it('direct-key: the stored key of the route provider', async () => {
      const { resolver } = harness({
        route: { providerId: 'anthropic', routeKind: 'direct-key' },
        keys: { anthropic: SECRET },
      });
      expect((await resolver.ownerForSession('s1')).key).toBe(
        credentialOwnerKey('anthropic', SECRET),
      );
    });

    it('proxy: the stored key the proxy sends', async () => {
      const { resolver } = harness({
        route: { providerId: 'ollama-cloud', routeKind: 'proxy' },
        keys: { 'ollama-cloud': SECRET },
      });
      expect((await resolver.ownerForSession('s1')).key).toBe(
        credentialOwnerKey('ollama-cloud', SECRET),
      );
    });

    it('cloud-direct proxy with no provider id resolves to the Ollama Cloud key', async () => {
      const { resolver, getProviderKey } = harness({
        route: {
          providerId: null,
          routeKind: 'proxy',
          baseUrlHost: 'ollama.com',
        },
        keys: { 'ollama-cloud': SECRET },
      });
      expect((await resolver.ownerForSession('s1')).key).toBe(
        credentialOwnerKey('ollama-cloud', SECRET),
      );
      expect(getProviderKey).toHaveBeenCalledWith('ollama-cloud');
    });

    it.each([
      ['ambiguous daemon', '127.0.0.1'],
      ['plain local Ollama', undefined],
      ['unrelated proxy', 'proxy.example.test'],
    ])(
      '%s with no provider evidence stays unknown',
      async (_name, baseUrlHost) => {
        const { resolver, getProviderKey } = harness({
          route: {
            providerId: null,
            routeKind: 'proxy',
            ...(baseUrlHost && { baseUrlHost }),
          },
        });
        expect((await resolver.ownerForSession('s1')).key).toBe(
          unknownOwnerKey('unknown', 'session:s1'),
        );
        expect(getProviderKey).not.toHaveBeenCalled();
      },
    );

    it('Codex proxy: the Codex account home, never a stored key', async () => {
      const known = accountOwnerKey('openai-codex', `home\0${EMAIL}`);
      const { resolver, getProviderKey } = harness({
        route: { providerId: 'openai-codex', routeKind: 'proxy' },
        codexOwnerKey: known,
      });
      expect((await resolver.ownerForSession('s1')).key).toBe(known);
      expect(getProviderKey).not.toHaveBeenCalled();
    });

    it.each([
      ['no record', null, 'unknown'],
      [
        'no route',
        { providerId: null, routeKind: 'unknown' } as const,
        'unknown',
      ],
      [
        'proxy without a provider id',
        { providerId: null, routeKind: 'proxy' } as const,
        'unknown',
      ],
    ])(
      '%s: unknown, keyed by the session',
      async (_name, route, providerId) => {
        const { resolver, probe } = harness({ route });
        const ref = await resolver.ownerForSession('s9');
        expect(ref.key).toBe(unknownOwnerKey(providerId, 'session:s9'));
        expect(probe.readAccount).not.toHaveBeenCalled();
        expectRestorable(ref);
      },
    );
  });

  it('never puts identity material into a ref or a log', async () => {
    const { resolver, logger } = harness({
      route: { providerId: 'anthropic', routeKind: 'native' },
      account: { email: EMAIL, organization: 'Org' },
      keys: { 'ollama-cloud': SECRET },
    });
    const refs = [
      await resolver.ownerForSession('s1'),
      await resolver.ownerForProviderKey('ollama-cloud'),
    ];
    const serialized = JSON.stringify({ refs, logger });
    expect(serialized).not.toContain(EMAIL);
    expect(serialized).not.toContain(SECRET);
  });
});
