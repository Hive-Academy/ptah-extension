/**
 * Phase 2 working copies shared by `copy-audit.ts` (KNN starvation) and
 * `merge-replay.ts` (M3 8a/8b).
 *
 * Copy B (implementation-plan.md measurement table, "M3 reach"): a backup-API
 * working copy migrated to 48 ONLY, so 0049 cannot hide commitlint rows. It is
 * created once, by whichever mode needs it first, and every later mode opens
 * it without writing (its reads never mutate it: `findMergeCandidates`,
 * `searchRich`, `searchIndex` and the collector have no write path). The copy
 * record is written to `output/m3-copyB.json` when the copy is created.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  MIGRATIONS,
  SqliteMigrationRunner,
  type SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';
import { TIER2_QUERY_MAX_CHARS } from '../../../../../libs/backend/memory-curator/src/lib/curator-llm/merge-candidate-collector';
import { EVAL_DIR, makeWorkingCopy, type WorkingCopyRecord } from './copy-db';
import { makeLogger, openWorkingCopy } from './connection';

export const OUT_DIR =
  process.env['MQS_OUT_DIR'] ??
  'D:\\projects\\ptah-extension-memory-quality-source\\.ptah\\specs\\TASK_2026_563_2939\\harness\\output';
export const WORKSPACE = 'D:\\projects\\ptah-extension';
export const COPY_B_NAME = 'copyB-m3.sqlite';

export function writeJson(name: string, value: unknown): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, name),
    JSON.stringify(value, null, 2) + '\n',
  );
  process.stdout.write(`wrote ${path.join(OUT_DIR, name)}\n`);
}

export function scalar(
  db: SqliteDatabase,
  sql: string,
  ...params: unknown[]
): number {
  const row = db.prepare(sql).get(...params) as Record<string, unknown>;
  return Number(Object.values(row)[0]);
}

/**
 * A fresh backup-API copy migrated with the production runner to `maxVersion`
 * (48 = M5 off, 49 = everything). Returns the copy record plus the runner result.
 */
export async function makeMigratedCopy(
  fileName: string,
  maxVersion: 48 | 49,
): Promise<{
  record: WorkingCopyRecord;
  applied: unknown;
  migrationMs: number;
  schemaMax: number;
}> {
  const bundledMax = Math.max(...MIGRATIONS.map((m) => m.version));
  if (bundledMax !== 49) {
    throw new Error(
      `Phase 2 must be bundled from the BRANCH sources (MIGRATIONS max 49); got ${bundledMax}`,
    );
  }
  const record = await makeWorkingCopy(fileName);
  process.stdout.write(`working copy: ${JSON.stringify(record)}\n`);
  const conn = openWorkingCopy(record.target, { loadVec: true });
  try {
    const t0 = performance.now();
    const applied = await new SqliteMigrationRunner(
      conn.db,
      makeLogger(`migrate:${fileName}`, true),
    ).applyAll(
      MIGRATIONS.filter((m) => m.version <= maxVersion),
      { vecExtensionLoaded: conn.vecExtensionLoaded },
    );
    const migrationMs = Math.round(performance.now() - t0);
    const schemaMax = scalar(
      conn.db,
      'SELECT MAX(version) FROM schema_migrations',
    );
    if (schemaMax !== maxVersion)
      throw new Error(
        `${fileName}: schema max ${schemaMax}, expected ${maxVersion}`,
      );
    return { record, applied, migrationMs, schemaMax };
  } finally {
    conn.close();
  }
}

/** Copy B: create (48 only) on first use, then reuse. */
export async function ensureCopyB(): Promise<string> {
  const target = path.join(EVAL_DIR, COPY_B_NAME);
  if (fs.existsSync(target)) {
    const conn = openWorkingCopy(target, { readonly: true });
    try {
      const max = scalar(conn.db, 'SELECT MAX(version) FROM schema_migrations');
      if (max !== 48)
        throw new Error(`existing copy B has schema max ${max}, expected 48`);
    } finally {
      conn.close();
    }
    return target;
  }
  const made = await makeMigratedCopy(COPY_B_NAME, 48);
  writeJson('m3-copyB.json', {
    copy: 'B (migrated to 48 only; M5/0049 off)',
    workingCopy: made.record,
    migration: {
      applied: made.applied,
      durationMs: made.migrationMs,
      schemaMaxAfter: made.schemaMax,
    },
  });
  return made.record.target;
}

export interface ScopeEnumRow {
  readonly id: string;
  readonly subject: string;
  readonly content: string;
  readonly created_at: number;
  readonly workspace_root: string | null;
}

/**
 * The 8(a) draft source: the newest row whose case-folded subject is
 * `commitlint-scope-enum` in the measured workspace (created_at, then id).
 */
export function newestScopeEnumRow(db: SqliteDatabase): ScopeEnumRow {
  const row = db
    .prepare(
      `SELECT id, subject, content, created_at, workspace_root FROM memories
        WHERE TRIM(LOWER(subject)) = 'commitlint-scope-enum' AND workspace_root IS ?
        ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(WORKSPACE) as ScopeEnumRow | undefined;
  if (!row)
    throw new Error(
      'no commitlint-scope-enum row in the workspace on this copy',
    );
  return row;
}

/** The tier-2 query the collector builds for one draft (merge-candidate-collector.ts:204-206). */
export function collectorQuery(
  subject: string | null,
  content: string,
): string {
  return `${subject ?? ''} ${content}`.trim().slice(0, TIER2_QUERY_MAX_CHARS);
}
