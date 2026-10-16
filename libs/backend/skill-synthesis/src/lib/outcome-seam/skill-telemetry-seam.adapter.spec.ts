import 'reflect-metadata';
import {
  SqliteConnectionService,
  VecStatusService,
} from '@ptah-extension/persistence-sqlite';
import { resolveOpener } from '../queue/queue-db.test-support';
import { noopLogger } from '../queue/queue-db.test-support';
import { SkillCandidateStore } from '../skill-candidate.store';
import { SessionVerdictStore } from '../archaeology/session-verdict.store';
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
        const candidates = new SkillCandidateStore(
          noopLogger,
          connection,
          Object.create(VecStatusService.prototype) as VecStatusService,
        );
        const verdicts = new SessionVerdictStore(noopLogger, connection);
        const adapter = new SkillTelemetrySeamAdapter(candidates, verdicts);
        expect(candidates.findSubagentRuns(['a'])).toEqual([
          {
            run_id: 'a',
            input_tokens: 10,
            output_tokens: 2,
            cost_usd: 0.1,
            duration_ms: 100,
            task_id: null,
            is_error: 0,
            verdict_source: null,
          },
        ]);
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

  maybe(
    'store readers parse rows and skip malformed telemetry with a warning',
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
        db.exec(`INSERT INTO skill_invocation_events VALUES
        ('good', 'subagent', 'skill', 's', 10, 3, 4, 0.5, 20, NULL, 0, NULL),
        ('bad', 'subagent', 'skill', 's', 10, 'wrong', 4, 0.5, 20, NULL, 0, NULL),
        (NULL, 'tool-use', 'loaded', 's', 10, NULL, NULL, NULL, NULL, NULL, 0, NULL),
        (NULL, 'tool-use', NULL, 's', 10, NULL, NULL, NULL, NULL, NULL, 0, NULL);
      INSERT INTO skill_session_verdicts VALUES ('s', 'tests-green'), ('bad', 42);`);
        const connection = Object.create(
          SqliteConnectionService.prototype,
        ) as SqliteConnectionService;
        Object.defineProperty(connection, 'db', { value: db });
        const warn = jest.fn();
        const logger: typeof noopLogger = Object.assign(
          Object.create(noopLogger) as typeof noopLogger,
          { warn },
        );
        const candidates = new SkillCandidateStore(
          logger,
          connection,
          Object.create(VecStatusService.prototype) as VecStatusService,
        );
        const verdicts = new SessionVerdictStore(logger, connection);
        expect(candidates.findSubagentRuns(['good', 'bad'])).toHaveLength(1);
        expect(
          candidates
            .listSkillsForScopes([
              { runId: 'main', sessionId: 's', fromMs: 0, toMs: 20 },
            ])
            .get('main'),
        ).toEqual(['loaded']);
        expect(verdicts.evidenceClassForSessions(['s', 'bad']).get('s')).toBe(
          'tests-green',
        );
        expect(verdicts.evidenceClassForSessions(['s', 'bad']).has('bad')).toBe(
          false,
        );
        expect(warn).toHaveBeenCalledTimes(4);
        const adapter = new SkillTelemetrySeamAdapter(candidates, verdicts);
        expect(
          (await adapter.subagentRuns(['subagent:bad'])).get('subagent:bad')
            ?.match,
        ).toBe('unmatched');
      } finally {
        db.close();
      }
    },
  );
});
