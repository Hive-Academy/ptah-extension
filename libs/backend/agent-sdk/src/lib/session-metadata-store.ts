/**
 * Session Metadata Store
 *
 * Lightweight storage for session UI metadata ONLY.
 * Session messages and conversation history are managed by the Claude Agent SDK
 * natively in ~/.claude/projects/{sessionId}.jsonl
 *
 * This store ONLY tracks:
 * - Session names (user-friendly labels)
 * - Timestamps (for sorting)
 * - Workspace association
 * - Accumulated cost/tokens (from result messages)
 *
 * It does NOT store:
 * - Messages (SDK handles this)
 * - Conversation history (SDK handles this)
 * - Message content (SDK handles this)
 * - CLI agent stream events (own key per agent — see {@link PersistedAgentOutput})
 *
 * All sessions live under ONE storage key, so every write re-serializes every
 * session. Two rules keep that affordable, and both were bought the hard way
 * (TASK_2026_323 blocker B5):
 *
 *  1. Nothing unbounded goes in the blob. A `CliSessionReference` carries ids
 *     and status only; the bulk output lives under
 *     `ptah.agentOutput:<agentId>`, written once when the agent exits and read
 *     back in bounded pages.
 *  2. A burst of writes serializes once. Mutations are staged in memory and
 *     flushed when the write queue drains, so ten CLI agents exiting together
 *     cost one `IStateStorage.update`, not ten.
 */

import { injectable, inject } from 'tsyringe';
import EventEmitter from 'eventemitter3';
import { z } from 'zod';
import { normalizeCodexWorkspaceKey } from '@ptah-extension/codex-runtime';
import { SessionRuntimeIdentitySchema } from '@ptah-extension/shared/schemas';
import type { SessionId, SessionRuntimeIdentity } from '@ptah-extension/shared';

import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  StateStorageCursorStaleError,
  StateStorageValueTooLargeError,
  isAsyncStateStorage,
  omitJsonPaths,
  packJsonSequencePage,
  type IAsyncStateStorage,
  type ISessionBlobStore,
  type ISessionRecordRepository,
  type ISessionStoreGate,
  type IStateStorage,
  type SessionRecordInput,
  type StateStorageArraySplitPlan,
  type StateStorageGetOptions,
  type StateStorageTruncatedItem,
  type StateStorageValueProjection,
} from '@ptah-extension/platform-core';
import { SdkError } from './errors';
import { parseQuotaOwnerRef } from './helpers/plan-limits/quota-owner-ref.schema';
import type {
  CliOutputSegment,
  CliSessionReference,
  FlatStreamEventUnion,
  SessionMetadataChangedNotification,
  SessionMetadataChangeKind,
  SubagentRecord,
} from '@ptah-extension/shared';
import {
  blankToUndefined,
  isProviderAccountOpaqueId,
  isProviderAccountOwnerKey,
  type ProviderAccountBinding,
} from '@ptah-extension/shared';

type CodexExecution = Extract<
  SessionRuntimeIdentity,
  { runtime: 'codex-app-server' }
>;

// Registry migration 58 uses zero-based epochs/revisions. Strict objects reject
// accidental directory/identity fields instead of silently stripping them.
const accountRevision = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const accountBindingSchema = z
  .object({
    version: z.literal(1),
    provider: z.literal('claude'),
    profileId: z.string().refine(isProviderAccountOpaqueId),
    runId: z.string().refine(isProviderAccountOpaqueId),
    routeFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    routeRevision: accountRevision,
    authEpoch: accountRevision,
    identity: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('unknown') }).strict(),
      z
        .object({
          kind: z.literal('known'),
          ownerKey: z.string().refine(isProviderAccountOwnerKey),
        })
        .strict(),
    ]),
  })
  .strict();

/**
 * Native thread mapping stored beside `codexExecution` in the same session
 * record (the session key is the thread id). History stays in the App Server
 * thread; this only maps a Ptah context to its thread for `thread/resume`.
 * `workspaceId` keeps the caller's path; `codexExecution.workspaceId` keeps
 * its normalized key, and writes require the two to agree.
 */
const codexThreadRecordSchema = z
  .object({
    version: z.literal(1),
    contextId: z.string().min(1),
    processGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    workspaceId: z.string().min(1),
    profileFingerprint: z.string().min(1),
    state: z.enum(['active', 'inactive']),
  })
  .strict();

export type CodexThreadRecord = z.infer<typeof codexThreadRecordSchema>;

/** Returns the current thread record or the same reference to skip the write. */
export type CodexThreadRecordUpdater = (
  current: CodexThreadRecord | undefined,
  execution: CodexExecution | undefined,
) => CodexThreadRecord | undefined;

/** Malformed or absent stored mappings read as absent; they never throw. */
export function parseCodexThreadRecord(
  value: unknown,
): CodexThreadRecord | undefined {
  const parsed = codexThreadRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Throws for a relative or malformed path, which refuses the write. */
function sameCodexWorkspace(workspacePath: string, key: string): boolean {
  return normalizeCodexWorkspaceKey(workspacePath, process.platform) === key;
}

/** Keep a user rename; use a supplied title only for an unnamed native row. */
function codexSessionName(
  current: string | undefined,
  sessionId: string,
  title: string | undefined,
): string {
  if (current?.trim() && current !== sessionId) return current;
  return title?.trim() || current?.trim() || sessionId;
}

const codexMessageCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional();

function codexMessageCount(value: unknown): number {
  const parsed = codexMessageCountSchema.safeParse(value);
  return parsed.success ? parsed.data ?? 0 : 0;
}

export class SessionAccountBindingError extends Error {
  constructor(
    readonly code:
      | 'invalid-bound'
      | 'binding-conflict'
      | 'linkage-incomplete'
      | 'identity-unproved'
      | 'unavailable-storage',
  ) {
    super(`Session account linkage refused: ${code}`);
    this.name = 'SessionAccountBindingError';
  }
}

export class CodexSessionMetadataError extends Error {
  constructor(
    readonly code:
      | 'legacy-conversion'
      | 'invalid-identity'
      | 'binding-change'
      | 'unavailable-storage'
      | 'direct-runtime-write'
      | 'account-linkage',
    message: string,
  ) {
    super(message);
    this.name = 'CodexSessionMetadataError';
  }
}

export type SessionAccountBindingLookup =
  | { readonly status: 'absent' }
  | { readonly status: 'bound'; readonly binding: ProviderAccountBinding }
  | { readonly status: 'invalid-bound' | 'unavailable-storage' };

function parseSessionAccountBinding(value: unknown): ProviderAccountBinding {
  const parsed = accountBindingSchema.safeParse(value);
  if (!parsed.success) throw new SessionAccountBindingError('invalid-bound');
  return Object.freeze({
    ...parsed.data,
    identity: Object.freeze(parsed.data.identity),
  });
}

function validateAccountLinkage(value: unknown): SessionMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SessionAccountBindingError('invalid-bound');
  }
  const metadata = value as SessionMetadata;
  if (!Object.prototype.hasOwnProperty.call(metadata, 'accountBinding'))
    return metadata;
  return {
    ...metadata,
    accountBinding: parseSessionAccountBinding(metadata.accountBinding),
  };
}

/**
 * List reads never fail as a whole for one bad row. A row whose binding does
 * not parse keeps its stored `accountBinding`, so it never reads as ambient;
 * single-session reads and every account gate still refuse it.
 */
function listAccountLinkage(value: unknown): SessionMetadata {
  const metadata = value as SessionMetadata;
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !Object.prototype.hasOwnProperty.call(metadata, 'accountBinding')
  )
    return metadata;
  const parsed = accountBindingSchema.safeParse(metadata.accountBinding);
  if (!parsed.success) return metadata;
  return {
    ...metadata,
    accountBinding: Object.freeze({
      ...parsed.data,
      identity: Object.freeze(parsed.data.identity),
    }),
  };
}

function sameAccountBinding(
  left: ProviderAccountBinding,
  right: ProviderAccountBinding,
): boolean {
  return (
    JSON.stringify(parseSessionAccountBinding(left)) ===
    JSON.stringify(parseSessionAccountBinding(right))
  );
}

/**
 * Session metadata - UI state only, NOT message storage
 */
export interface SessionMetadata {
  /** Native thread binding; rollout history remains owned by Codex. */
  readonly codexExecution?: CodexExecution;

  /** Context-to-thread mapping for native resume; written with `codexExecution`. */
  readonly codexThread?: CodexThreadRecord;

  /** Two visible messages per completed native turn: user prompt and assistant reply. */
  readonly codexMessageCount?: number;

  /**
   * Real SDK session UUID (from system 'init' message)
   * This is the filename in ~/.claude/projects/
   */
  readonly sessionId: string;

  /** Canonical provider of the latest launched root turn, when known. */
  readonly providerId?: string;

  /** Immutable opaque registry linkage. Absence alone is legacy ambient metadata. */
  readonly accountBinding?: ProviderAccountBinding;

  /**
   * User-friendly session name
   */
  readonly name: string;

  /**
   * Workspace path for this session
   */
  readonly workspaceId: string;

  /**
   * Session creation timestamp
   */
  readonly createdAt: number;

  /**
   * Last activity timestamp (for sorting)
   */
  readonly lastActiveAt: number;

