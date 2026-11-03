/**
 * Same-name skill discovery for the Claude built-in skill denials
 * (TASK_2026_853, review fixes R1 and R2).
 *
 * A catalog terminal-skill denial rides `skillOverrides` as a bare key, and a
 * bare key hides every skill with that name from every source (A0 spike case
 * c). Before the main session, a Claude lane or a Ptah CLI spawn emits one,
 * this module looks for a skill of the same name in the places that session's
 * Claude child loads skills from, and the pure rule in
 * `claude-builtin-catalog.ts` drops the colliding denials:
 *
 * - workspace (setting source `project`): `.claude/skills/<dir>` and
 *   `.claude/commands/<name>.md` in the session cwd and each parent directory
 *   below the home directory. Ptah's own plugin and harness skills are synced
 *   into these directories;
 * - user (setting source `user`): `<claudeConfigDir>/skills/<dir>` and
 *   `<claudeConfigDir>/commands`;
 * - plugin: the same two directories under the `installPath` in
 *   `<claudeConfigDir>/plugins/installed_plugins.json` of each plugin whose
 *   `enabledPlugins` value is `true` in the loaded tiers' settings files
 *   (`local` over `project` over `user`). A disabled or never-enabled
 *   installed plugin loads no skills, so it cannot collide (R2b N4).
 *
 * A tier the session does not load is not scanned (R2 N2): a localhost proxy
 * drops `user`, so a user-only `init` skill is not loaded there and must not
 * keep the built-in `init` visible.
 *
 * A skill's name is its directory name or its `SKILL.md` frontmatter `name`,
 * parsed as YAML. A missing directory or file is "nothing there". Any other
 * read failure, or an unreadable plugin registry, makes the result `unknown`;
 * the caller then emits no catalog skill denial, so a user's skill is never
 * hidden.
 *
 * Each scanned directory keeps a name index that is reused while the
 * directory's own stat and every `SKILL.md` stat are unchanged (R2 N3), so a
 * repeat launch stats files instead of re-reading them.
 */

import { open, readFile, readdir, stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import matter from 'gray-matter';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  CLAUDE_BUILTIN_TERMINAL_SKILL_IDS,
  withoutCollidingBuiltinSkillDenials,
  type ClaudeBuiltinPolicy,
  type ClaudeSkillSourceKind,
} from './claude-builtin-catalog';

export interface ClaudeSkillDiscoveryInput {
  /** Directories the Claude child may start in (the session cwd). */
  readonly cwds: readonly string[];
  /** The account config dir (`CLAUDE_CONFIG_DIR`); `~/.claude` when unset. */
  readonly claudeConfigDir?: string;
  /**
   * The SDK `settingSources` the child starts with. Absent means the SDK
   * default Ptah uses everywhere else: `user`, `project` and `local`.
   */
  readonly settingSources?: readonly string[];
  /** The home directory the parent walk stops at. Specs only. */
  readonly homeDir?: string;
}

export type ClaudeSkillNameDiscovery =
  | {
      readonly status: 'known';
      readonly found: ReadonlyMap<string, readonly ClaudeSkillSourceKind[]>;
    }
  | { readonly status: 'unknown'; readonly errorCode: string };

/** Enough of a `SKILL.md` to hold its frontmatter `name`. */
const SKILL_HEAD_BYTES = 4096;
const ABSENT_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR']);
const DEFAULT_SETTING_SOURCES: readonly string[] = ['user', 'project', 'local'];

/**
 * Any options object opts out of gray-matter's module-global cache, which
 * keeps a half-parsed entry after a YAML error (see the MATTER_OPTIONS note
 * in `libs/backend/output-styles/src/lib/output-style-frontmatter.ts`).
 */
const MATTER_OPTIONS = { language: 'yaml' } as const;

/** A read failure that leaves the discovered set unknown. */
class SkillDiscoveryUnknownError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'SkillDiscoveryUnknownError';
  }
}

