export type AgentCategory = 'orchestrator' | 'specialist' | 'lane';

export interface TaskAgentTarget {
  readonly id: string;
  readonly name: string;
  readonly category: AgentCategory;
  readonly description?: string;
  readonly role?: string;
  readonly cli?: string;
}

/** Payload emitted when a board surface starts or assigns a task. */
export interface TaskStartRequest {
  readonly taskId: string;
  readonly isolate: boolean;
  readonly targetAgent?: TaskAgentTarget;
}
