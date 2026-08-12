/**
 * HarnessSkillInstallService.
 *
 * Installs the skills.sh skills recorded on a harness config when the harness
 * is applied, reusing the same `npx skills add` invocation that backs the
 * `skillsSh:install` RPC. Before this existed, installation depended on the
 * designing agent choosing to shell out to the CLI itself — which silently did
 * nothing whenever the agent had no Bash tool (restricted Electron sessions).
 *
 * A selected skill is only installable when the design recorded a ref carrying
 * its `installSource` (the `owner/repo` slug the skills.sh search result
 * exposes). Refs the agent tagged `skills.sh` without one are reported back as
 * warnings, so the caller tells the user to install them by hand rather than
 * silently implying they were wired up. Local skills are skipped — they are
 * already on disk and get junctioned by the apply flow.
 *
 * Scope note: `--agent claude-code` lands the skill in `<workspace>/.claude/skills`
 * (or `~/.claude/skills` for global scope), which Claude Code discovers
 * natively. Ptah's own `SkillJunctionService` does not source from there, and
 * re-homing these skills is deliberately out of scope: the win is deterministic,
 * tracked installation, not a change of destination.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  HARNESS_DEFAULT_SKILL_SCOPE,
  type HarnessSkillRef,
} from '@ptah-extension/shared';

import { installSkillViaCli } from '../../utils/skills-sh-cli';

/** Paths written and problems encountered while installing harness skills. */
export interface HarnessSkillInstallOutcome {
  installedPaths: string[];
  warnings: string[];
}

type InstallableRef = HarnessSkillRef & { installSource: string };

@injectable()
export class HarnessSkillInstallService {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  async installSkills(
    refs: HarnessSkillRef[] | undefined,
    workspaceRoot: string | undefined,
  ): Promise<HarnessSkillInstallOutcome> {
    const outcome: HarnessSkillInstallOutcome = {
      installedPaths: [],
      warnings: [],
    };

    const marketplaceRefs = (refs ?? []).filter(
      (ref) => ref.source === 'skills.sh',
    );
    if (marketplaceRefs.length === 0) return outcome;

    const installable = marketplaceRefs.filter(
      (ref): ref is InstallableRef =>
        typeof ref.installSource === 'string' &&
        ref.installSource.trim().length > 0,
    );
    for (const ref of marketplaceRefs) {
      if (!ref.installSource || ref.installSource.trim().length === 0) {
        outcome.warnings.push(
          `Skill "${ref.skillId}" came from skills.sh but no installSource ("owner/repo") was recorded, so it was not installed. Install it from the Skills marketplace.`,
        );
      }
    }

    for (const ref of installable) {
      const scope = ref.scope ?? HARNESS_DEFAULT_SKILL_SCOPE;
      if (scope === 'project' && !workspaceRoot) {
        outcome.warnings.push(
          `No workspace folder open. Skill "${ref.skillId}" was not installed.`,
        );
        continue;
      }

      try {
        const result = await installSkillViaCli(
          {
            source: ref.installSource.trim(),
            skillId: ref.skillId,
            scope,
          },
          workspaceRoot,
        );

        if (!result.success) {
          outcome.warnings.push(
            `Failed to install skill "${ref.skillId}" from ${ref.installSource}: ${
              result.error ?? 'unknown error'
            }`,
          );
          continue;
        }

        outcome.installedPaths.push(
          await this.resolveInstalledPath(ref.skillId, scope, workspaceRoot),
        );
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        outcome.warnings.push(
          `Failed to install skill "${ref.skillId}": ${msg}`,
        );
        this.logger.error(
          `RPC: harness:apply skill install failed for "${ref.skillId}"`,
          error instanceof Error ? error : new Error(msg),
        );
      }
    }

    // Several skills from the same repo land under one skills directory when
    // the CLI names the directory differently than the skill id; report each
    // written path once.
    return {
      installedPaths: Array.from(new Set(outcome.installedPaths)),
      warnings: outcome.warnings,
    };
  }

  /**
   * Resolve the path to report for a freshly installed skill.
   *
   * The CLI does not print where it wrote, and the on-disk directory name is
   * not guaranteed to equal the skill id, so probe for the exact directory and
   * fall back to the skills root — never report a path that does not exist.
   */
  private async resolveInstalledPath(
    skillId: string,
    scope: 'project' | 'global',
    workspaceRoot: string | undefined,
  ): Promise<string> {
    const base =
      scope === 'global' || !workspaceRoot
        ? path.join(os.homedir(), '.claude', 'skills')
        : path.join(workspaceRoot, '.claude', 'skills');
    const skillPath = path.join(base, skillId);
    try {
      await fs.access(skillPath);
      return skillPath;
    } catch {
      return base;
    }
  }
}
