import type { DependencyContainer } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  HARNESS_SYNC_TOKENS,
  type HarnessPropagationService,
} from '@ptah-extension/harness-sync';
import type {
  SkillRepropagationKind,
  SkillRepropagationPort,
} from '@ptah-extension/skill-synthesis';

/**
 * Push a skill, command or agent the synthesis pipeline just changed out to
 * every harness surface, from the CLI/TUI host.
 *
 * All three kinds take the same road since TASK_2026_278 Batch 2, and `'agent'`
 * is no longer a no-op. It used to be one here for a bad reason: agents were
 * distributed by a service that only the VS Code and Electron hosts wired, so
 * a `ptah tui` session that enhanced a subagent silently reached nothing. The
 * reconciler is host-agnostic, so the CLI now propagates exactly what the GUI
 * hosts do.
 *
 * Degrades safely while the CLI's async content download is still in flight: an
 * uninitialized plugin loader yields an empty overlay and an absent
 * `~/.ptah/user/skills` yields an empty desired state, which makes the pass a
 * no-op rather than a reap. Non-fatal throughout — a CLI session must never die
 * because a workspace directory was not writable.
 *
 * Boot-time reconciliation lives in `bootstrap/harness-boot.ts` and the
 * session-start preflight in `agent-sdk`'s shared path (both Batch 3); this
 * class stays the EVENT path and nothing else.
 */
export class CliSkillRepropagation implements SkillRepropagationPort {
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
          '[CliSkillRepropagation] Harness propagation not registered (no-op)',
          { kind, slug },
        );
        return;
      }

      const propagation = this.container.resolve<HarnessPropagationService>(
        HARNESS_SYNC_TOKENS.PROPAGATION,
      );
      // Propagation, not a bare reconcile: `'agent'` reads `{ws}/.claude/agents`
      // as a SOURCE and a promoted skill lands under `~/.ptah/skills/<slug>`,
      // so both are invisible to the reconciler until the user layer is
      // refreshed (Batch 3).
      const health = await propagation.propagate(
        workspaceRoot,
        `skill-repropagation:${kind}`,
      );
      if (health === null) return;

      logger?.debug('[CliSkillRepropagation] Re-propagated enhanced clone', {
        kind,
        slug,
        sources: health.sources,
        targets: health.targets
          .filter((target) => target.detected)
          .map(
            (target) => `${target.target}:${target.found}/${target.expected}`,
          ),
      });
    } catch (error: unknown) {
      logger?.warn(
        '[CliSkillRepropagation] Re-propagation failed (non-fatal)',
        {
          kind,
          slug,
          error: error instanceof Error ? error.message : String(error),
        },
      );
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
