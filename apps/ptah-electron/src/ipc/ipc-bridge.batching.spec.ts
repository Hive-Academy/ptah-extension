const ipcMainListeners = new Map<
  string,
  Array<(...args: unknown[]) => unknown>
>();

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
    },
  };
});

import type { DependencyContainer } from 'tsyringe';
import { IpcBridge } from './ipc-bridge';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

interface SentMessage {
  readonly channel: string;
  readonly message: unknown;
}

interface FakeWindow {
  webContents: { send: jest.Mock };
  sent: SentMessage[];
}

function makeWindow(): FakeWindow {
  const sent: SentMessage[] = [];
  return {
    webContents: {
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
    win = makeWindow();
    bridge = new IpcBridge(makeContainer(), () => win);
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
    bridge = new IpcBridge(containerStub, () => win);
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
        isDestroyed: () => false,
        send: jest.fn((channel: string, message: unknown) => {
          win.sent.push({ channel, message });
        }),
      },
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
      type: MESSAGE_TYPES.AGENT_SUMMARY_CHUNK,
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
      MESSAGE_TYPES.AGENT_SUMMARY_CHUNK,
      MESSAGE_TYPES.SETUP_WIZARD_ANALYSIS_STREAM,
      MESSAGE_TYPES.SETUP_WIZARD_SCAN_PROGRESS,
      MESSAGE_TYPES.INDEXING_PROGRESS,
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
    bridge = new IpcBridge(containerStub, () => win);
    bridge.initialize();

    const rpcListeners = ipcMainListeners.get('rpc') ?? [];
    const sendSpy = jest.fn();
    const event = {
      sender: {
        isDestroyed: () => true,
        send: sendSpy,
      },
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
