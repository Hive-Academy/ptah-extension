/**
 * Electron watch host wiring (TASK_2026_437 C8, Task 8.4): the bundle path
 * contract Batch 10's build target must satisfy, the utilityProcess fork, the
 * `PTAH_WATCH_HOST=0` hatch, and the lazily resolved log/degradation sinks.
 */
jest.mock('electron', () => {
  const utilityProcess = { fork: jest.fn() };
  return { __esModule: true, utilityProcess, default: { utilityProcess } };
});

import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';
import electron from 'electron';
import { container as rootContainer } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';

import {
  ElectronWorkspaceWatchHostFactory,
  WORKSPACE_WATCH_HOST_BUNDLE,
  createElectronWorkspaceWatcherOptions,
  resolveWorkspaceWatchHostPath,
  selectWorkspaceWatchHostForker,
} from './electron-workspace-watch-host-factory';

const fork = (electron as unknown as { utilityProcess: { fork: jest.Mock } })
  .utilityProcess.fork;

describe('resolveWorkspaceWatchHostPath', () => {
  it('puts workspace-watch-host.mjs beside main.mjs, like integrity-worker.mjs', () => {
    const dist = path.join(path.sep, 'app', 'dist', 'apps', 'ptah-electron');
    expect(resolveWorkspaceWatchHostPath(dist)).toBe(
      path.join(dist, 'workspace-watch-host.mjs'),
    );
    expect(WORKSPACE_WATCH_HOST_BUNDLE).toBe('workspace-watch-host.mjs');
  });

  it('falls back to ~/.ptah when no __dirname is defined', () => {
    expect(resolveWorkspaceWatchHostPath(undefined)).toBe(
      path.join(os.homedir(), '.ptah', 'workspace-watch-host.mjs'),
    );
  });

  it('reads the bundle-global __dirname by default', () => {
    const bundleGlobal = globalThis as { __dirname?: string };
    const previous = bundleGlobal.__dirname;
    bundleGlobal.__dirname = '/bundle-dir';
    try {
      expect(resolveWorkspaceWatchHostPath()).toBe(
        path.join('/bundle-dir', 'workspace-watch-host.mjs'),
      );
    } finally {
      bundleGlobal.__dirname = previous;
    }
  });
});

describe('ElectronWorkspaceWatchHostFactory', () => {
  beforeEach(() => fork.mockReset());

  it('forks the configured host path as a named utilityProcess and wraps it', () => {
    const child = { postMessage: jest.fn(), on: jest.fn(), kill: jest.fn() };
    fork.mockReturnValue(child);

    const host = new ElectronWorkspaceWatchHostFactory(
      '/dist/workspace-watch-host.mjs',
    ).fork();
    host.postMessage({ type: 'unsubscribe', id: 1 });
    host.kill();

    expect(fork).toHaveBeenCalledWith('/dist/workspace-watch-host.mjs', [], {
      serviceName: 'ptah-workspace-watch-host',
    });
    expect(child.postMessage).toHaveBeenCalledWith({
      type: 'unsubscribe',
      id: 1,
    });
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
});

describe('selectWorkspaceWatchHostForker (PTAH_WATCH_HOST hatch)', () => {
  beforeEach(() => fork.mockReset());

  it.each([[{}], [{ PTAH_WATCH_HOST: '1' }], [{ PTAH_WATCH_HOST: '' }]])(
    'uses the utilityProcess host for env %j, silently',
    (env) => {
      const onDiagnostic = jest.fn();
      expect(
        selectWorkspaceWatchHostForker(env, '/h.mjs', onDiagnostic),
      ).toBeInstanceOf(ElectronWorkspaceWatchHostFactory);
      expect(onDiagnostic).not.toHaveBeenCalled();
    },
  );

  it('PTAH_WATCH_HOST=0 selects the in-process host, forks no process, and logs one info line', () => {
    const onDiagnostic = jest.fn();
    const forker = selectWorkspaceWatchHostForker(
      { PTAH_WATCH_HOST: '0' },
      '/h.mjs',
      onDiagnostic,
    );
    expect(forker).not.toBeInstanceOf(ElectronWorkspaceWatchHostFactory);
    expect(fork).not.toHaveBeenCalled();
    expect(onDiagnostic).toHaveBeenCalledTimes(1);
    expect(onDiagnostic).toHaveBeenCalledWith({
      level: 'info',
      message: expect.stringContaining('PTAH_WATCH_HOST=0'),
    });
  });

  it('routes the hatch line through the container sink at selection time', () => {
    const c = rootContainer.createChildContainer();
    const consoleLog = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    createElectronWorkspaceWatcherOptions(
      c,
      { PTAH_WATCH_HOST: '0' },
      '/h.mjs',
    );
    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining('PTAH_WATCH_HOST=0'),
      '',
    );
    consoleLog.mockRestore();
  });
});

describe('createElectronWorkspaceWatcherOptions sinks', () => {
  it('logs through TOKENS.LOGGER once it exists, and the console before', () => {
    const c = rootContainer.createChildContainer();
    const options = createElectronWorkspaceWatcherOptions(c, {}, '/h.mjs');
    const consoleWarn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    options.onDiagnostic?.({ level: 'warn', message: 'early' });
    expect(consoleWarn).toHaveBeenCalledWith('early', '');

    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    c.register(TOKENS.LOGGER, { useValue: logger });
    options.onDiagnostic?.({
      level: 'error',
      message: 'late',
      detail: { reason: 'exited' },
    });
    options.onDiagnostic?.({ level: 'info', message: 'note' });
    expect(logger.error).toHaveBeenCalledWith('late', { reason: 'exited' });
    expect(logger.info).toHaveBeenCalledWith('note', {});
    consoleWarn.mockRestore();
  });

  it('reports degradation once DEGRADATION_REPORTER exists, with a literal code', () => {
    const c = rootContainer.createChildContainer();
    const options = createElectronWorkspaceWatcherOptions(c, {}, '/h.mjs');
    const degradation = {
      reason: 'heartbeat-missed',
      failuresInWindow: 6,
      rescanIntervalMs: 60_000,
    };

    expect(() => options.onDegraded?.(degradation)).not.toThrow();

    const reporter = { report: jest.fn() };
    c.register(TOKENS.DEGRADATION_REPORTER, { useValue: reporter });
    options.onDegraded?.(degradation);
    expect(reporter.report).toHaveBeenCalledWith({
      source: 'workspace-watcher',
      code: 'electron.workspace-watcher.host-degraded',
      severity: 'degraded',
      summary: expect.stringContaining('6 watch host failures'),
      detail: 'heartbeat-missed',
    });
  });
});
