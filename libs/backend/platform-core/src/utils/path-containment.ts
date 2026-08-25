/**
 * Path-containment predicate — the single source of truth for "is this path
 * inside one of these authorized roots?".
 *
 * Consumed on BOTH sides of the terminal spawn path so the two guards cannot
 * drift, exactly like {@link ./shell-allowlist.ts}:
 *   - `workspace-authorization.ts` (the RPC-boundary check, in `rpc-handlers`)
 *   - `pty-manager.service.ts` (the spawn-site defence, in `apps/ptah-electron`)
 *
 * The POLICY (which roots are authorized: open workspace folders + home) is
 * decided by the RPC handler, which owns workspace discovery. The MECHANISM
 * (lexical containment of a candidate within that root set) lives here as a pure
 * function so the spawn sink can re-validate a caller-supplied cwd WITHOUT
 * taking a dependency on workspace state (TASK_2026_191 F4).
 *
 * Pure, `process.platform`-aware — like `shell-allowlist.ts` and
 * `workspace-path-guards.ts` in this directory. Not a port: no `PLATFORM_TOKENS`
 * entry, no adapter.
 */

import * as path from 'path';

/**
 * Canonicalize a path for lexical containment comparison:
 * resolve → forward-slashes → (win32 only) lowercase → strip trailing slash.
 *
 * LEXICAL ONLY (TASK_2026_191 F1): uses `path.resolve`, NOT `fs.realpath`, so a
 * junction/symlink inside an authorized root that points outward passes
 * containment. Deliberately accepted, not a defect: the terminal-cwd policy
 * already authorizes the entire home directory, so a symlink-out is strictly
 * weaker than an already-allowed primitive; `realpath` would add a filesystem
 * call, throw on a not-yet-existing cwd, and make this predicate impure — the
 * same trade-off TASK_2026_174 used to exclude it.
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
 * @param candidate The path to test (a terminal cwd).
 * @param roots     The authorized root set, decided by the caller (the RPC
 *                  handler's workspace folders + home).
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
