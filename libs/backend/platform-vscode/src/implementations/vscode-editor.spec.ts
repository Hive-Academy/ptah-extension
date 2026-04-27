/**
 * `VscodeEditorProvider` — contract against the shared `IEditorProvider` suite.
 *
 * The provider subscribes to `window.onDidChangeActiveTextEditor` and
 * `workspace.onDidOpenTextDocument`. We drive those emitters directly via
 * the test-double's `__vscodeState` helpers so the contract's `trigger` hook
 * surfaces real event propagation.
 */

import 'reflect-metadata';
import { runEditorProviderContract } from '@ptah-extension/platform-core/testing';
import { VscodeEditorProvider } from './vscode-editor-provider';
import { __resetVscodeTestDouble, __vscodeState } from '../../__mocks__/vscode';

beforeEach(() => {
  __resetVscodeTestDouble();
});

runEditorProviderContract('VscodeEditorProvider', () => {
  const provider = new VscodeEditorProvider();
  return {
    provider,
    trigger(action) {
      if (action.kind === 'activate') {
        __vscodeState.setActiveEditor(action.filePath);
      } else {
        __vscodeState.fireOpenDocument(action.filePath);
      }
    },
  };
});

describe('VscodeEditorProvider — VS Code-specific behaviour', () => {
  beforeEach(() => __resetVscodeTestDouble());

  it('getActiveEditorPath reads vscode.window.activeTextEditor on demand', () => {
    const provider = new VscodeEditorProvider();
    expect(provider.getActiveEditorPath()).toBeUndefined();
    __vscodeState.setActiveEditor('/tmp/current.ts');
    expect(provider.getActiveEditorPath()).toBe('/tmp/current.ts');
  });

  it('dispose removes all internal subscriptions so subsequent events are ignored', () => {
    const provider = new VscodeEditorProvider();
    const seen: Array<string | undefined> = [];
    const sub = provider.onDidChangeActiveEditor((e) => seen.push(e.filePath));

    provider.dispose();
    __vscodeState.setActiveEditor('/tmp/after-dispose.ts');
    expect(seen).toEqual([]);
    sub.dispose();
  });
});
