/**
 * Antigravity (agy) CLI Skill Installer
 *
 * Workspace targets (bare-name, single identity):
 * - skills:   {ws}/.agents/skills/{slug}/SKILL.md  (agy's NATIVE workspace root)
 * - commands: SKIPPED — agy has no custom slash-command surface (only
 *             Rules/Skills/Plugins/Hooks/MCP exist per agy's customization docs)
 *
 * `.agents/skills` is agy's native workspace customization root — verified that
 * `agy` discovers skills there. This is the SAME directory Codex writes to; the
 * base class's `.ptah-managed.json` manifest + content-hash dedupe keep Ptah
 * skill dirs idempotent and let the two coexist without clobbering each other.
 */

import { join } from 'path';
import type { CliCommandFormat } from './cli-skill-installer.interface';
import { WorkspaceSkillInstaller } from './workspace-skill-installer.base';

export class AntigravitySkillInstaller extends WorkspaceSkillInstaller {
  readonly target = 'antigravity' as const;
  readonly commandFormat: CliCommandFormat = null;

  resolveSkillsTarget(workspaceRoot: string): string | null {
    return join(workspaceRoot, '.agents', 'skills');
  }

  resolveCommandsTarget(): string | null {
    return null;
  }
}
