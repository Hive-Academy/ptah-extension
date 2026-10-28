import { TestBed } from '@angular/core/testing';
import type { ProviderAmbientClaudeStatus } from '@ptah-extension/shared';

import {
  ClaudeAmbientStatusService,
  type ClaudeAmbientStatusView,
} from './claude-ambient-status.service';
import { ClaudeRpcService, type RpcResult } from './claude-rpc.service';
import { VSCodeService } from './vscode.service';
import {
  createMockRpcService,
  rpcError,
  rpcSuccess,
  type MockRpcService,
} from '../../testing';

const CONNECTED: ProviderAmbientClaudeStatus = {
  state: 'connected',
  checkedAt: '2026-10-26T10:00:00.000Z',
};
const SIGNED_OUT: ProviderAmbientClaudeStatus = {
  state: 'signed-out',
  checkedAt: '2026-10-26T10:05:00.000Z',
};

const ok = (status: object): RpcResult<never> =>
  rpcSuccess({ ok: true, status }) as RpcResult<never>;
const refused = (code: string): RpcResult<never> =>
  rpcSuccess({
    ok: false,
    result: { code, summary: 'Refused.' },
  }) as RpcResult<never>;

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup(isElectron = true): {
  rpc: MockRpcService;
  service: ClaudeAmbientStatusService;
} {
  const rpc = createMockRpcService();
  TestBed.configureTestingModule({
    providers: [
      { provide: ClaudeRpcService, useValue: rpc },
      { provide: VSCodeService, useValue: { isElectron } },
    ],
  });
  return { rpc, service: TestBed.inject(ClaudeAmbientStatusService) };
}

