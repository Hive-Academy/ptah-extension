/**
 * `VscodeOutputChannel` — contract against the shared `IOutputChannel` suite.
 *
 * The provider lazily constructs a `vscode.OutputChannel` via
 * `window.createOutputChannel`; our mock returns a tracked object so the
 * contract's dispose/idempotency assertions run against real state.
 */

import 'reflect-metadata';
import { runOutputChannelContract } from '@ptah-extension/platform-core/testing';
import { VscodeOutputChannel } from './vscode-output-channel';
import { __resetVscodeTestDouble, __vscodeState } from '../../__mocks__/vscode';

beforeEach(() => {
  __resetVscodeTestDouble();
});

runOutputChannelContract(
  'VscodeOutputChannel',
  () => new VscodeOutputChannel('Ptah Test'),
);

describe('VscodeOutputChannel — VS Code-specific behaviour', () => {
  beforeEach(() => __resetVscodeTestDouble());

  it('preserves the channel name passed into the constructor', () => {
    const ch = new VscodeOutputChannel('My Channel');
    expect(ch.name).toBe('My Channel');
  });

  it('appendLine / append / clear / show / dispose forward to vscode.OutputChannel', () => {
    const ch = new VscodeOutputChannel('Forward Test');
    ch.appendLine('line-one');
    ch.append('fragment');
    ch.show();
    ch.clear();
    ch.dispose();

    const tracked = __vscodeState.outputChannels.find(
      (c) => c.name === 'Forward Test',
    );
    expect(tracked).toBeDefined();
    expect(tracked?.appendLine).toHaveBeenCalledWith('line-one');
    expect(tracked?.append).toHaveBeenCalledWith('fragment');
    expect(tracked?.show).toHaveBeenCalled();
    expect(tracked?.clear).toHaveBeenCalled();
    expect(tracked?.dispose).toHaveBeenCalled();
  });
});
