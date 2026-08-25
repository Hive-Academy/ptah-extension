/**
 * What the skill-selection surface can offer, read straight off disk
 * (TASK_2026_316 Batch 3).
 *
 * ## Why this walks the OVERLAY as well as the user layer
 *
 * The obvious reading of "list the skills" is `~/.ptah/user/skills`, and it is
 * one slug short of correct. `HarnessManifestBuilder.buildSkills` applies the
 * selection to BOTH loops — the user-layer base and the enabled-plugin overlay —
 * and says why at the second one: an opt-out harness plugin reaches a workspace
 * only through the overlay, and it is exactly the kind of skill a per-project
 * selection exists to exclude. `ptah-skillssh-*` roots are overlay-ONLY too, by
 * deliberate design (see `rpc-handlers/CLAUDE.md`, "skills.sh source roots"):
 * they are never mirrored into the user layer, because that is what makes
 * `skillsSh:uninstall` actually reap.
 *
 * So a catalog that stopped at the user layer would hand the UI a list that the
 * selection is strictly wider than. Skills are manifest-owned, so a slug the
 * user cannot see and therefore cannot tick is a slug the first `'selected'`
 * save DELETES, with no control anywhere that puts it back. Over-listing costs
 * a checkbox; under-listing costs the user's files.
 *
 * ## Why nothing here is FILTERED
 *
 * `disabledSkillIds`, `disabledPluginIds` and the plugin-origin gate all still
 * apply — the selection is the OUTERMOST gate (`buildSkills` tests it first),
 * and the inner ones compose underneath it exactly as they did before. This
 * catalog deliberately re-implements none of them. `plugin-origin-gate.ts` says
 * to read it before changing anything, because every one of its four rules
 * exists to stop a plausible-looking filter from deleting user data; a second,
 * simplified copy of those rules living here is precisely how the two would
 * come to disagree.
 *
 * What the catalog does instead is REPORT each candidate's origin plugin, so
 * the surface can show it. That is a read, it deletes nothing, and it is the
 * one fact the user needs to understand why a skill is on the list.
 */

import {
  accessSync,
  constants,
  lstatSync,
  readdirSync,
  readFileSync,
} from 'fs';
import { basename, join } from 'path';
import {
  canonicalSlug,
  isIgnoredEntry,
  readUserLayerOrigin,
  type HarnessSourceState,
} from '@ptah-extension/harness-sync';
import type { HarnessSkillCandidate } from '@ptah-extension/shared';

/**
 * Longest description carried over the wire, in characters.
 *
 * A real `SKILL.md` description is a paragraph — several of the shipped ones
 * run past 2 KB — and this payload is one entry per skill on the machine. The
 * surface renders a card, not the file, so the whole description was never
 * going to be shown; bounding it here keeps a list of fifty skills a few tens
 * of kilobytes rather than a few hundred.
 */
const MAX_DESCRIPTION_CHARS = 500;