describe('ClaudeAmbientStatusService', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('stays inert without the providerAccounts host: no RPC', async () => {
    const { rpc, service } = setup(false);
    await service.read(true);
    expect(rpc.call).not.toHaveBeenCalled();
    expect(service.view()).toEqual({
      status: 'inert',
      result: null,
      localFailure: false,
    });
  });

  it('starts idle and makes no call before read()', () => {
    const { rpc, service } = setup();
    expect(service.view().status).toBe('idle');
    expect(rpc.call).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'passes refresh=%s for Claude with a 30 s timeout',
    async (refresh) => {
      const { rpc, service } = setup();
      rpc.call.mockResolvedValue(ok(CONNECTED));
      await service.read(refresh);
      expect(rpc.call).toHaveBeenCalledWith(
        'provider:getAmbientClaudeStatus',
        { provider: 'claude', refresh },
        { timeout: 30_000 },
      );
    },
  );

  it('is checking while the latest request is in flight, then ready with the host value', async () => {
    const { rpc, service } = setup();
    const reply = deferred<RpcResult<never>>();
    rpc.call.mockReturnValueOnce(reply.promise);
    const pending = service.read(false);
    expect(service.view().status).toBe('checking');
    reply.resolve(ok(CONNECTED));
    await pending;
    expect(service.view()).toEqual({
      status: 'ready',
      result: CONNECTED,
      localFailure: false,
    });
  });

  it('marks a refresh after a ready result as checking until it settles', async () => {
    const { rpc, service } = setup();
    rpc.call.mockResolvedValueOnce(ok(CONNECTED));
    await service.read(false);
    const reply = deferred<RpcResult<never>>();
    rpc.call.mockReturnValueOnce(reply.promise);
    const pending = service.read(true);
    expect(service.view().status).toBe('checking');
    reply.resolve(ok(SIGNED_OUT));
    await pending;
    expect(service.view().status).toBe('ready');
    expect(service.view().result).toEqual(SIGNED_OUT);
  });

  it('ignores an older reply that arrives after the latest one', async () => {
    const { rpc, service } = setup();
    const first = deferred<RpcResult<never>>();
    const second = deferred<RpcResult<never>>();
    rpc.call
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const older = service.read(false);
    const newer = service.read(true);
    second.resolve(ok(SIGNED_OUT));
    await newer;
    expect(service.view().result).toEqual(SIGNED_OUT);
    first.resolve(ok(CONNECTED));
    await older;
    expect(service.view()).toEqual({
      status: 'ready',
      result: SIGNED_OUT,
      localFailure: false,
    });
  });

  it('stays checking while the latest request is still pending after an older reply lands', async () => {
    const { rpc, service } = setup();
    const first = deferred<RpcResult<never>>();
    const second = deferred<RpcResult<never>>();
    rpc.call
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const older = service.read(false);
    const newer = service.read(true);
    first.resolve(ok(CONNECTED));
    await older;
    expect(service.view().status).toBe('checking');
    second.resolve(ok(SIGNED_OUT));
    await newer;
    expect(service.view().result).toEqual(SIGNED_OUT);
  });

  it('drops an earlier connected result on a transport failure and carries no checkedAt', async () => {
    const { rpc, service } = setup();
    rpc.call.mockResolvedValueOnce(ok(CONNECTED));
    await service.read(false);
    rpc.call.mockResolvedValueOnce(rpcError('Request timed out'));
    await service.read(true);
    const view: ClaudeAmbientStatusView = service.view();
    expect(view).toEqual({ status: 'ready', result: null, localFailure: true });
    expect(JSON.stringify(view)).not.toContain('checkedAt');
    expect(JSON.stringify(view)).not.toContain('connected');
  });

  it('treats a host refusal as a local failure', async () => {
    const { rpc, service } = setup();
    rpc.call.mockResolvedValueOnce(refused('wrong-provider'));
    await service.read(false);
    expect(service.view()).toEqual({
      status: 'ready',
      result: null,
      localFailure: true,
    });
  });

  it('treats a rejected transport promise as a local failure and does not throw', async () => {
    const { rpc, service } = setup();
    rpc.call.mockRejectedValueOnce(new Error('channel closed'));
    await expect(service.read(false)).resolves.toBeUndefined();
    expect(service.view().localFailure).toBe(true);
    expect(service.view().result).toBeNull();
  });

  it.each([
    ['an unknown state', { state: 'admitted', checkedAt: null }],
    ['a non-string checkedAt', { state: 'connected', checkedAt: 42 }],
    [
      'an unknown reason',
      { state: 'unknown', checkedAt: null, reason: 'mystery' },
    ],
    ['a missing status', undefined],
  ])('rejects a malformed host reply with %s', async (_label, status) => {
    const { rpc, service } = setup();
    rpc.call.mockResolvedValueOnce(
      rpcSuccess({ ok: true, status }) as RpcResult<never>,
    );
    await service.read(false);
    expect(service.view()).toEqual({
      status: 'ready',
      result: null,
      localFailure: true,
    });
  });

  it('keeps only the contract fields of the host reply', async () => {
    const { rpc, service } = setup();
    rpc.call.mockResolvedValueOnce(
      ok({
        state: 'unknown',
        checkedAt: null,
        reason: 'timeout',
        identity: 'should-not-pass',
      }),
    );
    await service.read(false);
    expect(service.view().result).toEqual({
      state: 'unknown',
      checkedAt: null,
      reason: 'timeout',
    });
  });

  it('recovers: a later host reply clears localFailure', async () => {
    const { rpc, service } = setup();
    rpc.call.mockResolvedValueOnce(rpcError('Request timed out'));
    await service.read(true);
    expect(service.view().localFailure).toBe(true);
    rpc.call.mockResolvedValueOnce(ok(CONNECTED));
    await service.read(true);
    expect(service.view()).toEqual({
      status: 'ready',
      result: CONNECTED,
      localFailure: false,
    });
  });

  it('ignores a reply that lands after the injector is destroyed', async () => {
    const { rpc, service } = setup();
    const reply = deferred<RpcResult<never>>();
    rpc.call.mockReturnValueOnce(reply.promise);
    const pending = service.read(false);
    TestBed.resetTestingModule();
    reply.resolve(ok(CONNECTED));
    await pending;
    expect(service.view().result).toBeNull();
    await service.read(false);
    expect(rpc.call).toHaveBeenCalledTimes(1);
  });
});
