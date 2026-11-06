import { InProcessRpc } from './in-process-rpc';
import {
  SessionDriver,
  SessionDriverError,
  type SessionDriverOptions,
} from './session-driver';
import { SessionLogWriter } from './session-log-writer';
import { SessionEventLog } from './session-event-log';
import { SessionFanOut } from './fan-out';
import { Transcript } from './transcript';

function setup(runtime?: string, options?: SessionDriverOptions) {
  const handleMessage = jest
    .fn()
    .mockResolvedValue({ success: true, data: { success: true } });
  const rpc = new InProcessRpc({ handleMessage }, jest.fn());
  const baseline = jest.fn().mockResolvedValue(undefined);
  const mark = jest.fn().mockResolvedValue(undefined);
  const transcript = { baseline, mark } as unknown as Transcript;
  const metadata = {
    get: jest
      .fn()
      .mockResolvedValue(runtime ? { codexExecution: { runtime } } : null),
  };
  const enqueue = jest.fn().mockResolvedValue({ seq: 1 });
  const writer = { enqueue } as unknown as SessionLogWriter;
  const driver = new SessionDriver(
    rpc,
    transcript,
    metadata,
    () => writer,
    () => true,
    1,
    options,
  );
  return { driver, handleMessage, metadata, enqueue, baseline, mark };
}

it('refuses native Codex before chat:continue and before any lock path; metadata failure also refuses', async () => {
  const native = setup('codex-app-server');
  const attach = jest
    .fn()
    .mockResolvedValue({ mode: 'snapshot', events: [], live: false });
  const nativeTranscript = { attach } as unknown as Transcript;
  const nativeDriver = new SessionDriver(
    new InProcessRpc({ handleMessage: native.handleMessage }, jest.fn()),
    nativeTranscript,
    native.metadata,
    () => ({ enqueue: jest.fn() }) as unknown as SessionLogWriter,
    () => true,
    1,
  );
  await expect(nativeDriver.attach('s1', null, null)).resolves.toMatchObject({
    mode: 'snapshot',
  });
  expect(attach).toHaveBeenCalledWith('s1', null, null, undefined, false, true);
  await expect(
    native.driver.continue('s1', 'tab', 'hello'),
  ).rejects.toMatchObject({ code: 'CODEX_UNAVAILABLE' });
  expect(native.handleMessage).not.toHaveBeenCalled();
  const failed = setup();
  failed.metadata.get.mockRejectedValue(new Error('storage failed'));
  await expect(
    failed.driver.continue('s1', 'tab', 'hello'),
  ).rejects.toBeInstanceOf(SessionDriverError);
  expect(failed.handleMessage).not.toHaveBeenCalled();
});

it('claude-sdk and metadata-less sessions take chat:continue; tracks in-flight and busy turns', async () => {
  const normal = setup('claude-sdk');
  await normal.driver.continue('s1', 'tab1', 'hello');
  expect(normal.handleMessage).toHaveBeenCalledWith(
    expect.objectContaining({ method: 'chat:continue' }),
  );
  expect(normal.baseline).toHaveBeenCalledTimes(1);
  await expect(
    normal.driver.continue('s1', 'tab1', 'again'),
  ).rejects.toMatchObject({ code: 'TURN_IN_FLIGHT' });
  await expect(
    normal.driver.continue('s2', 'tab2', 'again'),
  ).rejects.toMatchObject({ code: 'WORKER_BUSY' });
  await normal.driver.end('s1');
  expect(normal.mark).toHaveBeenCalledTimes(1);
  const missing = setup();
  await missing.driver.continue('s2', 'tab2', 'hello');
  expect(missing.handleMessage).toHaveBeenCalledTimes(1);
});

it('refuses without a ready provider before calling chat:continue', async () => {
  const { handleMessage, metadata } = setup();
  const driver = new SessionDriver(
    new InProcessRpc({ handleMessage }, jest.fn()),
    { baseline: jest.fn() } as unknown as Transcript,
    metadata,
    () => ({ enqueue: jest.fn() }) as unknown as SessionLogWriter,
    () => false,
    1,
  );
  await expect(driver.continue('s1', 'tab', 'hello')).rejects.toMatchObject({
    code: 'NO_PROVIDER_READY',
  });
  expect(handleMessage).not.toHaveBeenCalled();
});

