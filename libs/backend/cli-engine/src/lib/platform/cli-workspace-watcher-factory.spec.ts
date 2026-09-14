/**
 * CLI watch host wiring (TASK_2026_437 C9): the bundle path both `main.mjs`
 * and `tui.mjs` resolve, and the lazily resolved log and degradation sinks.
 */
import 'reflect-metadata';

import * as path from 'node:path';
import { container as rootContainer } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';

import { createCliWorkspaceWatcherOptions } from './cli-workspace-watcher-factory';

describe('createCliWorkspaceWatcherOptions', () => {
  it('puts the host beside the running bundle', () => {
    const dist = path.join(path.sep, 'pkg', 'dist', 'apps', 'ptah-cli');
    const options = createCliWorkspaceWatcherOptions(
      rootContainer.createChildContainer(),
      dist,
    );
    expect(options.hostPath).toBe(path.join(dist, 'workspace-watch-host.mjs'));
  });

  it('logs through TOKENS.LOGGER once it exists, and never to the console before', () => {
    const c = rootContainer.createChildContainer();
    const options = createCliWorkspaceWatcherOptions(c, '/dist');
    const consoleSpies = (['log', 'warn', 'error'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );

    options.onDiagnostic?.({ level: 'warn', message: 'early' });
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();

    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    c.register(TOKENS.LOGGER, { useValue: logger });
    options.onDiagnostic?.({
      level: 'error',
      message: 'late',
      detail: { reason: 'exited' },
    });
    options.onDiagnostic?.({ level: 'warn', message: 'careful' });
    options.onDiagnostic?.({ level: 'info', message: 'note' });
    expect(logger.error).toHaveBeenCalledWith('late', { reason: 'exited' });
    expect(logger.warn).toHaveBeenCalledWith('careful', {});
    expect(logger.info).toHaveBeenCalledWith('note', {});
    for (const spy of consoleSpies) spy.mockRestore();
  });

  it('reports degradation once DEGRADATION_REPORTER exists, with a literal code', () => {
    const c = rootContainer.createChildContainer();
    const options = createCliWorkspaceWatcherOptions(c, '/dist');
    const degradation = {
      reason: 'fork-failed',
      failuresInWindow: 6,
      rescanIntervalMs: 60_000,
    };

    expect(() => options.onDegraded?.(degradation)).not.toThrow();

    const reporter = { report: jest.fn() };
    c.register(TOKENS.DEGRADATION_REPORTER, { useValue: reporter });
    options.onDegraded?.(degradation);
    expect(reporter.report).toHaveBeenCalledWith({
      source: 'workspace-watcher',
      code: 'cli.workspace-watcher.host-degraded',
      severity: 'degraded',
      summary: expect.stringContaining('6 watch host failures'),
      detail: 'fork-failed',
    });
  });
});
