import 'reflect-metadata';
import * as vscode from 'vscode';
import { runHostAttentionContract } from '@ptah-extension/platform-core/testing';
import type { SafeHostAttentionNotice, IPtahViewVisibility } from '@ptah-extension/platform-core';
import { MESSAGE_TYPES, type AttentionOpenTargetPayload } from '@ptah-extension/shared';
import { VscodeHostAttentionNotifications } from './vscode-host-attention-notifications';
import type { WebviewManager, Logger } from '@ptah-extension/vscode-core';

const presented: SafeHostAttentionNotice[] = [];
const opened: AttentionOpenTargetPayload[] = [];
let eligible = true;
let provider: VscodeHostAttentionNotifications;
let pendingChoice: ((choice: string | undefined) => void) | undefined;

const visibility: IPtahViewVisibility = {
  anyPtahViewVisible: () => !eligible,
  isPtahViewFocused: () => !eligible,
  onDidChange: () => ({ dispose: () => undefined }),
};
const broadcastMessage = jest.fn(async (_type: string, payload: AttentionOpenTargetPayload) => { opened.push(payload); });
const manager = { broadcastMessage } as Pick<WebviewManager, 'broadcastMessage'>;
const logger = { warn: jest.fn() } as Pick<Logger, 'warn'>;

beforeEach(() => {
  presented.length = 0;
  opened.length = 0;
  broadcastMessage.mockClear();
  pendingChoice = undefined;
  const choose = () => new Promise<string | undefined>((resolve) => { pendingChoice = resolve; });
  jest.spyOn(vscode.window, 'showInformationMessage').mockImplementation(choose as typeof vscode.window.showInformationMessage);
  jest.spyOn(vscode.window, 'showWarningMessage').mockImplementation(choose as typeof vscode.window.showWarningMessage);
  jest.spyOn(vscode.window, 'showErrorMessage').mockImplementation(choose as typeof vscode.window.showErrorMessage);
  jest.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

runHostAttentionContract('VS Code', {
  createProvider: () => {
    provider = new VscodeHostAttentionNotifications(visibility, manager as WebviewManager, logger as Logger);
    const present = provider.present.bind(provider);
    provider.present = (notice) => {
      const before = [vscode.window.showInformationMessage, vscode.window.showWarningMessage, vscode.window.showErrorMessage]
        .reduce((count, show) => count + (show as jest.Mock).mock.calls.length, 0);
      present(notice);
      const after = [vscode.window.showInformationMessage, vscode.window.showWarningMessage, vscode.window.showErrorMessage]
        .reduce((count, show) => count + (show as jest.Mock).mock.calls.length, 0);
      if (after > before) presented.push(notice);
    };
    return provider;
  },
  presented: () => presented,
  active: () => provider.activeNotices(),
  opened: () => opened,
  setEligible: (value) => { eligible = value; },
});

describe('VS Code host notification', () => {
  const target = { workspaceId: 'ws-1', sessionId: 's-1' };
  const notice: SafeHostAttentionNotice = {
    key: 'permission:r-1', generation: 1, kind: 'permission', severity: 'warning',
    label: 'Permission needed', actionLabel: 'Open Ptah', sessionTitle: 'Safe title', target,
  };

  beforeEach(() => {
    eligible = true;
    provider = new VscodeHostAttentionNotifications(visibility, manager as WebviewManager, logger as Logger);
  });
  afterEach(() => provider.dispose());

  it('shows only a safe fixed label and title', () => {
    provider.present(notice);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('Permission needed — Safe title', 'Open Ptah');
  });

  it('reveals Ptah and reports an already answered request on a late click', async () => {
    provider.present(notice);
    provider.resolve(notice.key, notice.generation);
    pendingChoice?.('Open Ptah');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('ptah.main.focus');
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Already answered');
    expect(manager.broadcastMessage).not.toHaveBeenCalled();
  });

  it('summarizes a burst and routes its newest current member', async () => {
    provider.present(notice);
    const next = { ...notice, key: 'permission:r-2', generation: 2, sessionTitle: 'Newest title' };
    provider.present(next);
    expect(vscode.window.showWarningMessage).toHaveBeenLastCalledWith('2 requests need you — Newest title', 'Open Ptah');
    pendingChoice?.('Open Ptah');
    await Promise.resolve();
    expect(manager.broadcastMessage).toHaveBeenCalledWith(MESSAGE_TYPES.ATTENTION_OPEN_TARGET, expect.objectContaining({ key: next.key }));
  });
});
