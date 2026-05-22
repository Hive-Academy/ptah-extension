import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { SKILL_SYNTHESIS_TOKENS } from './di/tokens';
import { SkillSynthesisService } from './skill-synthesis.service';
import { SkillCandidateStore } from './skill-candidate.store';
import { readSkillTriggers } from './triggers/skill-trigger-config';
import type {
  SkillSynthesisDiagnosticsSnapshot,
  SkillSynthesisEvent,
} from './diagnostics.types';

@injectable()
export class SkillSynthesisDiagnosticsService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE)
    private readonly synthesis: SkillSynthesisService,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE)
    private readonly store: SkillCandidateStore,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
  ) {}

  async getSnapshot(
    _workspaceRoot?: string | null,
    eventLimit = 10,
  ): Promise<SkillSynthesisDiagnosticsSnapshot> {
    const lastRun = this.synthesis.lastRunSummary();
    const recentEvents: readonly SkillSynthesisEvent[] =
      this.synthesis.recentEvents(eventLimit);
    const histogram = this.synthesis.getEligibilityHistogram();
    const stats = this.readStats();
    const triggers = readSkillTriggers(this.workspace);

    return {
      lastAnalyzeRunAt: lastRun.lastAnalyzeRunAt,
      lastCuratorPassAt: lastRun.lastCuratorPassAt,
      eligibilityHistogram: histogram,
      byStatus: stats,
      recentEvents,
      triggers,
    };
  }

  private readStats(): SkillSynthesisDiagnosticsSnapshot['byStatus'] {
    try {
      const s = this.store.getStats();
      return {
        candidate: s.candidates,
        promoted: s.promoted,
        rejected: s.rejected,
        invocations: s.invocations,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn('[skill-synthesis] diagnostics getStats failed', {
        error: message,
      });
      return { candidate: 0, promoted: 0, rejected: 0, invocations: 0 };
    }
  }
}
