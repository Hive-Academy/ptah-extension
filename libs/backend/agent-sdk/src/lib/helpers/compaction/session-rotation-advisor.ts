/**
 * SessionRotationAdvisor (TASK_2026_597 A6, rebuilt on N8 by Wave D D.3).
 *
 * Suggests rotating to a fresh session once the session's context reaches
 * `compaction.rotationSuggestTokens`. The advisory is raised once per upward
 * crossing (one INFO line) and stays in force while the context is at or above
 * the threshold, so every published budget state carries it until it clears.
 * It clears, and re-arms, as soon as a reading is below the threshold (for
 * example after a compaction); the next crossing raises it again.
 *
 * Context figure: the context-usage port's last cached reading
 * (`getLast(sessionId)`); when the port has no reading for the session yet,
 * the caller's fallback (the stats snapshot's last-turn context). Without the
 * port the advisor is off: no advisory, one log line at construction.
 *
 * Ordering (R-W4, accepted): the budget may observe a result before the
 * turn-end port read lands, so the reading used can be the previous turn's
 * and the advisory can arrive one turn late.
 *
 * State is one map entry per session with an advisory in force, dropped by
 * `release` on session end. No timers, no polling.
 */
import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { SessionBudgetRotation } from '@ptah-extension/shared';
import { SDK_TOKENS } from '../../di/tokens';
import type { CompactionConfigProvider } from '../compaction-config-provider';
import type { IContextUsagePort } from './context-usage.port';

/** The compaction settings the advisor reads. */
export type SessionRotationConfigSource = Pick<
  CompactionConfigProvider,
  'getConfig'
>;

/** The part of the context-usage port the advisor reads. */
export type SessionRotationContextSource = Pick<IContextUsagePort, 'getLast'>;

@injectable()
export class SessionRotationAdvisor {
  /** Sessions whose advisory is in force (crossed and not yet re-armed). */
  private readonly raised = new Map<string, SessionBudgetRotation>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_COMPACTION_CONFIG_PROVIDER)
    private readonly config: SessionRotationConfigSource,
    /** Absent on a host that does not register the port: the advisor is off. */
    @inject(SDK_TOKENS.SDK_CONTEXT_USAGE_PORT, { isOptional: true })
    private readonly contextUsage?: SessionRotationContextSource,
  ) {
    if (!this.contextUsage) {
      this.logger.info(
        '[SessionRotationAdvisor] Context usage port not registered; rotation advisories are off',
      );
    }
  }

  /**
   * Update the session's advisory from its latest context figure and return
   * the advisory in force, if any. With no figure at all the previous answer
   * stands (nothing new to decide on).
   */
  evaluate(
    sessionId: string,
    fallbackContextTokens: number | undefined,
  ): SessionBudgetRotation | undefined {
    if (!this.contextUsage) return undefined;
    const contextTokens =
      this.contextUsage.getLast(sessionId)?.totalTokens ??
      fallbackContextTokens;
    if (contextTokens === undefined || !Number.isFinite(contextTokens)) {
      return this.raised.get(sessionId);
    }

    const threshold = this.config.getConfig().rotationSuggestTokens;
    if (contextTokens < threshold) {
      // Below the threshold: clear and re-arm for the next crossing.
      this.raised.delete(sessionId);
      return undefined;
    }

    const advisory: SessionBudgetRotation = { contextTokens, threshold };
    if (!this.raised.has(sessionId)) {
      this.logger.info(
        `[SessionRotationAdvisor] Rotation suggested for ${sessionId}`,
        { contextTokens, threshold },
      );
    }
    this.raised.set(sessionId, advisory);
    return advisory;
  }

  /** The advisory in force for the session, without re-reading anything. */
  current(sessionId: string): SessionBudgetRotation | undefined {
    return this.raised.get(sessionId);
  }

  /** Session end: drop the session's advisory. */
  release(sessionId: string): void {
    this.raised.delete(sessionId);
  }
}
