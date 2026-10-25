import 'reflect-metadata';
import * as fs from 'node:fs/promises';
import * as nodeFs from 'node:fs';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import axios from 'axios';
import { z } from 'zod';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import {
  normalizeCodexHomeKey,
  type CodexHomeAuthReader,
} from '@ptah-extension/codex-runtime';
import {
  CodexHomeAuthService,
  resolveCodexHome,
} from './codex-home-auth.service';

jest.mock('node:fs/promises', () => {
  const actual =
    jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    rename: jest.fn(actual.rename),
    readFile: jest.fn(actual.readFile),
    writeFile: jest.fn(actual.writeFile),
  };
});
jest.mock('node:fs', () => {
  const actual = jest.requireActual<typeof import('node:fs')>('node:fs');
  return { ...actual, watch: jest.fn(actual.watch) };
});
jest.mock('axios');
const post = jest.mocked(axios.post);
const stale = (home: string) => ({
  tokens: { access_token: `old-${home}`, refresh_token: `refresh-${home}` },
  last_refresh: '2000-01-01T00:00:00.000Z',
  preserved: 'metadata',
});

describe('CodexHomeAuthService', () => {
  let root: string;
  let a: string;
  let b: string;
  let service: CodexHomeAuthService;
  let logger: ReturnType<typeof createMockLogger>;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ptah-home-auth-'));
    a = join(root, 'a');
    b = join(root, 'b');
    await Promise.all([mkdir(a), mkdir(b)]);
    logger = createMockLogger();
    service = new CodexHomeAuthService(logger, createMockWorkspaceProvider());
    post.mockReset();
    jest.mocked(axios.isAxiosError).mockReturnValue(false);
  });
  afterEach(async () => {
    jest
      .mocked(fs.rename)
      .mockImplementation(
        jest.requireActual<typeof import('node:fs/promises')>(
          'node:fs/promises',
        ).rename,
      );
    await rm(root, { recursive: true, force: true });
  });
  const seed = (home: string, value: unknown) =>
    writeFile(join(home, 'auth.json'), JSON.stringify(value));

  it('resolves trimmed absolute CODEX_HOME or the OS home without HOME precedence', () => {
    expect(resolveCodexHome({ CODEX_HOME: '  relative-home  ' }, () => a)).toBe(
      resolve('relative-home'),
    );
    expect(
      resolveCodexHome({ CODEX_HOME: '  ', HOME: b, USERPROFILE: b }, () => a),
    ).toBe(join(a, '.codex'));
    expect(resolveCodexHome({}, () => a)).toBe(join(a, '.codex'));
  });

  it('shares the core home key across trailing separators and Windows case aliases', () => {
    const alias =
      process.platform === 'win32' ? `${a.toUpperCase()}/` : `${a}/`;
    expect(service.forHome(alias)).toBe(service.forHome(a));
    expect(resolveCodexHome({ CODEX_HOME: alias })).toBe(resolve(alias));
  });

  (process.platform === 'win32' ? it : it.skip)(
    'preserves mixed-case filesystem paths while Windows case aliases share an owner',
    async () => {
      const home = join(root, 'MixedCaseHome');
      await mkdir(home);
      await seed(home, stale('mixed'));
      const read = jest.mocked(fs.readFile);
      const write = jest.mocked(fs.writeFile);
      const watcher = jest.mocked(nodeFs.watch);
      post.mockResolvedValue({
        data: { access_token: 'fresh', refresh_token: 'rotated' },
      });
      const owner = service.forHome(home);
      const subscription = service.watch(home.toLowerCase(), jest.fn());
      try {
        expect(resolveCodexHome({ CODEX_HOME: home })).toBe(home);
        expect(service.forHome(home.toUpperCase())).toBe(owner);
        expect(await service.ensureTokensFresh(home.toUpperCase())).toBe(true);
        expect(read).toHaveBeenCalledWith(join(home, 'auth.json'), 'utf-8');
        expect(write).toHaveBeenCalledWith(
          expect.stringContaining(join(home, 'auth.json')),
          expect.any(String),
          expect.objectContaining({ mode: 0o600 }),
        );
        expect(fs.rename).toHaveBeenCalledWith(
          expect.stringContaining(join(home, 'auth.json')),
          join(home, 'auth.json'),
        );
        expect(watcher).toHaveBeenCalledWith(home, expect.any(Function));
      } finally {
        subscription.dispose();
      }
    },
  );

  it.each(['http', 'exception'] as const)(
    'logs sanitized model discovery failure: %s',
    async (failure) => {
      await seed(a, { OPENAI_API_KEY: 'private-test-key' });
      const fetchMock = jest.spyOn(globalThis, 'fetch');
      if (failure === 'http')
        fetchMock.mockResolvedValue(
          new Response('private-body', { status: 503 }),
        );
      else fetchMock.mockRejectedValue(new Error('private-test-key'));
      try {
        expect(await service.forHome(a).listModels()).toEqual([]);
        expect(logger.debug).toHaveBeenCalledWith(
          failure === 'http'
            ? '[CodexAuth] Model discovery request failed.'
            : '[CodexAuth] Model discovery unavailable.',
        );
        expect(JSON.stringify(logger.debug.mock.calls)).not.toContain(
          'private-',
        );
      } finally {
        fetchMock.mockRestore();
      }
    },
  );

  it('implements the credential-free port and isolates invalid auth and cache by home', async () => {
    const reader: CodexHomeAuthReader = service;
    await seed(a, { OPENAI_API_KEY: 'synthetic-key' });
    await seed(b, { tokens: { access_token: 42 } });
    expect(await reader.isAuthenticated(a)).toBe(true);
    expect(await reader.isAuthenticated(b)).toBe(false);
    expect(await reader.getUsageEligibility(a)).toBe('unsupported-auth');
    await seed(b, { tokens: { access_token: 'synthetic-oauth' } });
    expect(await reader.getUsageEligibility(b)).toBe('supported');
    expect(await reader.isAuthenticated(join(root, 'missing'))).toBe(false);
  });

  it('serializes same-home refresh and writes unique restricted temp files without cross-home leakage', async () => {
    await Promise.all([seed(a, stale('a')), seed(b, stale('b'))]);
    post.mockImplementation(async (_url, data) => {
      const body = z.object({ refresh_token: z.string() }).parse(data);
      return {
        data: {
          access_token: `new-${body.refresh_token}`,
          refresh_token: `rotated-${body.refresh_token}`,
        },
      };
    });
    expect(
      await Promise.all([
        service.ensureTokensFresh(a),
        service.ensureTokensFresh(resolve(a, '.')),
        service.ensureTokensFresh(b),
      ]),
    ).toEqual([true, true, true]);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][2]).toMatchObject({ timeout: 30_000 });
    const contentA = await readFile(join(a, 'auth.json'), 'utf-8');
    const contentB = await readFile(join(b, 'auth.json'), 'utf-8');
    expect(contentA).toContain('new-refresh-a');
    expect(contentA).not.toContain('refresh-b');
    expect(contentB).toContain('new-refresh-b');
    expect(contentA).toContain('metadata');
  });

  it.each([
    {
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        id_token: 'synthetic-id',
        access_token: 'synthetic-access',
        refresh_token: 'synthetic-refresh',
        account_id: 'synthetic-account',
      },
      last_refresh: new Date().toISOString(),
      future_field: true,
    },
    {
      auth_mode: 'apikey',
      OPENAI_API_KEY: 'synthetic-key',
      tokens: null,
      last_refresh: null,
    },
    {
      auth_mode: null,
      OPENAI_API_KEY: null,
      tokens: {
        access_token: 'synthetic-access',
        id_token: null,
        refresh_token: null,
        account_id: null,
      },
      last_refresh: null,
      api_base_url: null,
    },
  ])(
    'accepts real external auth.json shapes with synthetic credentials: %j',
    async (auth) => {
      await seed(a, auth);
      expect(await service.isAuthenticated(a)).toBe(true);
      expect(await service.forHome(a).getHeaders()).toMatchObject({
        Authorization: expect.stringContaining('Bearer synthetic-'),
      });
    },
  );

  it('accepts fully null optional fields as unauthenticated', async () => {
    await seed(a, {
      auth_mode: null,
      OPENAI_API_KEY: null,
      openai_api_key: null,
      tokens: null,
      last_refresh: null,
      api_base_url: null,
    });
    expect(await service.isAuthenticated(a)).toBe(false);
  });

  it.each([
    new Error('synthetic-secret'),
    { response: { status: 503 } },
    { code: 'ETIMEDOUT' },
  ])(
    'retries transient refresh failures without logging secrets',
    async (failure) => {
      await seed(a, stale('secret-marker'));
      jest.mocked(axios.isAxiosError).mockReturnValue(true);
      post.mockRejectedValueOnce(failure).mockResolvedValueOnce({
        data: { access_token: 'fresh', refresh_token: 'rotated' },
      });
      expect(await service.ensureTokensFresh(a)).toBe(false);
      expect(await service.ensureTokensFresh(a)).toBe(true);
      expect(post).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret');
    },
  );

  it.each([{ status: 401 }, { status: 400, data: { error: 'invalid_grant' } }])(
    'latches definitive refresh rejection until an external login',
    async (response) => {
      await seed(a, stale('secret-marker'));
      jest.mocked(axios.isAxiosError).mockReturnValue(true);
      post.mockRejectedValue({ response });
      expect(await service.ensureTokensFresh(a)).toBe(false);
      expect(await service.ensureTokensFresh(a)).toBe(false);
      expect(post).toHaveBeenCalledTimes(1);
      await seed(a, stale('new-login'));
      expect(await service.ensureTokensFresh(a)).toBe(false);
      expect(post).toHaveBeenCalledTimes(2);
    },
  );

  it('keeps rotated credentials through failed persistence and cache invalidation, then retries saving', async () => {
    await seed(a, stale('a'));
    await seed(b, stale('b'));
    post.mockResolvedValue({
      data: { access_token: 'fresh-a', refresh_token: 'rotated-a' },
    });
    const rename = jest
      .mocked(fs.rename)
      .mockRejectedValue(new Error('synthetic-sensitive-path'));
    expect(await service.ensureTokensFresh(a)).toBe(true);
    service.forHome(a).clearCache();
    expect((await service.forHome(a).getHeaders()).Authorization).toBe(
      'Bearer fresh-a',
    );
    expect((await service.forHome(b).getHeaders()).Authorization).toBe(
      'Bearer old-b',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('refresh succeeded but could not be persisted'),
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
      'synthetic-sensitive-path',
    );
    rename.mockImplementation(
      jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises')
        .rename,
    );
    expect(await service.ensureTokensFresh(a)).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
    expect(await readFile(join(a, 'auth.json'), 'utf-8')).toContain(
      'rotated-a',
    );
  });

  it('retains rotated credentials while disk JSON is partial, then preserves unknown metadata when saving', async () => {
    const auth = {
      ...stale('a'),
      auth_mode: 'chatgpt',
      tokens: {
        ...stale('a').tokens,
        account_id: null,
        future_token_field: true,
      },
    };
    await seed(a, auth);
    post.mockImplementation(async () => {
      await writeFile(join(a, 'auth.json'), '{');
      return { data: { access_token: 'fresh', refresh_token: 'rotated' } };
    });
    expect(await service.ensureTokensFresh(a)).toBe(true);
    expect((await service.forHome(a).getHeaders()).Authorization).toBe(
      'Bearer fresh',
    );
    await seed(a, auth);
    expect(await service.ensureTokensFresh(a)).toBe(true);
    expect(
      JSON.parse(await readFile(join(a, 'auth.json'), 'utf-8')),
    ).toMatchObject({
      preserved: 'metadata',
      auth_mode: 'chatgpt',
      tokens: {
        refresh_token: 'rotated',
        future_token_field: true,
        account_id: null,
      },
    });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('shares a host owner but routes diagnostics to every registered logger exactly once', async () => {
    const workspace = createMockWorkspaceProvider();
    const otherLogger = createMockLogger();
    const first = CodexHomeAuthService.forHost(logger, workspace);
    first.forHome(a);
    const second = CodexHomeAuthService.forHost(otherLogger, workspace);
    CodexHomeAuthService.forHost(otherLogger, workspace);
    expect(first).toBe(second);
    await seed(a, stale('a'));
    post.mockRejectedValue(new Error('offline'));
    await second.ensureTokensFresh(a);
    expect(otherLogger.warn.mock.calls).toEqual(logger.warn.mock.calls);
    expect(otherLogger.warn).toHaveBeenCalledTimes(1);
  });

  it('refuses to overwrite an external login while refreshing', async () => {
    await seed(a, stale('a'));
    post.mockImplementation(async () => {
      await seed(a, stale('external-login'));
      return { data: { access_token: 'obsolete-result' } };
    });
    expect(await service.ensureTokensFresh(a)).toBe(false);
    expect(await readFile(join(a, 'auth.json'), 'utf-8')).toContain(
      'external-login',
    );
  });

  it('cancels one waiter without cancelling another home consumer', async () => {
    await seed(a, stale('a'));
    const controller = new AbortController();
    post.mockImplementation(async () => {
      controller.abort();
      return { data: { access_token: 'fresh' } };
    });
    expect(
      await Promise.all([
        service.ensureTokensFresh(a, controller.signal),
        service.ensureTokensFresh(a),
      ]),
    ).toEqual([false, true]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(await service.ensureTokensFresh(b, controller.signal)).toBe(false);
  });

  it('reference-counts watcher subscriptions and emits only credential-free scoped events', async () => {
    await seed(a, stale('a'));
    const first = jest.fn();
    const second = jest.fn();
    const other = jest.fn();
    const x = service.watch(a, first);
    const y = service.watch(a, second);
    const z = service.watch(b, other);
    try {
      x.dispose();
      x.dispose();
      post.mockResolvedValue({ data: { access_token: 'fresh' } });
      expect(await service.ensureTokensFresh(a)).toBe(true);
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledWith({
        home: normalizeCodexHomeKey(a, process.platform),
        generation: 1,
        kind: 'refreshed',
      });
      expect(other).not.toHaveBeenCalled();
    } finally {
      x.dispose();
      y.dispose();
      z.dispose();
    }
  });
});