it('routes pre-resolution events and aborts through chat:abort when a log append fails', async () => {
  const { driver, handleMessage } = setup();
  const deliver = jest.fn();
  driver.route('tab', { type: 'early' }, deliver);
  driver.resolveTab('tab', 's1', deliver);
  expect(deliver).toHaveBeenCalledWith('s1', { type: 'early' });
  await driver.continue('s1', 'tab', 'hello');
  const failingWriter = new SessionLogWriter(
    { sessionId: 's1' } as unknown as SessionEventLog,
    new SessionFanOut(),
    {
      onAppendFailed: driver.onAppendFailed,
      append: async () => {
        throw new Error('disk failed');
      },
    },
  );
  await expect(
    failingWriter.enqueue('worker:turn.begin', { turnId: 't1' }),
  ).rejects.toMatchObject({ code: 'SESSION_LOG_FAILED' });
  await new Promise((resolve) => setImmediate(resolve));
  expect(handleMessage).toHaveBeenCalledWith(
    expect.objectContaining({ method: 'chat:abort' }),
  );
});

type Message = { method: string; params: Record<string, unknown> };
const ok = { success: true, data: { success: true } };
const refused = { success: false, error: 'refused' };
const start = { tabId: 'tab', prompt: 'hello', workspacePath: '/w' };
const types = (enqueue: jest.Mock): unknown[] =>
  enqueue.mock.calls.map(([type]) => type);

it('starts a session within the shared limit and delivers early tab events after turn begin', async () => {
  const { driver, handleMessage, enqueue } = setup();
  const deliver = jest.fn();
  handleMessage.mockImplementation(async ({ method }: Message) => {
    if (method === 'chat:start') {
      driver.route('tab', { type: 'early' }, deliver);
      driver.tabResolved('tab', 's1');
    }
    return ok;
  });
  const open = jest.fn(async () => undefined);
  const turn = await driver.start(start, open, deliver);
  expect(turn.sessionId).toBe('s1');
  expect(open).toHaveBeenCalledWith('s1');
  expect(handleMessage).toHaveBeenCalledWith(
    expect.objectContaining({ method: 'chat:start', params: start }),
  );
  expect(types(enqueue)).toEqual(['worker:baseline', 'worker:turn.begin']);
  expect(enqueue.mock.calls[0]?.[1]).toEqual({
    events: [],
    historyMark: { count: 0, lastEventId: null },
  });
  expect(deliver).toHaveBeenCalledWith('s1', { type: 'early' });
  expect(driver.sessionForTab('tab')).toBe('s1');
  await expect(
    driver.start({ ...start, tabId: 'tab2' }, open, deliver),
  ).rejects.toMatchObject({ code: 'WORKER_BUSY' });
  await expect(driver.continue('s3', 'tab3', 'x')).rejects.toMatchObject({
    code: 'WORKER_BUSY',
  });
  await expect(driver.abort('s1')).resolves.toBe(true);
  expect(enqueue).toHaveBeenLastCalledWith('worker:turn.interrupted', {
    turnId: turn.turnId,
  });
  expect(driver.driving('s1')).toBe(false);
});

it('waits for a delayed session:id-resolved after chat:start', async () => {
  const { driver } = setup(undefined, { resolveTimeoutMs: 1_000 });
  setTimeout(() => driver.tabResolved('tab', 's1'), 20);
  const turn = await driver.start(start, async () => undefined, jest.fn());
  expect(turn.sessionId).toBe('s1');
});

