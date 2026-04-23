/**
 * Sanitize persisted Claude session transcripts.
 *
 * Background
 * ----------
 * The Anthropic API now rejects any base64 image block whose `media_type`
 * is not one of `image/jpeg`, `image/png`, `image/gif`, `image/webp`. Older
 * versions of Ptah (and its frontend pickers) let through `image/svg+xml`,
 * `image/bmp`, `image/x-icon`, empty strings and clipboard-mislabeled types.
 * Those values landed in `~/.claude/projects/<workspace>/*.jsonl`, so every
 * session resume now fails with:
 *
 *   messages.N.content.M.image.source.base64.media_type:
 *     Input should be 'image/jpeg', 'image/png', 'image/gif' or 'image/webp'
 *
 * Behavior
 * --------
 * Walk `~/.claude/projects/<anything>/*.jsonl`. For every JSONL line, parse
 * JSON, recursively find any `{ type: 'image', source: { type: 'base64',
 * media_type, data } }` block, run it through `resolveImageMediaType`, and:
 *
 *   - if the resolver yields an allowed media type → patch it in place
 *     (this fixes `image/jpg`-style aliases and reclaims mislabeled files)
 *   - if the resolver yields `null` → replace the whole block with
 *     `{ type: 'text', text: '[image removed — invalid media_type]' }`.
 *     Replacement is preferred over deletion because consumers may rely on
 *     positional content (tool_use_id pairing, etc.).
 *
 * If a file changes at all, write `<file>.bak` with the original content
 * first, then overwrite the original with the sanitized version. Honor a
 * `--dry-run` flag that prints what would change but touches nothing.
 *
 * Usage
 * -----
 *   npx ts-node scripts/sanitize-claude-sessions.ts [--dry-run]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resolveImageMediaType } from '../libs/shared/src/lib/utils/image-media-type';

interface PerFileStats {
  file: string;
  linesScanned: number;
  linesModified: number;
  imagesPatched: number;
  imagesReplaced: number;
}

interface RunOptions {
  dryRun: boolean;
  projectsDir: string;
}

const REPLACEMENT_TEXT = '[image removed — invalid media_type]';

function parseArgs(argv: readonly string[]): RunOptions {
  const dryRun = argv.includes('--dry-run');
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  return { dryRun, projectsDir };
}

/** Recursively walk a directory, returning every file path under it. */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Test whether a value looks like a base64 image content block. Written as a
 * plain predicate (not a type guard) to avoid coupling to SDK types — this
 * script is deliberately standalone.
 */
function isBase64ImageBlock(value: unknown): value is {
  type: 'image';
  source: { type: 'base64'; media_type?: unknown; data?: unknown };
} {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  if (obj['type'] !== 'image') return false;
  const src = obj['source'];
  if (src === null || typeof src !== 'object') return false;
  const srcObj = src as Record<string, unknown>;
  return srcObj['type'] === 'base64';
}

interface SanitizeCounts {
  patched: number;
  replaced: number;
  changed: boolean;
}

/**
 * Walk any JSON value and rewrite image blocks in place. Returns counts plus
 * a `changed` flag indicating whether the caller should re-serialize.
 */
function sanitizeValue(root: unknown): SanitizeCounts {
  const counts: SanitizeCounts = {
    patched: 0,
    replaced: 0,
    changed: false,
  };

  const visit = (parent: unknown, key: string | number): void => {
    let child: unknown;
    if (Array.isArray(parent)) {
      child = parent[key as number];
    } else if (parent !== null && typeof parent === 'object') {
      child = (parent as Record<string, unknown>)[key as string];
    } else {
      return;
    }

    if (isBase64ImageBlock(child)) {
      const source = child.source;
      const claimed =
        typeof source.media_type === 'string' ? source.media_type : '';
      const data = typeof source.data === 'string' ? source.data : '';
      const resolved = resolveImageMediaType(claimed, data);

      if (resolved === null) {
        const replacement = { type: 'text' as const, text: REPLACEMENT_TEXT };
        if (Array.isArray(parent)) {
          parent[key as number] = replacement;
        } else {
          (parent as Record<string, unknown>)[key as string] = replacement;
        }
        counts.replaced += 1;
        counts.changed = true;
        return;
      }

      if (resolved !== claimed) {
        source.media_type = resolved;
        counts.patched += 1;
        counts.changed = true;
      }
      // Allowed value is unchanged — do nothing.
      return;
    }

    // Recurse into containers.
    if (Array.isArray(child)) {
      for (let i = 0; i < child.length; i += 1) {
        visit(child, i);
      }
    } else if (child !== null && typeof child === 'object') {
      for (const k of Object.keys(child as Record<string, unknown>)) {
        visit(child, k);
      }
    }
  };

  // Kick off from a synthetic parent so `visit` can mutate the root if need be.
  const wrapper: { root: unknown } = { root };
  visit(wrapper, 'root');
  return { ...counts, changed: counts.changed };
}