  /**
   * Accumulated cost from result messages (USD)
   */
  readonly totalCost: number;

  /**
   * Accumulated tokens from result messages
   */
  readonly totalTokens: {
    readonly input: number;
    readonly output: number;
  };

  /** CLI agent sessions linked to this parent session. Enables resume. */
  readonly cliSessions?: readonly CliSessionReference[];

  /**
   * Exact process working directory used by the SDK session. This can differ
   * from workspaceId when the session runs in a git worktree.
   */
  readonly workingDirectory?: string;

  /**
   * Interrupted SDK subagents that can be resumed after host restart.
   * Rival CLI/background/running/completed records never belong here.
   */
  readonly resumableSdkSubagents?: readonly SubagentRecord[];

  /** When true, this session is a child/subagent session (e.g., Ptah CLI agent spawned
   *  by a parent orchestrator). Child sessions are hidden from the sidebar session list. */
  readonly isChildSession?: boolean;
}

/**
 * Bulk output captured from one CLI agent, stored under its OWN key.
 *
 * `streamEvents` used to be embedded in the `CliSessionReference` inside the
 * all-sessions blob. An agent can accumulate 50 000 of them
 * (`MAX_ACCUMULATED_STREAM_EVENTS`), and every session metadata write
 * re-serializes EVERY session — so N agents spawning and exiting cost
 * O(N² × events) bytes of JSON on the main thread (TASK_2026_323 blocker B5).
 * Splitting them onto a per-agent key makes that cost O(N × events), paid once
 * at exit, and leaves the hot all-sessions blob small enough to rewrite freely.
 */
export interface PersistedAgentOutput {
  /** Agent this output belongs to (same value as `CliSessionReference.agentId`). */
  readonly agentId: string;
  /** When the snapshot was taken (ms epoch). */
  readonly savedAt: number;
  /** Full structured segments (already capped upstream at 500). */
  readonly segments?: readonly CliOutputSegment[];
  /** Rich stream events for the execution-tree renderer (Ptah CLI only). */
  readonly streamEvents?: readonly FlatStreamEventUnion[];
}

/**
 * Storage key for session metadata
 */
const STORAGE_KEY = 'ptah.sessionMetadata';

/**
 * The part of Electron's WorkspaceAwareStateStorage this store reads. Duck-typed
 * so VS Code's single workspace storage keeps the old behaviour.
 */
interface WorkspaceRoutedStorage {
  getActiveWorkspacePath(): string | null;
  getStorageForWorkspace(workspacePath: string): IStateStorage | undefined;
}

function isWorkspaceRouted(
  storage: IStateStorage,
): storage is IStateStorage & WorkspaceRoutedStorage {
  const candidate = storage as Partial<WorkspaceRoutedStorage>;
  return (
    typeof candidate.getActiveWorkspacePath === 'function' &&
    typeof candidate.getStorageForWorkspace === 'function'
  );
}

const normalizeWorkspaceId = (workspaceId: string): string => {
  const normalized = workspaceId.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};
const SESSION_DETAIL_KEY_PREFIX = 'ptah.session:';

/** Key prefix for per-agent bulk output. One key per agent, written once. */
const AGENT_OUTPUT_KEY_PREFIX = 'ptah.agentOutput:';

const SESSION_INDEX_SCHEMA_VERSION = 1;

interface SessionMetadataIndex {
  readonly schemaVersion: typeof SESSION_INDEX_SCHEMA_VERSION;
  readonly items: readonly SessionMetadata[];
}

export type TaggedAgentOutputItem =
  | { readonly tag: 'segment'; readonly value: CliOutputSegment }
  | { readonly tag: 'streamEvent'; readonly value: FlatStreamEventUnion };

/** Declarative recipe executed by Electron's generic storage worker. */
export const SESSION_METADATA_MIGRATION: StateStorageArraySplitPlan = {
  kind: 'split-array-value',
  planVersion: 1,
  sourceKey: STORAGE_KEY,
  itemIdPath: ['sessionId'],
  detailKeyPrefix: SESSION_DETAIL_KEY_PREFIX,
  indexKey: STORAGE_KEY,
  indexSchemaVersion: SESSION_INDEX_SCHEMA_VERSION,
  summaryFields: [
    { sourcePath: ['sessionId'] },
    { sourcePath: ['providerId'] },
    { sourcePath: ['accountBinding'] },
    { sourcePath: ['name'] },
    { sourcePath: ['workspaceId'] },
    { sourcePath: ['createdAt'] },
    { sourcePath: ['lastActiveAt'] },
    { sourcePath: ['totalCost'] },
    { sourcePath: ['totalTokens'] },
    { sourcePath: ['isChildSession'] },
  ],
  nestedExtractions: [
    {
      sourceArrayPath: ['cliSessions'],
      itemIdPath: ['agentId'],
      destinationKeyPrefix: AGENT_OUTPUT_KEY_PREFIX,
      fields: [{ sourcePath: ['segments'] }, { sourcePath: ['streamEvents'] }],
      destinationFormat: {
        kind: 'tagged-sequence',
        fields: [
          { sourcePath: ['segments'], tag: 'segment' },
          { sourcePath: ['streamEvents'], tag: 'streamEvent' },
        ],
      },
      onMissingId: 'drop-bulk',
      dropFields: [['stdout']],
      textFallback: {
        sourcePath: ['stdout'],
        itemTemplate: { tag: 'segment', value: { type: 'text', content: '' } },
        contentPath: ['value', 'content'],
      },
      conflictPolicy: {
        kind: 'prefer-longer-arrays',
        fields: ['segments', 'streamEvents'],
      },
    },
  ],
};

export const SESSION_METADATA_WORKER_CACHE_EXCLUSIONS = [
  SESSION_DETAIL_KEY_PREFIX,
  AGENT_OUTPUT_KEY_PREFIX,
] as const;

function sessionDetailKey(sessionId: string): string {
  return `${SESSION_DETAIL_KEY_PREFIX}${sessionId}`;
}

