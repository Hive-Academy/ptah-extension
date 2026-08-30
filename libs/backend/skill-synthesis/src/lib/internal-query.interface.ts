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
  /**
   * Whether the host initialized its SDK at all. Optional, and absent means
   * "assume yes" — a double that does not implement it keeps today's behaviour.
   *
   * ## Registered is NOT the same as usable
   *
   * `LaneRunnerService` used to read "there is no LLM in this host" off the DI
   * registration alone (`!this.internalQuery`). That is true of a host which
   * never registers `agent-sdk` and FALSE of the CLI, which registers it on
   * every `withEngine({ mode: 'full' })` boot and then passes
   * `requireSdk: false` so `SdkAgentAdapter.initialize()` never runs — the
   * documented posture for `doctor`, the auth/config bootstrap verbs and
   * `skill-synthesis`, all of which must work before any credentials exist.
   * `execute` then throws on every call, which reaches `SkillJudgeService` as
   * `judge-call-threw` (an `unscored` verdict), so `ptah skill-synthesis
   * promote` answered `judge-unscored` and exited 2 on a host that simply has
   * no judge to run — the exact outcome `unavailable` exists to prevent.
   *
   * `false` means NEVER INITIALIZED, not "currently failing": an SDK that
   * initialized and errored still answers `true`, so a real transport fault
   * stays a retryable `SkillLaneFailure` instead of being downgraded to "no LLM
   * here" and dropped.
   */
  isInitialized?(): boolean;

  execute(config: {
    cwd: string;
    model: string;
    prompt: string;
    systemPromptAppend?: string;
    mcpServerRunning: boolean;
    /**
     * The port the in-process MCP server is ACTUALLY listening on, when it is.
     *
     * Optional because a host with no MCP server has no port, but omitting it
     * on a host that HAS one is not free: the consumer then falls back to the
     * `PTAH_MCP_PORT` default, and the server binds an OS-assigned port
     * whenever the configured one is taken (EACCES under Hyper-V,
     * EADDRINUSE) — precisely on the machines that needed the fallback. Both
     * fields come from `resolveMcpSessionWiring` so they cannot disagree.
     */
    mcpPort?: number;
    maxTurns: number;
    /**
     * Concurrency lane. The consumer holds a per-lane ceiling as well as a
     * global one, so naming a lane is what stops this library's background
     * calls from serialising into the memory curator's and back — nine such
     * waits on one boot (`tmp/logs/log.log:938 … 1424`), TASK_2026_352.
     *
     * Optional in this mirror because it is optional on the concrete
     * `InternalQueryConfig`; omitting it charges the call to the shared
     * `'default'` bucket, which is the pre-existing behaviour.
     */
    lane?: string;
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
