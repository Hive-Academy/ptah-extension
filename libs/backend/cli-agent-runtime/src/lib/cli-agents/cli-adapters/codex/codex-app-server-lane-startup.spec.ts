import {
  CODEX_LANE_STARTUP_TIMEOUT_MS,
  withCodexLaneStartupTimeout,
} from './codex-app-server-lane-startup';

describe('withCodexLaneStartupTimeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves a startup that settles inside its deadline and clears the timer', async () => {
    const abort = new AbortController();
    let finish: (value: string) => void = () => undefined;
    const slow = new Promise<string>((resolve) => {
      finish = resolve;
    });

    const result = withCodexLaneStartupTimeout(slow, abort);
    await jest.advanceTimersByTimeAsync(CODEX_LANE_STARTUP_TIMEOUT_MS - 1);
    finish('ready');

    await expect(result).resolves.toBe('ready');
    expect(abort.signal.aborted).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('aborts and rejects a startup that overruns its deadline, naming the bound', async () => {
    const abort = new AbortController();
    const result = withCodexLaneStartupTimeout(
      new Promise<never>(() => undefined),
      abort,
    );
    const outcome = expect(result).rejects.toThrow(
      `Codex App Server startup timed out after ${CODEX_LANE_STARTUP_TIMEOUT_MS / 1000}s`,
    );

    await jest.advanceTimersByTimeAsync(CODEX_LANE_STARTUP_TIMEOUT_MS);

    await outcome;
    expect(abort.signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });
});
