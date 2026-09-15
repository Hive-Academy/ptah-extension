/**
 * `planNativeIgnoreSet` — the `ignore` list the watch host gives the native
 * engine for one root (TASK_2026_437 C8), extracted from
 * `WorkspaceWatchHostCore` so the host keeps only subscription state.
 *
 * The list is a cost filter, never the exclusion authority: each subscriber's
 * own `WorkspaceChangeCoalescer` applies that subscriber's full rules. So the
 * plan holds only what EVERY subscriber excludes, and only in a form whose
 * native meaning cannot be wider than the coalescer's:
 *
 * - directory names and segment rules become `**\/…\/**` globs (subtree
 *   exclusions, so a backend that prunes a matched directory prunes exactly
 *   what the coalescer drops); names with characters that would need glob
 *   escaping are skipped; segment rules are spelled case-insensitively;
 * - consumer globs pass only when they end in `/**` (a subtree) and compile;
 * - nested roots pass as absolute paths: seeded ones every subscriber listed,
 *   detected ones when every subscriber has detection on.
 *
 * Nothing naming `.git` is ever included: nested-repo detection needs the
 * `.git` create events, and a narrower native set is always safe.
 *
 * Pure: the result depends only on the input, and is sorted, so the host can
 * compare two plans element by element.
 */

import picomatch from 'picomatch';

import type { WorkspaceWatchOptions } from '../interfaces/workspace-watcher.interface';
import { toWorkspaceWatchPathKey } from './workspace-watch-protocol';

/** What the planner reads from one subscriber. */
export interface NativeIgnoreSubscriber {
  readonly options: WorkspaceWatchOptions;
  /** `options.nestedRepoRoots`, as path keys. */
  readonly seededNestedRootKeys: ReadonlySet<string>;
}

export interface NativeIgnoreSetInput {
  /** The root's path key (`toWorkspaceWatchPathKey`). */
  readonly rootKey: string;
  readonly subscribers: readonly NativeIgnoreSubscriber[];
  /** Runtime-detected nested roots: path key → absolute spelling. */
  readonly detectedNestedRoots: ReadonlyMap<string, string>;
}

/** Names safe to turn into a native glob without escaping. */
const SAFE_GLOB_NAME = /^[A-Za-z0-9._-]+$/;
const GIT_MARKER = /\.git/i;

export function planNativeIgnoreSet(
  input: NativeIgnoreSetInput,
): readonly string[] {
  const { subscribers } = input;
  if (subscribers.length === 0) return [];
  // An intersection: which subscriber is `first` does not change the result.
  const [first, ...rest] = subscribers;
  const ignore = new Set<string>();

  for (const name of first.options.excludeDirNames) {
    if (!isSafeGlobName(name)) continue;
    if (rest.every((s) => s.options.excludeDirNames.includes(name))) {
      ignore.add(`**/${name}/**`);
    }
  }

  const ruleKey = (rule: readonly string[]) =>
    rule
      .filter((segment) => segment.length > 0)
      .map((segment) => segment.toLowerCase())
      .join('/');
  for (const rule of first.options.excludeSegmentRules) {
    const segments = rule.filter((segment) => segment.length > 0);
    if (segments.length === 0 || !segments.every(isSafeGlobName)) continue;
    const wanted = ruleKey(segments);
    if (
      rest.every((s) =>
        s.options.excludeSegmentRules.some(
          (other) => ruleKey(other) === wanted,
        ),
      )
    ) {
      ignore.add(`**/${segments.map(caseInsensitiveGlobName).join('/')}/**`);
    }
  }

  for (const glob of first.options.excludeGlobs) {
    if (!glob.endsWith('/**') || GIT_MARKER.test(glob)) continue;
    if (!rest.every((s) => s.options.excludeGlobs.includes(glob))) continue;
    if (compilesAsGlob(glob)) ignore.add(glob);
  }

  const { rootKey } = input;
  const isStrictlyUnderRoot = (key: string) =>
    key.startsWith(rootKey.endsWith('/') ? rootKey : `${rootKey}/`);
  for (const nestedRoot of first.options.nestedRepoRoots ?? []) {
    const key = toWorkspaceWatchPathKey(nestedRoot);
    if (!isStrictlyUnderRoot(key)) continue;
    if (rest.every((s) => s.seededNestedRootKeys.has(key))) {
      ignore.add(nestedRoot);
    }
  }
  if (subscribers.every((s) => s.options.nestedRepoDetection)) {
    for (const [key, nestedRoot] of input.detectedNestedRoots) {
      if (isStrictlyUnderRoot(key)) ignore.add(nestedRoot);
    }
  }

  return [...ignore].sort((a, b) => a.localeCompare(b));
}

function isSafeGlobName(name: string): boolean {
  return (
    SAFE_GLOB_NAME.test(name) &&
    name !== '.' &&
    name !== '..' &&
    name.toLowerCase() !== '.git'
  );
}

/** `Worktrees` → `[wW][oO]…` so the native glob folds ASCII case like the rule. */
function caseInsensitiveGlobName(name: string): string {
  let glob = '';
  for (const char of name) {
    const lower = char.toLowerCase();
    const upper = char.toUpperCase();
    glob += lower === upper ? char : `[${lower}${upper}]`;
  }
  return glob;
}

function compilesAsGlob(glob: string): boolean {
  try {
    picomatch.makeRe(glob, { dot: true });
    return true;
  } catch {
    // degradation-audit: optional-capability — a glob that does not compile
    // is left out of the native ignore set only; the subscriber's coalescer
    // compiled it already, so exclusion is unaffected.
    return false;
  }
}
