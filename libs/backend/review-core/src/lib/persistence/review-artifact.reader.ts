import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import { PERSISTENCE_TOKENS, SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import { ReviewRpcSchemas } from '@ptah-extension/review-contracts';
import { REVIEW_CORE_TOKENS } from '../../di/tokens';
import type { ReviewStageEnvironment } from '../stages/context-stage.runner';

export interface IReviewArtifactReader {
  exportRun(attemptId: string): Promise<{ content: string; fileName: string }>;
}

const artifactRow = z.object({ path: z.string(), size_bytes: z.number().int().nonnegative(),
  content_hash: z.string().regex(/^[0-9a-f]{64}$/) });
const MAX_BYTES = 1_000_000;

@injectable()
export class ReviewArtifactReader implements IReviewArtifactReader {
  constructor(
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION) private readonly sqlite: SqliteConnectionService,
    @inject(REVIEW_CORE_TOKENS.ENVIRONMENT) private readonly environment: Pick<ReviewStageEnvironment, 'attemptsRoot'>,
  ) {}

  async exportRun(attemptId: string): Promise<{ content: string; fileName: string }> {
    const id = ReviewRpcSchemas['review:exportRun'].params.parse({ attemptId }).attemptId;
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid review attempt ID');
    const raw = this.sqlite.db.prepare(`SELECT path, size_bytes, content_hash FROM review_artifacts
      WHERE attempt_id = ? AND path LIKE '%review-export.json' ORDER BY validated_at DESC LIMIT 1`).get(id);
    if (!raw) throw new Error('Review export unavailable');
    const artifact = artifactRow.parse(raw);
    if (artifact.size_bytes > MAX_BYTES || !isAbsolute(artifact.path) || basename(artifact.path) !== 'review-export.json')
      throw new Error('Review export path or size invalid');
    const attemptsRoot = await realpath(this.environment.attemptsRoot);
    const expectedRoot = resolve(attemptsRoot, id, 'out');
    const root = await realpath(expectedRoot);
    if (root !== expectedRoot) throw new Error('Review output root escaped');
    const file = await realpath(artifact.path);
    const rel = relative(root, file);
    if (basename(root) !== 'out' || rel !== 'review-export.json' || file !== join(root, rel))
      throw new Error('Review export path invalid');
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_BYTES) throw new Error('Review export too large');
    const bytes = await readFile(file);
    if (bytes.length > MAX_BYTES || bytes.length !== artifact.size_bytes ||
      createHash('sha256').update(bytes).digest('hex') !== artifact.content_hash)
      throw new Error('Review export integrity check failed');
    const content = bytes.toString('utf8');
    // Apply the writer's pattern redaction again when reading older exports.
    const redacted = content
      .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g, '[REDACTED]')
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, '[REDACTED]')
      .replace(/\b(authorization|x-api-key|api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
      .replace(/\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)\s*=\s*[^\s,;]+/g, '[REDACTED]');
    return ReviewRpcSchemas['review:exportRun'].result.parse({ content: redacted, fileName: `review-${id}.json` });
  }
}
