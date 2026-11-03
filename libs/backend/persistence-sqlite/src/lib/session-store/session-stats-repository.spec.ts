import { DatabaseSync } from 'node:sqlite';
import type { SqliteDatabase } from '../sqlite-connection.service';
import { SESSION_STORE_MIGRATIONS } from './session-store-migrations';
import { SqliteSessionUsageSink } from './sqlite-session-usage-sink';
import {
  SessionStatsRepository,
  type SessionUsageContribution,
} from './session-stats-repository';

function sqlValue(value: unknown): string | number | null {
  if (typeof value === 'string' || typeof value === 'number' || value === null)
    return value;
  throw new Error('Unexpected SQL parameter');
}

function openTestStore(): {
  ready(): Promise<Pick<SqliteDatabase, 'exec' | 'prepare'>>;
  close(): void;
} {
  const raw = new DatabaseSync(':memory:');
  for (const migration of SESSION_STORE_MIGRATIONS) {
    if (migration.sql) raw.exec(migration.sql);
  }
  const db: Pick<SqliteDatabase, 'exec' | 'prepare'> = {
    exec: (sql) => raw.exec(sql),
    prepare: (sql) => {
      const statement = raw.prepare(sql);
      return {
        run: (...params: unknown[]) => {
          const result = statement.run(...params.map(sqlValue));
          return {
            changes: Number(result.changes),
            lastInsertRowid: result.lastInsertRowid,
          };
        },
        get: (...params: unknown[]) => statement.get(...params.map(sqlValue)),
        all: (...params: unknown[]) => statement.all(...params.map(sqlValue)),
        iterate: function* (...params: unknown[]): IterableIterator<unknown> {
          for (const row of statement.iterate(...params.map(sqlValue)))
            yield row;
        },
      };
    },
  };
  return { ready: async () => db, close: () => raw.close() };
}

const contribution: SessionUsageContribution = {
  sessionId: 'session-a',
  producer: 'sdk',
  runId: 'run-a',
  turnId: 'turn-a',
  eventKey: 'result-a',
  modelId: 'model-a',
  providerId: 'anthropic',
  occurredAtMs: 86_400_000,
  inputTokens: 20,
  outputTokens: 10,
  cacheReadTokens: 3,
  cacheWriteTokens: 2,
  knownCostMicroUsd: 150,
  costAuthority: 'provider-reported',
  source: 'live',
  pricingVersion: null,
  revision: 1,
};

