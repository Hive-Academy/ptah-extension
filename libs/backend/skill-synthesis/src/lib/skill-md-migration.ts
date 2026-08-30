/**
 * skill-md-migration — idempotent migration of SKILL.md files to the
 * agentskills.io extended frontmatter format (adds `when_to_use:` field).
 *
 * Safe to re-run: files that already contain `when_to_use:` are skipped.
 *
 * ## Why there is a persisted marker
 *
 * This is a ONE-TIME CONTENT migration. Once a root has been walked cleanly,
 * every file in it already carries `when_to_use:`, so every later launch spends
 * blocking synchronous I/O to re-confirm a conclusion it already reached.
 *
 * Measured 2026-08-28 against a real `~/.ptah/skills` holding 2420 `SKILL.md`
 * files (9.2 MB): walk (`readdirSync`) 188.6 ms + read (`readFileSync`)
 * 199.2 ms = 388 ms, warm cache, on the main thread, with no yields — and
 * `skill-synthesis.service.ts` calls this TWICE per start, once per root. The
 * marker turns that into two indexed SQLite point reads.
 *
 * The gate has exactly two inputs, both cheap and both honest:
 *
 *   - {@link SKILL_MD_MIGRATION_VERSION} — the version of the CONTENT transform
 *     below. Change the transform, bump the constant, and every stored marker
 *     is invalidated, so the next launch re-walks.
 *   - {@link SKILL_MD_MIGRATION_RESCAN_INTERVAL_MS} — a 24 h ceiling on how
 *     stale a marker may be, so a file written by another tool is picked up
 *     within a day without anyone having to invalidate the marker by hand.
 *
 * DIRECTORY mtime IS DELIBERATELY NOT AN INPUT. A directory's mtime does not
 * change when a file inside one of its SUBdirectories is edited, and every
 * `SKILL.md` lives one level down in `<root>/<slug>/SKILL.md`. A mtime
 * comparison would therefore skip real work with full confidence.
 *
 * THE MARKER MAY ONLY EVER CAUSE A WALK, NEVER PREVENT ONE INCORRECTLY. Every
 * uncertainty — no store, a store that throws, an unparseable state, a
 * timestamp in the future — resolves to "walk". A marker read is an
 * optimisation; losing it costs 388 ms, whereas trusting a bad one loses the
 * migration.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';

/**
 * Version of the CONTENT transform this module applies (the `when_to_use:`
 * frontmatter injection). It is NOT the SQLite schema version — the table lives
 * in migration `0041` and will not move when this constant does.
 *
 * BUMP THIS whenever {@link addWhenToUseFrontmatter} or
 * {@link extractWhenToUse} changes what a migrated file looks like. Every
 * stored marker carrying a different value is treated as absent, so the next
 * launch walks every root again and applies the new shape to files the previous
 * shape had already touched.
 */
export const SKILL_MD_MIGRATION_VERSION = 1;

/** 24 h. How stale a marker may be before the walk runs regardless. */
export const SKILL_MD_MIGRATION_RESCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** The persisted marker for one scanned root. */
export interface SkillMdMigrationMarkerState {
  /** The {@link SKILL_MD_MIGRATION_VERSION} in force when the walk completed. */
  readonly migrationVersion: number;
  /** Epoch ms at which that walk completed. */
  readonly lastScanAt: number;
}

/**
 * The marker port. Declared HERE, beside its only consumer, rather than in the
 * store that implements it — this module owns the question ("has this root
 * already been migrated?") and `SkillMdMigrationStateStore` is one answer to
 * it. A host with no persistence passes `null` and gets today's behaviour.
 *
 * Implementations MUST degrade rather than throw: an unavailable database is a
 * missing optimisation, not a failure of the migration. `migrateSkillMdFiles`
 * catches anyway, because a port cannot enforce that on its implementors.
 */
export interface SkillMdMigrationMarkerStore {
  /** The stored marker for `skillsRoot`, or `null` if this root has none. */
  read(skillsRoot: string): SkillMdMigrationMarkerState | null;
  /** Record that `skillsRoot` was walked cleanly. */
  write(skillsRoot: string, state: SkillMdMigrationMarkerState): void;
}

export interface MigrationResult {
  migrated: number;
  skipped: number;
  errors: string[];
  /**
   * True when a current marker short-circuited the pass, so NEITHER
   * `readdirSync` NOR `readFileSync` ran. The other three fields are all zero /
   * empty in that case, and they mean "nothing was done", not "nothing needed
   * doing" — the caller logs the flag so the two are distinguishable.
   */
  skippedByMarker: boolean;
}

/**
 * Recursively find all SKILL.md files under `skillsDir`, update frontmatter
 * to include a `when_to_use:` field if absent.
 *
 * @param skillsDir Root directory to search for SKILL.md files.
 * @param logger    Logger for debug/warn messages.
 * @param marker    Optional persisted marker store. When it reports a current
 *                  marker for `skillsDir` the walk is skipped entirely; when it
 *                  is absent, empty, stale or broken the walk runs.
 * @returns Summary of migrated, skipped, and errored files.
 */
