/**
 * `runEditorProviderContract` — behavioural contract for `IEditorProvider`.
 *
 * Impls need to expose subscribable `IEvent<T>` for active-editor changes and
 * document-open events. The setup's optional `trigger` hook lets the contract
 * drive state transitions without reaching into vscode/electron internals.
 */

import type { IEditorProvider } from '../../interfaces/editor-provider.interface';

export interface EditorProviderSetup {
  provider: IEditorProvider;
  /** Optional driver — lets contracts simulate editor activity. */
  trigger?(
    action:
      | { kind: 'activate'; filePath: string | undefined }
      | { kind: 'open'; filePath: string },
  ): void;
}

export function runEditorProviderContract(
  name: string,
  createSetup: () => Promise<EditorProviderSetup> | EditorProviderSetup,
  teardown?: () => Promise<void> | void,
): void {
  describe(`IEditorProvider contract — ${name}`, () => {
    let setup: EditorProviderSetup;

    beforeEach(async () => {
      setup = await createSetup();
    });

    afterEach(async () => {
      await teardown?.();
    });

    it('getActiveEditorPath starts undefined for a fresh provider', () => {
      expect(setup.provider.getActiveEditorPath()).toBeUndefined();
    });

    it('onDidChangeActiveEditor returns a disposable subscription', () => {
      const sub = setup.provider.onDidChangeActiveEditor(() => {
        /* noop */
      });
      expect(typeof sub.dispose).toBe('function');
      sub.dispose();
    });

    it('onDidOpenDocument returns a disposable subscription', () => {
      const sub = setup.provider.onDidOpenDocument(() => {
        /* noop */
      });
      expect(typeof sub.dispose).toBe('function');
      sub.dispose();
    });

    it('onDidChangeActiveEditor fires with the new file path', () => {
      const seen: Array<string | undefined> = [];
      const sub = setup.provider.onDidChangeActiveEditor((e) =>
        seen.push(e.filePath),
      );
      setup.trigger?.({ kind: 'activate', filePath: '/tmp/foo.ts' });
      sub.dispose();
      // Skip assertion if no trigger hook — contract still validates shape.
      if (setup.trigger) expect(seen).toContain('/tmp/foo.ts');
    });

    it('onDidOpenDocument fires with the opened path', () => {
      const seen: string[] = [];
      const sub = setup.provider.onDidOpenDocument((e) =>
        seen.push(e.filePath),
      );
      setup.trigger?.({ kind: 'open', filePath: '/tmp/bar.ts' });
      sub.dispose();
      if (setup.trigger) expect(seen).toContain('/tmp/bar.ts');
    });

    it('disposed subscription stops receiving events', () => {
      let count = 0;
      const sub = setup.provider.onDidChangeActiveEditor(() => {
        count += 1;
      });
      sub.dispose();
      setup.trigger?.({ kind: 'activate', filePath: '/x.ts' });
      expect(count).toBe(0);
    });

    it('getActiveEditorPath tracks the activated path', () => {
      setup.trigger?.({ kind: 'activate', filePath: '/tmp/tracked.ts' });
      if (setup.trigger) {
        expect(setup.provider.getActiveEditorPath()).toBe('/tmp/tracked.ts');
      }
    });
  });
}
