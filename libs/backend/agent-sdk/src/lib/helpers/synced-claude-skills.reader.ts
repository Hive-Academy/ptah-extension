/**
 * claude.ai account-synced skills on this machine (TASK_2026_853, Phase B).
 *
 * Claude Code copies the skills of each signed-in claude.ai account into
 * `<claudeConfigDir>/skills/synced/<accountUuid>_<orgUuid>/`, one directory per
 * skill plus a `manifest.json`
 * (`{ skills: [{ skillId, name, description, ... }] }`). A session lists them
 * as `anthropic-skills:<name>`, and only that qualified key hides one: a bare
 * `skillOverrides` key would also hide a same-name workspace skill (A0 spike,
 * reports/a0-account-spike.md, cases b and c). This reader therefore returns
 * qualified ids only.
 *
 * Read-only. It never moves, deletes or rewrites a synced directory and never
 * touches the sync settings: Ptah hides these skills per session through
 * `skillOverrides`, nothing else.
 *
 * Failure behaviour: a missing synced directory, an unreadable or malformed
 * manifest or `SKILL.md`, or any other read error returns `[]` with a debug
 * log (an error code, never a path) and never throws. The cost is that the
 * synced skills stay visible for that session, which is not a security
 * boundary (implementation-plan.md A-1).
 *
 * Each config dir keeps its last result, reused while every manifest's (or,
 * without a manifest, every `SKILL.md`'s) `mtimeMs` and size are unchanged.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import matter from 'gray-matter';
import { z } from 'zod';
import type { Logger } from '@ptah-extension/vscode-core';
import { yamlLineScalar } from './claude-skill-name-discovery';
import { syncedClaudeSkillId } from './claude-builtin-catalog';

/** One account-synced skill, as the settings catalog and the policy see it. */
export interface SyncedClaudeSkill {
  /** The qualified listing key, `anthropic-skills:<name>`. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** `ceil(chars / 2.64)` of its listing line `- <id>: <description>`. */
  readonly approxTokens: number;
}

/** Characters per token measured on first-turn skill listings (A-1). */
const CHARS_PER_TOKEN = 2.64;
const MANIFEST_FILE = 'manifest.json';
const SKILL_FILE = 'SKILL.md';
/**
 * A skill name Claude Code can list. Anything else is skipped: an id Ptah
 * cannot name exactly is better left visible than guessed.
 */
const SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ABSENT_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR']);

/**
 * Any options object opts out of gray-matter's module-global cache, which
 * keeps a half-parsed entry after a YAML error (same note as
 * `claude-skill-name-discovery.ts`).
 */
const MATTER_OPTIONS = { language: 'yaml' } as const;

/** A read or parse failure that turns the whole result into `[]`. */
class SyncedSkillsReadError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'SyncedSkillsReadError';
  }
}

function errorCode(error: unknown): string {
  if (error instanceof SyncedSkillsReadError) return error.code;
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return 'EUNKNOWN';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The listing cost of one synced skill. Pure. */
export function syncedSkillApproxTokens(
  id: string,
  description: string,
): number {
  return Math.ceil(`- ${id}: ${description}`.length / CHARS_PER_TOKEN);
}

function syncedSkill(
  name: string,
  description: string,
): SyncedClaudeSkill | undefined {
  if (!SKILL_NAME_PATTERN.test(name)) return undefined;
  const id = syncedClaudeSkillId(name);
  return {
    id,
    name,
    description,
    approxTokens: syncedSkillApproxTokens(id, description),
  };
}

/**
 * The fields of `manifest.json` this reader relies on. Other fields
 * (`skillId`, `source`, `updatedAt`, `lastUpdated`) are allowed and ignored.
 */
const SyncedManifestSchema = z.object({
  skills: z.array(
    z.object({
      name: z.string(),
      description: z.string().optional(),
    }),
  ),
});

/**
 * The skills of one parsed `manifest.json`. Throws `EMANIFEST` when it does
 * not match {@link SyncedManifestSchema}. Pure.
 */
export function syncedSkillsFromManifest(value: unknown): SyncedClaudeSkill[] {
  const parsed = SyncedManifestSchema.safeParse(value);
  if (!parsed.success) throw new SyncedSkillsReadError('EMANIFEST');
  const skills: SyncedClaudeSkill[] = [];
  for (const entry of parsed.data.skills) {
    const skill = syncedSkill(entry.name, entry.description ?? '');
    if (skill) skills.push(skill);
  }
  return skills;
}

/** The `---` fenced frontmatter block of a file, without its fences. */
function frontmatterBlock(text: string): string | undefined {
  const opening = /^---\r?\n/.exec(text);
  if (!opening) return undefined;
  const body = text.slice(opening[0].length);
  const end = body.search(/^---[ \t]*\r?$/m);
  return end === -1 ? undefined : body.slice(0, end);
}

/**
 * Name and description of one synced `SKILL.md`. The frontmatter `name` wins;
 * without one, the directory name is the skill name. A block that is not
 * valid YAML falls back to the plain `key: value` lines Claude Code itself
 * tolerates. Throws `EFRONTMATTER` when the file has no frontmatter. Pure.
 */
export function syncedSkillFromSkillFile(
  dirName: string,
  text: string,
): SyncedClaudeSkill | undefined {
  const block = frontmatterBlock(text);
  if (block === undefined) throw new SyncedSkillsReadError('EFRONTMATTER');
  let name: unknown;
  let description: unknown;
  try {
    const data: unknown = matter(`---\n${block}\n---\n`, MATTER_OPTIONS).data;
    name = isRecord(data) ? data['name'] : undefined;
    description = isRecord(data) ? data['description'] : undefined;
  } catch {
    const lineValue = (key: string): string | undefined => {
      const line = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(block);
      return line ? yamlLineScalar(line[1]) : undefined;
    };
    name = lineValue('name');
    description = lineValue('description');
  }
  return syncedSkill(
    typeof name === 'string' && name.trim() ? name.trim() : dirName,
    typeof description === 'string' ? description.trim() : '',
  );
}

/** `undefined` when the path does not exist. */
async function statOrAbsent(
  path: string,
): Promise<Awaited<ReturnType<typeof stat>> | undefined> {
  try {
    return await stat(path);
  } catch (error: unknown) {
    if (ABSENT_CODES.has(errorCode(error))) return undefined;
    throw error;
  }
}

/** Where one account folder's skills come from, and its cache signature. */
type AccountSource =
  | { readonly kind: 'manifest'; readonly dir: string; readonly sig: string }
  | {
      readonly kind: 'skill-files';
      readonly dir: string;
      readonly skillDirs: readonly string[];
      readonly sig: string;
    };

async function accountSource(dir: string): Promise<AccountSource> {
  const manifest = await statOrAbsent(join(dir, MANIFEST_FILE));
  if (manifest) {
    return {
      kind: 'manifest',
      dir,
      sig: `m:${manifest.mtimeMs}:${manifest.size}`,
    };
  }
  const entries = await readdir(dir, { withFileTypes: true });
  const skillDirs: string[] = [];
  const parts: string[] = [];
  for (const entry of entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const skillFile = await statOrAbsent(join(dir, entry.name, SKILL_FILE));
    if (!skillFile) continue;
    skillDirs.push(entry.name);
    parts.push(`${entry.name}:${skillFile.mtimeMs}:${skillFile.size}`);
  }
  return { kind: 'skill-files', dir, skillDirs, sig: `s:${parts.join('|')}` };
}

async function readAccountSkills(
  source: AccountSource,
): Promise<SyncedClaudeSkill[]> {
  if (source.kind === 'manifest') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        await readFile(join(source.dir, MANIFEST_FILE), 'utf8'),
      );
    } catch (error: unknown) {
      if (error instanceof SyntaxError) {
        throw new SyncedSkillsReadError('EMANIFEST');
      }
      throw error;
    }
    return syncedSkillsFromManifest(parsed);
  }
  const skills: SyncedClaudeSkill[] = [];
  for (const dirName of source.skillDirs) {
    const text = await readFile(join(source.dir, dirName, SKILL_FILE), 'utf8');
    const skill = syncedSkillFromSkillFile(dirName, text);
    if (skill) skills.push(skill);
  }
  return skills;
}

