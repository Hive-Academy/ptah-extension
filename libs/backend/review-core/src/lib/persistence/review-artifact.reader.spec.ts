import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS, SqliteConnectionService, type SqliteDatabase } from '@ptah-extension/persistence-sqlite';
import { Logger } from '@ptah-extension/vscode-core';
import { ReviewArtifactReader } from './review-artifact.reader';

describe('ReviewArtifactReader', () => {
  it('reads only a matching out/ artifact, checks its hash, and redacts credentials', async () => {
    const Database = require('better-sqlite3') as new (path: string) => SqliteDatabase;
    const db = new Database(':memory:');
    const attemptsRoot = await mkdtemp(join(tmpdir(), 'review-artifact-'));
    try {
      const migration = MIGRATIONS.find((entry) => entry.version === 65);
      if (!migration?.sql) throw new Error('Review migration missing');
      db.pragma('foreign_keys = ON');
      db.exec(migration.sql);
      const sha = 'a'.repeat(40);
      db.prepare(`INSERT INTO review_repositories (repo_id, owner, name, created_at, updated_at)
        VALUES ('repo', 'Hive-Academy', 'PtahCode', 1, 1)`).run();
      db.prepare(`INSERT INTO review_heads (repo_id, pr_number, head_sha, state, discovered_at)
        VALUES ('repo', 1, ?, 'active', 1)`).run(sha);
      db.prepare(`INSERT INTO review_attempts
        (attempt_id, repo_id, pr_number, head_sha, attempt_number, trigger, state, queued_at)
        VALUES ('a1', 'repo', 1, ?, 1, 'manual', 'completed', 1)`).run(sha);
      db.prepare(`INSERT INTO review_stages (attempt_id, stage, ordinal, state)
        VALUES ('a1', 'publication', 4, 'completed')`).run();
      const out = join(attemptsRoot, 'a1', 'out');
      await mkdir(out, { recursive: true });
      const path = join(out, 'review-export.json');
      const secret = `ghp_${'a'.repeat(30)}`;
      const content = JSON.stringify({ token: secret });
      await writeFile(path, content);
      const hash = createHash('sha256').update(content).digest('hex');
      db.prepare(`INSERT INTO review_artifacts
        (artifact_id, attempt_id, stage, ordinal, path, content_hash, size_bytes, validated_at)
        VALUES ('artifact', 'a1', 'publication', 4, ?, ?, ?, 1)`)
        .run(path, hash, Buffer.byteLength(content));
      const logger = Object.create(Logger.prototype) as Logger;
      const connection = new SqliteConnectionService(':memory:', logger);
      Object.defineProperty(connection, 'db', { value: db });
      const reader = new ReviewArtifactReader(connection, { attemptsRoot });
      expect((await reader.exportRun('a1')).content).not.toContain(secret);
      await writeFile(path, content + ' ');
      await expect(reader.exportRun('a1')).rejects.toThrow('integrity');
      const otherOut = join(attemptsRoot, 'other', 'out');
      await mkdir(otherOut, { recursive: true });
      const otherPath = join(otherOut, 'review-export.json');
      await writeFile(otherPath, content);
      db.prepare('UPDATE review_artifacts SET path = ? WHERE artifact_id = ?')
        .run(otherPath, 'artifact');
      await expect(reader.exportRun('a1')).rejects.toThrow('path invalid');
    } finally {
      db.close();
      await rm(attemptsRoot, { recursive: true, force: true });
    }
  });
});
