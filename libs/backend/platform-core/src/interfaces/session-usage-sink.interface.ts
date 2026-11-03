/** One model's accepted turn delta. Unknown model or cost is null. */
export interface SessionUsageModelDelta {
  modelId: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  knownCostMicroUsd: number | null;
  costAuthority: 'provider-reported' | 'model-priced' | 'unpriced';
}

/** Stable identity and accepted usage from one producer event. */
export interface SessionUsageContribution {
  sessionId: string;
  producer: 'sdk-owner' | 'codex-checkpoint' | 'cli-lane';
  runId: string;
  turnId: string | null;
  eventKey: string;
  parentSessionId: string | null;
  subagentId: string | null;
  providerId: string | null;
  occurredAtMs: number;
  revision: number;
  models: SessionUsageModelDelta[];
  totalCostMicroUsd: number | null;
  totalCostAuthority: 'provider-reported' | 'model-priced' | 'unpriced';
  pricingVersion: string | null;
  /** Reprice this run from its accepted absolute cost snapshot. */
  runCostSnapshot?: boolean;
  /** Normalized workspace identity for events without a sessions row. */
  workspaceKey?: string | null;
  host?: string | null;
}

/** Host-neutral write boundary; callers handle rejection without interrupting a stream. */
export interface SessionUsageSink {
  recordUsage(contribution: SessionUsageContribution): Promise<void> | void;
  /** Wait for contributions already accepted by this sink before shutdown. */
  flush?(): Promise<void>;
}
