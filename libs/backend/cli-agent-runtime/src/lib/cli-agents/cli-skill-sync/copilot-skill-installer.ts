/**
 * Copilot CLI Skill Installer
 *
 * Workspace targets (bare-name, single identity):
 * - skills:   {ws}/.github/skills/{slug}/SKILL.md  (NOT .copilot/skills)
 * - commands: SKIPPED — no documented project prompts dir (#2829)
 *
 * Copilot agents go to {ws}/.github/agents/{slug}.agent.md via
 * MultiCliAgentWriterService; home copies are reaped at the agent-sync layer
 * because Copilot's agent precedence is inverted (home wins).
 */

import { join } from 'path';
import type { CliCommandFormat } from './cli-skill-installer.interface';
import { WorkspaceSkillInstaller } from './workspace-skill-installer.base';

export class CopilotSkillInstaller extends WorkspaceSkillInstaller {
  readonly target = 'copilot' as const;
  readonly commandFormat: CliCommandFormat = null;

  resolveSkillsTarget(workspaceRoot: string): string | null {
    return join(workspaceRoot, '.github', 'skills');
  }

  resolveCommandsTarget(): string | null {
    return null;
  }
}
