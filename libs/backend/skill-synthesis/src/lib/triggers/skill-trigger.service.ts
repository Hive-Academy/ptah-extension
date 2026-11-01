import { inject, injectable } from 'tsyringe';
import { blankToUndefined } from '@ptah-extension/shared';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS, type IFileSystemProvider, type IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  SDK_TOKENS,
  type SubagentStopCallbackRegistry,
  type SubagentStopPayload,
  type PostToolUseCallbackRegistry,
  type PostToolUsePayload,
  type UserPromptExpansionCallbackRegistry,
  type UserPromptExpansionPayload,
  type StopCallbackRegistry,
  type StopPayload,
} from '@ptah-extension/agent-sdk';
import { deriveWorkspaceFingerprint } from '@ptah-extension/memory-curator';
import { SKILL_SYNTHESIS_TOKENS } from '../di/tokens';
import { SkillInvocationRecorder } from '../skill-invocation-recorder';
import { SpecHarvesterService } from '../spec-harvester.service';
import type { SubagentMetricsExtractor, ExtractedSubagentRun } from '../subagent-metrics-extractor';
import type { SubagentRunMetrics } from '../types';

const HARVEST_DEBOUNCE_MS = 90 * 1000;

@injectable()
export class SkillTriggerService {
  private started = false;
  private subagentStopDisposer: (() => void) | null = null;
  private postToolUseDisposer: (() => void) | null = null;
  private userPromptExpansionDisposer: (() => void) | null = null;
  private stopDisposer: (() => void) | null = null;
  private readonly harvestTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: IFileSystemProvider,
    @inject(SDK_TOKENS.SDK_SUBAGENT_STOP_CALLBACK_REGISTRY)
    private readonly subagentStopRegistry: SubagentStopCallbackRegistry,
    @inject(SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY)
    private readonly postToolUseRegistry: PostToolUseCallbackRegistry,
    @inject(SDK_TOKENS.SDK_USER_PROMPT_EXPANSION_REGISTRY)
    private readonly userPromptExpansionRegistry: UserPromptExpansionCallbackRegistry,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_INVOCATION_RECORDER)
    private readonly recorder: SkillInvocationRecorder,
    @inject(SDK_TOKENS.SDK_STOP_CALLBACK_REGISTRY)
    private readonly stopRegistry: StopCallbackRegistry,
    @inject(SKILL_SYNTHESIS_TOKENS.SPEC_HARVESTER_SERVICE)
    private readonly harvester: SpecHarvesterService,
    @inject(SKILL_SYNTHESIS_TOKENS.SUBAGENT_METRICS_EXTRACTOR)
    private readonly metricsExtractor: SubagentMetricsExtractor,
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.subagentStopDisposer = this.subagentStopRegistry.register((payload) => {
      this.onSubagentStop(payload);
    });
    this.postToolUseDisposer = this.postToolUseRegistry.register((payload) => {
      this.onPostToolUse(payload);
    });
    this.userPromptExpansionDisposer =
      this.userPromptExpansionRegistry.register((payload) => {
        this.onUserPromptExpansion(payload);
      });
    this.stopDisposer = this.stopRegistry.register((payload) => {
      this.onStop(payload);
    });
    this.logger.info('[skill-synthesis] trigger service started');
  }

  stop(): void {
    if (!this.started) return;
    this.subagentStopDisposer?.();
    this.postToolUseDisposer?.();
    this.userPromptExpansionDisposer?.();
    this.stopDisposer?.();
    this.subagentStopDisposer = null;
    this.postToolUseDisposer = null;
    this.userPromptExpansionDisposer = null;
    this.stopDisposer = null;
    for (const timer of this.harvestTimers.values()) clearTimeout(timer);
    this.harvestTimers.clear();
    this.started = false;
    this.logger.info('[skill-synthesis] trigger service stopped');
  }

  private onStop(payload: StopPayload): void {
    if (blankToUndefined(payload.workspaceRoot)) {
      this.scheduleHarvest(payload.workspaceRoot);
    }
  }

  private onSubagentStop(payload: SubagentStopPayload): void {
    if (
      this.readSkillInvocationTelemetryEnabled() &&
      payload.agentType &&
      payload.subagentSessionId &&
      payload.transcriptPath &&
      payload.workspaceRoot
    ) {
      void this.recordInvocation({
        slug: payload.agentType,
        sessionId: payload.parentSessionId || payload.subagentSessionId,
        workspaceRoot: payload.workspaceRoot,
        isError: false,
        invokedAt: payload.timestamp,
        source: 'subagent',
        runId: payload.agentId,
        transcriptPath: payload.transcriptPath,
      });
    }
  }

  private onPostToolUse(payload: PostToolUsePayload): void {
    if (!this.readSkillInvocationTelemetryEnabled()) return;
    if (blankToUndefined(payload.sessionId) === undefined) return;
    if (payload.toolName === 'Skill') {
      const slug = this.extractSkillSlug(payload.toolInput);
      if (slug) void this.recordInvocation({
        slug,
        sessionId: payload.sessionId,
        workspaceRoot: payload.workspaceRoot,
        isError: !payload.success,
        invokedAt: payload.timestamp,
        source: 'tool-use',
      });
    } else if (payload.toolName === 'Task') {
      const slug = this.extractSubagentType(payload.toolInput);
      if (slug) void this.recordInvocation({
        slug,
        sessionId: payload.sessionId,
        workspaceRoot: payload.workspaceRoot,
        isError: !payload.success,
        invokedAt: payload.timestamp,
        source: 'subagent',
      });
    }
  }
  private scheduleHarvest(workspaceRoot: string): void {
    const pending = this.harvestTimers.get(workspaceRoot);
    if (pending) clearTimeout(pending);
    this.harvestTimers.set(
      workspaceRoot,
      setTimeout(() => {
        this.harvestTimers.delete(workspaceRoot);
        void this.fireHarvest(workspaceRoot);
      }, HARVEST_DEBOUNCE_MS),
    );
  }

  private async fireHarvest(workspaceRoot: string): Promise<void> {
    // Capture task specs independently of invocation telemetry.
    try {
      await this.harvester.harvest(workspaceRoot);
    } catch (error: unknown) {
      this.logger.debug('[skill-synthesis] spec harvest failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  private onUserPromptExpansion(payload: UserPromptExpansionPayload): void {
    if (!this.readSkillInvocationTelemetryEnabled()) return;
    if (!payload.skillSlug || payload.skillSlug.length === 0) return;
    if (blankToUndefined(payload.sessionId) === undefined) return;
    void this.recordInvocation({
      slug: payload.skillSlug,
      sessionId: payload.sessionId,
      workspaceRoot: payload.workspaceRoot,
      isError: false,
      invokedAt: payload.timestamp,
      source: payload.expansionType === 'slash_command' ? 'slash-command' : 'prompt-expansion',
    });
  }

  private async recordInvocation(input: {
    slug: string;
    sessionId: string;
    workspaceRoot: string;
    isError: boolean;
    invokedAt: number;
    source: 'tool-use' | 'slash-command' | 'prompt-expansion' | 'subagent';
    runId?: string;
    /**
     * Subagent transcript path (SubagentStop only). When present, per-invocation
     * metrics + exact task_id are derived here â€” off the hot path. Extraction
     * failure never aborts the invocation record (metrics stay all-null).
     */
    transcriptPath?: string;
  }): Promise<void> {
    try {
      let contextId: string | null = null;
      try {
        const { fp } = await deriveWorkspaceFingerprint(
          input.workspaceRoot,
          this.fs,
        );
        contextId = fp;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          '[skill-synthesis] fingerprint failed for skill event',
          { source: input.source, error: message },
        );
      }

      let metrics: SubagentRunMetrics | null = null;
      let taskId: string | null = null;
      if (input.transcriptPath) {
        try {
          const extracted: ExtractedSubagentRun =
            await this.metricsExtractor.extract(input.transcriptPath);
          metrics = extracted.metrics;
          taskId = extracted.taskId;
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            '[skill-synthesis] subagent metrics extraction failed',
            { source: input.source, error: message },
          );
        }
      }

      this.recorder.recordSkillEvent({
        slug: input.slug,
        runId: input.runId ?? null,
        sessionId: input.sessionId,
        workspaceRoot: input.workspaceRoot,
        contextId,
        isError: input.isError,
        invokedAt: input.invokedAt,
        source: input.source,
        metrics,
        taskId,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('[skill-synthesis] recordInvocation failed', {
        source: input.source,
        error: message,
      });
    }
  }

  private extractSkillSlug(toolInput: unknown): string | null {
    if (
      typeof toolInput !== 'object' ||
      toolInput === null ||
      !('command' in toolInput)
    ) {
      return null;
    }
    const command = (toolInput as { command?: unknown }).command;
    if (typeof command !== 'string') return null;
    const first = command.trim().split(/\s+/)[0] ?? '';
    const slug = first.startsWith('/') ? first.slice(1) : first;
    return slug.length > 0 ? slug : null;
  }

  private extractSubagentType(toolInput: unknown): string | null {
    if (
      typeof toolInput !== 'object' ||
      toolInput === null ||
      !('subagent_type' in toolInput)
    ) {
      return null;
    }
    const raw = (toolInput as { subagent_type?: unknown }).subagent_type;
    if (typeof raw !== 'string') return null;
    const slug = raw.trim();
    return slug.length > 0 ? slug : null;
  }

  private readSkillInvocationTelemetryEnabled(): boolean {
    const enabled = this.workspace.getConfiguration<boolean>(
      'ptah',
      'skills.telemetry.enabled',
      true,
    );
    return typeof enabled === 'boolean' ? enabled : true;
  }
}