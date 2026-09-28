/**
 * Python module layout for the resolver context (TASK_2026_559
 * implementation-plan-languages.md, "Dependency graphs", Python row), from
 * the root `pyproject.toml` facts `resolver-context.ts` read.
 */
import * as path from 'path';
import type { PyprojectFacts } from './python-manifest';

/** Python module layout (Python row of the plan's resolution table). */
export interface PythonLayout {
  /**
   * Directories absolute imports are looked up from, in order: the root,
   * `<root>/src` when a graphed file is under it, then the `pyproject.toml`
   * source roots.
   */
  readonly sourceRoots: readonly string[];
  /** Dotted module name → its directory (`pyproject.toml` package dirs). */
  readonly packageDirs: ReadonlyMap<string, string>;
  /** Normalised distribution names declared from outside the workspace. */
  readonly dependencies: ReadonlySet<string>;
  /**
   * Normalised names of local dependencies → their directory under the
   * root, or `undefined` when the declaration does not name one inside it.
   * An import of one is a workspace module, never proven external.
   */
  readonly localDependencies: ReadonlyMap<string, string | undefined>;
}

/** The layout of a workspace with `pyproject` at its root (or none). */
export function pythonLayout(
  root: string,
  pyproject: PyprojectFacts | undefined,
  directories: ReadonlySet<string>,
): PythonLayout {
  const under = (relative: string): string =>
    relative === '' ? root : path.posix.join(root, relative);
  const src = under('src');
  const sourceRoots = new Set([root]);
  if (directories.has(src)) sourceRoots.add(src);
  for (const relative of pyproject?.sourceRoots ?? []) {
    sourceRoots.add(under(relative));
  }
  return {
    sourceRoots: [...sourceRoots],
    packageDirs: new Map(
      (pyproject?.packageDirs ?? []).map(({ module, dir }) => [
        module,
        under(dir),
      ]),
    ),
    dependencies: new Set(pyproject?.dependencies ?? []),
    localDependencies: new Map(
      (pyproject?.localDependencies ?? []).map(({ name, dir }) => [
        name,
        dir === undefined ? undefined : under(dir),
      ]),
    ),
  };
}
