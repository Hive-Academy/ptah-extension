import 'reflect-metadata';
import {
  removeRetentionTempDirs,
  requireSqliteOpener,
} from './retention/retention-sqlite.test-support';
import {
  baseSalience,
  rankSalience,
  salienceRankOrderBy,
} from './salience-ranking';

describe('ranking-only salience', () => {
  const opener = requireSqliteOpener();
  const raw = opener.open(':memory:');
  const now = 2_000_000_000_000;

  beforeAll(() => {
    raw.exec(`CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      salience REAL NOT NULL,
      hits INTEGER NOT NULL,
      pinned INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL
    )`);
  });

  afterAll(() => {
    raw.close();
    removeRetentionTempDirs();
  });

  it('matches the JavaScript mirror over ages, hit counts and pin states', () => {
    const insert = raw.prepare(
      'INSERT INTO memories(id, salience, hits, pinned, last_used_at) VALUES (?, ?, ?, ?, ?)',
    );
    const order = salienceRankOrderBy('?');
    const expression = order.slice(
      'ORDER BY '.length,
      -' DESC, m.id DESC'.length,
    );
    const select = raw.prepare(
      `SELECT ${expression} AS rank FROM memories m WHERE m.id = ?`,
    );
    let sequence = 0;
    for (const ageDays of [0, 7, 30, 90]) {
      for (const hits of [0, 3, 50]) {
        for (const pinned of [0, 1]) {
          const id = `m-${sequence++}`;
          const lastUsedAt = now - ageDays * 86_400_000;
          insert.run(id, 0.7, hits, pinned, lastUsedAt);
          const row = select.get(now, id) as { rank: number };
          expect(row.rank).toBeCloseTo(
            rankSalience(
              { salience: 0.7, hits, pinned, lastUsedAt },
              now,
            ),
            9,
          );
        }
      }
    }
  });

  it('orders recent, pinned and tie rows deterministically', () => {
    const db = opener.open(':memory:');
    try {
      db.exec(`CREATE TABLE memories (
        id TEXT PRIMARY KEY, salience REAL NOT NULL, hits INTEGER NOT NULL,
        pinned INTEGER NOT NULL, last_used_at INTEGER NOT NULL
      )`);
      const insert = db.prepare(
        'INSERT INTO memories(id, salience, hits, pinned, last_used_at) VALUES (?, ?, ?, ?, ?)',
      );
      insert.run('old-high', 1, 0, 0, now - 90 * 86_400_000);
      insert.run('recent-low', 0.25, 0, 0, now);
      insert.run('pinned', 0, 0, 1, now - 90 * 86_400_000);
      insert.run('tie-a', 0.1, 0, 0, now);
      insert.run('tie-b', 0.1, 0, 0, now);
      const rows = db
        .prepare(
          `SELECT m.id FROM memories m ${salienceRankOrderBy('?')}`,
        )
        .all(now) as Array<{ id: string }>;
      expect(rows[0]?.id).toBe('pinned');
      expect(rows.findIndex((r) => r.id === 'recent-low')).toBeLessThan(
        rows.findIndex((r) => r.id === 'old-high'),
      );
      expect(rows.findIndex((r) => r.id === 'tie-b')).toBeLessThan(
        rows.findIndex((r) => r.id === 'tie-a'),
      );
    } finally {
      db.close();
    }
  });

  it('emits only the two literal placeholder variants', () => {
    expect(salienceRankOrderBy('?').replace('?', '@rankNow')).toBe(
      salienceRankOrderBy('@rankNow'),
    );
  });

  it('clamps base salience and maps non-finite inputs to zero', () => {
    expect(baseSalience(0.4, 0.2)).toBeCloseTo(0.6);
    expect(baseSalience(-2)).toBe(0);
    expect(baseSalience(2)).toBe(1);
    expect(baseSalience(Number.NaN)).toBe(0);
    expect(baseSalience(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
