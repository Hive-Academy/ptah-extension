/**
 * Gemini CLI Skill Installer
 *
 * Workspace targets (project overrides home → bare-name, no `ptah-` prefix):
 * - skills:   {ws}/.gemini/skills/{slug}/SKILL.md
 * - commands: {ws}/.gemini/commands/{slug}.toml  (TOML with a `prompt` key)
 */

import { join } from 'path';
import type { CliCommandFormat } from './cli-skill-installer.interface';
import { WorkspaceSkillInstaller } from './workspace-skill-installer.base';

export class GeminiSkillInstaller extends WorkspaceSkillInstaller {
  readonly target = 'gemini' as const;
  readonly commandFormat: CliCommandFormat = 'toml';

  resolveSkillsTarget(workspaceRoot: string): string | null {
    return join(workspaceRoot, '.gemini', 'skills');
  }

  resolveCommandsTarget(workspaceRoot: string): string | null {
    return join(workspaceRoot, '.gemini', 'commands');
  }
}
