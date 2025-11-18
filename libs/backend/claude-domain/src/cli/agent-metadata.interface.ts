/**
 * Agent Metadata for Task Tool Tracking
 */
export interface AgentMetadata {
  readonly agentId: string;
  readonly subagentType: string;
  readonly description: string;
  readonly prompt: string;
  readonly model?: string;
  readonly startTime: number;
}
