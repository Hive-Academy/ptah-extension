import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { SKILL_SYNTHESIS_TOKENS } from './di/tokens';
import { SkillSynthesisService } from './skill-synthesis.service';
import { SkillCandidateStore } from './skill-candidate.store';
import type {
  SkillSynthesisDiagnosticsSnapshot,
  SkillSynthesisEvent,
} from './diagnostics.types';

const TRIGGER_KEYS = {
  sessionEnd: 'skillSynthesis.triggers.sessionEnd',
  idleMs: 'skillSynthesis.triggers.idleMs',
  bootScan: 'skillSynthesis.triggers.bootScan',
  subagentStopEnabled: 'skillSynthesis.triggers.subagentStop.enabled',
  postToolUseEnabled: 'skillSynthesis.triggers.postToolUse.enabled',
  postToolUseMinEditCount: 'skillSynthesis.triggers.postToolUse.minEditCount',
  maxAnalyzesPerHour: 'skillSynthesis.triggers.maxAnalyzesPerHour',
} as const;

const TRIGGER_DEFAULTS = {
  sessionEnd: true,
  idleMs: 600000,
  bootScan: true,
  subagentStopEnabled: true,
  postToolUseEnabled: true,
  postToolUseMinEditCount: 3,
  maxAnalyzesPerHour: 6,
} as const;

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
    const triggers = this.readTriggers();

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

  private readTriggers(): SkillSynthesisDiagnosticsSnapshot['triggers'] {
    const sessionEnd =
      this.workspace.getConfiguration<boolean>(
        'ptah',
        TRIGGER_KEYS.sessionEnd,
        TRIGGER_DEFAULTS.sessionEnd,
      ) ?? TRIGGER_DEFAULTS.sessionEnd;
    const idleMs =
      this.workspace.getConfiguration<number>(
        'ptah',
        TRIGGER_KEYS.idleMs,
        TRIGGER_DEFAULTS.idleMs,
      ) ?? TRIGGER_DEFAULTS.idleMs;
    const bootScan =
      this.workspace.getConfiguration<boolean>(
        'ptah',
        TRIGGER_KEYS.bootScan,
        TRIGGER_DEFAULTS.bootScan,
      ) ?? TRIGGER_DEFAULTS.bootScan;
    const subagentStopEnabled =
      this.workspace.getConfiguration<boolean>(
        'ptah',
        TRIGGER_KEYS.subagentStopEnabled,
        TRIGGER_DEFAULTS.subagentStopEnabled,
      ) ?? TRIGGER_DEFAULTS.subagentStopEnabled;
    const postToolUseEnabled =
      this.workspace.getConfiguration<boolean>(
        'ptah',
        TRIGGER_KEYS.postToolUseEnabled,
        TRIGGER_DEFAULTS.postToolUseEnabled,
      ) ?? TRIGGER_DEFAULTS.postToolUseEnabled;
    const postToolUseMinEditCount =
      this.workspace.getConfiguration<number>(
        'ptah',
        TRIGGER_KEYS.postToolUseMinEditCount,
        TRIGGER_DEFAULTS.postToolUseMinEditCount,
      ) ?? TRIGGER_DEFAULTS.postToolUseMinEditCount;
    const maxAnalyzesPerHour =
      this.workspace.getConfiguration<number>(
        'ptah',
        TRIGGER_KEYS.maxAnalyzesPerHour,
        TRIGGER_DEFAULTS.maxAnalyzesPerHour,
      ) ?? TRIGGER_DEFAULTS.maxAnalyzesPerHour;
    return {
      sessionEnd,
      idleMs,
      bootScan,
      subagentStop: { enabled: subagentStopEnabled },
      postToolUse: {
        enabled: postToolUseEnabled,
        minEditCount: postToolUseMinEditCount,
      },
      maxAnalyzesPerHour,
    };
  }
}
