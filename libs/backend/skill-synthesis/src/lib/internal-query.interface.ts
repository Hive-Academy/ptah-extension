/**
 * Minimal interface for one-shot text generation via InternalQueryService.
 *
 * Defined here (not imported from agent-sdk) to avoid a circular dependency.
 * The SDK token `Symbol.for('SdkInternalQueryService')` resolves to the
 * concrete implementation at runtime.
 *
 * Both SkillPromotionService and SkillJudgeService share this interface.
 *
 * ## Keep this file LOCAL, and keep it a SUBSET
 *
 * It is not a copy of agent-sdk's `InternalQueryConfig`; it is the part of it
 * this library uses. Widening it is only safe while the concrete service still
 * accepts the wider shape, which for the fields below it verifiably does:
 * `InternalQueryConfig` already declares `outputFormat?: OutputFormat` and
 * `auth?: OneShotAuthOverride`, and `InternalQueryService.execute` is a pure
 * field-by-field forward to `SdkQueryRunner.runOneShot`. The three stream
 * fields are read off the `result` message today in `sdk-stream-processor.ts`.
 *
 * Everything is optional so no existing caller or test double breaks.
 */
import type { LaneAuthOverride } from './lanes/lane.types';

export interface IInternalQuery {
  execute(config: {
    cwd: string;
    model: string;
    prompt: string;
    systemPromptAppend?: string;
    mcpServerRunning: boolean;
    maxTurns: number;
    abortController?: AbortController;
    /**
     * Per-call provider snapshot. MUST NOT be applied globally — the consumer
     * reads `input.auth?.env ?? this.authEnv` and never writes `process.env`
     * or the injected `AuthEnv`. That read-only property is the whole reason
     * a lane hands over a value instead of calling
     * `ProviderModelsService.applyPersistedTiers`, which writes both with no
     * scope guard (risk R1).
     */
    auth?: LaneAuthOverride;
    /**
     * JSON-Schema constrained output. The SDK retries invalid output itself,
     * so a lane that declares `structuredOutput: 'sdk'` gets parse retries for
     * free. A lane whose endpoint ignores this degrades to the manual
     * extractors — which is why those extractors are load-bearing, not dead
     * code.
     */
    outputFormat?: {
      readonly type: 'json_schema';
      readonly schema: Record<string, unknown>;
    };
  }): Promise<{
    stream: AsyncIterable<{
      type: string;
      subtype?: string;
      message?: { content?: Array<{ type: string; text?: string }> };
      /**
       * Present on the `result` message when `outputFormat` was honoured. Its
       * ABSENCE on a lane that declared `'sdk'` is the detection signal for
       * `structured-output-unsupported`, so it must stay distinguishable from
       * a present-but-null value.
       */
      structured_output?: unknown;
      result?: string;
      /** Fed to `SkillBudgetStore`; absent on providers that report no usage. */
      usage?: { input_tokens?: number; output_tokens?: number };
      total_cost_usd?: number;
    }>;
    abort(): void;
    close(): void;
  }>;
}