it('keeps the slot of a start whose session never resolved, then aborts it when the ID arrives', async () => {
  const onAbandoned = jest.fn();
  const { driver, handleMessage } = setup(undefined, {
    resolveTimeoutMs: 10,
    onAbandoned,
  });
  await expect(
    driver.start(start, async () => undefined, jest.fn()),
  ).rejects.toMatchObject({ code: 'INTERNAL' });
  // The engine turn may still run: no new turn is admitted past the limit.
  await expect(
    driver.start({ ...start, tabId: 'tab2' }, async () => undefined, jest.fn()),
  ).rejects.toMatchObject({ code: 'WORKER_BUSY' });
  driver.tabResolved('tab', 's1');
  await new Promise((resolve) => setImmediate(resolve));
  expect(handleMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      method: 'chat:abort',
      params: { sessionId: 's1' },
    }),
  );
  expect(onAbandoned).toHaveBeenCalledWith('s1');
  handleMessage.mockImplementation(async ({ method }: Message) => {
    if (method === 'chat:start') driver.tabResolved('tab3', 's3');
    return ok;
  });
  await expect(
    driver.start({ ...start, tabId: 'tab3' }, async () => undefined, jest.fn()),
  ).resolves.toMatchObject({ sessionId: 's3' });
});

it('aborts an admitted start whose log cannot open before freeing the slot', async () => {
  const onAbandoned = jest.fn();
  const { driver, handleMessage } = setup(undefined, { onAbandoned });
  handleMessage.mockImplementation(async ({ method }: Message) => {
    if (method === 'chat:start') driver.tabResolved('tab', 's1');
    return ok;
  });
  await expect(
    driver.start(
      start,
      async () => {
        throw new Error('disk full');
      },
      jest.fn(),
    ),
  ).rejects.toThrow('disk full');
  expect(handleMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      method: 'chat:abort',
      params: { sessionId: 's1' },
    }),
  );
  expect(onAbandoned).toHaveBeenCalledWith('s1');
  expect(driver.driving('s1')).toBe(false);
});

it('ends a start whose terminal event arrived during admission, once, after turn begin', async () => {
  const { driver, handleMessage, enqueue, mark } = setup();
  handleMessage.mockImplementation(async ({ method }: Message) => {
    if (method === 'chat:start') {
      driver.tabResolved('tab', 's1');
      void driver.terminal('s1');
      void driver.terminal(undefined, 'tab');
    }
    return ok;
  });
  await driver.start(start, async () => undefined, jest.fn());
  expect(types(enqueue)).toEqual([
    'worker:baseline',
    'worker:turn.begin',
    'worker:turn.end',
  ]);
  expect(mark).toHaveBeenCalledTimes(1);
  expect(driver.driving('s1')).toBe(false);
});

it('ends a continue whose terminal event arrived during admission and buffers its events after turn begin', async () => {
  const { driver, handleMessage, enqueue, mark } = setup();
  const order: string[] = [];
  enqueue.mockImplementation(async (type: string) => {
    order.push(type);
    return { seq: order.length };
  });
  const deliver = jest.fn((_id: string, event: unknown) =>
    order.push(String((event as { type: string }).type)),
  );
  handleMessage.mockImplementation(async ({ method }: Message) => {
    if (method === 'chat:continue') {
      driver.routeSession('s1', { type: 'chat:chunk' }, deliver);
      driver.routeSession('s1', { type: 'session:turnEnded' }, deliver);
      void driver.terminal('s1');
    }
    return ok;
  });
  await driver.continue('s1', 'tab', 'hello');
  expect(order).toEqual([
    'worker:turn.begin',
    'chat:chunk',
    'session:turnEnded',
    'worker:turn.end',
  ]);
  expect(mark).toHaveBeenCalledTimes(1);
  expect(driver.driving('s1')).toBe(false);
  // The slot is free again.
  await expect(driver.continue('s2', 'tab2', 'x')).resolves.toMatchObject({
    sessionId: 's2',
  });
});

it('keeps the turn, its slot and its log when chat:abort is refused', async () => {
  const { driver, handleMessage, enqueue } = setup();
  await driver.continue('s1', 'tab', 'hello');
  handleMessage.mockResolvedValue(refused);
  await expect(driver.abort('s1')).resolves.toBe(false);
  expect(driver.driving('s1')).toBe(true);
  expect(types(enqueue)).not.toContain('worker:turn.interrupted');
  await expect(driver.continue('s2', 'tab2', 'x')).rejects.toMatchObject({
    code: 'WORKER_BUSY',
  });
});