function errorCode(error: unknown): string {
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

/**
 * The frontmatter block of a file head, without its `---` fences. When the
 * head was cut before the closing fence, the last partial line is dropped.
 */
function frontmatterBlock(text: string): string | undefined {
  const opening = /^---\r?\n/.exec(text);
  if (!opening) return undefined;
  const body = text.slice(opening[0].length);
  const end = body.search(/^---[ \t]*\r?$/m);
  if (end !== -1) return body.slice(0, end);
  const lastNewline = body.lastIndexOf('\n');
  return lastNewline === -1 ? '' : body.slice(0, lastNewline);
}

/**
 * One YAML scalar as written on a `key:` line: double-quoted, single-quoted
 * or plain with an optional ` # comment`. Used only when the block is not
 * valid YAML (Claude Code's own reader tolerates, for example, an unquoted
 * colon in a description). Pure.
 */
export function yamlLineScalar(raw: string): string | undefined {
  const value = raw.trim();
  if (value.startsWith('"')) {
    let out = '';
    for (let i = 1; i < value.length; i++) {
      const ch = value[i];
      if (ch === '\\' && i + 1 < value.length) {
        out += value[++i];
      } else if (ch === '"') {
        return out;
      } else {
        out += ch;
      }
    }
    return undefined;
  }
  if (value.startsWith("'")) {
    let out = '';
    for (let i = 1; i < value.length; i++) {
      if (value[i] !== "'") {
        out += value[i];
      } else if (value[i + 1] === "'") {
        out += "'";
        i++;
      } else {
        return out;
      }
    }
    return undefined;
  }
  const comment = value.search(/(^|\s)#/);
  return (comment === -1 ? value : value.slice(0, comment)).trim();
}

/** The frontmatter `name` of a skill file head, when it has one. Pure. */
export function skillFrontmatterName(text: string): string | undefined {
  const block = frontmatterBlock(text);
  if (block === undefined) return undefined;
  let name: unknown;
  try {
    const data: unknown = matter(`---\n${block}\n---\n`, MATTER_OPTIONS).data;
    name = isRecord(data) ? data['name'] : undefined;
  } catch {
    const line = /^name:[ \t]*(.*)$/m.exec(block);
    name = line ? yamlLineScalar(line[1]) : undefined;
  }
  if (typeof name !== 'string') return undefined;
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Every plugin install root in a parsed `installed_plugins.json` whose
 * plugin id (`name@marketplace`) passes `isEnabled` (all of them when
 * omitted). Accepts the v2 shape (`plugins: { id: [{ installPath }] }`) and
 * the v1 shape (`plugins: { id: { installPath } }`). Throws when the shape is
 * not one of them, because a plugin that cannot be located cannot be ruled
 * out. Pure.
 */
export function installedPluginRoots(
  value: unknown,
  isEnabled: (pluginId: string) => boolean = () => true,
): string[] {
  if (!isRecord(value) || !isRecord(value['plugins'])) {
    throw new SkillDiscoveryUnknownError('EPLUGINFORMAT');
  }
  const roots: string[] = [];
  for (const [pluginId, entry] of Object.entries(value['plugins'])) {
    for (const install of Array.isArray(entry) ? entry : [entry]) {
      if (!isRecord(install) || typeof install['installPath'] !== 'string') {
        throw new SkillDiscoveryUnknownError('EPLUGINFORMAT');
      }
      if (isEnabled(pluginId)) roots.push(install['installPath']);
    }
  }
  return roots;
}

/**
 * The `enabledPlugins` map of one Claude settings file: `undefined` when the
 * file or the key is absent. An unreadable or unparseable file, or a key that
 * is not an object, is unknown: a plugin that may be enabled cannot be ruled
 * out (R2b N4).
 */
async function readEnabledPlugins(
  settingsFile: string,
): Promise<ReadonlyMap<string, boolean> | undefined> {
  let raw: string;
  try {
    raw = await readFile(settingsFile, 'utf8');
  } catch (error: unknown) {
    if (ABSENT_CODES.has(errorCode(error))) return undefined;
    throw new SkillDiscoveryUnknownError(errorCode(error));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SkillDiscoveryUnknownError('ESETTINGSPARSE');
  }
  if (!isRecord(parsed))
    throw new SkillDiscoveryUnknownError('ESETTINGSFORMAT');
  const enabled = parsed['enabledPlugins'];
  if (enabled === undefined) return undefined;
  if (!isRecord(enabled))
    throw new SkillDiscoveryUnknownError('ESETTINGSFORMAT');
  const entries = Object.entries(enabled);
  if (entries.some(([, value]) => typeof value !== 'boolean'))
    throw new SkillDiscoveryUnknownError('ESETTINGSFORMAT');
  return new Map(entries as [string, boolean][]);
}

/**
 * Plugin ids enabled for a session: per cwd, Claude Code's precedence
 * `local` over `project` over `user`, reading only the loaded tiers. A
 * plugin enabled for any of the cwds counts, since any could be the child's.
 */
async function enabledPluginIds(
  configDir: string,
  cwds: readonly string[],
  sources: ReadonlySet<string>,
): Promise<ReadonlySet<string>> {
  const user = sources.has('user')
    ? await readEnabledPlugins(join(configDir, 'settings.json'))
    : undefined;
  const perCwd = await Promise.all(
    [...new Set(cwds.map((cwd) => resolve(cwd)))].map(async (cwd) => {
      const [project, local] = await Promise.all([
        sources.has('project')
          ? readEnabledPlugins(join(cwd, '.claude', 'settings.json'))
          : undefined,
        sources.has('local')
          ? readEnabledPlugins(join(cwd, '.claude', 'settings.local.json'))
          : undefined,
      ]);
      // Lowest precedence first, so a later tier overwrites an earlier one.
      const effective = new Map<string, boolean>();
      for (const tier of [user, project, local]) {
        for (const [id, on] of tier ?? []) effective.set(id, on);
      }
      return effective;
    }),
  );
  const ids = new Set<string>();
  for (const effective of perCwd) {
    for (const [id, on] of effective) if (on) ids.add(id);
  }
  return ids;
}

/** `undefined` when the path does not exist; unknown on any other failure. */
async function statOrAbsent(path: string): Promise<Stats | undefined> {
  try {
    return await stat(path);
  } catch (error: unknown) {
    if (ABSENT_CODES.has(errorCode(error))) return undefined;
    throw new SkillDiscoveryUnknownError(errorCode(error));
  }
}

/** Changes whenever the file or directory is written, replaced or resized. */
function statKey(stats: Stats): string {
  return `${stats.mtimeMs}:${stats.ctimeMs}:${stats.size}:${stats.ino}`;
}

async function readDirNames(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name);
  } catch (error: unknown) {
    if (ABSENT_CODES.has(errorCode(error))) return [];
    throw new SkillDiscoveryUnknownError(errorCode(error));
  }
}

async function readCommandNames(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries
      .filter((name) => name.endsWith('.md'))
      .map((name) => name.slice(0, -'.md'.length));
  } catch (error: unknown) {
    if (ABSENT_CODES.has(errorCode(error))) return [];
    throw new SkillDiscoveryUnknownError(errorCode(error));
  }
}

