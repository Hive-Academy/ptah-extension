import type { DependencyContainer } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type {
  QueryOrigin,
  SkillRepropagationKind,
  SkillRepropagationPort,
} from '@ptah-extension/skill-synthesis';
import {
  HARNESS_SYNC_TOKENS,
  type HarnessPropagationService,
} from '@ptah-extension/harness-sync';

/**
 * The user-layer label of a BACKGROUND skill re-propagation (TASK_2026_437
 * FU-17b). `plugin-activation.ts` lists it in `GOVERNED_USER_LAYER_REASONS`.
 */
export const SKILL_REPROPAGATION_USER_LAYER_REASON = 'skill-repropagation';

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
 *
 * ## Who waits (TASK_2026_437 FU-17b)
 *
 * The refresh half is scheduled by its origin. A click (`userInitiated: true`)
 * names no refresh label, so the user layer refreshes as
 * `harness-propagation`, which never waits. Everything else — the curator
 * interval's auto-enhance, an auto-promotion — refreshes as
 * {@link SKILL_REPROPAGATION_USER_LAYER_REASON}, which
 * `GOVERNED_USER_LAYER_REASONS` holds while a turn is generating. Both land in
 * the same coalescer, so a click that arrives while a background pass is held
 * joins it and releases it at once. A background call returns once the
 * propagation has started; a click returns once it has finished.
 */
export class ElectronSkillRepropagation implements SkillRepropagationPort {
  constructor(private readonly container: DependencyContainer) {}

  /**
   * A click awaits the whole propagation, so its RPC reply reflects a finished
   * refresh. Background work STARTS the propagation and returns: its refresh
   * may be held by the governor for up to its ceiling, and the curator's
   * enhancement loop awaits this call once per candidate, so awaiting here
   * would stack one hold per candidate inside a single pass (b17b logic review,
   * serious 1). Nothing later in a curator pass reads the propagated harness
   * files, and repeated background requests still merge into one held pass in
   * the user-layer coalescer.
   */
  async repropagate(
    kind: SkillRepropagationKind,
    slug: string,
    workspaceRoot: string,
    origin: QueryOrigin = {},
  ): Promise<void> {
    const userInitiated = origin.userInitiated === true;
    if (userInitiated) {
      await this.propagate(kind, slug, workspaceRoot, true);
      return;
    }
    // Never rejects: `propagate` catches and logs every failure itself.
    void this.propagate(kind, slug, workspaceRoot, false);
  }

  /** The propagation itself. Never throws; a failure is logged once. */
  private async propagate(
    kind: SkillRepropagationKind,
    slug: string,
    workspaceRoot: string,
    userInitiated: boolean,
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
      await propagation.propagate(
        workspaceRoot,
        `skill-repropagation:${kind}`,
        userInitiated
          ? {}
          : { userLayerRefreshReason: SKILL_REPROPAGATION_USER_LAYER_REASON },
      );
      logger?.debug('[SkillRepropagation] Re-propagated enhanced clone', {
        kind,
        slug,
        workspaceRoot,
        userInitiated,
      });
    } catch (error: unknown) {
      logger?.warn('[SkillRepropagation] Re-propagation failed (non-fatal)', {
        kind,
        slug,
        userInitiated,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private resolveLogger(): Logger | null {
    try {
      return this.container.resolve<Logger>(TOKENS.LOGGER);
    } catch {
      // degradation-audit: optional-capability - logging is optional here; null
      // makes every call site's `logger?.` a no-op rather than turning an
      // unresolvable logger into a failed re-propagation.
      return null;
    }
  }
}
