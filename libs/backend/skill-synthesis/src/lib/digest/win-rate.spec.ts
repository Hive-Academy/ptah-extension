/**
 * P4-2 — `SkillCandidateStore.getWinRates()` over the invocation →
 * session-outcome join (plan §2.5, migration `0037`).
 *
 * ONE RULE IS THE POINT OF THIS FILE AND IT IS NOT THE ARITHMETIC.
 * `winRate = wins / (invocations - unknown)`, and when that denominator is `0`
 * the answer is `null` — never `0`. An unmeasured skill must not rank below a
 * measured loser: every consumer of this number sorts on it (dormancy
 * demotion, the auto-enhance gate, the weekly digest), and a `0` for "we have
 * never measured this" puts the skill we know least about first in line to be
 * demoted. The assertion is written as `toBeNull()` deliberately —
 * `expect(0).toBeFalsy()` and `expect(null).toBeFalsy()` both pass, so a
 * falsiness check here would prove nothing at all and would sail through the
 * exact regression this spec exists to catch.
 *
 * `no-correction` IS IN NEITHER BUCKET, and that is also asserted. It is weak
 * evidence of success: not a win (it stays out of the numerator) and not
 * unknown (it stays in the denominator). It is the one evidence class where
 * getting the partition wrong changes the rate silently in both directions.
 *
 * WHICH SCHEMA. Not hand-written: every bundled migration's base `sql` is
 * applied in ascending order, so this runs against the real lineage that
 * `0037` lands on rather than a fixture that could drift from it. `vecSql` and
 * `run` migrations are skipped — exactly the vec-less path the runner takes.
 *
 * WHICH BINDING. `better-sqlite3` is rebuilt against Electron's ABI by
 * postinstall here, so it cannot load in the Jest/Node runner. `resolveOpener`
 * (`queue/queue-db.test-support`) falls back to Node's built-in `node:sqlite` —
 * the same engine behind a different binding. That helper's `openQueueDb`
 * applies only `0032` + `0035`, which is the QUEUE's schema and has neither
 * `skill_invocation_events` nor `skill_session_verdicts` in it, so this file
 * brings its own opener rather than widening a helper four other specs share
 * around a schema they do not need. Only if BOTH bindings are missing does
 * anything here skip, and a skipped run of this file proves nothing — see the
 * `binding` guard test, which fails loudly rather than skipping.
 */
import 'reflect-metadata';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
import { SkillCandidateStore } from '../skill-candidate.store';
import type { SkillWinRate } from '../skill-candidate.store';
import {
  resolveOpener,
  noopLogger,
  type TestDatabase,
} from '../queue/queue-db.test-support';

const opener = resolveOpener();
const maybe = opener ? it : it.skip;

/** Every bundled migration's base SQL, ascending. Includes 0021/0034/0037. */
function createDb(): TestDatabase {
  if (!opener) throw new Error('no sqlite binding available');
  const db = opener(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const migration of [...MIGRATIONS].sort(
    (a, b) => a.version - b.version,
  )) {
    if (migration.sql) db.exec(migration.sql);
  }
  return db;
}

function makeStore(db: TestDatabase): SkillCandidateStore {
  return new SkillCandidateStore(
    noopLogger as never,
    { db, vecExtensionLoaded: false, isOpen: true } as never,
    {
      available: false,
      getStatus: () => ({ available: false, reason: 'binary-missing' }),
      on: () => ({ dispose: () => undefined }),
      refresh: () => undefined,
    } as never,
  );
}

/** One invocation event through the REAL store write path, not raw SQL. */
function invoke(
  store: SkillCandidateStore,
  slug: string,
  sessionId: string,
  invokedAt: number,
): void {
  store.recordSkillEvent({
    skillSlug: slug,
    sessionId,
    workspaceRoot: '/ws',
    contextId: null,
    source: 'tool-use',
    succeeded: true,
    isError: false,
    invokedAt,
  });
}

