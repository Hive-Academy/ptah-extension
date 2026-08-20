import type { DependencyContainer } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type {
  SkillRepropagationKind,
  SkillRepropagationPort,
} from '@ptah-extension/skill-synthesis';
import {
  HARNESS_SYNC_TOKENS,
  type HarnessPropagationService,
} from '@ptah-extension/harness-sync';

/**
 * Push a skill, command or agent the synthesis pipeline just changed out to
 * every harness surface, in this host, now.
 *
 * All three kinds travel the SAME road since TASK_2026_278 Batch 2. They used
 * to travel three: skills and commands went through `CliPluginSyncService` and
 * then a separate Claude-side pass, while `'agent'` went through
 * `MultiCliAgentWriterService` with its own CLI detection and its own hash
 * gate. One reconcile now covers Claude and every rival CLI, for every artifact
 * family, under one manifest — so this class no longer has to know which kind
 * reaches which tool.
 *
 * Batch 3 moved it from a bare reconcile onto `HarnessPropagationService`,
 * which refreshes the user layer first. That is not cosmetic, and `'agent'` is
 * why: `{ws}/.claude/agents` is a SOURCE the mirror reads FROM, so an enhanced
 * agent file had changed nothing the reconciler could see and the pass
 * propagated the pre-enhancement content while reporting success. Skills have
 * the same shape through `~/.ptah/skills/<slug>` after a promotion.
 *
 * The pass is idempotent: an event that changed nothing costs a directory walk
 * and a hash compare, which is why it is safe to fire on every kind rather than
 * trying to be clever about which surfaces a given change could possibly touch.
 */
export class ElectronSkillRepropagation implements SkillRepropagationPort {
  constructor(private readonly container: DependencyContainer) {}

  async repropagate(
    kind: SkillRepropagationKind,
    slug: string,
    workspaceRoot: string,
  ): Promise<void> {
    const logger = this.resolveLogger();
    try {
      if (!this.container.isRegistered(HARNESS_SYNC_TOKENS.PROPAGATION)) {
        logger?.debug(
          '[SkillRepropagation] Harness propagation not registered',
          {
            kind,
            slug,
          },
        );
        return;
      }
      const propagation = this.container.resolve<HarnessPropagationService>(
        HARNESS_SYNC_TOKENS.PROPAGATION,
      );
      await propagation.propagate(workspaceRoot, `skill-repropagation:${kind}`);
      logger?.debug('[SkillRepropagation] Re-propagated enhanced clone', {
        kind,
        slug,
        workspaceRoot,
      });
    } catch (error: unknown) {
      logger?.warn('[SkillRepropagation] Re-propagation failed (non-fatal)', {
        kind,
        slug,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private resolveLogger(): Logger | null {
    try {
      return this.container.resolve<Logger>(TOKENS.LOGGER);
    } catch {
      return null;
    }
  }
}
