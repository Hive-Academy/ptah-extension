import 'reflect-metadata';
import { container as rootContainer, type DependencyContainer } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import { startWalCheckpointsAfterMigrations } from './wal-checkpoint-start';

function makeContainer(scheduler?: { start: () => boolean; dispose: () => void }): {
  container: DependencyContainer;
  warn: jest.Mock;
} {
  const container = rootContainer.createChildContainer();
  const warn = jest.fn();
  container.register(TOKENS.LOGGER, {
    useValue: { debug: jest.fn(), info: jest.fn(), warn, error: jest.fn() },
  });
  if (scheduler) {
    container.register(PERSISTENCE_TOKENS.WAL_CHECKPOINT_SCHEDULER, { useValue: scheduler });
  }
  return { container, warn };
}

describe('startWalCheckpointsAfterMigrations', () => {
  it('starts the scheduler and returns it for shutdown', () => {
    const scheduler = { start: jest.fn(() => true), dispose: jest.fn() };
    const { container } = makeContainer(scheduler);
    expect(startWalCheckpointsAfterMigrations(container)).toBe(scheduler);
    expect(scheduler.start).toHaveBeenCalledTimes(1);
  });

  it('returns null when the scheduler did not start (no worker factory)', () => {
    const scheduler = { start: jest.fn(() => false), dispose: jest.fn() };
    const { container } = makeContainer(scheduler);
    expect(startWalCheckpointsAfterMigrations(container)).toBeNull();
  });

  it('returns null when persistence registration was skipped', () => {
    const { container, warn } = makeContainer();
    expect(startWalCheckpointsAfterMigrations(container)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs a failed start and keeps SQLite auto-checkpoint', () => {
    const { container, warn } = makeContainer({
      start: () => {
        throw new Error('spawn EACCES');
      },
      dispose: jest.fn(),
    });
    expect(startWalCheckpointsAfterMigrations(container)).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('start failed'), {
      error: 'spawn EACCES',
    });
  });
});
