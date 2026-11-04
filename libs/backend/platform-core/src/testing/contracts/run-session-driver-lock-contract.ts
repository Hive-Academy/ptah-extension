import type {
  DriverHolder,
  ISessionDriverLock,
} from '../../interfaces/session-driver-lock.interface';

const owner: DriverHolder = {
  kind: 'desktop',
  hostname: 'contract-host',
  pid: process.pid,
  label: 'contract holder',
  acquiredAt: new Date().toISOString(),
  responding: true,
};

/** Shared lease semantics for the kernel and null adapters. */
export function runSessionDriverLockContract(
  name: string,
  factory: () => ISessionDriverLock,
): void {
  describe(`${name} session driver lock contract`, () => {
    let lock: ISessionDriverLock;
    beforeEach(() => {
      lock = factory();
    });
    afterEach(async () => {
      await lock.dispose();
    });

    it('acquires, re-enters and releases a session', async () => {
      const id = `contract-${process.pid}-${Date.now()}`;
      const first = await lock.acquire(id, owner);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const second = await lock.acquire(id, owner);
      expect(second).toEqual(first);
      expect(lock.held()).toEqual([
        expect.objectContaining({
          sessionId: id,
          state: 'held',
          nonce: first.nonce,
        }),
      ]);
      expect(await lock.release(id, 'wrong')).toBe('released');
      expect(lock.held()).toHaveLength(1);
      expect(await lock.release(id, first.nonce)).toBe('released');
      expect(lock.held()).toHaveLength(0);
    });

    it('annotates only with the matching nonce', async () => {
      const id = `contract-label-${process.pid}-${Date.now()}`;
      const result = await lock.acquire(id, owner, 'refresh');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      lock.annotate(id, 'wrong', 'incorrect');
      lock.annotate(id, result.nonce, 'updated');
      expect(lock.held()[0]).toEqual(
        expect.objectContaining({
          purpose: 'refresh',
          owner: expect.objectContaining({ label: 'updated' }),
        }),
      );
      expect((await lock.holder(id))?.label).toBe('updated');
    });
  });
}
