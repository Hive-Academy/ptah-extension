import * as os from 'node:os';
import * as path from 'node:path';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

/** Settings section, matching every other reader in this library. */
export const SKILLS_ROOT_SECTION = 'ptah';
export const SKILLS_ROOT_KEY = 'skillSynthesis.skillsRoot';

/**
 * The single root every synthesized-skill path is derived from.
 *
 * `~/.ptah/skills` unless `skillSynthesis.skillsRoot` names another path.
 * Read through the port so the CLI, Electron and VS Code hosts agree, and
 * fail-soft to the default when settings cannot be read.
 */
export function resolveSkillsRoot(
  workspace: IWorkspaceProvider | null | undefined,
): string {
  const fallback = path.join(os.homedir(), '.ptah', 'skills');
  if (!workspace) return fallback;
  try {
    const raw = workspace.getConfiguration<string>(
      SKILLS_ROOT_SECTION,
      SKILLS_ROOT_KEY,
      '',
    );
    return typeof raw === 'string' && raw.trim().length > 0
      ? raw.trim()
      : fallback;
  } catch {
    return fallback;
  }
}
