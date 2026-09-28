/**
 * Go module selection for the resolver context (TASK_2026_559
 * implementation-plan-languages.md, "Dependency graphs", Go row; Batch 33
 * review r1 R33-04), from the `go.mod` and `go.work` facts
 * `resolver-context.ts` read.
 *
 * Selection follows the Go module reference:
 * - every `go.mod` read (the root's, each `go.work` `use` module's) makes
 *   its module local, in its directory;
 * - a `go.work` `replace` of a module overrides every `go.mod` `replace` of
 *   it; without one, the `go.mod` replacements apply, and members that
 *   replace one module differently are a conflict;
 * - a version-qualified replacement applies only to the required version: it
 *   wins over an unqualified one when that version is the one required, and
 *   does not apply to another. When the required version is not known here
 *   (not required by a `go.mod` read, or required at two versions) the
 *   selection is not guessed;
 * - a replacement directory is resolved against the manifest's directory;
 *   an absolute one is resolved through its real path before it is checked
 *   against the root's real path.
 *
 * A module whose selection cannot be decided is `unknown`: its imports are
 * never edges or proven external, and the context carries the
 * `module-selection-unknown` gap.
 */
import * as path from 'path';
import type { GoModFacts, GoReplace, GoWorkFacts } from './go-manifest';
import {
  isInside,
  toForwardSlashes,
  type ManifestFileSystem,
} from './manifest-reader';

/** One Go module inside the root. */
export interface GoModuleDir {
  /** The module path (`example.com/app`). */
  readonly path: string;
  /** Its directory (forward slashes). */
  readonly dir: string;
}

/** Go module paths (Go row of the plan's resolution table). */
export interface GoModules {
  /** Modules whose selected code is under the root, longest path first. */
  readonly local: readonly GoModuleDir[];
  /**
   * Module paths proven outside the root: required modules, and modules
   * whose selected replacement is another module or a directory outside the
   * root.
   */
  readonly external: ReadonlySet<string>;
  /** Modules whose selected code cannot be determined (see the module comment). */
  readonly unknown: ReadonlySet<string>;
}

/** A `go.mod` read, with its directory relative to the root (`''`: the root). */
export interface GoModManifest {
  readonly dir: string;
  readonly facts: GoModFacts;
}

/** Where a directory named by a Go manifest lies. */
export type GoDirectoryLocation =
  | { readonly kind: 'inside'; readonly relative: string }
  | { readonly kind: 'outside' }
  | { readonly kind: 'unknown' };

export interface GoLocationIo {
  /** The root, forward slashes. */
  readonly root: string;
  /** The root's real path, forward slashes; `undefined` when unknown. */
  readonly realRoot: string | undefined;
  readonly fileSystem: ManifestFileSystem;
}

/**
 * Where `dir` (as written in a manifest in `baseRelative`) lies: a relative
 * directory is resolved lexically; an absolute one through its real path,
 * `unknown` when that lookup fails or the root's real path is unknown.
 */
export async function locateGoDirectory(
  dir: string,
  baseRelative: string,
  io: GoLocationIo,
): Promise<GoDirectoryLocation> {
  const forward = toForwardSlashes(dir);
  if (!forward.startsWith('/') && !/^[A-Za-z]:/.test(forward)) {
    const normalised = path.posix
      .normalize(path.posix.join(baseRelative, forward))
      .replace(/\/+$/, '');
    if (normalised === '..' || normalised.startsWith('../')) {
      return { kind: 'outside' };
    }
    return { kind: 'inside', relative: normalised === '.' ? '' : normalised };
  }
  if (io.realRoot === undefined) return { kind: 'unknown' };
  let real: string | undefined;
  try {
    real = toForwardSlashes(await io.fileSystem.realpath(forward)).replace(
      /\/+$/,
      '',
    );
  } catch {
    // A directory that cannot be looked up: where it lies is unknown.
    real = undefined;
  }
  if (real === undefined) return { kind: 'unknown' };
  const realRoot = io.realRoot.replace(/\/+$/, '');
  if (samePath(real, realRoot)) {
    return { kind: 'inside', relative: '' };
  }
  if (!isInside(real, realRoot)) return { kind: 'outside' };
  return { kind: 'inside', relative: real.slice(realRoot.length + 1) };
}

