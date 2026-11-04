import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService, type RpcResult } from './claude-rpc.service';
import { CodexReadinessService } from './codex-readiness.service';
import { VSCodeService } from './vscode.service';
import { createMockRpcService, rpcError, rpcSuccess, type MockRpcService } from '../../testing';

const READY = {
  binary: { state: 'found', path: '/usr/bin/codex', version: '1.0', source: 'installed' },
  signIn: { outcome: 'signed-in' },
  checkedAt: '2026-11-03T00:00:00Z',
};
const MISSING = {
  binary: { state: 'missing' },
  signIn: { outcome: 'signed-out' },
  checkedAt: '2026-11-03T01:00:00Z',
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function setup(isElectron = true): { rpc: MockRpcService; service: CodexReadinessService } {
  const rpc = createMockRpcService();
  TestBed.configureTestingModule({ providers: [
    { provide: ClaudeRpcService, useValue: rpc },
    { provide: VSCodeService, useValue: { isElectron } },
  ] });
  return { rpc, service: TestBed.inject(CodexReadinessService) };
}

describe('CodexReadinessService', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('is inert outside Electron', async () => {
    const { rpc, service } = setup(false);
    await service.read(true, 'mount');
    expect(rpc.call).not.toHaveBeenCalled();
    expect(service.view()).toEqual({ status: 'inert', result: null, localFailure: false, transportTimeout: false });
  });

  it('starts idle and forwards refresh and trigger with a 25 s timeout', async () => {
    const { rpc, service } = setup();
    expect(service.view().status).toBe('idle');
    expect(rpc.call).not.toHaveBeenCalled();
    rpc.call.mockResolvedValue(rpcSuccess(READY));
    await service.read(true, 'recheck');
    expect(rpc.call).toHaveBeenCalledWith(
      'auth:getCodexReadiness', { refresh: true, trigger: 'recheck' }, { timeout: 25_000 },
    );
    expect(service.view()).toEqual({ status: 'ready', result: READY, localFailure: false, transportTimeout: false });
  });

  it('applies only the latest reply', async () => {
    const { rpc, service } = setup();
    const first = deferred<RpcResult<never>>();
    const second = deferred<RpcResult<never>>();
    rpc.call.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const older = service.read(false);
    const newer = service.read(true);
    first.resolve(rpcSuccess(READY) as RpcResult<never>);
    await older;
    expect(service.view().status).toBe('checking');
    second.resolve(rpcSuccess(MISSING) as RpcResult<never>);
    await newer;
    expect(service.view().result).toEqual(MISSING);
  });

  it.each([
    { ...READY, binary: { ...READY.binary, source: 'untrusted' } },
    { ...READY, binary: { state: 'unknown', reason: 'oops' } },
    { ...READY, binary: { state: 'found', path: 3, version: '1', source: 'installed' } },
    { ...READY, binary: { state: 'found', path: '/bin/codex', version: 2, source: 'installed' } },
    { ...READY, signIn: { outcome: 'invalid' } },
    { ...READY, signIn: { outcome: 'unreadable', unreadable: 'other' } },
    { ...READY, checkedAt: 7 },
  ])('rejects a malformed host reply', async (reply) => {
    const { rpc, service } = setup();
    rpc.call.mockResolvedValue(rpcSuccess(reply));
    await service.read(false);
    expect(service.view()).toEqual({ status: 'ready', result: null, localFailure: true, transportTimeout: false });
  });

  it('copies contract fields and drops unexpected host fields', async () => {
    const { rpc, service } = setup();
    rpc.call.mockResolvedValue(rpcSuccess({
      ...READY, secret: 'omit', binary: { ...READY.binary, extra: 'omit' },
      signIn: { ...READY.signIn, extra: 'omit' },
    }));
    await service.read(false);
    expect(service.view().result).toEqual(READY);
  });

  it('flags RPC timeouts and clears the flag on a later success', async () => {
    const { rpc, service } = setup();
    rpc.call.mockResolvedValueOnce(rpcError('RPC timeout: auth:getCodexReadiness'));
    await service.read(true);
    expect(service.view()).toEqual({ status: 'ready', result: null, localFailure: true, transportTimeout: true });
    rpc.call.mockResolvedValueOnce(rpcSuccess(MISSING));
    await service.read(true);
    expect(service.view()).toEqual({ status: 'ready', result: MISSING, localFailure: false, transportTimeout: false });
  });

  it('handles a rejected transport promise without throwing', async () => {
    const { rpc, service } = setup();
    rpc.call.mockRejectedValueOnce(new Error('closed'));
    await expect(service.read(false)).resolves.toBeUndefined();
    expect(service.view().localFailure).toBe(true);
  });

  it('ignores a reply after destruction', async () => {
    const { rpc, service } = setup();
    const reply = deferred<RpcResult<never>>();
    rpc.call.mockReturnValueOnce(reply.promise);
    const pending = service.read(false);
    TestBed.resetTestingModule();
    reply.resolve(rpcSuccess(READY) as RpcResult<never>);
    await pending;
    expect(service.view().result).toBeNull();
  });
});
