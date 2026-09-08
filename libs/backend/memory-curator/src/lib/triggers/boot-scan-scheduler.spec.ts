/**
 * The arming gate, driven directly.
 *
 * Both trigger services already pin the END-TO-END behaviour through their own
 * boot-defer specs (`memory-trigger.boot-defer.spec.ts`,
 * `skill-trigger.boot-defer.spec.ts`), which stay unchanged and are the real
 * regression net. This spec covers the extracted unit's own contract — the
 * cases that used to be reachable only through a whole trigger service and were
 * therefore pinned once per copy, or not at all: a non-numeric setting falling
 * back, `0` meaning "gate disabled" rather than "missing", and `cancel()`
 * before anything is armed.
 */
import { BootScanScheduler } from './boot-scan-scheduler';

const DELAY_KEY = 'x.bootScanDelayMs';
const BACKOFF_KEY = 'x.bootScanIdleBackoffMs';
const DELAY_DEFAULT = 300_000;
const BACKOFF_DEFAULT = 300_000;

function build(
  settings: Record<string, unknown> = {},
  lastActivityAt: () => number | null = () => null,
) {
  const run = jest.fn();
  const debug = jest.fn();
  const scheduler = new BootScanScheduler({
    logPrefix: '[test]',
    logger: { debug },
    workspace: {
      getConfiguration: <T>(_section: string, key: string, def?: T) =>
        (key in settings ? (settings[key] as T) : def) as T | undefined,
    },
    section: 'ptah',
    delayMsKey: DELAY_KEY,
    delayMsDefault: DELAY_DEFAULT,
    idleBackoffMsKey: BACKOFF_KEY,
    idleBackoffMsDefault: BACKOFF_DEFAULT,
    lastActivityAt,
    run,
  });
  return { scheduler, run, debug };
}

describe('BootScanScheduler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not run synchronously, then runs once the delay elapses', () => {
    const { scheduler, run } = build();
    const ac = new AbortController();

    scheduler.schedule(ac.signal);
    expect(run).not.toHaveBeenCalled();

    jest.advanceTimersByTime(DELAY_DEFAULT);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(ac.signal);
  });

  it('runs synchronously when the delay is 0', () => {
    const { scheduler, run } = build({ [DELAY_KEY]: 0 });

    scheduler.schedule(new AbortController().signal);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('re-arms by the backoff while foreground chat is recent', () => {
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    // One chat turn, 500 ms before the first arm comes due, and none after.
    const activityAt = now - 500;
    const { scheduler, run } = build({ [DELAY_KEY]: 1_000 }, () => activityAt);
    const ac = new AbortController();

    scheduler.schedule(ac.signal);
    jest.advanceTimersByTime(1_000);
    expect(run).not.toHaveBeenCalled();

    // A whole backoff window with no further activity.
    now += BACKOFF_DEFAULT;
    jest.advanceTimersByTime(BACKOFF_DEFAULT);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('never defers when there has been no activity in this process', () => {
    const { scheduler, run } = build({ [DELAY_KEY]: 1_000 }, () => null);

    scheduler.schedule(new AbortController().signal);
    jest.advanceTimersByTime(1_000);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('treats a backoff of 0 as "no activity gate"', () => {
    const now = Date.now();
    const { scheduler, run } = build(
      { [DELAY_KEY]: 1_000, [BACKOFF_KEY]: 0 },
      () => now,
    );

    scheduler.schedule(new AbortController().signal);
    jest.advanceTimersByTime(1_000);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('falls back when a setting is not a finite number, but keeps 0', () => {
    const nonNumeric = build({ [DELAY_KEY]: 'soon' });
    nonNumeric.scheduler.schedule(new AbortController().signal);
    jest.advanceTimersByTime(DELAY_DEFAULT - 1);
    expect(nonNumeric.run).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(nonNumeric.run).toHaveBeenCalledTimes(1);

    const negative = build({ [DELAY_KEY]: -5 });
    negative.scheduler.schedule(new AbortController().signal);
    jest.advanceTimersByTime(DELAY_DEFAULT);
    expect(negative.run).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the signal is already aborted', () => {
    const { scheduler, run } = build();
    const ac = new AbortController();
    ac.abort();

    scheduler.schedule(ac.signal);
    jest.advanceTimersByTime(DELAY_DEFAULT * 2);

    expect(run).not.toHaveBeenCalled();
  });

  it('does not run a pending scan once the signal aborts', () => {
    const { scheduler, run } = build();
    const ac = new AbortController();

    scheduler.schedule(ac.signal);
    ac.abort();
    jest.advanceTimersByTime(DELAY_DEFAULT * 2);

    expect(run).not.toHaveBeenCalled();
  });

  it('cancel() drops a pending arm and is safe with nothing armed', () => {
    const { scheduler, run } = build();

    expect(() => scheduler.cancel()).not.toThrow();

    scheduler.schedule(new AbortController().signal);
    scheduler.cancel();
    jest.advanceTimersByTime(DELAY_DEFAULT * 2);

    expect(run).not.toHaveBeenCalled();
  });

  it('replaces a pending arm rather than stacking a second one', () => {
    const { scheduler, run } = build();
    const ac = new AbortController();

    scheduler.schedule(ac.signal);
    scheduler.schedule(ac.signal);
    jest.advanceTimersByTime(DELAY_DEFAULT * 2);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('prefixes both log lines with the caller log channel', () => {
    const now = 2_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const { scheduler, debug } = build({ [DELAY_KEY]: 1_000 }, () => now);

    scheduler.schedule(new AbortController().signal);
    jest.advanceTimersByTime(1_000);

    const messages = debug.mock.calls.map((c) => c[0] as string);
    expect(messages).toEqual([
      '[test] boot scan armed',
      '[test] boot scan deferred — foreground chat is active',
      '[test] boot scan armed',
    ]);
  });
});
