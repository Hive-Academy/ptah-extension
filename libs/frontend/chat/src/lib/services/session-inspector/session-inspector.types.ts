import type {
  TaskSpecDetail,
  TaskStatus,
  TodoItem,
} from '@ptah-extension/shared';
import type { TaskStage } from '@ptah-extension/tasks-ui/presentation';
import type { SessionAgent } from '../session-agents/session-agent-roster';

/** Load state of one inspector section. */
export type SectionStatus = 'loading' | 'ready' | 'partial' | 'unknown' | 'error';

export interface SectionState<T> {
  readonly status: SectionStatus;
  readonly data: T | null;
  readonly error?: string;
}

/** One open permission or question request, attributed to its owner. */
export interface InspectorRequest {
  readonly requestId: string;
  readonly kind: 'permission' | 'question';
  /** `session`: SDK permission / question; `lane`: a CLI lane's queue. */
  readonly source: 'session' | 'lane';
  /** `'orchestrator'` or the owner's `laneKey` (`sub:` / `cli:` / `bg:`). */
  readonly ownerKey: string;
  readonly ownerName: string;
  /** The CLI lane's agent id for a lane request; `null` otherwise. */
  readonly agentId: string | null;
  readonly toolName: string | null;
  /** Full request text, never truncated. */
  readonly command: string;
  /** First 60 characters of the first question; `null` for permissions. */
  readonly questionPreview: string | null;
  readonly timestamp: number;
}

export interface InspectorAgentRow {
  readonly agent: SessionAgent;
  readonly requests: readonly InspectorRequest[];
}

export type OrchestratorState =
  | { readonly kind: 'working' }
  | { readonly kind: 'waiting'; readonly agents: number }
  | { readonly kind: 'needs-you' }
  | { readonly kind: 'idle' };

/** Unknown numbers stay `null`; templates print `—`, never `0`. */
export interface OrchestratorCardModel {
  readonly model: string | null;
  readonly state: OrchestratorState;
  readonly contextPercent: number | null;
  readonly contextWindow: number | null;
  readonly tokens: number | null;
  readonly cost: number | null;
  readonly turns: number | null;
  /** Orchestrator-owned requests, FIFO. */
  readonly requests: readonly InspectorRequest[];
}

export interface InspectorAgentsData {
  readonly rows: readonly InspectorAgentRow[];
  readonly active: number;
  readonly finished: number;
}

export interface SessionInspectorModel {
  readonly tabId: string;
  readonly sessionId: string | null;
  readonly orchestrator: OrchestratorCardModel;
  readonly agents: SectionState<InspectorAgentsData>;
  /** Every open request of the session, unique by id, FIFO. */
  readonly requests: readonly InspectorRequest[];
  /** Unique open request ids + `waiting` lanes with no open request. */
  readonly needsYouCount: number;
}

// Inspector-only section models: computed by the deferred inspector sections
// under the same `SectionState` contract.

export interface TaskSectionData {
  readonly lead: { readonly taskId: string; readonly missing: boolean };
  readonly task: TaskSpecDetail | null;
  readonly stage: TaskStage | null;
  readonly documents: readonly string[];
  readonly related: readonly {
    readonly taskId: string;
    readonly title: string | null;
    readonly status: TaskStatus | null;
  }[];
}

export interface TodosSectionData {
  readonly items: readonly TodoItem[] | null;
  readonly done: number;
  readonly total: number;
  readonly activeTitle: string | null;
}

export interface GitSectionData {
  readonly branch: string | null;
  readonly additions: number;
  readonly deletions: number;
  readonly partial: boolean;
  readonly isRepo: boolean;
}
