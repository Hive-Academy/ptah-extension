/**
 * SkillQueueStore — enqueue idempotency, the guarded re-open, and the reads the
 * drain is built on.
 *
 * The re-open is the assertion that matters most here. `SkillSynthesisService`
 * today keeps a `Map<sessionId, highest analyzed turn count>` — NOT a seen-set —
 * so a session that grows is legitimately re-analyzed. A naive "already
 * processed?" check would silently drop that, and the drop would be invisible:
 * no error, just skills that never get synthesized from long sessions. So these
 * tests pin both directions — grown re-opens, un-grown does not.
 */
import 'reflect-metadata';
import { SkillQueueStore, STALE_CLAIM_REASON } from './skill-queue.store';
import {
  SKILL_QUEUE_STAGES,
  SKILL_QUEUE_STATUSES,
  type EnqueueInput,
} from './skill-queue.types';
import {
  asConnection,
  makeTempDbPath,
  noopLogger,
  openQueueDb,
  resolveOpener,
  sql0032,
  type TestDatabase,
} from './queue-db.test-support';

describe('skill-queue types match migration 0032', () => {
  function checkMembers(column: string): string[] {
    const match = new RegExp(
      'CHECK \\(' + column + ' IN \\(([^)]*)\\)\\)',
      'i',
    ).exec(sql0032);
    expect(match).not.toBeNull();
    return Array.from((match as RegExpExecArray)[1].matchAll(/'([^']*)'/g)).map(
      (m) => m[1],
    );
  }

  it('declares exactly the eleven stages the CHECK accepts', () => {
    expect([...SKILL_QUEUE_STAGES].sort()).toEqual(
      checkMembers('stage').sort(),
    );
  });

  it('declares exactly the seven statuses the CHECK accepts', () => {
    expect([...SKILL_QUEUE_STATUSES].sort()).toEqual(
      checkMembers('status').sort(),
    );
  });
});

const opener = resolveOpener();
const maybe = opener ? describe : describe.skip;

