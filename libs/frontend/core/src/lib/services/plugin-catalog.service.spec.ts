/**
 * TASK_2026_345 — the plugin catalog is read ONCE per view.
 *
 * Baseline: `plugins:get-config` + `plugins:list-available` were issued as
 * duplicate pairs per view (`tmp/logs/log.log:978-993, 1907-1924, 1949-1968`),
 * because the status widget, the browser modal and the chat empty state each
 * fetched into component-local signals with nothing to share. These tests pin
 * the sharing: many `ensureLoaded()` callers, one round trip.
 */

import { TestBed } from '@angular/core/testing';
import type { PluginInfo } from '@ptah-extension/shared';

import { ClaudeRpcService } from './claude-rpc.service';
import { PluginCatalogService } from './plugin-catalog.service';
import { WorkspaceScopeService } from './workspace-scope.service';
import { rpcError, rpcSuccess } from '../../testing';

function plugin(id: string, source: PluginInfo['source']): PluginInfo {
  return {
    id,
    name: id,
    description: '',
    source,
  } as PluginInfo;
}

const PLUGINS: PluginInfo[] = [
  plugin('ptah-core', 'bundled'),
  plugin('ptah-angular', 'bundled'),
  plugin('ptah-harness-notes', 'harness'),
];

interface RpcStub {
  call: jest.Mock;
  /** Resolve the pending `plugins:*` pair. */
  release: () => void;
  countOf: (method: string) => number;
}

function makeRpc(
  options: {
    enabledPluginIds?: string[];
    disabledPluginIds?: string[];
    disabledSkillIds?: string[];
    manual?: boolean;
    configFails?: boolean;
    throws?: boolean;
  } = {},
): RpcStub {
  const waiters: Array<() => void> = [];
  const gate = (): Promise<void> =>
    options.manual === true
      ? new Promise<void>((resolve) => waiters.push(resolve))
      : Promise.resolve();

  const call = jest.fn(async (method: string) => {
    await gate();
    if (options.throws === true) throw new Error('transport gone');
    if (method === 'plugins:list-available') {
      return rpcSuccess({ plugins: PLUGINS });
    }
    if (method === 'plugins:get-config') {
      if (options.configFails === true) {
        return rpcError('handler exploded');
      }
      return rpcSuccess({
        enabledPluginIds: options.enabledPluginIds ?? ['ptah-core'],
        disabledPluginIds: options.disabledPluginIds ?? [],
        disabledSkillIds: options.disabledSkillIds ?? [],
      });
    }
    throw new Error(`unexpected method: ${method}`);
  });

  return {
    call,
    release: () => {
      const pending = waiters.splice(0, waiters.length);
      for (const resolve of pending) resolve();
    },
    countOf: (method: string) =>
      call.mock.calls.filter((args) => args[0] === method).length,
  };
}

function makeService(rpc: { call: jest.Mock }): PluginCatalogService {
  TestBed.configureTestingModule({
    providers: [
      PluginCatalogService,
      WorkspaceScopeService,
      { provide: ClaudeRpcService, useValue: rpc },
    ],
  });
  return TestBed.inject(PluginCatalogService);
}

