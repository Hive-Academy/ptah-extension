import { mkdtempSync, rmSync, renameSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLAUDE_ACCOUNT_SELECTOR_KEYS, certifyClaudeAccountEnvironment, parseClaudeAccountStatus, ClaudeAccountCommand } from './claude-account-command';
import { resolveProviderAccountRoute, type CanonicalProviderAccountRoute } from './provider-account-route';

describe('Claude account source certification', () => {
  let root: string;
  let route: CanonicalProviderAccountRoute;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ptah-account-env-')); route = resolveProviderAccountRoute(root); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it.each(CLAUDE_ACCOUNT_SELECTOR_KEYS)('refuses conflicting selector %s before clearing', key => {
    expect(() => certifyClaudeAccountEnvironment({ [key]: 'foreign' }, [{}], route)).toThrow(expect.objectContaining({ code: 'unsupported-source' }));
  });

  it.each([
    'CLAUDE_SECURESTORAGE_CONFIG_DIR', 'claude_securestorage_config_dir', 'Claude_SecureStorage_Config_Dir',
    'ANTHROPIC_CONFIG_DIR', 'anthropic_config_dir', 'Anthropic_Profile',
  ])('rejects a populated namespace and canonicalizes an empty namespace %s', key => {
    expect(() => certifyClaudeAccountEnvironment({ [key]: 'foreign' }, [{}], route)).toThrow(expect.objectContaining({ code: 'unsupported-source' }));
    const env = Object.freeze({ [key]: '' });
    const child = certifyClaudeAccountEnvironment(env, [{}], route);
    if (key !== 'CLAUDE_SECURESTORAGE_CONFIG_DIR') expect(child).not.toHaveProperty(key);
    expect(child['CLAUDE_CONFIG_DIR']).toBe(route.canonicalPath);
    expect(child['CLAUDE_SECURESTORAGE_CONFIG_DIR']).toBe(route.canonicalPath);
    expect(Object.keys(child).filter(candidate => candidate.toUpperCase() === 'CLAUDE_SECURESTORAGE_CONFIG_DIR'))
      .toEqual(['CLAUDE_SECURESTORAGE_CONFIG_DIR']);
    expect(env[key]).toBe('');
  });

  it('clears the finite selectors, preserves real home and never mutates parent env', () => {
    const env: NodeJS.ProcessEnv = { HOME: 'real-home', USERPROFILE: 'real-profile', PATH: 'bin', NODE_OPTIONS: 'untrusted' };
    for (const key of CLAUDE_ACCOUNT_SELECTOR_KEYS) env[key] = '';
    const child = certifyClaudeAccountEnvironment(env, [{}], route);
    for (const key of CLAUDE_ACCOUNT_SELECTOR_KEYS) {
      expect(child[key]).toBe(key === 'CLAUDE_CONFIG_DIR' || key === 'CLAUDE_SECURESTORAGE_CONFIG_DIR' ? route.canonicalPath : undefined);
      expect(env[key]).toBe('');
    }
    expect(child['HOME']).toBe('real-home'); expect(child['USERPROFILE']).toBe('real-profile');
    expect(child['NODE_OPTIONS']).toBeUndefined();
  });

  it.each(['apiKeyHelper', 'env', 'forceLoginMethod', 'forceLoginOrgUUID', 'awsAuthRefresh', 'unknownPolicy'])(
    'refuses effective project local or managed override %s without executing it', key => {
      expect(() => certifyClaudeAccountEnvironment({}, [{}, { [key]: 'do not execute' }], route)).toThrow();
    });

  it('refuses missing precedence evidence and unknown or differently cased auth inputs', () => {
    expect(() => certifyClaudeAccountEnvironment({}, null, route)).toThrow();
    expect(() => certifyClaudeAccountEnvironment({}, [], route)).toThrow();
    expect(() => certifyClaudeAccountEnvironment({ anthropic_future_token: 'secret' }, [{}], route)).toThrow();
    expect(() => certifyClaudeAccountEnvironment({ claude_code_oauth_token: 'secret' }, [{}], route)).toThrow();
  });

  it('certifies only matching directory and claude.ai or none, discarding identity', () => {
    const body = { configDir: route.canonicalPath, authMethod: 'claude.ai', email: 'private@example.test', organization: 'private' };
    expect(parseClaudeAccountStatus(JSON.stringify(body), route.canonicalPath)).toBe('claude.ai');
    expect(parseClaudeAccountStatus(JSON.stringify({ ...body, authMethod: 'none' }), route.canonicalPath)).toBe('none');
    for (const authMethod of ['console', 'api-key', 'bedrock', 'unknown']) {
      expect(() => parseClaudeAccountStatus(JSON.stringify({ ...body, authMethod }), route.canonicalPath)).toThrow();
    }
    expect(() => parseClaudeAccountStatus(JSON.stringify(body), 'wrong-directory')).toThrow();
    expect(() => parseClaudeAccountStatus(JSON.stringify({ ...body, apiKeyHelper: 'command' }), route.canonicalPath)).toThrow();
    expect(() => parseClaudeAccountStatus('Bearer secret', route.canonicalPath)).toThrow();
  });

  it('refuses unknown live certification even when release authorization is mocked', async () => {
    const detector = { findExecutable: jest.fn() };
    const spawner = { spawnProcess: jest.fn() };
    const command = new ClaudeAccountCommand(detector, spawner);
    jest.spyOn(command, 'authorization').mockReturnValue('ok');
    expect((await command.execute('status', route, new AbortController().signal)).code).toBe('unsupported-source');
    expect(detector.findExecutable).not.toHaveBeenCalled(); expect(spawner.spawnProcess).not.toHaveBeenCalled();
  });

  it('revalidates directory identity immediately before the spawn', async () => {
    const directory = join(root, 'account'); mkdirSync(directory);
    const selected = resolveProviderAccountRoute(directory);
    const detector = { findExecutable: jest.fn().mockImplementation(async () => {
      renameSync(directory, join(root, 'original')); mkdirSync(directory);
      return { path: 'never-run', source: 'path' as const };
    }) };
    const spawner = { spawnProcess: jest.fn() };
    const command = new ClaudeAccountCommand(detector, spawner);
    jest.spyOn(command, 'authorization').mockReturnValue('ok');
    jest.spyOn(command, 'environment').mockReturnValue({});
    expect((await command.execute('status', selected, new AbortController().signal)).code).toBe('route-changed');
    expect(spawner.spawnProcess).not.toHaveBeenCalled();
  });
});