async function readSkillName(skillFile: string): Promise<string | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(skillFile, 'r');
    const buffer = Buffer.alloc(SKILL_HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, SKILL_HEAD_BYTES, 0);
    return skillFrontmatterName(buffer.toString('utf8', 0, bytesRead));
  } catch (error: unknown) {
    const code = errorCode(error);
    // Removed between the stat and the read: not a skill.
    if (ABSENT_CODES.has(code) || code === 'EISDIR') return undefined;
    throw new SkillDiscoveryUnknownError(code);
  } finally {
    await handle?.close();
  }
}

/** A `SKILL.md` frontmatter name, valid while the file's stat key holds. */
interface CachedSkillName {
  readonly statKey: string;
  readonly name: string | undefined;
}

/** One scanned directory's entry names, valid while its stat key holds. */
interface DirIndex {
  readonly statKey: string;
  readonly names: readonly string[];
}

/**
 * Bound on the module-level indexes. Real sessions scan a handful of
 * directories per root; a store this large is only reached by churn, and is
 * then cleared rather than grown.
 */
const MAX_CACHED_PATHS = 2048;
const dirIndexes = new Map<string, DirIndex>();
const skillNames = new Map<string, CachedSkillName>();

function remember<T>(store: Map<string, T>, key: string, value: T): void {
  if (store.size >= MAX_CACHED_PATHS && !store.has(key)) store.clear();
  store.set(key, value);
}

