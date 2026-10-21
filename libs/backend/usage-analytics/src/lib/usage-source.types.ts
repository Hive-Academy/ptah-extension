import type { UsageSourceStatus } from '@ptah-extension/shared';

export interface UsageContribution {
  readonly key: string;
  readonly timestampMs: number;
  readonly providerId: string;
  readonly modelId: string;
  readonly inputUncachedTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly outputTokens: number;
  readonly reportedCostUsd?: number;
  readonly requestCount?: number;
  readonly sourceId: string;
  readonly sessionId?: string;
  readonly sessionTitle?: string;
  readonly subagentId?: string;
  readonly modelProviderId?: string;
  readonly workspaceRoot?: string;
}

export interface UsageSourceResult {
  readonly contributions: readonly UsageContribution[];
  readonly status: UsageSourceStatus;
}

export interface UsageSource {
  read(workspacePath: string, since: number, until: number, signal?: AbortSignal): Promise<UsageSourceResult>;
}