/** The module selection of the manifests read (see the module comment). */
export async function selectGoModules(
  mods: readonly GoModManifest[],
  work: GoWorkFacts | undefined,
  io: GoLocationIo,
): Promise<{ modules: GoModules; selectionUnknown: boolean }> {
  const local: GoModuleDir[] = mods.map(({ dir, facts }) => ({
    path: facts.module,
    dir: underRoot(io.root, dir),
  }));
  const external = new Set<string>();
  const unknown = new Set<string>();
  const required = new Map<string, Set<string>>();
  for (const { facts } of mods) {
    for (const { path: modulePath, version } of facts.requires) {
      external.add(modulePath);
      const versions = required.get(modulePath) ?? new Set<string>();
      versions.add(version);
      required.set(modulePath, versions);
    }
  }

  const workReplaces = (work?.replaces ?? []).map((replace) => ({
    replace,
    base: '',
  }));
  const modReplaces = mods.flatMap(({ dir, facts }) =>
    facts.replaces.map((replace) => ({ replace, base: dir })),
  );
  const replaced = new Set(
    [...workReplaces, ...modReplaces].map(({ replace }) => replace.from),
  );
  for (const modulePath of replaced) {
    const inWork = workReplaces.filter((r) => r.replace.from === modulePath);
    const layer =
      inWork.length > 0
        ? inWork
        : modReplaces.filter((r) => r.replace.from === modulePath);
    const chosen = applicable(layer, required.get(modulePath));
    if (chosen === 'unknown') {
      unknown.add(modulePath);
      continue;
    }
    if (chosen.length === 0) continue; // no replacement applies
    const targets = new Map<string, GoDirectoryLocation | 'module'>();
    for (const { replace, base } of chosen) {
      if (replace.localDir === undefined) {
        targets.set(`module:${replace.to ?? ''}`, 'module');
        continue;
      }
      const location = await locateGoDirectory(replace.localDir, base, io);
      targets.set(locationKey(location), location);
    }
    const [only, ...others] = [...targets.values()];
    if (others.length > 0 || only === undefined) {
      unknown.add(modulePath); // members replace it differently
    } else if (only === 'module' || only.kind === 'outside') {
      external.add(modulePath);
    } else if (only.kind === 'unknown') {
      unknown.add(modulePath);
    } else {
      local.push({ path: modulePath, dir: underRoot(io.root, only.relative) });
    }
  }

  return {
    modules: {
      local: local.sort((a, b) => b.path.length - a.path.length),
      external,
      unknown,
    },
    selectionUnknown: unknown.size > 0,
  };
}

/**
 * The replacements of one module that apply, or `'unknown'` when that
 * depends on a required version this context does not know.
 */
function applicable<T extends { readonly replace: GoReplace }>(
  layer: readonly T[],
  requiredVersions: ReadonlySet<string> | undefined,
): T[] | 'unknown' {
  const versioned = layer.filter((r) => r.replace.fromVersion !== undefined);
  const unversioned = layer.filter((r) => r.replace.fromVersion === undefined);
  if (versioned.length === 0) return unversioned;
  if (requiredVersions === undefined || requiredVersions.size !== 1) {
    return 'unknown';
  }
  const [version] = [...requiredVersions];
  const matching = versioned.filter((r) => r.replace.fromVersion === version);
  return matching.length > 0 ? matching : unversioned;
}

function locationKey(location: GoDirectoryLocation): string {
  return location.kind === 'inside'
    ? `inside:${location.relative}`
    : location.kind;
}

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32'
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

function underRoot(root: string, relative: string): string {
  return relative === '' ? root : path.posix.join(root, relative);
}
