/**
 * Where a skills.sh skill LIVES once Ptah owns it.
 *
 * Before TASK_2026_288 a skills.sh install shelled `npx skills add --agent
 * claude-code`, which writes straight into `{ws}/.claude/skills` (or
 * `~/.claude/skills` with `-g`). That had three consequences and all of them
 * were defects:
 *
 *   1. `.claude/skills` is the ONLY place the bytes landed, so the skill
 *      reached Claude and nothing else — not `.agents/skills` (codex,
 *      antigravity), not `.github/skills` (copilot), not `.cursor/skills`.
 *   2. `.claude/skills` is a MANAGED directory. A path there that no manifest
 *      owns and no desired state names is `foreign` by rule
 *      (`claude-target.ts`), so every skills.sh skill was a permanent,
 *      unclearable finding in `ptah harness doctor`.
 *   3. `-g` wrote outside the workspace entirely, where the workspace-scoped
 *      reconciler cannot see it at all.
 *
 * The fix is not a fourth writer. It is to land the content in a Ptah-owned
 * SOURCE ROOT and let the existing pipeline do the rest:
 *
 *     ~/.ptah/plugins/ptah-skillssh-<owner>-<repo>/
 *       .ptah-skillssh.json      <- this module's metadata record
 *       skills/<slug>/SKILL.md
 *
 * That shape is deliberately the `ptah-harness-*` shape. A directory under
 * `~/.ptah/plugins` holding a `skills/` tree is already a first-class overlay
 * source: `PluginLoaderService.resolveCurrentPluginPaths()` yields it,
 * `PluginConfigSourceResolver` hands it to the manifest builder as
 * `overlayPluginPaths`, and `HarnessManifestBuilder.buildSkills` claims every
 * slug under it. From there the skill is ordinary desired state — copied into
 * all six targets, hash-gated, manifest-owned, reaped when the root goes away,
 * and never `foreign` again. No new concept, no new writer, no new manifest.
 *
 * It does not write into `~/.ptah/user/skills` itself. The hosts list every
 * USER-GLOBAL source root in the user-layer mirror's plugin roots
 * (TASK_2026_701), so each global skill also gets a Library clone with a
 * sidecar naming `ptah-skillssh-<owner>-<repo>` and `sourceRef`
 * `skills-sh:<dir>`. Uninstall still reaps: once the root is deleted, the
 * mirror's deleted-upstream sweep removes every unedited clone.
 *
 * Scope (TASK_2026_853 D-3). A root lives in one of two places:
 *
 *   - `global`    — `~/.ptah/plugins/ptah-skillssh-<id>`: mirrored into the
 *                   user layer and therefore reaches every workspace;
 *   - `workspace` — `workspacePluginsDir(ws)/ptah-skillssh-<id>`
 *                   (`{ws}/.ptah/plugins`): an overlay root of that workspace
 *                   only, never a mirror source.
 *
 * Ownership (D-D8). A root Ptah writes carries v2 metadata: an owner marker
 * and a sha256 for every file under the root, computed from the bytes Ptah
 * wrote. That record — and nothing else, not the directory name and not a
 * user-layer clone sidecar — is what proves Ptah may delete the root
 * ({@link verifyOwnedRoot}).
 */

import { createHash } from 'crypto';
import { constants as fsConstants } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import {
  SKILLS_SH_OWNER_MARKER,
  parseSourceSlug,
} from '@ptah-extension/shared';

/**
 * Directory-name prefix for a skills.sh source root.
 *
 * Sibling of `ptah-harness-` (`plugin-loader.service.ts`), and distinct from it
 * on purpose: the two have different provenance (a third-party repo vs. the
 * user's own wizard run) and the marketplace shows them differently.
 */
export const SKILLS_SH_PLUGIN_PREFIX = 'ptah-skillssh-';

/** Metadata filename at the root of a skills.sh source root. */
export const SKILLS_SH_METADATA_FILE = '.ptah-skillssh.json';

/**
 * Directory-name prefix of a Make-global staging directory, created directly
 * under `~/.ptah/plugins` so the final rename stays on one volume.
 *
 * It must never start with {@link SKILLS_SH_PLUGIN_PREFIX}: the plugin loader
 * and the manifest builder treat every `ptah-skillssh-*` directory as an
 * active root (Batch 24 follow-up). The leading dot also keeps it out of every
 * plugin scan. Nothing is ever staged under `workspacePluginsDir(ws)`.
 */
