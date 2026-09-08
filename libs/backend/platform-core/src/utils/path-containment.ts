/**
 * Path-containment predicate — the single source of truth for "is this path
 * inside one of these authorized roots?".
 *
 * The POLICY (which roots are authorized) is decided by the caller, which owns
 * workspace discovery; the MECHANISM (lexical containment of a candidate within
 * that root set) lives here as a pure function so any sink can re-validate a
 * caller-supplied path WITHOUT taking a dependency on workspace state
 * (TASK_2026_191 F4). `isAuthorizedWorkspace` in `rpc-handlers` is the
 * RPC-boundary consumer.
 *
 * Pure and `process.platform`-aware — like `workspace-path-guards.ts` in this
 * directory. Not a port: no `PLATFORM_TOKENS` entry, no adapter.
 */

import * as path from 'path';

/**
 * Canonicalize a path for lexical containment comparison:
 * resolve → forward-slashes → (win32 only) lowercase → strip trailing slash.
 *
 * LEXICAL ONLY (TASK_2026_191 F1): uses `path.resolve`, NOT `fs.realpath`, so a
 * junction/symlink inside an authorized root that points outward passes
 * containment. Deliberately accepted, not a defect: `realpath` would add a
 * filesystem call, throw on a not-yet-existing path, and make this predicate
 * impure — the same trade-off TASK_2026_174 used to exclude it.
 *
 * Case fold is win32-ONLY (TASK_2026_191 F2): folding case unconditionally would
 * let `/WORKSPACE/x` match an authorized `/workspace` on a case-sensitive
 * filesystem. Mirrors `normalize` in `workspace-path-guards.ts`.
 */
function normalize(p: string, platform: NodeJS.Platform): string {
  const resolved = path.resolve(p.replace(/\\/g, '/')).replace(/\\/g, '/');
  const cased = platform === 'win32' ? resolved.toLowerCase() : resolved;
  return cased.replace(/\/+$/, '');
}

/**
 * Whether `candidate` is equal to, or a descendant of, `base`. The separator
 * boundary check (`base + '/'`) prevents `/foo/bar` from matching the sibling
 * `/foo/barbaz`.
 */
function isContainedIn(
  candidate: string,
  base: string,
  platform: NodeJS.Platform,
): boolean {
  const target = normalize(candidate, platform);
  const root = normalize(base, platform);
  return target === root || target.startsWith(root + '/');
}

/**
 * Whether `candidate` is contained within ANY of `roots` (equal to a root or a
 * descendant of one). Fail-closed: an empty/falsy `candidate` or an empty
 * `roots` set returns `false`.
 *
 * @param candidate The path to test.
 * @param roots     The authorized root set, decided by the caller (for
 *                  `isAuthorizedWorkspace`, the open workspace folders).
 * @param platform  Node platform string; defaults to `process.platform` so tests
 *                  can drive it explicitly and stay OS-independent.
 */
export function isPathWithinRoots(
  candidate: string,
  roots: readonly string[],
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!candidate) return false;
  if (!roots || roots.length === 0) return false;
  return roots.some(
    (root) => !!root && isContainedIn(candidate, root, platform),
  );
}
