import 'reflect-metadata';
import { SessionDriverLockCoordinator } from './session-driver-lock-coordinator';
import type { ISessionDriverLock } from '@ptah-extension/platform-core';
import type { SessionLifecycleManager } from '@ptah-extension/agent-sdk';

describe('SessionDriverLockCoordinator', () => {
  it('holds one kernel lock until the last native lease releases', async () => {
    const lock = {
      setLiveRecordCheck: jest.fn(),
      acquire: jest.fn().mockResolvedValue({ ok: true, nonce: 'n' }),
      release: jest.fn().mockResolvedValue('released'),
    } as unknown as ISessionDriverLock;
    const lifecycle = {
      onRecordRemoved: jest.fn(),
      onRealSessionIdBound: jest.fn(),
      onRealSessionIdRebound: jest.fn(),
    } as unknown as SessionLifecycleManager;
    const coordinator = new SessionDriverLockCoordinator(lock, lifecycle);
    const context = { consumer: 'chat', kind: 'start' } as const;
    const first = await coordinator.admitNative('session', context);
    const second = await coordinator.admitNative('session', context);
    expect(lock.acquire).toHaveBeenCalledTimes(1);
    first.release();
    await coordinator.assertDriveHeld('session');
    expect(lock.release).not.toHaveBeenCalled();
    second.release();
    await coordinator.abandonDrive('session', 'unused');
    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it('refuses another holder by name and retains no provisional owner', async () => {
    const lock = {
      setLiveRecordCheck: jest.fn(),
      acquire: jest
        .fn()
        .mockResolvedValue({ ok: false, holder: { label: 'worker A' } }),
      release: jest.fn(),
    } as unknown as ISessionDriverLock;
    const lifecycle = {
      onRecordRemoved: jest.fn(),
      onRealSessionIdBound: jest.fn(),
      onRealSessionIdRebound: jest.fn(),
    } as unknown as SessionLifecycleManager;
    const coordinator = new SessionDriverLockCoordinator(lock, lifecycle);
    await expect(
      coordinator.beginDrive('session', 'tab'),
    ).rejects.toMatchObject({
      errorCode: 'SESSION_DRIVEN_ELSEWHERE',
      message: expect.stringContaining('worker A'),
    });
    expect(lock.release).not.toHaveBeenCalled();
  });

  it('releases the kernel lock when the last session record is removed', async () => {
    const lock = {
      setLiveRecordCheck: jest.fn(),
      acquire: jest.fn().mockResolvedValue({ ok: true, nonce: 'n' }),
      release: jest.fn().mockResolvedValue('released'),
    } as unknown as ISessionDriverLock;
    const record = { token: 'token', tabId: 'tab', realSessionId: 'session' };
    const lifecycle = {
      onRecordRemoved: jest.fn(),
      onRealSessionIdBound: jest.fn(),
      onRealSessionIdRebound: jest.fn(),
      find: jest.fn().mockReturnValue(record),
    } as unknown as SessionLifecycleManager;
    const coordinator = new SessionDriverLockCoordinator(lock, lifecycle);
    const bound = (lifecycle.onRealSessionIdBound as jest.Mock).mock
      .calls[0][0];
    const removed = (lifecycle.onRecordRemoved as jest.Mock).mock.calls[0][0];
    bound(record);
    await coordinator.assertRecordAdmission('tab');
    removed(record);
    await coordinator.abandonDrive('session', 'tab');
    expect(lock.release).toHaveBeenCalledWith('session', 'n');
  });
});