export const SKILLS_SH_STAGING_PREFIX = '.staging-ptah-skillssh-';

/**
 * User-visible refusal for a workspace-scoped install with no folder open
 * (D-3, AC4). Exact copy; the RPC layer passes it through unchanged.
 */
export const SKILLS_SH_NO_WORKSPACE_ERROR =
  'No workspace is open. Nothing was installed. Choose All workspaces to install for every workspace.';

/** v1: provenance only. Never proves ownership (D-D8). */
export const SkillsShRootMetadataV1Schema = z.object({
  version: z.literal(1),
  /** `owner/repo`, exactly as the user requested it. */
  source: z.string(),
  /** Slugs written under `skills/`. */
  skillIds: z.array(z.string()),
  /** ISO-8601. Reporting only. */
  installedAt: z.string(),
});

/** Lowercase hex sha256. */
const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * v2 (D-D8). `owner` and `ownerMarker` are parsed as plain strings so a root
 * with the wrong marker still READS (for listing) and `verifyOwnedRoot` can say
 * exactly why it is not proven, instead of the record vanishing as corrupt.
 *
 * `files` maps every regular file under the root, except this metadata file,
 * to the sha256 of the bytes Ptah wrote. Keys are POSIX-relative paths; their
 * containment is checked where they are used ({@link isContainedRelPath}).
 */
export const SkillsShRootMetadataV2Schema = z.object({
  version: z.literal(2),
  owner: z.string(),
  ownerMarker: z.string(),
  source: z.string(),
  skillIds: z.array(z.string()),
  installedAt: z.string(),
  scope: z.enum(['global', 'workspace']),
  files: z.record(z.string(), Sha256HexSchema),
});

/**
 * On-disk record of what a source root holds, either version.
 *
 * It exists because the directory NAME is lossy: `ptah-skillssh-a-b-c` could
 * have come from `a/b-c` or from `a-b/c`, and `listInstalled` has to report the
 * exact `owner/repo` back to the marketplace so its install badges match. The
 * slug list is here for the same reason — a whole-repo install writes N skills,
 * and uninstall has to know which slugs it is removing without inferring them
 * from a directory that may have been edited.
 */
export const SkillsShRootMetadataSchema = z.discriminatedUnion('version', [
  SkillsShRootMetadataV1Schema,
  SkillsShRootMetadataV2Schema,
]);

export type SkillsShRootMetadataV1 = z.infer<
  typeof SkillsShRootMetadataV1Schema
>;
export type SkillsShRootMetadataV2 = z.infer<
  typeof SkillsShRootMetadataV2Schema
>;
export type SkillsShRootMetadata = z.infer<typeof SkillsShRootMetadataSchema>;

/** Where a root lives. A workspace location carries the workspace it is in. */
export type SkillsShLocation =
  | { scope: 'global' }
  | { scope: 'workspace'; workspaceRoot: string | null | undefined };

/**
 * True for a POSIX-relative path that stays inside its root: non-empty, no
 * leading `/`, no backslash, no drive letter, no NUL, and no empty, `.` or
 * `..` segment. Metadata keys are untrusted file content, so every consumer
 * checks them before joining them onto a root.
 */
