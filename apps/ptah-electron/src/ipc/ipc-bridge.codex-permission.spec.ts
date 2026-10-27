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
import type { CodexChatHostPorts } from '@ptah-extension/rpc-handlers';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { IpcBridge } from './ipc-bridge';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const TRUSTED_DOCUMENT = path.resolve('/app/renderer/index.html');
const MAIN_FRAME = { url: pathToFileURL(TRUSTED_DOCUMENT).href };

describe('IpcBridge Codex permission ownership', () => {
  let bridge: IpcBridge;

  function setup(
    codexPorts?: Pick<CodexChatHostPorts, 'handlePermissionResponse'> | null,
  ) {
    const child = container.createChildContainer();
    const handleResponse = jest.fn();
    child.registerInstance(TOKENS.RPC_HANDLER, { handleMessage: jest.fn() });
    child.registerInstance(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, {
      get: jest.fn(),
      update: jest.fn(),
    });
    // Production default (agent-sdk registerCodexChatServices) is a factory returning null.
    if (codexPorts !== undefined) {
      child.register(SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS, {
        useFactory: () => codexPorts,
      });
    }
    child.registerInstance(Symbol.for('SdkPermissionHandler'), { handleResponse });
    bridge = new IpcBridge(
      child,
      () => ({ webContents: { id: 1, send: jest.fn() } }),
      [TRUSTED_DOCUMENT],
    );
    bridge.initialize();
    const rpc = ipcMainListeners.get('rpc');
    if (!rpc) throw new Error('RPC listener was not installed');
    const send = async (response: unknown, field = 'payload') => {
      await rpc(
        {
          sender: {
            id: 1,
            mainFrame: MAIN_FRAME,
            isDestroyed: () => false,
            send: jest.fn(),
          },
          senderFrame: MAIN_FRAME,
        },
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

  it.each([null, undefined])(
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
