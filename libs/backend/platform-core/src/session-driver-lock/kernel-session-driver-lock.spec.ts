import { runSessionDriverLockContract } from '../testing/contracts/run-session-driver-lock-contract';
import { KernelSessionDriverLock } from './kernel-session-driver-lock';
import { sessionDriverEndpoint } from './endpoint-names';
import { controlEndpointName } from './control-keys';
import * as net from 'node:net';
import type { DriverHolder } from '../interfaces/session-driver-lock.interface';

if (process.platform === 'linux' || process.platform === 'win32') {
  runSessionDriverLockContract('kernel', () => new KernelSessionDriverLock());
}

describe('session endpoint naming', () => {
  it('keeps release guarded until a live-record check is installed', async () => {
    const lock = new KernelSessionDriverLock();
    expect(await lock.hasLiveRecord('session')).toBe(true);
    lock.setLiveRecordCheck(() => false);
    expect(await lock.hasLiveRecord('session')).toBe(false);
    await lock.dispose();
  });
  it('uses only OS user and session identity, not host or process identity (A6)', () => {
    if (process.platform !== 'linux' && process.platform !== 'win32') return;
    const endpoint = sessionDriverEndpoint('a-session-123');
    expect(endpoint).toContain('a-session-123');
    expect(endpoint).not.toContain(String(process.pid));
    if (process.platform === 'linux')
      expect(endpoint.startsWith('\0ptah-driver-')).toBe(true);
    if (process.platform === 'win32')
      expect(endpoint.startsWith('\\\\.\\pipe\\ptah-driver-')).toBe(true);
  });
});

(process.platform === 'linux' || process.platform === 'win32'
  ? describe
  : describe.skip)('stranded kernel release', () => {
  it('keeps a failed release visible, then retries it on the next acquisition', async () => {
    const lock = new KernelSessionDriverLock();
    const owner: DriverHolder = {
      kind: 'desktop',
      hostname: 'local',
      pid: process.pid,
      label: 'test',
      acquiredAt: new Date().toISOString(),
      responding: true,
    };
    const first = await lock.acquire(
      `stranded-${process.pid}-${Date.now()}`,
      owner,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const id = lock.held()[0].sessionId;
    const close = jest
      .spyOn(net.Server.prototype, 'close')
      .mockImplementation(function (
        this: net.Server,
        callback?: (error?: Error) => void,
      ) {
        callback?.(new Error('injected close failure'));
        return this;
      });
    try {
      expect(await lock.release(id, first.nonce)).toBe('stranded');
      expect(lock.held()).toEqual([
        expect.objectContaining({ sessionId: id, state: 'stranded' }),
      ]);
      expect((await lock.holder(id))?.label).toContain('release pending');
      expect((await lock.acquire(id, owner)).ok).toBe(false);
      expect(lock.held()[0].state).toBe('stranded');
    } finally {
      close.mockRestore();
    }
    const recovered = await lock.acquire(id, owner);
    expect(recovered.ok).toBe(true);
    if (recovered.ok)
      expect(await lock.release(id, recovered.nonce)).toBe('released');
    expect(lock.held()).toHaveLength(0);
    await lock.dispose();
  }, 15000);
});

(process.platform === 'linux' || process.platform === 'win32'
  ? describe
  : describe.skip)('release race', () => {
  it('refuses acquisition while the existing server is closing', async () => {
    const lock = new KernelSessionDriverLock();
    const id = `release-race-${process.pid}-${Date.now()}`;
    const first = await lock.acquire(id, {
      kind: 'desktop',
      hostname: 'local',
      pid: process.pid,
      label: 'test',
      acquiredAt: new Date().toISOString(),
      responding: true,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const serverClose = net.Server.prototype.close;
    let finishClose: (() => void) | undefined;
    const close = jest
      .spyOn(net.Server.prototype, 'close')
      .mockImplementation(function (
        this: net.Server,
        callback?: (error?: Error) => void,
      ) {
        finishClose = () => {
          serverClose.call(this, callback);
        };
        return this;
      });
    try {
      const releasing = lock.release(id, first.nonce);
      await new Promise((resolve) => setImmediate(resolve));
      const result = await lock.acquire(id, {
        kind: 'desktop',
        hostname: 'local',
        pid: process.pid,
        label: 'test',
        acquiredAt: new Date().toISOString(),
        responding: true,
      });
      expect(result.ok).toBe(false);
      finishClose?.();
      expect(await releasing).toBe('released');
    } finally {
      close.mockRestore();
      finishClose?.();
      await lock.dispose();
    }
  });

  it('releases even when a holder query peer never closes or resets', async () => {
    const lock = new KernelSessionDriverLock();
    const id = `idle-peer-${process.pid}-${Date.now()}`;
    const first = await lock.acquire(id, {
      kind: 'desktop',
      hostname: 'local',
      pid: process.pid,
      label: 'test',
      acquiredAt: new Date().toISOString(),
      responding: true,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const endpoint = sessionDriverEndpoint(id);
    // Half-open peer: reads the holder line, never ends its side.
    const idle = net.createConnection({ path: endpoint, allowHalfOpen: true });
    idle.on('error', () => undefined);
    await new Promise<void>((resolve) => idle.once('data', () => resolve()));
    // Resetting peer: aborts while the holder line is being written.
    const reset = net.createConnection(endpoint);
    reset.on('error', () => undefined);
    reset.once('connect', () => reset.resetAndDestroy());
    try {
      expect(await lock.release(id, first.nonce)).toBe('released');
    } finally {
      idle.destroy();
      await lock.dispose();
    }
  }, 10000);
});

describe('Windows user endpoint identity', () => {
  it('ignores USERDOMAIN for session and control names', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    const previousDomain = process.env['USERDOMAIN'];
    try {
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: 'win32',
      });
      delete process.env['USERDOMAIN'];
      const session = sessionDriverEndpoint('stable-user');
      const control = controlEndpointName(12345);
      process.env['USERDOMAIN'] = 'DIFFERENT_DOMAIN';
      expect(sessionDriverEndpoint('stable-user')).toBe(session);
      expect(controlEndpointName(12345)).toBe(control);
    } finally {
      if (platform) Object.defineProperty(process, 'platform', platform);
      if (previousDomain === undefined) delete process.env['USERDOMAIN'];
      else process.env['USERDOMAIN'] = previousDomain;
    }
  });
});