export function isContainedRelPath(relPath: string): boolean {
  if (relPath.length === 0) return false;
  if (relPath.includes('\\') || relPath.includes('\0')) return false;
  if (relPath.startsWith('/') || /^[A-Za-z]:/.test(relPath)) return false;
  return relPath
    .split('/')
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/**
 * Directory name for a source root, or `null` when `source` is not a safe
 * `owner/repo`.
 *
 * `parseSourceSlug` (shared) is the guard, not a fresh regex: it applies
 * `SAFE_SOURCE_PATTERN` **and** `isSafePathToken` to each half, and the second
 * half is the load-bearing one here. `SAFE_SOURCE_PATTERN` alone accepts `../..`
 * — `..` matches `[a-zA-Z0-9_.-]+` — and this value becomes a filesystem path.
 * Prefixing would defuse that particular string, but a guard that is only safe
 * because of what is concatenated in front of it is not a guard.
 *
 * The `/` becomes `-`, which is why the mapping is not reversible and why
 * {@link SkillsShRootMetadataSchema} records the original.
 */
export function skillsShRootId(source: string): string | null {
  const slug = parseSourceSlug(source);
  if (slug === null) return null;
  return `${SKILLS_SH_PLUGIN_PREFIX}${slug.owner}-${slug.repo}`;
}

/** True when `id` names a skills.sh source root. */
export function isSkillsShRootId(id: string): boolean {
  return id.startsWith(SKILLS_SH_PLUGIN_PREFIX);
}

// ---------------------------------------------------------------------------
// Ownership proof (D-D8)
// ---------------------------------------------------------------------------

/** `owner` value of a root Ptah wrote. */
export const SKILLS_SH_OWNER = 'ptah';

/** Why a root is not proven Ptah-owned. */
export type SkillsShUnprovenReason =
  /** The root directory does not exist. */
  | 'root-missing'
  /** The root path is a link or not a directory. */
  | 'root-not-directory'
  /** No `.ptah-skillssh.json`. */
  | 'metadata-missing'
  /** The metadata is not JSON or matches neither schema. */
  | 'metadata-invalid'
  /** v1 metadata: provenance only, no writer identity. */
  | 'legacy-v1'
  | 'wrong-owner'
  | 'wrong-marker'
  /** A `files` key is absolute, escaping or not POSIX-relative. */
  | 'unsafe-path'
  /** A listed file is absent. */
  | 'missing-file'
  /** A link, device or other non-regular entry under the root. */
  | 'not-regular-file'
  | 'hash-mismatch'
  /** A file on disk the metadata does not list. */
  | 'unlisted-file'
  /** The root could not be read. */
  | 'read-failed';

/**
 * Result of {@link verifyOwnedRoot}. `owned` carries the parsed v2 record so a
 * caller (Make global, the D-6 migration) acts on exactly what was proven.
 * `path` names the offending root-relative entry when there is one.
 */
export type SkillsShOwnershipProof =
  | { status: 'owned'; metadata: SkillsShRootMetadataV2 }
  | { status: 'unproven'; reason: SkillsShUnprovenReason; path?: string };

/** True when two `files` maps list the same paths with the same hashes. */
export function sameFileHashes(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(b, key) && a[key] === b[key],
  );
}

/** Absolute path of a contained POSIX-relative path under `rootDir`. */
export function resolveRelPath(rootDir: string, relPath: string): string {
  return path.join(rootDir, ...relPath.split('/'));
}

/**
 * sha256 (lowercase hex) of a regular file, opened without following a final
 * link. A link or non-regular file throws, so a hash is only ever of bytes
 * that sit at that path.
 */
export async function hashRegularFile(absPath: string): Promise<string> {
  // O_NOFOLLOW is POSIX-only; Windows has no such flag and the preceding
  // lstat walk is what rejects links there.
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const handle = await fs.open(absPath, fsConstants.O_RDONLY | noFollow);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new Error(`Not a regular file: ${absPath}`);
    }
    return createHash('sha256')
      .update(await handle.readFile())
      .digest('hex');
  } finally {
    await handle.close();
  }
}

/** Every entry under a directory tree, split by kind. Never follows links. */
export interface SkillsShTreeListing {
  /** POSIX-relative paths of regular files. */
  files: string[];
  /** POSIX-relative paths of links and other non-regular entries. */
  nonRegular: string[];
}

/**
 * List a tree without following links. `skipTopLevel` names a file at the
 * top of the tree to leave out (the metadata file). Throws on a read error.
 */
export async function listTree(
  rootDir: string,
  skipTopLevel?: string,
): Promise<SkillsShTreeListing> {
  const listing: SkillsShTreeListing = { files: [], nonRegular: [] };
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (prefix === '' && entry.name === skipTopLevel) continue;
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        listing.files.push(rel);
      } else {
        listing.nonRegular.push(rel);
      }
    }
  };
  await walk(rootDir, '');
  listing.files.sort();
  listing.nonRegular.sort();
  return listing;
}

/**
 * Hash every regular file under `dir`, keyed by `prefix` + its POSIX-relative
 * path. Non-regular entries are returned separately and never hashed, so a
 * caller cannot accidentally list a link as owned.
 */
export async function hashTree(
  dir: string,
  prefix: string,
): Promise<{ files: Record<string, string>; nonRegular: string[] }> {
  const listing = await listTree(dir);
  const files: Record<string, string> = {};
  for (const rel of listing.files) {
    files[`${prefix}${rel}`] = await hashRegularFile(resolveRelPath(dir, rel));
  }
  return {
    files,
    nonRegular: listing.nonRegular.map((rel) => `${prefix}${rel}`),
  };
}

/** Read and parse a root's metadata, either version. */
export async function readRootMetadata(
  rootDir: string,
): Promise<
  | { status: 'ok'; metadata: SkillsShRootMetadata }
  | { status: 'missing' | 'invalid' | 'not-regular' }
