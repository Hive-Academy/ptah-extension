/**
 * HarnessSkillInstallService.
 *
 * Installs the skills.sh skills recorded on a harness config when the harness
 * is applied, through the same source-root path that backs `skillsSh:install`.
 * Before this existed, installation depended on the designing agent choosing to
 * shell out to the CLI itself — which silently did nothing whenever the agent
 * had no Bash tool (restricted Electron sessions).
 *
 * A selected skill is only installable when the design recorded a ref carrying
 * its `installSource` (the `owner/repo` slug the skills.sh search result
 * exposes). Refs the agent tagged `skills.sh` without one are reported back as
 * warnings, so the caller tells the user to install them by hand rather than
 * silently implying they were wired up. Local skills are skipped — they are
 * already on disk and the apply flow propagates them.
 *
 * DESTINATION NOTE (changed by TASK_2026_288). This used to shell
 * `npx skills add --agent claude-code`, landing the skill in
 * `{ws}/.claude/skills` and calling the re-homing question out of scope. It was
 * not out of scope, it was the defect: `.claude/skills` is a MANAGED directory,
 * so every skill `harness:apply` installed reached Claude alone AND was
 * reported `foreign` by `ptah harness doctor` forever. Both call sites now land
 * in `~/.ptah/plugins/ptah-skillssh-*`, which is ordinary overlay source state.
 *
 * `ref.scope` is likewise no longer read. There is no project-scoped source
 * root in the reconciler's model — see `SKILLS_SH_SCOPE`.
 *
 * This service does NOT propagate. `harness:apply` reconciles once at the end
 * of its own flow, and a per-skill propagate inside this loop would be N
 * directory walks for one user action.
 */

import { inject, injectable } from 'tsyringe';
import * as path from 'path';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { type HarnessSkillRef } from '@ptah-extension/shared';

import { SkillsShSourceRootService } from '../../skills-sh/skills-sh-source-root.service';

/** Paths written and problems encountered while installing harness skills. */
export interface HarnessSkillInstallOutcome {
  installedPaths: string[];
  warnings: string[];
}

type InstallableRef = HarnessSkillRef & { installSource: string };

@injectable()
export class HarnessSkillInstallService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SkillsShSourceRootService)
    private readonly sourceRoots: SkillsShSourceRootService,
  ) {}

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

    // Legacy skills sitting in this workspace's `.claude/skills` are adopted
    // first, so a re-apply of the same harness updates the source root rather
    // than racing an unowned copy of the same slug into `blocked`.
    await this.adoptLegacy(workspaceRoot);

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
      try {
        const result = await this.sourceRoots.install({
          source: ref.installSource.trim(),
          skillId: ref.skillId,
        });

        if (!result.success) {
          outcome.warnings.push(
            `Failed to install skill "${ref.skillId}" from ${ref.installSource}: ${
              result.error ?? 'unknown error'
            }`,
          );
          continue;
        }

        // Every slug the run actually wrote, reported at its source-root path.
        // The CLI does not print where it wrote and a repo's directory name
        // need not equal the skill id, so this is read back from disk rather
        // than predicted — the reason the old code had to probe and fall back.
        const rootSkillsDir = path.join(
          this.sourceRoots.pluginsBasePath,
          result.rootId,
          'skills',
        );
        for (const slug of result.slugs) {
          outcome.installedPaths.push(path.join(rootSkillsDir, slug));
        }
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

    // A whole-repo install reports several slugs, and two refs from the same
    // repo overlap; report each written path once.
    return {
      installedPaths: Array.from(new Set(outcome.installedPaths)),
      warnings: outcome.warnings,
    };
  }

  /** Non-fatal: a failed sweep must not fail the harness the user just applied. */
  private async adoptLegacy(workspaceRoot: string | undefined): Promise<void> {
    try {
      await this.sourceRoots.adoptLegacyInstalls(workspaceRoot);
    } catch (error: unknown) {
      this.logger.warn('RPC: harness:apply legacy skill adoption failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
