import 'reflect-metadata';
import { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import { resolveOpener } from '../queue/queue-db.test-support';
import { SkillTelemetrySeamAdapter } from './skill-telemetry-seam.adapter';

const opener = resolveOpener();
const maybe = opener ? it : it.skip;

describe('SkillTelemetrySeamAdapter', () => {
  maybe(
    'keeps two same-slug runs separate and reports ambiguous duplicates',
    async () => {
      if (!opener) throw new Error('SQLite opener unavailable');
      const db = opener(':memory:');
      try {
        db.exec(`CREATE TABLE skill_invocation_events (
        run_id TEXT, source TEXT, skill_slug TEXT, session_id TEXT,
        invoked_at INTEGER, input_tokens INTEGER, output_tokens INTEGER,
        cost_usd REAL, duration_ms INTEGER, task_id TEXT,
        is_error INTEGER, verdict_source TEXT
      );
      CREATE TABLE skill_session_verdicts (session_id TEXT, evidence_class TEXT);`);
        const insert = db.prepare(`INSERT INTO skill_invocation_events
        (run_id, source, skill_slug, session_id, invoked_at, input_tokens,
         output_tokens, cost_usd, duration_ms, task_id, is_error, verdict_source)
        VALUES (?, 'subagent', 'same-slug', 'parent', 1000, ?, 2, 0.1, 100, NULL, 0, NULL)`);
        insert.run('a', 10);
        insert.run('b', 20);
        const connection = Object.create(
          SqliteConnectionService.prototype,
        ) as SqliteConnectionService;
        Object.defineProperty(connection, 'db', { value: db });
        const adapter = new SkillTelemetrySeamAdapter(connection);
        const runs = await adapter.subagentRuns([
          'subagent:a',
          'subagent:b',
          'subagent:c',
        ]);
        expect(runs.get('subagent:a')).toMatchObject({
          match: 'matched',
          inputTokens: 10,
        });
        expect(runs.get('subagent:b')).toMatchObject({
          match: 'matched',
          inputTokens: 20,
        });
        expect(runs.get('subagent:c')?.match).toBe('unmatched');
        expect(
          (runs.get('subagent:a')?.inputTokens ?? 0) +
            (runs.get('subagent:b')?.inputTokens ?? 0),
        ).toBe(30);
        insert.run('a', 99);
        expect(
          (await adapter.subagentRuns(['subagent:a'])).get('subagent:a'),
        ).toMatchObject({
          match: 'ambiguous',
          inputTokens: null,
        });
        expect(
          (
            await adapter.skillsLoaded([
              {
                runId: 'subagent:a',
                sessionId: 'nested',
                fromMs: 0,
                toMs: 2000,
              },
            ])
          ).get('subagent:a'),
        ).toBeNull();
      } finally {
        db.close();
      }
    },
  );
});
