import type { ChildProcess } from 'child_process';
import type {
  AgentProcessInfo,
  CliOutputSegment,
  FlatStreamEventUnion,
} from '@ptah-extension/shared';
import type { SdkHandle } from './cli-adapters/cli-adapter.interface';

export interface TrackedAgent {
  info: AgentProcessInfo;
  /** Child process for CLI-based agents, null for SDK-based agents */
  process: ChildProcess | null;
  sdkHandle?: SdkHandle;
  /** Abort controller for SDK-based agents (null/undefined for CLI agents) */
  sdkAbortController?: AbortController;
  stdoutBuffer: string;
  stderrBuffer: string;
  /** Absent for a restored record, and for an agent whose watchdog is disabled. */
  timeoutHandle?: NodeJS.Timeout;
  /** Silence window this agent's watchdog uses, or undefined when disabled. */
  inactivityTimeoutMs?: number;
  stdoutLineCount: number;
  stderrLineCount: number;
  truncated: boolean;
  /** Guard against double handleExit (error + exit events firing) */
  hasExited: boolean;
  /** Cleanup timer handle for TTL-based removal from map */
  cleanupHandle?: NodeJS.Timeout;
  /** Deferred `agent:exited` emit timer (GRACEFUL_EXIT_DELAY); cleared if the
   * agent is re-opened via continueConversation so a stale exit from the prior
   * turn can't clobber the running continuation. */
  exitEmitHandle?: NodeJS.Timeout;
  /** Idle-release timer armed at exit for continuation-capable handles; cleared
   * when a continuation re-opens the agent. */
  idleReleaseHandle?: NodeJS.Timeout;
  /** Wall-clock ms at which the current idle window started, for the release log. */
  idleSince?: number;
  /** True once the SDK subprocess has been aborted and reaped. The record and
   * its buffers stay readable; only in-process continuation is gone. */
  subprocessReleased: boolean;
  /** Accumulated structured segments for persistence (capped at MAX_ACCUMULATED_SEGMENTS) */
  accumulatedSegments: CliOutputSegment[];
  /** Accumulated rich stream events for persistence (Ptah CLI only, capped at MAX_ACCUMULATED_STREAM_EVENTS) */
  accumulatedStreamEvents: FlatStreamEventUnion[];
  /** True once the stream-events cap has been logged — suppresses per-event log spam for long-running agents. */
  streamCapLogged: boolean;
  /**
   * Settles when the turn currently in flight has torn down. Written in
   * {@link AgentProcessManager.trackSdkHandle} from `SdkHandle.done` and
   * re-written in {@link AgentProcessManager.continueConversation} from the
   * continued turn's `done`. The `interrupt-resume` path awaits it: without it
   * the router re-enters `continueConversation` while the record is still
   * `running` and is refused as `busy`.
   */
  currentTurnDone?: Promise<number>;
  /**
   * Messages waiting for the current turn to end, in arrival order. In-memory,
   * capped at `MAX_PENDING_MESSAGES`, never persisted, and cleared when
   * the record's subprocess is released or the record is dropped.
   */
  pendingMessages: string[];
  /**
   * How many `ptah_agent_report` bodies this lane delivered. Carried on the
   * completion signal so the orchestrator can tell a lane that accounted for
   * itself from one that exited without a word (TASK_2026_515).
   */
  reportsDelivered: number;
  /**
   * Set only by {@link AgentProcessManager.restoreAgents}: this record was
   * rebuilt from persisted session state, not from a run this host supervised.
   * Its output is readable; nothing about it is live.
   */
  restored?: true;
}
