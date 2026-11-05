const ipcMainListeners = new Map<
  string,
  Array<(...args: unknown[]) => unknown>
>();
/**
 * `invoke` channels (`diag:cpu-profile`) live in a registry separate from `on`
 * listeners and are torn down with `removeHandler`, not `removeAllListeners`.
 * Modelled here so `initialize()` / `dispose()` can be exercised end to end.
 */
const ipcMainHandlers = new Map<string, (...args: unknown[]) => unknown>();

jest.mock('electron', () => {
  return {
    ipcMain: {
      on: (channel: string, listener: (...args: unknown[]) => unknown) => {
        const arr = ipcMainListeners.get(channel) ?? [];
        arr.push(listener);
        ipcMainListeners.set(channel, arr);
      },
      removeAllListeners: (channel: string) => {
        ipcMainListeners.delete(channel);
      },
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
        ipcMainHandlers.set(channel, handler);
      },
      removeHandler: (channel: string) => {
        ipcMainHandlers.delete(channel);
      },
    },
  };
});

import type { DependencyContainer } from 'tsyringe';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { IpcBridge } from './ipc-bridge';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import {
  STREAM_BATCH_MAX_APPROX_BYTES,
  STREAM_BATCH_MAX_EVENTS,
} from './stream-event-batch';

const TRUSTED_DOCUMENTS = [path.resolve('/app/renderer/index.html')];
const MAIN_FRAME = { url: pathToFileURL(TRUSTED_DOCUMENTS[0]).href };

interface SentMessage {
  readonly channel: string;
  readonly message: unknown;
}

interface FakeWindow {
  webContents: { id: number; send: jest.Mock };
  sent: SentMessage[];
}

function makeWindow(): FakeWindow {
  const sent: SentMessage[] = [];
  return {
    webContents: {
      id: 1,
      send: jest.fn((channel: string, message: unknown) => {
        sent.push({ channel, message });
      }),
    },
    sent,
  };
}

function makeContainer(): DependencyContainer {
  return {
    resolve: jest.fn(() => ({
      handleMessage: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
    })),
    isRegistered: jest.fn(() => false),
  } as unknown as DependencyContainer;
}

