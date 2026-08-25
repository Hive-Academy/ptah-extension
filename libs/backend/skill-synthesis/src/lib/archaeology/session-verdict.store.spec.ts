/**
 * SessionVerdictStore — the store half of P2-1.
 *
 * These assertions run against a REAL SQLite database with `0034` applied, not
 * a fake. The verdict row's whole value is that JSON survives a round trip
 * unchanged and that three states stay distinguishable, and neither is provable
 * against a mock that hands back whatever it was given.
 *
 * `better-sqlite3` in this repo is rebuilt against Electron's ABI by postinstall
 * and cannot load under Jest/Node, so the shared opener in
 * `../queue/queue-db.test-support.ts` falls back to Node's built-in
 * `node:sqlite`. Reusing it rather than copying the house native-gate is
 * deliberate: the copied gate makes specs SKIP silently — green while asserting
 * nothing.
 *
 * What is pinned here, in order of how badly it hurts to get wrong:
 *
 *  1. **The three states.** Absent row / degraded row / real verdict must be
 *     told apart by the store's own API, because phase 3's fallback and phase
 *     4's `unknown` bucket both branch on exactly that distinction.
 *  2. **JSON shape round-trips.** `frictionMap` keeps INTEGER `turnIndex`
 *     values and `routine.citations` comes back a `number[]` — the two fields
 *     later phases read.
 *  3. **A re-analysis restates the WHOLE verdict.** No field from the previous
 *     pass may survive into the new row.
 */
import 'reflect-metadata';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
import {
  asConnection,
  makeTempDbPath,
  noopLogger,
  resolveOpener,
  type TestDatabase,
} from '../queue/queue-db.test-support';
import { SessionVerdictStore } from './session-verdict.store';
import {
  EVIDENCE_CLASSES,
  SESSION_VERDICT_DEGRADED_REASONS,
  type FrictionEntry,
  type RoutineDraft,
} from './session-verdict.types';

const SQL_0034 = MIGRATIONS.find((m) => m.version === 34)?.sql ?? '';

const FRICTION: FrictionEntry[] = [
  { turnIndex: 4, kind: 'correction', note: 'wrong file targeted' },
  { turnIndex: 11, kind: 'retry', note: 'test run repeated' },
  { turnIndex: 19, kind: 'dead-end', note: 'abandoned the mock approach' },
];

const ROUTINE: RoutineDraft = {
  summary: 'Rebase a stacked branch without losing the WIP commit',
  steps: ['fetch', 'rebase onto base', 're-run the affected tests'],
  citations: [4, 11, 19],
};

describe('SessionVerdictStore — static contract (no database needed)', () => {
  it('finds migration 0034 in the shipped MIGRATIONS tuple', () => {
    // If this fails the rest of the suite is meaningless — it would be running
    // against an empty schema.
    expect(SQL_0034).toContain(
      'CREATE TABLE IF NOT EXISTS skill_session_verdicts',
    );
  });

  it('names the same five evidence classes the migration CHECK does', () => {
    // The TypeScript union and the SQLite CHECK are two halves of one contract
    // and SQLite cannot widen a CHECK with ALTER TABLE. A drift fails here
    // rather than as a constraint violation on a user's database.
    for (const member of EVIDENCE_CLASSES) {
      expect(SQL_0034).toContain(`'${member}'`);
    }
  });
});