maybe('SkillQueueStore', () => {
  let db: TestDatabase;
  let store: SkillQueueStore;

  beforeEach(() => {
    db = openQueueDb(opener as NonNullable<typeof opener>, makeTempDbPath());
    store = new SkillQueueStore(noopLogger, asConnection(db));
  });

  afterEach(() => db.close());

  function input(overrides: Partial<EnqueueInput> = {}): EnqueueInput {
    return {
      sessionId: 'session-1',
      stage: 'prefilter',
      source: 'session-end',
      workspaceRoot: 'D:/repo-a',
      turnCount: 5,
      ...overrides,
    };
  }

  describe('enqueue', () => {
    it('inserts a queued row carrying every field it was given', () => {
      const result = store.enqueue(
        input({
          transcriptPath: 'D:/t.jsonl',
          lane: 'archaeologist',
          payload: { attemptHint: 1 },
          enqueuedAt: 1_770_000_000_000,
        }),
      );

      expect(result.outcome).toBe('created');
      expect(result.row).toMatchObject({
        sessionId: 'session-1',
        stage: 'prefilter',
        source: 'session-end',
        workspaceRoot: 'D:/repo-a',
        status: 'queued',
        turnCount: 5,
        attemptCount: 0,
        notBefore: 0,
        transcriptPath: 'D:/t.jsonl',
        lane: 'archaeologist',
        claimedBy: null,
        claimedAt: null,
        payload: { attemptHint: 1 },
        enqueuedAt: 1_770_000_000_000,
      });
    });

    it('is idempotent: a second enqueue of a live row creates nothing', () => {
      const first = store.enqueue(input());
      const second = store.enqueue(input());

      expect(second.outcome).toBe('unchanged');
      expect(second.row?.id).toBe(first.row?.id);
      expect(countRows(db)).toBe(1);
    });

    it('never disturbs an in-flight row, even when the session grew', () => {
      const created = store.enqueue(input({ turnCount: 5 }));
      store.tryClaim(created.row?.id ?? '', 'worker-a');

      const again = store.enqueue(input({ turnCount: 99 }));

      expect(again.outcome).toBe('unchanged');
      expect(again.row?.status).toBe('claimed');
      expect(again.row?.claimedBy).toBe('worker-a');
      expect(again.row?.turnCount).toBe(5);
    });

    it('re-opens a finished row once the session has GROWN', () => {
      const created = store.enqueue(input({ turnCount: 5 }));
      store.markDone(created.row?.id ?? '', { candidateId: 'cand-1' });

      const reopened = store.enqueue(input({ turnCount: 9 }));

      expect(reopened.outcome).toBe('reopened');
      expect(reopened.row).toMatchObject({
        id: created.row?.id,
        status: 'queued',
        turnCount: 9,
        attemptCount: 0,
        notBefore: 0,
        claimedBy: null,
        claimedAt: null,
        finishedAt: null,
        lastError: null,
      });
      // The candidate the earlier run produced is deliberately preserved.
      expect(reopened.row?.candidateId).toBe('cand-1');
      expect(countRows(db)).toBe(1);
    });

    it('does NOT re-open a finished row at the same or lower turn count', () => {
      const created = store.enqueue(input({ turnCount: 5 }));
      store.markDone(created.row?.id ?? '');

      expect(store.enqueue(input({ turnCount: 5 })).outcome).toBe('unchanged');
      expect(store.enqueue(input({ turnCount: 4 })).outcome).toBe('unchanged');
      expect(store.findById(created.row?.id ?? '')?.status).toBe('done');
    });

    it.each(['failed', 'unscored', 'skipped'] as const)(
      're-opens a %s row when the session grew',
      (status) => {
        const created = store.enqueue(input({ turnCount: 5 }));
        const id = created.row?.id ?? '';
        if (status === 'failed') store.markFailed(id, 'boom');
        if (status === 'unscored') store.markUnscored(id, { notBefore: 999 });
        if (status === 'skipped') store.markSkipped(id, { reason: 'thin' });

        const reopened = store.enqueue(input({ turnCount: 6 }));

        expect(reopened.outcome).toBe('reopened');
        expect(reopened.row?.status).toBe('queued');
        expect(reopened.row?.notBefore).toBe(0);
        expect(reopened.row?.lastError).toBeNull();
      },
    );

    it('keeps one row per (session, stage) pair, not per session', () => {
      store.enqueue(input({ stage: 'prefilter' }));
      store.enqueue(input({ stage: 'synthesis' }));
      expect(countRows(db)).toBe(2);
    });
  });

  describe('terminal transitions', () => {
    it('markDone / markFailed / markUnscored / markSkipped set their status', () => {
      const rows = {
        done: store.enqueue(input({ sessionId: 's-done' })).row,
        failed: store.enqueue(input({ sessionId: 's-failed' })).row,
        unscored: store.enqueue(input({ sessionId: 's-unscored' })).row,
        skipped: store.enqueue(input({ sessionId: 's-skipped' })).row,
      };
      store.markDone(rows.done?.id ?? '');
      store.markFailed(rows.failed?.id ?? '', 'rate limited');
      store.markUnscored(rows.unscored?.id ?? '', {
        reason: 'no verdict',
        notBefore: 1_770_000_100_000,
      });
      store.markSkipped(rows.skipped?.id ?? '', { reason: 'too thin' });

      expect(store.findById(rows.done?.id ?? '')?.status).toBe('done');
      expect(store.findById(rows.failed?.id ?? '')?.lastError).toBe(
        'rate limited',
      );
      const unscored = store.findById(rows.unscored?.id ?? '');
      expect(unscored?.status).toBe('unscored');
      expect(unscored?.notBefore).toBe(1_770_000_100_000);
      expect(store.findById(rows.skipped?.id ?? '')?.reason).toBe('too thin');
    });
  });

  describe('requeue — the transport retry, NOT a terminal mark', () => {
    function claimed(overrides: Partial<EnqueueInput> = {}): string {
      const id = store.enqueue(input(overrides)).row?.id ?? '';
      store.tryClaim(id, 'worker-a', 1_000);
      return id;
    }

    it('returns the row to queued behind the backoff, with the reason surfaced', () => {
      const id = claimed();

      expect(
        store.requeue(id, 1_770_000_500_000, 'Lane judge: timed out'),
      ).toBe(true);

      expect(store.findById(id)).toMatchObject({
        status: 'queued',
        notBefore: 1_770_000_500_000,
        reason: 'Lane judge: timed out',
        claimedBy: null,
        claimedAt: null,
        finishedAt: null,
      });
    });

    it('does NOT mark the row unscored — that status is the judge s verdict', () => {
      // Overloading `unscored` would make the Activity surface unable to tell a
      // model that declined to score from an endpoint that never answered.
      const id = claimed();
      store.requeue(id, 5_000, 'Lane judge: endpoint unreachable');

      expect(store.findById(id)?.status).not.toBe('unscored');
      expect(store.findById(id)?.status).toBe('queued');
    });

    it('leaves the row re-eligible once not_before passes', () => {
      const id = claimed();
      store.requeue(id, 5_000, 'Lane synthesis: timed out');

      expect(store.listEligible('D:/repo-a', 10, 4_999)).toHaveLength(0);
      expect(
        store.listEligible('D:/repo-a', 10, 5_000).map((r) => r.id),
      ).toEqual([id]);
    });

    it('keeps the attempt count the claim already incremented', () => {
      // The backoff ladder is `2^attempt`; resetting the counter here would flatten
      // it and hammer a dead endpoint at 60 s forever.
      const id = claimed();
      expect(store.findById(id)?.attemptCount).toBe(1);

      store.requeue(id, 0, 'Lane judge: timed out');
      expect(store.findById(id)?.attemptCount).toBe(1);

      store.tryClaim(id, 'worker-a', 2_000);
      expect(store.findById(id)?.attemptCount).toBe(2);
    });

    it('preserves last_error, which is diagnostic and not user-facing', () => {
      // Clearing it on every retry would erase the trail of what the earlier
      // attempts actually hit, which is the only thing that field is for.
      const id = store.enqueue(input()).row?.id ?? '';
      db.prepare(
        'UPDATE skill_synthesis_queue SET last_error = ? WHERE id = ?',
      ).run('ECONNRESET', id);
      store.tryClaim(id, 'worker-a', 1_000);

      store.requeue(id, 0, 'Lane judge: timed out');

      expect(store.findById(id)?.lastError).toBe('ECONNRESET');
      expect(store.findById(id)?.reason).toBe('Lane judge: timed out');
    });

    it.each(['queued', 'done', 'failed', 'unscored', 'skipped'] as const)(
      'is a no-op on a %s row the caller does not hold',
      (status) => {
        const id = store.enqueue(input()).row?.id ?? '';
        if (status !== 'queued') {
          store.tryClaim(id, 'worker-a', 1_000);
          if (status === 'done') store.markDone(id);
          if (status === 'failed') store.markFailed(id, 'boom');
          if (status === 'unscored') store.markUnscored(id, { notBefore: 42 });
          if (status === 'skipped') store.markSkipped(id, { reason: 'thin' });
        }

        expect(store.requeue(id, 9_999, 'Lane judge: timed out')).toBe(false);
        expect(store.findById(id)?.status).toBe(status);
        expect(store.findById(id)?.reason).not.toBe('Lane judge: timed out');
      },
    );

    it('is a no-op for a worker whose claim was already reaped', () => {
      // The same lost-the-row contract `touchClaim` returns a boolean for:
      // `reapStale` put the row back to `queued`, so the reaped worker's
      // requeue must not overwrite the reap reason or push out `not_before`.
      const id = claimed();
      expect(store.reapStale(0, 60_000)).toBe(1);

      expect(store.requeue(id, 9_999, 'Lane judge: timed out')).toBe(false);
      expect(store.findById(id)).toMatchObject({
        status: 'queued',
        notBefore: 0,
        reason: STALE_CLAIM_REASON,
      });
    });
  });

  describe('mergePayload — the only writer of the column after INSERT', () => {
    function payloadOf(id: string): string {
      const row = db
        .prepare('SELECT payload FROM skill_synthesis_queue WHERE id = ?')
        .get(id) as { payload: string };
      return row.payload;
    }

    it('keeps every key the patch does not name', () => {
      // A blind overwrite would delete `candidateId`, which is the INPUT the
      // handler was dispatched with — the row would still be dispatched, and
      // would have nothing to grade.
      const id =
        store.enqueue(
          input({
            stage: 'replay',
            payload: { candidateId: 'cand-1', clusterSessionIds: ['s-a'] },
          }),
        ).row?.id ?? '';

      store.mergePayload(id, { verdictFallback: true });

      expect(store.findById(id)?.payload).toEqual({
        candidateId: 'cand-1',
        clusterSessionIds: ['s-a'],
        verdictFallback: true,
      });
    });

    it('lets the patch win on a key that already exists', () => {
      const id =
        store.enqueue(input({ payload: { verdictFallback: true } })).row?.id ??
        '';

      store.mergePayload(id, { verdictFallback: false });

      expect(store.findById(id)?.payload).toEqual({ verdictFallback: false });
    });

    it('merges twice without appending — the column stays one object', () => {
      const id = store.enqueue(input({ payload: { a: 1 } })).row?.id ?? '';

      store.mergePayload(id, { b: 2 });
      store.mergePayload(id, { c: 3 });

      expect(store.findById(id)?.payload).toEqual({ a: 1, b: 2, c: 3 });
      expect(JSON.parse(payloadOf(id))).toEqual({ a: 1, b: 2, c: 3 });
    });

    it('degrades an unparseable stored payload instead of throwing', () => {
      // MUTATION TARGET. Reuse of `parsePayload` is what makes this pass —
      // swap it for a bare `JSON.parse` and the throw escapes into the stage
      // handler, and from there into `drain()`, which must never throw.
      const id = store.enqueue(input()).row?.id ?? '';
      db.prepare(
        'UPDATE skill_synthesis_queue SET payload = ? WHERE id = ?',
      ).run('{not json', id);

      expect(() =>
        store.mergePayload(id, { verdictFallback: true }),
      ).not.toThrow();
      expect(store.findById(id)?.payload).toEqual({ verdictFallback: true });
    });

    it('degrades a payload that parses to a non-object', () => {
      // `parsePayload` accepts only a plain object: an array or a bare number
      // has no keys to merge onto and spreading it would produce `{"0": ...}`.
      const id = store.enqueue(input()).row?.id ?? '';
      db.prepare(
        'UPDATE skill_synthesis_queue SET payload = ? WHERE id = ?',
      ).run('[1,2,3]', id);

      store.mergePayload(id, { candidateId: 'cand-1' });

      expect(store.findById(id)?.payload).toEqual({ candidateId: 'cand-1' });
    });

    it('is a silent no-op for a row that does not exist', () => {
      expect(() => store.mergePayload('no-such-row', { a: 1 })).not.toThrow();
      expect(countRows(db)).toBe(0);
    });

    it('re-points a re-opened row at the payload THIS pass named', () => {
      // One call, and the row is never visible carrying `cand-1` again. It took
      // two before — `enqueue` then `mergePayload` — and the gap between those
      // two transactions was a window another host could claim the row in.
      const id =
        store.enqueue(
          input({ turnCount: 5, payload: { candidateId: 'cand-1' } }),
        ).row?.id ?? '';
      store.markDone(id);

      const reopened = store.enqueue(
        input({ turnCount: 9, payload: { candidateId: 'cand-2' } }),
      );

      expect(reopened.outcome).toBe('reopened');
      expect(reopened.row?.payload).toEqual({ candidateId: 'cand-2' });
      expect(store.findById(id)?.payload).toEqual({ candidateId: 'cand-2' });
    });

    it('MERGES on re-open — it does not clear, and it does not overwrite', () => {
      // The distinction the `REOPEN_SQL` header exists to protect. A stage
      // OUTPUT the producer never named survives the re-open untouched; only
      // the keys this pass named move. Clearing would hand the handler a row
      // with no candidate to grade, which is the dead row that decision
      // rejected.
      const id =
        store.enqueue(
          input({ turnCount: 5, payload: { candidateId: 'cand-1' } }),
        ).row?.id ?? '';
      store.mergePayload(id, { verdictFallback: true });
      store.markDone(id);

      store.enqueue(
        input({ turnCount: 9, payload: { candidateId: 'cand-2' } }),
      );

      expect(store.findById(id)?.payload).toEqual({
        candidateId: 'cand-2',
        verdictFallback: true,
      });
    });

    it('leaves the payload alone when the re-open names none', () => {
      // Three of the four production callers pass no payload. A re-open must
      // not touch a column no producer named.
      const id =
        store.enqueue(
          input({ turnCount: 5, payload: { candidateId: 'cand-1' } }),
        ).row?.id ?? '';
      store.markDone(id);

      const reopened = store.enqueue(input({ turnCount: 9 }));

      expect(reopened.outcome).toBe('reopened');
      expect(store.findById(id)?.payload).toEqual({ candidateId: 'cand-1' });
    });

    it('writes no payload on an `unchanged` enqueue', () => {
      // The session did not grow, so nothing re-opened and nothing may move.
      const id =
        store.enqueue(
          input({ turnCount: 9, payload: { candidateId: 'cand-1' } }),
        ).row?.id ?? '';
      store.markDone(id);

      const again = store.enqueue(
        input({ turnCount: 9, payload: { candidateId: 'cand-2' } }),
      );

      expect(again.outcome).toBe('unchanged');
      expect(store.findById(id)?.payload).toEqual({ candidateId: 'cand-1' });
    });
  });

  describe('drain reads', () => {
    it('lists eligible rows oldest-first and honours not_before', () => {
      store.enqueue(
        input({ sessionId: 'old', stage: 'prefilter', enqueuedAt: 100 }),
      );
      store.enqueue(
        input({ sessionId: 'new', stage: 'prefilter', enqueuedAt: 200 }),
      );
      store.enqueue(
        input({
          sessionId: 'backed-off',
          stage: 'prefilter',
          enqueuedAt: 50,
          notBefore: 5_000,
        }),
      );

      const eligible = store.listEligible('D:/repo-a', 10, 1_000);
      expect(eligible.map((r) => r.sessionId)).toEqual(['old', 'new']);
    });

    it('treats an unscored row as eligible again once not_before passes', () => {
      const created = store.enqueue(input({ sessionId: 'retry' }));
      store.markUnscored(created.row?.id ?? '', { notBefore: 5_000 });

      expect(store.listEligible('D:/repo-a', 10, 4_999)).toHaveLength(0);
      expect(store.listEligible('D:/repo-a', 10, 5_000)).toHaveLength(1);
    });

    it('withholds a row whose ancestor is not done yet', () => {
      const parent = store.enqueue(input({ stage: 'prefilter' }));
      store.enqueue(
        input({ stage: 'synthesis', dependsOn: parent.row?.id ?? null }),
      );

      expect(store.listEligible('D:/repo-a', 10).map((r) => r.stage)).toEqual([
        'prefilter',
      ]);

      store.markDone(parent.row?.id ?? '');
      expect(
        store
          .listEligible('D:/repo-a', 10)
          .map((r) => r.stage)
          .sort(),
      ).toEqual(['synthesis']);
    });

    it('orders eligible workspaces least-recently-drained first', () => {
      store.enqueue(input({ sessionId: 'a', workspaceRoot: 'D:/a' }));
      store.enqueue(input({ sessionId: 'b', workspaceRoot: 'D:/b' }));
      store.enqueue(input({ sessionId: 'c', workspaceRoot: 'D:/c' }));

      store.markWorkspaceDrained('D:/a', 3_000);
      store.markWorkspaceDrained('D:/b', 1_000);
      // D:/c has no cursor at all — a brand-new project must sort FIRST.

      expect(store.listEligibleWorkspaces(9_000)).toEqual([
        'D:/c',
        'D:/b',
        'D:/a',
      ]);
    });

    it('omits workspaces with nothing eligible', () => {
      const done = store.enqueue(
        input({ sessionId: 'a', workspaceRoot: 'D:/a' }),
      );
      store.markDone(done.row?.id ?? '');
      store.enqueue(input({ sessionId: 'b', workspaceRoot: 'D:/b' }));

      expect(store.listEligibleWorkspaces()).toEqual(['D:/b']);
    });

    it('lists recent rows newest-first regardless of status', () => {
      const first = store.enqueue(input({ sessionId: 'one', enqueuedAt: 100 }));
      store.enqueue(input({ sessionId: 'two', enqueuedAt: 200 }));
      store.markDone(first.row?.id ?? '');

      expect(store.listRecent(10).map((r) => r.sessionId)).toEqual([
        'two',
        'one',
      ]);
    });
  });

  describe('markWorkspaceDrained', () => {
    it('creates the cursor once and then updates it in place', () => {
      store.markWorkspaceDrained('D:/a', 1_000);
      store.markWorkspaceDrained('D:/a', 2_000);

      const rows = db
        .prepare('SELECT * FROM skill_synthesis_workspace_cursor')
        .all() as Array<{ workspace_root: string; last_drained_at: number }>;
      expect(rows).toEqual([
        { workspace_root: 'D:/a', last_drained_at: 2_000 },
      ]);
    });
  });
});

function countRows(db: TestDatabase): number {
  const row = db
    .prepare('SELECT COUNT(*) AS cnt FROM skill_synthesis_queue')
    .get() as { cnt: number };
  return Number(row.cnt);
}