it('drops an overflowing admission queue without throwing and refuses that turn', async () => {
  const { driver, handleMessage } = setup();
  const deliver = jest.fn();
  handleMessage.mockImplementation(async ({ method }: Message) => {
    if (method === 'chat:start') {
      for (let i = 0; i <= 10_000; i += 1)
        driver.route('tab', { type: 'chat:chunk' }, deliver);
      driver.tabResolved('tab', 's1');
    }
    return ok;
  });
  await expect(
    driver.start(start, async () => undefined, deliver),
  ).rejects.toMatchObject({ code: 'SESSION_LOG_FAILED' });
  expect(deliver).not.toHaveBeenCalled();
  expect(handleMessage).toHaveBeenCalledWith(
    expect.objectContaining({ method: 'chat:abort' }),
  );
  expect(() =>
    driver.route('other', { type: 'chat:chunk' }, deliver),
  ).not.toThrow();
});

it('drain cancels a start waiting for its session, refuses new turns and aborts admitted ones', async () => {
  const { driver, handleMessage } = setup(undefined, {
    resolveTimeoutMs: 60_000,
  });
  const pending = driver.start(start, async () => undefined, jest.fn());
  await new Promise((resolve) => setImmediate(resolve));
  const result = await driver.drain();
  await expect(pending).rejects.toMatchObject({ code: 'INTERNAL' });
  expect(result).toEqual({ unresolvedTabs: ['tab'], failedAborts: [] });
  await expect(driver.continue('s9', 'tab9', 'x')).rejects.toMatchObject({
    code: 'WORKER_BUSY',
  });
  expect(handleMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({ method: 'chat:continue' }),
  );
});

it('drain reports a refused abort and keeps that turn running until the engine ends it', async () => {
  const { driver, handleMessage } = setup();
  await driver.continue('s1', 'tab', 'hello');
  handleMessage.mockResolvedValue(refused);
  const result = await driver.drain();
  expect(result).toEqual({ unresolvedTabs: [], failedAborts: ['s1'] });
  // Its driver lock must not be handed on while the turn may still run.
  expect(driver.running('s1')).toBe(true);
  await driver.terminal('s1');
  expect(driver.running('s1')).toBe(false);
});

it('keeps an orphan whose abort was refused running until its terminal event frees it', async () => {
  const onAbandoned = jest.fn();
  const { driver, handleMessage } = setup(undefined, {
    resolveTimeoutMs: 10,
    onAbandoned,
  });
  await expect(
    driver.start(start, async () => undefined, jest.fn()),
  ).rejects.toMatchObject({ code: 'INTERNAL' });
  // A timed-out start still waits for its session ID.
  expect(driver.awaitingSession('tab')).toBe(true);
  handleMessage.mockResolvedValue(refused);
  driver.tabResolved('tab', 's1');
  await new Promise((resolve) => setImmediate(resolve));
  expect(driver.awaitingSession('tab')).toBe(false);
  expect(driver.running('s1')).toBe(true);
  expect(onAbandoned).not.toHaveBeenCalled();
  await expect(driver.drain()).resolves.toEqual({
    unresolvedTabs: [],
    failedAborts: ['s1'],
  });
  await driver.terminal('s1');
  expect(driver.running('s1')).toBe(false);
  expect(onAbandoned).toHaveBeenCalledWith('s1');
});

it('frees a start that never reported its session on a terminal event for its tab, once', async () => {
  const onAbandoned = jest.fn();
  const onUnresolvedEnded = jest.fn();
  const { driver, handleMessage } = setup(undefined, {
    resolveTimeoutMs: 10,
    onAbandoned,
    onUnresolvedEnded,
  });
  await expect(
    driver.start(start, async () => undefined, jest.fn()),
  ).rejects.toMatchObject({ code: 'INTERNAL' });
  // The engine turn may still run: it keeps its slot (max 1).
  expect(driver.unresolvedStarts()).toBe(1);
  await expect(
    driver.start({ ...start, tabId: 'tab2' }, async () => undefined, jest.fn()),
  ).rejects.toMatchObject({ code: 'WORKER_BUSY' });
  await driver.terminal(undefined, 'tab');
  await driver.terminal(undefined, 'tab');
  expect(driver.unresolvedStarts()).toBe(0);
  expect(onUnresolvedEnded).toHaveBeenCalledTimes(1);
  expect(onAbandoned).not.toHaveBeenCalled();
  expect(handleMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({ method: 'chat:abort' }),
  );
  // The slot is free again.
  const next = driver.start(
    { ...start, tabId: 'tab3' },
    async () => undefined,
    jest.fn(),
  );
  await new Promise((resolve) => setImmediate(resolve));
  driver.tabResolved('tab3', 's3');
  await expect(next).resolves.toMatchObject({ sessionId: 's3' });
});

