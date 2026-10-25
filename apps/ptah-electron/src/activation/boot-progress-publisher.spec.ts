import {
  BootProgressPayloadSchema,
  MESSAGE_TYPES,
  type BootProgressPayload,
} from '@ptah-extension/shared';

import {
  BOOT_PROGRESS_TICK_MS,
  createBootProgressPublisher,
  disposeBootProgress,
  openBootProgress,
  type BootProgressContents,
  type BootProgressWindow,
} from './boot-progress-publisher';

interface FakeContents extends BootProgressContents {
  readonly sent: BootProgressPayload[];
  destroyed: boolean;
  listeners: Array<() => void>;
  finishLoad(): void;
}

function makeContents(): FakeContents {
  const contents: FakeContents = {
    sent: [],
    destroyed: false,
    listeners: [],
    isDestroyed: () => contents.destroyed,
    send: (channel: string, message: unknown) => {
      expect(channel).toBe('to-renderer');
      const { type, payload } = message as { type: string; payload: unknown };
      expect(type).toBe(MESSAGE_TYPES.BOOT_PROGRESS);
      contents.sent.push(BootProgressPayloadSchema.parse(payload));
    },
    on: (_event, listener) => {
      contents.listeners.push(listener);
    },
    removeListener: (_event, listener) => {
      contents.listeners = contents.listeners.filter((l) => l !== listener);
    },
    finishLoad: () => contents.listeners.forEach((listener) => listener()),
  };
  return contents;
}

function makeWindow(contents: BootProgressContents): BootProgressWindow {
  return { isDestroyed: () => false, webContents: contents };
}

let clock = 1_000;
const now = (): number => clock;

