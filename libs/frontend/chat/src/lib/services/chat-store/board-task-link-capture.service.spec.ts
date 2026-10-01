/**
 * BoardTaskLinkCaptureService — holds `(tabId → taskId)` for board starts and
 * turns each into one `session:linkTask` call once the real session id is
 * resolved (TASK_2026_580, AC8 board-start chain step 4).
 */
import { TestBed } from '@angular/core/testing';
import { ClaudeRpcService, RpcResult } from '@ptah-extension/core';
import type { SessionLinkTaskResult } from '@ptah-extension/shared';
import { BoardTaskLinkCaptureService } from './board-task-link-capture.service';

describe('BoardTaskLinkCaptureService', () => {
  let service: BoardTaskLinkCaptureService;
  let call: jest.Mock;
  let warn: jest.SpyInstance;

  const okResult = (): RpcResult<SessionLinkTaskResult> =>
    new RpcResult<SessionLinkTaskResult>(true, {
      ok: true,
      organization: {} as never,
    });

  beforeEach(() => {
    call = jest.fn().mockResolvedValue(okResult());
    TestBed.configureTestingModule({
      providers: [
        BoardTaskLinkCaptureService,
        { provide: ClaudeRpcService, useValue: { call } },
      ],
    });
    service = TestBed.inject(BoardTaskLinkCaptureService);
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    TestBed.resetTestingModule();
  });

  it('links the resolved session to the expected task once, as a primary board-start link', async () => {
    service.expect('tab-1', 'TASK_2026_580_9f77');

    await service.onSessionIdResolved('tab-1', 'real-session-1');
    await service.onSessionIdResolved('tab-1', 'real-session-1');

    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('session:linkTask', {
      sessionId: 'real-session-1',
      taskId: 'TASK_2026_580_9f77',
      role: 'primary',
      source: 'board-start',
    });
  });

  it('ignores a resolved tab that has no pending board start', async () => {
    await service.onSessionIdResolved('tab-unknown', 'real-session-2');

    expect(call).not.toHaveBeenCalled();
  });

  it('evicts the oldest pending entry beyond the cap of 20', async () => {
    for (let i = 0; i <= BoardTaskLinkCaptureService.MAX_PENDING; i++) {
      service.expect(`tab-${i}`, `TASK_${i}`);
    }

    await service.onSessionIdResolved('tab-0', 'real-0');
    expect(call).not.toHaveBeenCalled();

    await service.onSessionIdResolved(
      `tab-${BoardTaskLinkCaptureService.MAX_PENDING}`,
      'real-last',
    );
    await service.onSessionIdResolved('tab-1', 'real-1');
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('logs a refused link (ok:false) and does not retry', async () => {
    call.mockResolvedValueOnce(
      new RpcResult<SessionLinkTaskResult>(true, {
        ok: false,
        reason: 'organization-unavailable',
        message: 'unavailable',
      }),
    );
    service.expect('tab-1', 'TASK_A');

    await service.onSessionIdResolved('tab-1', 'real-1');
    await service.onSessionIdResolved('tab-1', 'real-1');

    expect(call).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[BoardTaskLinkCapture] session:linkTask refused',
      expect.objectContaining({ reason: 'organization-unavailable' }),
    );
  });

  it('logs an RPC error result and a thrown call without rethrowing', async () => {
    call
      .mockResolvedValueOnce(
        new RpcResult<SessionLinkTaskResult>(false, undefined, 'boom'),
      )
      .mockRejectedValueOnce(new Error('transport down'));
    service.expect('tab-1', 'TASK_A');
    service.expect('tab-2', 'TASK_B');

    await expect(
      service.onSessionIdResolved('tab-1', 'real-1'),
    ).resolves.toBeUndefined();
    await expect(
      service.onSessionIdResolved('tab-2', 'real-2'),
    ).resolves.toBeUndefined();

    expect(call).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      '[BoardTaskLinkCapture] session:linkTask failed',
      expect.objectContaining({ error: 'boom' }),
    );
    expect(warn).toHaveBeenCalledWith(
      '[BoardTaskLinkCapture] session:linkTask threw',
      expect.objectContaining({ taskId: 'TASK_B' }),
    );
  });
});
