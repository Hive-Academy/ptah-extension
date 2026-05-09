/**
 * Minimal interface for one-shot text generation via InternalQueryService.
 *
 * Defined here (not imported from agent-sdk) to avoid a circular dependency.
 * The SDK token `Symbol.for('SdkInternalQueryService')` resolves to the
 * concrete implementation at runtime.
 *
 * Both SkillPromotionService and SkillJudgeService share this interface.
 */
export interface IInternalQuery {
  execute(config: {
    cwd: string;
    model: string;
    prompt: string;
    systemPromptAppend?: string;
    isPremium: boolean;
    mcpServerRunning: boolean;
    maxTurns: number;
    abortController?: AbortController;
  }): Promise<{
    stream: AsyncIterable<{
      type: string;
      message?: { content?: Array<{ type: string; text?: string }> };
    }>;
    abort(): void;
    close(): void;
  }>;
}
