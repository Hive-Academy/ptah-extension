import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

import { VecEmbedderRecoveryService } from './vec-embedder-recovery.service';

class FakeRpcResult<T> {
  constructor(
    private readonly _success: boolean,
    private readonly _data?: T,
    private readonly _error?: string,
  ) {}
  get success(): boolean {
    return this._success;
  }
  get data(): T | undefined {
    return this._data;
  }
  get error(): string | undefined {
    return this._error;
  }
  isSuccess(): boolean {
    return this._success && this._data !== undefined;
  }
  isError(): boolean {
    return !this._success;
  }
}

class FakeRpc {
  callSpy = jest.fn();
  call(method: string, params: unknown, opts?: unknown): unknown {
    return this.callSpy(method, params, opts);
  }
}

describe('VecEmbedderRecoveryService', () => {
  let svc: VecEmbedderRecoveryService;
  let rpc: FakeRpc;

  beforeEach(() => {
    rpc = new FakeRpc();
    TestBed.configureTestingModule({
      providers: [
        VecEmbedderRecoveryService,
        { provide: ClaudeRpcService, useValue: rpc },
      ],
    });
    svc = TestBed.inject(VecEmbedderRecoveryService);
  });

  it('subscribes to VEC_STATUS_CHANGED and EMBEDDER_STATUS_CHANGED messages', () => {
    expect(svc.handledMessageTypes).toContain(MESSAGE_TYPES.VEC_STATUS_CHANGED);
    expect(svc.handledMessageTypes).toContain(
      MESSAGE_TYPES.EMBEDDER_STATUS_CHANGED,
    );
  });

  it('updates vecDiagnostic on VEC_STATUS_CHANGED', () => {
    svc.handleMessage({
      type: MESSAGE_TYPES.VEC_STATUS_CHANGED,
      payload: {
        ok: true,
        diagnostic: {
          ok: true,
          reason: 'ok',
          electronVersion: '40.0.0',
          processArch: 'x64',
          processPlatform: 'win32',
        },
      },
    });
    expect(svc.vecAvailable()).toBe(true);
    expect(svc.vecDiagnostic()?.reason).toBe('ok');
  });

  it('updates embedderStatus on EMBEDDER_STATUS_CHANGED', () => {
    svc.handleMessage({
      type: MESSAGE_TYPES.EMBEDDER_STATUS_CHANGED,
      payload: {
        status: { ready: true, downloading: false },
      },
    });
    expect(svc.embedderReady()).toBe(true);
  });

  it('publishes a warning toast when an embedder error arrives', () => {
    svc.handleMessage({
      type: MESSAGE_TYPES.EMBEDDER_STATUS_CHANGED,
      payload: {
        status: {
          ready: false,
          downloading: false,
          error: { message: 'network down' },
        },
      },
    });
    const toast = svc.lastToast();
    expect(toast?.kind).toBe('warn');
    expect(toast?.message).toContain('network down');
  });

  it('retryVec calls db:reloadVec and updates the diagnostic signal on success', async () => {
    rpc.callSpy.mockResolvedValue(
      new FakeRpcResult(true, {
        ok: true,
        diagnostic: {
          ok: true,
          reason: 'ok',
          electronVersion: '40.0.0',
          processArch: 'x64',
          processPlatform: 'win32',
        },
        message: 'sqlite-vec loaded successfully.',
      }),
    );
    const result = await svc.retryVec();
    expect(rpc.callSpy).toHaveBeenCalledWith(
      'db:reloadVec',
      {},
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(result?.ok).toBe(true);
    expect(svc.vecAvailable()).toBe(true);
    expect(svc.lastToast()?.kind).toBe('success');
  });

  it('retryVec publishes a warn toast when the retry succeeds RPC-wise but vec stays offline', async () => {
    rpc.callSpy.mockResolvedValue(
      new FakeRpcResult(true, {
        ok: false,
        diagnostic: {
          ok: false,
          reason: 'load-failed',
          electronVersion: '40.0.0',
          processArch: 'x64',
          processPlatform: 'win32',
          error: { message: 'still cannot load' },
        },
        message: 'sqlite-vec still offline: load-failed.',
      }),
    );
    await svc.retryVec();
    expect(svc.lastToast()?.kind).toBe('warn');
    expect(svc.vecAvailable()).toBe(false);
  });

  it('retryVec dedupes in-flight calls', async () => {
    let resolveCall!: (v: unknown) => void;
    rpc.callSpy.mockReturnValue(
      new Promise((res) => {
        resolveCall = res;
      }),
    );
    const first = svc.retryVec();
    const second = svc.retryVec();
    expect(rpc.callSpy).toHaveBeenCalledTimes(1);
    resolveCall(
      new FakeRpcResult(true, {
        ok: true,
        diagnostic: {
          ok: true,
          reason: 'ok',
          electronVersion: '40.0.0',
          processArch: 'x64',
          processPlatform: 'win32',
        },
        message: 'ok',
      }),
    );
    await first;
    expect(await second).toBeNull();
  });

  it('retryEmbedder calls embedder:retry and toasts an error message on failure', async () => {
    rpc.callSpy.mockResolvedValue(
      new FakeRpcResult(true, {
        ok: false,
        status: {
          ready: false,
          downloading: false,
          error: { message: 'fetch failed' },
        },
        message: 'Embedder retry failed: fetch failed',
      }),
    );
    await svc.retryEmbedder();
    expect(rpc.callSpy).toHaveBeenCalledWith(
      'embedder:retry',
      {},
      expect.any(Object),
    );
    expect(svc.lastToast()?.kind).toBe('warn');
  });

  it('copyDiagnostic writes a JSON blob to navigator.clipboard', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    svc.handleMessage({
      type: MESSAGE_TYPES.VEC_STATUS_CHANGED,
      payload: {
        ok: false,
        diagnostic: {
          ok: false,
          reason: 'load-failed',
          electronVersion: '40.0.0',
          processArch: 'x64',
          processPlatform: 'win32',
        },
      },
    });
    const ok = await svc.copyDiagnostic();
    expect(ok).toBe(true);
    const arg = writeText.mock.calls[0][0] as string;
    expect(arg).toContain('"reason": "load-failed"');
    expect(svc.lastToast()?.kind).toBe('success');
  });

  it('dismissToast clears the toast signal', () => {
    svc.handleMessage({
      type: MESSAGE_TYPES.EMBEDDER_STATUS_CHANGED,
      payload: {
        status: {
          ready: false,
          downloading: false,
          error: { message: 'oops' },
        },
      },
    });
    expect(svc.lastToast()).not.toBeNull();
    svc.dismissToast();
    expect(svc.lastToast()).toBeNull();
  });
});
