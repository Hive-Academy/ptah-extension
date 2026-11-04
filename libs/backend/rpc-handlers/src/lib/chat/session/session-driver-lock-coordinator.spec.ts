import { createMockLogger } from '@ptah-extension/shared/testing';
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
    const coordinator = new SessionDriverLockCoordinator(
      lock,
      lifecycle,
      createMockLogger(),
    );
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
    const coordinator = new SessionDriverLockCoordinator(
      lock,
      lifecycle,
      createMockLogger(),
    );
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
    const coordinator = new SessionDriverLockCoordinator(
      lock,
      lifecycle,
      createMockLogger(),
    );
    const bound = (lifecycle.onRealSessionIdBound as jest.Mock).mock
      .calls[0][0];
    const removed = (lifecycle.onRecordRemoved as jest.Mock).mock.calls[0][0];
    bound(record);
    await coordinator.assertRecordAdmission('tab');
    removed(record);
    await coordinator.abandonDrive('session', 'tab');
    expect(lock.release).toHaveBeenCalledWith('session', 'n');
  });

  it('clears a failed admission after the attempt and admits a healthy start on the same tab', async () => {
    const lock = {
      setLiveRecordCheck: jest.fn(),
      acquire: jest
        .fn()
        .mockResolvedValueOnce({ ok: false, holder: { label: 'worker A' } })
        .mockResolvedValue({ ok: true, nonce: 'n' }),
      release: jest.fn().mockResolvedValue('released'),
    } as unknown as ISessionDriverLock;
    const record = {
      token: 'old',
      tabId: 'tab',
      realSessionId: 'old-session',
      abortController: new AbortController(),
    };
    const lifecycle = {
      onRecordRemoved: jest.fn(),
      onRealSessionIdBound: jest.fn(),
      onRealSessionIdRebound: jest.fn(),
      find: jest.fn(() => record),
      endSessionIfTokenMatches: jest.fn().mockResolvedValue(undefined),
    } as unknown as SessionLifecycleManager;
    const coordinator = new SessionDriverLockCoordinator(
      lock,
      lifecycle,
      createMockLogger(),
    );
    coordinator.beginRecordAdmission('tab');
    const bound = (lifecycle.onRealSessionIdBound as jest.Mock).mock
      .calls[0][0];
    bound(record);
    await expect(
      coordinator.assertRecordAdmission('tab'),
    ).rejects.toMatchObject({ errorCode: 'SESSION_DRIVEN_ELSEWHERE' });
    coordinator.endRecordAdmission('tab');
    record.token = 'new';
    record.realSessionId = 'new-session';
    coordinator.beginRecordAdmission('tab');
    bound(record);
    await coordinator.assertRecordAdmission('tab');
    coordinator.endRecordAdmission('tab');
    expect(lock.acquire).toHaveBeenCalledTimes(2);
  });

  it('drops old ownership on rebind even when new admission fails', async () => {
    const lock = {
      setLiveRecordCheck: jest.fn(),
      acquire: jest
        .fn()
        .mockResolvedValueOnce({ ok: true, nonce: 'old-n' })
        .mockResolvedValueOnce({ ok: false, holder: { label: 'worker A' } }),
      release: jest.fn().mockResolvedValue('released'),
    } as unknown as ISessionDriverLock;
    const record = {
      token: 'token',
      tabId: 'tab',
      realSessionId: 'old',
      abortController: new AbortController(),
    };
    const lifecycle = {
      onRecordRemoved: jest.fn(),
      onRealSessionIdBound: jest.fn(),
      onRealSessionIdRebound: jest.fn(),
      find: jest.fn(() => record),
      endSessionIfTokenMatches: jest.fn().mockResolvedValue(undefined),
    } as unknown as SessionLifecycleManager;
    const coordinator = new SessionDriverLockCoordinator(
      lock,
      lifecycle,
      createMockLogger(),
    );
    const bound = (lifecycle.onRealSessionIdBound as jest.Mock).mock
      .calls[0][0];
    const rebound = (lifecycle.onRealSessionIdRebound as jest.Mock).mock
      .calls[0][0];
    bound(record);
    await coordinator.assertRecordAdmission('tab');
    record.realSessionId = 'new';
    rebound({ ownerToken: 'token', tabId: 'tab', newSessionId: 'new' });
    await coordinator.assertRecordAdmission('tab').catch(() => undefined);
    expect(lock.release).toHaveBeenCalledWith('old', 'old-n');
  });

  it('releases provisional ownership when an attempt is abandoned', async () => {
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
    const coordinator = new SessionDriverLockCoordinator(
      lock,
      lifecycle,
      createMockLogger(),
    );
    await coordinator.beginDrive('session', 'tab');
    await coordinator.abandonDrive('session', 'tab');
    expect(lock.release).toHaveBeenCalledWith('session', 'n');
  });

  describe('an attempt that returns before the SDK record binds (N1)', () => {
    function setup() {
      let nonce = 0;
      const lock = {
        setLiveRecordCheck: jest.fn(),
        acquire: jest
          .fn()
          .mockImplementation(async () => ({ ok: true, nonce: `n${++nonce}` })),
        release: jest.fn().mockResolvedValue('released'),
      } as unknown as ISessionDriverLock;
      const record: {
        token: string;
        tabId: string;
        realSessionId: string | null;
        abortController: AbortController;
      } = {
        token: 'token',
        tabId: 'tab',
        realSessionId: null,
        abortController: new AbortController(),
      };
      let current: typeof record | undefined = record;
      const lifecycle = {
        onRecordRemoved: jest.fn(),
        onRealSessionIdBound: jest.fn(),
        onRealSessionIdRebound: jest.fn(),
        find: jest.fn((id: string) => (id === 'tab' ? current : undefined)),
        endSessionIfTokenMatches: jest.fn().mockResolvedValue(undefined),
      } as unknown as SessionLifecycleManager;
      const coordinator = new SessionDriverLockCoordinator(
        lock,
        lifecycle,
        createMockLogger(),
      );
      const bound = (lifecycle.onRealSessionIdBound as jest.Mock).mock
        .calls[0][0] as (value: typeof record) => void;
      const removed = (lifecycle.onRecordRemoved as jest.Mock).mock
        .calls[0][0] as (value: typeof record) => void;
      const isLive = (lock.setLiveRecordCheck as jest.Mock).mock
        .calls[0][0] as (sessionId: string) => boolean;
      return {
        lock,
        record,
        coordinator,
        bound,
        removed,
        isLive,
        dropRecord: () => (current = undefined),
      };
    }

    it('keeps the lock held until the record binds, then the record owns it', async () => {
      const { lock, record, coordinator, bound, removed, isLive } = setup();
      await coordinator.beginDrive('session', 'tab');
      await coordinator.settleDrive('session', 'tab');
      expect(lock.release).not.toHaveBeenCalled();
      expect(isLive('session')).toBe(true);
      await coordinator.assertDriveHeld('session', 'tab');

      record.realSessionId = 'session';
      bound(record);
      await coordinator.assertRecordAdmission('tab');
      // The provisional owner is gone: abandoning the old attempt frees nothing.
      await coordinator.abandonDrive('session', 'tab');
      expect(lock.release).not.toHaveBeenCalled();
      expect(lock.acquire).toHaveBeenCalledTimes(1);

      removed(record);
      await coordinator.abandonDrive('session', 'unused');
      expect(lock.release).toHaveBeenCalledWith('session', 'n1');
    });

    it('releases on a failed attempt even while the record is unbound', async () => {
      const { lock, coordinator, isLive } = setup();
      await coordinator.beginDrive('session', 'tab');
      await coordinator.abandonDrive('session', 'tab');
      await coordinator.settleDrive('session', 'tab');
      expect(lock.release).toHaveBeenCalledTimes(1);
      expect(lock.release).toHaveBeenCalledWith('session', 'n1');
      expect(isLive('session')).toBe(false);
    });

    it('releases on settle when the tab has no record to bind', async () => {
      const { lock, coordinator, dropRecord } = setup();
      dropRecord();
      await coordinator.beginDrive('session', 'tab');
      await coordinator.settleDrive('session', 'tab');
      expect(lock.release).toHaveBeenCalledWith('session', 'n1');
    });

    it('releases on settle when the tab record is bound to another session', async () => {
      const { lock, record, coordinator } = setup();
      record.realSessionId = 'other';
      await coordinator.beginDrive('session', 'tab');
      await coordinator.settleDrive('session', 'tab');
      expect(lock.release).toHaveBeenCalledWith('session', 'n1');
    });

    it('ends the parked owner when the record binds a different session', async () => {
      const { lock, record, coordinator, bound } = setup();
      await coordinator.beginDrive('session', 'tab');
      await coordinator.settleDrive('session', 'tab');
      record.realSessionId = 'forked';
      bound(record);
      await coordinator.assertRecordAdmission('tab');
      await new Promise((resolve) => setImmediate(resolve));
      await coordinator.abandonDrive('session', 'unused');
      expect(lock.release).toHaveBeenCalledTimes(1);
      expect(lock.release).toHaveBeenCalledWith('session', 'n1');
      await coordinator.assertDriveHeld('forked', 'tab');
    });

    it('ends the parked owner when the record is removed before binding', async () => {
      const { lock, record, coordinator, removed, dropRecord } = setup();
      await coordinator.beginDrive('session', 'tab');
      await coordinator.settleDrive('session', 'tab');
      dropRecord();
      removed(record);
      await coordinator.abandonDrive('session', 'unused');
      expect(lock.release).toHaveBeenCalledWith('session', 'n1');
    });
  });
});
