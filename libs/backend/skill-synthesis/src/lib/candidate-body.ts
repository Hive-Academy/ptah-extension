/**
 * Reading a candidate's drafted `SKILL.md` body.
 *
 * This lived as a module-private function in `skill-synthesis.service.ts` while
 * that file owned both of its callers. TASK_2026_256 split the stage handlers
 * into `queue/stage-handlers.service.ts`, which took ONE of those callers with
 * it (the gate body) and left the other behind (the embedding backfill), so the
 * function had to move somewhere both can see rather than be copied a fourth
 * time.
 *
 * `skill-promotion.service.ts` and `skill-curator.service.ts` still carry their
 * own copies. Folding those two in is the cleanup this file's predecessor
 * comment filed; it is deliberately NOT done here, because those files belong to
 * other batches and this move is behaviour-preserving.
 */
import * as fs from 'node:fs';
import type { Logger } from '@ptah-extension/vscode-core';
import type { SkillCandidateRow } from './types';

/**
 * A candidate's `SKILL.md` body with its YAML frontmatter stripped, or `null`
 * when there is no readable file.
 *
 * `null` rather than a stand-in string BECAUSE THE CALLERS DISAGREE about what
 * a missing file should become: the embedding backfill folds the row's own
 * `name`/`description` into the vector text, while a gate needs a minimal
 * document to score. Baking one of those in would silently change the other —
 * the backfill would embed `description` twice and every vector for a
 * file-less candidate would move.
 */
export function readCandidateBodyFile(
  candidate: SkillCandidateRow,
  logger: Logger,
): string | null {
  try {
    if (candidate.bodyPath && fs.existsSync(candidate.bodyPath)) {
      const raw = fs.readFileSync(candidate.bodyPath, 'utf8');
      return raw.replace(/^---[\s\S]*?---\s*/, '').trim();
    }
  } catch (error: unknown) {
    logger.debug('[skill-synthesis] could not read candidate body', {
      bodyPath: candidate.bodyPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return null;
}
