import { createMockLogger } from '@ptah-extension/shared/testing';
import 'reflect-metadata';
import { SessionDriverLockCoordinator } from './session-driver-lock-coordinator';
import {
  PlatformType,
  type ISessionDriverLock,
} from '@ptah-extension/platform-core';
import type { SessionLifecycleManager } from '@ptah-extension/agent-sdk';

describe('SessionDriverLockCoordinator', () => {
  it('holds one kernel lock until the last native lease releases', async () => {
    const lock = {
      setLiveRecordCheck: jest.fn(),
      setReleaseGate: jest.fn(),
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
      { type: PlatformType.Electron },
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

  it.each([
    [PlatformType.CLI, 'cli'],
    [PlatformType.Electron, 'desktop'],
  ])('records a %s host as a %s holder', async (type, kind) => {
    const lock = {
      setLiveRecordCheck: jest.fn(),
      setReleaseGate: jest.fn(),
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
      { type },
    );
    await coordinator.beginDrive('session', 'tab');
    expect(lock.acquire).toHaveBeenCalledWith(
      'session',
      expect.objectContaining({ kind }),
    );
  });

  it('refuses another holder by name and retains no provisional owner', async () => {
    const lock = {
      setLiveRecordCheck: jest.fn(),
      setReleaseGate: jest.fn(),
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
      { type: PlatformType.Electron },
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
      setReleaseGate: jest.fn(),
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
      { type: PlatformType.Electron },
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
      setReleaseGate: jest.fn(),
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
      { type: PlatformType.Electron },
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
      setReleaseGate: jest.fn(),
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
      { type: PlatformType.Electron },
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
      setReleaseGate: jest.fn(),
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
      { type: PlatformType.Electron },
    );
    const attempt = await coordinator.beginDrive('session', 'tab');
    await coordinator.abandonDrive('session', attempt);
    expect(lock.release).toHaveBeenCalledWith('session', 'n');
  });

  describe('drive attempts and the SDK record binding (N1)', () => {
    type Rec = {
      token: string;
      tabId: string;
      realSessionId: string | null;
      abortController: AbortController;
    };
    function setup() {
      let nonce = 0;
      const lock = {
        setLiveRecordCheck: jest.fn(),
        setReleaseGate: jest.fn(),
        acquire: jest
          .fn()
          .mockImplementation(async () => ({ ok: true, nonce: `n${++nonce}` })),
        release: jest.fn().mockResolvedValue('released'),
      } as unknown as ISessionDriverLock;
      const record = (token: string): Rec => ({
        token,
        tabId: 'tab',
        realSessionId: null,
        abortController: new AbortController(),
      });
      let current: Rec | undefined = record('r1');
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
        { type: PlatformType.Electron },
      );
      const bound = (lifecycle.onRealSessionIdBound as jest.Mock).mock
        .calls[0][0] as (value: Rec) => void;
      const removed = (lifecycle.onRecordRemoved as jest.Mock).mock
        .calls[0][0] as (value: Rec) => void;
      const isLive = (lock.setLiveRecordCheck as jest.Mock).mock
        .calls[0][0] as (sessionId: string) => boolean;
      const gate = (lock.setReleaseGate as jest.Mock).mock.calls[0][0] as (
        sessionId: string,
        release: () => Promise<'released' | 'stranded'>,
      ) => Promise<'in-use' | 'released' | 'stranded'>;
      return {
        lock,
        coordinator,
        bound,
        removed,
        isLive,
        gate,
        record: () => current,
        replace: (next: Rec | undefined) => (current = next),
        newRecord: record,
        flush: async (sessionId = 'session') => {
          await new Promise((resolve) => setImmediate(resolve));
          await coordinator.abandonDrive(sessionId, undefined);
        },
      };
    }

    it('keeps the lock held until the record binds, then the record owns it', async () => {
      const t = setup();
      const attempt = await t.coordinator.beginDrive('session', 'tab');
      await t.coordinator.settleDrive('session', attempt);
      expect(t.lock.release).not.toHaveBeenCalled();
      expect(t.isLive('session')).toBe(true);
      await t.coordinator.assertDriveHeld('session', 'tab');

      const rec = t.record()!;
      rec.realSessionId = 'session';
      t.bound(rec);
      await t.coordinator.assertRecordAdmission('tab');
      await t.flush();
      // The attempt is over: abandoning it again frees nothing.
      await t.coordinator.abandonDrive('session', attempt);
      expect(t.lock.release).not.toHaveBeenCalled();
      expect(t.lock.acquire).toHaveBeenCalledTimes(1);

      t.removed(rec);
      await t.flush();
      expect(t.lock.release).toHaveBeenCalledWith('session', 'n1');
    });

    it('releases on a failed attempt even while the record is unbound', async () => {
      const t = setup();
      const attempt = await t.coordinator.beginDrive('session', 'tab');
      await t.coordinator.abandonDrive('session', attempt);
      await t.coordinator.settleDrive('session', attempt);
      expect(t.lock.release).toHaveBeenCalledTimes(1);
      expect(t.lock.release).toHaveBeenCalledWith('session', 'n1');
      expect(t.isLive('session')).toBe(false);
    });

    it('releases on settle when the tab has no record to bind', async () => {
      const t = setup();
      t.replace(undefined);
      const attempt = await t.coordinator.beginDrive('session', 'tab');
      await t.coordinator.settleDrive('session', attempt);
      expect(t.lock.release).toHaveBeenCalledWith('session', 'n1');
    });

    it('releases on settle when the tab record is bound to another session', async () => {
      const t = setup();
      t.record()!.realSessionId = 'other';
      const attempt = await t.coordinator.beginDrive('session', 'tab');
      await t.coordinator.settleDrive('session', attempt);
      expect(t.lock.release).toHaveBeenCalledWith('session', 'n1');
    });

    it('ends the waiting attempt when the record binds a different session', async () => {
      const t = setup();
      const attempt = await t.coordinator.beginDrive('session', 'tab');
      await t.coordinator.settleDrive('session', attempt);
      const rec = t.record()!;
      rec.realSessionId = 'forked';
      t.bound(rec);
      await t.coordinator.assertRecordAdmission('tab');
      await t.flush();
      expect(t.lock.release).toHaveBeenCalledTimes(1);
      expect(t.lock.release).toHaveBeenCalledWith('session', 'n1');
      await t.coordinator.assertDriveHeld('forked', 'tab');
    });

    it('ends the waiting attempt when its record is removed before binding', async () => {
      const t = setup();
      const attempt = await t.coordinator.beginDrive('session', 'tab');
      await t.coordinator.settleDrive('session', attempt);
      const rec = t.record()!;
      t.replace(undefined);
      t.removed(rec);
      await t.flush();
      expect(t.lock.release).toHaveBeenCalledWith('session', 'n1');
    });

    it('a failed second attempt on the same tab keeps the first live query locked', async () => {
      const t = setup();
      const first = await t.coordinator.beginDrive('session', 'tab');
      await t.coordinator.settleDrive('session', first);
      const second = await t.coordinator.beginDrive('session', 'tab');
      await t.coordinator.abandonDrive('session', second);
      await t.coordinator.settleDrive('session', second);
      expect(t.lock.release).not.toHaveBeenCalled();
      expect(t.isLive('session')).toBe(true);

      const rec = t.record()!;
      rec.realSessionId = 'session';
      t.bound(rec);
      await t.coordinator.assertRecordAdmission('tab');
      t.removed(rec);
      await t.flush();
      expect(t.lock.release).toHaveBeenCalledTimes(1);
    });

    it('two overlapping attempts both settle onto the same record', async () => {
      const t = setup();
      const first = await t.coordinator.beginDrive('session', 'tab');
      const second = await t.coordinator.beginDrive('session', 'tab');
      await t.coordinator.settleDrive('session', second);
      await t.coordinator.abandonDrive('session', first);
      expect(t.lock.release).not.toHaveBeenCalled();
      const rec = t.record()!;
      t.replace(undefined);
      t.removed(rec);
      await t.flush();
      expect(t.lock.release).toHaveBeenCalledTimes(1);
    });

    it("a displaced record's removal leaves the replacement's attempt alone", async () => {
      const t = setup();
      const old = t.record()!;
      // The replacement registers first; the old record's removal arrives late.
      const replacement = t.newRecord('r2');
      t.replace(replacement);
      const attempt = await t.coordinator.beginDrive('session', 'tab');
      await t.coordinator.settleDrive('session', attempt);
      t.removed(old);
      await t.flush();
      expect(t.lock.release).not.toHaveBeenCalled();
      await t.coordinator.assertDriveHeld('session', 'tab');

      t.replace(undefined);
      t.removed(replacement);
      await t.flush();
      expect(t.lock.release).toHaveBeenCalledWith('session', 'n1');
    });

    it("a displaced record's removal leaves an in-flight attempt alone", async () => {
      const t = setup();
      const old = t.record()!;
      const attempt = await t.coordinator.beginDrive('session', 'tab');
      t.replace(t.newRecord('r2'));
      t.removed(old);
      await t.flush();
      await t.coordinator.assertDriveHeld('session', 'tab');
      await t.coordinator.settleDrive('session', attempt);
      expect(t.lock.release).not.toHaveBeenCalled();
    });

    it('operator release waits for an admission in flight and refuses it', async () => {
      const t = setup();
      let finishAcquire!: () => void;
      (t.lock.acquire as jest.Mock).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishAcquire = () => resolve({ ok: true, nonce: 'n1' });
          }),
      );
      const release = jest.fn().mockResolvedValue('released');
      const begin = t.coordinator.beginDrive('session', 'tab');
      await new Promise((resolve) => setImmediate(resolve));
      expect(t.lock.acquire).toHaveBeenCalledTimes(1);
      // The owner set is still empty here; a separate liveness read would say idle.
      expect(t.isLive('session')).toBe(false);
      const decision = t.gate('session', release);
      finishAcquire();
      await begin;
      await expect(decision).resolves.toBe('in-use');
      expect(release).not.toHaveBeenCalled();
    });

    it('a new drive waits for an operator release and then binds afresh', async () => {
      const t = setup();
      let finishRelease!: () => void;
      const release = jest.fn(
        () =>
          new Promise<'released'>((resolve) => {
            finishRelease = () => resolve('released');
          }),
      );
      const decision = t.gate('session', release);
      const begin = t.coordinator.beginDrive('session', 'tab');
      await new Promise((resolve) => setImmediate(resolve));
      expect(release).toHaveBeenCalledTimes(1);
      expect(t.lock.acquire).not.toHaveBeenCalled();
      finishRelease();
      await expect(decision).resolves.toBe('released');
      await begin;
      expect(t.lock.acquire).toHaveBeenCalledTimes(1);
    });
  });
});
