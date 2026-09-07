import { TestBed } from '@angular/core/testing';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

import { BootStatusService } from './boot-status.service';
import { ClaudeRpcService, RpcResult } from './claude-rpc.service';
import { VSCodeService } from './vscode.service';

type RpcStub = { call: jest.Mock };

function configure(options: { isElectron: boolean; rpc?: RpcStub }): {
  service: BootStatusService;
  rpc: RpcStub;
} {
  const rpc: RpcStub = options.rpc ?? {
    call: jest.fn().mockResolvedValue(new RpcResult(false, undefined, 'no')),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: VSCodeService, useValue: { isElectron: options.isElectron } },
      { provide: ClaudeRpcService, useValue: rpc },
    ],
  });
  return { service: TestBed.inject(BootStatusService), rpc };
}

/**
 * Drain the microtask queue under fake timers. `await Promise.resolve()` alone
 * only advances one tick, and the watchdog path is `setInterval` → `async
 * pullReadiness` → `await rpc.call` → adopt, which is several.
 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

function push(service: BootStatusService, payload: unknown): void {
  service.handleMessage({
    type: MESSAGE_TYPES.BOOT_READINESS_CHANGED,
    payload,
  });
}

describe('BootStatusService', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('defaults to ready/settled before any RPC resolves', () => {
    const { service } = configure({ isElectron: true });

    expect(service.readiness()).toBe('ready');
    expect(service.phase()).toBe('settled');
    expect(service.isBooting()).toBe(false);
    expect(service.isBlockingBoot()).toBe(false);
    expect(service.hasFailed()).toBe(false);
    expect(service.detail()).toBeUndefined();
  });

  it('does not pull at all outside Electron', () => {
    const rpc: RpcStub = { call: jest.fn() };
    const { service } = configure({ isElectron: false, rpc });

    expect(rpc.call).not.toHaveBeenCalled();
    expect(service.readiness()).toBe('ready');
  });

  it('pulls boot:getReadiness once in Electron and adopts the snapshot', async () => {
    const rpc: RpcStub = {
      call: jest.fn().mockResolvedValue(
        new RpcResult(true, {
          readiness: 'warming',
          phase: 'database',
          detail: 'Opening a 1.0 GB database',
          startedAt: 1000,
        }),
      ),
    };
    const { service } = configure({ isElectron: true, rpc });

    await Promise.resolve();
    await Promise.resolve();

    expect(rpc.call).toHaveBeenCalledTimes(1);
    expect(rpc.call.mock.calls[0][0]).toBe('boot:getReadiness');
    expect(service.isBooting()).toBe(true);
    expect(service.phase()).toBe('database');
    expect(service.detail()).toBe('Opening a 1.0 GB database');
  });

  it('leaves the ready default when the pull rejects', async () => {
    const rpc: RpcStub = {
      call: jest.fn().mockRejectedValue(new Error('no such method')),
    };
    const { service } = configure({ isElectron: true, rpc });

    await Promise.resolve();
    await Promise.resolve();

    expect(service.readiness()).toBe('ready');
    expect(service.isBooting()).toBe(false);
  });

  it('leaves the ready default when the pull answers unsuccessfully', async () => {
    const rpc: RpcStub = {
      call: jest
        .fn()
        .mockResolvedValue(new RpcResult(false, undefined, 'unavailable')),
    };
    const { service } = configure({ isElectron: true, rpc });

    await Promise.resolve();
    await Promise.resolve();

    expect(service.readiness()).toBe('ready');
  });

  it('does not let a late pull overwrite a push that already landed', async () => {
    let resolvePull: (value: unknown) => void = () => undefined;
    const rpc: RpcStub = {
      call: jest.fn().mockReturnValue(
        new Promise((resolve) => {
          resolvePull = resolve;
        }),
      ),
    };
    const { service } = configure({ isElectron: true, rpc });

    push(service, {
      readiness: 'warming',
      phase: 'sessions',
      startedAt: 10,
    });

    resolvePull(
      new RpcResult(true, {
        readiness: 'warming',
        phase: 'starting',
        startedAt: 10,
      }),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(service.phase()).toBe('sessions');
  });

  it('flips isBooting on a warming push and clears it on a ready push', () => {
    const { service } = configure({ isElectron: true });

    push(service, { readiness: 'warming', phase: 'starting', startedAt: 5 });
    expect(service.isBooting()).toBe(true);

    push(service, { readiness: 'ready', phase: 'settled', startedAt: 5 });
    expect(service.isBooting()).toBe(false);
  });

  it('blocks the shell only before the harness phase', () => {
    const { service } = configure({ isElectron: true });

    push(service, { readiness: 'warming', phase: 'starting', startedAt: 5 });
    expect(service.isBlockingBoot()).toBe(true);

    push(service, { readiness: 'warming', phase: 'database', startedAt: 5 });
    expect(service.isBlockingBoot()).toBe(true);

    push(service, { readiness: 'warming', phase: 'harness', startedAt: 5 });
    expect(service.isBlockingBoot()).toBe(false);
    expect(service.isBooting()).toBe(true);

    push(service, { readiness: 'warming', phase: 'index', startedAt: 5 });
    expect(service.isBlockingBoot()).toBe(false);
  });

  it('reports a failed boot without blocking', () => {
    const { service } = configure({ isElectron: true });

    push(service, {
      readiness: 'failed',
      phase: 'database',
      detail: 'Database is locked',
      startedAt: 5,
    });

    expect(service.hasFailed()).toBe(true);
    expect(service.isBooting()).toBe(false);
    expect(service.isBlockingBoot()).toBe(false);
    expect(service.detail()).toBe('Database is locked');
  });

  it.each([
    ['a non-object payload', 'nope'],
    [
      'an unknown readiness',
      { readiness: 'sleepy', phase: 'database', startedAt: 1 },
    ],
    [
      'an unknown phase',
      { readiness: 'warming', phase: 'quantum', startedAt: 1 },
    ],
    [
      'a non-finite startedAt',
      { readiness: 'warming', phase: 'database', startedAt: NaN },
    ],
    ['a missing startedAt', { readiness: 'warming', phase: 'database' }],
    [
      'a non-string detail',
      { readiness: 'warming', phase: 'database', startedAt: 1, detail: 7 },
    ],
  ])('drops %s', (_label, payload) => {
    const { service } = configure({ isElectron: true });

    push(service, payload);

    expect(service.readiness()).toBe('ready');
    expect(service.phase()).toBe('settled');
  });

  it('ignores a message it does not handle', () => {
    const { service } = configure({ isElectron: true });

    service.handleMessage({
      type: 'chat:messageChunk',
      payload: { readiness: 'warming', phase: 'database', startedAt: 1 },
    });

    expect(service.isBooting()).toBe(false);
  });

  it('declares the boot readiness wire string', () => {
    const { service } = configure({ isElectron: true });

    expect(service.handledMessageTypes).toEqual(['boot:readinessChanged']);
  });

  it('derives elapsed time from startedAt', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(9000);
    const { service } = configure({ isElectron: true });

    push(service, { readiness: 'warming', phase: 'database', startedAt: 6500 });

    expect(service.elapsedMs()).toBe(2500);
    nowSpy.mockRestore();
  });

  // ── Watchdog (logic review F-1: a lost push must not strand the renderer) ──

  it('re-pulls while warming and adopts a ready answer the push never delivered', async () => {
    jest.useFakeTimers();
    const call = jest
      .fn()
      .mockResolvedValueOnce(
        new RpcResult(true, {
          readiness: 'warming',
          phase: 'database',
          startedAt: 1,
        }),
      )
      .mockResolvedValue(
        new RpcResult(true, {
          readiness: 'ready',
          phase: 'settled',
          startedAt: 1,
        }),
      );
    const { service } = configure({ isElectron: true, rpc: { call } });

    await flushMicrotasks();
    expect(service.isBooting()).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);

    // No further push ever arrives — the watchdog is the only way out.
    jest.advanceTimersByTime(2000);
    await flushMicrotasks();

    expect(call).toHaveBeenCalledTimes(2);
    expect(service.isBooting()).toBe(false);
    expect(service.phase()).toBe('settled');
    jest.useRealTimers();
  });

  it('stops re-pulling once readiness is no longer warming', async () => {
    jest.useFakeTimers();
    const call = jest
      .fn()
      .mockResolvedValueOnce(
        new RpcResult(true, {
          readiness: 'warming',
          phase: 'database',
          startedAt: 1,
        }),
      )
      .mockResolvedValue(
        new RpcResult(true, {
          readiness: 'ready',
          phase: 'settled',
          startedAt: 1,
        }),
      );
    const { service } = configure({ isElectron: true, rpc: { call } });

    await flushMicrotasks();
    jest.advanceTimersByTime(2000);
    await flushMicrotasks();
    expect(service.isBooting()).toBe(false);
    const callsAtSettle = call.mock.calls.length;

    jest.advanceTimersByTime(20000);
    await flushMicrotasks();

    expect(call).toHaveBeenCalledTimes(callsAtSettle);
    jest.useRealTimers();
  });

  it('never starts the watchdog outside Electron', async () => {
    jest.useFakeTimers();
    const call = jest.fn();
    const { service } = configure({ isElectron: false, rpc: { call } });

    service.handleMessage({
      type: MESSAGE_TYPES.BOOT_READINESS_CHANGED,
      payload: { readiness: 'warming', phase: 'database', startedAt: 1 },
    });
    jest.advanceTimersByTime(20000);
    await flushMicrotasks();

    expect(call).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('ignores a watchdog pull that answers an older phase than the last push', async () => {
    jest.useFakeTimers();
    const call = jest
      .fn()
      .mockResolvedValueOnce(
        new RpcResult(true, {
          readiness: 'warming',
          phase: 'database',
          startedAt: 1,
        }),
      )
      .mockResolvedValue(
        new RpcResult(true, {
          readiness: 'warming',
          phase: 'starting',
          startedAt: 1,
        }),
      );
    const { service } = configure({ isElectron: true, rpc: { call } });

    await flushMicrotasks();
    push(service, { readiness: 'warming', phase: 'sessions', startedAt: 1 });

    jest.advanceTimersByTime(2000);
    await flushMicrotasks();

    expect(call).toHaveBeenCalledTimes(2);
    expect(service.phase()).toBe('sessions');
    jest.useRealTimers();
  });

  it('accepts a watchdog pull that is further along than the last push', async () => {
    jest.useFakeTimers();
    const call = jest
      .fn()
      .mockResolvedValueOnce(
        new RpcResult(true, {
          readiness: 'warming',
          phase: 'database',
          startedAt: 1,
        }),
      )
      .mockResolvedValue(
        new RpcResult(true, {
          readiness: 'warming',
          phase: 'index',
          startedAt: 1,
        }),
      );
    const { service } = configure({ isElectron: true, rpc: { call } });

    await flushMicrotasks();
    push(service, { readiness: 'warming', phase: 'harness', startedAt: 1 });

    jest.advanceTimersByTime(2000);
    await flushMicrotasks();

    expect(service.phase()).toBe('index');
    jest.useRealTimers();
  });

  it('lets a push move the state backwards — the host is always authoritative', () => {
    const { service } = configure({ isElectron: true });

    push(service, { readiness: 'warming', phase: 'index', startedAt: 1 });
    push(service, {
      readiness: 'failed',
      phase: 'database',
      detail: 'Migration failed',
      startedAt: 1,
    });

    expect(service.hasFailed()).toBe(true);
    expect(service.phase()).toBe('database');
  });

  it('clears the watchdog on destroy', async () => {
    jest.useFakeTimers();
    const clearSpy = jest.spyOn(global, 'clearInterval');
    const call = jest.fn().mockResolvedValue(
      new RpcResult(true, {
        readiness: 'warming',
        phase: 'database',
        startedAt: 1,
      }),
    );
    configure({ isElectron: true, rpc: { call } });
    await flushMicrotasks();

    TestBed.resetTestingModule();

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
    jest.useRealTimers();
  });

  it('never reports negative elapsed time when the host clock is ahead', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const { service } = configure({ isElectron: true });

    push(service, { readiness: 'warming', phase: 'database', startedAt: 5000 });

    expect(service.elapsedMs()).toBe(0);
    nowSpy.mockRestore();
  });
});
