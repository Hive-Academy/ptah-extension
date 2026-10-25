import { TestBed } from '@angular/core/testing';
import {
  MESSAGE_TYPES,
  type ProviderAccountState,
  type ProviderAccountSummary,
  type ProviderAccountsSnapshot,
} from '@ptah-extension/shared';

import { ClaudeRpcService, type RpcResult } from './claude-rpc.service';
import { ProviderAccountsStateService } from './provider-accounts-state.service';
import { VSCodeService } from './vscode.service';
import { WorkspaceScopeService } from './workspace-scope.service';
import {
  createMockRpcService,
  rpcError,
  rpcSuccess,
  type MockRpcService,
} from '../../testing';

const WS = 'D:/work/project';
const P1 = 'profile-aaaa1111';
const P2 = 'profile-bbbb2222';

function account(
  profileId: string,
  state: ProviderAccountState = 'not-signed-in',
  revision = 1,
): ProviderAccountSummary {
  return {
    profileId,
    label: `Label ${profileId}`,
    provider: 'claude',
    state,
    owner: 'unknown',
    revision,
    activeRunCount: 0,
  };
}

function snapshot(
  revision: number,
  accounts: ProviderAccountSummary[] = [account(P1)],
  main: ProviderAccountsSnapshot['selections']['main']['selection'] = {
    kind: 'omitted',
  },
  revisions: { main: number; lane: number } = { main: -1, lane: -1 },
): ProviderAccountsSnapshot {
  return {
    provider: 'claude',
    workspaceRoot: WS,
    revision,
    accounts,
    selections: {
      main: { scope: 'main', selection: main, revision: revisions.main },
      lane: {
        scope: 'lane',
        selection: { kind: 'omitted' },
        revision: revisions.lane,
      },
    },
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const ok = (data: object): RpcResult<never> =>
  rpcSuccess({ ok: true, ...data }) as RpcResult<never>;
const refused = (code: string, summary: string): RpcResult<never> =>
  rpcSuccess({ ok: false, result: { code, summary } }) as RpcResult<never>;

function push(
  service: ProviderAccountsStateService,
  snap: ProviderAccountsSnapshot,
  requestId?: string,
): void {
  service.handleMessage({
    type: MESSAGE_TYPES.PROVIDER_ACCOUNTS_CHANGED,
    payload: requestId ? { snapshot: snap, requestId } : { snapshot: snap },
  });
}

function methods(rpc: MockRpcService): string[] {
  return rpc.call.mock.calls.map((call) => String(call[0]));
}

function setup(isElectron = true): {
  rpc: MockRpcService;
  service: ProviderAccountsStateService;
} {
  const rpc = createMockRpcService();
  TestBed.configureTestingModule({
    providers: [
      { provide: ClaudeRpcService, useValue: rpc },
      { provide: VSCodeService, useValue: { isElectron } },
    ],
  });
  TestBed.inject(WorkspaceScopeService).switchTo(WS);
  return { rpc, service: TestBed.inject(ProviderAccountsStateService) };
}

describe('ProviderAccountsStateService', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('stays inert without the providerAccounts host: no RPC, pushes ignored', async () => {
    const { rpc, service } = setup(false);
    await service.open('claude');
    push(service, snapshot(5));
    const outcome = await service.addAccount('claude', 'Work');
    expect(rpc.call).not.toHaveBeenCalled();
    expect(service.state('claude')().status).toBe('inert');
    expect(service.state('claude')().snapshot).toBeNull();
    expect(outcome).toEqual({ status: 'unavailable' });
  });

  it('registers for the accounts push type only', () => {
    const { service } = setup();
    expect(service.handledMessageTypes).toEqual([
      MESSAGE_TYPES.PROVIDER_ACCOUNTS_CHANGED,
    ]);
  });

  it('loads the snapshot for the active workspace on open', async () => {
    const { rpc, service } = setup();
    rpc.call.mockResolvedValue(ok({ snapshot: snapshot(3) }));
    await service.open('claude');
    expect(rpc.call).toHaveBeenCalledWith(
      'provider:listAccounts',
      { provider: 'claude', workspaceRoot: WS },
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(service.state('claude')()).toEqual({
      status: 'ready',
      snapshot: snapshot(3),
      stale: false,
      error: null,
    });
  });

  it('ignores older, duplicate, foreign-workspace and malformed pushes', async () => {
    const { rpc, service } = setup();
    rpc.call.mockResolvedValue(ok({ snapshot: snapshot(5) }));
    await service.open('claude');
    push(service, snapshot(4, [account(P2)]));
    push(service, snapshot(5, [account(P2)]));
    push(service, { ...snapshot(9, [account(P2)]), workspaceRoot: 'D:/other' });
    service.handleMessage({
      type: MESSAGE_TYPES.PROVIDER_ACCOUNTS_CHANGED,
      payload: { snapshot: { revision: 10 } },
    });
    expect(service.state('claude')().snapshot).toEqual(snapshot(5));
    push(service, snapshot(6, [account(P2)]));
    expect(service.state('claude')().snapshot?.accounts[0].profileId).toBe(P2);
  });

  it('keeps the newest snapshot when read responses arrive out of order', async () => {
    const { rpc, service } = setup();
    const first = deferred<RpcResult<never>>();
    const second = deferred<RpcResult<never>>();
    rpc.call
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const a = service.refresh('claude');
    const b = service.refresh('claude');
    second.resolve(ok({ snapshot: snapshot(7) }));
    await b;
    first.resolve(ok({ snapshot: snapshot(3, []) }));
    await a;
    expect(service.state('claude')().snapshot?.revision).toBe(7);
    expect(service.state('claude')().status).toBe('ready');
  });

  it('keeps a stale snapshot on a failed read and recovers on retry', async () => {
    const { rpc, service } = setup();
    rpc.call.mockResolvedValueOnce(ok({ snapshot: snapshot(2) }));
    await service.open('claude');
    rpc.call.mockResolvedValueOnce(rpcError('RPC timeout') as RpcResult<never>);
    await service.refresh('claude');
    expect(service.state('claude')()).toEqual({
      status: 'error',
      snapshot: snapshot(2),
      stale: true,
      error: 'Could not load accounts. Retry.',
    });
    rpc.call.mockResolvedValueOnce(ok({ snapshot: snapshot(4) }));
    await service.refresh('claude');
    expect(service.state('claude')().status).toBe('ready');
    expect(service.state('claude')().stale).toBe(false);
  });

  it('accepts a lower revision only from the reconnect re-read', async () => {
    const { rpc, service } = setup();
    rpc.call.mockResolvedValueOnce(ok({ snapshot: snapshot(50) }));
    await service.open('claude');
    rpc.call.mockResolvedValueOnce(ok({ snapshot: snapshot(2, []) }));
    await service.refresh('claude');
    expect(service.state('claude')().snapshot?.revision).toBe(50);
    rpc.call.mockResolvedValueOnce(ok({ snapshot: snapshot(2, []) }));
    await service.reconnect('claude');
    expect(service.state('claude')().snapshot?.revision).toBe(2);
    push(service, snapshot(1));
    expect(service.state('claude')().snapshot?.revision).toBe(2);
  });

  it('adds by label only and settles once when push and response both arrive', async () => {
    const { rpc, service } = setup();
    rpc.call.mockResolvedValueOnce(ok({ snapshot: snapshot(1, []) }));
    await service.open('claude');
    const response = deferred<RpcResult<never>>();
    rpc.call.mockReturnValueOnce(response.promise);
    const pending = service.addAccount('claude', 'Work');
    const [, params] = rpc.call.mock.calls[1];
    expect(params).toEqual({
      provider: 'claude',
      workspaceRoot: WS,
      requestId: expect.stringMatching(/^[0-9a-f]{32}$/),
      label: 'Work',
    });
    const requestId = (params as { requestId: string }).requestId;
    expect(service.actions()[requestId].status).toBe('pending');
    push(service, snapshot(2), requestId);
    expect(service.actions()[requestId].status).toBe('saved');
    response.resolve(ok({ snapshot: snapshot(2), account: account(P1) }));
    await expect(pending).resolves.toEqual({
      status: 'saved',
      snapshot: snapshot(2),
    });
    expect(Object.keys(service.actions())).toHaveLength(1);
    expect(service.state('claude')().snapshot?.revision).toBe(2);
    // Add never selects the new profile.
    expect(service.state('claude')().snapshot?.selections.main.selection).toEqual(
      { kind: 'omitted' },
    );
  });

  it('never shows signed-in optimistically and cancels by the host operation id', async () => {
    const { rpc, service } = setup();
    rpc.call.mockResolvedValueOnce(ok({ snapshot: snapshot(1) }));
    await service.open('claude');
    const response = deferred<RpcResult<never>>();
    rpc.call.mockReturnValueOnce(response.promise);
    const started = service.startSignIn('claude', P1);
    expect(rpc.call.mock.calls[1][1]).toEqual(
      expect.objectContaining({ profileId: P1, expectedRevision: 1 }),
    );
    expect(service.state('claude')().snapshot?.accounts[0].state).toBe(
      'not-signed-in',
    );
    const operation = { operationId: 'op-12345678', kind: 'sign-in' };
    response.resolve(
      ok({ snapshot: snapshot(2, [account(P1, 'pending', 2)]), operation }),
    );
    await started;
    expect(service.state('claude')().snapshot?.accounts[0].state).toBe('pending');
    expect(service.operations('claude')()[P1]).toEqual(operation);

    rpc.call.mockResolvedValueOnce(
      ok({ snapshot: snapshot(3, [account(P1, 'cancelled', 3)]) }),
    );
    await service.cancelSignIn('claude', P1);
    expect(rpc.call.mock.calls[2]).toEqual([
      'provider:cancelAccountSignIn',
      expect.objectContaining({ profileId: P1, operationId: 'op-12345678' }),
      expect.anything(),
    ]);
    expect(service.state('claude')().snapshot?.accounts[0].state).toBe(
      'cancelled',
    );
    expect(service.operations('claude')()[P1]).toBeUndefined();
  });

  it('covers rename, sign-out and status reads through the RPC boundary', async () => {
    const { rpc, service } = setup();
    rpc.call.mockResolvedValueOnce(ok({ snapshot: snapshot(1) }));
    await service.open('claude');
    rpc.call.mockResolvedValueOnce(
      ok({ snapshot: snapshot(2, [account(P1, 'not-signed-in', 2)]), account: account(P1) }),
    );
    await service.renameAccount('claude', P1, 'Personal');
    expect(rpc.call.mock.calls[1][1]).toEqual(
      expect.objectContaining({ label: 'Personal', expectedRevision: 1 }),
    );
    rpc.call.mockResolvedValueOnce(
      ok({
        snapshot: snapshot(3, [account(P1, 'signed-out', 3)]),
        operation: { operationId: 'op-87654321', kind: 'sign-out' },
      }),
    );
    await service.signOut('claude', P1);
    expect(service.operations('claude')()[P1]).toBeUndefined();
    rpc.call.mockResolvedValueOnce(
      ok({
        account: account(P1, 'pending', 4),
        operation: { operationId: 'op-11112222', kind: 'sign-in' },
      }),
    );
    await service.refreshAccountStatus('claude', P1);
    expect(service.operations('claude')()[P1]?.operationId).toBe('op-11112222');
    // The status summary is not merged into the atomic snapshot.
    expect(service.state('claude')().snapshot?.revision).toBe(3);
    expect(methods(rpc)).toEqual([
      'provider:listAccounts',
      'provider:renameAccount',
      'provider:signOutAccount',
      'provider:getAccountStatus',
    ]);
  });

  it('marks a host timeout and a transport failure unconfirmed and re-reads', async () => {
    const { rpc, service } = setup();
    rpc.call.mockResolvedValueOnce(ok({ snapshot: snapshot(1) }));
    await service.open('claude');
    rpc.call
      .mockResolvedValueOnce(refused('timeout', 'The action timed out.'))
      .mockResolvedValueOnce(ok({ snapshot: snapshot(2) }));
    await expect(service.removeAccount('claude', P1)).resolves.toEqual({
      status: 'unconfirmed',
    });
    await Promise.resolve();
    rpc.call
      .mockResolvedValueOnce(rpcError('RPC timeout') as RpcResult<never>)
      .mockResolvedValueOnce(ok({ snapshot: snapshot(3) }));
    await expect(service.renameAccount('claude', P1, 'X')).resolves.toEqual({
      status: 'unconfirmed',
    });
    await Promise.resolve();
    expect(methods(rpc)).toEqual([
      'provider:listAccounts',
      'provider:removeAccount',
      'provider:listAccounts',
      'provider:renameAccount',
      'provider:listAccounts',
    ]);
    const statuses = Object.values(service.actions()).map((a) => a.status);
    expect(statuses).toEqual(['unconfirmed', 'unconfirmed']);
  });

  it('reports a refusal with safe copy and leaves the snapshot unchanged', async () => {
    const { rpc, service } = setup();
    rpc.call.mockResolvedValueOnce(ok({ snapshot: snapshot(1) }));
    await service.open('claude');
    rpc.call.mockResolvedValueOnce(refused('conflict', 'Refresh and try again.'));
    const outcome = await service.removeAccount('claude', P1);
    expect(outcome).toEqual({
      status: 'failed',
      result: { code: 'conflict', summary: 'Refresh and try again.' },
    });
    rpc.call.mockResolvedValueOnce(refused('busy', 'C:\\Users\\me failed'));
    const unsafe = await service.signOut('claude', P1);
    expect(unsafe).toEqual({
      status: 'failed',
      result: {
        code: 'busy',
        summary: 'This action did not complete. Refresh and try again.',
      },
    });
    expect(service.state('claude')().snapshot).toEqual(snapshot(1));
  });

  it('writes main and lane independently and default against one snapshot', async () => {
    const { rpc, service } = setup();
    rpc.call.mockResolvedValueOnce(
      ok({
        snapshot: snapshot(4, [account(P1, 'signed-in', 6)], { kind: 'omitted' }, {
          main: 2,
          lane: 9,
        }),
      }),
    );
    await service.open('claude');
    rpc.call.mockResolvedValue(refused('conflict', 'Refresh and try again.'));
    await service.setSelection('claude', 'lane', { kind: 'named', profileId: P1 });
    await service.setSelection('claude', 'main', { kind: 'ambient' });
    await service.setDefault('claude', { kind: 'named', profileId: P1 });
    expect(rpc.call.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        scope: 'lane',
        selection: { kind: 'named', profileId: P1, expectedProfileRevision: 6 },
        expectedSelectionRevision: 9,
      }),
    );
    expect(rpc.call.mock.calls[2][1]).toEqual(
      expect.objectContaining({
        scope: 'main',
        selection: { kind: 'ambient' },
        expectedSelectionRevision: 2,
      }),
    );
    expect(rpc.call.mock.calls[3]).toEqual([
      'provider:setAccountDefault',
      expect.objectContaining({
        expectedSelectionRevisions: { main: 2, lane: 9 },
      }),
      expect.anything(),
    ]);
    await expect(
      service.setSelection('claude', 'main', { kind: 'named', profileId: P2 }),
    ).resolves.toEqual({ status: 'unavailable' });
    expect(rpc.call).toHaveBeenCalledTimes(4);
  });

  it('clears a removed selected profile only from the committed snapshot', async () => {
    const { rpc, service } = setup();
    const selected = { kind: 'named' as const, profileId: P1 };
    rpc.call.mockResolvedValueOnce(
      ok({ snapshot: snapshot(1, [account(P1)], selected, { main: 0, lane: -1 }) }),
    );
    await service.open('claude');
    const main = () => service.state('claude')().snapshot?.selections.main;

    rpc.call.mockResolvedValueOnce(refused('busy', 'The account is busy.'));
    await service.removeAccount('claude', P1);
    expect(main()?.selection).toEqual(selected);

    const response = deferred<RpcResult<never>>();
    rpc.call.mockReturnValueOnce(response.promise);
    const removing = service.removeAccount('claude', P1);
    expect(main()?.selection).toEqual(selected);
    response.resolve(
      ok({ snapshot: snapshot(2, [], { kind: 'ambient' }, { main: 1, lane: -1 }) }),
    );
    await removing;
    expect(main()).toEqual({
      scope: 'main',
      selection: { kind: 'ambient' },
      revision: 1,
    });
  });

  it('disposes: no push or late response is applied after destroy', async () => {
    const { rpc, service } = setup();
    rpc.call.mockResolvedValueOnce(ok({ snapshot: snapshot(1) }));
    await service.open('claude');
    const view = service.state('claude');
    const late = deferred<RpcResult<never>>();
    rpc.call.mockReturnValueOnce(late.promise);
    const reading = service.refresh('claude');
    TestBed.resetTestingModule();
    late.resolve(ok({ snapshot: snapshot(8) }));
    await reading;
    push(service, snapshot(9));
    expect(view().snapshot?.revision).toBe(1);
    await service.open('claude');
    expect(rpc.call).toHaveBeenCalledTimes(2);
  });
});
