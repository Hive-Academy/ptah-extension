import 'reflect-metadata';
import { container as rootContainer, type DependencyContainer } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { MEMORY_TOKENS } from '@ptah-extension/memory-curator';
import { startSearchWorkerAfterMigrations } from './search-worker-prestart';

function makeContainer(worker?: { start: () => void }): {
  container: DependencyContainer;
  warn: jest.Mock;
} {
  const container = rootContainer.createChildContainer();
  const warn = jest.fn();
  container.register(TOKENS.LOGGER, {
    useValue: { debug: jest.fn(), info: jest.fn(), warn, error: jest.fn() },
  });
  if (worker) container.register(MEMORY_TOKENS.SQLITE_SEARCH_WORKER, { useValue: worker });
  return { container, warn };
}

describe('startSearchWorkerAfterMigrations', () => {
  it('forks the registered search worker', () => {
    const start = jest.fn();
    const { container } = makeContainer({ start });
    startSearchWorkerAfterMigrations(container);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('does nothing when memory-curator registration was skipped', () => {
    const { container, warn } = makeContainer();
    expect(() => startSearchWorkerAfterMigrations(container)).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs a failed prestart and lets the first search fork the worker', () => {
    const { container, warn } = makeContainer({
      start: () => {
        throw new Error('spawn EACCES');
      },
    });
    startSearchWorkerAfterMigrations(container);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('prestart failed'), { error: 'spawn EACCES' });
  });
});
