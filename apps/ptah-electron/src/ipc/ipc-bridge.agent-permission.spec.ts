const ipcMainListeners = new Map<
  string,
  Array<(...args: unknown[]) => unknown>
>();

jest.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, listener: (...args: unknown[]) => unknown) => {
      const arr = ipcMainListeners.get(channel) ?? [];
      arr.push(listener);
      ipcMainListeners.set(channel, arr);
    },
    removeAllListeners: (channel: string) => ipcMainListeners.delete(channel),
    handle: jest.fn(),
    removeHandler: jest.fn(),
  },
}));

import type { DependencyContainer } from 'tsyringe';
import { IpcBridge } from './ipc-bridge';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

function setup(
  result: { success: boolean; error?: string } = { success: true },
) {
  const handleMessage = jest.fn(async () => result);
  const container = {
    resolve: jest.fn(() => ({
      handleMessage,
      get: jest.fn(),
      update: jest.fn(),
    })),
    isRegistered: jest.fn(() => false),
  } as unknown as DependencyContainer;
  const bridge = new IpcBridge(container, () => null);
  bridge.initialize();
  const [rpc] = ipcMainListeners.get('rpc') ?? [];
  const event = { sender: { isDestroyed: () => false, send: jest.fn() } };
  const send = async (message: unknown) => {
    await rpc(event, message);
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { bridge, handleMessage, send };
}

describe('IpcBridge — CLI-agent permission answers', () => {
  beforeEach(() => ipcMainListeners.clear());

  it('forwards the answer to agent:permissionResponse, like the VS Code host', async () => {
    const { bridge, handleMessage, send } = setup();
    const payload = {
      requestId: 'req-1',
      decision: 'deny',
      reason: 'User denied',
    };
    await send({
      type: MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_RESPONSE,
      payload,
    });
    expect(handleMessage).toHaveBeenCalledWith({
      method: 'agent:permissionResponse',
      params: payload,
      correlationId: 'req-1',
    });
    bridge.dispose();
  });

  it('ignores an answer without a requestId', async () => {
    const { bridge, handleMessage, send } = setup();
    await send({
      type: MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_RESPONSE,
      payload: { decision: 'allow' },
    });
    expect(handleMessage).not.toHaveBeenCalled();
    bridge.dispose();
  });

  it('logs a failed answer without throwing', async () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const { bridge, send } = setup({
      success: false,
      error: 'No permission handler',
    });
    await send({
      type: MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_RESPONSE,
      payload: { requestId: 'req-2', decision: 'allow' },
    });
    expect(warn).toHaveBeenCalledWith(
      '[IpcBridge] Agent permission response failed',
      { requestId: 'req-2', error: 'No permission handler' },
    );
    warn.mockRestore();
    bridge.dispose();
  });
});
