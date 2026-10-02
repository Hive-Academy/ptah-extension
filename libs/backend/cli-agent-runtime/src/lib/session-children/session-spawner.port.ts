/**
 * Session children (TASK_2026_584): the contract a parent chat session uses to
 * start, steer, observe and stop child chat sessions that run in their own git
 * worktree and their own tab.
 *
 * Type-only. The implementation is registered under
 * `CLI_AGENT_RUNTIME_TOKENS.SESSION_SPAWNER`; the MCP surface and the
 * `chat:agent-sessions` RPC depend on this port, never on the class.
 *
 * Refusals follow the repository's discriminated-result shape
 * (`AgentReportDelivery`): every call either did the thing or returns a
 * closed reason the caller can act on.
 */
import type {
  AgentSessionOpenedPayload,
  LaneCompletionRefusalReason,
  LaneCompletionVerdict,
} from '@ptah-extension/shared';

export type SessionChildStatus =
  | 'starting'
  | 'working'
  | 'awaiting-permission'
  | 'waiting'
  | 'idle'
  | 'failed'
  | 'stopped'
  | 'timed-out'
  | 'ended';

/** The statuses a child can end in; once recorded, a child never leaves them. */
export type SessionChildTerminalStatus = Extract<
  SessionChildStatus,
  'failed' | 'stopped' | 'timed-out' | 'ended'
>;

/** A permission prompt the child is waiting on, denied at `deniesAt` unless answered. */
export interface SessionChildPendingPermission {
  readonly toolName: string;
  readonly description: string;
  /** ISO timestamp the bounded prompt denies at. */
  readonly deniesAt: string;
}

/** The outcome of the child's latest settled turn. */
export interface SessionChildLastCompletion {
  readonly turn: number;
  readonly verdict: LaneCompletionVerdict;
  readonly delivered: boolean;
  /** Why the completion was not delivered. Present only when `delivered` is false. */
  readonly refusal?: string;
}

export interface SessionChildSnapshot {
  /** Child tab id (UUID v4): the handle every `ptah_session_*` tool takes. */
  readonly childSessionId: string;
  readonly sdkSessionId?: string;
  /** Parent tab id (its MCP routing id). */
  readonly parentSessionId: string;
  readonly parentSdkSessionId?: string;
  readonly label: string;
  readonly taskId?: string;
  readonly branch: string;
  /** Resolved commit sha the branch was created from. */
  readonly baseRef: string;
  /** Parent workspace root: sidebar group and tab partition. */
  readonly workspaceRoot: string;
  /** The child's cwd and its metadata `workingDirectory`. */
  readonly worktreePath: string;
  readonly taskFolder?: string;
  /** Absolute deliverable paths, resolved at start. */
  readonly deliverables: readonly string[];
  readonly status: SessionChildStatus;
  readonly pendingPermission?: SessionChildPendingPermission;
  readonly subagentPtahTools: 'available' | 'unavailable';
  /** ISO timestamp, stamped after `git worktree add` returned. Fixed for the child's life. */
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly endReason?: string;
  readonly turnsSettled: number;
  readonly reportsDelivered: number;
  /** Reports refused while the parent was not live. */
  readonly reportsRefused: number;
  /** Summary of the last refused report. */
  readonly lastRefusedReport?: string;
  /** The latest completion not yet delivered to the parent. */
  readonly heldCompletion?: {
    readonly turn: number;
    readonly verdict: LaneCompletionVerdict;
    readonly heldSince: string;
  };
  readonly lastRecap?: string;
  readonly lastCompletion?: SessionChildLastCompletion;
}

export interface SessionChildStartRequest {
  /** Transport-derived only — never a tool argument. */
  readonly callerSessionId: string | undefined;
  readonly task: string;
  readonly branch: string;
  readonly baseRef?: string;
  readonly label?: string;
  readonly taskId?: string;
  readonly taskFolder?: string;
  readonly deliverables?: readonly string[];
  readonly model?: string;
}

export type SessionSpawnRefusalCode =
  | 'unattributed-caller'
  | 'depth-exceeded'
  | 'cap-reached'
  | 'mcp-unavailable'
  | 'chat-runtime-unavailable'
  | 'no-workspace'
  | 'invalid-arguments'
  | 'branch-exists'
  | 'worktree-failed'
  | 'worktree-outside-workspace'
  | 'session-start-failed';

export type SessionChildRollbackStepName =
  | 'remove-worktree'
  | 'delete-branch'
  | 'release-policy'
  | 'release-mcp-root'
  | 'remove-link';

/** One rollback step, reported whether it succeeded or not. */
export interface SessionChildRollbackStep {
  readonly step: SessionChildRollbackStepName;
  readonly ok: boolean;
  readonly detail?: string;
}

export type SessionChildStartResult =
  | { readonly ok: true; readonly child: SessionChildSnapshot }
  | {
      readonly ok: false;
      readonly refusal: SessionSpawnRefusalCode;
      readonly detail: string;
      readonly rollback?: readonly SessionChildRollbackStep[];
    };