const DETAIL_PROJECTION: StateStorageValueProjection = {
  omit: [
    ['cliSessions', '*', 'stdout'],
    ['cliSessions', '*', 'segments'],
    ['cliSessions', '*', 'streamEvents'],
  ],
};
const DETAIL_READ_OPTIONS: StateStorageGetOptions = {
  projection: DETAIL_PROJECTION,
};
const REFERENCE_BULK_FIELDS = ['stdout', 'segments', 'streamEvents'] as const;
const MAX_RPC_RESPONSE_BYTES = 256 * 1024;
const RPC_CORRELATION_ID_BUDGET = '0'.repeat(64);
const RPC_CURSOR_RESERVATION = '0'.repeat(32);
const RECORD_OUTPUT_CURSOR_PATTERN = /^s(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export class AgentOutputCursorStaleError extends SdkError {
  constructor(readonly agentId: string) {
    super('Agent output cursor is stale');
    this.name = 'AgentOutputCursorStaleError';
  }
}

function agentOutputKey(agentId: string): string {
  return `${AGENT_OUTPUT_KEY_PREFIX}${agentId}`;
}

/** Blob name of an agent's output inside its session's folder (PTAH-35). */
export function agentOutputBlobName(agentId: string): string {
  return `agent-output.${agentId}`;
}

/** Keys of the per-workspace store this module wrote before PTAH-35. */
export const LEGACY_SESSION_STORAGE_KEYS = {
  index: STORAGE_KEY,
  detailPrefix: SESSION_DETAIL_KEY_PREFIX,
  agentOutputPrefix: AGENT_OUTPUT_KEY_PREFIX,
} as const;

/** Lean listing entry: the record without its CLI references. */
export function sessionIndexEntry(metadata: SessionMetadata): SessionMetadata {
  const entry = { ...validateAccountLinkage(metadata) };
  delete entry.cliSessions;
  return entry;
}

/**
 * Index entry for a row this store did not just write. A stored row whose
 * account binding no longer parses keeps its stored binding and stays in the
 * index (one bad row must not fail every write); the row a write targets
 * stays strict in `_saveInternal` before it is staged.
 */
function preservedIndexEntry(metadata: SessionMetadata): SessionMetadata {
  try {
    return sessionIndexEntry(metadata);
  } catch (error: unknown) {
    // Only an unparseable stored binding is tolerated here; reads of that row
    // through get() and every account gate still refuse it.
    if (!(error instanceof SessionAccountBindingError)) throw error;
    const entry = { ...metadata };
    delete entry.cliSessions;
    return entry;
  }
}

/** A session as a global-store row. */
export function toSessionRecordInput(
  detail: SessionMetadata,
): SessionRecordInput {
  return {
    sessionId: detail.sessionId,
    workspacePath: detail.workspaceId,
    name: detail.name,
    createdAt: detail.createdAt,
    lastActiveAt: detail.lastActiveAt,
    isChild: detail.isChildSession === true,
    summary: { ...sessionIndexEntry(detail) },
    detail: { ...validateAccountLinkage(detail) },
  };
}

function parseRecordOutputCursor(
  agentId: string,
  cursor: string | undefined,
  savedAt: number | null,
  itemCount: number,
): number {
  if (cursor === undefined) return 0;
  const match = RECORD_OUTPUT_CURSOR_PATTERN.exec(cursor);
  const cursorSavedAt = match ? Number(match[1]) : Number.NaN;
  const index = match ? Number(match[2]) : Number.NaN;
  if (!Number.isSafeInteger(cursorSavedAt) || !Number.isSafeInteger(index)) {
    throw new SdkError('Invalid agent output cursor');
  }
  if (savedAt !== cursorSavedAt || index > itemCount) {
    throw new AgentOutputCursorStaleError(agentId);
  }
  return index;
}

interface AgentOutputPage {
  items: readonly TaggedAgentOutputItem[];
  nextCursor: string | null;
  done: boolean;
}

interface AgentOutputPageBudget {
  readonly rpcBytes: number;
  readonly jsonEnvelopeBytes: number;
  readonly itemBytes: number;
}

function rpcOutputPageBytes(
  items: readonly TaggedAgentOutputItem[],
  nextCursor: string | null,
  done: boolean,
): number {
  return new TextEncoder().encode(
    JSON.stringify({
      success: true,
      data: { items, nextCursor, done },
      correlationId: RPC_CORRELATION_ID_BUDGET,
    }),
  ).byteLength;
}

function isNonEmptyBulk(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string' || Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
}

function countReferencesWithBulk(metadata: SessionMetadata): number {
  return (metadata.cliSessions ?? []).filter((ref) =>
    REFERENCE_BULK_FIELDS.some((field) => isNonEmptyBulk(ref[field])),
  ).length;
}

/**
 * A restored reference carries its `quotaOwner` and `modelScope` only when
 * they validate. A
 * malformed or legacy value — including an older build's bare `quotaOwnerKey`,
 * which is dropped too — restores with no owner, which renders as "Unknown
 * owner". It is never replaced by the session's current owner.
 *
 * A non-object entry (persisted `null`, a string, a number) passes through
 * unchanged, as the restore path returned it before this seam existed: the `in`
 * checks below would throw on it, and restore must never throw.
 */
function restoreQuotaOwner(ref: CliSessionReference): CliSessionReference {
  if (typeof ref !== 'object' || ref === null) return ref;
  const stored = ref as CliSessionReference & { quotaOwnerKey?: unknown };
  if (
    !('quotaOwner' in stored) &&
    !('quotaOwnerKey' in stored) &&
    !('modelScope' in stored)
  ) {
    return ref;
  }
  const { quotaOwner, quotaOwnerKey: _legacy, modelScope, ...rest } = stored;
  const owner = parseQuotaOwnerRef(quotaOwner);
  const scope =
    modelScope === null || typeof modelScope === 'string' ? { modelScope } : {};
  return owner
    ? { ...rest, quotaOwner: owner, ...scope }
    : { ...rest, ...scope };
}

/**
 * Every live store, so a host's shutdown path can drain the coalesced write
 * queue without holding a container reference.
 *
 * `apps/ptah-cli/src/main.ts` installs its signal handlers before any container
 * exists — `withEngine` owns every container it builds — which is the same
 * reason `CliDIContainer` keeps its `flushSync` target in a static. Weak
 * references so a discarded container's store is still collectable.
 */
const LIVE_STORES = new Set<WeakRef<SessionMetadataStore>>();

/**
 * Flush every live {@link SessionMetadataStore}'s staged snapshot.
 *
 * The store coalesces a burst of mutations into one `IStateStorage.update` at
 * the end of the write-queue drain. That is durable for anything awaited, but a
 * failed flush stays staged and a mutation made by a fire-and-forget caller can
 * still be in flight when the host is told to quit — so every shutdown path
 * calls this (TASK_2026_324 finding 3). Never throws: a host teardown must not
 * be derailed by a storage that is already going away.
 */
export async function flushSessionMetadataStores(): Promise<void> {
  const live: SessionMetadataStore[] = [];
  for (const weak of LIVE_STORES) {
    const store = weak.deref();
    if (store) live.push(store);
    else LIVE_STORES.delete(weak);
  }
  await Promise.all(live.map((store) => store.flushForShutdown()));
}

/**
 * Session Metadata Store
 *
 * Minimal storage for session UI metadata.
 * Relies on SDK's native ~/.claude/projects/ for message persistence.
 */
@injectable()
export class SessionMetadataStore {
  /**
   * WorkspaceAwareStateStorage which delegates to per-workspace storage based
   * on the active workspace. In VS Code, it resolves to the single workspace
   * state storage as before.
   */

  /**
   * Write serialization queue. Prevents concurrent read-modify-write races
   * when multiple CLI agents exit simultaneously and call addCliSession().
   * Each write waits for the previous one to complete before reading fresh data.
   */
  private writeQueue: Promise<void> = Promise.resolve();

  /**
   * Number of write operations currently queued (running or waiting).
   * Only the LAST one to finish flushes {@link pendingAll} to storage — see
   * {@link settleWrite}.
   */
  private queueDepth = 0;

  /**
   * The all-sessions array as mutated by writes that have not yet reached
   * storage. Non-null only between a staged mutation and its flush, which is
   * always within the same write-queue drain, so a workspace switch cannot
   * slip in between. Reads consult it so a caller never observes its own write
   * as missing.
   */
  private pendingAll: SessionMetadata[] | null = null;

  /**
   * Records of sessions whose workspace was not the active one when they were
   * written (Plane PTAH-32). The storage follows the active workspace, so
   * writing them would land them in another workspace's store, where neither
   * list shows them. They wait here, appear in their own workspace's list, and
   * move into storage on the first read made while that workspace is active.
   * MP-1 (one session store keyed by project) replaces this.
   */
  private readonly strays = new Map<string, SessionMetadata>();
  private strayRestoreQueued = false;

  /**
   * True when `workspaceId` is another registered workspace than the active
   * one. An unregistered or unknown id keeps the old behaviour, so a path
   * spelled differently can never strand a record in memory.
   */
  private isForeignWorkspace(workspaceId: string): boolean {
    if (this.records) return false;
    if (!isWorkspaceRouted(this.storage)) return false;
    const active = this.storage.getActiveWorkspacePath();
    if (active === null) return false;
    if (normalizeWorkspaceId(active) === normalizeWorkspaceId(workspaceId)) {
      return false;
    }
    return this.storage.getStorageForWorkspace(workspaceId) !== undefined;
  }

  /** Adds this workspace's strays to a listing and queues their persistence. */
  private withStrays(items: SessionMetadata[]): SessionMetadata[] {
    if (this.strays.size === 0) return items;
    const local = [...this.strays.values()].filter(
      (stray) => !this.isForeignWorkspace(stray.workspaceId),
    );
    if (local.length === 0) return items;
    for (const stray of local) {
      const index = items.findIndex((m) => m.sessionId === stray.sessionId);
      if (index >= 0) items[index] = stray;
      else items.push(stray);
    }
    this.queueStrayRestore();
    return items;
  }

  private queueStrayRestore(): void {
    if (this.strayRestoreQueued) return;
    this.strayRestoreQueued = true;
    void this.enqueueWrite(async () => {
      this.strayRestoreQueued = false;
      for (const stray of [...this.strays.values()]) {
        if (this.isForeignWorkspace(stray.workspaceId)) continue;
        this.strays.delete(stray.sessionId);
        try {
          await this._saveInternal(stray);
        } catch (error: unknown) {
          this.strays.set(stray.sessionId, stray);
          throw error;
        }
      }
    }).catch((error: unknown) => {
      this.logger.warn(
        '[SessionMetadataStore] Could not persist metadata kept in memory; will retry on the next read',
        error instanceof Error ? error : new Error(String(error)),
      );
    });
  }

  private async readStorage<T>(key: string): Promise<T | undefined> {
    return isAsyncStateStorage(this.storage)
      ? await this.storage.getAsync<T>(key)
      : this.storage.get<T>(key);
  }

  private indexEntry(metadata: SessionMetadata): SessionMetadata {
    return sessionIndexEntry(metadata);
  }

  /**
   * Emits `session:metadataChanged` events after each successful mutation
   * (create / save / rename / delete). The wiring layer
   * ({@link wireSessionMetadataChangeBroadcast}) subscribes to this and
   * broadcasts the payload to all open webviews so sidebars refresh
   * without needing imperative `loadSessions()` calls everywhere.
   */
  private readonly events = new EventEmitter<{
    metadataChanged: (payload: SessionMetadataChangedNotification) => void;
  }>();

  /**
   * One session store for every project (PTAH-35). Bound on Electron and the
   * CLI; when present, metadata never touches the workspace-routed storage, so
   * a write lands under the session's own project whatever the UI has open.
   * Absent on VS Code, which keeps the storage path below.
   */
  constructor(
    @inject(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE)
    private storage: IStateStorage,
    @inject(TOKENS.LOGGER) private logger: Logger,
    @inject(PLATFORM_TOKENS.SESSION_RECORD_REPOSITORY, { isOptional: true })
    private readonly records?: ISessionRecordRepository,
    @inject(PLATFORM_TOKENS.SESSION_BLOB_STORE, { isOptional: true })
    private readonly blobs?: ISessionBlobStore,
    @inject(PLATFORM_TOKENS.SESSION_STORE_GATE, { isOptional: true })
    private readonly gate?: ISessionStoreGate,
  ) {
    LIVE_STORES.add(new WeakRef(this));
  }

  /**
   * With the global store, agent output lives in its session's folder, so the
   * caller must say which session. Without it the output would fall back to
   * the workspace-routed storage this store exists to leave.
   */
  private sessionBlobs(sessionId: string | undefined): {
    blobs: ISessionBlobStore;
    sessionId: string;
  } | null {
    if (!this.records) return null;
    if (!this.blobs) {
      throw new SdkError(
        'Session blob store is not registered next to the session record repository',
      );
    }
    if (blankToUndefined(sessionId) === undefined) {
      throw new SdkError(
        'Agent output needs a session id when the global session store is used',
      );
    }
    return { blobs: this.blobs, sessionId: sessionId as string };
  }

  /**
   * Subscribe to session metadata change events.
   * Returns an unsubscribe function for symmetric teardown.
   */
  onMetadataChanged(
    listener: (payload: SessionMetadataChangedNotification) => void,
  ): () => void {
    this.events.on('metadataChanged', listener);
    return () => this.events.off('metadataChanged', listener);
  }

  private emitChange(
    kind: SessionMetadataChangeKind,
    sessionId: string,
    workspaceId: string,
  ): void {
    try {
      this.events.emit('metadataChanged', { kind, sessionId, workspaceId });
    } catch (err) {
      this.logger.warn(
        '[SessionMetadataStore] metadataChanged listener threw',
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  /**
   * Save or update session metadata.
   * Serialized through writeQueue to prevent concurrent read-modify-write races.
   *
   * Emits `metadataChanged` with `kind: 'updated'`. Callers that need a
   * different kind (e.g. `create()` → `'created'` / `'forked'`) bypass this
   * method and call {@link _saveInternal} directly so they own the emission.
   */
  async save(metadata: SessionMetadata): Promise<void> {
    await this.enqueueWrite(() => this._saveInternal(metadata));
    this.emitChange('updated', metadata.sessionId, metadata.workspaceId);
  }

  /** Named import checkpoint. Same SDK id on another route is an explicit refusal.
   * This writes metadata only; callers must commit/attach the registry binding
   * first and must not admit a query until both checkpoints have succeeded.
   */
  async saveAccountBound(
    metadata: SessionMetadata,
    binding: ProviderAccountBinding,
  ): Promise<void> {
    const accountBinding = parseSessionAccountBinding(binding);
    if (
      Object.prototype.hasOwnProperty.call(metadata, 'accountBinding') &&
      !sameAccountBinding(
        parseSessionAccountBinding(metadata.accountBinding),
        accountBinding,
      )
    ) {
      throw new SessionAccountBindingError('binding-conflict');
    }
    await this.save({ ...metadata, accountBinding });
  }

  /** Use before import's existing-record shortcut, so a collision cannot be skipped. */
  async getAccountBound(
    sessionId: string,
    binding: ProviderAccountBinding,
  ): Promise<SessionMetadata | null> {
    const expected = parseSessionAccountBinding(binding);
    const existing = await this.get(sessionId);
    if (
      existing &&
      (!existing.accountBinding ||
        !sameAccountBinding(existing.accountBinding, expected))
    ) {
      throw new SessionAccountBindingError('binding-conflict');
    }
    return existing;
  }

  /** The callback MUST query the server by SDK session id, never a local index.
   * Resolve it before reading/classifying legacy metadata. A missing local field
   * cannot erase a server binding, including for a top-level lane.
   */
  async resolveAccountBinding(
    sessionId: string,
    lookup: (sdkSessionId: string) => Promise<SessionAccountBindingLookup>,
  ): Promise<ProviderAccountBinding | null> {
    const authoritative = await lookup(sessionId);
    if (
      authoritative.status === 'unavailable-storage' ||
      authoritative.status === 'invalid-bound'
    ) {
      throw new SessionAccountBindingError(authoritative.status);
    }
    const metadata = await this.get(sessionId);
    if (authoritative.status !== 'bound') {
      if (metadata?.accountBinding)
        throw new SessionAccountBindingError('invalid-bound');
      return null;
    }
    const binding = parseSessionAccountBinding(authoritative.binding);
    if (!metadata?.accountBinding)
      throw new SessionAccountBindingError('linkage-incomplete');
    if (!sameAccountBinding(metadata.accountBinding, binding)) {
      throw new SessionAccountBindingError('binding-conflict');
    }
    if (binding.identity.kind === 'unknown')
      throw new SessionAccountBindingError('identity-unproved');
    return binding;
  }

  /**
   * The only writer of native runtime identity. The session key is the thread id.
   * A non-empty `title` (the caller's chat title, the way `create` receives the
   * Claude name) fills a missing name and replaces a name that is still the
   * session id; a stored name that differs from the session id always wins.
   */
  async updateCodexExecution(
    sessionId: SessionId,
    updater: (current: CodexExecution | undefined) => CodexExecution,
    thread?: CodexThreadRecordUpdater,
    title?: string,
  ): Promise<void> {
    let kind: SessionMetadataChangeKind = 'created';
    let workspaceId = '';
    let skipped = false;
    await this.enqueueWrite(async () => {
      // Read authoritative detail without invoking Claude account gates. Lean
      // listings omit child references and must not replace an existing detail.
      let existing = this.strays.get(sessionId);
      if (!existing && this.records) {
        await this.gate?.whenReady();
        const record = await this.records.get(sessionId);
        existing = record ? validateAccountLinkage(record.detail) : undefined;
      } else if (!existing && isAsyncStateStorage(this.storage)) {
        existing = await this.storage.getAsync<SessionMetadata>(
          sessionDetailKey(sessionId),
          undefined,
          DETAIL_READ_OPTIONS,
        );
      }
      if (!existing && !this.records) {
        existing = (await this.getAll()).find(
          (row) => row.sessionId === sessionId,
        );
      }
      // The thread updater runs inside the queued write, so its compare and
      // the write are atomic; returning the current record skips the write.
      const currentThread = parseCodexThreadRecord(existing?.codexThread);
      const nextThread = thread?.(
        currentThread,
        existing?.codexExecution
          ? structuredClone(existing.codexExecution)
          : undefined,
      );
      if (thread && nextThread === currentThread) {
        skipped = true;
        return;
      }
      if (existing && !existing.codexExecution) {
        throw new CodexSessionMetadataError(
          'legacy-conversion',
          'Cannot convert a legacy session to Codex',
        );
      }
      if (existing?.accountBinding) {
        throw new CodexSessionMetadataError(
          'account-linkage',
          'Codex sessions cannot carry account linkage',
        );
      }
      kind = existing ? 'updated' : 'created';
      const proposed = updater(
        existing?.codexExecution
          ? structuredClone(existing.codexExecution)
          : undefined,
      );
      const parsed = SessionRuntimeIdentitySchema.safeParse({
        ...proposed,
        workspaceId: normalizeCodexWorkspaceKey(
          proposed.workspaceId,
          process.platform,
        ),
      });
      if (
        !parsed.success ||
        parsed.data.runtime !== 'codex-app-server' ||
        parsed.data.sessionId !== sessionId
      ) {
        throw new CodexSessionMetadataError(
          'invalid-identity',
          'Invalid Codex session identity',
        );
      }
      const execution = parsed.data;
      if (
        existing?.codexExecution &&
        (existing.codexExecution.providerId !== execution.providerId ||
          existing.codexExecution.workspaceId !== execution.workspaceId ||
          existing.codexExecution.codex.normalizedHome !==
            execution.codex.normalizedHome)
      ) {
        throw new CodexSessionMetadataError(
          'binding-change',
          'Cannot change a Codex session binding',
        );
      }
      if (this.isForeignWorkspace(execution.workspaceId)) {
        throw new CodexSessionMetadataError(
          'unavailable-storage',
          'Codex session storage is unavailable for this workspace',
        );
      }
      const threadRecord = nextThread
        ? codexThreadRecordSchema.safeParse(nextThread)
        : undefined;
      if (
        threadRecord &&
        (!threadRecord.success ||
          !sameCodexWorkspace(
            threadRecord.data.workspaceId,
            execution.workspaceId,
          ))
      ) {
        throw new CodexSessionMetadataError(
          'invalid-identity',
          'Invalid Codex thread mapping',
        );
      }
      // Keep an existing caller path only when it belongs to this workspace.
      // Repair old normalized keys and damaged or foreign stored paths.
      const storedWorkspaceId = existing?.workspaceId;
      let storedCallerPath: string | undefined;
      if (storedWorkspaceId && storedWorkspaceId !== execution.workspaceId) {
        try {
          if (
            normalizeCodexWorkspaceKey(storedWorkspaceId, process.platform) ===
            execution.workspaceId
          ) {
            storedCallerPath = storedWorkspaceId;
          }
        } catch {
          storedCallerPath = undefined;
        }
      }
      workspaceId = storedCallerPath ?? proposed.workspaceId;
      const now = Date.now();
      const detail: SessionMetadata = {
        ...existing,
        sessionId,
        name: codexSessionName(existing?.name, sessionId, title),
        workspaceId,
        providerId: execution.providerId,
        codexExecution: execution,
        ...(threadRecord?.success ? { codexThread: threadRecord.data } : {}),
        createdAt: existing?.createdAt ?? now,
        lastActiveAt: now,
        totalCost: existing?.totalCost ?? 0,
        totalTokens: existing?.totalTokens ?? { input: 0, output: 0 },
      };
      await this.persistMetadata(detail);
      // Identity is a launch checkpoint, durable even when other writes are queued.
      await this.flush();
    });
    if (!skipped) this.emitChange(kind, sessionId, workspaceId);
  }

  /** Serialize native turn counts with all other metadata writes. Legacy rows start at zero. */
  async incrementCodexMessageCount(sessionId: SessionId): Promise<void> {
    let workspaceId: string | undefined;
    await this.enqueueWrite(async () => {
      const current = await this.get(sessionId);
      if (current?.codexExecution?.runtime !== 'codex-app-server') {
        throw new CodexSessionMetadataError(
          'invalid-identity',
          'Cannot count messages for a non-native Codex session',
        );
      }
      const previous = codexMessageCount(current.codexMessageCount);
      if (previous > Number.MAX_SAFE_INTEGER - 2) {
        throw new CodexSessionMetadataError(
          'invalid-identity',
          'Native Codex message count overflow',
        );
      }
      workspaceId = current.workspaceId;
      await this.persistMetadata({
        ...current,
        codexMessageCount: previous + 2,
      });
    });
    if (workspaceId) this.emitChange('updated', sessionId, workspaceId);
  }

  /**
   * Internal save implementation (NOT serialized).
   * Called directly by addCliSession() and other mutations that already enqueue their own writes.
   * Public callers must use save() which wraps this in enqueueWrite().
   */
  private async _saveInternal(
    metadata: SessionMetadata,
    providerOverride?: string,
  ): Promise<void> {
    metadata = validateAccountLinkage(metadata);
    const existing = await this.get(metadata.sessionId);
    if (
      (metadata.codexExecution !== undefined &&
        JSON.stringify(metadata.codexExecution) !==
          JSON.stringify(existing?.codexExecution)) ||
      (metadata.codexThread !== undefined &&
        JSON.stringify(metadata.codexThread) !==
          JSON.stringify(existing?.codexThread)) ||
      (metadata.codexMessageCount !== undefined &&
        metadata.codexMessageCount !== existing?.codexMessageCount)
    ) {
      throw new CodexSessionMetadataError(
        'direct-runtime-write',
        'Use updateCodexExecution to write runtime metadata',
      );
    }
    if (
      existing?.codexExecution &&
      providerOverride &&
      providerOverride !== existing.providerId
    ) {
      throw new CodexSessionMetadataError(
        'binding-change',
        'Cannot change a Codex session binding',
      );
    }
    if (existing?.codexExecution && metadata.accountBinding) {
      throw new CodexSessionMetadataError(
        'account-linkage',
        'Codex sessions cannot carry account linkage',
      );
    }
    if (
      metadata.accountBinding &&
      existing &&
      (!existing.accountBinding ||
        !sameAccountBinding(existing.accountBinding, metadata.accountBinding))
    ) {
      throw new SessionAccountBindingError('binding-conflict');
    }
    const merged: SessionMetadata = {
      ...metadata,
      ...(existing?.codexExecution
        ? {
            codexExecution: existing.codexExecution,
            workspaceId: existing.workspaceId,
          }
        : {}),
      ...(existing?.codexThread ? { codexThread: existing.codexThread } : {}),
      ...(existing?.codexExecution && existing.codexMessageCount !== undefined
        ? { codexMessageCount: existing.codexMessageCount }
        : {}),
      ...(existing?.accountBinding
        ? { accountBinding: existing.accountBinding }
        : {}),
      ...(existing?.isChildSession && !metadata.isChildSession
        ? { isChildSession: true }
        : {}),
      ...(existing?.cliSessions && !metadata.cliSessions
        ? { cliSessions: existing.cliSessions }
        : {}),
      ...(existing?.workingDirectory && !metadata.workingDirectory
        ? { workingDirectory: existing.workingDirectory }
        : {}),
      ...(existing?.providerId ? { providerId: existing.providerId } : {}),
      ...(providerOverride ? { providerId: providerOverride } : {}),
      ...(existing?.resumableSdkSubagents &&
      metadata.resumableSdkSubagents === undefined
        ? { resumableSdkSubagents: existing.resumableSdkSubagents }
        : {}),
    };
    await this.persistMetadata(merged);
  }

  private async persistMetadata(metadata: SessionMetadata): Promise<void> {
    if (this.isForeignWorkspace(metadata.workspaceId)) {
      if (metadata.accountBinding)
        throw new SessionAccountBindingError('unavailable-storage');
      if (!this.strays.has(metadata.sessionId)) {
        this.logger.info(
          '[SessionMetadataStore] Session belongs to an inactive workspace; keeping its metadata in memory until that workspace is active',
          { sessionId: metadata.sessionId, workspaceId: metadata.workspaceId },
        );
      }
      this.strays.set(metadata.sessionId, metadata);
      return;
    }
    this.strays.delete(metadata.sessionId);
    const strippedBulkRefCount = countReferencesWithBulk(metadata);
    const detail =
      strippedBulkRefCount > 0
        ? omitJsonPaths(metadata, DETAIL_PROJECTION.omit)
        : metadata;
    if (strippedBulkRefCount > 0) {
      this.logger.info(
        '[SessionMetadataStore] Stripped bulk output from CLI session references',
        { sessionId: metadata.sessionId, strippedBulkRefCount },
      );
    }

    if (this.records) {
      // One row per session: nothing to coalesce, so it is written at once.
      await this.records.upsert(toSessionRecordInput(detail));
    } else if (isAsyncStateStorage(this.storage)) {
      // Detail first, lean index second. Readers never observe an index entry
      // whose authoritative detail has not reached durable storage.
      await this.storage.update(sessionDetailKey(metadata.sessionId), detail);
      const all = await this.getAll();
      const index = all.findIndex((m) => m.sessionId === metadata.sessionId);
      const summary = this.indexEntry(detail);
      if (index >= 0) all[index] = summary;
      else all.push(summary);
      this.stage(all);
    } else {
      const all = await this.getAll();
      const index = all.findIndex((m) => m.sessionId === metadata.sessionId);
      if (index >= 0) all[index] = detail;
      else all.push(detail);
      this.stage(all);
    }
    // A named checkpoint must flush even when another write is queued. The
    // ordinary coalesced queue may otherwise resolve this caller before I/O.
    if (metadata.accountBinding) await this.flush();
    this.logger.debug(
      `[SessionMetadataStore] Staged metadata for session ${metadata.sessionId}`,
    );
  }

  /**
   * Record the new all-sessions array without touching storage. The flush is
   * deferred to the end of the write-queue drain ({@link settleWrite}), so a
   * burst of writes — ten CLI agents exiting at once, or the re-persist pass
   * that runs for every exited agent when a session id resolves — serializes
   * the blob ONCE instead of once per event (TASK_2026_323 blocker B5).
   *
   * This is a coalesce, not a write-behind: `await save()` still resolves only
   * after the value has reached `IStateStorage`, because the flush happens
   * inside the awaited queue entry. Nothing is lost if the process exits.
   */
  private stage(all: SessionMetadata[]): void {
    this.pendingAll = all;
  }

  /**
   * Write the staged snapshot, if any. Public so a host can force durability
   * at a checkpoint; normally called for you when the write queue drains.
   *
   * `pendingAll` is cleared only AFTER the update resolves, and only when it is
   * still the snapshot we wrote — otherwise an unqueued reader would fall back
   * to storage that has not caught up yet, and a write landing mid-flush would
   * be discarded.
   */
  async flush(): Promise<void> {
    const snapshot = this.pendingAll;
    if (!snapshot) return;
    await this.storage.update(
      STORAGE_KEY,
      isAsyncStateStorage(this.storage)
        ? {
            schemaVersion: SESSION_INDEX_SCHEMA_VERSION,
            items: snapshot.map(preservedIndexEntry),
          }
        : snapshot,
    );
    if (this.pendingAll === snapshot) {
      this.pendingAll = null;
    }
  }

  /**
   * {@link flush} for a host teardown: never throws, always logs.
   *
   * The three shutdown paths reach this through
   * {@link flushSessionMetadataStores}. A quit must not be turned into a crash
   * by a storage that is already closing, and there is no caller left to hand
   * the rejection to.
   */
  async flushForShutdown(): Promise<void> {
    if (this.strays.size > 0) {
      this.logger.warn(
        '[SessionMetadataStore] Shutdown with session metadata still in memory for inactive workspaces — not persisted',
        { sessionIds: [...this.strays.keys()] },
      );
    }
    try {
      await this.flush();
    } catch (error: unknown) {
      this.logger.warn(
        '[SessionMetadataStore] Shutdown flush failed — staged session metadata lost',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Get metadata by session ID
   */
  async get(sessionId: string): Promise<SessionMetadata | null> {
    const stray = this.strays.get(sessionId);
    if (stray) return validateAccountLinkage({ ...stray });
    if (this.records) {
      await this.gate?.whenReady();
      const record = await this.records.get(sessionId);
      return record
        ? validateAccountLinkage(
            omitJsonPaths(
              validateAccountLinkage(record.detail),
              DETAIL_PROJECTION.omit,
            ),
          )
        : null;
    }
    if (isAsyncStateStorage(this.storage)) {
      const detail = await this.storage.getAsync<SessionMetadata>(
        sessionDetailKey(sessionId),
        undefined,
        DETAIL_READ_OPTIONS,
      );
      if (detail) return validateAccountLinkage(detail);
    }
    const all = await this.getAll();
    const summary = all.find((m) => m.sessionId === sessionId);
    return summary
      ? validateAccountLinkage(omitJsonPaths(summary, DETAIL_PROJECTION.omit))
      : null;
  }

  /**
   * Persist the process-resume state owned by chat orchestration.
   *
   * The filter is deliberately repeated at the storage boundary: callers may
   * pass a registry snapshot, but only interrupted foreground SDK subagents
   * belonging to this canonical session are durable.
   */
  async saveResumeState(
    sessionId: string,
    state: {
      workingDirectory?: string;
      resumableSdkSubagents: readonly SubagentRecord[];
    },
  ): Promise<void> {
    await this.enqueueWrite(async () => {
      const metadata = await this.get(sessionId);
      if (!metadata) {
        this.logger.warn(
          `[SessionMetadataStore] Cannot save resume state for missing session ${sessionId}`,
        );
        return;
      }

      const resumableSdkSubagents = state.resumableSdkSubagents
        .filter(
          (record) =>
            record.status === 'interrupted' &&
            record.parentSessionId === sessionId &&
            !record.isBackground &&
            !record.isCliAgent &&
            blankToUndefined(record.toolCallId) !== undefined &&
            blankToUndefined(record.agentId) !== undefined,
        )
        .map((record) => ({ ...record }));

      await this._saveInternal({
        ...metadata,
        ...(blankToUndefined(state.workingDirectory)
          ? { workingDirectory: state.workingDirectory }
          : {}),
        resumableSdkSubagents,
      });
    });
  }

  /**
   * Get all session metadata for a workspace.
   * Excludes child sessions (Ptah CLI agents) by default — these only
   * appear within their parent session's context, not in the sidebar.
   */
  async getForWorkspace(
    workspaceId: string,
    includeChildren = false,
  ): Promise<SessionMetadata[]> {
    if (this.records) {
      await this.gate?.whenReady();
      const rows = await this.records.listForWorkspace(workspaceId, {
        includeChildren,
      });
      return rows.map((r) => listAccountLinkage(r.summary));
    }
    const all = await this.getAll();
    const normalizedQuery = normalizeWorkspaceId(workspaceId);
    return all
      .filter(
        (m) =>
          normalizeWorkspaceId(m.workspaceId) === normalizedQuery &&
          (includeChildren || !m.isChildSession),
      )
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  /**
   * Get all session metadata.
   *
   * Served from the staged snapshot while a write-queue drain is in progress
   * so a read never observes a mutation that has been applied but not yet
   * flushed. Always a fresh array — `_saveInternal` mutates what it gets back.
   */
  async getAll(): Promise<SessionMetadata[]> {
    if (this.records) {
      await this.gate?.whenReady();
      // Every project of this host, not only the active one.
      const rows = await this.records.listAll({ includeChildren: true });
      return rows.map((r) => listAccountLinkage(r.summary));
    }
    if (this.pendingAll)
      return this.withStrays([...this.pendingAll]).map(listAccountLinkage);
    // Copied, not handed through. `_saveInternal` replaces entries in what it
    // gets back, and `IStateStorage.get` returns the adapter's own cached
    // array (`vscode.Memento` included) — so returning it directly let a
    // staged-but-unflushed mutation appear as if it had been stored, and a
    // failed flush left the "unwritten" value already in place.
    const stored = await this.readStorage<
      SessionMetadata[] | SessionMetadataIndex
    >(STORAGE_KEY);
    const items = Array.isArray(stored) ? stored : stored?.items;
    return this.withStrays([...(items ?? [])]).map(listAccountLinkage);
  }

  async saveAgentOutput(
    agentId: string,
    output: {
      stdout?: string;
      segments?: readonly CliOutputSegment[];
      streamEvents?: readonly FlatStreamEventUnion[];
    },
    sessionId?: string,
  ): Promise<void> {
    if (blankToUndefined(agentId) === undefined) return;
    const target = this.sessionBlobs(sessionId);
    const stdout = output.stdout ?? '';
    const streamEvents = output.streamEvents ?? [];
    const hasOtherOutput =
      (output.segments?.length ?? 0) > 0 || streamEvents.length > 0;
    const stdoutFallback = stdout.length > 0 && !hasOtherOutput;
    const stdoutDropped = stdout.length > 0 && hasOtherOutput;
    const segments: readonly CliOutputSegment[] = stdoutFallback
      ? [{ type: 'text', content: stdout }]
      : (output.segments ?? []);
    if (segments.length === 0 && streamEvents.length === 0) return;

    if (target) {
      const record: PersistedAgentOutput = {
        agentId,
        savedAt: Date.now(),
        ...(segments.length > 0 ? { segments } : {}),
        ...(streamEvents.length > 0 ? { streamEvents } : {}),
      };
      await target.blobs.write(
        target.sessionId,
        agentOutputBlobName(agentId),
        record,
      );
    } else if (isAsyncStateStorage(this.storage)) {
      await this.storage.replaceJsonSequence(
        agentOutputKey(agentId),
        (async function* (): AsyncGenerator<{
          items: readonly TaggedAgentOutputItem[];
        }> {
          for (const value of segments) {
            yield { items: [{ tag: 'segment', value }] };
          }
          for (const value of streamEvents) {
            yield { items: [{ tag: 'streamEvent', value }] };
          }
        })(),
      );
    } else {
      const record: PersistedAgentOutput = {
        agentId,
        savedAt: Date.now(),
        ...(segments.length > 0 ? { segments } : {}),
        ...(streamEvents.length > 0 ? { streamEvents } : {}),
      };
      await this.storage.update(agentOutputKey(agentId), record);
    }
    const summary = {
      segments: segments.length,
      streamEvents: streamEvents.length,
      stdoutDropped,
      stdoutFallback,
    };
    if (stdoutDropped || stdoutFallback) {
      this.logger.info(
        `[SessionMetadataStore] Stored agent output for ${agentId}`,
        summary,
      );
    } else {
      this.logger.debug(
        `[SessionMetadataStore] Stored agent output for ${agentId}`,
        summary,
      );
    }
  }

  async getAgentOutputPage(
    agentId: string,
    cursor?: string,
    maxBytes = 128 * 1024,
    sessionId?: string,
  ): Promise<{
    items: readonly TaggedAgentOutputItem[];
    nextCursor: string | null;
    done: boolean;
  }> {
    if (blankToUndefined(agentId) === undefined) {
      return { items: [], nextCursor: null, done: true };
    }
    const rpcBytes = Math.min(maxBytes, MAX_RPC_RESPONSE_BYTES);
    const jsonEnvelopeBytes = rpcOutputPageBytes(
      [],
      RPC_CURSOR_RESERVATION,
      false,
    );
    const budget: AgentOutputPageBudget = {
      rpcBytes,
      jsonEnvelopeBytes,
      itemBytes: rpcBytes - jsonEnvelopeBytes,
    };
    if (budget.itemBytes <= 0) {
      throw new SdkError(
        'Agent output page budget cannot fit the RPC envelope',
      );
    }
    const target = this.sessionBlobs(sessionId);
    const page = target
      ? await this.readRecordOutputPage(agentId, cursor, budget, () =>
          target.blobs.read<PersistedAgentOutput>(
            target.sessionId,
            agentOutputBlobName(agentId),
          ),
        )
      : isAsyncStateStorage(this.storage)
        ? await this.readSequenceOutputPage(
            this.storage,
            agentId,
            cursor,
            budget,
          )
        : await this.readRecordOutputPage(agentId, cursor, budget, () =>
            this.readStorage<PersistedAgentOutput>(agentOutputKey(agentId)),
          );
    if (rpcOutputPageBytes(page.items, page.nextCursor, page.done) > rpcBytes) {
      throw new SdkError('Agent output page exceeds RPC budget');
    }
    return page;
  }

  private async readSequenceOutputPage(
    storage: IAsyncStateStorage,
    agentId: string,
    cursor: string | undefined,
    budget: AgentOutputPageBudget,
  ): Promise<AgentOutputPage> {
    const sequence = storage.readJsonSequence<TaggedAgentOutputItem>(
      agentOutputKey(agentId),
      {
        cursor,
        maxBytes: budget.rpcBytes,
        maxJsonBytes: budget.rpcBytes,
        jsonEnvelopeBytes: budget.jsonEnvelopeBytes,
        maxItemBytes: budget.itemBytes,
      },
    );
    const pages = sequence[Symbol.asyncIterator]();
    try {
      const first = await pages.next();
      if (first.done) return { items: [], nextCursor: null, done: true };
      const { items, nextCursor, done, truncatedItems } = first.value;
      if (truncatedItems && truncatedItems.length > 0) {
        this.logTruncatedItems(agentId, truncatedItems);
      }
      return { items, nextCursor, done };
    } catch (error: unknown) {
      if (error instanceof StateStorageCursorStaleError) {
        throw new AgentOutputCursorStaleError(agentId);
      }
      throw error;
    } finally {
      await pages.return?.(undefined);
    }
  }

  private logTruncatedItems(
    agentId: string,
    truncatedItems: readonly StateStorageTruncatedItem[],
  ): void {
    this.logger.info(
      `[SessionMetadataStore] Truncated oversized agent output items for ${agentId}`,
      {
        truncatedItems: truncatedItems.map((item) => ({
          pageIndex: item.index,
          originalJsonBytes: item.originalJsonBytes,
        })),
      },
    );
  }

  private async readRecordOutputPage(
    agentId: string,
    cursor: string | undefined,
    budget: AgentOutputPageBudget,
    load: () => Promise<PersistedAgentOutput | undefined>,
  ): Promise<AgentOutputPage> {
    const key = agentOutputKey(agentId);
    const output = await load();
    const outputSegments = output?.segments ?? [];
    const outputEvents = output?.streamEvents ?? [];
    const itemCount = outputSegments.length + outputEvents.length;
    const savedAt = output ? (output.savedAt ?? 0) : null;
    const start = parseRecordOutputCursor(agentId, cursor, savedAt, itemCount);
    const page = packJsonSequencePage<TaggedAgentOutputItem>(
      {
        length: itemCount,
        itemAt: (index) =>
          index < outputSegments.length
            ? { tag: 'segment', value: outputSegments[index] }
            : {
                tag: 'streamEvent',
                value: outputEvents[index - outputSegments.length],
              },
      },
      start,
      {
        maxJsonBytes: budget.itemBytes,
        jsonEnvelopeBytes: 0,
        maxItemBytes: Number.POSITIVE_INFINITY,
      },
    );
    if (page.status === 'item-too-large') {
      throw new StateStorageValueTooLargeError(key, page.originalJsonBytes);
    }
    if (page.truncatedItems.length > 0) {
      this.logTruncatedItems(agentId, page.truncatedItems);
    }
    const done = page.nextIndex >= itemCount;
    return {
      items: page.items,
      nextCursor: done ? null : `s${savedAt ?? 0}.${page.nextIndex}`,
      done,
    };
  }

  /** Drop one agent's bulk output. Silent when there is nothing stored. */
  async deleteAgentOutput(agentId: string, sessionId?: string): Promise<void> {
    if (blankToUndefined(agentId) === undefined) return;
    const target = this.sessionBlobs(sessionId);
    if (target) {
      await target.blobs.remove(target.sessionId, agentOutputBlobName(agentId));
      return;
    }
    await this.storage.update(agentOutputKey(agentId), undefined);
  }

  /**
   * Lean CLI references for startup and resume. Historical output remains in
   * per-agent sequences and is requested through bounded pages.
   *
   * The single restore seam for both resume paths, so each run's persisted
   * `quotaOwner` is validated here (TASK_2026_596 G3).
   */
  async getCliSessionsForRestore(
    sessionId: string,
  ): Promise<CliSessionReference[]> {
    const metadata = await this.get(sessionId);
    return (metadata?.cliSessions ?? []).map(restoreQuotaOwner);
  }

  /**
   * Update session activity timestamp
   */
  async touch(sessionId: string): Promise<void> {
    // Read inside the queue: a read taken before it would write back whatever
    // a queued rename or CLI link changed meanwhile.
    let workspaceId: string | undefined;
    await this.enqueueWrite(async () => {
      const metadata = await this.get(sessionId);
      if (!metadata) {
        this.logger.debug(
          `[SessionMetadataStore] touch skipped: no metadata for ${sessionId} in the active workspace`,
        );
        return;
      }
      workspaceId = metadata.workspaceId;
      await this._saveInternal({ ...metadata, lastActiveAt: Date.now() });
    });
    if (workspaceId !== undefined) {
      this.emitChange('updated', sessionId, workspaceId);
    }
  }

  /**
   * Add a CLI session reference to a parent session's metadata.
   * Called when a CLI agent exits with a captured cliSessionId.
   *
   * Serialized through writeQueue to prevent race conditions when
   * multiple CLI agents exit simultaneously and try to add their
   * references concurrently (each would read stale cliSessions=[],
   * and only the last save would survive).
   */
  async addCliSession(
    sessionId: string,
    cliSession: CliSessionReference,
  ): Promise<void> {
    return this.enqueueWrite(async () => {
      const metadata = await this.get(sessionId);
      if (!metadata) {
        throw new SdkError(`Parent session not found: ${sessionId}`);
      }

      const existing = metadata.cliSessions ?? [];
      const existingIndex = existing.findIndex(
        (s) => s.cliSessionId === cliSession.cliSessionId,
      );

      let updated: readonly CliSessionReference[];
      // Re-association: the same `cliSessionId` resumed under a NEW agent. The
      // slot is the only route to `ptah.agentOutput:<agentId>`, so the
      // displaced agent's key becomes unreachable — a leak per resume, and
      // `_deleteInternal` can never collect it either (TASK_2026_324
      // finding 4). Collected here, deleted only once the replacement
      // reference is durable: see the note at the delete site below.
      let displacedAgentId: string | undefined;
      if (existingIndex >= 0) {
        const previous = existing[existingIndex];
        const mutable = [...existing];
        mutable[existingIndex] = cliSession;
        updated = mutable;
        if (
          blankToUndefined(previous.agentId) !== undefined &&
          previous.agentId !== cliSession.agentId
        ) {
          displacedAgentId = previous.agentId;
        }
        this.logger.info(
          `[SessionMetadataStore] Updated CLI session ${cliSession.cliSessionId} (${cliSession.cli}) in session ${sessionId}`,
        );
      } else {
        updated = [...existing, cliSession];
        this.logger.info(
          `[SessionMetadataStore] Linked CLI session ${cliSession.cliSessionId} (${cliSession.cli}) to session ${sessionId}`,
        );
      }

      await this._saveInternal({
        ...metadata,
        lastActiveAt: Date.now(),
        cliSessions: updated,
      });

      // AFTER the replacement reference is DURABLE, never before. Deleting
      // first leaves stored metadata pointing at an agent whose output key is
      // already gone — the reference survives and its content does not, which
      // reads to every consumer as an agent that produced nothing. Deleting
      // second can only leak the key it was already leaking, and the next
      // successful re-association collects it.
      //
      // `_saveInternal` only STAGES (see `stage`), so the flush has to be
      // forced here: the queue drain that normally flushes runs after this
      // callback returns, which is after the delete. Coalescing is untouched
      // on every other path — a re-association under a new agent id happens
      // once per resume, not once per event.
      if (displacedAgentId !== undefined) {
        await this.flush();
        await this.deleteAgentOutput(displacedAgentId, sessionId);
        this.logger.info(
          `[SessionMetadataStore] Dropped orphaned output key for re-associated agent ${displacedAgentId}`,
          { cliSessionId: cliSession.cliSessionId },
        );
      }
      this.emitChange('updated', sessionId, metadata.workspaceId);
    });
  }

  /**
   * Delete session metadata.
   * Serialized through writeQueue to prevent concurrent read-modify-write races.
   */
  async delete(sessionId: string): Promise<void> {
    const existing = await this.get(sessionId);
    await this.enqueueWrite(() => this._deleteInternal(sessionId));
    if (existing) {
      this.emitChange('deleted', sessionId, existing.workspaceId);
    }
  }

  /**
   * Internal delete implementation (NOT serialized).
   * Public callers must use delete() which wraps this in enqueueWrite().
   */
  private async _deleteInternal(sessionId: string): Promise<void> {
    this.strays.delete(sessionId);
    if (this.records) {
      const removed = await this.get(sessionId);
      if (!removed) return;
      // Row first, output second: a failure can leak output, never leave a
      // live reference to output that is gone.
      await this.records.delete(sessionId);
      // Agent output and any other per-session files go with the session.
      await this.blobs?.removeAll(sessionId);
      this.logger.info(
        `[SessionMetadataStore] Deleted metadata for session ${sessionId}`,
      );
      return;
    }
    const all = await this.getAll();
    const removedSummary = all.find((m) => m.sessionId === sessionId);
    const removedDetail = isAsyncStateStorage(this.storage)
      ? await this.get(sessionId)
      : removedSummary;
    const removed = removedDetail ? [removedDetail] : [];
    const filtered = all.filter((m) => m.sessionId !== sessionId);

    if (filtered.length !== all.length) {
      this.stage(filtered);

      // Make the session list removal DURABLE before dropping output keys.
      // `stage` only mutates `pendingAll` in memory. If we deleted output keys
      // before flushing and the subsequent flush failed, the session record
      // would survive in storage with dead references pointing to destroyed
      // output keys that no longer exist.
      //
      // Forcing `flush()` here costs one extra `storage.update` instead of
      // riding the write queue's coalesced write, which is the right trade
      // for a rare, destructive operation. If the flush rejects, the rejection
      // propagates to the caller and no output keys are destroyed.
      await this.flush();

      // The index must be absent before its detail is deleted, and the detail
      // must be absent before output keys are collected. A failure can leak
      // data for a later retry but cannot leave a live reference dangling.
      if (isAsyncStateStorage(this.storage)) {
        await this.storage.update(sessionDetailKey(sessionId), undefined);
      }

      // The per-agent output keys are only reachable through this session's
      // references, so dropping the session without them would leak a key per
      // agent forever.
      for (const record of removed) {
        for (const ref of record.cliSessions ?? []) {
          await this.deleteAgentOutput(ref.agentId);
        }
      }
      this.logger.info(
        `[SessionMetadataStore] Deleted metadata for session ${sessionId}`,
      );
    }
  }

  /**
   * Create initial metadata for a new session.
   * Called when SDK returns the real session ID from system 'init' message.
   * If metadata already exists (e.g., from a user rename), preserves the existing name.
   *
   * Emits `metadataChanged` with the supplied {@link kind} (default `'created'`).
   * Callers forking an existing session pass `'forked'` so the webview can
   * distinguish brand-new sessions from forked ones (e.g. for highlight UX).
   * When metadata already exists, the kind is downgraded to `'updated'` —
   * a duplicate `create()` is semantically just an activity touch.
   *
   * `workingDirectory` is the session's cwd when it differs from the workspace
   * it is listed under — an agent child session runs in a worktree but belongs
   * to its parent's workspace (TASK_2026_584). Omitted, it defaults to
   * `workspaceId`, so every existing caller's record is unchanged. It applies
   * to a NEW record only; an existing record keeps its own value.
   */
  async create(
    sessionId: string,
    workspaceId: string,
    name: string,
    kind: SessionMetadataChangeKind = 'created',
    workingDirectory?: string,
    providerId?: string,
  ): Promise<SessionMetadata> {
    // Same invariant SessionRegistry.bindRealSessionId enforces on the same
    // value three lines away in SdkAgentAdapter. A record keyed by '' is not a
    // session anyone can address: the sidebar, the resume path and the
    // authorization layer all look sessions up by id, and there is no sensible
    // metadata to return for a session that has no identity (TASK_2026_295).
    if (blankToUndefined(sessionId) === undefined) {
      throw new SdkError(
        'Cannot create session metadata with an empty sessionId — the SDK session UUID from the system init message is the only valid key.',
      );
    }

    const existing = await this.get(sessionId);
    if (existing) {
      this.logger.info(
        `[SessionMetadataStore] Metadata already exists for ${sessionId}, preserving name "${existing.name}"`,
      );
      const knownProviderId = blankToUndefined(providerId);
      const updated = {
        ...existing,
        lastActiveAt: Date.now(),
        ...(knownProviderId ? { providerId: knownProviderId } : {}),
      };
      await this.enqueueWrite(() =>
        this._saveInternal(updated, knownProviderId),
      );
      this.emitChange('updated', updated.sessionId, updated.workspaceId);
      return updated;
    }

    const now = Date.now();
    const metadata: SessionMetadata = {
      sessionId,
      name,
      workspaceId,
      workingDirectory: blankToUndefined(workingDirectory) ?? workspaceId,
      createdAt: now,
      lastActiveAt: now,
      totalCost: 0,
      totalTokens: { input: 0, output: 0 },
      ...(blankToUndefined(providerId)
        ? { providerId: blankToUndefined(providerId) }
        : {}),
    };

    await this.enqueueWrite(() => this._saveInternal(metadata));
    this.logger.info(
      `[SessionMetadataStore] Created metadata for session ${sessionId}: "${name}"`,
    );
    this.emitChange(kind, sessionId, workspaceId);

    return metadata;
  }

  /** Serialize a provider change with all other metadata mutations. */
  async updateProvider(
    sessionId: string,
    providerId?: string | null,
  ): Promise<void> {
    const knownProviderId = blankToUndefined(providerId ?? undefined);
    if (!knownProviderId || !blankToUndefined(sessionId)) return;
    let workspaceId: string | undefined;
    await this.enqueueWrite(async () => {
      const existing = await this.get(sessionId);
      if (!existing) return;
      if (existing.providerId === knownProviderId) return;
      workspaceId = existing.workspaceId;
      await this._saveInternal(
        { ...existing, providerId: knownProviderId },
        knownProviderId,
      );
    });
    if (workspaceId) this.emitChange('updated', sessionId, workspaceId);
  }

  /**
   * Create metadata for a child session (hidden from sidebar).
   * Called when a Ptah CLI agent's real SDK session ID is resolved.
   * Creating this entry early prevents SessionImporterService from
   * re-importing the session as a top-level sidebar item.
   */
  async createChild(
    sessionId: string,
    workspaceId: string,
    name: string,
  ): Promise<SessionMetadata> {
    const now = Date.now();
    const metadata: SessionMetadata = {
      sessionId,
      name,
      workspaceId,
      workingDirectory: workspaceId,
      createdAt: now,
      lastActiveAt: now,
      totalCost: 0,
      totalTokens: { input: 0, output: 0 },
      isChildSession: true,
    };

    await this.enqueueWrite(() => this._saveInternal(metadata));
    this.logger.info(
      `[SessionMetadataStore] Created child session metadata: ${sessionId} "${name}"`,
    );
    this.emitChange('created', sessionId, workspaceId);

    return metadata;
  }

  /**
   * Flag a session as a hidden child WITHOUT clobbering its existing name,
   * cost, or timestamps.
   *
   * Unlike {@link createChild} (which writes a fresh zero-cost record and is
   * meant to pre-empt import), this is safe to call on a session that may
   * already have been imported as a top-level sidebar entry: it upgrades the
   * existing record in place, or creates a minimal child record when none
   * exists yet. Idempotent — a no-op once `isChildSession` is set.
   *
   * Used by the CLI-agent persist path so a spawned Ptah CLI agent's own SDK
   * session is guaranteed to be hidden from the sidebar even when the live
   * `createChild`-on-resolve hook was never wired (e.g. MCP-spawned agents).
   */
  async markChildSession(
    sessionId: string,
    workspaceId: string,
    name = 'CLI Agent Session',
  ): Promise<void> {
    let emitKind: SessionMetadataChangeKind | null = null;
    await this.enqueueWrite(async () => {
      const existing = await this.get(sessionId);
      if (existing?.isChildSession) return;
      const now = Date.now();
      const metadata: SessionMetadata = existing
        ? { ...existing, isChildSession: true }
        : {
            sessionId,
            name,
            workspaceId,
            createdAt: now,
            lastActiveAt: now,
            totalCost: 0,
            totalTokens: { input: 0, output: 0 },
            isChildSession: true,
          };
      await this._saveInternal(metadata);
      emitKind = existing ? 'updated' : 'created';
    });
    if (emitKind) {
      this.emitChange(emitKind, sessionId, workspaceId);
    }
  }

  /**
   * Rename session.
   * Serialized through writeQueue to prevent lost updates from concurrent writes.
   */
  async rename(sessionId: string, newName: string): Promise<void> {
    let renamed: SessionMetadata | null = null;
    await this.enqueueWrite(async () => {
      const metadata = await this.get(sessionId);
      if (metadata) {
        const next: SessionMetadata = { ...metadata, name: newName };
        await this._saveInternal(next);
        this.logger.info(
          `[SessionMetadataStore] Renamed session ${sessionId} to "${newName}"`,
        );
        renamed = next;
      }
    });
    if (renamed) {
      const m = renamed as SessionMetadata;
      this.emitChange('updated', m.sessionId, m.workspaceId);
    }
  }

  /**
   * Check if a given SDK session UUID is referenced as a child session
   * by any parent session's cliSessions array.
   *
   * Used by SessionImporterService to detect child sessions that weren't
   * properly marked with isChildSession (e.g., createChild failed or
   * was never called).
   */
  async isReferencedAsChildSession(sdkSessionId: string): Promise<boolean> {
    const all = await this.getAll();
    for (const session of all) {
      if (session.cliSessions) {
        for (const ref of session.cliSessions) {
          if (ref.sdkSessionId === sdkSessionId) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Enqueue a write operation. Each write waits for the previous one to finish
   * before executing, ensuring read-modify-write cycles see fresh data.
   * Errors are propagated to the caller but don't break the queue chain.
   *
   * The operation stages its result in memory; the storage write happens in
   * {@link settleWrite} once no further operation is queued behind it. The
   * caller still awaits the storage write, so `save()` keeps its durability
   * contract while a burst costs one serialize instead of N.
   */
  private enqueueWrite(fn: () => Promise<void>): Promise<void> {
    this.queueDepth++;
    const next = this.writeQueue
      .then(fn, () => fn())
      .then(
        () => this.settleWrite(),
        async (error: unknown) => {
          // The operation's own failure is what the caller is waiting to hear —
          // `addCliSession` callers branch on "Parent session not found". A
          // flush failure on top of it is logged inside settleWrite, not
          // substituted for the original.
          // degradation-audit: optional-capability - the flush is a courtesy
          // on the failure path and settleWrite logs its own error; undefined
          // keeps the operation's original rejection as what the caller hears.
          await this.settleWrite().catch(() => undefined);
          throw error;
        },
      );
    // degradation-audit: optional-capability - this branch is only the queue's
    // ordering handle, and `next` carries the real rejection to the caller;
    // swallowing keeps one failed write from wedging the writes behind it.
    this.writeQueue = next.catch(() => {
      /* swallow to keep chain alive */
    });
    return next;
  }

  /**
   * Leave the write queue. The last operation out flushes what the whole burst
   * staged; the others return immediately, having contributed their mutation
   * to the snapshot the last one writes.
   *
   * A failed flush keeps the snapshot staged, so the value stays visible to
   * readers and the next write retries it rather than silently dropping it.
   */
  private async settleWrite(): Promise<void> {
    this.queueDepth--;
    if (this.queueDepth > 0) return;
    try {
      await this.flush();
    } catch (error: unknown) {
      this.logger.warn(
        '[SessionMetadataStore] Failed to flush session metadata',
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }
}