/** Specs only: forget every cached directory index and skill name. */
export function clearClaudeSkillNameCache(): void {
  dirIndexes.clear();
  skillNames.clear();
}

/** A directory's entry names, from the index while its stat is unchanged. */
async function indexedNames(
  dir: string,
  read: (dir: string) => Promise<string[]>,
): Promise<readonly string[]> {
  const stats = await statOrAbsent(dir);
  if (!stats) {
    dirIndexes.delete(dir);
    return [];
  }
  const key = statKey(stats);
  const cached = dirIndexes.get(dir);
  if (cached?.statKey === key) return cached.names;
  const names = await read(dir);
  remember(dirIndexes, dir, { statKey: key, names });
  return names;
}

/** A `SKILL.md` name, re-read only when the file's stat changed. */
async function indexedSkillName(
  skillFile: string,
): Promise<string | undefined> {
  const stats = await statOrAbsent(skillFile);
  if (!stats || !stats.isFile()) {
    skillNames.delete(skillFile);
    return undefined;
  }
  const key = statKey(stats);
  const cached = skillNames.get(skillFile);
  if (cached?.statKey === key) return cached.name;
  const name = await readSkillName(skillFile);
  remember(skillNames, skillFile, { statKey: key, name });
  return name;
}

async function readPluginRoots(
  claudeConfigDir: string,
  enabled: ReadonlySet<string>,
): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(
      join(claudeConfigDir, 'plugins', 'installed_plugins.json'),
      'utf8',
    );
  } catch (error: unknown) {
    if (ABSENT_CODES.has(errorCode(error))) return [];
    throw new SkillDiscoveryUnknownError(errorCode(error));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SkillDiscoveryUnknownError('EPLUGINPARSE');
  }
  return installedPluginRoots(parsed, (pluginId) => enabled.has(pluginId));
}