beforeEach(() => {
  jest.useFakeTimers();
  clock = 1_000;
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('createBootProgressPublisher', () => {
  it('sends each step transition in order with its index and timing', () => {
    const contents = makeContents();
    const publisher = createBootProgressPublisher(
      () => makeWindow(contents),
      now,
    );

    publisher.step('verify', 'active');
    clock += 250;
    publisher.step('verify', 'done');
    publisher.step('restore', 'active');
    publisher.step('agents', 'active');

    expect(contents.sent).toEqual([
      {
        stepId: 'verify',
        index: 0,
        total: 3,
        state: 'active',
        startedAt: 1_000,
      },
      {
        stepId: 'verify',
        index: 0,
        total: 3,
        state: 'done',
        elapsedMs: 250,
        startedAt: 1_000,
      },
      {
        stepId: 'restore',
        index: 1,
        total: 3,
        state: 'active',
        startedAt: 1_250,
      },
      {
        stepId: 'agents',
        index: 2,
        total: 3,
        state: 'active',
        startedAt: 1_250,
      },
    ]);
  });

  it('coalesces count ticks to one per tick window, keeping the latest', () => {
    const contents = makeContents();
    const publisher = createBootProgressPublisher(
      () => makeWindow(contents),
      now,
    );

    publisher.step('restore', 'active', { done: 0, count: 10 });
    clock += 10;
    publisher.step('restore', 'active', { done: 1, count: 10 });
    clock += 10;
    publisher.step('restore', 'active', { done: 2, count: 10 });
    expect(contents.sent).toHaveLength(1);

    // The trailing timer was armed at +10 ms for the rest of the window.
    clock = 1_000 + BOOT_PROGRESS_TICK_MS;
    jest.advanceTimersByTime(BOOT_PROGRESS_TICK_MS - 11);
    expect(contents.sent).toHaveLength(1);
    jest.advanceTimersByTime(1);
    expect(contents.sent).toHaveLength(2);
    expect(contents.sent[1]).toMatchObject({ done: 2, count: 10 });

    clock += BOOT_PROGRESS_TICK_MS;
    publisher.step('restore', 'active', { done: 3, count: 10 });
    expect(contents.sent).toHaveLength(3);
  });

  it('sends a transition immediately and cancels the pending tick', () => {
    const contents = makeContents();
    const publisher = createBootProgressPublisher(
      () => makeWindow(contents),
      now,
    );

    publisher.step('restore', 'active', { done: 0, count: 4 });
    clock += 10;
    publisher.step('restore', 'active', { done: 3, count: 4 });
    publisher.step('restore', 'done', { done: 4, count: 4 });

    expect(contents.sent.map((p) => p.state)).toEqual(['active', 'done']);
    expect(contents.sent[1]).toMatchObject({
      done: 4,
      count: 4,
      elapsedMs: 10,
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps a terminal state once it is reached', () => {
    const contents = makeContents();
    const publisher = createBootProgressPublisher(
      () => makeWindow(contents),
      now,
    );

    publisher.step('agents', 'active');
    publisher.step('agents', 'failed');
    publisher.step('agents', 'done');

    expect(contents.sent.map((p) => p.state)).toEqual(['active', 'failed']);
  });

  it('marks only the active steps failed', () => {
    const contents = makeContents();
    const publisher = createBootProgressPublisher(
      () => makeWindow(contents),
      now,
    );

    publisher.step('verify', 'active');
    publisher.step('verify', 'done');
    publisher.step('restore', 'active');
    publisher.failActive();

    expect(contents.sent.map((p) => `${p.stepId}:${p.state}`)).toEqual([
      'verify:active',
      'verify:done',
      'restore:active',
      'restore:failed',
    ]);
  });

  it('replays the latest snapshot of every started step on did-finish-load', () => {
    const contents = makeContents();
    const publisher = createBootProgressPublisher(
      () => makeWindow(contents),
      now,
    );

    publisher.step('verify', 'active');
    publisher.step('verify', 'done');
    publisher.step('restore', 'active');
    contents.sent.length = 0;

    contents.finishLoad();

    expect(contents.sent.map((p) => `${p.stepId}:${p.state}`)).toEqual([
      'verify:done',
      'restore:active',
    ]);
  });

  it('is a no-op without a window and never throws when send fails', () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const noWindow = createBootProgressPublisher(() => null, now);
    expect(() => noWindow.step('verify', 'active')).not.toThrow();

    const contents = makeContents();
    contents.send = () => {
      throw new Error('Object has been destroyed');
    };
    const failing = createBootProgressPublisher(
      () => makeWindow(contents),
      now,
    );
    expect(() => failing.step('verify', 'active')).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('dispose clears the pending tick and the page-load listener', () => {
    const contents = makeContents();
    const publisher = createBootProgressPublisher(
      () => makeWindow(contents),
      now,
    );

    publisher.step('restore', 'active', { done: 0, count: 4 });
    publisher.step('restore', 'active', { done: 1, count: 4 });
    expect(jest.getTimerCount()).toBe(1);
    expect(contents.listeners).toHaveLength(1);

    publisher.dispose();
    publisher.step('agents', 'active');
    jest.runAllTimers();
    contents.finishLoad();

    expect(jest.getTimerCount()).toBe(0);
    expect(contents.listeners).toHaveLength(0);
    expect(contents.sent).toHaveLength(1);
  });

  it('moves the listener to a replacement window', () => {
    const first = makeContents();
    const second = makeContents();
    let current = first;
    const publisher = createBootProgressPublisher(
      () => makeWindow(current),
      now,
    );

    publisher.step('verify', 'active');
    current = second;
    publisher.step('verify', 'done');

    expect(first.listeners).toHaveLength(0);
    expect(second.listeners).toHaveLength(1);
    expect(second.sent.map((p) => p.state)).toEqual(['done']);
  });
});

describe('openBootProgress / disposeBootProgress', () => {
  it('disposes the previous publisher and the current one on shutdown', () => {
    const contents = makeContents();
    openBootProgress(() => makeWindow(contents));
    expect(contents.listeners).toHaveLength(1);

    const second = openBootProgress(() => makeWindow(contents));
    expect(contents.listeners).toHaveLength(1);

    disposeBootProgress();
    expect(contents.listeners).toHaveLength(0);
    second.step('verify', 'active');
    expect(contents.sent).toHaveLength(0);
  });
});