export type SessionSendMode = 'queue' | 'steer' | 'if-idle';

export interface SessionChildSendRequest {
  readonly callerSessionId: string | undefined;
  readonly childSessionId: string;
  readonly message: string;
  readonly mode: SessionSendMode;
}

export type SessionChildSendResult =
  | {
      readonly delivered: true;
      readonly effect:
        'started-turn' | 'held-until-turn-end' | 'interrupted-and-started';
    }
  | {
      readonly delivered: false;
      readonly reason:
        | 'not-a-child-of-caller'
        | 'unknown-child'
        | 'unattributed-caller'
        | 'session-ended'
        | 'busy'
        | 'interrupt-failed'
        | 'delivery-failed';
      readonly detail: string;
    };

export interface SessionChildQuery {
  readonly callerSessionId: string | undefined;
  readonly childSessionId?: string;
}

export interface SessionChildLookupRefusal {
  readonly ok: false;
  readonly reason:
    'not-a-child-of-caller' | 'unknown-child' | 'unattributed-caller';
  readonly detail: string;
}

export interface SessionChildReadResult {
  readonly child: SessionChildSnapshot;
  readonly transcript: string;
  readonly truncated: boolean;
  readonly available: boolean;
}

/* ---------------------------------------------------------------------------
 * Completion push (child → parent), built by `LaneCompletionNotifier`.
 * ------------------------------------------------------------------------- */

/** The child as the completion notifier needs to see it. */
export interface SessionChildCompletionSubject {
  readonly childSessionId: string;
  readonly label: string;
  /**
   * Parent ids to deliver into, in order of preference: the recorded parent
   * tab id first, then the parent SDK id (a parent resumed in a new tab is
   * reachable only through the latter).
   */
  readonly parentSessionIds: readonly string[];
  readonly task: string;
  readonly taskFolder?: string;
  readonly deliverables: readonly string[];
  readonly worktreePath: string;
  readonly branch: string;
  /**
   * ISO timestamp the child started at — the deliverable reference time. A
   * deliverable whose mtime is earlier was not written by this child.
   */
  readonly startedAt: string;
  readonly reportsDelivered: number;
  readonly lastRecap?: string;
}

/** One settled turn of a child. */
export interface SessionChildSettle {
  /** 1-based count of settled turns; part of the dedupe key. */
  readonly turn: number;
  readonly status: 'completed' | 'failed' | 'timeout';
  /** ISO timestamp the turn settled at. */
  readonly completedAt: string;
}

/** The rendered completion, delivered now or held for the parent's next call. */
export interface SessionChildCompletionEnvelope {
  readonly childSessionId: string;
  readonly turn: number;
  readonly verdict: LaneCompletionVerdict;
  readonly text: string;
}

/** Why a child completion was not delivered (the lane refusal reasons, unchanged). */
export type SessionChildCompletionRefusalReason = Exclude<
  LaneCompletionRefusalReason,
  'already-signalled'
>;

export type SessionChildCompletionDelivery =
  | {
      readonly delivered: true;
      readonly parentSessionId: string;
      readonly envelope: SessionChildCompletionEnvelope;
    }
  /** This turn was already signalled; nothing was built or sent. */
  | { readonly delivered: false; readonly reason: 'already-signalled' }
  | {
      readonly delivered: false;
      readonly reason: SessionChildCompletionRefusalReason;
      readonly detail?: string;
      /** The envelope that was built, so the caller can hold it for later. */
      readonly envelope: SessionChildCompletionEnvelope;
    };

export interface ISessionSpawner {
  start(request: SessionChildStartRequest): Promise<SessionChildStartResult>;
  send(request: SessionChildSendRequest): Promise<SessionChildSendResult>;
  status(
    query: SessionChildQuery,
  ):
    | { readonly ok: true; readonly children: readonly SessionChildSnapshot[] }
    | SessionChildLookupRefusal;
  read(
    query: SessionChildQuery & {
      readonly childSessionId: string;
      readonly tailKiB?: number;
    },
  ): Promise<
    | { readonly ok: true; readonly result: SessionChildReadResult }
    | SessionChildLookupRefusal
  >;
  stop(
    query: SessionChildQuery & { readonly childSessionId: string },
  ): Promise<
    | { readonly ok: true; readonly child: SessionChildSnapshot }
    | SessionChildLookupRefusal
  >;
  /** Live children as UI descriptors — serves `chat:agent-sessions` for late tab adoption. */
  listUiDescriptors(
    workspaceRoot?: string,
  ): readonly AgentSessionOpenedPayload[];
  /**
   * Held completions of the caller's children, returned once and then marked
   * delivered (the parent was not live when they settled).
   */
  takeHeldCompletions(
    callerSessionId: string | undefined,
  ): readonly SessionChildCompletionEnvelope[];
  dispose(): void;
}
