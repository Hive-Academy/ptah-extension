import { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import { SqliteLaneOutcomeStore } from './sqlite-lane-outcome.store';
import { heldReport } from './store.test-support';

describe('SqliteLaneOutcomeStore', () => {
  it('counts only live holds and removes expired holds before insertion', async () => {
    const Database = require('better-sqlite3') as new (file: string) => {
      exec(sql: string): void;
      prepare(sql: string): { get(...params: unknown[]): unknown };
      close(): void;
    };
    const db = new Database(':memory:');
    try {
      db.exec(`CREATE TABLE lane_outcome_held_reports (
        report_id TEXT NOT NULL PRIMARY KEY, run_id TEXT NOT NULL, kind TEXT NOT NULL,
        payload TEXT NOT NULL, held_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
      )`);
      const connection = Object.create(
        SqliteConnectionService.prototype,
      ) as SqliteConnectionService;
      Object.defineProperty(connection, 'db', { value: db });
      Object.defineProperty(connection, 'isOpen', { value: true });
      const store = new SqliteLaneOutcomeStore(connection);
      const now = Date.now();
      for (let i = 0; i < 500; i++)
        await store.holdReport(heldReport(i, now, i < 3));
      expect(await store.countHeldReports(now)).toBe(497);
      await store.holdReport(heldReport(500, now));
      expect(await store.countHeldReports(now)).toBe(498);
      expect(
        db
          .prepare(
            'SELECT 1 FROM lane_outcome_held_reports WHERE report_id = ?',
          )
          .get('report-0'),
      ).toBeUndefined();
    } finally {
      db.close();
    }
  });
});
