/**
 * Adopting the skills a PREVIOUS Ptah installed into `{ws}/.claude/skills`.
 *
 * Those skills are the reason this task exists. They are unowned by any
 * manifest and named by no desired state, so `.claude/skills` being a MANAGED
 * directory makes every one of them permanently `foreign` in
 * `ptah harness doctor` — a finding the user cannot clear, for a file Ptah
 * itself put there. Leaving them behind would fix the defect only for skills
 * installed after the upgrade.
 *
 * THE PROOF, AND WHY IT IS NOT A HEURISTIC. Skills carry no writer signature
 * and never will (harness-sync's CLAUDE.md, "Legacy adoption"): a managed copy
 * is a byte copy of user-layer markdown, so a stale one is indistinguishable
 * from a `SKILL.md` the user wrote by hand. Guessing from a slug, an mtime or a
 * frontmatter field would be exactly the invented heuristic that rule forbids,
 * and getting it wrong means swallowing someone's own work.
 *
 * But there IS a record, and it is not ours: the `skills` CLI writes
 * `{ws}/skills-lock.json` on every install, mapping each installed slug to the
 * `owner/repo` it came from. Measured against `skills@latest`:
 *
 *     { "version": 1,
 *       "skills": {
 *         "skill-creator": {
 *           "source": "anthropics/skills",
 *           "sourceType": "github",
 *           "skillPath": "skills/skill-creator/SKILL.md",
 *           "computedHash": "7e3c9cd7…" } } }
 *
 * That file states, per slug, "the skills CLI put this here and it came from
 * there". It is the same KIND of evidence as the legacy `.ptah-managed.json`
 * this repo already adopts from — a record of ownership rather than an
 * inference about content. A slug the lockfile does not name is never touched,
 * which is what keeps a hand-written `.claude/skills/foo` exactly where it is.
 *
 * WHAT IS DELIBERATELY NOT ADOPTED:
 *
 * - **`~/.claude/skills` (the old `scope: 'global'` destination).** There is no
 *   home-level lockfile to read, so a directory there has no record naming it
 *   and cannot be distinguished from a skill the user installed themselves
 *   outside Ptah. Per the rule above, leaving it is the correct answer — it
 *   stays outside the workspace, where the workspace-scoped reconciler never
 *   looked at it and never reported it either.
 * - **A slug with a lockfile entry whose `source` is not an `owner/repo`.**
 *   There is no source root to adopt it into without inventing one.
 * - **A slug whose directory is already gone.** Nothing to move; the entry is
 *   left in place rather than cleaned up, because deleting a record is not this
 *   function's job.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';

import type { Logger } from '@ptah-extension/vscode-core';

import {
  SKILLS_SH_METADATA_FILE,
  SkillsShRootMetadataSchema,
  skillsShRootId,
  type SkillsShRootMetadata,
} from './skills-sh-source-root';

/** `{ws}/skills-lock.json`, as written by the third-party `skills` CLI. */
const SkillsLockSchema = z.object({
  version: z.number().optional(),
  skills: z.record(
    z.string(),
    z.object({
      source: z.string(),
      sourceType: z.string().optional(),
      skillPath: z.string().optional(),
      computedHash: z.string().optional(),
    }),
  ),
});

export const SKILLS_LOCK_FILE = 'skills-lock.json';

export interface LegacyAdoptionDeps {
  workspaceRoot: string;
  pluginsBasePath: string;
  logger: Logger;
}

/**
 * Move every lockfile-attested skill out of `{ws}/.claude/skills` and into its
 * source root. Returns how many were adopted.
 *
 * Never throws — a migration that fails must not fail the install that
 * triggered it, and the next trigger tries again.
 *
 * The order per slug is copy → delete → drop the record, so a crash anywhere
 * leaves the content present in at least one place and the record still
 * pointing at work to redo. Re-running over an already-adopted slug re-copies
 * identical bytes and is a no-op in effect.
 */
