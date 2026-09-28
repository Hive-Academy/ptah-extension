/**
 * Monorepo member discovery — which directories of a monorepo are projects.
 *
 * Membership comes from what the workspace declares (package.json
 * `workspaces`, pnpm-workspace.yaml, lerna.json, rush.json, the legacy Nx
 * `projects` map — read by `MonorepoDetectorService.detectDeclaredMembers`),
 * plus, for Nx, every directory holding a `project.json`. Only when nothing is
 * declared does it fall back to the `apps/*` + `packages/*` convention, and it
 * says so.
 *
 * Every walk is bounded, and every bound that is hit, or directory that could
 * not be read, is reported in `issues` with `complete: false` — a partial list
 * is never presented as the whole workspace.
 */

import * as path from 'path';
import { FileType } from '@ptah-extension/platform-core';
import type { DirectoryEntry } from '@ptah-extension/platform-core';
import type { FileSystemService } from '../services/file-system.service';
import type { DeclaredMembership } from './monorepo-detector.service';

/** A directory holding one of these is a project; one without is a folder. */
export const MEMBER_MANIFESTS = [
  'project.json',
  'package.json',
  'pyproject.toml',
] as const;

/** Directory reads one discovery may spend. */
export const MAX_DISCOVERY_DIRECTORY_READS = 3_000;

/**
 * Deepest directory level searched below the root (the root is level 0).
 * Generous on purpose — the read budget bounds the cost — and disclosed in
 * `issues` whenever a directory below it is left unsearched.
 */
export const MAX_DISCOVERY_DEPTH = 12;

/** Most matched directories checked for a manifest. */
export const MAX_DISCOVERY_CANDIDATES = 2_000;

/** Used only when the workspace declares no members at all. */
const CONVENTION_PATTERNS = ['apps/*', 'packages/*'];

/**
 * Never entered by a `**` pattern or the Nx `project.json` search: build
 * output, dependencies and source trees hold no project roots in practice, and
 * entering them would spend the read budget on files. A literal pattern
 * segment naming one of them is still followed.
 */
const SEARCH_SKIPPED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'tmp',
  'coverage',
  'target',
  'src',
  '__pycache__',
]);

export interface MemberDiscovery {
  /** Workspace-relative project directories (forward slashes), sorted. */
  readonly directories: readonly string[];
  /** False when a bound was hit or something could not be read. */
  readonly complete: boolean;
  /** One fixed-shape line per disclosure. */
  readonly issues: readonly string[];
}

