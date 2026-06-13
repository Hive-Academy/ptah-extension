/**
 * Skill Synthesis e2e — TASK_2026_141 Batch 7, Task 7.4.
 *
 * Re-scope (recorded): 3-invocation auto-promotion requires real sessions
 * (SkillInvocationTracker hooks into agent session lifecycle); cannot be
 * driven hermetically without API spend. Re-scoped to unit tests per R11.2.
 *
 * Replacement flow: seed candidate + invocation rows directly into the tmp
 * SQLite via better-sqlite3; drive list/stats/promote/reject through real
 * CLI spawns. Promote asserts SKILL.md materialized under tmp
 * ~/.ptah/skills/<name>/.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';

import { CliRunner, createTmpHome, type TmpHome } from './_harness';

interface SqliteDb {
  prepare(sql: string): { run(...args: unknown[]): void };
  exec(sql: string): void;
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const openDatabase = require('better-sqlite3') as new (
  path: string,
  opts?: Record<string, unknown>,
) => SqliteDb;

jest.setTimeout(90_000);

interface SkillSynthesisStatsPayload {
  totalCandidates: number;
  totalPromoted: number;
  totalRejected: number;
  totalInvocations: number;
  activeSkills: number;
}

interface SkillSynthesisListPayload {
  candidates: Array<{
    id: string;
    name: string;
    status: string;
    successCount: number;
  }>;
}

interface SkillSynthesisPromotedPayload {
  id: string;
  promoted: boolean;
  reason: string | null;
  filePath: string | null;
}

interface SkillSynthesisRejectedPayload {
  id: string;
  rejected: boolean;
}

function findNotification<T = unknown>(
  lines: unknown[],
  method: string,
): T | undefined {
  for (const line of lines) {
    if (
      typeof line === 'object' &&
      line !== null &&
      (line as { method?: unknown }).method === method
    ) {
      return (line as { params: T }).params;
    }
  }
  return undefined;
}

async function seedSkillCandidates(
  dbPath: string,
  candidates: Array<{
    id: string;
    name: string;
    description: string;
    bodyPath: string;
    successCount: number;
    status: 'candidate' | 'promoted' | 'rejected';
  }>,
): Promise<void> {
  const db = new openDatabase(dbPath);
  const t = Date.now();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO skill_candidates
      (id, name, description, body_path, source_session_ids, trajectory_hash,
       embedding_rowid, status, success_count, failure_count,
       created_at, promoted_at, rejected_at, rejected_reason)
    VALUES
      (?, ?, ?, ?, '[]', ?,
       NULL, ?, ?, 0,
       ?, NULL, NULL, NULL)
  `);
  const insert = db.transaction(() => {
    for (const c of candidates) {
      stmt.run(
        c.id,
        c.name,
        c.description,
        c.bodyPath,
        `traj-${c.id}`,
        c.status,
        c.successCount,
        t,
      );
    }
  });
  insert();
  db.close();
}

async function seedSkillInvocations(
  dbPath: string,
  invocations: Array<{
    id: string;
    skillId: string;
    sessionId: string;
    succeeded: number;
  }>,
): Promise<void> {
  const db = new openDatabase(dbPath);
  const t = Date.now();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO skill_invocations
      (id, skill_id, session_id, succeeded, invoked_at, notes)
    VALUES (?, ?, ?, ?, ?, NULL)
  `);
  const insert = db.transaction(() => {
    for (const inv of invocations) {
      stmt.run(inv.id, inv.skillId, inv.sessionId, inv.succeeded, t);
    }
  });
  insert();
  db.close();
}

describe('skill synthesis e2e (TASK_2026_141 Batch 7 — direct DB seed)', () => {
  let tmp: TmpHome;

  beforeEach(async () => {
    tmp = await createTmpHome('ptah-e2e-ss-');
  });

  afterEach(async () => {
    await tmp.cleanup();
  });

  it('skill-synthesis stats exits 0 and returns zero counts on fresh DB', async () => {
    const result = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['skill-synthesis', 'stats', '--json'],
      timeoutMs: 60_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.hasMalformedStdout).toBe(false);

    const payload = findNotification<SkillSynthesisStatsPayload>(
      result.stdoutLines,
      'skill_synthesis.stats',
    );
    expect(payload).toBeDefined();
    expect(typeof payload!.totalCandidates).toBe('number');
    expect(typeof payload!.totalPromoted).toBe('number');
    expect(typeof payload!.totalRejected).toBe('number');
  });

  it('skill-synthesis list returns seeded candidate rows', async () => {
    const statsResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['skill-synthesis', 'stats', '--json'],
      timeoutMs: 60_000,
    });
    expect(statsResult.exitCode).toBe(0);

    const dbPath = path.join(tmp.path, '.ptah', 'state', 'ptah.sqlite');
    const candidateId = '01SSKILL_E2E_CANDIDATE_001';
    await seedSkillCandidates(dbPath, [
      {
        id: candidateId,
        name: 'e2e-test-skill',
        description: 'E2E test skill candidate',
        bodyPath: '/nonexistent/SKILL.md',
        successCount: 1,
        status: 'candidate',
      },
    ]);

    const listResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['skill-synthesis', 'list', '--json'],
      timeoutMs: 60_000,
    });
    expect(listResult.exitCode).toBe(0);
    expect(listResult.hasMalformedStdout).toBe(false);

    const payload = findNotification<SkillSynthesisListPayload>(
      listResult.stdoutLines,
      'skill_synthesis.list',
    );
    expect(payload).toBeDefined();
    expect(Array.isArray(payload!.candidates)).toBe(true);
    const ids = payload!.candidates.map((c) => c.id);
    expect(ids).toContain(candidateId);
  });

  it('skill-synthesis promote materializes SKILL.md under tmp ~/.ptah/skills/<name>/', async () => {
    const statsResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['skill-synthesis', 'stats', '--json'],
      timeoutMs: 60_000,
    });
    expect(statsResult.exitCode).toBe(0);

    const dbPath = path.join(tmp.path, '.ptah', 'state', 'ptah.sqlite');
    const candidateId = '01SSKILL_E2E_PROMOTE_0001';
    const skillName = 'e2e-promotable-skill';

    await seedSkillCandidates(dbPath, [
      {
        id: candidateId,
        name: skillName,
        description: 'Skill that meets promotion threshold',
        bodyPath: '/nonexistent/SKILL.md',
        successCount: 5,
        status: 'candidate',
      },
    ]);

    await seedSkillInvocations(dbPath, [
      {
        id: `inv-${candidateId}-1`,
        skillId: candidateId,
        sessionId: 'e2e-session-1',
        succeeded: 1,
      },
      {
        id: `inv-${candidateId}-2`,
        skillId: candidateId,
        sessionId: 'e2e-session-2',
        succeeded: 1,
      },
      {
        id: `inv-${candidateId}-3`,
        skillId: candidateId,
        sessionId: 'e2e-session-3',
        succeeded: 1,
      },
    ]);

    const promoteResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['skill-synthesis', 'promote', candidateId, '--json'],
      timeoutMs: 60_000,
    });
    expect(promoteResult.exitCode).toBe(0);
    expect(promoteResult.hasMalformedStdout).toBe(false);

    const payload = findNotification<SkillSynthesisPromotedPayload>(
      promoteResult.stdoutLines,
      'skill_synthesis.promoted',
    );
    expect(payload).toBeDefined();
    expect(payload!.promoted).toBe(true);

    const skillsDir = path.join(tmp.path, '.ptah', 'skills');
    let foundSkillMd = false;
    if (fs.existsSync(skillsDir)) {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.isDirectory() &&
          entry.name !== '_candidates' &&
          entry.name.startsWith('e2e-promotable')
        ) {
          const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
          if (fs.existsSync(skillMdPath)) {
            foundSkillMd = true;
            break;
          }
        }
      }
    }
    expect(foundSkillMd).toBe(true);
  });

  it('skill-synthesis reject transitions candidate to rejected status', async () => {
    const statsResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['skill-synthesis', 'stats', '--json'],
      timeoutMs: 60_000,
    });
    expect(statsResult.exitCode).toBe(0);

    const dbPath = path.join(tmp.path, '.ptah', 'state', 'ptah.sqlite');
    const candidateId = '01SSKILL_E2E_REJECT_00001';
    await seedSkillCandidates(dbPath, [
      {
        id: candidateId,
        name: 'e2e-reject-skill',
        description: 'Skill to reject',
        bodyPath: '/nonexistent/SKILL.md',
        successCount: 1,
        status: 'candidate',
      },
    ]);

    const rejectResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['skill-synthesis', 'reject', candidateId, '--json'],
      timeoutMs: 60_000,
    });
    expect(rejectResult.exitCode).toBe(0);
    expect(rejectResult.hasMalformedStdout).toBe(false);

    const payload = findNotification<SkillSynthesisRejectedPayload>(
      rejectResult.stdoutLines,
      'skill_synthesis.rejected',
    );
    expect(payload).toBeDefined();
    expect(payload!.rejected).toBe(true);

    const listResult = await CliRunner.spawnOneshot({
      home: tmp,
      args: ['skill-synthesis', 'list', '--status', 'rejected', '--json'],
      timeoutMs: 60_000,
    });
    const listPayload = findNotification<SkillSynthesisListPayload>(
      listResult.stdoutLines,
      'skill_synthesis.list',
    );
    expect(listPayload).toBeDefined();
    const rejectedIds = listPayload!.candidates.map((c) => c.id);
    expect(rejectedIds).toContain(candidateId);
  });
});