describe('IpcBridge — streaming-event batching (Batch D)', () => {
  let bridge: IpcBridge;
  let win: FakeWindow;

  beforeEach(() => {
    jest.useFakeTimers();
    ipcMainListeners.clear();
    ipcMainHandlers.clear();
    win = makeWindow();
    bridge = new IpcBridge(makeContainer(), () => win, TRUSTED_DOCUMENTS);
  });

  afterEach(() => {
    bridge.dispose();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('(a) a single streaming event flushes as the ORIGINAL message (no envelope)', () => {
    bridge.sendToRenderer({
      type: MESSAGE_TYPES.CHAT_MESSAGE_CHUNK,
      payload: { id: '1', text: 'hello' },
    });

    expect(win.sent.length).toBe(0);
    jest.advanceTimersByTime(20);

    expect(win.sent.length).toBe(1);
    const msg = win.sent[0].message as { type: string; payload: unknown };
    expect(msg.type).toBe(MESSAGE_TYPES.CHAT_MESSAGE_CHUNK);
    expect(msg.type).not.toBe(MESSAGE_TYPES.BATCH);
  });

  it('(b) two or more events within 16ms become a BATCH envelope', () => {
    bridge.sendToRenderer({
      type: MESSAGE_TYPES.CHAT_CHUNK,
      payload: { i: 1 },
    });
    bridge.sendToRenderer({
      type: MESSAGE_TYPES.CHAT_THINKING,
      payload: { i: 2 },
    });
    bridge.sendToRenderer({
      type: MESSAGE_TYPES.CHAT_TOOL_PROGRESS,
      payload: { i: 3 },
    });

    jest.advanceTimersByTime(20);

    expect(win.sent.length).toBe(1);
    const msg = win.sent[0].message as {
      type: string;
      payload: { events: Array<{ type: string; payload: unknown }> };
    };
    expect(msg.type).toBe(MESSAGE_TYPES.BATCH);
    expect(msg.payload.events.length).toBe(3);
    expect(msg.payload.events.map((e) => e.type)).toEqual([
      MESSAGE_TYPES.CHAT_CHUNK,
      MESSAGE_TYPES.CHAT_THINKING,
      MESSAGE_TYPES.CHAT_TOOL_PROGRESS,
    ]);
  });

  it('continues draining queued events after a send fails', () => {
    const report = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    win.webContents.send.mockImplementationOnce(() => { throw new Error('uncloneable event'); });
    for (let i = 0; i <= STREAM_BATCH_MAX_EVENTS; i++) {
      bridge.sendToRenderer({ type: MESSAGE_TYPES.CHAT_CHUNK, payload: { i } });
    }
    jest.runAllTimers();
    expect(win.webContents.send).toHaveBeenCalledTimes(2);
    expect(win.sent).toHaveLength(1);
    expect(report).toHaveBeenCalled();
    report.mockRestore();
  });

  it('batches agent output within 64ms and preserves per-agent order', () => {
    const deltas = [
      { agentId: 'a1', stdoutDelta: 'first' },
      { agentId: 'a2', stdoutDelta: 'other' },
      { agentId: 'a1', stdoutDelta: 'second' },
    ];
    for (const payload of deltas) {
      bridge.sendToRenderer({
        type: MESSAGE_TYPES.AGENT_MONITOR_OUTPUT,
        payload,
      });
    }

    jest.advanceTimersByTime(63);
    expect(win.sent).toHaveLength(0);
    jest.advanceTimersByTime(1);

    expect(win.sent).toHaveLength(1);
    const message = win.sent[0].message as {
      type: string;
      payload: { events: Array<{ payload: unknown }> };
    };
    expect(message.type).toBe(MESSAGE_TYPES.BATCH);
    expect(message.payload.events.map((event) => event.payload)).toEqual(deltas);
  });

  it('flushes pending agent output before the exit event', () => {
    const finalDelta = { agentId: 'a1', stdoutDelta: 'final' };
    bridge.sendToRenderer({
      type: MESSAGE_TYPES.AGENT_MONITOR_OUTPUT,
      payload: { agentId: 'a1', stdoutDelta: 'before final' },
    });
    bridge.sendToRenderer({
      type: MESSAGE_TYPES.AGENT_MONITOR_OUTPUT,
      payload: finalDelta,
    });

    bridge.sendToRenderer({
      type: MESSAGE_TYPES.AGENT_MONITOR_EXITED,
      payload: { agentId: 'a1', status: 'completed' },
    });

    expect(win.sent).toHaveLength(2);
    const batch = win.sent[0].message as {
      type: string;
      payload: { events: Array<{ payload: unknown }> };
    };
    expect(batch.type).toBe(MESSAGE_TYPES.BATCH);
    expect(batch.payload.events[1].payload).toEqual(finalDelta);
    expect((win.sent[1].message as { type: string }).type).toBe(
      MESSAGE_TYPES.AGENT_MONITOR_EXITED,
    );
  });

  /**
   * Overflow drains on a later macrotask (`setImmediate`). Default fake
   * timers would run that immediate inside `advanceTimersByTime`, hiding the
   * yield, so these specs keep the real one and wait for it explicitly.
   */
  function useRealImmediates(): void {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'clearImmediate'] });
  }

  function nextMacrotask(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }

  it('bounds each batch by event count and yields before overflow', async () => {
    useRealImmediates();
    for (let i = 0; i <= STREAM_BATCH_MAX_EVENTS; i++) {
      bridge.sendToRenderer({
        type: MESSAGE_TYPES.CHAT_CHUNK,
        payload: { i },
      });
    }

    jest.advanceTimersByTime(20);

    expect(win.sent).toHaveLength(1);
    const first = win.sent[0].message as {
      type: string;
      payload: { events: Array<{ payload: { i: number } }> };
    };
    expect(first.type).toBe(MESSAGE_TYPES.BATCH);
    expect(first.payload.events).toHaveLength(STREAM_BATCH_MAX_EVENTS);
    expect(first.payload.events[0].payload.i).toBe(0);
    expect(first.payload.events[STREAM_BATCH_MAX_EVENTS - 1].payload.i).toBe(
      STREAM_BATCH_MAX_EVENTS - 1,
    );

    await nextMacrotask();

    expect(win.sent).toHaveLength(2);
    const second = win.sent[1].message as {
      type: string;
      payload: { i: number };
    };
    expect(second.type).toBe(MESSAGE_TYPES.CHAT_CHUNK);
    expect(second.payload.i).toBe(STREAM_BATCH_MAX_EVENTS);
  });

  it('bounds each batch by approximate bytes without dropping oversized events', async () => {
    useRealImmediates();
    const largePayload = { text: 'x'.repeat(STREAM_BATCH_MAX_APPROX_BYTES) };
    bridge.sendToRenderer({
      type: MESSAGE_TYPES.CHAT_CHUNK,
      payload: largePayload,
    });
    bridge.sendToRenderer({
      type: MESSAGE_TYPES.CHAT_CHUNK,
      payload: { text: 'next' },
    });

    jest.advanceTimersByTime(20);
    expect(win.sent).toHaveLength(1);
    expect(
      (win.sent[0].message as { payload: unknown }).payload,
    ).toEqual(largePayload);

    await nextMacrotask();
    expect(win.sent).toHaveLength(2);
    expect((win.sent[1].message as { type: string }).type).toBe(
      MESSAGE_TYPES.CHAT_CHUNK,
    );
  });

  it('keeps a non-stream message behind overflow batches', () => {
    for (let i = 0; i <= STREAM_BATCH_MAX_EVENTS; i++) {
      bridge.sendToRenderer({
        type: MESSAGE_TYPES.CHAT_CHUNK,
        payload: { i },
      });
    }
    bridge.sendToRenderer({
      type: MESSAGE_TYPES.SWITCH_VIEW,
      payload: { view: 'chat' },
    });

    expect(win.sent).toHaveLength(1);
    expect((win.sent[0].message as { type: string }).type).toBe(
      MESSAGE_TYPES.BATCH,
    );

    jest.runOnlyPendingTimers();
    expect(win.sent.map((sent) => (sent.message as { type: string }).type)).toEqual([
      MESSAGE_TYPES.BATCH,
      MESSAGE_TYPES.CHAT_CHUNK,
      MESSAGE_TYPES.SWITCH_VIEW,
    ]);
  });

  it('keeps a later stream chunk behind a deferred exit', () => {
    for (let i = 0; i < 65; i++) {
      bridge.sendToRenderer({
        type: MESSAGE_TYPES.CHAT_CHUNK,
        payload: { i },
      });
    }
    bridge.sendToRenderer({ type: MESSAGE_TYPES.AGENT_MONITOR_EXITED });
    bridge.sendToRenderer({
      type: MESSAGE_TYPES.CHAT_CHUNK,
      payload: { i: 65 },
    });

    jest.runOnlyPendingTimers();
    expect(win.sent.map((sent) => (sent.message as { type: string }).type)).toEqual([
      MESSAGE_TYPES.BATCH,
      MESSAGE_TYPES.CHAT_CHUNK,
      MESSAGE_TYPES.AGENT_MONITOR_EXITED,
      MESSAGE_TYPES.CHAT_CHUNK,
    ]);
  });

  it('(d) non-streaming messages bypass batching and send immediately', () => {
    bridge.sendToRenderer({
      type: MESSAGE_TYPES.SWITCH_VIEW,
      payload: { view: 'chat' },
    });

    expect(win.sent.length).toBe(1);
    const msg = win.sent[0].message as { type: string };
    expect(msg.type).toBe(MESSAGE_TYPES.SWITCH_VIEW);
  });

  it('non-streaming message FLUSHES any pending stream queue before sending', () => {
    bridge.sendToRenderer({
      type: MESSAGE_TYPES.CHAT_CHUNK,
      payload: { id: 'a' },
    });
    bridge.sendToRenderer({
      type: MESSAGE_TYPES.CHAT_CHUNK,
      payload: { id: 'b' },
    });

    expect(win.sent.length).toBe(0);

    bridge.sendToRenderer({
      type: MESSAGE_TYPES.SWITCH_VIEW,
      payload: { view: 'chat' },
    });

    expect(win.sent.length).toBe(2);
    expect((win.sent[0].message as { type: string }).type).toBe(
      MESSAGE_TYPES.BATCH,
    );
    expect((win.sent[1].message as { type: string }).type).toBe(
      MESSAGE_TYPES.SWITCH_VIEW,
    );
  });

  it('passes a coordinator-created BATCH through without recursively queueing it', () => {
    bridge.sendToRenderer({
      type: MESSAGE_TYPES.BATCH,
      payload: {
        events: [{ type: MESSAGE_TYPES.CHAT_CHUNK, payload: { i: 1 } }],
      },
    });

    expect(win.sent).toHaveLength(1);
    expect((win.sent[0].message as { type: string }).type).toBe(
      MESSAGE_TYPES.BATCH,
    );
  });

  it('(c) RPC response path flushes the stream queue BEFORE the response (ordering invariant)', async () => {
    const handleMessageMock = jest.fn().mockResolvedValue({
      success: true,
      data: { ok: true },
    });
    const containerStub = {
      resolve: jest.fn(() => ({
        handleMessage: handleMessageMock,
        get: jest.fn(),
        update: jest.fn(),
      })),
      isRegistered: jest.fn(() => false),
    } as unknown as DependencyContainer;

    bridge.dispose();
    ipcMainListeners.clear();
    bridge = new IpcBridge(containerStub, () => win, TRUSTED_DOCUMENTS);
    bridge.initialize();

    bridge.sendToRenderer({
      type: MESSAGE_TYPES.CHAT_CHUNK,
      payload: { i: 'pre' },
    });
    bridge.sendToRenderer({
      type: MESSAGE_TYPES.CHAT_THINKING,
      payload: { i: 'pre2' },
    });

    expect(win.sent.length).toBe(0);

    const rpcListeners = ipcMainListeners.get('rpc') ?? [];
    expect(rpcListeners.length).toBeGreaterThan(0);

    const event = {
      sender: {
        id: 1,
        mainFrame: MAIN_FRAME,
        isDestroyed: () => false,
        send: jest.fn((channel: string, message: unknown) => {
          win.sent.push({ channel, message });
        }),
      },
      senderFrame: MAIN_FRAME,
    };
    const rpcMessage = {
      payload: {
        method: 'chat:resume',
        params: {},
        correlationId: 'corr-1',
      },
    };

    await rpcListeners[0](event, rpcMessage);

    const types = win.sent.map((s) => (s.message as { type: string }).type);
    expect(types[0]).toBe(MESSAGE_TYPES.BATCH);
    expect(types[types.length - 1]).toBe(MESSAGE_TYPES.RPC_RESPONSE);
  });

  it('(e) dispose() flushes pending stream events', () => {
    bridge.sendToRenderer({
      type: MESSAGE_TYPES.CHAT_THINKING,
      payload: { i: 1 },
    });

    expect(win.sent.length).toBe(0);

    bridge.dispose();

    expect(win.sent.length).toBe(1);
  });

  it('every batchable type maps to the queue path', () => {
    const batchable = [
      MESSAGE_TYPES.CHAT_MESSAGE_CHUNK,
      MESSAGE_TYPES.CHAT_CHUNK,
      MESSAGE_TYPES.CHAT_THINKING,
      MESSAGE_TYPES.CHAT_TOOL_PROGRESS,
      MESSAGE_TYPES.SETUP_WIZARD_ANALYSIS_STREAM,
      MESSAGE_TYPES.SETUP_WIZARD_SCAN_PROGRESS,
      MESSAGE_TYPES.INDEXING_PROGRESS,
      MESSAGE_TYPES.AGENT_MONITOR_OUTPUT,
    ];
    for (const type of batchable) {
      bridge.sendToRenderer({ type, payload: { type } });
    }

    expect(win.sent.length).toBe(0);
    jest.advanceTimersByTime(20);

    expect(win.sent.length).toBe(1);
    const msg = win.sent[0].message as {
      type: string;
      payload: { events: Array<{ type: string }> };
    };
    expect(msg.type).toBe(MESSAGE_TYPES.BATCH);
    expect(msg.payload.events.length).toBe(batchable.length);
  });

  it('suppresses the RPC response when the renderer sender is already destroyed', async () => {
    // Regression guard: during app teardown a late RPC can arrive after the
    // renderer's webContents is destroyed. Sending to it throws "Object has
    // been destroyed"; the bridge must skip the reply instead.
    const handleMessageMock = jest.fn().mockResolvedValue({
      success: true,
      data: { ok: true },
    });
    const containerStub = {
      resolve: jest.fn(() => ({
        handleMessage: handleMessageMock,
        get: jest.fn(),
        update: jest.fn(),
      })),
      isRegistered: jest.fn(() => false),
    } as unknown as DependencyContainer;

    bridge.dispose();
    ipcMainListeners.clear();
    bridge = new IpcBridge(containerStub, () => win, TRUSTED_DOCUMENTS);
    bridge.initialize();

    const rpcListeners = ipcMainListeners.get('rpc') ?? [];
    const sendSpy = jest.fn();
    const event = {
      sender: {
        id: 1,
        mainFrame: MAIN_FRAME,
        isDestroyed: () => true,
        send: sendSpy,
      },
      senderFrame: MAIN_FRAME,
    };

    await rpcListeners[0](event, {
      payload: { method: 'chat:resume', params: {}, correlationId: 'corr-x' },
    });

    // The handler still ran, but no reply was sent to the destroyed sender —
    // and crucially no exception escaped (the test would fail otherwise).
    expect(handleMessageMock).toHaveBeenCalledTimes(1);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(win.sent.length).toBe(0);
  });
});
