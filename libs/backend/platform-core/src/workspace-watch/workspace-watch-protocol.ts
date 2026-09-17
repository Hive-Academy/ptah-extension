/**
 * Wire protocol between an `IWorkspaceWatcher` adapter and the out-of-main
 * watch host that runs {@link WorkspaceWatchHostCore} (TASK_2026_437 C8).
 *
 * The host is a separate process (Electron `utilityProcess`, CLI
 * `child_process.fork`), so every message crosses an IPC boundary and is validated
 * with Zod on BOTH sides: the host parses what the adapter sends, the adapter
 * parses what the host sends. A message that fails to parse is dropped, never
 * trusted in part.
 *
 * Adapter → host:
 * - `subscribe   { id, root, options }`  start one subscription
 * - `unsubscribe { id }`                 stop it
 *
 * Host → adapter:
 * - `batch     { id, changes, truncated, overflow, droppedCount }` — at most one
 *   per 250 ms per subscription (the host coalesces; INV-1)
 * - `heartbeat { seq, subscriptions, eventsPerSec }` — liveness, every 2 s
 * - `error     { id?, code, message }` — a failure the adapter logs
 * - `notice    { code, root, detail? }` — a rare state change the adapter logs
 * - `fatal     { message }` — the host cannot work at all (engine failed to
 *   load); the adapter treats it as a crash
 *
 * `root` is not carried on `batch`: the adapter stamps the root exactly as the
 * consumer passed it, from its own subscription table.
 */

import { z } from 'zod';

import type {
  WorkspaceChangeBatch,
  WorkspaceWatchOptions,
} from '../interfaces/workspace-watcher.interface';

/** Size bounds on everything that crosses the wire. */
export const WORKSPACE_WATCH_PROTOCOL_LIMITS = {
  /** Longest accepted path or glob. */
  maxPathLength: 4096,
  /** Longest accepted directory name or rule segment. */
  maxNameLength: 255,
  /** Most entries in any one exclusion list. */
  maxListEntries: 2048,
  /** Most segments in one segment rule. */
  maxRuleSegments: 32,
  /** Most changes in one batch — the INV-1 ceiling. */
  maxChangesPerBatch: 500,
  /** Longest diagnostic text; longer text is truncated before it is posted. */
  maxMessageLength: 2048,
} as const;

const LIMITS = WORKSPACE_WATCH_PROTOCOL_LIMITS;

const WINDOWS_ABSOLUTE_PATH = /^(?:[A-Za-z]:(?:[\\/]|$)|\\\\|\/\/)/;

/**
 * How the host compares a path it was sent with one the engine reports:
 * `/`-separated, trailing-separator-free, case-folded for a Windows path.
 */
export function toWorkspaceWatchPathKey(absolutePath: string): string {
  const normalized = absolutePath
    .replace(/\\/g, '/')
    .replace(/(?<!^)\/{2,}/g, '/')
    .replace(/(?<=.)\/+$/, '');
  return WINDOWS_ABSOLUTE_PATH.test(absolutePath)
    ? normalized.toLowerCase()
    : normalized;
}

const subscriptionIdSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const counterSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const pathSchema = z.string().min(1).max(LIMITS.maxPathLength);
const messageTextSchema = z.string().max(LIMITS.maxMessageLength);

export const workspaceWatchWireOptionsSchema = z.strictObject({
  excludeGlobs: z
    .array(z.string().min(1).max(LIMITS.maxPathLength))
    .max(LIMITS.maxListEntries),
  excludeDirNames: z
    .array(z.string().min(1).max(LIMITS.maxNameLength))
    .max(LIMITS.maxListEntries),
  excludeSegmentRules: z
    .array(
      z.array(z.string().max(LIMITS.maxNameLength)).max(LIMITS.maxRuleSegments),
    )
    .max(LIMITS.maxListEntries),
  nestedRepoDetection: z.boolean(),
  nestedRepoRoots: z.array(pathSchema).max(LIMITS.maxListEntries).optional(),
  minBatchIntervalMs: z.number().finite().optional(),
  maxPathsPerBatch: z.number().finite().optional(),
});

