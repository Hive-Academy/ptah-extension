/**
 * Tab-state persistence projection.
 *
 * One place decides WHAT of a `TabState` reaches `localStorage` and WHEN a
 * write is worth making. Both persistence paths use it — the active workspace
 * (`TabManagerService._doSaveTabState`) and the background workspaces
 * (`TabWorkspacePartitionService._saveWorkspaceTabsToStorage`).
 *
 * ## Why the projection exists
 *
 * `TabState.streamingState` is the live flat-event model: `Map`s of every
 * event, per-message index, accumulators. Both readers
 * (`TabManagerService.loadTabState`, `_loadWorkspaceTabsFromStorage`) null it
 * on the way back in — a restored tab NEVER gets a streaming state — so every
 * byte spent serializing it was spent to be thrown away. `Map`s serialize to
 * `{}` so the visible size was mostly `messageEventIds` (up to
 * `STREAMING_EVENT_CAP` ids), but the object still had to be walked on every
 * save, and saves happen on every streaming flush.
 *
 * `attachedBinding` is documented on `TabState` as never persisted (a restored
 * tab is by definition not attached to a messaging binding) and both readers
 * null it too. Same deal.
 *
 * Everything else is kept verbatim, INCLUDING each message's finalized
 * `ExecutionNode` tree (`ExecutionChatMessage.streamingState`). That tree is
 * not redundant: nothing re-fetches a restored tab's transcript. On reload
 * `SessionLoaderService` calls `chat:resume` only to recover resumable
 * subagents and explicitly discards the returned `events` / `messages`
 * ("already cached from localStorage"), and `MessageBubbleComponent` renders
 * `message.streamingState` for finalized messages. Dropping it would blank
 * every restored tool call, thinking block and agent bubble.
 *
 * ## Why the equality check exists
 *
 * `saveTabState()` is called from `updateTabInternal`, i.e. on every streaming
 * flush. During a turn the only fields that move are `streamingState` (not
 * persisted) and `lastActivityAt`. Comparing the projected fields against the
 * last state actually written lets that whole class of call skip the
 * `JSON.stringify` + synchronous `localStorage.setItem` entirely, instead of
 * paying it for a byte-identical result. This is cheaper and stricter than
 * hashing the serialized string: it never materializes the string at all.
 *
 * The comparison is `===` per field, which is exact BECAUSE every mutator in
 * `TabManagerService` is immutable (`{ ...existingTab, ...updates }`, fresh
 * `messages` arrays). That is guideline 4 of the chat-state CLAUDE.md, not an
 * assumption made here. A future mutator that edits a tab field in place would
 * be missed by this check — and would also break the signal-equality contract
 * the whole lib rests on, so it is one bug, not two.
 */

import type { SessionStatus, TabState } from '@ptah-extension/chat-types';

/**
 * Storage-format version. UNCHANGED at 2 across the projection: the projection
 * only ever REMOVES fields that both readers already discard, so a blob written
 * by the old code and a blob written by the new one are read identically. No
 * migration is needed, and bumping the version would make every existing reader
 * (`state.version !== 2 → return`) silently drop the user's restored tabs.
 */
export const PERSISTED_TAB_STATE_VERSION = 2;

/**
 * Fields dropped on the way to storage. Both readers null these, so persisting
 * them is pure write amplification.
 */
const NON_PERSISTED_TAB_KEYS: ReadonlySet<string> = new Set([
  'streamingState',
  'attachedBinding',
]);

/**
 * Granularity at which `lastActivityAt` alone is allowed to force a write.
 *
 * It advances on EVERY `updateTabInternal`, so treating it as a plain field
 * would make the equality check useless during streaming — the one case it
 * exists for. A drift smaller than this is not worth a synchronous
 * `localStorage` write across every open tab; the value is a display/ordering
 * timestamp, and it is written exactly as-is the moment anything else about the
 * tab changes (which a finished turn always does, via `messages`).
 */
export const LAST_ACTIVITY_PERSIST_GRANULARITY_MS = 30_000;

/** The serialized envelope both readers expect. */
export interface PersistedTabState {
  readonly tabs: readonly TabState[];
  readonly activeTabId: string | null;
  readonly version: number;
}

/** Strip the fields no reader restores. Shape is otherwise identical. */
export function projectTabForPersist(tab: TabState): TabState {
  return { ...tab, streamingState: null, attachedBinding: null };
}

