import { NamedAdmissionSettlements } from './named-admission-settlements';
import type { SettleableNamedAdmission } from './named-admission-settlements';

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * A flow like the real one: dispose returns one shared settlement, and
 * `terminal` resolves (never rejects) once that settlement has settled.
 */
function flow(settlement: Promise<void>): SettleableNamedAdmission & { dispose: jest.Mock } {
  return {
    dispose: jest.fn(() => settlement),
    terminal: settlement.then(
      () => undefined,
      () => undefined,
    ),
  };
}

async function flushMicrotasks(turns = 10): Promise<void> {
  for (let i = 0; i < turns; i += 1) await Promise.resolve();
}

describe('NamedAdmissionSettlements', () => {
  const logger = { warn: jest.fn() };

  beforeEach(() => logger.warn.mockReset());

  it('waits for every tracked flow to settle at shutdown', async () => {
    const settlements = new NamedAdmissionSettlements(logger);
    const first = deferred();
    const second = deferred();
    const a = flow(first.promise);
    const b = flow(second.promise);
    settlements.track(a);
    settlements.track(b);

    let done = false;
    const drained = settlements.settleAll().then(() => {
      done = true;
    });
    await flushMicrotasks();
    expect(a.dispose).toHaveBeenCalled();
    expect(b.dispose).toHaveBeenCalled();
    expect(done).toBe(false);

    first.resolve();
    await flushMicrotasks();
    expect(done).toBe(false);

    second.resolve();
    await drained;
    expect(done).toBe(true);
    expect(settlements.size).toBe(0);
  });

  it('untracks a flow when it settles on its own, on any completion path', async () => {
    const settlements = new NamedAdmissionSettlements(logger);
    for (let turn = 0; turn < 5; turn += 1) {
      const release = deferred();
      settlements.track(flow(release.promise));
      expect(settlements.size).toBe(1);
      release.resolve();
      await flushMicrotasks();
      expect(settlements.size).toBe(0);
    }
  });

  it('keeps a flow tracked until its terminal resolves', async () => {
    const settlements = new NamedAdmissionSettlements(logger);
    const release = deferred();
    settlements.track(flow(release.promise));
    await flushMicrotasks();
    expect(settlements.size).toBe(1);

    release.resolve();
    await flushMicrotasks();
    expect(settlements.size).toBe(0);
  });

  it('waits for a flow whose first dispose resolves before a late reservation settles', async () => {
    const settlements = new NamedAdmissionSettlements(logger);
    const late = deferred();
    let reserved = false;
    // First dispose: no reservation yet. Once the late one exists, dispose returns its settlement.
    const named: SettleableNamedAdmission & { dispose: jest.Mock } = {
      dispose: jest.fn(() => (reserved ? late.promise : Promise.resolve())),
      terminal: late.promise,
    };
    settlements.track(named);

    let done = false;
    const drained = settlements.settleAll().then(() => {
      done = true;
    });
    await flushMicrotasks();
    expect(done).toBe(false);

    reserved = true;
    late.resolve();
    await drained;
    expect(named.dispose).toHaveBeenCalledTimes(2);
    expect(settlements.size).toBe(0);
  });

  it('refuses to track any flow once shutdown has closed admission', async () => {
    const settlements = new NamedAdmissionSettlements(logger);
    expect(settlements.isClosed).toBe(false);
    const drained = settlements.settleAll();
    expect(settlements.isClosed).toBe(true);

    // A flow arriving during the drain is refused, never left holding a lease.
    const arriving = flow(Promise.resolve());
    expect(settlements.track(arriving)).toBe(false);
    expect(settlements.size).toBe(0);
    await drained;
    expect(arriving.dispose).not.toHaveBeenCalled();
  });

  it('logs a rejected settlement and still resolves', async () => {
    const settlements = new NamedAdmissionSettlements(logger);
    const failed = deferred();
    const ok = flow(Promise.resolve());
    settlements.track(flow(failed.promise));
    settlements.track(ok);

    const drained = settlements.settleAll();
    failed.reject(new Error('release write failed'));

    await expect(drained).resolves.toBeUndefined();
    expect(ok.dispose).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      '[SessionLifecycle] Named account settlement failed at shutdown',
      expect.objectContaining({ message: 'release write failed' }),
    );
    expect(settlements.size).toBe(0);
  });
});
