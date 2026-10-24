import 'reflect-metadata';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import axios from 'axios';
import { z } from 'zod';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import type { CodexHomeAuthReader } from '@ptah-extension/codex-runtime';
import {
  CodexHomeAuthService,
  resolveCodexHome,
} from './codex-home-auth.service';

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
  });
  afterEach(async () => {
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

  it('does not retry an ambiguous rotating-token failure, and logs no credentials', async () => {
    await seed(a, stale('secret-marker'));
    post.mockRejectedValue(new Error('refresh-secret-marker'));
    expect(await service.ensureTokensFresh(a)).toBe(false);
    expect(await service.ensureTokensFresh(a)).toBe(false);
    expect(post).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
      'secret-marker',
    );
    await seed(a, stale('new-login'));
    expect(await service.ensureTokensFresh(a)).toBe(false);
    expect(post).toHaveBeenCalledTimes(2);
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
        home: a,
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