it('releases a tab-only orphan by the session its terminal event carries', async () => {
  const onAbandoned = jest.fn();
  const onUnresolvedEnded = jest.fn();
  const { driver } = setup(undefined, {
    resolveTimeoutMs: 10,
    onAbandoned,
    onUnresolvedEnded,
  });
  await expect(
    driver.start(start, async () => undefined, jest.fn()),
  ).rejects.toMatchObject({ code: 'INTERNAL' });
  await driver.terminal('s1', 'tab');
  await driver.terminal('s1', 'tab');
  expect(driver.unresolvedStarts()).toBe(0);
  expect(onAbandoned).toHaveBeenCalledTimes(1);
  expect(onAbandoned).toHaveBeenCalledWith('s1');
  expect(onUnresolvedEnded).not.toHaveBeenCalled();
});

it('frees a start whose turn ended before its session ID arrived', async () => {
  const onUnresolvedEnded = jest.fn();
  const { driver, handleMessage } = setup(undefined, {
    resolveTimeoutMs: 10,
    onUnresolvedEnded,
  });
  handleMessage.mockImplementation(async ({ method }: Message) => {
    if (method === 'chat:start') void driver.terminal(undefined, 'tab');
    return ok;
  });
  await expect(
    driver.start(start, async () => undefined, jest.fn()),
  ).rejects.toMatchObject({ code: 'INTERNAL' });
  expect(driver.unresolvedStarts()).toBe(0);
  expect(driver.awaitingSession('tab')).toBe(false);
  expect(onUnresolvedEnded).toHaveBeenCalledTimes(1);
});

it('a late session:id-resolved still aborts the orphan and releases its lock once', async () => {
  const onAbandoned = jest.fn();
  const onUnresolvedEnded = jest.fn();
  const { driver, handleMessage } = setup(undefined, {
    resolveTimeoutMs: 10,
    onAbandoned,
    onUnresolvedEnded,
  });
  await expect(
    driver.start(start, async () => undefined, jest.fn()),
  ).rejects.toMatchObject({ code: 'INTERNAL' });
  driver.tabResolved('tab', 's1');
  // The terminal event of the abort arrives while chat:abort is in flight.
  void driver.terminal('s1', 'tab');
  await new Promise((resolve) => setImmediate(resolve));
  expect(handleMessage).toHaveBeenCalledWith(
    expect.objectContaining({ method: 'chat:abort' }),
  );
  expect(driver.unresolvedStarts()).toBe(0);
  expect(driver.running('s1')).toBe(false);
  expect(onAbandoned).toHaveBeenCalledTimes(1);
  expect(onAbandoned).toHaveBeenCalledWith('s1');
  expect(onUnresolvedEnded).not.toHaveBeenCalled();
});

it('drain does not wait for the session of a start whose chat:start returns after it began', async () => {
  const { driver, handleMessage } = setup(undefined, {
    resolveTimeoutMs: 60_000,
  });
  let answer!: (value: unknown) => void;
  handleMessage.mockImplementation(
    ({ method }: Message) =>
      new Promise((resolve) =>
        method === 'chat:start' ? (answer = resolve) : resolve(ok),
      ),
  );
  const pending = driver.start(start, async () => undefined, jest.fn());
  await new Promise((resolve) => setImmediate(resolve));
  const drained = driver.drain();
  answer(ok);
  await expect(pending).rejects.toMatchObject({ code: 'INTERNAL' });
  await expect(drained).resolves.toEqual({
    unresolvedTabs: ['tab'],
    failedAborts: [],
  });
});
