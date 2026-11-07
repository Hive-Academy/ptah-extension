import type {
  AgentId,
  AgentProcessInfo,
  AgentResumeOutcome,
} from '@ptah-extension/shared';

export interface LaneResumeResult {
  readonly agentId: AgentId;
  readonly cliSessionId?: string;
  readonly resumeDecision?: AgentResumeOutcome;
}

export interface LaneResumer {
  resume(info: AgentProcessInfo, task: string): Promise<LaneResumeResult>;
}

export class LaneResumeError extends Error {
  constructor(
    readonly code: 'no-session' | 'spawn-failed',
    message: string,
  ) {
    super(message);
    this.name = 'LaneResumeError';
  }
}
