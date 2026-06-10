/**
 * Codex CLI Skill Installer
 *
 * Workspace targets (bare-name, single identity):
 * - skills:   {ws}/.agents/skills/{slug}/SKILL.md  (NOT .codex/skills)
 * - commands: SKIPPED — Codex rejects project prompts (home-only upstream #9848)
 *
 * Codex agents are NOT propagated here; they merge into {ws}/AGENTS.md via
 * MultiCliAgentWriterService.
 */

import { join } from 'path';
import type { CliCommandFormat } from './cli-skill-installer.interface';
import { WorkspaceSkillInstaller } from './workspace-skill-installer.base';

export class CodexSkillInstaller extends WorkspaceSkillInstaller {
  readonly target = 'codex' as const;
  readonly commandFormat: CliCommandFormat = null;

  resolveSkillsTarget(workspaceRoot: string): string | null {
    return join(workspaceRoot, '.agents', 'skills');
  }

  resolveCommandsTarget(): string | null {
    return null;
  }
}
