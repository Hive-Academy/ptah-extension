import 'reflect-metadata';

const ipcMainListeners = new Map<string, (...args: unknown[]) => unknown>();

jest.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, listener: (...args: unknown[]) => unknown) => {
      ipcMainListeners.set(channel, listener);
    },
    removeAllListeners: (channel: string) => ipcMainListeners.delete(channel),
    handle: jest.fn(),
    removeHandler: jest.fn(),
  },
}));

import { container } from 'tsyringe';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { IpcBridge } from './ipc-bridge';

describe('IpcBridge Codex permission ownership', () => {
  let bridge: IpcBridge;

  function setup(codexPorts: unknown) {
    const child = container.createChildContainer();
    const handleResponse = jest.fn();
    child.registerInstance(TOKENS.RPC_HANDLER, { handleMessage: jest.fn() });
    child.registerInstance(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, {
      get: jest.fn(),
      update: jest.fn(),
    });
    // Production default (agent-sdk registerCodexChatServices) is a factory returning null.
    child.register(SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS, {
      useFactory: () => codexPorts,
    });
    child.registerInstance(Symbol.for('SdkPermissionHandler'), { handleResponse });
    bridge = new IpcBridge(child, () => null);
    bridge.initialize();
    const rpc = ipcMainListeners.get('rpc');
    if (!rpc) throw new Error('RPC listener was not installed');
    const send = async (response: unknown, field = 'payload') => {
      await rpc(
        { sender: { isDestroyed: () => false, send: jest.fn() } },
        { type: MESSAGE_TYPES.SDK_PERMISSION_RESPONSE, [field]: response },
      );
      await new Promise((resolve) => setImmediate(resolve));
    };
    return { handleResponse, send };
  }

  beforeEach(() => ipcMainListeners.clear());
  afterEach(() => {
    bridge.dispose();
    jest.restoreAllMocks();
  });

  it.each(['allow', 'always_allow', 'deny_with_message', 'deny'])(
    'offers %s to Codex first and stops when owned',
    async (decision) => {
      const handlePermissionResponse = jest.fn(() => true);
      const h = setup({ handlePermissionResponse });
      const response = {
        id: 'codex-request',
        decision,
        reason: 'reason',
        modifiedInput: { command: 'pwd' },
      };
      await h.send(response, 'response');
      expect(handlePermissionResponse).toHaveBeenCalledWith(response);
      expect(h.handleResponse).not.toHaveBeenCalled();
    },
  );

  it.each([null, {}, { handlePermissionResponse: 'unsupported' }])(
    'falls through to Claude when Codex has no response handler: %j',
    async (ports) => {
      const h = setup(ports);
      const response = { id: 'claude-request', decision: 'allow' };
      await h.send(response);
      expect(h.handleResponse).toHaveBeenCalledWith(response.id, response);
    },
  );

  it('falls through for an id Codex does not own', async () => {
    const handlePermissionResponse = jest.fn(() => false);
    const h = setup({ handlePermissionResponse });
    const response = { id: 'claude-request', decision: 'deny' };
    await h.send(response);
    expect(handlePermissionResponse).toHaveBeenCalledWith(response);
    expect(h.handleResponse).toHaveBeenCalledWith(response.id, response);
  });

  it('refuses unknown decisions before either handler', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const handlePermissionResponse = jest.fn(() => true);
    const h = setup({ handlePermissionResponse });
    await h.send({ id: 'request', decision: 'accept' });
    expect(warn).toHaveBeenCalledWith(
      '[IpcBridge] SDK permission response has invalid decision',
    );
    expect(handlePermissionResponse).not.toHaveBeenCalled();
    expect(h.handleResponse).not.toHaveBeenCalled();
  });

  it('logs the real Error when Codex routing fails', async () => {
    const error = new Error('Codex reply failed');
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const h = setup({
      handlePermissionResponse: () => {
        throw error;
      },
    });
    await h.send({ id: 'request', decision: 'allow' });
    expect(log).toHaveBeenCalledWith(
      '[IpcBridge] Failed to process SDK permission response',
      error,
    );
    expect(h.handleResponse).not.toHaveBeenCalled();
  });
});
