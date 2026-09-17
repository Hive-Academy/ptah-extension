import 'reflect-metadata';
import { resolve } from 'node:path';
import { CodexHomeResolver } from './codex-home-resolver';

describe('CodexHomeResolver', () => {
  it('prefers the injected override and resolves only once', () => {
    const env: Record<string, string | undefined> = { CODEX_HOME: resolve('ignored-env-home') };
    const resolver = new CodexHomeResolver(resolve('synthetic-home'), env, () => resolve('ignored-home'));
    env['CODEX_HOME'] = resolve('changed-env-home');
    expect(resolver.path).toBe(resolve('synthetic-home'));
  });

  it('uses the injected CODEX_HOME environment before homedir', () => {
    const resolver = new CodexHomeResolver(
      undefined, { CODEX_HOME: resolve('synthetic-env-home') }, () => resolve('ignored-home'),
    );
    expect(resolver.path).toBe(resolve('synthetic-env-home'));
  });

  it('falls back to the injected homedir plus .codex', () => {
    const resolver = new CodexHomeResolver(undefined, {}, () => resolve('synthetic-user-home'));
    expect(resolver.path).toBe(resolve('synthetic-user-home', '.codex'));
  });

  it('does not change after the injected environment mutates', () => {
    const env: Record<string, string | undefined> = { CODEX_HOME: resolve('first-home') };
    const resolver = new CodexHomeResolver(undefined, env, () => resolve('synthetic-user-home'));
    env['CODEX_HOME'] = resolve('second-home');
    expect(resolver.path).toBe(resolve('first-home'));
  });
});