/** `*`, `?` and `{a,b}` of one path segment, or of a whole path with `**`. */
function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/';
      source += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else if (char === '{') {
      source += '(?:';
    } else if (char === '}') {
      source += ')';
    } else if (char === ',') {
      source += '|';
    } else {
      source += char.replace(/[.+^$()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

/**
 * {@link globToRegExp}, or `undefined` for a glob it cannot compile (an
 * unbalanced brace such as `{apps/a,libs/b}` split at its slash).
 */
function tryGlob(glob: string): RegExp | undefined {
  try {
    return globToRegExp(glob);
  } catch {
    // degradation-audit: reported - every caller records the unusable
    // pattern in the discovery `issues` and marks the result incomplete.
    return undefined;
  }
}

/** `./apps/*\/` → `apps/*`; a trailing `/package.json` names its directory. */
function normalizePattern(pattern: string): string {
  return pattern
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/(package|project)\.json$/, '')
    .replace(/\/+$/, '');
}

function joinRelative(parent: string, child: string): string {
  return parent ? `${parent}/${child}` : child;
}

/**
 * Resolve a monorepo's member project directories.
 *
 * @param fileSystem - Read access to the workspace
 * @param workspacePath - The monorepo root
 * @param membership - Its declared membership
 */
export async function discoverMemberDirectories(
  fileSystem: FileSystemService,
  workspacePath: string,
  membership: DeclaredMembership,
): Promise<MemberDiscovery> {
  const issues: string[] = [...membership.issues];
  let complete = membership.issues.length === 0 && membership.supported;
  if (!membership.supported) {
    issues.push('member listing is not supported for this monorepo type');
  }

  let reads = 0;
  let exhausted = false;
  /** Set when a directory below the depth bound was left unsearched. */
  let depthCut = false;
  const absolute = (rel: string): string =>
    rel ? path.join(workspacePath, ...rel.split('/')) : workspacePath;

  /** A directory's entries; `undefined` when absent, unreadable or over budget. */
  const list = async (rel: string): Promise<DirectoryEntry[] | undefined> => {
    if (reads >= MAX_DISCOVERY_DIRECTORY_READS) {
      exhausted = true;
      return undefined;
    }
    const dir = absolute(rel);
    if (!(await fileSystem.exists(dir))) {
      return undefined;
    }
    reads++;
    try {
      return await fileSystem.readDirectory(dir);
    } catch {
      // degradation-audit: reported - the unreadable directory is recorded in
      // `issues` and the discovery is marked incomplete for the caller.
      issues.push(`${rel || '.'}/ could not be read`);
      complete = false;
      return undefined;
    }
  };

  const childDirs = async (
    rel: string,
    searching: boolean,
  ): Promise<string[]> =>
    ((await list(rel)) ?? [])
      .filter(
        (entry) =>
          entry.type === FileType.Directory &&
          !entry.name.startsWith('.') &&
          entry.name !== 'node_modules' &&
          !(searching && SEARCH_SKIPPED_DIRS.has(entry.name)),
      )
      .map((entry) => entry.name)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const matched = new Set<string>();
  const expand = async (
    rel: string,
    segments: readonly string[],
    depth: number,
  ): Promise<void> => {
    if (segments.length === 0) {
      if (rel) matched.add(rel);
      return;
    }
    const [head, ...rest] = segments;
    if (head === '**') {
      await expand(rel, rest, depth);
      const children = await childDirs(rel, true);
      if (depth >= MAX_DISCOVERY_DEPTH) {
        if (children.length > 0) depthCut = true;
        return;
      }
      for (const child of children) {
        await expand(joinRelative(rel, child), segments, depth + 1);
      }
      return;
    }
    if (!/[*?{]/.test(head)) {
      // A literal segment costs no directory read, so it is not depth-bound.
      await expand(joinRelative(rel, head), rest, depth + 1);
      return;
    }
    if (depth > MAX_DISCOVERY_DEPTH) {
      depthCut = true;
      return;
    }
    const segment = globToRegExp(head);
    for (const child of await childDirs(rel, false)) {
      if (segment.test(child)) {
        await expand(joinRelative(rel, child), rest, depth + 1);
      }
    }
  };

  const declared = membership.patterns.map((p) => p.trim());
  /** A declared pattern this discovery cannot compile is reported, not thrown. */
  const unusable = (pattern: string): void => {
    complete = false;
    issues.push(`workspace pattern '${pattern}' could not be used`);
  };
  const includes: string[] = [];
  const excludes: RegExp[] = [];
  for (const pattern of declared) {
    if (pattern.startsWith('!')) {
      const exclude = tryGlob(normalizePattern(pattern.slice(1)));
      if (exclude) excludes.push(exclude);
      else unusable(pattern);
      continue;
    }
    const include = normalizePattern(pattern);
    if (include.length === 0) continue;
    const segmentsCompile = include
      .split('/')
      .every((segment) => !/[*?{]/.test(segment) || tryGlob(segment));
    if (segmentsCompile) includes.push(include);
    else unusable(pattern);
  }

  if (
    includes.length === 0 &&
    !membership.scanProjectJson &&
    membership.supported
  ) {
    issues.push(
      'no declared workspace members; apps/* and packages/* listed by convention',
    );
    includes.push(...CONVENTION_PATTERNS);
  }

  for (const pattern of includes) {
    await expand('', pattern.split('/'), 0);
  }

  const projects = new Set<string>();

  // Nx: a project is any directory holding a project.json.
  if (membership.scanProjectJson) {
    const scan = async (rel: string, depth: number): Promise<void> => {
      const entries = await list(rel);
      if (!entries) return;
      if (
        rel &&
        entries.some(
          (entry) =>
            entry.type === FileType.File && entry.name === 'project.json',
        )
      ) {
        projects.add(rel);
      }
      const children = entries.filter(
        (entry) =>
          entry.type === FileType.Directory &&
          !entry.name.startsWith('.') &&
          !SEARCH_SKIPPED_DIRS.has(entry.name),
      );
      if (depth >= MAX_DISCOVERY_DEPTH) {
        if (children.length > 0) depthCut = true;
        return;
      }
      for (const entry of children) {
        await scan(joinRelative(rel, entry.name), depth + 1);
      }
    };
    await scan('', 0);
  }

  const candidates = [...matched]
    .filter((rel) => !projects.has(rel))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (candidates.length > MAX_DISCOVERY_CANDIDATES) {
    complete = false;
    issues.push(
      `${candidates.length - MAX_DISCOVERY_CANDIDATES} of ${candidates.length} matched directories not checked (limit ${MAX_DISCOVERY_CANDIDATES})`,
    );
  }
  for (const rel of candidates.slice(0, MAX_DISCOVERY_CANDIDATES)) {
    for (const manifest of MEMBER_MANIFESTS) {
      if (await fileSystem.exists(path.join(absolute(rel), manifest))) {
        projects.add(rel);
        break;
      }
    }
  }

  if (depthCut) {
    complete = false;
    issues.push(
      `directories deeper than ${MAX_DISCOVERY_DEPTH} levels were not searched; more projects may exist`,
    );
  }

  if (exhausted) {
    complete = false;
    issues.push(
      `discovery stopped after ${MAX_DISCOVERY_DIRECTORY_READS} directory reads; more projects may exist`,
    );
  }

  const directories = [...projects]
    .filter((rel) => !excludes.some((exclude) => exclude.test(rel)))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { directories, complete, issues };
}
