/**
 * Command-line helpers shared by the tool's entry points (`main.ts`,
 * `review/review-tables.ts`). Each entry point keeps its own flag parsing and
 * `main()` bootstrap; this holds what they must agree on.
 */
import * as path from 'path';
import { SCOPE_MAP, isKnownScope } from './scope-map';

/** A bad invocation: the entry point prints it with its usage line, exit 2. */
export class UsageError extends Error {
  override readonly name = 'UsageError';
}

/** Workspace-relative path with forward slashes, on every platform. */
export function toRel(workspaceRoot: string, absPath: string): string {
  return path.relative(workspaceRoot, absPath).split(path.sep).join('/');
}

/**
 * The normalised `--project-root` (forward slashes, no trailing slash). It
 * must be the project the scope map assigns to `scope`, so a scope's files
 * are never checked or reviewed under another project's name.
 */
export function resolveProjectRoot(scope: string, projectRoot: string): string {
  if (!isKnownScope(scope)) {
    throw new UsageError(`unknown scope "${scope}"`);
  }
  const normalised = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const expected = SCOPE_MAP[scope].projectRoot;
  if (normalised !== expected) {
    throw new UsageError(
      `--project-root ${normalised} does not match scope "${scope}" (${expected})`,
    );
  }
  return normalised;
}