describe('SessionVerdictStore — behaviour (skipped without any SQLite binding)', () => {
  const opener = resolveOpener();
  const maybe = opener ? it : it.skip;

  let db: TestDatabase | null = null;
  let store: SessionVerdictStore;

  beforeEach(() => {
    if (!opener) return;
    db = opener(makeTempDbPath());
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec(SQL_0034);
    store = new SessionVerdictStore(noopLogger, asConnection(db));
  });

  afterEach(() => {
    db?.close();
    db = null;
  });

  // ── The three states ──────────────────────────────────────────────────────

  maybe('returns null for a session that was never analyzed', () => {
    expect(store.findBySession('never-seen')).toBeNull();
    expect(store.hasUsableVerdict('never-seen')).toBe(false);
  });

  maybe('records a degraded row: analyzed, no verdict, reason legible', () => {
    const saved = store.recordDegraded(
      's-degraded',
      SESSION_VERDICT_DEGRADED_REASONS.NO_QUERY_PATH,
      { workspaceRoot: '/ws', turnCount: 7 },
      1_770_000_000_000,
    );

    expect(saved.intent).toBeNull();
    expect(saved.outcome).toBeNull();
    expect(saved.evidenceClass).toBeNull();
    expect(saved.routine).toBeNull();
    expect(saved.frictionMap).toEqual([]);
    expect(saved.degradedReason).toBe('no-query-path');
    expect(saved.turnCount).toBe(7);
    expect(saved.passes).toBe(0);

    // The row EXISTS — that is what stops the drain re-attempting forever — but
    // it does not count as a verdict.
    const read = store.findBySession('s-degraded');
    expect(read).not.toBeNull();
    expect(read?.degradedReason).toBe('no-query-path');
    expect(store.hasUsableVerdict('s-degraded')).toBe(false);
  });

  maybe('does not throw on the degraded path — it resolves with a row', () => {
    // P2-3's contract in miniature: no exception, therefore no retry storm.
    expect(() =>
      store.recordDegraded(
        's-no-throw',
        SESSION_VERDICT_DEGRADED_REASONS.TOOL_USE_UNSUPPORTED,
        { passes: 1 },
      ),
    ).not.toThrow();
    expect(store.findBySession('s-no-throw')?.degradedReason).toBe(
      'tool-use-unsupported',
    );
    expect(store.findBySession('s-no-throw')?.passes).toBe(1);
  });

  maybe('rejects a degraded row with a blank reason', () => {
    // "Analyzed, no verdict" while refusing to say why is worse than no row.
    for (const blank of ['', '   ']) {
      expect(() => store.recordDegraded('s-blank', blank)).toThrow(
        /non-empty reason/,
      );
    }
    expect(store.findBySession('s-blank')).toBeNull();
  });

  maybe('reports a full verdict as usable, and a degraded one as not', () => {
    store.save({
      sessionId: 's-full',
      intent: 'rebase the stack',
      outcome: 'rebased, tests green',
      evidenceClass: 'tests-green',
    });
    store.recordDegraded('s-thin', 'no-query-path');

    expect(store.hasUsableVerdict('s-full')).toBe(true);
    expect(store.hasUsableVerdict('s-thin')).toBe(false);
    expect(store.hasUsableVerdict('s-absent')).toBe(false);
  });

  // ── JSON round trip ───────────────────────────────────────────────────────

  maybe(
    'round-trips frictionMap and routine with integer indices intact',
    () => {
      const saved = store.save({
        sessionId: 's-json',
        workspaceRoot: '/ws/project',
        intent: 'rebase the stack without losing the WIP commit',
        outcome: 'branch rebased, tests green',
        evidenceClass: 'tests-green',
        frictionMap: FRICTION,
        routine: ROUTINE,
        turnCount: 21,
        lane: 'archaeologist',
        model: 'a-model-id',
        passes: 2,
      });

      // The value returned by `save` is READ BACK FROM THE DATABASE, not echoed,
      // so asserting on it asserts the round trip.
      expect(saved.frictionMap).toEqual(FRICTION);
      expect(saved.routine).toEqual(ROUTINE);

      const read = store.findBySession('s-json');
      expect(read?.frictionMap).toEqual(FRICTION);
      for (const entry of read?.frictionMap ?? []) {
        expect(Number.isInteger(entry.turnIndex)).toBe(true);
      }
      expect(read?.routine?.citations).toEqual([4, 11, 19]);
      expect(Array.isArray(read?.routine?.citations)).toBe(true);
      expect(read?.intent).toBe(
        'rebase the stack without losing the WIP commit',
      );
      expect(read?.evidenceClass).toBe('tests-green');
      expect(read?.lane).toBe('archaeologist');
      expect(read?.model).toBe('a-model-id');
      expect(read?.passes).toBe(2);
      expect(read?.turnCount).toBe(21);
      expect(read?.degradedReason).toBeNull();
    },
  );

  maybe(
    'defaults an omitted frictionMap to [] and an omitted routine to null',
    () => {
      const saved = store.save({ sessionId: 's-minimal' });
      expect(saved.frictionMap).toEqual([]);
      expect(saved.routine).toBeNull();
      expect(saved.workspaceRoot).toBe('');
      expect(saved.turnCount).toBe(0);
      expect(saved.passes).toBe(0);
      // "No routine here" is a real verdict, not a missing measurement.
      expect(store.hasUsableVerdict('s-minimal')).toBe(true);
    },
  );

  maybe('persists every one of the five evidence classes', () => {
    for (const member of EVIDENCE_CLASSES) {
      store.save({ sessionId: `s-${member}`, evidenceClass: member });
    }
    for (const member of EVIDENCE_CLASSES) {
      expect(store.findBySession(`s-${member}`)?.evidenceClass).toBe(member);
    }
  });

  // ── Validation at the single gate ─────────────────────────────────────────

  maybe('rejects an evidence class outside the union, by name', () => {
    expect(() =>
      store.save({
        sessionId: 's-bad-evidence',
        // Cast: the point is what happens when an unvalidated value reaches the
        // store, which is precisely what TypeScript cannot prevent at an
        // LLM-output boundary.
        evidenceClass: 'tests_green' as never,
      }),
    ).toThrow(/unknown evidence class: tests_green/);
    expect(store.findBySession('s-bad-evidence')).toBeNull();
  });

  maybe('rejects a non-integer or negative friction turnIndex', () => {
    // A fractional or negative index cites nothing, and the friction map's whole
    // value is that it is auditable back to a turn.
    for (const bad of [1.5, -1, Number.NaN]) {
      expect(() =>
        store.save({
          sessionId: 's-bad-turn',
          frictionMap: [{ turnIndex: bad, kind: 'retry', note: 'n' }],
        }),
      ).toThrow(/friction turnIndex must be a non-negative integer/);
    }
    expect(store.findBySession('s-bad-turn')).toBeNull();
  });

  maybe('rejects a routine with no citations', () => {
    expect(() =>
      store.save({
        sessionId: 's-uncited',
        routine: { summary: 's', steps: ['a'], citations: [] },
      }),
    ).toThrow(/must cite at least one turn index/);
    expect(store.findBySession('s-uncited')).toBeNull();
  });

  maybe('rejects a non-integer routine citation', () => {
    expect(() =>
      store.save({
        sessionId: 's-bad-citation',
        routine: { summary: 's', steps: ['a'], citations: [2, 3.7] },
      }),
    ).toThrow(/routine citation must be a non-negative integer/);
    expect(store.findBySession('s-bad-citation')).toBeNull();
  });

  // ── Re-analysis ───────────────────────────────────────────────────────────

  maybe(
    'replaces the verdict on re-analysis, keeping one row per session',
    () => {
      store.save(
        {
          sessionId: 's-rewrite',
          workspaceRoot: '/ws',
          intent: 'first read of the session',
          outcome: 'partial',
          evidenceClass: 'unverified',
          frictionMap: FRICTION,
          routine: ROUTINE,
          turnCount: 21,
          passes: 2,
        },
        1_000,
      );
      store.save(
        {
          sessionId: 's-rewrite',
          workspaceRoot: '/ws',
          intent: 'the goal only legible after the correction',
          outcome: 'shipped',
          evidenceClass: 'tests-green',
          frictionMap: [],
          routine: null,
          turnCount: 40,
          passes: 3,
        },
        2_000,
      );

      const rows = (db as TestDatabase)
        .prepare('SELECT * FROM skill_session_verdicts')
        .all();
      expect(rows).toHaveLength(1);

      const read = store.findBySession('s-rewrite');
      expect(read?.intent).toBe('the goal only legible after the correction');
      expect(read?.evidenceClass).toBe('tests-green');
      expect(read?.turnCount).toBe(40);
      expect(read?.passes).toBe(3);
      // THE assertion: nothing from the first pass survives beside the second.
      // A fragment-style write would leave the old friction map and routine here,
      // which reads as a verdict and is not one.
      expect(read?.frictionMap).toEqual([]);
      expect(read?.routine).toBeNull();
      // `created_at` is when the session was FIRST analyzed; the feed orders on it.
      expect(read?.createdAt).toBe(1_000);
      expect(read?.updatedAt).toBe(2_000);
    },
  );

  maybe('clears a previous verdict when a re-analysis degrades', () => {
    store.save({
      sessionId: 's-regress',
      intent: 'a real verdict',
      outcome: 'done',
      evidenceClass: 'user-accepted',
      frictionMap: FRICTION,
      routine: ROUTINE,
    });
    store.recordDegraded('s-regress', 'no-query-path');

    const read = store.findBySession('s-regress');
    // A stale intent standing beside a fresh degradation reason would be read as
    // a verdict by phase 3 and counted as a win by phase 4.
    expect(read?.intent).toBeNull();
    expect(read?.outcome).toBeNull();
    expect(read?.evidenceClass).toBeNull();
    expect(read?.frictionMap).toEqual([]);
    expect(read?.routine).toBeNull();
    expect(read?.degradedReason).toBe('no-query-path');
    expect(store.hasUsableVerdict('s-regress')).toBe(false);
  });

  // ── Feeds ─────────────────────────────────────────────────────────────────

  maybe(
    'lists a workspace newest-first and does not leak other workspaces',
    () => {
      store.save({ sessionId: 'a', workspaceRoot: '/ws1' }, 1_000);
      store.save({ sessionId: 'b', workspaceRoot: '/ws1' }, 3_000);
      store.save({ sessionId: 'c', workspaceRoot: '/ws1' }, 2_000);
      store.save({ sessionId: 'd', workspaceRoot: '/ws2' }, 9_000);

      expect(store.listByWorkspace('/ws1', 10).map((r) => r.sessionId)).toEqual(
        ['b', 'c', 'a'],
      );
      expect(store.listByWorkspace('/ws1', 2).map((r) => r.sessionId)).toEqual([
        'b',
        'c',
      ]);
      expect(store.listByWorkspace('/ws2', 10).map((r) => r.sessionId)).toEqual(
        ['d'],
      );
    },
  );

  maybe('lists only the degraded rows, newest-updated first', () => {
    store.save({ sessionId: 'ok', intent: 'real' }, 1_000);
    store.recordDegraded('bad-1', 'no-query-path', {}, 2_000);
    store.recordDegraded('bad-2', 'tool-use-unsupported', {}, 3_000);

    const degraded = store.listDegraded(10);
    expect(degraded.map((r) => r.sessionId)).toEqual(['bad-2', 'bad-1']);
    expect(degraded.map((r) => r.degradedReason)).toEqual([
      'tool-use-unsupported',
      'no-query-path',
    ]);
  });

  // ── Defensive reads ───────────────────────────────────────────────────────

  maybe(
    'degrades an unparseable stored friction map to [] rather than throwing',
    () => {
      store.save({ sessionId: 's-corrupt', frictionMap: FRICTION });
      (db as TestDatabase)
        .prepare(
          'UPDATE skill_session_verdicts SET friction_map = ?, routine = ? WHERE session_id = ?',
        )
        .run('not json', 'not json either', 's-corrupt');

      const read = store.findBySession('s-corrupt');
      // A corrupt column must not take down the read path that phase 3 depends on.
      expect(read?.frictionMap).toEqual([]);
      expect(read?.routine).toBeNull();
    },
  );
});
