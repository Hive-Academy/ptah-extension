import { TestBed } from '@angular/core/testing';
import { MESSAGE_TYPES, type CodexLoginState } from '@ptah-extension/shared';
import { createMockRpcService, rpcSuccess } from '../../testing';
import { AuthStateService } from './auth-state.service';
import { ClaudeRpcService, type RpcResult } from './claude-rpc.service';
import { CodexSignInService } from './codex-sign-in.service';
import { VSCodeService } from './vscode.service';

const running: CodexLoginState = { attemptId: 'one', mode: 'browser', status: 'running' };
const cancelled: CodexLoginState = { ...running, status: 'cancelled' };

function setup(isElectron = true) {
  const rpc = createMockRpcService();
  const auth = { refreshAuthStatus: jest.fn().mockResolvedValue(true) };
  TestBed.configureTestingModule({ providers: [
    { provide: ClaudeRpcService, useValue: rpc },
    { provide: VSCodeService, useValue: { isElectron } },
    { provide: AuthStateService, useValue: auth },
  ] });
  return { rpc, auth, service: TestBed.inject(CodexSignInService) };
}

describe('CodexSignInService', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { TestBed.resetTestingModule(); jest.useRealTimers(); });

  it('keeps cancelled from a failed start response as information state', async () => {
    const { rpc, service } = setup();
    rpc.call.mockResolvedValue(rpcSuccess({ success: false, state: cancelled }));
    await service.start();
    expect(service.state()).toEqual(cancelled);
    expect(rpc.call).toHaveBeenCalledWith('auth:codexLogin', { mode: 'browser', restart: false }, { timeout: 15_000 });
  });

  it('keeps a push cancelled against a late running response', async () => {
    const { rpc, service } = setup();
    let resolve!: (value: RpcResult<never>) => void;
    rpc.call.mockReturnValue(new Promise<RpcResult<never>>((r) => { resolve = r; }));
    const pending = service.start();
    service.handleMessage({ type: MESSAGE_TYPES.AUTH_CODEX_LOGIN_STATUS, payload: cancelled });
    resolve(rpcSuccess({ success: true, state: running }) as RpcResult<never>);
    await pending;
    expect(service.state()).toEqual(cancelled);
  });

  it('ends cancelled when the push follows a running response', async () => {
    const { rpc, service } = setup();
    rpc.call.mockResolvedValue(rpcSuccess({ success: true, state: running }));
    await service.start();
    service.handleMessage({ type: MESSAGE_TYPES.AUTH_CODEX_LOGIN_STATUS, payload: cancelled });
    expect(service.state()).toEqual(cancelled);
    expect(service.nothingSeen()).toBe(false);
    jest.advanceTimersByTime(20_000);
    expect(service.nothingSeen()).toBe(false);
  });

  it('maps a no-state failed response to local failed', async () => {
    const { rpc, service } = setup();
    rpc.call.mockResolvedValue(rpcSuccess({ success: false }));
    await service.start();
    expect(service.state()?.status).toBe('failed');
    expect(service.state()?.errorCode).toBeUndefined();
  });

  it('sets the one nothing-seen timer and releases it on destruction', async () => {
    const { rpc, service } = setup();
    rpc.call.mockResolvedValue(rpcSuccess({ success: true, state: running }));
    await service.start();
    jest.advanceTimersByTime(20_000);
    expect(service.nothingSeen()).toBe(true);
    TestBed.resetTestingModule();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('refreshes auth after success, cancels through RPC, and is inert outside Electron', async () => {
    const { rpc, auth, service } = setup();
    service.handleMessage({ type: MESSAGE_TYPES.AUTH_CODEX_LOGIN_STATUS, payload: { ...running, status: 'succeeded' } });
    expect(auth.refreshAuthStatus).toHaveBeenCalledTimes(1);
    rpc.call.mockResolvedValue(rpcSuccess({ cancelled: true }));
    await service.cancel();
    expect(rpc.call).toHaveBeenCalledWith('auth:codexLoginCancel', {}, { timeout: 15_000 });
    TestBed.resetTestingModule();
    const outside = setup(false);
    await outside.service.start();
    await outside.service.cancel();
    expect(outside.rpc.call).not.toHaveBeenCalled();
  });

  it('exposes a failed confirmation and retries the auth read', async () => {
    const { service, auth } = setup();
    auth.refreshAuthStatus.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    service.handleMessage({ type: MESSAGE_TYPES.AUTH_CODEX_LOGIN_STATUS, payload: { ...running, status: 'succeeded' } });
    await Promise.resolve();
    expect(service.refreshFailed()).toBe(true);
    expect(service.confirmation()).toBe('failed');
    await service.checkAuthStatus();
    expect(service.refreshFailed()).toBe(false);
    expect(service.confirmation()).toBe('confirmed');
    expect(auth.refreshAuthStatus).toHaveBeenCalledTimes(2);
  });
});