interface CachedSyncedSkills {
  readonly signature: string;
  readonly skills: readonly SyncedClaudeSkill[];
}

/** Last good result per resolved config dir. A handful of entries at most. */
const MAX_CACHED_DIRS = 64;
const cache = new Map<string, CachedSyncedSkills>();

/** Specs only: forget every cached result. */
export function clearSyncedClaudeSkillsCache(): void {
  cache.clear();
}

/**
 * The account-synced skills under `claudeConfigDir`, deduped by qualified id
 * across account folders (the first folder in name order wins) and sorted by
 * id. Never throws; see the module comment for the failure behaviour.
 */
export async function readSyncedClaudeSkills(
  claudeConfigDir: string,
  logger?: Pick<Logger, 'debug'>,
): Promise<SyncedClaudeSkill[]> {
  const configDir = resolve(claudeConfigDir);
  const syncedDir = join(configDir, 'skills', 'synced');
  try {
    let accounts: string[];
    try {
      accounts = (await readdir(syncedDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name)
        .sort();
    } catch (error: unknown) {
      if (ABSENT_CODES.has(errorCode(error))) {
        logger?.debug(
          '[SyncedClaudeSkills] No synced skills directory; none to hide',
        );
        cache.delete(configDir);
        return [];
      }
      throw error;
    }
    const sources = await Promise.all(
      accounts.map((account) => accountSource(join(syncedDir, account))),
    );
    const signature = sources
      .map((source, index) => `${accounts[index]}=${source.sig}`)
      .join('\n');
    const cached = cache.get(configDir);
    if (cached && cached.signature === signature) return [...cached.skills];

    const byId = new Map<string, SyncedClaudeSkill>();
    for (const source of sources) {
      for (const skill of await readAccountSkills(source)) {
        if (!byId.has(skill.id)) byId.set(skill.id, skill);
      }
    }
    const skills = [...byId.values()].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    if (cache.size >= MAX_CACHED_DIRS) cache.clear();
    cache.set(configDir, { signature, skills });
    return [...skills];
  } catch (error: unknown) {
    // degradation-audit: reported - the error code is logged at debug and
    // no synced skill is hidden, so the session only keeps a few more
    // prompt tokens; synced skills are not a security boundary.
    cache.delete(configDir);
    logger?.debug(
      '[SyncedClaudeSkills] Could not read the synced skills; none are hidden',
      { errorCode: errorCode(error) },
    );
    return [];
  }
}

/**
 * The config dir a Claude child reads: the first non-blank
 * `CLAUDE_CONFIG_DIR` in `envs` (in order), else `<home>/.claude`. Callers
 * pass the env the child is actually launched with: a named launch's
 * certified env alone, or the main session's auth env then `process.env`.
 */
export function resolveClaudeConfigDir(
  envs: ReadonlyArray<object | undefined>,
  homeDir: string = homedir(),
): string {
  for (const env of envs) {
    if (!env) continue;
    const value: unknown = Reflect.get(env, 'CLAUDE_CONFIG_DIR');
    if (typeof value === 'string' && value.trim()) return value;
  }
  return join(homeDir, '.claude');
}
