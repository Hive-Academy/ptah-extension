/**
 * One `GitInfoService` per CLI host (TASK_2026_576 RC13, V11).
 *
 * Cache invalidation from the worktree hook, the task sweep and the file-link
 * policy only reaches the next `git:*` RPC when every resolver shares one
 * instance. `setup()` is the whole CLI bootstrap and is not run here (see
 * `container-governor-shutdown.spec.ts` for that precedent); the registration
 * helper `setup()` calls is exercised on a child container instead.
 */
import 'reflect-metadata';
import { container as rootContainer } from 'tsyringe';
import {
  GitInfoService,
  TOKENS,
  type Logger,
} from '@ptah-extension/vscode-core';
import { registerGitInfoService } from './container';

function buildGitInfoContainer() {
  const c = rootContainer.createChildContainer();
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
  c.register(TOKENS.LOGGER, { useValue: logger });
  registerGitInfoService(c);
  return c;
}

describe('CLI DI — GitInfoService is one instance per host', () => {
  it('resolves GIT_INFO_SERVICE to the same instance every time', () => {
    const c = buildGitInfoContainer();

    const first = c.resolve<GitInfoService>(TOKENS.GIT_INFO_SERVICE);

    expect(first).toBeInstanceOf(GitInfoService);
    expect(c.resolve(TOKENS.GIT_INFO_SERVICE)).toBe(first);
  });

  it('does not construct the service at registration time', () => {
    const c = rootContainer.createChildContainer();
    const resolve = jest.spyOn(c, 'resolve');

    registerGitInfoService(c);

    expect(resolve).not.toHaveBeenCalled();
  });
});