/** Build the storage envelope for a tab set. */
export function buildPersistedTabState(
  tabs: readonly TabState[],
  activeTabId: string | null,
): PersistedTabState {
  return {
    tabs: tabs.map(projectTabForPersist),
    activeTabId,
    version: PERSISTED_TAB_STATE_VERSION,
  };
}

/**
 * Statuses that describe work IN FLIGHT and therefore cannot survive a reload.
 *
 * Each one is a promise the process that made it can no longer keep:
 * `streaming` and `resuming` name an SDK query that died with the old page,
 * `switching` names a half-finished tab switch, and `awaiting-background` names
 * background tasks whose completion event will never arrive. A tab restored in
 * any of them shows a spinner and a stop button forever, and the composer stays
 * gated on a turn that already ended.
 */
const NON_RESTORABLE_STATUSES: ReadonlySet<SessionStatus> = new Set([
  'streaming',
  'resuming',
  'switching',
  'awaiting-background',
]);

/**
 * Bring one stored tab back to a state the running app can own.
 *
 * The single definition of "restored tab", used by BOTH readers —
 * `TabManagerService.loadTabState` (legacy/active-workspace key) and
 * `TabWorkspacePartitionService._loadWorkspaceTabsFromStorage` (per-workspace
 * keys). They were two hand-written object spreads that had already drifted:
 * the workspace loader coerced only `streaming` and `awaiting-background`
 * (leaving `resuming`/`switching` to restore as phantom in-flight tabs) and
 * never cleared `queuedContent`/`queuedOptions`, so a message the user typed
 * during a turn in a background workspace was auto-sent on the next turn
 * completion — days later, into whatever session the tab had by then.
 *
 * The projection written by {@link projectTabForPersist} is the mirror of this:
 * `streamingState` and `attachedBinding` are dropped on the way out and nulled
 * on the way back in, so neither can arrive from an older blob either.
 */
export function sanitizeRestoredTab(tab: TabState): TabState {
  return {
    ...tab,
    // The live flat-event model belongs to a process that no longer exists.
    streamingState: null,
    status: NON_RESTORABLE_STATUSES.has(tab.status) ? 'loaded' : tab.status,
    // Queued input is auto-sent when the CURRENT turn finishes. There is no
    // current turn after a reload, so the queue has nothing to attach to.
    queuedContent: null,
    queuedOptions: null,
    // Messaging attachment is a live, push-driven flag — a restored tab is
    // never attached. Clear so a stale flag can't leave it read-only.
    attachedBinding: null,
  };
}

/** Bring a whole stored tab set back. See {@link sanitizeRestoredTab}. */
export function sanitizeRestoredTabs(tabs: readonly TabState[]): TabState[] {
  return tabs.map(sanitizeRestoredTab);
}

/**
 * True when two tabs would serialize to the same persisted bytes.
 *
 * Key-driven rather than field-listed so a new `TabState` field is compared
 * automatically instead of silently escaping persistence.
 */
export function tabPersistEqual(a: TabState, b: TabState): boolean {
  if (a === b) return true;

  const left = a as unknown as Record<string, unknown>;
  const right = b as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);

  for (const key of keys) {
    if (NON_PERSISTED_TAB_KEYS.has(key)) continue;
    if (key === 'lastActivityAt') continue;
    if (left[key] !== right[key]) return false;
  }

  return (
    Math.abs((a.lastActivityAt ?? 0) - (b.lastActivityAt ?? 0)) <
    LAST_ACTIVITY_PERSIST_GRANULARITY_MS
  );
}

/** True when two tab sets (order included) would serialize identically. */
export function tabSetPersistEqual(
  a: readonly TabState[],
  b: readonly TabState[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!tabPersistEqual(a[i], b[i])) return false;
  }
  return true;
}

/**
 * Snapshot of what was last written to a given storage key, held so the next
 * save can decide whether it has anything new to say.
 */
export interface PersistedSnapshot {
  readonly key: string;
  readonly tabs: readonly TabState[];
  readonly activeTabId: string | null;
}

/** True when `tabs`/`activeTabId` under `key` differ from what was written. */
export function persistNeeded(
  snapshot: PersistedSnapshot | null,
  key: string,
  tabs: readonly TabState[],
  activeTabId: string | null,
): boolean {
  if (!snapshot) return true;
  if (snapshot.key !== key) return true;
  if (snapshot.activeTabId !== activeTabId) return true;
  return !tabSetPersistEqual(snapshot.tabs, tabs);
}
