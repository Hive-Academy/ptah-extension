/**
 * The run-check kill on `will-quit` (TASK_2026_614 G.4, decision G-A).
 *
 * A live `ptah_run_check` owns an Nx process tree that outlives the app unless
 * killed, and the kill is not done when its call returns (win32 `taskkill`
 * after a dynamic import, POSIX SIGKILL after a grace timer). So a running
 * check defers the quit, and the quit is re-issued only after the kill has
 * finished or its budget has run out.
 */

import {
  killRunningChecks,
  runningCheckPids,
} from '@ptah-extension/vscode-lm-tools';
import { createEmptyBootRefs } from './boot-coordinator';
import type { BootRefs } from './boot-coordinator';
import {
  RUN_CHECK_KILL_BUDGET_MS,
  handleWillQuit,
  requiresDeferredDisposal,
} from './shutdown';

jest.mock('@ptah-extension/vscode-lm-tools', () => ({
  killRunningChecks: jest.fn(async () => undefined),
  runningCheckPids: jest.fn(() => []),
}));

const kill = jest.mocked(killRunningChecks);
const pids = jest.mocked(runningCheckPids);

/** Refs with only the SQLite connection and diagnostics, both recording. */
function minimalRefs(order: string[]): BootRefs {
  const refs = createEmptyBootRefs();
  refs.sqliteConnection = {
    close: () => order.push('sqliteConnection'),
  } as unknown as BootRefs['sqliteConnection'];
  refs.diagnostics = {
    dispose: () => order.push('diagnostics'),
  } as unknown as BootRefs['diagnostics'];
  return refs;
}

function quitDeps(refs: BootRefs) {
  return {
    refs,
    abortBoot: jest.fn(),
    isBootRunning: () => false,
    awaitBootCompletion: async () => undefined,
    flushWorkspacePersistence: jest.fn(),
    flushSessionMetadataStores: jest.fn(async () => undefined),
    clearTimers: jest.fn(),
    disposeVoiceWorker: jest.fn(),
    deferQuit: jest.fn(),
    quit: jest.fn(),
  };
}

async function flushMicrotasks(turns = 30): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    await Promise.resolve();
  }
}

describe('will-quit — the run-check kill', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    kill.mockReset().mockResolvedValue(undefined);
    pids.mockReset().mockReturnValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('defers the quit while a check is running, with nothing else to await', () => {
    pids.mockReturnValue([4242]);
    const deps = quitDeps(minimalRefs([]));

    expect(requiresDeferredDisposal(deps.refs)).toBe(true);
    expect(handleWillQuit(deps)).toBe(false);
    expect(deps.deferQuit).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it('re-issues the quit only after the kill has finished', async () => {
    pids.mockReturnValue([4242]);
    kill.mockImplementation(
      () => new Promise<void>((resolve) => setTimeout(resolve, 1000)),
    );
    const order: string[] = [];
    const deps = quitDeps(minimalRefs(order));

    handleWillQuit(deps);
    await flushMicrotasks();

    // The rest of the teardown does not queue behind the kill...
    expect(order).toEqual(['sqliteConnection', 'diagnostics']);
    // ...but the quit does.
    expect(deps.quit).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1000);
    await flushMicrotasks();

    expect(deps.quit).toHaveBeenCalledTimes(1);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('quits anyway once a wedged kill exceeds its budget', async () => {
    pids.mockReturnValue([4242]);
    kill.mockImplementation(() => new Promise<void>(() => undefined));
    const deps = quitDeps(minimalRefs([]));

    handleWillQuit(deps);
    await flushMicrotasks();
    expect(deps.quit).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(RUN_CHECK_KILL_BUDGET_MS);
    await flushMicrotasks();

    expect(deps.quit).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Run-check kill exceeded'),
    );
  });

  it('stays synchronous when no check is running and nothing else waits', () => {
    const order: string[] = [];
    const deps = quitDeps(minimalRefs(order));

    expect(requiresDeferredDisposal(deps.refs)).toBe(false);
    expect(handleWillQuit(deps)).toBe(true);
    expect(deps.deferQuit).not.toHaveBeenCalled();
    expect(order).toEqual(['sqliteConnection', 'diagnostics']);
  });
});
