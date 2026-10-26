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
  CODEX_DISPOSE_BUDGET_MS,
  handleWillQuit,
  requiresDeferredDisposal,
} from './shutdown';

import { disposeElectronCodexBindings, hasElectronCodexBindings } from '../di/codex-binding-registry';

jest.mock('../di/codex-binding-registry', () => ({
  disposeElectronCodexBindings: jest.fn(async () => undefined),
  hasElectronCodexBindings: jest.fn(() => false),
}));

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

  it('awaits agent reap, lane outcomes, then SQLite close before re-issuing quit', async () => {
    const order: string[] = [];
    let finish!: () => void;
    const refs = minimalRefs(order);
    refs.laneOutcomesDisposer = {
      dispose: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
          order.push('lane outcomes');
        }),
    };
    refs.agentProcessManager = {
      disposeAll: async () => {
        order.push('agent reap');
      },
    };
    const deps = quitDeps(refs);

    expect(handleWillQuit(deps)).toBe(false);
    await flushMicrotasks();
    expect(order).toEqual(['agent reap', 'lane outcomes']);
    expect(deps.quit).not.toHaveBeenCalled();

    finish();
    await flushMicrotasks();
    expect(order).toEqual([
      'agent reap',
      'lane outcomes',
      'sqliteConnection',
      'diagnostics',
    ]);
    expect(deps.quit).toHaveBeenCalledTimes(1);
  });
});


describe('will-quit ? Codex bindings', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    pids.mockReturnValue([]);
    jest.mocked(hasElectronCodexBindings).mockReturnValue(true);
    jest.mocked(disposeElectronCodexBindings).mockReset();
  });

  afterEach(() => {
    jest.mocked(hasElectronCodexBindings).mockReturnValue(false);
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('continues teardown and the final flush after a rejected Codex close', async () => {
    const failure = new Error('scope close failed');
    jest.mocked(disposeElectronCodexBindings).mockRejectedValue(failure);
    const order: string[] = [];
    const deps = quitDeps(minimalRefs(order));
    deps.disposeVoiceWorker.mockImplementation(() => { order.push('voice'); });
    deps.flushSessionMetadataStores.mockImplementation(async () => { order.push('flush'); });
    expect(handleWillQuit(deps)).toBe(false);
    await flushMicrotasks();
    expect(order).toEqual(['flush', 'sqliteConnection', 'voice', 'diagnostics', 'flush']);
    expect(deps.quit).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Codex bindings dispose failed'), failure,
    );
  });

  it('continues teardown after the Codex close budget expires', async () => {
    jest.mocked(disposeElectronCodexBindings).mockImplementation(
      () => new Promise<void>(() => undefined),
    );
    const order: string[] = [];
    const deps = quitDeps(minimalRefs(order));
    handleWillQuit(deps);
    await flushMicrotasks();
    expect(order).toEqual([]);
    expect(deps.quit).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(CODEX_DISPOSE_BUDGET_MS);
    await flushMicrotasks();
    expect(order).toEqual(['sqliteConnection', 'diagnostics']);
    expect(deps.flushSessionMetadataStores).toHaveBeenCalledTimes(2);
    expect(deps.quit).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Codex bindings dispose exceeded'));
  });

  it('drains Codex writes before closing storage and performing the final flush', async () => {
    const order: string[] = [];
    jest.mocked(disposeElectronCodexBindings).mockImplementation(async () => { order.push('markInactive'); });
    const deps = quitDeps(minimalRefs(order));
    deps.flushSessionMetadataStores.mockImplementation(async () => { order.push('flush'); });
    handleWillQuit(deps);
    await flushMicrotasks();
    expect(order).toEqual(['flush', 'markInactive', 'sqliteConnection', 'diagnostics', 'flush']);
  });
});
