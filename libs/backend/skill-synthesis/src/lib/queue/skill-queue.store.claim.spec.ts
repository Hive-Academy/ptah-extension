/**
 * P0-2 — the claim is the at-most-once primitive.
 *
 * Two store instances, two distinct `claimed_by` worker ids, ONE file-backed
 * database. A file (not `:memory:`) because that is the shape of the real
 * hazard: a VS Code window and the Electron app both drain
 * `~/.ptah/state/ptah.sqlite` on the same cron minute. An in-memory database
 * would give each store its own private copy and the test would pass while
 * proving nothing.
 *
 * The contract under test: exactly one `tryClaim` returns a row, the other
 * returns `null` — and returning `null` is NOT an error. `JobRunner` treats the
 * cron equivalent (`SlotAlreadyClaimedError`) the same way: success-by-another-
 * worker, move on.
 */
import 'reflect-metadata';
import { SkillQueueStore } from './skill-queue.store';
import {
  asConnection,
  makeTempDbPath,
  noopLogger,
  openQueueDb,
  resolveOpener,
  type TestDatabase,
} from './queue-db.test-support';

const opener = resolveOpener();
const maybe = opener ? describe : describe.skip;

maybe('SkillQueueStore.tryClaim (P0-2)', () => {
  let dbA: TestDatabase;
  let dbB: TestDatabase;
  let storeA: SkillQueueStore;
  let storeB: SkillQueueStore;
  let queueId: string;

  beforeEach(() => {
    const file = makeTempDbPath();
    const open = opener as NonNullable<typeof opener>;
    dbA = openQueueDb(open, file);
    // A SECOND connection to the SAME file — the other window.
    dbB = openQueueDb(open, file);
    storeA = new SkillQueueStore(noopLogger, asConnection(dbA));
    storeB = new SkillQueueStore(noopLogger, asConnection(dbB));

    queueId =
      storeA.enqueue({
        sessionId: 'session-1',
        stage: 'prefilter',
        source: 'session-end',
        workspaceRoot: 'D:/repo-a',
        turnCount: 7,
      }).row?.id ?? '';
  });

  afterEach(() => {
    dbA.close();
    dbB.close();
  });

  it('lets exactly one of two workers claim the row', () => {
    const claimedByA = storeA.tryClaim(queueId, 'worker-a');
    const claimedByB = storeB.tryClaim(queueId, 'worker-b');

    const winners = [claimedByA, claimedByB].filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    expect(claimedByA?.claimedBy).toBe('worker-a');
    expect(claimedByB).toBeNull();
  });

  it('does not throw when it loses the race', () => {
    storeA.tryClaim(queueId, 'worker-a');
    expect(() => storeB.tryClaim(queueId, 'worker-b')).not.toThrow();
  });

  it('the loser sees the winner across the connection boundary', () => {
    storeA.tryClaim(queueId, 'worker-a', 1_770_000_000_000);

    const asSeenByB = storeB.findById(queueId);
    expect(asSeenByB).toMatchObject({
      status: 'claimed',
      claimedBy: 'worker-a',
      claimedAt: 1_770_000_000_000,
    });
  });

  it('increments attempt_count once per successful claim only', () => {
    storeA.tryClaim(queueId, 'worker-a');
    storeB.tryClaim(queueId, 'worker-b');
    expect(storeA.findById(queueId)?.attemptCount).toBe(1);

    // Back to queued, then claimed again: the second attempt counts.
    storeA.reapStale(0, Date.now() + 60_000);
    storeB.tryClaim(queueId, 'worker-b');
    expect(storeA.findById(queueId)?.attemptCount).toBe(2);
  });

  it('claims an unscored row — that is what makes the backoff retryable', () => {
    storeA.markUnscored(queueId, { reason: 'no verdict', notBefore: 0 });
    expect(storeB.tryClaim(queueId, 'worker-b')?.status).toBe('claimed');
  });

  it('refuses to claim a row in any terminal, non-retryable status', () => {
    storeA.markDone(queueId);
    expect(storeB.tryClaim(queueId, 'worker-b')).toBeNull();

    storeA.markFailed(queueId, 'boom');
    expect(storeB.tryClaim(queueId, 'worker-b')).toBeNull();

    storeA.markSkipped(queueId);
    expect(storeB.tryClaim(queueId, 'worker-b')).toBeNull();
  });

  it('returns null for a row that does not exist', () => {
    expect(storeA.tryClaim('no-such-id', 'worker-a')).toBeNull();
  });
});