export async function adoptLegacySkillsShInstalls(
  deps: LegacyAdoptionDeps,
): Promise<number> {
  const { workspaceRoot, pluginsBasePath, logger } = deps;
  const lockPath = path.join(workspaceRoot, SKILLS_LOCK_FILE);

  const lock = await readLock(lockPath);
  if (lock === null) return 0;

  const legacySkillsDir = path.join(workspaceRoot, '.claude', 'skills');
  const remaining: Record<string, (typeof lock.skills)[string]> = {};
  let adopted = 0;

  for (const [slug, entry] of Object.entries(lock.skills)) {
    const rootId = skillsShRootId(entry.source);
    const legacyDir = path.join(legacySkillsDir, slug);

    if (rootId === null || !(await isSkillDir(legacyDir))) {
      remaining[slug] = entry;
      continue;
    }

    try {
      const rootDir = path.join(pluginsBasePath, rootId);
      const target = path.join(rootDir, 'skills', slug);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.rm(target, { recursive: true, force: true });
      await fs.cp(legacyDir, target, { recursive: true });
      await mergeMetadata(rootDir, entry.source, slug);
      await fs.rm(legacyDir, { recursive: true, force: true });
      adopted += 1;
      logger.info('[skills.sh] Adopted a legacy install into its source root', {
        slug,
        source: entry.source,
        rootId,
      });
    } catch (error: unknown) {
      remaining[slug] = entry;
      logger.warn('[skills.sh] Could not adopt a legacy install; leaving it', {
        slug,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (adopted > 0) {
    await rewriteLock(lockPath, lock.version, remaining, logger);
  }
  return adopted;
}

async function readLock(
  lockPath: string,
): Promise<z.infer<typeof SkillsLockSchema> | null> {
  try {
    const parsed = SkillsLockSchema.safeParse(
      JSON.parse(await fs.readFile(lockPath, 'utf8')),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    // No lockfile is the normal case for a workspace that never used skills.sh.
    return null;
  }
}

/**
 * Drop the adopted entries. An emptied lockfile is deleted rather than left as
 * `{"skills":{}}`, so a workspace that has fully migrated carries no leftover
 * file from a tool it no longer routes through.
 */
async function rewriteLock(
  lockPath: string,
  version: number | undefined,
  remaining: Record<string, unknown>,
  logger: Logger,
): Promise<void> {
  try {
    if (Object.keys(remaining).length === 0) {
      await fs.rm(lockPath, { force: true });
      return;
    }
    const next = {
      ...(version === undefined ? {} : { version }),
      skills: remaining,
    };
    await fs.writeFile(lockPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  } catch (error: unknown) {
    // The content already moved; a stale record only costs a repeat no-op.
    logger.warn(
      '[skills.sh] Adopted skills but could not update the lockfile',
      {
        lockPath,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

async function isSkillDir(dir: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(dir);
    if (!stat.isDirectory()) return false;
    await fs.access(path.join(dir, 'SKILL.md'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Record the adopted slug without dropping what a previous install wrote.
 *
 * A corrupt or absent record is replaced rather than repaired: it is a lookup
 * table for `listInstalled`, and the skills themselves are on disk either way.
 */
async function mergeMetadata(
  rootDir: string,
  source: string,
  slug: string,
): Promise<void> {
  const metadataPath = path.join(rootDir, SKILLS_SH_METADATA_FILE);
  let existing: SkillsShRootMetadata | null = null;
  try {
    const parsed = SkillsShRootMetadataSchema.safeParse(
      JSON.parse(await fs.readFile(metadataPath, 'utf8')),
    );
    existing = parsed.success ? parsed.data : null;
  } catch {
    existing = null;
  }

  const next: SkillsShRootMetadata = {
    version: 1,
    source,
    skillIds: [...new Set([...(existing?.skillIds ?? []), slug])].sort(),
    installedAt: existing?.installedAt ?? new Date().toISOString(),
  };
  await fs.writeFile(
    metadataPath,
    `${JSON.stringify(next, null, 2)}\n`,
    'utf8',
  );
}