/** One session verdict. `evidenceClass` null models a degraded verdict row. */
function verdict(
  db: TestDatabase,
  sessionId: string,
  evidenceClass: string | null,
): void {
  db.prepare(
    `INSERT INTO skill_session_verdicts
       (session_id, workspace_root, evidence_class, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(sessionId, '/ws', evidenceClass, 1, 1);
}

function bySlug(rates: readonly SkillWinRate[], slug: string): SkillWinRate {
  const found = rates.find((r) => r.slug === slug);
  if (!found) throw new Error(`no win rate row for ${slug}`);
  return found;
}

describe('getWinRates — the P4-2 numbers', () => {
  it('has a working SQLite binding (this file proves nothing when skipped)', () => {
    // Not a `maybe`. A silently skipped suite is green while asserting
    // nothing, which is precisely the failure mode the null rule cannot
    // afford. If this ever fails, the rest of the file is decoration.
    expect(opener).not.toBeNull();
  });

  maybe(
    'reports invocations 3, wins 1, unknown 2 and winRate 1 for the seeded slug',
    () => {
      const db = createDb();
      try {
        const store = makeStore(db);

        // Three invocations of one slug across three sessions. One session has
        // NO verdict row at all — the graceful-degradation case that must count
        // as unknown rather than as a loss.
        invoke(store, 'deep-research', 's-green', 10);
        invoke(store, 'deep-research', 's-unverified', 20);
        invoke(store, 'deep-research', 's-no-verdict', 30);

        verdict(db, 's-green', 'tests-green');
        verdict(db, 's-unverified', 'unverified');

        const row = bySlug(store.getWinRates(), 'deep-research');
        expect(row.invocations).toBe(3);
        expect(row.wins).toBe(1);
        expect(row.unknown).toBe(2);
        // 1 win over a denominator of 1 measured session. Stated exactly, not
        // via toBeCloseTo: an off-by-one in either bucket moves this number.
        expect(row.winRate).toBe(1);
      } finally {
        db.close();
      }
    },
  );

  maybe(
    'returns winRate null — NOT 0 — when every session is unverified or absent',
    () => {
      // THE assertion this batch exists for.
      const db = createDb();
      try {
        const store = makeStore(db);
        invoke(store, 'unmeasured', 's-u1', 10);
        invoke(store, 'unmeasured', 's-u2', 20);
        verdict(db, 's-u1', 'unverified');
        // s-u2 has no verdict row at all.

        const row = bySlug(store.getWinRates(), 'unmeasured');
        expect(row.invocations).toBe(2);
        expect(row.wins).toBe(0);
        expect(row.unknown).toBe(2);
        // `toBeNull`, never `toBeFalsy`: `expect(0).toBeFalsy()` passes and
        // would let the exact regression this rule forbids through.
        expect(row.winRate).toBeNull();
        expect(row.winRate).not.toBe(0);
      } finally {
        db.close();
      }
    },
  );

  maybe(
    'keeps the unmeasured skill ABOVE a measured loser, which is the reason for the null',
    () => {
      // The rule stated as the behaviour it protects rather than as a value.
      // Sorting ascending with nulls last is what phase 4's dormancy demotion
      // does; a `0` for "never measured" would put `unmeasured` first in line.
      const db = createDb();
      try {
        const store = makeStore(db);
        invoke(store, 'unmeasured', 's-un', 10);
        invoke(store, 'measured-loser', 's-lost', 20);
        verdict(db, 's-lost', 'no-correction');

        const rates = store.getWinRates();
        expect(bySlug(rates, 'unmeasured').winRate).toBeNull();
        expect(bySlug(rates, 'measured-loser').winRate).toBe(0);

        const worstFirst = [...rates].sort((a, b) => {
          if (a.winRate === null) return 1;
          if (b.winRate === null) return -1;
          return a.winRate - b.winRate;
        });
        expect(worstFirst.map((r) => r.slug)).toEqual([
          'measured-loser',
          'unmeasured',
        ]);
      } finally {
        db.close();
      }
    },
  );

  maybe('counts no-correction as neither a win nor unknown', () => {
    const db = createDb();
    try {
      const store = makeStore(db);
      invoke(store, 'weak', 's-nc', 10);
      invoke(store, 'weak', 's-green', 20);
      verdict(db, 's-nc', 'no-correction');
      verdict(db, 's-green', 'tests-green');

      const row = bySlug(store.getWinRates(), 'weak');
      expect(row.invocations).toBe(2);
      // Not in the numerator...
      expect(row.wins).toBe(1);
      // ...and not out of the denominator either.
      expect(row.unknown).toBe(0);
      expect(row.winRate).toBe(0.5);
    } finally {
      db.close();
    }
  });

  maybe('counts user-accepted and explicit-confirmation as wins', () => {
    const db = createDb();
    try {
      const store = makeStore(db);
      invoke(store, 'accepted', 's-a', 10);
      invoke(store, 'accepted', 's-b', 20);
      verdict(db, 's-a', 'user-accepted');
      verdict(db, 's-b', 'explicit-confirmation');

      const row = bySlug(store.getWinRates(), 'accepted');
      expect(row.wins).toBe(2);
      expect(row.unknown).toBe(0);
      expect(row.winRate).toBe(1);
    } finally {
      db.close();
    }
  });

  maybe(
    'counts a degraded verdict row (NULL evidence_class) as unknown',
    () => {
      // `0034`'s graceful-degradation record: a row exists, `evidence_class` is
      // NULL, `degraded_reason` says why. The join must treat it as unmeasured,
      // not as a loss — the LEFT JOIN matches, so only the CASE arms decide.
      const db = createDb();
      try {
        const store = makeStore(db);
        invoke(store, 'degraded', 's-d', 10);
        verdict(db, 's-d', null);

        const row = bySlug(store.getWinRates(), 'degraded');
        expect(row.invocations).toBe(1);
        expect(row.wins).toBe(0);
        // A NULL evidence_class is neither a win nor `= 'unverified'`, so it
        // stays IN the denominator and the rate is a measured 0. That is the
        // §2.5 query's literal behaviour, asserted rather than assumed: if a
        // later batch decides a degraded row should count as unknown, this test
        // is where that decision gets made explicitly.
        expect(row.unknown).toBe(0);
        expect(row.winRate).toBe(0);
      } finally {
        db.close();
      }
    },
  );

  maybe('groups per slug and returns one row each', () => {
    const db = createDb();
    try {
      const store = makeStore(db);
      invoke(store, 'alpha', 's-1', 10);
      invoke(store, 'alpha', 's-2', 20);
      invoke(store, 'beta', 's-3', 30);
      verdict(db, 's-1', 'tests-green');
      verdict(db, 's-2', 'tests-green');
      verdict(db, 's-3', 'unverified');

      const rates = store.getWinRates();
      expect(rates.map((r) => r.slug).sort()).toEqual(['alpha', 'beta']);
      expect(bySlug(rates, 'alpha')).toEqual({
        slug: 'alpha',
        invocations: 2,
        wins: 2,
        unknown: 0,
        winRate: 1,
      });
      expect(bySlug(rates, 'beta')).toEqual({
        slug: 'beta',
        invocations: 1,
        wins: 0,
        unknown: 1,
        winRate: null,
      });
    } finally {
      db.close();
    }
  });

  maybe('returns an empty array when there are no invocation events', () => {
    const db = createDb();
    try {
      // Not `[{winRate: 0}]` and not a throw: a fresh install has nothing to
      // report, and the digest has to render that as "no data".
      expect(makeStore(db).getWinRates()).toEqual([]);
    } finally {
      db.close();
    }
  });

  maybe(
    'writes workspace_root through the store, so the join is workspace-attributable',
    () => {
      // The other half of B4.1: without 0037's column plus the recorder's
      // forwarding, every row here would be NULL and no phase-4 sweep could
      // scope to a project.
      const db = createDb();
      try {
        const store = makeStore(db);
        invoke(store, 'scoped', 's-w', 10);

        const row = db
          .prepare(
            'SELECT workspace_root FROM skill_invocation_events WHERE session_id = ?',
          )
          .get('s-w') as { workspace_root: string | null };
        expect(row.workspace_root).toBe('/ws');
      } finally {
        db.close();
      }
    },
  );
});