export const workspaceWatchSubscribeMessageSchema = z.strictObject({
  type: z.literal('subscribe'),
  id: subscriptionIdSchema,
  root: pathSchema,
  options: workspaceWatchWireOptionsSchema,
});

export const workspaceWatchUnsubscribeMessageSchema = z.strictObject({
  type: z.literal('unsubscribe'),
  id: subscriptionIdSchema,
});

export const workspaceWatchHostInboundSchema = z.discriminatedUnion('type', [
  workspaceWatchSubscribeMessageSchema,
  workspaceWatchUnsubscribeMessageSchema,
]);

const changeSchema = z.strictObject({
  path: pathSchema,
  kind: z.enum(['create', 'update', 'delete']),
});

export const workspaceWatchBatchMessageSchema = z.strictObject({
  type: z.literal('batch'),
  id: subscriptionIdSchema,
  changes: z.array(changeSchema).max(LIMITS.maxChangesPerBatch),
  truncated: z.boolean(),
  overflow: z.boolean(),
  droppedCount: counterSchema,
});

export const workspaceWatchHeartbeatMessageSchema = z.strictObject({
  type: z.literal('heartbeat'),
  seq: counterSchema,
  subscriptions: counterSchema,
  eventsPerSec: counterSchema,
});

/** Stable failure codes the host reports. */
export const WORKSPACE_WATCH_ERROR_CODES = [
  /** An inbound message failed validation and was dropped. */
  'invalid-message',
  /** A `subscribe` could not be honoured (its options were rejected). */
  'subscribe-rejected',
  /** The native engine refused to subscribe a root; the host retries. */
  'native-subscribe-failed',
  /** The native engine reported an error on a live subscription (A1). */
  'native-error',
  /** Unsubscribing a native subscription failed. */
  'native-unsubscribe-failed',
  /** A subscription's listener threw inside the host. */
  'listener-error',
] as const;
export type WorkspaceWatchErrorCode =
  (typeof WORKSPACE_WATCH_ERROR_CODES)[number];

export const workspaceWatchErrorMessageSchema = z.strictObject({
  type: z.literal('error'),
  id: subscriptionIdSchema.optional(),
  code: z.enum(WORKSPACE_WATCH_ERROR_CODES),
  message: messageTextSchema,
});

/** Stable state-change codes the host reports. */
export const WORKSPACE_WATCH_NOTICE_CODES = [
  'storm-entered',
  'storm-exited',
  'nested-root-detected',
  'native-resubscribed',
  /** The native subscription was torn down and re-created; `detail` says why. */
  'native-rebuilt',
  /**
   * A created directory could not be listed (EACCES/EPERM). Nothing under it
   * can be reconciled or watched; at most one per root per minute.
   */
  'directory-unreadable',
] as const;
export type WorkspaceWatchNoticeCode =
  (typeof WORKSPACE_WATCH_NOTICE_CODES)[number];

export const workspaceWatchNoticeMessageSchema = z.strictObject({
  type: z.literal('notice'),
  code: z.enum(WORKSPACE_WATCH_NOTICE_CODES),
  root: pathSchema,
  detail: messageTextSchema.optional(),
});

export const workspaceWatchFatalMessageSchema = z.strictObject({
  type: z.literal('fatal'),
  message: messageTextSchema,
});

/**
 * Subscription `id` is covered by a live native subscription. Posted once per
 * subscription, the first time that is true; the adapter's proof that a fresh
 * host is really watching (a heartbeat only proves the process is alive).
 */
export const workspaceWatchSubscribedMessageSchema = z.strictObject({
  type: z.literal('subscribed'),
  id: subscriptionIdSchema,
});

