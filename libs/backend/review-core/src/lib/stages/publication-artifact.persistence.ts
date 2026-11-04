import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { ulid } from 'ulid';
import type { SqliteDatabase } from '@ptah-extension/persistence-sqlite';

/** Records the bytes written by the publication stage for checked reads. */
export async function persistExportArtifact(db: SqliteDatabase, attemptId: string, path: string): Promise<void> {
  if (basename(path) !== 'review-export.json') throw new Error('Invalid review export path');
  const bytes = await readFile(path);
  if (bytes.length > 1_000_000) throw new Error('Review export exceeds size limit');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const now = Date.now();
  db.prepare(`INSERT INTO review_artifacts
    (artifact_id, attempt_id, stage, ordinal, path, content_hash, size_bytes, validated_at, retain_until)
    VALUES (?, ?, 'publication', 4, ?, ?, ?, ?, NULL)
    ON CONFLICT(attempt_id, path) DO UPDATE SET content_hash = excluded.content_hash,
      size_bytes = excluded.size_bytes, validated_at = excluded.validated_at`)
    .run(ulid(now), attemptId, path, hash, bytes.length, now);
}
