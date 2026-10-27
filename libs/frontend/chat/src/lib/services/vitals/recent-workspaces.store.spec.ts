import { TestBed } from '@angular/core/testing';
import {
  ClaudeRpcService,
  LoggingService,
  RpcResult,
  VSCodeService,
} from '@ptah-extension/core';
import type { RecentWorkspace } from '@ptah-extension/shared';
import { VITALS_RPC_TIMEOUT_MS } from './vitals-load';
import { RecentWorkspacesStore } from './recent-workspaces.store';

const ROW: RecentWorkspace = {
  path: 'D:\\projects\\ptah',
  name: 'ptah',
  lastOpenedAt: 1_700_000_000_000,
};

describe('RecentWorkspacesStore', () => {
  let call: jest.Mock;
  let logger: { error: jest.Mock };

  function setup(isElectron: boolean): RecentWorkspacesStore {
    TestBed.configureTestingModule({
      providers: [
        { provide: ClaudeRpcService, useValue: { call } },
        { provide: LoggingService, useValue: logger },
        { provide: VSCodeService, useValue: { isElectron } },
      ],
    });
    return TestBed.inject(RecentWorkspacesStore);
  }

  beforeEach(() => {
    call = jest.fn(async () => new RpcResult(true, { workspaces: [ROW] }));
    logger = { error: jest.fn() };
  });

  afterEach(() => TestBed.resetTestingModule());

  it('stays loading and calls nothing until load()', () => {
    const store = setup(true);

    expect(store.recents()).toEqual({ status: 'loading' });
    expect(call).not.toHaveBeenCalled();
  });

  it('loads the validated list on Electron with the 10 s timeout', async () => {
    const store = setup(true);
    await store.load();

    expect(call).toHaveBeenCalledWith(
      'workspace:listRecent',
      {},
      { timeout: VITALS_RPC_TIMEOUT_MS },
    );
    expect(store.recents()).toEqual({ status: 'ready', value: [ROW] });
  });

  it('is empty off Electron and never calls the RPC', async () => {
    const store = setup(false);
    await store.load();

    expect(call).not.toHaveBeenCalled();
    expect(store.recents()).toEqual({ status: 'empty' });
  });

  it('is empty when the host remembers no workspace', async () => {
    call.mockResolvedValueOnce(new RpcResult(true, { workspaces: [] }));
    const store = setup(true);
    await store.load();

    expect(store.recents()).toEqual({ status: 'empty' });
  });

  it('treats a result that fails the schema as an error', async () => {
    call.mockResolvedValueOnce(
      new RpcResult(true, { workspaces: [{ ...ROW, extra: true }] }),
    );
    const store = setup(true);
    await store.load();

    expect(store.recents()).toEqual({ status: 'error' });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('treats a failed or rejected call as an error', async () => {
    call
      .mockResolvedValueOnce(new RpcResult(false, undefined, 'boom'))
      .mockRejectedValueOnce(new Error('transport'));
    const store = setup(true);

    await store.load();
    expect(store.recents()).toEqual({ status: 'error' });
    await store.load();
    expect(store.recents()).toEqual({ status: 'error' });
  });

  it('keeps the last list while reloading and when a reload fails', async () => {
    let finish: (reply: RpcResult<{ workspaces: RecentWorkspace[] }>) => void =
      () => undefined;
    const store = setup(true);
    await store.load();

    call.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const reload = store.load();
    expect(store.recents()).toEqual({ status: 'ready', value: [ROW] });
    finish(new RpcResult(false, undefined, 'boom'));
    await reload;

    expect(store.recents()).toEqual({ status: 'ready', value: [ROW] });
  });

  it('joins a load already in flight and rereads on the next load', async () => {
    const store = setup(true);
    await Promise.all([store.load(), store.load()]);
    expect(call).toHaveBeenCalledTimes(1);

    await store.load();
    expect(call).toHaveBeenCalledTimes(2);
  });
});
