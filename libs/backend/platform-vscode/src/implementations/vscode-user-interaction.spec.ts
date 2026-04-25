/**
 * `VscodeUserInteraction` — contract against `IUserInteraction` + VS Code
 * specifics.
 *
 * The mock's `__vscodeState.scripted` bag lets the contract prime responses to
 * message/input/quickPick calls without reaching the extension host UI.
 */

import 'reflect-metadata';
import { runUserInteractionContract } from '@ptah-extension/platform-core/testing';
import { VscodeUserInteraction } from './vscode-user-interaction';
import { __resetVscodeTestDouble, __vscodeState } from '../../__mocks__/vscode';

beforeEach(() => {
  __resetVscodeTestDouble();
});

runUserInteractionContract('VscodeUserInteraction', () => {
  const provider = new VscodeUserInteraction();
  return {
    provider,
    script(config) {
      if (config.nextAction !== undefined) {
        __vscodeState.scripted.nextAction = config.nextAction;
      }
      if (config.nextInput !== undefined) {
        __vscodeState.scripted.nextInput = config.nextInput;
      }
      if (config.nextQuickPick !== undefined) {
        __vscodeState.scripted.nextQuickPick = config.nextQuickPick;
      }
    },
  };
});

describe('VscodeUserInteraction — VS Code-specific behaviour', () => {
  beforeEach(() => __resetVscodeTestDouble());

  it('openExternal delegates to vscode.env.openExternal and resolves boolean', async () => {
    const provider = new VscodeUserInteraction();
    const result = await provider.openExternal('https://example.com/page');
    expect(typeof result).toBe('boolean');
  });

  it('withProgress surfaces a report function and cancellation token', async () => {
    const provider = new VscodeUserInteraction();
    let observedIsCancelled: boolean | undefined;
    const out = await provider.withProgress(
      { title: 'task', location: 'notification' },
      async (progress, token) => {
        progress.report({ message: 'half-way', increment: 50 });
        observedIsCancelled = token.isCancellationRequested;
        return 'done';
      },
    );
    expect(out).toBe('done');
    expect(observedIsCancelled).toBe(false);
  });

  it('showQuickPick round-trips a scripted pick and preserves the label', async () => {
    __vscodeState.scripted.nextQuickPick = { label: 'two' };
    const provider = new VscodeUserInteraction();
    const result = await provider.showQuickPick([
      { label: 'one' },
      { label: 'two', description: 'second choice' },
    ]);
    expect(result?.label).toBe('two');
  });

  it('openOAuthUrl opens the verification URI and returns { opened: true }', async () => {
    const provider = new VscodeUserInteraction();
    const result = await provider.openOAuthUrl({
      provider: 'copilot',
      verificationUri: 'https://github.com/login/device',
    });
    expect(result.opened).toBe(true);
    expect(result.code).toBeUndefined();
  });

  it('openOAuthUrl with userCode writes to clipboard and shows toast', async () => {
    // Re-import the mocked vscode env to inspect spies
    const vscodeMock = require('../../__mocks__/vscode');
    const provider = new VscodeUserInteraction();
    const result = await provider.openOAuthUrl({
      provider: 'copilot',
      verificationUri: 'https://github.com/login/device',
      userCode: 'WXYZ-9999',
    });
    expect(result.opened).toBe(true);
    expect(vscodeMock.env.clipboard.writeText).toHaveBeenCalledWith(
      'WXYZ-9999',
    );
    expect(vscodeMock.window.showInformationMessage).toHaveBeenCalled();
  });
});