/** The scope the service under test is keyed by. Same injector. */
function scopeOf(): WorkspaceScopeService {
  return TestBed.inject(WorkspaceScopeService);
}

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('PluginCatalogService — one read per view', () => {
  it('issues ONE pair for four concurrent ensureLoaded callers', async () => {
    // The widget's ngOnInit, the modal's isOpen effect, the empty state's
    // setup tab and a second transcript's widget, all in the same tick.
    const rpc = makeRpc({ manual: true });
    const service = makeService(rpc);

    const all = Promise.all([
      service.ensureLoaded(),
      service.ensureLoaded(),
      service.ensureLoaded(),
      service.ensureLoaded(),
    ]);
    rpc.release();
    await all;

    expect(rpc.countOf('plugins:get-config')).toBe(1);
    expect(rpc.countOf('plugins:list-available')).toBe(1);
  });

  it('issues nothing at all for a caller that arrives after the read', async () => {
    const rpc = makeRpc();
    const service = makeService(rpc);

    await service.ensureLoaded();
    expect(rpc.call).toHaveBeenCalledTimes(2);

    await service.ensureLoaded();
    await service.ensureLoaded();

    expect(rpc.call).toHaveBeenCalledTimes(2);
  });

  it('exposes the answer to every consumer through signals', async () => {
    const rpc = makeRpc({ enabledPluginIds: ['ptah-core'] });
    const service = makeService(rpc);

    await service.ensureLoaded();

    expect(service.plugins()).toEqual(PLUGINS);
    expect(service.pluginTotal()).toBe(3);
    expect(service.isLoaded()).toBe(true);
    expect(service.isLoading()).toBe(false);
    expect(service.error()).toBeNull();
  });

  it('counts opt-out plugins as enabled unless they are explicitly disabled', async () => {
    // A harness-authored plugin is live without ever appearing in
    // `enabledPluginIds`; counting the array would report 1 instead of 2.
    const rpc = makeRpc({ enabledPluginIds: ['ptah-core'] });
    const service = makeService(rpc);

    await service.ensureLoaded();

    expect(service.enabledCount()).toBe(2);
    expect(service.hasEnabledPlugins()).toBe(true);
  });

  it('drops an opt-out plugin from the count once it is denied', async () => {
    const rpc = makeRpc({
      enabledPluginIds: ['ptah-core'],
      disabledPluginIds: ['ptah-harness-notes'],
    });
    const service = makeService(rpc);

    await service.ensureLoaded();

    expect(service.enabledCount()).toBe(1);
  });

  it('reports loading while a read someone else started is in flight', async () => {
    const rpc = makeRpc({ manual: true });
    const service = makeService(rpc);

    const first = service.ensureLoaded();
    expect(service.isLoading()).toBe(true);
    const second = service.ensureLoaded();
    expect(service.isLoading()).toBe(true);

    rpc.release();
    await Promise.all([first, second]);
    expect(service.isLoading()).toBe(false);
  });
});

describe('PluginCatalogService — refresh', () => {
  it('re-reads on refresh, unlike ensureLoaded', async () => {
    const rpc = makeRpc();
    const service = makeService(rpc);

    await service.ensureLoaded();
    await service.refresh();

    expect(rpc.countOf('plugins:get-config')).toBe(2);
    expect(rpc.countOf('plugins:list-available')).toBe(2);
  });

  it('joins a refresh to a read already in flight', async () => {
    // A widget mounting at the same instant a save completes must not cost two
    // round trips.
    const rpc = makeRpc({ manual: true });
    const service = makeService(rpc);

    const load = service.ensureLoaded();
    const refresh = service.refresh();
    rpc.release();
    await Promise.all([load, refresh]);

    expect(rpc.countOf('plugins:get-config')).toBe(1);
  });
});

describe('PluginCatalogService — failure', () => {
  it('records a failed config read without rejecting the caller', async () => {
    const rpc = makeRpc({ configFails: true });
    const service = makeService(rpc);

    await expect(service.ensureLoaded()).resolves.toBeUndefined();

    expect(service.config()).toBeNull();
    expect(service.error()).toBe('handler exploded');
    expect(service.enabledCount()).toBe(0);
    // The list still landed, so the total is real.
    expect(service.pluginTotal()).toBe(3);
  });

  it('never rejects when the transport throws, and lets a retry through', async () => {
    // Every caller is a lifecycle hook or a view effect; a rejection there is
    // an unhandled rejection in the renderer.
    const rpc = makeRpc({ throws: true });
    const service = makeService(rpc);

    await expect(service.ensureLoaded()).resolves.toBeUndefined();
    expect(service.error()).toBe('transport gone');

    // The Retry button goes through `refresh`, which must not be swallowed by
    // the "already loaded" short circuit.
    await service.refresh();
    expect(rpc.countOf('plugins:get-config')).toBe(2);
  });
});

/**
 * TASK_2026_345, judge round 1 — plugin config is PER WORKSPACE.
 *
 * `plugins:get-config` reads `{ws}/.ptah/plugins`, and Electron keeps tabs
 * bound to several roots alive at once (`TabWorkspacePartitionService`), with
 * `PluginStatusWidgetComponent` mounted per transcript. A session-wide "already
 * loaded" flag therefore showed the FIRST workspace's plugin list for every
 * workspace opened afterwards — indefinitely, because nothing on the switch
 * path invalidated it.
 *
 * The host is modelled the way it actually behaves: `plugins:get-config`
 * carries no workspace parameter and is answered against whichever workspace is
 * active AT PROCESSING TIME. `hostWorkspace` below is that variable.
 */
