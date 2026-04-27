/**
 * `electron-editor.spec.ts` — runs `runEditorProviderContract` against
 * `ElectronEditorProvider` using its public `notify*` entry points as the
 * contract's `trigger` hook, plus Electron-specific coverage of the IPC
 * notification surface.
 */

import 'reflect-metadata';
import {
  runEditorProviderContract,
  type EditorProviderSetup,
} from '@ptah-extension/platform-core/testing';
import { ElectronEditorProvider } from './electron-editor-provider';

runEditorProviderContract('ElectronEditorProvider', () => {
  const provider = new ElectronEditorProvider();
  const setup: EditorProviderSetup = {
    provider,
    trigger(action) {
      if (action.kind === 'activate') {
        provider.notifyActiveEditorChanged(action.filePath);
      } else {
        provider.notifyFileOpened(action.filePath);
      }
    },
  };
  return setup;
});

describe('ElectronEditorProvider — Electron-specific behaviour', () => {
  let provider: ElectronEditorProvider;

  beforeEach(() => {
    provider = new ElectronEditorProvider();
  });

  it('notifyFileOpened fires both onDidOpenDocument and onDidChangeActiveEditor', () => {
    const opens: string[] = [];
    const changes: Array<string | undefined> = [];
    const openSub = provider.onDidOpenDocument((e) => opens.push(e.filePath));
    const changeSub = provider.onDidChangeActiveEditor((e) =>
      changes.push(e.filePath),
    );

    provider.notifyFileOpened('/project/src/index.ts');

    openSub.dispose();
    changeSub.dispose();
    expect(opens).toEqual(['/project/src/index.ts']);
    expect(changes).toEqual(['/project/src/index.ts']);
  });

  it('notifyFileOpened updates getActiveEditorPath', () => {
    expect(provider.getActiveEditorPath()).toBeUndefined();
    provider.notifyFileOpened('/project/a.ts');
    expect(provider.getActiveEditorPath()).toBe('/project/a.ts');
    provider.notifyFileOpened('/project/b.ts');
    expect(provider.getActiveEditorPath()).toBe('/project/b.ts');
  });

  it('notifyActiveEditorChanged(undefined) clears the active path', () => {
    provider.notifyFileOpened('/project/a.ts');
    provider.notifyActiveEditorChanged(undefined);
    expect(provider.getActiveEditorPath()).toBeUndefined();
  });

  it('notifyActiveEditorChanged only fires onDidChangeActiveEditor (not open)', () => {
    const opens: string[] = [];
    const changes: Array<string | undefined> = [];
    const openSub = provider.onDidOpenDocument((e) => opens.push(e.filePath));
    const changeSub = provider.onDidChangeActiveEditor((e) =>
      changes.push(e.filePath),
    );

    provider.notifyActiveEditorChanged('/project/switched.ts');

    openSub.dispose();
    changeSub.dispose();
    expect(opens).toEqual([]);
    expect(changes).toEqual(['/project/switched.ts']);
  });

  it('disposing a subscription stops further deliveries', () => {
    let count = 0;
    const sub = provider.onDidChangeActiveEditor(() => {
      count += 1;
    });
    provider.notifyActiveEditorChanged('/a.ts');
    sub.dispose();
    provider.notifyActiveEditorChanged('/b.ts');
    expect(count).toBe(1);
  });

  it('multiple subscribers all receive the same event', () => {
    const a: string[] = [];
    const b: string[] = [];
    const sa = provider.onDidOpenDocument((e) => a.push(e.filePath));
    const sb = provider.onDidOpenDocument((e) => b.push(e.filePath));
    provider.notifyFileOpened('/shared.ts');
    sa.dispose();
    sb.dispose();
    expect(a).toEqual(['/shared.ts']);
    expect(b).toEqual(['/shared.ts']);
  });
});
