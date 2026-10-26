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

  it('keeps a sign-in fallback script only while that sign-in is pending', async () => {
    const { rpc, service } = setup();
    rpc.call.mockResolvedValueOnce(ok({ snapshot: snapshot(1, [account(P1), account(P2)]) }));
    await service.open('claude');
    const fallback = { platform: 'win32', script: '& claude /login' };
    rpc.call.mockResolvedValueOnce(
      ok({
        snapshot: snapshot(2, [account(P1, 'pending', 2), account(P2)]),
        operation: { operationId: 'op-12345678', kind: 'sign-in' },
        fallback,
      }),
    );
    await service.startSignIn('claude', P1);
    expect(service.fallbacks('claude')()).toEqual({ [P1]: fallback });

    // Malformed scripts are dropped, like a malformed operation handle.
    for (const bad of [
      { platform: 'darwin', script: 'claude /login' },
      { platform: 'posix', script: '   ' },
      { platform: 'posix', script: 42 },
      'claude /login',
    ]) {
      rpc.call.mockResolvedValueOnce(
        ok({
          snapshot: snapshot(3, [account(P1, 'pending', 2), account(P2, 'pending', 3)]),
          operation: { operationId: 'op-22223333', kind: 'sign-in' },
          fallback: bad,
        }),
      );
      await service.startSignIn('claude', P2);
      expect(service.fallbacks('claude')()[P2]).toBeUndefined();
    }

    // A status read with no running operation drops the script; one still running keeps it.
    rpc.call.mockResolvedValueOnce(
      ok({
        account: account(P1, 'pending', 2),
        operation: { operationId: 'op-12345678', kind: 'sign-in' },
      }),
    );
    await service.refreshAccountStatus('claude', P1);
    expect(service.fallbacks('claude')()[P1]).toEqual(fallback);

    // A snapshot where the profile is no longer pending drops it.
    push(service, snapshot(4, [account(P1, 'signed-in', 4), account(P2)]));
    expect(service.fallbacks('claude')()).toEqual({});
  });

  it('a status read without an operation drops the fallback script', async () => {
    const { rpc, service } = setup();
    rpc.call.mockResolvedValueOnce(ok({ snapshot: snapshot(1) }));
    await service.open('claude');
    rpc.call.mockResolvedValueOnce(
      ok({
        snapshot: snapshot(2, [account(P1, 'pending', 2)]),
        operation: { operationId: 'op-12345678', kind: 'sign-in' },
        fallback: { platform: 'posix', script: 'claude /login' },
      }),
    );
    await service.startSignIn('claude', P1);
    expect(service.fallbacks('claude')()[P1]?.platform).toBe('posix');
    rpc.call.mockResolvedValueOnce(ok({ account: account(P1, 'failed', 3) }));
    await service.refreshAccountStatus('claude', P1);
    expect(service.fallbacks('claude')()[P1]).toBeUndefined();
  });

  describe('deferred sign-in replies (response-only handle and script)', () => {
    const OLD_OP = { operationId: 'op-old11111', kind: 'sign-in' } as const;
    const NEW_OP = { operationId: 'op-new22222', kind: 'sign-in' } as const;
    const OLD_SCRIPT = { platform: 'posix', script: 'old-login-script' } as const;
    const NEW_SCRIPT = { platform: 'win32', script: 'new-login-script' } as const;

    async function openWithIdle(): Promise<{
      rpc: MockRpcService;
      service: ProviderAccountsStateService;
    }> {
      const ctx = setup();
      ctx.rpc.call.mockResolvedValueOnce(ok({ snapshot: snapshot(1) }));
      await ctx.service.open('claude');
      return ctx;
    }

    it('keeps the script when the same pending snapshot arrived first by push', async () => {
      const { rpc, service } = await openWithIdle();
      const reply = deferred<RpcResult<never>>();
      rpc.call.mockReturnValueOnce(reply.promise);
      const started = service.startSignIn('claude', P1);
      const pendingSnap = snapshot(2, [account(P1, 'pending', 2)]);
      push(service, pendingSnap);
      reply.resolve(ok({ snapshot: pendingSnap, operation: OLD_OP, fallback: OLD_SCRIPT }));
      await expect(started).resolves.toEqual({ status: 'saved', snapshot: pendingSnap });
      expect(service.operations('claude')()).toEqual({ [P1]: OLD_OP });
      expect(service.fallbacks('claude')()).toEqual({ [P1]: OLD_SCRIPT });
    });

    it('a newer terminal push before the older reply restores neither handle nor script', async () => {
      const { rpc, service } = await openWithIdle();
      const reply = deferred<RpcResult<never>>();
      rpc.call.mockReturnValueOnce(reply.promise);
      const started = service.startSignIn('claude', P1);
      push(service, snapshot(3, [account(P1, 'cancelled', 3)]));
      reply.resolve(
        ok({
          snapshot: snapshot(2, [account(P1, 'pending', 2)]),
          operation: OLD_OP,
          fallback: OLD_SCRIPT,
        }),
      );
      await started;
      expect(service.state('claude')().snapshot?.revision).toBe(3);
      expect(service.operations('claude')()).toEqual({});
      expect(service.fallbacks('claude')()).toEqual({});

      // A later attempt that becomes pending never shows the old script or handle.
      push(service, snapshot(4, [account(P1, 'pending', 4)]));
      expect(service.operations('claude')()).toEqual({});
      expect(service.fallbacks('claude')()).toEqual({});
    });

    it('a removal push after the reply clears the handle and script', async () => {
      const { rpc, service } = await openWithIdle();
      const pendingSnap = snapshot(2, [account(P1, 'pending', 2)]);
      rpc.call.mockResolvedValueOnce(
        ok({ snapshot: pendingSnap, operation: OLD_OP, fallback: OLD_SCRIPT }),
      );
      await service.startSignIn('claude', P1);
      push(service, snapshot(3, [], { kind: 'omitted' }));
      expect(service.operations('claude')()).toEqual({});
      expect(service.fallbacks('claude')()).toEqual({});
    });

    it('a newer sign-in attempt before the older reply wins handle and script', async () => {
      const { rpc, service } = await openWithIdle();
      const older = deferred<RpcResult<never>>();
      const newer = deferred<RpcResult<never>>();
      rpc.call.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
      const first = service.startSignIn('claude', P1);
      const second = service.startSignIn('claude', P1);
      newer.resolve(
        ok({
          snapshot: snapshot(3, [account(P1, 'pending', 3)]),
          operation: NEW_OP,
          fallback: NEW_SCRIPT,
        }),
      );
      await second;
      older.resolve(
        ok({
          snapshot: snapshot(2, [account(P1, 'pending', 2)]),
          operation: OLD_OP,
          fallback: OLD_SCRIPT,
        }),
      );
      await first;
      expect(service.operations('claude')()).toEqual({ [P1]: NEW_OP });
      expect(service.fallbacks('claude')()).toEqual({ [P1]: NEW_SCRIPT });
    });

    it('a newer sign-in attempt wins even when the older reply carries the same revision', async () => {
      const { rpc, service } = await openWithIdle();
      const older = deferred<RpcResult<never>>();
      const newer = deferred<RpcResult<never>>();
      rpc.call.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
      const first = service.startSignIn('claude', P1);
      const second = service.startSignIn('claude', P1);
      const pendingSnap = snapshot(3, [account(P1, 'pending', 3)]);
      newer.resolve(ok({ snapshot: pendingSnap, operation: NEW_OP, fallback: NEW_SCRIPT }));
      await second;
      older.resolve(ok({ snapshot: pendingSnap, operation: OLD_OP, fallback: OLD_SCRIPT }));
      await first;
      expect(service.operations('claude')()).toEqual({ [P1]: NEW_OP });
      expect(service.fallbacks('claude')()).toEqual({ [P1]: NEW_SCRIPT });
    });

    it('a workspace reset before the older reply restores nothing', async () => {
      const { rpc, service } = await openWithIdle();
      const reply = deferred<RpcResult<never>>();
      rpc.call.mockReturnValueOnce(reply.promise);
      const started = service.startSignIn('claude', P1);
      // Away and back: the slot resets and re-reads the same workspace.
      const pendingSnap = snapshot(2, [account(P1, 'pending', 2)]);
      rpc.call.mockResolvedValueOnce(ok({ snapshot: pendingSnap }));
      const scope = TestBed.inject(WorkspaceScopeService);
      scope.switchTo('D:/work/other');
      scope.switchTo(WS);
      TestBed.tick();
      await Promise.resolve();
      await Promise.resolve();
      expect(methods(rpc)).toEqual([
        'provider:listAccounts',
        'provider:startAccountSignIn',
        'provider:listAccounts',
      ]);
      expect(service.state('claude')().snapshot).toEqual(pendingSnap);
      reply.resolve(ok({ snapshot: pendingSnap, operation: OLD_OP, fallback: OLD_SCRIPT }));
      await started;
      expect(service.operations('claude')()).toEqual({});
      expect(service.fallbacks('claude')()).toEqual({});
    });

    const refusedContenders = (
      [
        ['sign-in', 'busy'],
        ['sign-in', 'conflict'],
        ['sign-out', 'busy'],
        ['sign-out', 'conflict'],
      ] as const
    ).flatMap(([kind, code]) =>
      (['before', 'after'] as const).map((order) => [kind, code, order] as const),
    );

    it.each(refusedContenders)(
      'a refused %s contender (%s) keeps the pending sign-in when its reply lands %s the refusal',
      async (kind, code, order) => {
        const { rpc, service } = await openWithIdle();
        const signIn = deferred<RpcResult<never>>();
        const contender = deferred<RpcResult<never>>();
        rpc.call
          .mockReturnValueOnce(signIn.promise)
          .mockReturnValueOnce(contender.promise);
        const first = service.startSignIn('claude', P1);
        const second =
          kind === 'sign-in'
            ? service.startSignIn('claude', P1)
            : service.signOut('claude', P1);
        const pendingSnap = snapshot(2, [account(P1, 'pending', 2)]);
        const replySignIn = async (): Promise<void> => {
          signIn.resolve(
            ok({ snapshot: pendingSnap, operation: OLD_OP, fallback: OLD_SCRIPT }),
          );
          await expect(first).resolves.toEqual({ status: 'saved', snapshot: pendingSnap });
        };
        const refuseContender = async (): Promise<void> => {
          contender.resolve(refused(code, 'Another account action is running.'));
          await expect(second).resolves.toMatchObject({ status: 'failed' });
        };
        if (order === 'before') {
          await replySignIn();
          await refuseContender();
        } else {
          await refuseContender();
          await replySignIn();
        }
        expect(service.operations('claude')()).toEqual({ [P1]: OLD_OP });
        expect(service.fallbacks('claude')()).toEqual({ [P1]: OLD_SCRIPT });

        // The kept handle is the one Cancel sends.
        rpc.call.mockResolvedValueOnce(
          ok({ snapshot: snapshot(3, [account(P1, 'cancelled', 3)]) }),
        );
        await service.cancelSignIn('claude', P1);
        expect(rpc.call.mock.calls[3][1]).toEqual(
          expect.objectContaining({ operationId: OLD_OP.operationId }),
        );
      },
    );

    it('a status read that lands before the sign-in reply for the same operation keeps the script', async () => {
      const { rpc, service } = await openWithIdle();
      const signIn = deferred<RpcResult<never>>();
      const status = deferred<RpcResult<never>>();
      rpc.call.mockReturnValueOnce(signIn.promise).mockReturnValueOnce(status.promise);
      const started = service.startSignIn('claude', P1);
      const read = service.refreshAccountStatus('claude', P1);
      status.resolve(ok({ account: account(P1, 'pending', 2), operation: OLD_OP }));
      await read;
      const pendingSnap = snapshot(2, [account(P1, 'pending', 2)]);
      signIn.resolve(ok({ snapshot: pendingSnap, operation: OLD_OP, fallback: OLD_SCRIPT }));
      await started;
      expect(service.operations('claude')()).toEqual({ [P1]: OLD_OP });
      expect(service.fallbacks('claude')()).toEqual({ [P1]: OLD_SCRIPT });
    });
  });

  describe('deferred status reads (response-only handle)', () => {
    const OLD_OP = { operationId: 'op-old11111', kind: 'sign-in' } as const;
    const NEW_OP = { operationId: 'op-new22222', kind: 'sign-in' } as const;
    const NEW_SCRIPT = { platform: 'win32', script: 'new-login-script' } as const;

    async function openWithIdle(): Promise<{
      rpc: MockRpcService;
      service: ProviderAccountsStateService;
    }> {
      const ctx = setup();
      ctx.rpc.call.mockResolvedValueOnce(ok({ snapshot: snapshot(1) }));
      await ctx.service.open('claude');
      return ctx;
    }

    it('a status reply after a workspace reset and a terminal snapshot installs no operation', async () => {
      const { rpc, service } = await openWithIdle();
      const status = deferred<RpcResult<never>>();
      rpc.call.mockReturnValueOnce(status.promise);
      const read = service.refreshAccountStatus('claude', P1);
      rpc.call.mockResolvedValueOnce(
        ok({ snapshot: snapshot(2, [account(P1, 'pending', 2)]) }),
      );
      const scope = TestBed.inject(WorkspaceScopeService);
      scope.switchTo('D:/work/other');
      scope.switchTo(WS);
      TestBed.tick();
      await Promise.resolve();
      await Promise.resolve();
      expect(methods(rpc)).toEqual([
        'provider:listAccounts',
        'provider:getAccountStatus',
        'provider:listAccounts',
      ]);
      push(service, snapshot(3, [account(P1, 'cancelled', 3)]));
      status.resolve(ok({ account: account(P1, 'pending', 2), operation: OLD_OP }));
      await read;
      expect(service.operations('claude')()).toEqual({});

      // A later attempt that becomes pending never exposes the stale handle.
      push(service, snapshot(4, [account(P1, 'pending', 4)]));
      expect(service.operations('claude')()).toEqual({});
    });

    it('a status reply that crossed a terminal snapshot installs no operation', async () => {
      const { rpc, service } = await openWithIdle();
      const status = deferred<RpcResult<never>>();
      rpc.call.mockReturnValueOnce(status.promise);
      const read = service.refreshAccountStatus('claude', P1);
      push(service, snapshot(2, [account(P1, 'cancelled', 2)]));
      status.resolve(ok({ account: account(P1, 'pending', 1), operation: OLD_OP }));
      await read;
      expect(service.operations('claude')()).toEqual({});
    });

    it('an older status reply without an operation keeps a newer sign-in handle and script', async () => {
      const { rpc, service } = await openWithIdle();
      const status = deferred<RpcResult<never>>();
      rpc.call.mockReturnValueOnce(status.promise);
      const read = service.refreshAccountStatus('claude', P1);
      rpc.call.mockResolvedValueOnce(
        ok({
          snapshot: snapshot(2, [account(P1, 'pending', 2)]),
          operation: NEW_OP,
          fallback: NEW_SCRIPT,
        }),
      );
      await service.startSignIn('claude', P1);
      status.resolve(ok({ account: account(P1) }));
      await read;
      expect(service.operations('claude')()).toEqual({ [P1]: NEW_OP });
      expect(service.fallbacks('claude')()).toEqual({ [P1]: NEW_SCRIPT });
    });

    it('a newer status read wins over an older one, for insertion and deletion', async () => {
      const { rpc, service } = await openWithIdle();
      const older = deferred<RpcResult<never>>();
      const newer = deferred<RpcResult<never>>();
      rpc.call.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
      const first = service.refreshAccountStatus('claude', P1);
      const second = service.refreshAccountStatus('claude', P1);
      newer.resolve(ok({ account: account(P1, 'pending', 2), operation: NEW_OP }));
      await second;
      older.resolve(ok({ account: account(P1, 'pending', 1), operation: OLD_OP }));
      await first;
      expect(service.operations('claude')()).toEqual({ [P1]: NEW_OP });

      // A newer read that found no operation is not undone by an older one that did.
      const olderAgain = deferred<RpcResult<never>>();
      const newerAgain = deferred<RpcResult<never>>();
      rpc.call
        .mockReturnValueOnce(olderAgain.promise)
        .mockReturnValueOnce(newerAgain.promise);
      const third = service.refreshAccountStatus('claude', P1);
      const fourth = service.refreshAccountStatus('claude', P1);
      newerAgain.resolve(ok({ account: account(P1, 'not-signed-in', 3) }));
      await fourth;
      olderAgain.resolve(ok({ account: account(P1, 'pending', 2), operation: OLD_OP }));
      await third;
      expect(service.operations('claude')()).toEqual({});
    });
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
