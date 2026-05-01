/**
 * `VscodeCommandRegistry` — contract against the shared `ICommandRegistry` suite.
 *
 * The registry wraps `vscode.commands`; our mock exposes a stateful command
 * map so register → execute round trips behave identically to the real host.
 */

import 'reflect-metadata';
import { runCommandRegistryContract } from '@ptah-extension/platform-core/testing';
import { VscodeCommandRegistry } from './vscode-command-registry';
import { __resetVscodeTestDouble, __vscodeState } from '../../__mocks__/vscode';

beforeEach(() => {
  __resetVscodeTestDouble();
});

runCommandRegistryContract(
  'VscodeCommandRegistry',
  () => new VscodeCommandRegistry(),
);

describe('VscodeCommandRegistry — VS Code-specific behaviour', () => {
  beforeEach(() => __resetVscodeTestDouble());

  it('registers the command under the id in vscode.commands', () => {
    const registry = new VscodeCommandRegistry();
    const sub = registry.registerCommand('ptah.test.ping', () => 'ok');
    expect(__vscodeState.commandHandlers.has('ptah.test.ping')).toBe(true);
    sub.dispose();
    expect(__vscodeState.commandHandlers.has('ptah.test.ping')).toBe(false);
  });
});
