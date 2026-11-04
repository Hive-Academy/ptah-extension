import { runSessionDriverLockContract } from '../testing/contracts/run-session-driver-lock-contract';
import { KernelSessionDriverLock } from './kernel-session-driver-lock';
import { sessionDriverEndpoint } from './endpoint-names';
import * as net from 'node:net';
import type { DriverHolder } from '../interfaces/session-driver-lock.interface';

if (process.platform === 'linux' || process.platform === 'win32') {
  runSessionDriverLockContract('kernel', () => new KernelSessionDriverLock());
}

describe('session endpoint naming', () => {
  it('uses only OS user and session identity, not host or process identity (A6)', () => {
    if (process.platform !== 'linux' && process.platform !== 'win32') return;
    const endpoint = sessionDriverEndpoint('a-session-123');
    expect(endpoint).toContain('a-session-123');
    expect(endpoint).not.toContain(String(process.pid));
    if (process.platform === 'linux') expect(endpoint.startsWith('\0ptah-driver-')).toBe(true);
    if (process.platform === 'win32') expect(endpoint.startsWith('\\\\.\\pipe\\ptah-driver-')).toBe(true);
  });
});

(process.platform === 'linux' || process.platform === 'win32' ? describe : describe.skip)('stranded kernel release', () => {
  it('keeps a failed release visible, then retries it on the next acquisition', async () => {
    const lock = new KernelSessionDriverLock();
    const owner: DriverHolder = { kind: 'desktop', hostname: 'local', pid: process.pid, label: 'test', acquiredAt: new Date().toISOString(), responding: true };
    const first = await lock.acquire(`stranded-${process.pid}-${Date.now()}`, owner);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const id = lock.held()[0].sessionId;
    const close = jest.spyOn(net.Server.prototype, 'close').mockImplementation(function (this: net.Server, callback?: (error?: Error) => void) {
      callback?.(new Error('injected close failure'));
      return this;
    });
    try {
      expect(await lock.release(id, first.nonce)).toBe('stranded');
      expect(lock.held()).toEqual([expect.objectContaining({ sessionId: id, state: 'stranded' })]);
      expect((await lock.holder(id))?.label).toContain('release pending');
    } finally {
      close.mockRestore();
    }
    const second = await lock.acquire(`after-stranded-${process.pid}-${Date.now()}`, owner);
    expect(second.ok).toBe(true);
    expect(lock.held().find((entry) => entry.sessionId === id)).toBeUndefined();
    await lock.dispose();
  }, 10000);
});