> {
  const metadataPath = path.join(rootDir, SKILLS_SH_METADATA_FILE);
  try {
    const stat = await fs.lstat(metadataPath);
    if (!stat.isFile()) return { status: 'not-regular' };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'missing' };
    }
    throw error;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return { status: 'invalid' };
    throw error;
  }
  const parsed = SkillsShRootMetadataSchema.safeParse(raw);
  return parsed.success
    ? { status: 'ok', metadata: parsed.data }
    : { status: 'invalid' };
}

/**
 * Prove that Ptah wrote the skills.sh root at `rootDir` and that nobody has
 * changed it since (D-D8). The one ownership gate for every deletion of a
 * skills.sh root: Make global (D-3) and the install-scope migration (D-6).
 *
 * `owned` only when ALL of these hold:
 *   - the root is a real directory (not a link);
 *   - the metadata file is a regular file holding v2 metadata with
 *     `owner === 'ptah'` and `ownerMarker === SKILLS_SH_OWNER_MARKER`;
 *   - every `files` key is a contained POSIX-relative path;
 *   - nothing under the root is a link or other non-regular entry;
 *   - every listed file exists with a matching sha256;
 *   - no file exists that is not listed.
 *
 * Anything else is `unproven` with the first reason found. Ownership is
 * never inferred from the directory name, from a user-layer clone sidecar, or
 * from v1 metadata. Never throws: an unreadable root is `read-failed`.
 */
export async function verifyOwnedRoot(
  rootDir: string,
): Promise<SkillsShOwnershipProof> {
  try {
    return await proveOwnedRoot(rootDir);
  } catch {
    // An unreadable root is reported as such, never as owned: every caller
    // treats 'read-failed' as "not provably Ptah's" and refuses to delete.
    return { status: 'unproven', reason: 'read-failed' };
  }
}

async function proveOwnedRoot(
  rootDir: string,
): Promise<SkillsShOwnershipProof> {
  try {
    const stat = await fs.lstat(rootDir);
    if (!stat.isDirectory()) {
      return { status: 'unproven', reason: 'root-not-directory' };
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'unproven', reason: 'root-missing' };
    }
    throw error;
  }

  const read = await readRootMetadata(rootDir);
  switch (read.status) {
    case 'missing':
      return { status: 'unproven', reason: 'metadata-missing' };
    case 'invalid':
      return { status: 'unproven', reason: 'metadata-invalid' };
    case 'not-regular':
      return {
        status: 'unproven',
        reason: 'not-regular-file',
        path: SKILLS_SH_METADATA_FILE,
      };
  }
  const metadata = read.metadata;
  if (metadata.version !== 2) {
    return { status: 'unproven', reason: 'legacy-v1' };
  }
  if (metadata.owner !== SKILLS_SH_OWNER) {
    return { status: 'unproven', reason: 'wrong-owner' };
  }
  if (metadata.ownerMarker !== SKILLS_SH_OWNER_MARKER) {
    return { status: 'unproven', reason: 'wrong-marker' };
  }

  const listed = Object.keys(metadata.files).sort();
  const unsafe = listed.find(
    (rel) => !isContainedRelPath(rel) || rel === SKILLS_SH_METADATA_FILE,
  );
  if (unsafe !== undefined) {
    return { status: 'unproven', reason: 'unsafe-path', path: unsafe };
  }

  const onDisk = await listTree(rootDir, SKILLS_SH_METADATA_FILE);
  if (onDisk.nonRegular.length > 0) {
    return {
      status: 'unproven',
      reason: 'not-regular-file',
      path: onDisk.nonRegular[0],
    };
  }
  const present = new Set(onDisk.files);
  const missing = listed.find((rel) => !present.has(rel));
  if (missing !== undefined) {
    return { status: 'unproven', reason: 'missing-file', path: missing };
  }
  const listedSet = new Set(listed);
  const unlisted = onDisk.files.find((rel) => !listedSet.has(rel));
  if (unlisted !== undefined) {
    return { status: 'unproven', reason: 'unlisted-file', path: unlisted };
  }
  for (const rel of listed) {
    const actual = await hashRegularFile(resolveRelPath(rootDir, rel));
    if (actual !== metadata.files[rel]) {
      return { status: 'unproven', reason: 'hash-mismatch', path: rel };
    }
  }
  return { status: 'owned', metadata };
}
