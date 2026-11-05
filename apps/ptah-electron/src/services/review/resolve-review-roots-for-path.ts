import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { RepositorySettings } from '@ptah-extension/review-contracts';
import type { IReviewSettingsStore, ReviewRoots, ReviewStageEnvironment } from '@ptah-extension/review-core';

function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** True when `<owner>/<name>` appears as consecutive path segments of the attempt path. */
function pathNamesRepository(target: string, repo: RepositorySettings): boolean {
  const segments = target.split(/[\\/]+/).map((segment) => segment.toLowerCase());
  const owner = repo.owner.toLowerCase();
  const name = repo.name.toLowerCase();
  return segments.some((segment, index) => segment === owner && segments[index + 1] === name);
}

/**
 * Finds the review roots that own an attempt path.
 *
 * The attempt tree is `<attemptsRoot>/<attemptId>` and `attemptsRoot` ends in
 * `<owner>/<name>`, so the repository is read from the path first and only
 * that repository is resolved. Its resolution error (for example a git probe
 * timeout) propagates unchanged, so the attempt records the real cause.
 */
export async function resolveReviewRootsForPath(
  path: string,
  environment: ReviewStageEnvironment,
  settingsStore: IReviewSettingsStore,
): Promise<ReviewRoots> {
  const settings = await settingsStore.getSettings();
  const repos = settings?.repositories.filter((repo) => repo.enabled) ?? [];
  const target = resolve(path);
  for (const repo of repos.filter((candidate) => pathNamesRepository(target, candidate))) {
    const roots = await environment.resolve({ owner: repo.owner, name: repo.name });
    if (isInside(roots.attemptsRoot, target)) return roots;
  }
  throw new Error('Review attempt is outside configured repository roots');
}
