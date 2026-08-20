/**
 * The re-open and the payload re-point are ONE transaction.
 *
 * ## The defect this pins
 *
 * A producer re-points a re-opened gate row at the candidate the current pass
 * produced. That used to be two store calls — `enqueue`, then `mergePayload` —
 * and therefore two `BEGIN IMMEDIATE` blocks. Between the two commits the row
 * was `queued` carrying the PREVIOUS pass's `candidateId`, and `CLAIM_SQL`
 * gates on `status` alone. A second host draining the shared
 * `~/.ptah/state/ptah.sqlite` could claim it in that window, read the stale id
 * and grade a SUPERSEDED candidate, then `markDone` the row — so the candidate
 * that should have been measured never was, and would not be retried until the
 * session grew again. No error, no reason token, a plausible verdict on the
 * wrong row.
 *
 * ## Why two connections and a file
 *
 * Same shape as `skill-queue.store.claim.spec.ts` (P0-2): TWO
 * `SkillQueueStore` instances with distinct `claimed_by`, over ONE file-backed
 * database. An in-memory database gives each store a private copy and the test
 * passes while proving nothing.
 *
 * ## The interleaving is DETERMINISTIC, and here is exactly what it is
 *
 * It is not OS-thread concurrency — Jest runs one thread and both bindings are
 * synchronous. It is a hook on store A's `exec` that fires the other host's
 * `tryClaim` at a chosen STATEMENT BOUNDARY: after A's first `COMMIT`, or in
 * the middle of A's open transaction. Those two boundaries are the only ones
 * that exist. The claim it fires is a real `BEGIN IMMEDIATE` … `COMMIT` on a
 * SECOND connection against the same file, so what it observes is whatever
 * SQLite had actually committed at that instant — not a simulation of it.
 *
 * Pinning the boundary rather than racing for it is what makes the test
 * deterministic instead of merely likely; a wall-clock race would reproduce the
 * defect rarely and pass for the wrong reason far more often than it failed.
 */
import 'reflect-metadata';
import { SkillQueueStore } from './skill-queue.store';
import type { EnqueueInput, SkillQueueRow } from './skill-queue.types';
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

const SESSION = 'session-1';
const STAGE = 'judge-panel';

function input(overrides: Partial<EnqueueInput> = {}): EnqueueInput {
  return {
    sessionId: SESSION,
    stage: STAGE,
    source: 'session-end',
    workspaceRoot: 'D:/repo-a',
    turnCount: 5,
    ...overrides,
  };
}

maybe('SkillQueueStore — re-open and re-point are one transaction', () => {
  let dbA: TestDatabase;
  let dbB: TestDatabase;
  let storeA: SkillQueueStore;
  let storeB: SkillQueueStore;
  let queueId: string;

  /** Fired once, after the NEXT matching statement store A executes. */
  let onStatement: { match: RegExp; run: () => void } | null = null;

  beforeEach(() => {
    const file = makeTempDbPath();
    const open = opener as NonNullable<typeof opener>;
    dbA = openQueueDb(open, file);
    // A SECOND connection to the SAME file — the other window.
    dbB = openQueueDb(open, file);

    const hookedA: TestDatabase = {
      exec: (sql: string) => {
        dbA.exec(sql);
        const hook = onStatement;
        if (hook && hook.match.test(sql)) {
          onStatement = null;
          hook.run();
        }
      },
      prepare: (sql: string) => dbA.prepare(sql),
      close: () => dbA.close(),
    };

    storeA = new SkillQueueStore(noopLogger, asConnection(hookedA));
    storeB = new SkillQueueStore(noopLogger, asConnection(dbB));

    queueId =
      storeA.enqueue(input({ payload: { candidateId: 'cand-1' } })).row?.id ??
      '';
    storeA.markDone(queueId);
    onStatement = null;
  });

  afterEach(() => {
    onStatement = null;
    dbA.close();
    dbB.close();
  });

  it('a second host claiming at the re-open commit sees the NEW candidate', () => {
    let claimed: SkillQueueRow | null = null;
    // The earliest instant the other host can see the row as re-opened.
    onStatement = {
      match: /^\s*COMMIT/i,
      run: () => {
        claimed = storeB.tryClaim(queueId, 'worker-b');
      },
    };

    storeA.enqueue(input({ turnCount: 9, payload: { candidateId: 'cand-2' } }));

    // It really did claim — otherwise the assertion below is vacuous.
    expect(claimed).not.toBeNull();
    expect(claimed).toMatchObject({ status: 'claimed', claimedBy: 'worker-b' });
    expect((claimed as unknown as SkillQueueRow).payload).toEqual({
      candidateId: 'cand-2',
    });
    // Stated the other way round, because this is the whole defect: the other
    // host must never be handed the superseded candidate.
    expect((claimed as unknown as SkillQueueRow).payload).not.toEqual({
      candidateId: 'cand-1',
    });
  });

  it('mid-transaction the row is still terminal, so there is no earlier window', () => {
    // The complement of the test above. If the re-open were visible before the
    // re-point committed, "claimed at the commit" would not be the whole story.
    // A plain read on connection B (never blocked under WAL) proves the
    // transaction boundary is real rather than assumed.
    let seenMidTransaction: SkillQueueRow | null = null;
    onStatement = {
      match: /^\s*BEGIN IMMEDIATE/i,
      run: () => {
        seenMidTransaction = storeB.findById(queueId);
      },
    };

    storeA.enqueue(input({ turnCount: 9, payload: { candidateId: 'cand-2' } }));

    expect(seenMidTransaction).toMatchObject({
      // `CLAIM_SQL` matches `queued`/`unscored` only, so a row still `done` is
      // not claimable at all — the stale id is unreachable, not merely unlikely.
      status: 'done',
      payload: { candidateId: 'cand-1' },
    });
  });

  it('opens exactly ONE transaction for the re-open and the re-point', () => {
    // The structural half. The interleaving tests say the window is closed;
    // this says WHY, and it fails the moment anyone splits the write back into
    // two commits, whichever side of the store boundary they split it on.
    const begins: string[] = [];
    const counting: TestDatabase = {
      exec: (sql: string) => {
        if (/^\s*BEGIN/i.test(sql)) begins.push(sql);
        dbA.exec(sql);
      },
      prepare: (sql: string) => dbA.prepare(sql),
      close: () => dbA.close(),
    };
    const store = new SkillQueueStore(noopLogger, asConnection(counting));

    store.enqueue(input({ turnCount: 9, payload: { candidateId: 'cand-2' } }));

    expect(begins).toHaveLength(1);
    expect(store.findById(queueId)?.payload).toEqual({
      candidateId: 'cand-2',
    });
  });

  it('the merge is not a clear — a stage output the producer never named survives', () => {
    // Guarding the distinction the `REOPEN_SQL` header exists to protect, at
    // the point where the two hosts can actually see each other: whatever the
    // other host claims must carry BOTH owners' keys.
    storeB.mergePayload(queueId, { verdictFallback: true });

    let claimed: SkillQueueRow | null = null;
    onStatement = {
      match: /^\s*COMMIT/i,
      run: () => {
        claimed = storeB.tryClaim(queueId, 'worker-b');
      },
    };

    storeA.enqueue(input({ turnCount: 9, payload: { candidateId: 'cand-2' } }));

    expect((claimed as unknown as SkillQueueRow | null)?.payload).toEqual({
      candidateId: 'cand-2',
      verdictFallback: true,
    });
  });
});