/** The cwd and each parent, stopping before `home` and at the filesystem root. */
function projectDirs(cwds: readonly string[], home: string): string[] {
  const dirs = new Set<string>();
  for (const cwd of cwds) {
    let dir = resolve(cwd);
    while (dir !== home) {
      dirs.add(dir);
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return [...dirs];
}

/**
 * Find skills named like any of `names` in the workspace, user and plugin
 * skill sources the session's setting sources load. Never throws: an
 * unexpected read failure is `unknown`.
 */
export async function discoverClaudeSkillNames(
  input: ClaudeSkillDiscoveryInput,
  names: readonly string[] = CLAUDE_BUILTIN_TERMINAL_SKILL_IDS,
): Promise<ClaudeSkillNameDiscovery> {
  const wanted = new Set(names);
  const found = new Map<string, Set<ClaudeSkillSourceKind>>();
  const record = (name: string, kind: ClaudeSkillSourceKind) => {
    const sources = found.get(name) ?? new Set<ClaudeSkillSourceKind>();
    sources.add(kind);
    found.set(name, sources);
  };
  const scanSkills = async (dir: string, kind: ClaudeSkillSourceKind) => {
    const entries = await indexedNames(dir, readDirNames);
    // The per-skill stats run together, not one await per entry (R2b N3).
    await Promise.all(
      entries.map(async (entry) => {
        if (wanted.has(entry)) {
          record(entry, kind);
          return;
        }
        const name = await indexedSkillName(join(dir, entry, 'SKILL.md'));
        if (name !== undefined && wanted.has(name)) record(name, kind);
      }),
    );
  };
  const scanCommands = async (dir: string, kind: ClaudeSkillSourceKind) => {
    for (const name of await indexedNames(dir, readCommandNames)) {
      if (wanted.has(name)) record(name, kind);
    }
  };
  const scanRoot = (root: string, kind: ClaudeSkillSourceKind) =>
    Promise.all([
      scanSkills(join(root, 'skills'), kind),
      scanCommands(join(root, 'commands'), kind),
    ]);

  const sources = new Set(input.settingSources ?? DEFAULT_SETTING_SOURCES);
  const loadsUser = sources.has('user');
  const loadsProject = sources.has('project');
  const loadsAnyTier = loadsUser || loadsProject || sources.has('local');
  if (wanted.size > 0 && loadsAnyTier) {
    const home = resolve(input.homeDir ?? homedir());
    const configDir = resolve(input.claudeConfigDir || join(home, '.claude'));
    try {
      await Promise.all([
        loadsUser ? scanRoot(configDir, 'user') : undefined,
        ...(loadsProject
          ? projectDirs(input.cwds, home).map((dir) =>
              scanRoot(join(dir, '.claude'), 'workspace'),
            )
          : []),
        // Only a plugin enabled in a loaded tier loads its skills (R2b N4).
        enabledPluginIds(configDir, input.cwds, sources)
          .then((enabled) =>
            enabled.size > 0 ? readPluginRoots(configDir, enabled) : [],
          )
          .then((roots) =>
            Promise.all(roots.map((root) => scanRoot(root, 'plugin'))),
          ),
      ]);
    } catch (error: unknown) {
      return {
        status: 'unknown',
        errorCode:
          error instanceof SkillDiscoveryUnknownError
            ? error.code
            : errorCode(error),
      };
    }
  }
  return {
    status: 'known',
    found: new Map(
      [...found].map(([name, kinds]) => [name, [...kinds].sort()]),
    ),
  };
}

/**
 * The built-in policy with every catalog skill denial removed that would hide
 * a same-name workspace, user or plugin skill. The one entry point the main
 * session, the Claude lanes and the Ptah CLI spawns share. Logs the skipped
 * catalog names, their source kinds and an error code; never a path.
 */
export async function guardClaudeBuiltinSkillDenials(
  builtinPolicy: ClaudeBuiltinPolicy,
  input: ClaudeSkillDiscoveryInput,
  logger: Pick<Logger, 'info' | 'warn'>,
): Promise<ClaudeBuiltinPolicy> {
  const catalog = new Set(CLAUDE_BUILTIN_TERMINAL_SKILL_IDS);
  const catalogDenials = builtinPolicy.deniedSkillNames.filter((name) =>
    catalog.has(name),
  );
  if (catalogDenials.length === 0) return builtinPolicy;
  const discovery = await discoverClaudeSkillNames(input, catalogDenials);
  const result = withoutCollidingBuiltinSkillDenials(
    builtinPolicy.deniedSkillNames,
    discovery.status === 'known' ? discovery.found : null,
  );
  if (discovery.status === 'unknown') {
    logger.warn(
      '[ClaudeBuiltinSkills] Skill discovery failed; built-in skill denials skipped so no same-name skill is hidden',
      {
        errorCode: discovery.errorCode,
        keptVisible: result.keptVisible.map((row) => row.name),
      },
    );
  } else if (result.keptVisible.length > 0) {
    logger.info(
      '[ClaudeBuiltinSkills] Built-in skills kept visible: a same-name skill exists',
      { keptVisible: result.keptVisible },
    );
  }
  return { ...builtinPolicy, deniedSkillNames: result.deniedSkillNames };
}
