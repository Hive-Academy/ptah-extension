import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

export async function locksCommand(
  action: 'list' | 'release' | 'self-test',
  sessionId?: string,
  confirmed = false,
): Promise<unknown> {
  const { KernelSessionDriverLock, listLocalDriverLocks, requestRelease } =
    await import('@ptah-extension/platform-core');
  if (action === 'list') return listLocalDriverLocks();
  if (action === 'self-test') {
    const lock = new KernelSessionDriverLock(() => false);
    const id = `worker-self-test-${randomUUID()}`;
    try {
      const acquisition = await lock.acquire(id, {
        kind: 'worker',
        hostname: hostname(),
        pid: process.pid,
        label: 'ptah-worker self-test',
        acquiredAt: new Date().toISOString(),
        responding: true,
      });
      if (!acquisition.ok) throw new Error('Driver lock acquisition failed');
      const listing = await listLocalDriverLocks();
      const visible = listing.some(
        (entry) =>
          entry.ok && entry.locks.some((item) => item.sessionId === id),
      );
      if (!visible)
        throw new Error('Driver lock control endpoint is unavailable');
      const release = await requestRelease(id);
      if (release !== 'released')
        throw new Error(`Driver lock release ${release}`);
      return { ok: true };
    } finally {
      await lock.dispose();
    }
  }
  if (!sessionId) throw new Error('Session ID is required');
  if (!confirmed) throw new Error('Confirm lock release with --yes');
  const result = await requestRelease(sessionId);
  if (result === 'unavailable' || result === 'in-use')
    throw new Error(`Lock release ${result}`);
  return { sessionId, result };
}
