/**
 * Cursor CLI Skill Installer
 *
 * Workspace targets (project overrides home → bare-name, no `ptah-` prefix):
 * - skills:   {ws}/.cursor/skills/{slug}/SKILL.md
 * - commands: {ws}/.cursor/commands/{slug}.md
 */

import { join } from 'path';
import type { CliCommandFormat } from './cli-skill-installer.interface';
import { WorkspaceSkillInstaller } from './workspace-skill-installer.base';

export class CursorSkillInstaller extends WorkspaceSkillInstaller {
  readonly target = 'cursor' as const;
  readonly commandFormat: CliCommandFormat = 'md';

  resolveSkillsTarget(workspaceRoot: string): string | null {
    return join(workspaceRoot, '.cursor', 'skills');
  }

  resolveCommandsTarget(workspaceRoot: string): string | null {
    return join(workspaceRoot, '.cursor', 'commands');
  }
}
