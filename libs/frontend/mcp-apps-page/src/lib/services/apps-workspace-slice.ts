import type { SurfaceId } from '@ptah-extension/chat-state';
import { createEmptyStreamingState } from '@ptah-extension/chat-types';
import type { StreamingState } from '@ptah-extension/chat-types';
import { createAppsSurfaceState } from '../state/apps-surface-reducer';
import type { AppsSurfaceState } from '../state/apps-surface-reducer';
import type { AppsSurfaceSync } from './apps-surface-sync';

/**
 * Per-workspace slice of the Apps page (implementation-plan.md D1, :142-158).
 *
 * Pure types and pure transitions only: no Angular, no timers. The root
 * `AppsSessionService` keeps one slice per workspace path in a signal and
 * exposes the ACTIVE one, so a workspace switch swaps the whole page state
 * (conversation, surfaces, notices) and switching back restores it
 * (the partition pattern of `tribunal-state.service.ts:144-168`).
 */

/**
 * Slice key used before a real workspace path is known (bootstrap, or a host
 * with no workspace partition).
 */
export const APPS_IMPLICIT_WORKSPACE = '__apps_implicit__';

/** The page-owned conversation (plan D3). */
export interface AppsConversation {
  /** The `TabId.create()` correlation id; also the surface routing id. */
  readonly routingId: string;
  /** The streaming surface registered as interactive for this conversation. */
  readonly surfaceId: SurfaceId;
  /** The workspace the conversation was started in, when one was known. */
  readonly workspacePath: string | null;
}

/** One turn the user contributed, in wall-clock order. */
export interface AppsUserBubble {
  readonly text: string;
  readonly at: number;
}

export interface AppsWorkspaceSlice {
  readonly lastFocusKey: string | null;
  /** Null until `start()`; cleared by `discard()` and a failed start. */
  readonly conversation: AppsConversation | null;
  /**
   * The surface:read orchestrator of this slice (one per conversation).
   * Released (`dispose()`) whenever the conversation goes away.
   */
  readonly sync: AppsSurfaceSync | null;
  /** A turn was sent and no session liveness has been reported yet. */
  readonly turnPending: boolean;
  readonly userBubbles: readonly AppsUserBubble[];
  /** Streaming state slot the surface adapter reads and writes. */
  readonly streamingState: StreamingState;
  /** Reducer-held surfaces of the conversation's routing id. */
  readonly surfaces: AppsSurfaceState;
  /** "Could not refresh this app" after a failed `surface:read`; else null. */
  readonly syncNotice: string | null;
  /** Last user-visible conversation failure; else null. */
  readonly error: string | null;
}

export function createAppsWorkspaceSlice(): AppsWorkspaceSlice {
  return {
    lastFocusKey: null,
    conversation: null,
    sync: null,
    turnPending: false,
    userBubbles: [],
    streamingState: createEmptyStreamingState(),
    surfaces: createAppsSurfaceState(),
    syncNotice: null,
    error: null,
  };
}

/** The shared read-only empty slice, shown for a workspace with no state. */
export const EMPTY_APPS_SLICE: AppsWorkspaceSlice = createAppsWorkspaceSlice();

/** Remember a control without changing any conversation or surface state. */
export function recordAppsFocusKey(
  slice: AppsWorkspaceSlice,
  key: string | null,
): AppsWorkspaceSlice {
  return slice.lastFocusKey === key ? slice : { ...slice, lastFocusKey: key };
}

/** The slice key for a workspace path reported by `TabManagerService`. */
export function appsSliceKey(workspacePath: string | null): string {
  return workspacePath !== null && workspacePath.length > 0
    ? workspacePath
    : APPS_IMPLICIT_WORKSPACE;
}

/** The workspace path to send with `chat:start`, or null for the sentinel. */
export function appsWorkspacePath(key: string): string | null {
  return key === APPS_IMPLICIT_WORKSPACE ? null : key;
}

/** The slice for `key`, or the empty slice when none exists yet. */
export function readAppsSlice(
  slices: ReadonlyMap<string, AppsWorkspaceSlice>,
  key: string,
): AppsWorkspaceSlice {
  return slices.get(key) ?? EMPTY_APPS_SLICE;
}

/** Returns a new map with `key`'s slice replaced by `update(slice)`. */
export function patchAppsSlice(
  slices: ReadonlyMap<string, AppsWorkspaceSlice>,
  key: string,
  update: (slice: AppsWorkspaceSlice) => AppsWorkspaceSlice,
): ReadonlyMap<string, AppsWorkspaceSlice> {
  const current = readAppsSlice(slices, key);
  const next = update(current);
  if (next === current) return slices;
  const map = new Map(slices);
  map.set(key, next);
  return map;
}

/** Returns a new map without `key`'s slice. */
export function removeAppsSlice(
  slices: ReadonlyMap<string, AppsWorkspaceSlice>,
  key: string,
): ReadonlyMap<string, AppsWorkspaceSlice> {
  if (!slices.has(key)) return slices;
  const map = new Map(slices);
  map.delete(key);
  return map;
}

/**
 * True when `slice` still belongs to the conversation of `routingId`. Every
 * asynchronous write (an RPC result, a push, a read) checks this, so a result
 * that lands after `discard()` or a restart never touches the new state.
 */
export function isAppsSliceOf(
  slice: AppsWorkspaceSlice,
  routingId: string,
): boolean {
  return slice.conversation?.routingId === routingId;
}

/** The slice key whose conversation owns `routingId`, or null. */
export function findAppsSliceKey(
  slices: ReadonlyMap<string, AppsWorkspaceSlice>,
  routingId: string,
): string | null {
  for (const [key, slice] of slices) {
    if (isAppsSliceOf(slice, routingId)) return key;
  }
  return null;
}

/**
 * The slice right after `start()` has claimed everything, before the RPC. A
 * new conversation starts from nothing: no surfaces, bubbles or notices of an
 * earlier (discarded or failed) conversation survive into it.
 */
export function startAppsSlice(
  conversation: AppsConversation,
  sync: AppsSurfaceSync,
  bubble: AppsUserBubble,
): AppsWorkspaceSlice {
  return {
    ...createAppsWorkspaceSlice(),
    conversation,
    sync,
    turnPending: true,
    userBubbles: [bubble],
  };
}
