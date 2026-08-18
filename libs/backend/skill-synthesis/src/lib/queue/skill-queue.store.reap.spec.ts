/**
 * P0-3 — stale-claim reaping, and the heartbeat that must defeat it (R5).
 *
 * A process killed mid-stage leaves its row `claimed` forever, so the drain has
 * to reclaim old claims. The hazard is the mirror image: the Phase-2
 * archaeologist makes several LLM round trips and can legitimately hold a claim
 * for minutes. If the TTL reaps it mid-flight, two workers run the same stage
 * and the queue's at-most-once guarantee is gone.
 *
 * `touchClaim` is the resolution, and the second test here is the one that pins
 * it. It also pins the other half of the contract: `touchClaim` returns `false`
 * once the row is no longer claimed, which is how a worker that HAS been reaped
 * learns it must stop.
 */
import 'reflect-metadata';
import { SkillQueueStore, STALE_CLAIM_REASON } from './skill-queue.store';
import {
  asConnection,
  makeTempDbPath,
  noopLogger,
  openQueueDb,
  resolveOpener,
  type TestDatabase,
} from './queue-db.test-support';

const TTL_MS = 900_000; // the shipped `skillSynthesis.drain.staleClaimTtlMs`
const T0 = 1_770_000_000_000;

const opener = resolveOpener();
const maybe = opener ? describe : describe.skip;

maybe('SkillQueueStore.reapStale (P0-3)', () => {
  let db: TestDatabase;
  let store: SkillQueueStore;
  let queueId: string;

  beforeEach(() => {
    db = openQueueDb(opener as NonNullable<typeof opener>, makeTempDbPath());
    store = new SkillQueueStore(noopLogger, asConnection(db));
    queueId =
      store.enqueue({
        sessionId: 'session-1',
        stage: 'archaeology',
        source: 'session-end',
        workspaceRoot: 'D:/repo-a',
        turnCount: 7,
      }).row?.id ?? '';
  });

  afterEach(() => db.close());

  it('reclaims a claim older than the TTL', () => {
    store.tryClaim(queueId, 'worker-dead', T0);

    const reaped = store.reapStale(TTL_MS, T0 + TTL_MS + 1);

    expect(reaped).toBe(1);
    expect(store.findById(queueId)).toMatchObject({
      status: 'queued',
      claimedBy: null,
      claimedAt: null,
      reason: STALE_CLAIM_REASON,
    });
  });

  it('leaves a heartbeated claim alone — the R5 guarantee', () => {
    store.tryClaim(queueId, 'worker-alive', T0);

    // The archaeologist finishes a retrieval pass and heartbeats, then the
    // reaper runs at the same instant the un-touched claim would have died.
    const touched = store.touchClaim(queueId, T0 + TTL_MS - 1);
    const reaped = store.reapStale(TTL_MS, T0 + TTL_MS + 1);

    expect(touched).toBe(true);
    expect(reaped).toBe(0);
    expect(store.findById(queueId)).toMatchObject({
      status: 'claimed',
      claimedBy: 'worker-alive',
      claimedAt: T0 + TTL_MS - 1,
    });
  });

  it('reaps a claim whose heartbeat then stopped', () => {
    store.tryClaim(queueId, 'worker-stalled', T0);
    store.touchClaim(queueId, T0 + 1_000);

    expect(store.reapStale(TTL_MS, T0 + 1_000 + TTL_MS + 1)).toBe(1);
    expect(store.findById(queueId)?.status).toBe('queued');
  });

  it('tells a reaped worker it lost the row', () => {
    store.tryClaim(queueId, 'worker-dead', T0);
    store.reapStale(TTL_MS, T0 + TTL_MS + 1);

    expect(store.touchClaim(queueId, T0 + TTL_MS + 2)).toBe(false);
  });

  it('never touches a queued or a finished row', () => {
    const finished =
      store.enqueue({
        sessionId: 'session-2',
        stage: 'synthesis',
        source: 'idle',
        workspaceRoot: 'D:/repo-a',
      }).row?.id ?? '';
    store.markDone(finished, { finishedAt: T0 });

    expect(store.reapStale(TTL_MS, T0 + TTL_MS + 1)).toBe(0);
    expect(store.findById(finished)?.status).toBe('done');
    expect(store.findById(queueId)?.status).toBe('queued');
  });

  it('leaves a reclaimed row immediately eligible again', () => {
    store.tryClaim(queueId, 'worker-dead', T0);
    store.reapStale(TTL_MS, T0 + TTL_MS + 1);

    const eligible = store.listEligible('D:/repo-a', 10, T0 + TTL_MS + 1);
    expect(eligible.map((r) => r.id)).toEqual([queueId]);
    // The reclaim preserved the attempt already spent, so `maxAttempts` still
    // terminates a row that repeatedly kills its worker.
    expect(eligible[0].attemptCount).toBe(1);
  });
});