function processFile(file: string, options: RunOptions): PerFileStats {
  const stats: PerFileStats = {
    file,
    linesScanned: 0,
    linesModified: 0,
    imagesPatched: 0,
    imagesReplaced: 0,
  };

  let original: string;
  try {
    original = fs.readFileSync(file, 'utf8');
  } catch (err) {
    console.warn(
      `[sanitize-claude-sessions] Failed to read ${file}: ${(err as Error).message}`,
    );
    return stats;
  }

  // Preserve original EOLs — splitting on \n keeps trailing \r if any.
  const lines = original.split('\n');
  const outLines: string[] = new Array(lines.length);
  let fileChanged = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (line.length === 0) {
      outLines[i] = line;
      continue;
    }

    stats.linesScanned += 1;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Not JSON — leave untouched.
      outLines[i] = line;
      continue;
    }

    const counts = sanitizeValue(parsed);
    if (counts.changed) {
      stats.linesModified += 1;
      stats.imagesPatched += counts.patched;
      stats.imagesReplaced += counts.replaced;
      fileChanged = true;
      outLines[i] = JSON.stringify(parsed);
    } else {
      outLines[i] = line;
    }
  }

  if (fileChanged && !options.dryRun) {
    const backup = `${file}.bak`;
    try {
      fs.writeFileSync(backup, original, 'utf8');
      fs.writeFileSync(file, outLines.join('\n'), 'utf8');
    } catch (err) {
      console.error(
        `[sanitize-claude-sessions] Failed to write ${file}: ${(err as Error).message}`,
      );
    }
  }

  return stats;
}

function main(argv: readonly string[]): void {
  const options = parseArgs(argv);
  const { projectsDir, dryRun } = options;

  if (!fs.existsSync(projectsDir)) {
    console.log(
      `[sanitize-claude-sessions] No sessions directory at ${projectsDir} — nothing to do.`,
    );
    return;
  }

  console.log(
    `[sanitize-claude-sessions] Scanning ${projectsDir}${dryRun ? ' (dry run — no files will be written)' : ''}`,
  );

  const all = walkFiles(projectsDir).filter((f) => f.endsWith('.jsonl'));
  if (all.length === 0) {
    console.log('[sanitize-claude-sessions] No .jsonl files found.');
    return;
  }

  let filesScanned = 0;
  let filesModified = 0;
  let totalPatched = 0;
  let totalReplaced = 0;
  const perFile: PerFileStats[] = [];

  for (const file of all) {
    filesScanned += 1;
    const stats = processFile(file, options);
    if (stats.imagesPatched > 0 || stats.imagesReplaced > 0) {
      filesModified += 1;
      totalPatched += stats.imagesPatched;
      totalReplaced += stats.imagesReplaced;
      perFile.push(stats);
    }
  }

  console.log('');
  console.log('========== Summary ==========');
  console.log(`Files scanned:   ${filesScanned}`);
  console.log(`Files modified:  ${filesModified}`);
  console.log(
    `Images patched:  ${totalPatched} (media_type corrected in place)`,
  );
  console.log(
    `Images replaced: ${totalReplaced} (unrecoverable — replaced with text block)`,
  );
  if (dryRun) {
    console.log('Mode:            dry-run (no files written)');
  }

  if (perFile.length > 0) {
    console.log('');
    console.log('Per-file breakdown:');
    for (const f of perFile) {
      console.log(
        `  ${f.file}: ${f.linesModified}/${f.linesScanned} lines, ` +
          `patched=${f.imagesPatched}, replaced=${f.imagesReplaced}`,
      );
    }
  }
}

main(process.argv.slice(2));
