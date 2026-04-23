/**
 * `runWorkspaceContract` — behavioural contract for `IWorkspaceProvider`.
 *
 * Seed initial folders + config via the `seed` hook on the setup return value
 * so the same suite applies to VS Code (backed by `vscode.workspace`), Electron
 * (backed by an app-local JSON file), and CLI (backed by in-memory defaults).
 */

import type { IWorkspaceProvider } from '../../interfaces/workspace-provider.interface';

export interface WorkspaceProviderSetup {
  provider: IWorkspaceProvider;
  /** Optional seed hook called at the top of each `it()` to prime state. */
  seed?(config: { folders?: string[]; config?: Record<string, unknown> }): void;
}

export function runWorkspaceContract(
  name: string,
  createSetup: () => Promise<WorkspaceProviderSetup> | WorkspaceProviderSetup,
  teardown?: () => Promise<void> | void,
): void {
  describe(`IWorkspaceProvider contract — ${name}`, () => {
    let setup: WorkspaceProviderSetup;

    beforeEach(async () => {
      setup = await createSetup();
    });

    afterEach(async () => {
      await teardown?.();
    });

    it('getWorkspaceFolders returns [] when no folders seeded', () => {
      expect(setup.provider.getWorkspaceFolders()).toEqual([]);
    });

    it('getWorkspaceFolders returns seeded folders in order', () => {
      setup.seed?.({ folders: ['/a', '/b'] });
      expect(setup.provider.getWorkspaceFolders()).toEqual(['/a', '/b']);
    });

    it('getWorkspaceRoot returns the first folder or undefined', () => {
      expect(setup.provider.getWorkspaceRoot()).toBeUndefined();
      setup.seed?.({ folders: ['/root', '/other'] });
      expect(setup.provider.getWorkspaceRoot()).toBe('/root');
    });

    it('getConfiguration returns defaultValue when unset', () => {
      expect(
        setup.provider.getConfiguration<string>('ptah', 'missing', 'fallback'),
      ).toBe('fallback');
    });

    it('setConfiguration then getConfiguration round-trips values', async () => {
      await setup.provider.setConfiguration('ptah', 'authMethod', 'oauth');
      expect(setup.provider.getConfiguration('ptah', 'authMethod')).toBe(
        'oauth',
      );
    });

    it('onDidChangeConfiguration fires for the correct section after set', async () => {
      const events: string[] = [];
      const sub = setup.provider.onDidChangeConfiguration((evt) => {
        if (evt.affectsConfiguration('ptah')) events.push('ptah');
      });
      await setup.provider.setConfiguration('ptah', 'telemetry', true);
      sub.dispose();
      expect(events).toContain('ptah');
    });

    it('onDidChangeConfiguration subscriber can dispose to stop receiving events', async () => {
      let received = 0;
      const sub = setup.provider.onDidChangeConfiguration(() => {
        received += 1;
      });
      sub.dispose();
      await setup.provider.setConfiguration('ptah', 'quiet', 1);
      expect(received).toBe(0);
    });

    it('getConfiguration returns typed value when stored with correct type', async () => {
      await setup.provider.setConfiguration('ptah', 'n', 42);
      expect(setup.provider.getConfiguration<number>('ptah', 'n')).toBe(42);
    });
  });
}
