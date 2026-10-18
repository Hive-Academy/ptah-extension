/**
 * SessionMessageCounter — background warm scheduling (TASK_2026_693, FU-13).
 *
 * Locked in here:
 *   - A stalled read (stat or stream that never settles) gives up its slot at
 *     `WARM_DEADLINE_MS`, so four stalled reads cannot starve later pages.
 *   - A timed-out path is released and can be warmed again.
 *   - `onChanged` runs once per `peekAndWarm` call, after its warms settle,
 *     and only when a count changed.
 *
 * The visible-message rules are covered through `session:list` in
 * `session-rpc.handlers.spec.ts`.
 */

import * as fs from 'fs/promises';

jest.mock('fs/promises', () => ({
  ...jest.requireActual('fs/promises'),
  stat: jest.fn(),
}));

import type { JsonlReaderService } from '@ptah-extension/agent-sdk';
import type { Logger } from '@ptah-extension/vscode-core';
import { createMockLogger } from '@ptah-extension/shared/testing';

import {
  SessionMessageCounter,
  WARM_DEADLINE_MS,
  type SessionTranscriptRef,
} from './session-message-count';

const mockStat = fs.stat as jest.MockedFunction<typeof fs.stat>;

type ProjectJsonlLines = JsonlReaderService['projectJsonlLines'];

const FILE_STATS = {
  isFile: () => true,
  size: 1_024,
  mtimeMs: 1_700_000_000_000,
};

const TWO_MESSAGES = [
  JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
  JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
  }),
];

function ref(i: number): SessionTranscriptRef {
  return { sessionId: `session-${i}`, filePath: `/sessions/session-${i}.jsonl` };
}

/** Real `setImmediate` (not faked) lets every pending microtask run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function makeCounter(read: ProjectJsonlLines): {
  counter: SessionMessageCounter;
  reader: jest.Mock<ReturnType<ProjectJsonlLines>, Parameters<ProjectJsonlLines>>;
} {
  const reader = jest.fn<
    ReturnType<ProjectJsonlLines>,
    Parameters<ProjectJsonlLines>
  >(read);
  const counter = new SessionMessageCounter(
    { projectJsonlLines: reader },
    createMockLogger() as unknown as Logger,
  );
  return { counter, reader };
}

const stalled: ProjectJsonlLines = () => new Promise(() => undefined);
const countsTwo: ProjectJsonlLines = async (_filePath, visit) => {
  TWO_MESSAGES.forEach((line) => visit(line));
  return { lines: TWO_MESSAGES.length, yields: 0 };
};

describe('SessionMessageCounter', () => {
  beforeEach(() => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });
    mockStat.mockReset().mockResolvedValue(FILE_STATS as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('frees the slots of four stalled reads at the deadline so a later page warms', async () => {
    const { counter, reader } = makeCounter((filePath, visit, options) =>
      filePath === ref(5).filePath
        ? countsTwo(filePath, visit, options)
        : stalled(filePath, visit, options),
    );
    const onChanged = jest.fn();

    counter.peekAndWarm([ref(1), ref(2), ref(3), ref(4)]);
    await flush();
    expect(reader).toHaveBeenCalledTimes(4);
    // Every stalled read was handed the deadline signal.
    expect(reader.mock.calls[0][2]?.signal).toBeInstanceOf(AbortSignal);

    expect(counter.peekAndWarm([ref(5)], onChanged).size).toBe(0);
    await flush();
    expect(reader).toHaveBeenCalledTimes(4);

    jest.advanceTimersByTime(WARM_DEADLINE_MS);
    await flush();

    expect(reader).toHaveBeenCalledTimes(5);
    expect(reader.mock.calls[0][2]?.signal?.aborted).toBe(true);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledWith(['session-5']);
    expect(counter.peekAndWarm([ref(5)]).get('session-5')).toBe(2);
  });

  it('bounds a stalled stat by the same deadline and releases the path', async () => {
    mockStat.mockImplementation(() => new Promise(() => undefined));
    const { counter, reader } = makeCounter(countsTwo);

    counter.peekAndWarm([ref(1)]);
    await flush();
    jest.advanceTimersByTime(WARM_DEADLINE_MS);
    await flush();
    expect(reader).not.toHaveBeenCalled();

    // The timed-out path is no longer held as "warming": it warms again.
    mockStat.mockReset().mockResolvedValue(FILE_STATS as never);
    counter.peekAndWarm([ref(1)]);
    await flush();
    expect(reader).toHaveBeenCalledTimes(1);
    expect(counter.peekAndWarm([ref(1)]).get('session-1')).toBe(2);
  });

  it('calls onChanged once per call, after all of its warms, only on change', async () => {
    const { counter, reader } = makeCounter(countsTwo);
    const first = jest.fn();

    counter.peekAndWarm([ref(1), ref(2), ref(3)], first);
    await flush();
    expect(first).toHaveBeenCalledTimes(1);
    expect([...first.mock.calls[0][0]].sort()).toEqual([
      'session-1',
      'session-2',
      'session-3',
    ]);

    // Same size and mtime: cache hit, no read, no change, no call.
    const second = jest.fn();
    counter.peekAndWarm([ref(1), ref(2), ref(3)], second);
    await flush();
    expect(reader).toHaveBeenCalledTimes(3);
    expect(second).not.toHaveBeenCalled();
  });
});
