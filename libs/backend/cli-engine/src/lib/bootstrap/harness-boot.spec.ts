/**
 * TASK_2026_278 Batch 3 — the CLI/TUI boot pass.
 *
 * The gap this closes was total, not partial: VS Code and Electron each ran
 * mirror → reconcileAll → reconcile at activation, while `cli-engine` ran none
 * of the three. `UserLayerMirrorService` was registered in the CLI container
 * and had ZERO callers, so on a machine that had only ever run `ptah tui`,
 * `~/.ptah/user` — the reconciler's entire desired state — stayed empty and
 * every reconcile was a correct no-op over nothing.
 */

import type { Logger } from '@ptah-extension/vscode-core';
import { bootHarness, createCliUserLayerRefresher } from './harness-boot';

const PROPAGATION = Symbol.for('HarnessSyncPropagation');
const MIRROR = Symbol.for('PtahUserLayerMirrorService');
const WORKSPACE_PROVIDER = Symbol.for('PlatformWorkspaceProvider');
const CONTENT_DOWNLOAD = Symbol.for('PlatformContentDownload');
const PLUGIN_LOADER = Symbol.for('SdkPluginLoader');

const WORKSPACE_ROOT = '/repo';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

interface FakeContainer {
  isRegistered(token: symbol): boolean;
  resolve<T>(token: symbol): T;
}

function makeContainer(entries: Array<[symbol, unknown]>): FakeContainer {
  const map = new Map<symbol, unknown>(entries);
  return {
    isRegistered: (token) => map.has(token),
    resolve: <T>(token: symbol): T => {
      if (!map.has(token)) throw new Error(`unregistered: ${String(token)}`);
      return map.get(token) as T;
    },
  };
}

function workspaceProvider(root: string | undefined): unknown {
  return { getWorkspaceRoot: () => root, getConfiguration: () => undefined };
}

describe('bootHarness', () => {
  it('propagates once, with reason "boot", at the workspace root', async () => {
    const propagate = jest.fn().mockResolvedValue({
      sources: 'ok',
      targets: [],
    });
    const logger = makeLogger();
    const container = makeContainer([
      [PROPAGATION, { propagate }],
      [WORKSPACE_PROVIDER, workspaceProvider(WORKSPACE_ROOT)],
    ]);

    await bootHarness(container as never, logger);

    expect(propagate).toHaveBeenCalledWith(WORKSPACE_ROOT, 'boot');
  });

  it('does nothing when the CLI was launched outside a workspace', async () => {
    const propagate = jest.fn();
    const container = makeContainer([
      [PROPAGATION, { propagate }],
      [WORKSPACE_PROVIDER, workspaceProvider(undefined)],
    ]);

    await bootHarness(container as never, makeLogger());

    expect(propagate).not.toHaveBeenCalled();
  });

  it('never throws when propagation fails — a CLI command must still run', async () => {
    const propagate = jest.fn().mockRejectedValue(new Error('EACCES'));
    const logger = makeLogger();
    const container = makeContainer([
      [PROPAGATION, { propagate }],
      [WORKSPACE_PROVIDER, workspaceProvider(WORKSPACE_ROOT)],
    ]);

    await expect(
      bootHarness(container as never, logger),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('no-ops in a container without harness-sync', async () => {
    const container = makeContainer([
      [WORKSPACE_PROVIDER, workspaceProvider(WORKSPACE_ROOT)],
    ]);

    await expect(
      bootHarness(container as never, makeLogger()),
    ).resolves.toBeUndefined();
  });
});

describe('createCliUserLayerRefresher', () => {
  function mirrorContainer(mirror: {
    mirrorAll: jest.Mock;
    reconcileAll: jest.Mock;
  }): FakeContainer {
    return makeContainer([
      [MIRROR, mirror],
      [WORKSPACE_PROVIDER, workspaceProvider(WORKSPACE_ROOT)],
      [CONTENT_DOWNLOAD, { getPluginsPath: () => '/home/.ptah/plugins' }],
      [
        PLUGIN_LOADER,
        {
          getWorkspacePluginConfig: () => ({ enabledPluginIds: ['ptah-core'] }),
          resolvePluginPaths: () => ['/home/.ptah/plugins/ptah-core'],
          discoverHarnessPluginPaths: () => [
            '/home/.ptah/plugins/ptah-harness-x',
          ],
        },
      ],
    ]);
  }

  it('mirrors BEFORE reconciling the clones', async () => {
    // Order is the contract: `mirrorAll` is create-if-absent and picks up new
    // slugs; `reconcileAll` fast-forwards and reaps. Reaping first would sweep
    // a clone whose source had only just been mirrored.
    const mirror = {
      mirrorAll: jest.fn().mockResolvedValue({}),
      reconcileAll: jest.fn().mockResolvedValue({}),
    };
    const refresher = createCliUserLayerRefresher(
      mirrorContainer(mirror) as never,
    );

    await refresher.refresh(WORKSPACE_ROOT);

    expect(mirror.mirrorAll.mock.invocationCallOrder[0]).toBeLessThan(
      mirror.reconcileAll.mock.invocationCallOrder[0],
    );
  });

  it('hands both halves the SAME sources block', async () => {
    // `reconcileAll`'s reap reads "not among the supplied roots" as "upstream
    // deleted", so a reconcile walking fewer roots than the mirror would reap
    // live clones.
    const mirror = {
      mirrorAll: jest.fn().mockResolvedValue({}),
      reconcileAll: jest.fn().mockResolvedValue({}),
    };
    const refresher = createCliUserLayerRefresher(
      mirrorContainer(mirror) as never,
    );

    await refresher.refresh(WORKSPACE_ROOT);

    expect(mirror.mirrorAll.mock.calls[0][0]).toBe(
      mirror.reconcileAll.mock.calls[0][0],
    );
    expect(mirror.mirrorAll.mock.calls[0][0]).toMatchObject({
      pluginPaths: ['/home/.ptah/plugins/ptah-core'],
      harnessPluginRoots: ['/home/.ptah/plugins/ptah-harness-x'],
      pluginsBasePath: '/home/.ptah/plugins',
    });
  });

  it('no-ops when agent-generation is not registered in this container', async () => {
    const refresher = createCliUserLayerRefresher(
      makeContainer([
        [WORKSPACE_PROVIDER, workspaceProvider(WORKSPACE_ROOT)],
      ]) as never,
    );

    await expect(refresher.refresh(WORKSPACE_ROOT)).resolves.toBeUndefined();
  });
});