describe('PluginCatalogService — workspace scope', () => {
  const QA = 'D:/projects/qa3elhamor';
  const HUB = 'D:/projects/property-hub';

  // Rebuilt per test: one case below changes a workspace's plugins WHILE IT IS
  // CLOSED, and a shared object would leak that into whatever ran next.
  let PER_WORKSPACE: Record<string, PluginInfo[]>;
  let ENABLED_PER_WORKSPACE: Record<string, string[]>;

  beforeEach(() => {
    PER_WORKSPACE = {
      [QA]: [plugin('ptah-core', 'bundled')],
      [HUB]: [
        plugin('ptah-core', 'bundled'),
        plugin('ptah-angular', 'bundled'),
        plugin('ptah-nx-saas', 'bundled'),
      ],
    };
    ENABLED_PER_WORKSPACE = {
      [QA]: ['ptah-core'],
      [HUB]: ['ptah-core', 'ptah-angular', 'ptah-nx-saas'],
    };
  });

  interface ScopedRpc {
    call: jest.Mock;
    countOf: (method: string) => number;
    /** Point the HOST at a workspace; the webview scope is switched separately. */
    setHostWorkspace: (path: string) => void;
    /** Hold every reply until `release()`. */
    hold: () => void;
    release: () => void;
  }

  function makeScopedRpc(start: string): ScopedRpc {
    let hostWorkspace = start;
    let holding = false;
    const waiters: Array<() => void> = [];

    const call = jest.fn(async (method: string) => {
      // The host resolves the workspace when it PROCESSES the call, so read it
      // after the gate, not before.
      if (holding) {
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
      const workspace = hostWorkspace;
      if (method === 'plugins:list-available') {
        return rpcSuccess({ plugins: PER_WORKSPACE[workspace] });
      }
      if (method === 'plugins:get-config') {
        return rpcSuccess({
          enabledPluginIds: ENABLED_PER_WORKSPACE[workspace],
          disabledPluginIds: [],
          disabledSkillIds: [],
        });
      }
      throw new Error(`unexpected method: ${method}`);
    });

    return {
      call,
      countOf: (method: string) =>
        call.mock.calls.filter((args) => args[0] === method).length,
      setHostWorkspace: (path: string) => {
        hostWorkspace = path;
      },
      hold: () => {
        holding = true;
      },
      release: () => {
        holding = false;
        for (const resolve of waiters.splice(0, waiters.length)) resolve();
      },
    };
  }

  it('reads the NEW workspace after a switch, and reads nothing on a re-mount', async () => {
    const rpc = makeScopedRpc(QA);
    const service = makeService(rpc);
    const scope = scopeOf();

    scope.switchTo(QA);
    await service.ensureLoaded();
    expect(rpc.countOf('plugins:get-config')).toBe(1);
    expect(rpc.countOf('plugins:list-available')).toBe(1);
    expect(service.pluginTotal()).toBe(1);

    // A second widget mounts on the SAME workspace — the per-transcript case.
    await service.ensureLoaded();
    await service.ensureLoaded();
    expect(rpc.countOf('plugins:get-config')).toBe(1);
    expect(rpc.countOf('plugins:list-available')).toBe(1);

    // The user switches. `WorkspaceCoordinatorService` moves the scope
    // synchronously; the host follows.
    scope.switchTo(HUB);
    rpc.setHostWorkspace(HUB);

    // The widget the new workspace mounts asks the same idempotent question.
    await service.ensureLoaded();

    expect(rpc.countOf('plugins:get-config')).toBe(2);
    expect(rpc.countOf('plugins:list-available')).toBe(2);
    expect(service.pluginTotal()).toBe(3);
    expect(service.enabledCount()).toBe(3);

    // ...and a re-mount on the NEW workspace is free again.
    await service.ensureLoaded();
    expect(rpc.countOf('plugins:get-config')).toBe(2);
  });

  it('stops reporting the previous workspace the moment the scope changes', async () => {
    // The defect as a user saw it: qa3elhamor's 1 plugin still on screen while
    // property-hub is the active workspace. Between the switch and the new read
    // landing the widget must show its loading state, never the old count.
    const rpc = makeScopedRpc(QA);
    const service = makeService(rpc);
    const scope = scopeOf();

    scope.switchTo(QA);
    await service.ensureLoaded();
    expect(service.pluginTotal()).toBe(1);
    expect(service.isLoaded()).toBe(true);

    scope.switchTo(HUB);

    expect(service.isLoaded()).toBe(false);
    expect(service.pluginTotal()).toBe(0);
    expect(service.config()).toBeNull();
    expect(service.enabledCount()).toBe(0);
    expect(service.hasEnabledPlugins()).toBe(false);
  });

  it('does not let a caller on the new workspace join the old workspace request', async () => {
    const rpc = makeScopedRpc(QA);
    const service = makeService(rpc);
    const scope = scopeOf();

    scope.switchTo(QA);
    rpc.hold();
    const stale = service.ensureLoaded();
    expect(rpc.countOf('plugins:get-config')).toBe(1);

    // Switch mid-flight, exactly as the folder listener does.
    scope.switchTo(HUB);
    rpc.setHostWorkspace(HUB);

    const fresh = service.ensureLoaded();
    expect(fresh).not.toBe(stale);
    expect(rpc.countOf('plugins:get-config')).toBe(2);

    rpc.release();
    await Promise.all([stale, fresh]);

    // Both requests are answered by the host as property-hub (it resolves at
    // processing time), and only the one filed under the current scope is
    // published — so the count is property-hub's, once.
    expect(service.pluginTotal()).toBe(3);
    expect(service.isLoaded()).toBe(true);
  });

  it('discards a stale response that lands after the switch', async () => {
    // The in-flight request belongs to a workspace we can no longer name.
    // Publishing it would be the original defect with an extra step.
    const rpc = makeScopedRpc(QA);
    const service = makeService(rpc);
    const scope = scopeOf();

    scope.switchTo(QA);
    rpc.hold();
    const stale = service.ensureLoaded();

    scope.switchTo(HUB);
    rpc.release();
    await stale;

    expect(service.isLoaded()).toBe(false);
    expect(service.pluginTotal()).toBe(0);
  });

  it('re-reads a workspace revisited after a detour, rather than trusting the first visit', async () => {
    // A -> B -> A. The harness reconciler writes into a background workspace,
    // so A's config can have changed while B was on screen.
    const rpc = makeScopedRpc(QA);
    const service = makeService(rpc);
    const scope = scopeOf();

    scope.switchTo(QA);
    await service.ensureLoaded();

    scope.switchTo(HUB);
    rpc.setHostWorkspace(HUB);
    await service.ensureLoaded();

    scope.switchTo(QA);
    rpc.setHostWorkspace(QA);
    await service.ensureLoaded();

    expect(rpc.countOf('plugins:get-config')).toBe(3);
    expect(service.pluginTotal()).toBe(1);
  });

  it('re-reads a workspace closed to zero and then reopened', async () => {
    // TASK_2026_345, judge round 2. `ElectronLayoutService.removeFolder` used
    // to reach zero folders by calling `updateWorkspaceRoot('')` inline, so the
    // scope kept naming the folder that had just closed. Reopening it was then
    // a switch to the "already active" workspace — an early-return — and this
    // cache served its pre-closure snapshot. The folder's `.ptah/plugins` can
    // change while it is closed (harness-sync, another window, `ptah tui`),
    // which is exactly why that snapshot must not be trusted.
    const rpc = makeScopedRpc(QA);
    const service = makeService(rpc);
    const scope = scopeOf();

    scope.switchTo(QA);
    await service.ensureLoaded();
    expect(rpc.countOf('plugins:get-config')).toBe(1);
    expect(service.pluginTotal()).toBe(1);

    // The last folder closes. `WorkspaceCoordinatorService.clearWorkspace()`.
    scope.switchTo(null);
    expect(service.isLoaded()).toBe(false);
    expect(service.pluginTotal()).toBe(0);

    // ...and while it is closed, its plugin config changes.
    PER_WORKSPACE[QA] = [
      plugin('ptah-core', 'bundled'),
      plugin('ptah-nx-saas', 'bundled'),
    ];
    ENABLED_PER_WORKSPACE[QA] = ['ptah-core', 'ptah-nx-saas'];

    // The user reopens the SAME path.
    scope.switchTo(QA);
    await service.ensureLoaded();

    expect(rpc.countOf('plugins:get-config')).toBe(2);
    expect(rpc.countOf('plugins:list-available')).toBe(2);
    expect(service.pluginTotal()).toBe(2);
    expect(service.enabledCount()).toBe(2);
  });
});