describe('SessionStatsRepository', () => {
  it.each(['provider-first', 'timer-first'])('runs one guarded startup scan: %s', async (order) => {
    jest.useFakeTimers();
    const store = openTestStore();
    try {
      const repository = new SessionStatsRepository(store);
      for (const sessionId of ['idle', 'live']) {
        await repository.recordUsage({ ...contribution, sessionId, workspaceKey: '/work/a' });
      }
      (await store.ready()).prepare('UPDATE session_stats SET updated_at_ms = ?')
        .run(86_400_000);
      const sink = new SqliteSessionUsageSink(repository, { error: jest.fn() });
      sink.startFinalizer();
      if (order === 'provider-first') sink.setLiveSessionIdsProvider(() => ['live']);
      jest.advanceTimersByTime(0);
      if (order === 'timer-first') sink.setLiveSessionIdsProvider(() => ['live']);
      await sink.flush();
      expect((await repository.getSessionStats('idle', '/work/a'))?.status).toBe('finalized');
      expect((await repository.getSessionStats('live', '/work/a'))?.status).toBe('active');
    } finally {
      store.close();
      jest.useRealTimers();
    }
  });

  it('keeps a higher late revision sealed until an explicit resume', async () => {
    const store = openTestStore();
    try {
      const repository = new SessionStatsRepository(store);
      await repository.recordUsage({ ...contribution, workspaceKey: '/work/a' });
      await repository.requestFinalization('session-a', 90_000_000);
      expect((await repository.getSessionStats('session-a', '/work/a'))?.status).toBe('finalize_pending');
      await repository.reconcileFinalizations(90_000_001);
      expect((await repository.getSessionStats('session-a', '/work/a'))?.finalized_at_ms).toBe(90_000_001);
      await repository.recordUsage({ ...contribution, workspaceKey: '/work/a', eventKey: 'resumed', revision: 2 });
      const late = await repository.getSessionStats('session-a', '/work/a');
      expect(late?.status).toBe('finalized');
      expect(late?.finalized_at_ms).toBe(90_000_001);
      expect(late?.revision).toBe(2);
      await repository.resumeSession('session-a');
      expect((await repository.getSessionStats('session-a', '/work/a'))?.status).toBe('active');
      await repository.requestFinalization('session-a', 90_000_002);
      expect(await repository.reconcileFinalizations(90_000_003)).toBe(1);
      expect((await repository.getSessionStats('session-a', '/work/a'))?.status).toBe('finalized');
    } finally {
      store.close();
    }
  });

  it('reconciles a pending row after repository restart and an idle row', async () => {
    const store = openTestStore();
    try {
      const first = new SessionStatsRepository(store);
      await first.recordUsage({ ...contribution, workspaceKey: '/work/a' });
      await first.requestFinalization('session-a', 90_000_000);
      const restarted = new SessionStatsRepository(store);
      expect(await restarted.reconcileFinalizations(90_000_001)).toBe(1);
      expect(await restarted.reconcileFinalizations(90_000_002)).toBe(0);
      await restarted.recordUsage({ ...contribution, sessionId: 'idle', workspaceKey: '/work/a' });
      expect(await restarted.reconcileFinalizations(90_000_000)).toBe(0);
      expect(await restarted.reconcileFinalizations(Date.now() + 31 * 60_000,
        30 * 60_000, true, ['idle'])).toBe(0);
      expect(await restarted.reconcileFinalizations(Date.now() + 31 * 60_000,
        30 * 60_000, true)).toBe(1);
      expect((await restarted.getSessionStats('idle', '/work/a'))?.status).toBe('finalized');
    } finally {
      store.close();
    }
  });

  it('keeps a true end pending for a late write below the captured revision', async () => {
    const store = openTestStore();
    try {
      const repository = new SessionStatsRepository(store);
      await repository.recordUsage({ ...contribution, workspaceKey: '/work/a', revision: 3 });
      await repository.requestFinalization('session-a', 90_000_000);
      await repository.recordUsage({ ...contribution, eventKey: 'late',
        workspaceKey: '/work/a', revision: 2 });
      expect((await repository.getSessionStats('session-a', '/work/a'))?.status)
        .toBe('finalize_pending');
      await repository.reconcileFinalizations(90_000_001);
      expect((await repository.getSessionStats('session-a', '/work/a'))?.status)
        .toBe('finalized');
    } finally {
      store.close();
    }
  });
  it('clears pending finalization when a transcript resumes before new usage', async () => {
    const store = openTestStore();
    try {
      const repository = new SessionStatsRepository(store);
      await repository.recordUsage({ ...contribution, workspaceKey: '/work/a' });
      await repository.requestFinalization('session-a', 90_000_000);
      await repository.resumeSession('session-a');
      expect((await repository.getSessionStats('session-a', '/work/a'))?.status)
        .toBe('active');
      expect(await repository.reconcileFinalizations(90_000_001)).toBe(0);
    } finally {
      store.close();
    }
  });

  it('keeps a pending row when SQLite is busy so a later pass can seal it', async () => {
    const store = openTestStore();
    try {
      const repository = new SessionStatsRepository(store);
      await repository.recordUsage({ ...contribution, workspaceKey: '/work/a' });
      await repository.requestFinalization('session-a', 90_000_000);
      const busy = new SessionStatsRepository({ ready: async () => { throw new Error('SQLITE_BUSY'); } });
      await expect(busy.reconcileFinalizations(90_000_001)).rejects.toThrow('SQLITE_BUSY');
      expect((await repository.getSessionStats('session-a', '/work/a'))?.status).toBe('finalize_pending');
      await repository.reconcileFinalizations(90_000_002);
      expect((await repository.getSessionStats('session-a', '/work/a'))?.status).toBe('finalized');
    } finally {
      store.close();
    }
  });
  it('continues after one row fails and counts only sealed rows', async () => {
    const store = openTestStore();
    try {
      const repository = new SessionStatsRepository(store);
      for (const sessionId of ['a-bad', 'z-good']) {
        await repository.recordUsage({ ...contribution, sessionId,
          workspaceKey: '/work/a' });
        await repository.requestFinalization(sessionId, 90_000_000);
      }
      (await store.ready()).exec(`CREATE TRIGGER fail_bad_seal
        BEFORE UPDATE ON session_stats
        WHEN NEW.session_id = 'a-bad' AND NEW.status = 'finalized'
        BEGIN SELECT RAISE(FAIL, 'SQLITE_BUSY'); END`);
      expect(await repository.reconcileFinalizations(90_000_001)).toBe(1);
      expect((await repository.getSessionStats('a-bad', '/work/a'))?.status)
        .toBe('finalize_pending');
      expect((await repository.getSessionStats('z-good', '/work/a'))?.status)
        .toBe('finalized');
    } finally {
      store.close();
    }
  });
  it('matches native Codex thread identities only within their workspace and time range', async () => {
    const store = openTestStore();
    try {
      const repository = new SessionStatsRepository(store);
      await repository.recordUsage({ ...contribution, sessionId: 'ptah-session', producer: 'codex-checkpoint',
        runId: 'native-thread', workspaceKey: '/work/a', host: 'electron' });
      expect(await repository.hasWorkspaceCodexRun('/work/a', 'native-thread', 0, 172_800_000)).toBe(true);
      expect(await repository.hasWorkspaceCodexRun('/work/b', 'native-thread', 0, 172_800_000)).toBe(false);
      expect(await repository.hasWorkspaceCodexRun('/work/a', 'ptah-session', 0, 172_800_000)).toBe(false);
      expect(await repository.hasWorkspaceCodexRun('/work/a', 'native-thread', 172_800_000, 259_200_000)).toBe(false);
    } finally {
      store.close();
    }
  });
  it('matches a Codex CLI lane by its native session identity', async () => {
    const store = openTestStore();
    try {
      const repository = new SessionStatsRepository(store);
      await repository.recordUsage({ ...contribution, sessionId: 'native-thread', producer: 'cli-lane',
        runId: 'lane-id', providerId: 'codex', workspaceKey: '/work/a', host: 'electron' });
      expect(await repository.hasWorkspaceCodexRun('/work/a', 'native-thread', 0, 172_800_000)).toBe(true);
      expect(await repository.hasWorkspaceCodexRun('/work/b', 'native-thread', 0, 172_800_000)).toBe(false);
    } finally {
      store.close();
    }
  });
  it('replaces a run cost with a lower accepted snapshot while retaining token events', async () => {
    const store = openTestStore();
    try {
      const repository = new SessionStatsRepository(store);
      const first = { ...contribution, producer: 'sdk-owner', eventKey: 'turn-1', knownCostMicroUsd: 100, revision: 1 };
      await repository.recordUsage(first);
      await repository.recordUsage({ ...first, eventKey: 'turn-2', knownCostMicroUsd: 100, revision: 2 });
      const correction = { ...first, eventKey: 'turn-3', knownCostMicroUsd: 120, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, revision: 3, runCostSnapshot: true };
      await repository.recordUsage(correction);
      await repository.recordUsage(correction);
      const db = await store.ready();
      expect(db.prepare('SELECT SUM(known_cost_micro_usd) AS cost, SUM(input_tokens) AS input FROM session_usage_turns WHERE session_id = ?').get('session-a')).toMatchObject({ cost: 120, input: 40 });
    } finally {
      store.close();
    }
  });
  it('applies S0002 to an existing session database without losing sessions', () => {
    const db = new DatabaseSync(':memory:');
    try {
      const first = SESSION_STORE_MIGRATIONS[0];
      const second = SESSION_STORE_MIGRATIONS[1];
      if (!first?.sql || !second?.sql) throw new Error('Missing session store migrations');
      db.exec(first.sql);
      db.prepare(`INSERT INTO sessions (session_id, workspace_key, workspace_path, host,
        name, created_at, last_active_at, summary_json, detail_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('old-session', '/old', '/old', 'electron', 'Old', 0, 0, '{}', '{}', 0);
      db.exec(second.sql);
      expect(db.prepare('SELECT name FROM sessions WHERE session_id = ?').get('old-session')).toMatchObject({ name: 'Old' });
      expect(db.prepare('SELECT count(*) AS count FROM session_stats').get()).toMatchObject({ count: 0 });
    } finally {
      db.close();
    }
  });

  it('upserts newer revisions and returns SQL grouped usage without double counting', async () => {
    const store = openTestStore();
    try {
      const db = await store.ready();
      db.prepare(
        `INSERT INTO sessions (session_id, workspace_key, workspace_path, host,
        name, created_at, last_active_at, summary_json, detail_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        'session-a',
        '/work/a',
        '/work/a',
        'electron',
        'Test',
        0,
        0,
        '{}',
        '{}',
        0,
      );
      const repository = new SessionStatsRepository(store);
      expect(await repository.hasSessionStats('session-a')).toBe(false);
      await repository.recordUsage(contribution);
      expect(await repository.hasSessionStats('session-a')).toBe(true);
      await repository.recordUsage(contribution);
      await repository.recordUsage({
        ...contribution,
        revision: 0,
        inputTokens: 999,
      });
      expect(
        (await repository.getSessionStats('session-a', '/work/a'))?.input_tokens,
      ).toBe(20);
      await repository.recordUsage({
        ...contribution,
        revision: 2,
        inputTokens: 25,
      });
      expect(
        (await repository.getSessionStats('session-a', '/work/a'))?.input_tokens,
      ).toBe(25);
      const groups = await repository.getWorkspaceUsageGroups(
        '/work/a',
        0,
        172_800_000,
      );
      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({
        day: '1970-01-02',
        input_tokens: 25,
        known_cost_micro_usd: 150,
        session_count: 1,
      });
      expect(
        await repository.getWorkspaceUsageGroups('/work/b', 0, 172_800_000),
      ).toEqual([]);
      expect(
        (await repository.getWorkspaceTopSessions('/work/a', 0, 172_800_000))[0]
          ?.session_id,
      ).toBe('session-a');
      expect(await repository.getWorkspaceSessionCount('/work/a', 0, 172_800_000)).toBe(1);
      expect(await repository.getWorkspaceMessageCount('/work/a', 0, 172_800_000)).toBe(1);
      expect(await repository.getSessionUsageEventCount('session-a', '/work/a', 0, 172_800_000)).toBe(1);
      expect(await repository.getSessionModelUsage('session-a', '/work/a', 0, 172_800_000)).toMatchObject([
        { model_id: 'model-a', input_tokens: 25, known_cost_micro_usd: 150 },
      ]);
      expect(await repository.getSessionStats('session-a', '/work/b')).toBeNull();
      expect(await repository.hasSessionStats('session-a')).toBe(true);
      expect(await repository.getSessionModelUsage('session-a', '/work/b', 0, 172_800_000)).toEqual([]);
      expect(await repository.getSessionUsageEventCount('session-a', '/work/b', 0, 172_800_000)).toBe(0);
    } finally {
      store.close();
    }
  });

  it('keeps unknown price null and rejects unsafe counters before writing', async () => {
    const store = openTestStore();
    try {
      const repository = new SessionStatsRepository(store);
      await repository.recordUsage({
        ...contribution,
        knownCostMicroUsd: null,
        costAuthority: 'unpriced',
        workspaceKey: '/work/a',
      });
      expect(await repository.getSessionStats('session-a', '/work/a')).toMatchObject({
        known_cost_micro_usd: null,
        has_unpriced: 1,
      });
      await expect(
        repository.recordUsage({
          ...contribution,
          eventKey: 'bad',
          inputTokens: Number.MAX_SAFE_INTEGER + 1,
        }),
      ).rejects.toThrow();
      expect(
        (await repository.getSessionStats('session-a', '/work/a'))?.input_tokens,
      ).toBe(20);
    } finally {
      store.close();
    }
  });

  it('replaces the complete model set at a newer event revision', async () => {
    const store = openTestStore();
    try {
      const repository = new SessionStatsRepository(store);
      await repository.recordEvent([
        contribution,
        { ...contribution, modelId: '__session_residual__', inputTokens: 0, knownCostMicroUsd: 30 },
      ]);
      await repository.recordEvent([{ ...contribution, revision: 2, inputTokens: 25 }]);
      const db = await store.ready();
      expect(db.prepare('SELECT model_id FROM session_usage_turns').all()).toMatchObject([{ model_id: 'model-a' }]);
      expect(db.prepare('SELECT known_cost_micro_usd FROM session_stats WHERE session_id = ?').get('session-a'))
        .toMatchObject({ known_cost_micro_usd: 150 });
      await repository.recordEvent([{ ...contribution, revision: 1, modelId: 'old-model' }]);
      expect(db.prepare('SELECT model_id FROM session_usage_turns').all()).toMatchObject([{ model_id: 'model-a' }]);
    } finally {
      store.close();
    }
  });

  it('retains workspace and host identity for a lane without a session row', async () => {
    const store = openTestStore();
    try {
      const repository = new SessionStatsRepository(store);
      await repository.recordUsage({ ...contribution, producer: 'cli-lane', sessionId: 'lane-a', workspaceKey: '/work/a', host: 'electron' });
      expect(await repository.getSessionStats('lane-a', '/work/a')).toMatchObject({ workspace_key: '/work/a', host: 'electron' });
      expect(await repository.getSessionStats('lane-a', '/work/b')).toBeNull();
      expect(await repository.getWorkspaceSessionCount('/work/a', 0, 172_800_000)).toBe(1);
      expect((await repository.getWorkspaceCoverage('/work/a'))?.first_captured_at_ms).toBeGreaterThan(86_400_000);
      expect(await repository.getWorkspaceCoverage('/work/b')).toBeNull();
    } finally {
      store.close();
    }
  });

  it('reports a failed queue write and still persists later accepted events', async () => {
    const store = openTestStore();
    try {
      const repository = new SessionStatsRepository(store);
      const original = repository.recordEvent.bind(repository);
      let calls = 0;
      jest.spyOn(repository, 'recordEvent').mockImplementation(async (rows) => {
        calls += 1;
        if (calls === 1) throw new Error('write failed');
        await original(rows);
      });
      const logger = { error: jest.fn() };
      const sink = new SqliteSessionUsageSink(repository, logger);
      const makeEvent = (index: number) => ({
        sessionId: 'lane-a', producer: 'cli-lane' as const,
        runId: `run-${index}`, turnId: null, eventKey: `event-${index}`,
        parentSessionId: null, subagentId: null, providerId: 'anthropic',
        occurredAtMs: 86_400_000, revision: 1,
        models: [{ modelId: 'model-a', inputTokens: 1, outputTokens: 0,
          cacheReadTokens: 0, cacheCreationTokens: 0, knownCostMicroUsd: 1,
          costAuthority: 'provider-reported' as const }],
        totalCostMicroUsd: 1, totalCostAuthority: 'provider-reported' as const,
        pricingVersion: null, workspaceKey: '/work/a', host: 'electron',
      });
      const writes = Array.from({ length: 70 }, (_, index) => sink.recordUsage(makeEvent(index)));
      const results = await Promise.allSettled(writes);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      await expect(sink.flush()).rejects.toThrow('1 session usage writes failed');
      expect(await repository.getWorkspaceMessageCount('/work/a', 0, 172_800_000)).toBe(69);
    } finally {
      store.close();
    }
  });

  it('rejects and logs queue overflow while draining every accepted write', async () => {
    const store = openTestStore();
    try {
      const repository = new SessionStatsRepository(store);
      const logger = { error: jest.fn() };
      const sink = new SqliteSessionUsageSink(repository, logger);
      const writes = Array.from({ length: 257 }, (_, index) => sink.recordUsage({
        sessionId: 'lane-a', producer: 'cli-lane', runId: `run-${index}`,
        turnId: null, eventKey: `event-${index}`, parentSessionId: null, subagentId: null,
        providerId: 'codex', occurredAtMs: 86_400_000, revision: 1,
        models: [{ modelId: 'gpt', inputTokens: 1, outputTokens: 0,
          cacheReadTokens: 0, cacheCreationTokens: 0, knownCostMicroUsd: null,
          costAuthority: 'unpriced' }],
        totalCostMicroUsd: null, totalCostAuthority: 'unpriced', pricingVersion: null,
        workspaceKey: '/work/a', host: 'cli',
      }));
      const results = await Promise.allSettled(writes);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('overflow'), expect.any(Error));
      await expect(sink.flush()).rejects.toThrow('1 session usage writes failed');
      expect(await repository.getWorkspaceMessageCount('/work/a', 0, 172_800_000)).toBe(256);
    } finally {
      store.close();
    }
  });

  it('rolls back all rows when a recomputed total exceeds safe integer range', async () => {
    const store = openTestStore();
    try {
      const repository = new SessionStatsRepository(store);
      await expect(
        repository.recordEvent([
          { ...contribution, inputTokens: Number.MAX_SAFE_INTEGER },
          {
            ...contribution,
            eventKey: 'result-b',
            modelId: 'model-b',
            inputTokens: 1,
          },
        ]),
      ).rejects.toThrow();
      expect(await repository.getSessionStats('session-a', '/work/a')).toBeNull();
      const db = await store.ready();
      expect(
        db.prepare('SELECT count(*) AS count FROM session_usage_turns').get(),
      ).toMatchObject({ count: 0 });
    } finally {
      store.close();
    }
  });
});

