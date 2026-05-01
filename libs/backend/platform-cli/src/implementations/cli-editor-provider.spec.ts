/**
 * `cli-editor-provider.spec.ts` — runs `runEditorProviderContract` against
 * `CliEditorProvider`. The CLI impl is an intentional stub (there is no
 * text editor in CLI context), so the setup does not provide a `trigger`
 * hook — contract assertions that require trigger use are auto-skipped.
 *
 * CLI-specific assertions below lock in the stub behaviour so future
 * refactors do not accidentally break the interface contract.
 */

import 'reflect-metadata';
import {
  runEditorProviderContract,
  type EditorProviderSetup,
} from '@ptah-extension/platform-core/testing';
import { CliEditorProvider } from './cli-editor-provider';

runEditorProviderContract('CliEditorProvider', () => {
  const provider = new CliEditorProvider();
  const setup: EditorProviderSetup = {
    provider,
    // No trigger hook — CLI has no editor surface to simulate.
  };
  return setup;
});

describe('CliEditorProvider — CLI-specific behaviour', () => {
  let provider: CliEditorProvider;

  beforeEach(() => {
    provider = new CliEditorProvider();
  });

  it('getActiveEditorPath always returns undefined (no editor in CLI)', () => {
    expect(provider.getActiveEditorPath()).toBeUndefined();
  });

  it('onDidChangeActiveEditor is subscribable and returns a disposable', () => {
    const sub = provider.onDidChangeActiveEditor(() => undefined);
    expect(typeof sub.dispose).toBe('function');
    sub.dispose();
  });

  it('onDidOpenDocument is subscribable and returns a disposable', () => {
    const sub = provider.onDidOpenDocument(() => undefined);
    expect(typeof sub.dispose).toBe('function');
    sub.dispose();
  });

  it('events never fire in CLI mode — subscribers receive nothing', async () => {
    let changeCount = 0;
    let openCount = 0;
    const a = provider.onDidChangeActiveEditor(() => {
      changeCount += 1;
    });
    const b = provider.onDidOpenDocument(() => {
      openCount += 1;
    });

    // Give the event loop a tick in case anything is queued asynchronously.
    await new Promise<void>((r) => setImmediate(r));

    a.dispose();
    b.dispose();
    expect(changeCount).toBe(0);
    expect(openCount).toBe(0);
  });

  it('multiple disposals are safe (idempotent no-op)', () => {
    const sub = provider.onDidChangeActiveEditor(() => undefined);
    sub.dispose();
    expect(() => sub.dispose()).not.toThrow();
  });
});
