/**
 * Session children (TASK_2026_584) - barrel exports.
 *
 * Child chat sessions a parent session starts with `ptah_session_start`, each
 * in its own git worktree and its own tab.
 */

export type {
  ISessionSpawner,
  SessionChildCompletionDelivery,
  SessionChildCompletionEnvelope,
  SessionChildCompletionRefusalReason,
  SessionChildCompletionSubject,
  SessionChildLastCompletion,
  SessionChildLookupRefusal,
  SessionChildPendingPermission,
  SessionChildQuery,
  SessionChildReadResult,
  SessionChildRollbackStep,
  SessionChildRollbackStepName,
  SessionChildSendRequest,
  SessionChildSendResult,
  SessionChildSettle,
  SessionChildSnapshot,
  SessionChildStartRequest,
  SessionChildStartResult,
  SessionChildStatus,
  SessionChildTerminalStatus,
  SessionSendMode,
  SessionSpawnRefusalCode,
} from './session-spawner.port';
export type {
  ChildChatSessionStartInput,
  ChildChatSessionStartOutcome,
  IChildChatSessionHost,
} from './child-chat-session-host.port';
export {
  SessionChildRegistry,
  SESSION_CHILD_ENDED_HISTORY_SIZE,
} from './session-child.registry';
export type {
  SessionChildHeldCompletion,
  SessionChildRecord,
  SessionChildRecordPatch,
  SessionChildReservation,
} from './session-child.registry';