/** Everything this workspace could propagate, sorted by slug. */
export function readSkillCandidates(
  sources: HarnessSourceState,
): HarnessSkillCandidate[] {
  const claimed = new Map<string, HarnessSkillCandidate>();

  // The user layer is the base and wins every collision, which is the same
  // precedence `buildSkills` applies. Claiming in the same order means the
  // surface names the same source the reconciler would copy from.
  for (const slug of listSkillSlugs(sources.layout.skillsRoot)) {
    const cloneDir = join(sources.layout.skillsRoot, slug);
    const origin = readUserLayerOrigin(cloneDir);
    claim(claimed, {
      slug,
      ...readSkillMetadata(cloneDir, slug),
      pluginId: origin.kind === 'plugin' ? origin.pluginId : null,
    });
  }

  for (const pluginPath of sources.overlayPluginPaths) {
    const pluginId = basename(pluginPath);
    const pluginSkillsDir = join(pluginPath, 'skills');
    for (const slug of listSkillSlugs(pluginSkillsDir)) {
      claim(claimed, {
        slug,
        ...readSkillMetadata(join(pluginSkillsDir, slug), slug),
        pluginId,
      });
    }
  }

  return [...claimed.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

/** First claim of a canonical slug wins, exactly as in the manifest builder. */
function claim(
  claimed: Map<string, HarnessSkillCandidate>,
  candidate: HarnessSkillCandidate,
): void {
  const key = canonicalSlug(candidate.slug);
  if (claimed.has(key)) return;
  claimed.set(key, candidate);
}

/**
 * Directory entries under `root` that are real directories holding a readable
 * `SKILL.md`.
 *
 * A symlink is skipped rather than followed, which is `buildSkills`'s rule and
 * is kept identical here so the catalog cannot offer a slug the reconciler
 * would refuse to copy.
 */
function listSkillSlugs(root: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    // An absent user layer is the ordinary cold-start state, not an error.
    return [];
  }

  const slugs: string[] = [];
  for (const entry of entries) {
    if (isIgnoredEntry(entry)) continue;
    const dir = join(root, entry);
    try {
      const stat = lstatSync(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      accessSync(join(dir, 'SKILL.md'), constants.R_OK);
    } catch {
      continue;
    }
    slugs.push(entry);
  }
  return slugs;
}

/**
 * `name` and `description` from the `SKILL.md` frontmatter.
 *
 * `name` falls back to the slug rather than to an empty string: the two are
 * allowed to differ, an authoring mistake should not render as a blank row, and
 * the slug is the identity the checkbox actually records either way.
 */
function readSkillMetadata(
  skillDir: string,
  slug: string,
): { name: string; description: string } {
  let content: string;
  try {
    content = readFileSync(join(skillDir, 'SKILL.md'), 'utf-8');
  } catch {
    return { name: slug, description: '' };
  }

  const frontmatter = extractFrontmatter(content);
  if (frontmatter === null) return { name: slug, description: '' };

  const name = readScalar(frontmatter, 'name');
  return {
    name: name === '' ? slug : name,
    description: truncate(readScalar(frontmatter, 'description')),
  };
}

/** The `---` fenced block at the top of the file, or `null` when there is none. */
function extractFrontmatter(content: string): string | null {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  return match === null ? null : match[1];
}

/**
 * One frontmatter key, as a plain string.
 *
 * Handles the folded and literal BLOCK scalars (`description: >-`, `: |`) as
 * well as the inline form, because a description quoting a colon has to be a
 * block scalar to parse at all — that rule is written down in the repo's own
 * task-spec contract, and it is the shape several shipped `SKILL.md` files use.
 * An inline-only reader returns an empty description for exactly the skills
 * whose description is longest and most needed.
 *
 * This is not a YAML parser and does not need to be. It reads two keys off a
 * file the reconciler has already accepted, and every failure path returns the
 * empty string, which the caller renders as "no description".
 */
function readScalar(frontmatter: string, key: string): string {
  const lines = frontmatter.split(/\r?\n/);
  const header = new RegExp(`^${key}:[ \\t]*(.*)$`);

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(header);
    if (match === null) continue;

    const inline = match[1].trim();
    if (inline !== '' && !inline.startsWith('>') && !inline.startsWith('|')) {
      return unquote(inline);
    }
    return readBlockScalar(lines, index + 1);
  }
  return '';
}

/**
 * The indented continuation lines of a block scalar, joined with spaces.
 *
 * Folded and literal blocks are joined identically. The distinction controls
 * where newlines survive, and this value goes into a UI card that reflows
 * anyway — honouring it would be a difference nobody could see.
 */
function readBlockScalar(lines: string[], start: number): string {
  const parts: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '') {
      // A blank line inside a block is a paragraph break, not the end of it.
      if (parts.length > 0) parts.push('');
      continue;
    }
    if (!/^[ \t]/.test(line)) break;
    parts.push(line.trim());
  }
  return parts.join(' ').trim();
}

/** Strip one matching pair of surrounding quotes, if present. */
function unquote(value: string): string {
  const quoted = value.match(/^(['"])([\s\S]*)\1$/);
  return quoted === null ? value : quoted[2];
}

function truncate(value: string): string {
  if (value.length <= MAX_DESCRIPTION_CHARS) return value;
  return `${value.slice(0, MAX_DESCRIPTION_CHARS).trimEnd()}…`;
}