export function migrateSkillMdFiles(
  skillsDir: string,
  logger: Logger,
  marker?: SkillMdMigrationMarkerStore | null,
): MigrationResult {
  const result: MigrationResult = {
    migrated: 0,
    skipped: 0,
    errors: [],
    skippedByMarker: false,
  };

  // FIRST, before any file-system call at all. This is the whole point of the
  // marker: on a warm second launch the function must touch neither
  // `readdirSync` nor `readFileSync`.
  if (isMarkerCurrent(skillsDir, logger, marker)) {
    result.skippedByMarker = true;
    logger.debug(
      '[skill-synthesis] SKILL.md migration skipped by marker (already migrated)',
      { skillsDir, migrationVersion: SKILL_MD_MIGRATION_VERSION },
    );
    return result;
  }

  let files: string[];
  try {
    files = findSkillMdFiles(skillsDir);
  } catch (err: unknown) {
    logger.debug(
      '[skill-synthesis] migrateSkillMdFiles: dir not found or empty',
      {
        skillsDir,
        error: err instanceof Error ? err.message : String(err),
      },
    );
    // Deliberately NO marker write. A root that could not be read has not been
    // migrated, and marking it done would hide it for the next 24 h.
    return result;
  }

  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      if (/^when_to_use:/m.test(content)) {
        result.skipped++;
        continue;
      }

      const rewritten = addWhenToUseFrontmatter(content);
      if (rewritten === null) {
        result.skipped++;
        continue;
      }

      fs.writeFileSync(filePath, rewritten, 'utf8');
      result.migrated++;
      logger.debug('[skill-synthesis] migrated SKILL.md', { filePath });
    } catch (err: unknown) {
      const msg = `${filePath}: ${err instanceof Error ? err.message : String(err)}`;
      result.errors.push(msg);
      logger.warn(
        '[skill-synthesis] migrateSkillMdFiles: error processing file',
        {
          filePath,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }

  // ONLY after a walk that completed with nothing left undone. A pass that
  // errored on even one file has files still carrying the old shape; marking
  // the root done would give up on them for a day, and on every later launch
  // for as long as the failure persists.
  if (result.errors.length === 0) {
    writeMarker(skillsDir, logger, marker);
  }

  return result;
}

/**
 * True only when the stored marker positively proves this root is already
 * migrated under the CURRENT transform and was checked recently. Every other
 * outcome — including every error — is false, i.e. "walk".
 */
function isMarkerCurrent(
  skillsRoot: string,
  logger: Logger,
  marker: SkillMdMigrationMarkerStore | null | undefined,
): boolean {
  if (!marker) return false;

  let state: SkillMdMigrationMarkerState | null;
  try {
    state = marker.read(skillsRoot);
  } catch (err: unknown) {
    // The store is expected to swallow its own failures, but a port cannot
    // enforce that. A throwing marker must never cost the migration.
    logger.debug(
      '[skill-synthesis] SKILL.md migration marker unreadable; walking',
      {
        skillsRoot,
        error: err instanceof Error ? err.message : String(err),
      },
    );
    return false;
  }

  if (!state) return false;
  if (state.migrationVersion !== SKILL_MD_MIGRATION_VERSION) return false;
  if (!Number.isFinite(state.lastScanAt)) return false;

  const ageMs = Date.now() - state.lastScanAt;
  // A negative age means the marker is stamped in the future — a clock change,
  // or a row written by a host whose clock is ahead. Walking is the safe read
  // of "I cannot date this".
  if (ageMs < 0) return false;
  return ageMs < SKILL_MD_MIGRATION_RESCAN_INTERVAL_MS;
}

function writeMarker(
  skillsRoot: string,
  logger: Logger,
  marker: SkillMdMigrationMarkerStore | null | undefined,
): void {
  if (!marker) return;
  try {
    marker.write(skillsRoot, {
      migrationVersion: SKILL_MD_MIGRATION_VERSION,
      lastScanAt: Date.now(),
    });
  } catch (err: unknown) {
    // Non-fatal by construction: the walk already ran and already did the work.
    // Losing the marker costs one more walk next launch, nothing else.
    logger.warn(
      '[skill-synthesis] failed to persist SKILL.md migration marker (non-fatal)',
      {
        skillsRoot,
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }
}

/**
 * Recursively collect all SKILL.md files under `dir`.
 */
function findSkillMdFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findSkillMdFiles(fullPath));
    } else if (entry.isFile() && entry.name === 'SKILL.md') {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Parse existing frontmatter and inject `when_to_use:` after `description:`.
 * Returns the rewritten content, or null if frontmatter cannot be parsed.
 *
 * The value is always emitted as a YAML double-quoted scalar to prevent
 * colons, quotes, or newlines in bullet text from breaking YAML parsing.
 * If the extracted value is empty, the field is omitted entirely.
 */
function addWhenToUseFrontmatter(content: string): string | null {
  const fmMatch = /^---\n([\s\S]*?)\n---\s*\n([\s\S]*)$/.exec(content);
  if (!fmMatch) return null;

  const frontmatter = fmMatch[1];
  const body = fmMatch[2];

  const whenToUse = extractWhenToUse(body);
  if (!whenToUse) {
    return null; // caller will count as skipped
  }
  const escaped = whenToUse.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const newFrontmatter = `${frontmatter}\nwhen_to_use: "${escaped}"`;

  return `---\n${newFrontmatter}\n---\n${body}`;
}

/**
 * Extract a single-line summary from a `## When to use` section.
 * Returns empty string if the section is not present.
 */
function extractWhenToUse(body: string): string {
  const match = /##\s+When to use\s*\n([\s\S]*?)(?=\n##|\s*$)/i.exec(body);
  if (!match) return '';
  const section = match[1];
  const bullets: string[] = [];
  for (const line of section.split('\n')) {
    const trimmed = line.replace(/^[-*]\s+/, '').trim();
    if (trimmed) bullets.push(trimmed);
  }
  return bullets.join('; ');
}