export const workspaceWatchHostOutboundSchema = z.discriminatedUnion('type', [
  workspaceWatchBatchMessageSchema,
  workspaceWatchHeartbeatMessageSchema,
  workspaceWatchErrorMessageSchema,
  workspaceWatchNoticeMessageSchema,
  workspaceWatchFatalMessageSchema,
  workspaceWatchSubscribedMessageSchema,
]);

export type WorkspaceWatchSubscribeMessage = z.infer<
  typeof workspaceWatchSubscribeMessageSchema
>;
export type WorkspaceWatchUnsubscribeMessage = z.infer<
  typeof workspaceWatchUnsubscribeMessageSchema
>;
export type WorkspaceWatchHostInbound = z.infer<
  typeof workspaceWatchHostInboundSchema
>;
export type WorkspaceWatchBatchMessage = z.infer<
  typeof workspaceWatchBatchMessageSchema
>;
export type WorkspaceWatchHeartbeatMessage = z.infer<
  typeof workspaceWatchHeartbeatMessageSchema
>;
export type WorkspaceWatchErrorMessage = z.infer<
  typeof workspaceWatchErrorMessageSchema
>;
export type WorkspaceWatchNoticeMessage = z.infer<
  typeof workspaceWatchNoticeMessageSchema
>;
export type WorkspaceWatchFatalMessage = z.infer<
  typeof workspaceWatchFatalMessageSchema
>;
export type WorkspaceWatchSubscribedMessage = z.infer<
  typeof workspaceWatchSubscribedMessageSchema
>;
export type WorkspaceWatchHostOutbound = z.infer<
  typeof workspaceWatchHostOutboundSchema
>;

/** The adapter-side message for one subscription, before it is validated. */
export function toWorkspaceWatchSubscribeMessage(
  id: number,
  root: string,
  options: WorkspaceWatchOptions,
): WorkspaceWatchSubscribeMessage {
  return {
    type: 'subscribe',
    id,
    root,
    options: {
      excludeGlobs: [...options.excludeGlobs],
      excludeDirNames: [...options.excludeDirNames],
      excludeSegmentRules: options.excludeSegmentRules.map((rule) => [...rule]),
      nestedRepoDetection: options.nestedRepoDetection,
      ...(options.nestedRepoRoots === undefined
        ? {}
        : { nestedRepoRoots: [...options.nestedRepoRoots] }),
      ...(options.minBatchIntervalMs === undefined
        ? {}
        : { minBatchIntervalMs: options.minBatchIntervalMs }),
      ...(options.maxPathsPerBatch === undefined
        ? {}
        : { maxPathsPerBatch: options.maxPathsPerBatch }),
    },
  };
}

/** The host-side wire form of one coalesced batch. */
export function toWorkspaceWatchBatchMessage(
  id: number,
  batch: WorkspaceChangeBatch,
): WorkspaceWatchBatchMessage {
  return {
    type: 'batch',
    id,
    changes: batch.changes.map((change) => ({
      path: change.path,
      kind: change.kind,
    })),
    truncated: batch.truncated,
    overflow: batch.overflow,
    droppedCount: batch.droppedCount,
  };
}

/** Validates an inbound (adapter → host) message. `undefined` when invalid. */
export function parseWorkspaceWatchHostInbound(
  value: unknown,
): WorkspaceWatchHostInbound | undefined {
  const result = workspaceWatchHostInboundSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

/** Validates an outbound (host → adapter) message. `undefined` when invalid. */
export function parseWorkspaceWatchHostOutbound(
  value: unknown,
): WorkspaceWatchHostOutbound | undefined {
  const result = workspaceWatchHostOutboundSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

/** Clips diagnostic text to {@link WORKSPACE_WATCH_PROTOCOL_LIMITS.maxMessageLength}. */
export function clipWorkspaceWatchText(text: string): string {
  return text.length <= LIMITS.maxMessageLength
    ? text
    : `${text.slice(0, LIMITS.maxMessageLength - 1)}…`;
}
