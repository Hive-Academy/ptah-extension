/**
 * Session auto-link service — automatic, deterministic session <-> task
 * links on the host (TASK_2026_854). The rules and their precedence live in
 * `auto-link/task-link-rules.ts`; this service gathers the evidence and
 * commits one full reconcile per session.
 *
 * Triggers (all host-wide subscriptions, no timer):
 *  - main-thread `UserPromptSubmit` / `UserPromptExpansion` naming
 *    `/orchestrate <TASK id>` (R3). A subagent's prompt (`agentId`) never
 *    links. While the session has no metadata or the store is closed the
 *    candidate waits in a bounded queue and is replayed on the session's
 *    `SessionIdResolved` or on the store's open signal (RR1-2);
 *  - `SessionIdResolved` (new or resumed session): record the session's git
 *    worktree when none is known (D4), then reconcile. Ids resolved while the
 *    store is closed are reconciled when it opens;
 *  - the organization change event (lineage, worktree, links of a parent or
 *    peer): reconcile the named sessions, then their children, forks and
 *    worktree peers one level deep. A change this service's own reconcile
 *    wrote is not a trigger, so a cascade never re-triggers itself;
 *  - task index `watcher` / `write` events: reconcile the (at most 50)
 *    sessions whose worktree or branch names the new folder (RR1-6).
 *
 * A reconcile computes the complete desired automatic set from current
 * evidence and applies `planAutoLinks` in one store transaction, so the
 * result never depends on event order and a repeat writes nothing. Explicit
 * links and user unlinks (suppressions) are never overridden. Task status is
 * never changed here.
 *
 * Every handler is guarded: a failure is one `[SessionOrganization]` line
 * with the session id and never the prompt text.
 */
import * as path from 'node:path';
import { z } from 'zod';
import { TOKENS, resolveWorktreePath, type Logger } from '@ptah-extension/vscode-core';
import { inject, injectable } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  normalizeWorkspaceRoot,
  type IDisposable,
  type IEvent,
  type IFileSystemProvider,
  type IOutputChannel,
} from '@ptah-extension/platform-core';
import {
  SDK_TOKENS,
  type SessionIdResolvedPayload,
  type PostToolUsePayload,
  type SessionMetadataStore,
  type UserPromptExpansionCallbackRegistry,
  type UserPromptExpansionPayload,
  type UserPromptSubmitCallbackRegistry,
  type UserPromptSubmitPayload,
} from '@ptah-extension/agent-sdk';
import {
  TASK_SPECS_TOKENS,
  type TaskIndexChangeEvent,
} from '@ptah-extension/task-specs';
import { CARRIER_FILE } from '@ptah-extension/shared';
import { TASK_ID_PATTERN, TASK_ID_TOKEN_SOURCE } from '@ptah-extension/shared/schemas';
import { SESSION_ORGANIZATION_TOKENS } from './di/tokens';
import {
  isAutoRule,
  isProtectedSource,
  parseOrchestrateExpansion,
  parseOrchestrateTaskId,
  planAutoLinks,
  taskIdsInWorktreeName,
  worktreeEvidence,
  type AutoCandidate,
} from './auto-link/task-link-rules';
import { readGitWorktreeInfo } from './auto-link/git-worktree-info';
import { extractBashPaths } from './auto-link/bash-path-extractor';
import type { SessionAutoLinkStore } from './session-auto-link.store';
import type {
  CaptureOutcome,
  SessionOrganizationChange,
  SessionOrganizationService,
} from './session-organization.service';
import type {
  SessionOrganizationStore,
  StoredOrganization,
  StoredTaskLink,
} from './session-organization.store';
import type { SessionOrganizationSessionIdResolvedSource } from './session-organization-capture.service';

const LOG_PREFIX = '[SessionOrganization]';
const fileToolInput = z.object({ file_path: z.string().min(1) });
const notebookToolInput = z.object({ notebook_path: z.string().min(1) });
const bashToolInput = z.object({ command: z.string().min(1) });
const worktreeArgs = z.object({ branch: z.string().min(1), path: z.string().optional() });
const taskResult = z.object({ ok: z.literal(true), task: z.object({ id: z.string() }) });
const mcpContent = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })), isError: z.boolean().optional() });
const MAX_SEEN = 512;
const MAX_DEFERRED_SESSIONS = 256;
const MAX_DEFERRED_TASKS = 16;
const taskIdInResponse = new RegExp(`"id"\\s*:\\s*"(${TASK_ID_TOKEN_SOURCE})"`);
export function pathKey(value: string, platform: NodeJS.Platform): string {
  const slashed = (platform === 'win32' ? value.replace(/\\/g, '/') : value).replace(/\/+$/, '');
  return platform === 'win32' ? slashed.toLowerCase() : slashed;
}
function remember(set: Set<string>, key: string): void {
  set.delete(key);
  set.add(key);
  if (set.size > MAX_SEEN) set.delete(set.values().next().value ?? key);
}

/** R3 candidates waiting for metadata or the store (RR1-2). */
const MAX_QUEUED_PROMPTS = 64;
/** Session ids resolved while the store was closed. */
const MAX_PENDING_RESOLVES = 256;
/** Positive task-folder existence results; a miss is never cached. */
const MAX_EXISTENCE_CACHE = 256;
/** Immediate re-runs of a reconcile whose write threw. */
const MAX_COMMIT_RETRIES = 1;

/** The service calls the auto-link service drives. */
export type AutoLinkOrganizationService = Pick<
  SessionOrganizationService,
  'commitCapture' | 'isAvailable' | 'onDidChange'
>;

/** The main-store reads and writes the reconcile uses. */
export type AutoLinkOrganizationStore = Pick<
  SessionOrganizationStore,
  | 'onDidOpen'
  | 'getOrganization'
  | 'listDependentIds'
  | 'listWorktreePeers'
  | 'applyAutoLinkPlan'
  | 'upsertOrganization'
>;

/** The side-table reads the reconcile uses. */
export type AutoLinkSideTableReader = Pick<
  SessionAutoLinkStore,
  'listSuppressed' | 'findSessionsNamingTask'
>;

export type AutoLinkMetadataReader = Pick<SessionMetadataStore, 'get'>;
export type AutoLinkFileSystem = Pick<IFileSystemProvider, 'exists' | 'readFile'>;
export type AutoLinkPromptSource = Pick<
  UserPromptSubmitCallbackRegistry,
  'register'
>;
export type AutoLinkExpansionSource = Pick<
  UserPromptExpansionCallbackRegistry,
  'register'
>;
export interface AutoLinkToolSource {
  register(callback: (payload: PostToolUsePayload) => void): () => void;
}
/** The task index event (optional: absent when task-specs is not composed). */
export interface AutoLinkTaskIndexEvents {
  readonly onDidChangeIndex: IEvent<TaskIndexChangeEvent>;
}

interface ReconcileRequest {
  /** R3 task ids to add (already validated, folder exists). */
  r3: Set<string>;
  r8: Set<string>;
  /** Also reconcile children, forks and worktree peers, one level deep. */
  cascade: boolean;
  /** Re-runs already spent on a failed write (bounded by MAX_COMMIT_RETRIES). */
  attempt: number;
}

/** Existence of a task folder; `unknown` when the check itself threw. */
type TaskPresence = 'present' | 'absent' | 'unknown';

type SessionMetadata = NonNullable<
  Awaited<ReturnType<AutoLinkMetadataReader['get']>>
>;

@injectable()
export class SessionAutoLinkService implements IDisposable {
  private disposers: Array<() => void> = [];
  private started = false;

  private readonly queuedPrompts = new Map<string, string>();
  private readonly pendingResolves = new Set<string>();
  private readonly existingTasks = new Set<string>();
  private readonly running = new Set<string>();
  private readonly requests = new Map<string, ReconcileRequest>();
  /** Sessions whose change event this service's own reconcile emitted. */
  private readonly ownWrites = new Set<string>();
  private readonly seenWorktrees = new Set<string>();
  private readonly seenTaskWrites = new Set<string>();
  private readonly deferredR8 = new Map<string, Set<string>>();

  constructor(
    @inject(SESSION_ORGANIZATION_TOKENS.SERVICE)
    private readonly service: AutoLinkOrganizationService,
    @inject(SESSION_ORGANIZATION_TOKENS.STORE)
    private readonly store: AutoLinkOrganizationStore,
    @inject(SESSION_ORGANIZATION_TOKENS.AUTO_LINK_STORE)
    private readonly sideTables: AutoLinkSideTableReader,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly metadata: AutoLinkMetadataReader,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: AutoLinkFileSystem,
    @inject(SDK_TOKENS.SDK_USER_PROMPT_SUBMIT_CALLBACK_REGISTRY)
    private readonly prompts: AutoLinkPromptSource,
    @inject(SDK_TOKENS.SDK_USER_PROMPT_EXPANSION_REGISTRY)
    private readonly expansions: AutoLinkExpansionSource,
    @inject(SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY)
    private readonly tools: AutoLinkToolSource,
    @inject(SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY)
    private readonly sessionIdResolved: SessionOrganizationSessionIdResolvedSource,
    @inject(PLATFORM_TOKENS.OUTPUT_CHANNEL)
    private readonly output: IOutputChannel,
    @inject(TOKENS.LOGGER, { isOptional: true })
    private readonly logger?: Pick<Logger, 'error'>,
    @inject(TASK_SPECS_TOKENS.TASK_INDEX_SERVICE, { isOptional: true })
    private readonly taskIndex?: AutoLinkTaskIndexEvents,
  ) {}

  /**
   * Subscribe host-wide. Idempotent. If a subscription throws, the earlier
   * ones are released, the service stays un-started and the error propagates
   * (`startSessionOrganization` reports it).
   */
  start(): void {
    if (this.started) return;
    const subscriptions: Array<() => () => void> = [
      () => this.prompts.register((payload) => this.onPrompt(payload)),
      () => this.expansions.register((payload) => this.onExpansion(payload)),
      () => this.tools.register((payload) => this.onToolUse(payload)),
      () =>
        this.sessionIdResolved.register((payload) =>
          this.onSessionIdResolved(payload),
        ),
      () => disposerOf(this.store.onDidOpen(() => this.onStoreOpen())),
      () => disposerOf(this.service.onDidChange((e) => this.onChange(e))),
    ];
    const taskIndex = this.taskIndex;
    if (taskIndex) {
      subscriptions.push(() =>
        disposerOf(taskIndex.onDidChangeIndex((e) => this.onIndexChange(e))),
      );
    }
    try {
      for (const subscribe of subscriptions) {
        this.disposers.push(subscribe());
      }
    } catch (error: unknown) {
      this.releaseAll();
      throw error;
    }
    this.started = true;
  }

  /** Release every subscription and every queued item. Idempotent. */
  dispose(): void {
    if (!this.started) return;
    this.started = false;
    this.releaseAll();
    this.queuedPrompts.clear();
    this.pendingResolves.clear();
    this.existingTasks.clear();
    this.requests.clear();
    this.ownWrites.clear();
    this.seenWorktrees.clear();
    this.seenTaskWrites.clear();
    this.deferredR8.clear();
  }

  // ── Triggers ───────────────────────────────────────────────────────────────

  private onPrompt(payload: UserPromptSubmitPayload): void {
    if (payload.agentId !== undefined) return;
    const taskId = parseOrchestrateTaskId(payload.prompt);
    if (taskId === null) return;
    this.detach('orchestrate prompt', payload.sessionId, () =>
      this.offerOrchestrate(payload.sessionId, taskId),
    );
  }

  private onExpansion(payload: UserPromptExpansionPayload): void {
    if (payload.agentId !== undefined) return;
    const taskId = parseOrchestrateExpansion(
      payload.skillSlug,
      payload.expansionType,
      payload.commandArgs,
    );
    if (taskId === null) return;
    this.detach('orchestrate expansion', payload.sessionId, () =>
      this.offerOrchestrate(payload.sessionId, taskId),
    );
  }

  private onSessionIdResolved(payload: SessionIdResolvedPayload): void {
    const id = payload.realSessionId;
    const previous = payload.previousSessionId;
    if (previous !== undefined && previous !== id) {
      const queued = this.queuedPrompts.get(previous);
      this.queuedPrompts.delete(previous);
      if (queued !== undefined && !this.queuedPrompts.has(id)) {
        this.queue(id, queued);
      }
    }
    this.detach('session resolved', id, () => this.handleResolved(id));
  }

  private onStoreOpen(): void {
    const resolved = [...this.pendingResolves];
    this.pendingResolves.clear();
    for (const id of this.deferredR8.keys()) if (!resolved.includes(id)) resolved.push(id);
    for (const id of resolved) {
      this.detach('store open', id, () => this.handleResolved(id));
    }
    for (const [id, taskId] of [...this.queuedPrompts]) {
      if (resolved.includes(id)) continue;
      this.queuedPrompts.delete(id);
      this.detach('store open', id, () => this.offerOrchestrate(id, taskId));
    }
  }

  private onChange(change: SessionOrganizationChange): void {
    if (change.reason === 'delete') return;
    for (const id of change.sessionIds) {
      // Our own reconcile wrote this: its evidence is applied and the cascade
      // (if any) runs explicitly, one level deep. Re-triggering here would
      // walk the whole lineage graph.
      if (change.reason === 'capture' && this.ownWrites.delete(id)) continue;
      this.detach('organization change', id, () =>
        this.reconcile(id, { cascade: true }),
      );
    }
  }

  private onIndexChange(event: TaskIndexChangeEvent): void {
    if (event.reason === 'reindex') return;
    for (const folder of event.folderNames) {
      if (!TASK_ID_PATTERN.test(folder)) continue;
      this.forgetTask(folder);
      if (!this.service.isAvailable()) continue;
      const root = normalizeWorkspaceRoot(event.workspaceRoot);
      for (const id of this.sideTables.findSessionsNamingTask(root, folder)) {
        this.detach('task folder change', id, () =>
          this.reconcile(id, { cascade: true }),
        );
      }
    }
  }

  // ── R3 queue ───────────────────────────────────────────────────────────────

  /** Apply an `/orchestrate` candidate now, or queue it until it can be. */
  private async offerOrchestrate(
    sessionId: string,
    taskId: string,
  ): Promise<void> {
    if (!this.started) return;
    if (!this.service.isAvailable()) {
      this.queue(sessionId, taskId);
      return;
    }
    const metadata = await this.metadata.get(sessionId);
    if (!this.started) return;
    if (metadata === null) {
      this.queue(sessionId, taskId);
      return;
    }
    const r3 = await this.checkedOrchestrateTask(sessionId, taskId, metadata);
    if (r3 !== undefined) await this.reconcile(sessionId, { r3, cascade: true });
  }

  /** The R3 task id when its folder has a `task.md`; undefined otherwise. */
  private async checkedOrchestrateTask(
    sessionId: string,
    taskId: string,
    metadata: SessionMetadata,
  ): Promise<string | undefined> {
    const root = normalizeWorkspaceRoot(metadata.workspaceId);
    const presence = await this.taskPresence(
      [root, metadata.workingDirectory ?? null],
      taskId,
    );
    if (presence === 'present') return taskId;
    if (presence === 'unknown') {
      // The check threw: keep the candidate for the next resolve instead of
      // dropping the user's `/orchestrate` intent.
      this.queue(sessionId, taskId);
      this.log(`autoLink R3 deferred for ${sessionId}: ${taskId} not checked`);
      return undefined;
    }
    this.log(`autoLink R3 skipped for ${sessionId}: ${taskId} has no ${CARRIER_FILE}`);
    return undefined;
  }

  private queue(sessionId: string, taskId: string): void {
    if (!this.started) return;
    this.queuedPrompts.delete(sessionId);
    if (this.queuedPrompts.size >= MAX_QUEUED_PROMPTS) {
      const oldest = this.queuedPrompts.keys().next().value;
      if (oldest !== undefined) {
        this.queuedPrompts.delete(oldest);
        this.log(`autoLink R3 dropped for ${oldest}: queue full`);
      }
    }
    this.queuedPrompts.set(sessionId, taskId);
  }

  // ── Resolve: worktree detection + reconcile ────────────────────────────────

  private async handleResolved(sessionId: string): Promise<void> {
    if (!this.service.isAvailable()) {
      this.addPendingResolve(sessionId);
      return;
    }
    const metadata = await this.metadata.get(sessionId);
    if (!this.started) return;
    if (metadata === null) {
      this.log(`autoLink resolve skipped for ${sessionId}: no session metadata`);
      return;
    }
    await this.recordWorktree(sessionId, metadata);
    const queued = this.queuedPrompts.get(sessionId);
    this.queuedPrompts.delete(sessionId);
    const r3 =
      queued === undefined
        ? undefined
        : await this.checkedOrchestrateTask(sessionId, queued, metadata);
    const r8 = this.deferredR8.get(sessionId);
    this.deferredR8.delete(sessionId);
    for (const taskId of r8 ?? []) await this.reconcile(sessionId, { r8: taskId, cascade: true });
    await this.reconcile(sessionId, { r3, cascade: true });
  }

  private addPendingResolve(sessionId: string): void {
    if (!this.started) return;
    if (
      !this.pendingResolves.has(sessionId) &&
      this.pendingResolves.size >= MAX_PENDING_RESOLVES
    ) {
      this.log(`autoLink reconcile dropped for ${sessionId}: too many pending`);
      return;
    }
    this.pendingResolves.add(sessionId);
  }

  /**
   * D4: a session running in a linked git worktree records that worktree
   * (and its branch) when no worktree is known for it yet.
   */
  private async recordWorktree(
    sessionId: string,
    metadata: SessionMetadata,
    candidate = metadata.workingDirectory,
    branchHint?: string,
  ): Promise<void> {
    const cwd = candidate;
    if (cwd === undefined || cwd.trim().length === 0) return;
    const root = normalizeWorkspaceRoot(metadata.workspaceId);
    if (pathKey(cwd, process.platform) === pathKey(root, process.platform)) return;
    if (this.store.getOrganization(root, sessionId)?.worktreePath) return;
    const info = await readGitWorktreeInfo(this.fs, cwd);
    if (info === null || !this.started) return;
    await this.service.commitCapture(
      'autoLink recordWorktree',
      sessionId,
      undefined,
      (writeRoot, now) => {
        if (!this.started) return [];
        if (this.store.getOrganization(writeRoot, sessionId)?.worktreePath) {
          return [];
        }
        this.store.upsertOrganization(
          writeRoot,
          sessionId,
          {
            worktreePath: info.worktreePath,
            ...(info.branch !== null || branchHint ? { branch: info.branch ?? branchHint } : {}),
          },
          now,
        );
        return [sessionId];
      },
    );
  }

  private onToolUse(payload: PostToolUsePayload): void {
    if (payload.agentId !== undefined || !payload.success) return;
    void this.captureToolUse(payload).catch((error: unknown) => {
      if (this.logger) {
        this.logger.error(`autoLink tool activity failed for ${payload.sessionId}`,
          error instanceof Error ? error : new Error(String(error)));
      } else {
        this.log(`autoLink tool activity failed for ${payload.sessionId}: ${describe(error)}`);
      }
    });
  }

  private async captureToolUse(payload: PostToolUsePayload): Promise<void> {
    const ptahWorktree = payload.toolName === 'mcp__ptah__ptah_git_worktree_add';
    const file = ['Write', 'Edit', 'MultiEdit'].includes(payload.toolName)
      ? fileToolInput.safeParse(payload.toolInput)
      : null;
    const notebook = payload.toolName === 'NotebookEdit' ? notebookToolInput.safeParse(payload.toolInput) : null;
    const bash = payload.toolName === 'Bash' ? bashToolInput.safeParse(payload.toolInput) : null;
    const paths: string[] = [];
    if (file?.success) paths.push(file.data.file_path);
    if (notebook?.success) paths.push(notebook.data.notebook_path);
    if (bash?.success) paths.push(...extractBashPaths(bash.data.command));
    if (ptahWorktree) {
      const args = worktreeArgs.safeParse(payload.toolInput);
      if (args.success) {
        const content = mcpContent.safeParse(payload.toolOutput);
        const responsePath = content.success ? /\*\*Path:\*\*\s*(.+?)\s{2}/.exec(content.data.content.map((c) => c.text ?? '').join('\n'))?.[1] : undefined;
        const argumentPath = resolveWorktreePath(payload.workspaceRoot, args.data.branch, args.data.path?.trim());
        paths.push(argumentPath || (responsePath && responsePath !== 'unknown' ? responsePath : ''));
      }
    }
    if (payload.toolName === 'mcp__ptah__ptah_task_create') {
      const content = mcpContent.safeParse(payload.toolOutput);
      if (content.success && !content.data.isError) {
        let foundId = false;
        for (const part of content.data.content) {
          const parsed = z.string().transform((s, ctx) => { try { return JSON.parse(s) as unknown; } catch { ctx.addIssue({ code: 'custom', message: 'invalid JSON' }); return z.NEVER; } }).pipe(taskResult).safeParse(part.text);
          if (parsed.success) {
            foundId = true;
            await this.captureTaskId(payload.sessionId, payload.workspaceRoot, parsed.data.task.id);
          } else {
            const fallbackId = taskIdInResponse.exec(part.text ?? '')?.[1];
            if (fallbackId) {
              foundId = true;
              await this.captureTaskId(payload.sessionId, payload.workspaceRoot, fallbackId);
            }
          }
        }
        if (!foundId) this.log(`autoLink task-create id unavailable for ${payload.sessionId}`);
      }
    }
    if (paths.length === 0) return;
    const metadata = await this.metadata.get(payload.sessionId);
    if (metadata === null || !this.started) return;
    const root = normalizeWorkspaceRoot(metadata.workspaceId);
    if (pathKey(root, process.platform) !== pathKey(payload.workspaceRoot, process.platform)) return;
    if (ptahWorktree) {
      const args = worktreeArgs.safeParse(payload.toolInput);
      if (args.success && paths[0]) {
        await this.recordWorktree(payload.sessionId, metadata, path.resolve(root, paths[0]), args.data.branch);
        if (this.store.getOrganization(root, payload.sessionId)?.worktreePath) {
          await this.reconcile(payload.sessionId, { cascade: true });
        }
      }
      return;
    }
    const rootPathKey = pathKey(root, process.platform);
    for (const raw of paths) {
      const absolute = path.resolve(metadata.workingDirectory ?? root, raw);
      // Compare with platform case rules; slice names from original casing.
      const slashed = process.platform === 'win32' ? absolute.replace(/\\/g, '/') : absolute;
      const normalized = pathKey(absolute, process.platform);
      const prefix = `${rootPathKey}/.claude-worktrees/`;
      const originalPrefix = `${process.platform === 'win32' ? root.replace(/\\/g, '/') : root}/.claude-worktrees/`;
      if (!normalized.startsWith(prefix)) {
        if (file?.success || notebook?.success) await this.captureTaskWrite(payload.sessionId, slashed, root, root);
        continue;
      }
      if (slashed.length < originalPrefix.length) continue;
      const name = slashed.slice(originalPrefix.length).split('/')[0];
      if (!name) continue;
      const worktree = path.join(
        metadata.workspaceId ?? root,
        '.claude-worktrees',
        name,
      );
      const worktreeKey = `${payload.sessionId}\0${pathKey(worktree, process.platform)}`;
      if (this.seenWorktrees.has(worktreeKey)) {
        remember(this.seenWorktrees, worktreeKey);
      } else {
        remember(this.seenWorktrees, worktreeKey);
        try {
          await this.recordWorktree(payload.sessionId, metadata, worktree);
          if (this.store.getOrganization(root, payload.sessionId)?.worktreePath) {
            await this.reconcile(payload.sessionId, { cascade: true });
          } else {
            this.seenWorktrees.delete(worktreeKey);
          }
        } catch (error: unknown) {
          this.seenWorktrees.delete(worktreeKey);
          throw error;
        }
      }
      if (file?.success || notebook?.success) await this.captureTaskWrite(payload.sessionId, slashed, worktree, root);
    }
  }

  /** `file` is slash-separated in its original casing. */
  private async captureTaskWrite(sessionId: string, file: string, dir: string, root: string): Promise<void> {
    const originalPrefix = `${process.platform === 'win32' ? dir.replace(/\\/g, '/') : dir}/.ptah/specs/`;
    const prefix = `${pathKey(dir, process.platform)}/.ptah/specs/`;
    if (!pathKey(file, process.platform).startsWith(prefix)) return;
    if (file.length < originalPrefix.length) return;
    const taskId = file.slice(originalPrefix.length).split('/')[0];
    if (!TASK_ID_PATTERN.test(taskId)) return;
    const taskKey = `${sessionId}\0${taskId}`;
    if (this.seenTaskWrites.has(taskKey)) {
      remember(this.seenTaskWrites, taskKey);
      return;
    }
    remember(this.seenTaskWrites, taskKey);
    try {
      if (await this.taskPresence([dir, root], taskId) !== 'present') {
        this.seenTaskWrites.delete(taskKey);
        return;
      }
      await this.reconcile(sessionId, { r8: taskId, cascade: true });
      if (this.deferredR8.get(sessionId)?.has(taskId) ||
          !this.store.getOrganization(root, sessionId)?.tasks.some((link) => link.taskId === taskId)) {
        this.seenTaskWrites.delete(taskKey);
      }
    } catch (error: unknown) {
      this.seenTaskWrites.delete(taskKey);
      throw error;
    }
  }

  private async captureTaskId(sessionId: string, workspaceRoot: string, taskId: string): Promise<void> {
    if (!TASK_ID_PATTERN.test(taskId)) return;
    const metadata = await this.metadata.get(sessionId);
    if (!metadata || !this.started) return;
    const root = normalizeWorkspaceRoot(metadata.workspaceId);
    if (pathKey(root, process.platform) !== pathKey(workspaceRoot, process.platform)) return;
    if (await this.taskPresence([root, metadata.workingDirectory ?? null], taskId) === 'present') {
      await this.reconcile(sessionId, { r8: taskId, cascade: true });
    }
  }

  // ── Reconcile ──────────────────────────────────────────────────────────────

  /**
   * Reconcile one session. Runs never overlap per session: a request that
   * arrives while one runs is merged and runs once more afterwards.
   */
  private async reconcile(
    sessionId: string,
    request: { r3?: string; r8?: string; cascade: boolean },
  ): Promise<void> {
    if (!this.started) return;
    this.mergeRequest(sessionId, {
      r3: new Set(request.r3 === undefined ? [] : [request.r3]),
      r8: new Set(request.r8 === undefined ? [] : [request.r8]),
      cascade: request.cascade,
      attempt: 0,
    });
    if (this.running.has(sessionId)) return;
    this.running.add(sessionId);
    try {
      for (
        let next = this.requests.get(sessionId);
        next !== undefined && this.started;
        next = this.requests.get(sessionId)
      ) {
        this.requests.delete(sessionId);
        try {
          await this.reconcileOnce(sessionId, next);
        } catch (error: unknown) {
          // One failed run must not strand requests merged in meanwhile.
          this.keepR8(sessionId, next);
          this.log(`autoLink reconcile failed for ${sessionId}: ${describe(error)}`);
        }
      }
    } finally {
      this.running.delete(sessionId);
    }
  }

  private mergeRequest(sessionId: string, request: ReconcileRequest): void {
    const pending = this.requests.get(sessionId) ?? {
      r3: new Set<string>(),
      r8: new Set<string>(),
      cascade: false,
      attempt: 0,
    };
    for (const taskId of request.r3) pending.r3.add(taskId);
    for (const taskId of request.r8) pending.r8.add(taskId);
    pending.cascade = pending.cascade || request.cascade;
    pending.attempt = Math.max(pending.attempt, request.attempt);
    this.requests.set(sessionId, pending);
  }

  private async reconcileOnce(
    sessionId: string,
    request: ReconcileRequest,
  ): Promise<void> {
    const metadata = await this.metadata.get(sessionId);
    if (!this.started) return;
    if (metadata === null) {
      this.keepR3(sessionId, request, 'no-metadata');
      this.keepR8(sessionId, request);
      return;
    }
    if (!this.service.isAvailable()) {
      this.deferRequest(sessionId, request);
      return;
    }
    const root = normalizeWorkspaceRoot(metadata.workspaceId);
    const organization = this.store.getOrganization(root, sessionId);
      if (organization === null && request.r3.size === 0 && request.r8.size === 0) return;

    const desired = await this.desiredLinks(
      root,
      organization,
      metadata,
      request.r3,
      request.r8,
    );
    if (!this.started) return;
    let outcome: CaptureOutcome;
    try {
      outcome = await this.service.commitCapture(
        'autoLink reconcile',
        sessionId,
        undefined,
        (writeRoot, now) => {
          if (!this.started) return [];
          const changed = this.store.applyAutoLinkPlan(
            writeRoot,
            sessionId,
            (current) =>
              planAutoLinks(
                current,
                this.sideTables.listSuppressed(writeRoot, sessionId),
                desired,
              ),
            now,
          );
          if (!changed) return [];
          // The change is emitted synchronously right after this returns;
          // `onChange` consumes the mark.
          this.ownWrites.add(sessionId);
          return [sessionId];
        },
      );
    } finally {
      this.ownWrites.delete(sessionId);
    }
    if (outcome === 'unavailable') {
      this.deferRequest(sessionId, request);
      return;
    }
    if (outcome === 'failed' || outcome === 'no-metadata') {
      this.retryOrKeep(sessionId, request, outcome);
      return;
    }
    if (request.cascade) await this.cascade(root, sessionId);
  }

  /** The store closed mid-way: keep the R3 candidates and the reconcile. */
  private deferRequest(sessionId: string, request: ReconcileRequest): void {
    for (const taskId of request.r3) this.queue(sessionId, taskId);
    this.keepR8(sessionId, request);
    this.addPendingResolve(sessionId);
  }

  /**
   * The write threw (`failed`) or the session lost its root (`no-metadata`).
   * A failed write re-runs at most MAX_COMMIT_RETRIES times right away; after
   * that, and for `no-metadata`, the R3 candidates wait in the bounded prompt
   * queue for the session's next resolve or the store's next open.
   */
  private retryOrKeep(
    sessionId: string,
    request: ReconcileRequest,
    outcome: 'failed' | 'no-metadata',
  ): void {
    if (outcome === 'failed' && request.attempt < MAX_COMMIT_RETRIES) {
      this.mergeRequest(sessionId, { ...request, attempt: request.attempt + 1 });
      return;
    }
    this.keepR3(sessionId, request, outcome);
    this.keepR8(sessionId, request);
  }

  /** Park the R3 candidates of a run that could not commit (bounded queue). */
  private keepR3(
    sessionId: string,
    request: ReconcileRequest,
    reason: string,
  ): void {
    for (const taskId of request.r3) {
      this.queue(sessionId, taskId);
      this.log(`autoLink R3 ${taskId} kept for ${sessionId}: ${reason}`);
    }
  }
  private keepR8(sessionId: string, request: ReconcileRequest): void {
    if (request.r8.size === 0) return;
    if (!this.deferredR8.has(sessionId) && this.deferredR8.size >= MAX_DEFERRED_SESSIONS) {
      const oldest = this.deferredR8.keys().next().value;
      if (oldest) {
        this.deferredR8.delete(oldest);
        this.log(`autoLink R8 deferred evidence evicted for ${oldest}: too many sessions`);
      }
    }
    const pending = this.deferredR8.get(sessionId) ?? new Set<string>();
    for (const taskId of request.r8) {
      pending.delete(taskId);
      pending.add(taskId);
      if (pending.size > MAX_DEFERRED_TASKS) {
        const oldest = pending.values().next().value;
        if (oldest) pending.delete(oldest);
        this.log(`autoLink R8 deferred evidence evicted for ${sessionId}: too many tasks`);
      }
    }
    this.deferredR8.delete(sessionId);
    this.deferredR8.set(sessionId, pending);
    this.addPendingResolve(sessionId);
  }

  /** Children, forks and worktree peers, one level deep (no further cascade). */
  private async cascade(root: string, sessionId: string): Promise<void> {
    const organization = this.store.getOrganization(root, sessionId);
    const related = new Set(this.store.listDependentIds(root, sessionId));
    if (organization?.worktreePath) {
      for (const peer of this.store.listWorktreePeers(
        root,
        organization.worktreePath,
        sessionId,
      )) {
        related.add(peer.sessionId);
      }
    }
    for (const id of related) {
      await this.reconcile(id, { cascade: false });
    }
  }

  /** The complete desired automatic set (R3 candidates plus R4-R7). */
  private async desiredLinks(
    root: string,
    organization: StoredOrganization | null,
    metadata: SessionMetadata,
    r3: ReadonlySet<string>,
    r8: ReadonlySet<string>,
  ): Promise<AutoCandidate[]> {
    const desired: AutoCandidate[] = [...r3].map((taskId) => ({
      taskId,
      rule: 'R3',
      role: 'primary',
      evidence: null,
    }));
    for (const taskId of r8) desired.push({ taskId, rule: 'R8', role: 'primary', evidence: null });
    if (organization === null) return desired;

    const worktreePath = organization.worktreePath;
    const named = taskIdsInWorktreeName(worktreePath, organization.branch);
    const dirs = [root, worktreePath, metadata.workingDirectory ?? null];
    const existing: string[] = [];
    for (const taskId of named) {
      const presence = await this.taskPresence(dirs, taskId);
      // A check that threw keeps the R4 row this session already holds, so a
      // flaky filesystem does not delete and re-add it.
      if (
        presence === 'present' ||
        (presence === 'unknown' && holdsAutoRule(organization, taskId, 'R4'))
      ) {
        existing.push(taskId);
      }
    }
    if (existing.length === 1 && existing[0] !== undefined) {
      desired.push({
        taskId: existing[0],
        rule: 'R4',
        role: 'primary',
        evidence: worktreeEvidence(worktreePath ?? '', organization.branch),
      });
    } else if (existing.length === 0 && worktreePath !== null) {
      const peerTask = this.peerPrimaryTask(
        root,
        worktreePath,
        organization.sessionId,
      );
      if (peerTask !== null) {
        desired.push({
          taskId: peerTask,
          rule: 'R5',
          role: 'primary',
          evidence: worktreePath,
        });
      }
    }

    const parentId = organization.parentSessionId;
    if (parentId !== null) {
      const parentPrimary = this.store
        .getOrganization(root, parentId)
        ?.tasks.find((link) => link.role === 'primary');
      if (parentPrimary !== undefined) {
        desired.push({
          taskId: parentPrimary.taskId,
          rule: 'R6',
          role: 'related',
          evidence: parentId,
        });
      }
    }

    const forkId = organization.forkOfSessionId;
    if (forkId !== null) {
      for (const link of this.store.getOrganization(root, forkId)?.tasks ??
        []) {
        desired.push({
          taskId: link.taskId,
          rule: 'R7',
          role: link.role,
          evidence: forkId,
        });
      }
    }
    return desired;
  }

  /**
   * R5: the one task the other sessions in this worktree hold as an explicit
   * or `/orchestrate` primary. Peers' own derived links (R4-R7) do not count,
   * so two peers can never keep each other linked after the evidence is gone.
   */
  private peerPrimaryTask(
    root: string,
    worktreePath: string,
    sessionId: string,
  ): string | null {
    const tasks = new Set<string>();
    for (const peer of this.store.listWorktreePeers(
      root,
      worktreePath,
      sessionId,
    )) {
      if (peer.primary !== null && isPeerEvidence(peer.primary)) {
        tasks.add(peer.primary.taskId);
      }
    }
    return tasks.size === 1 ? ([...tasks][0] ?? null) : null;
  }

  // ── Task folder existence ──────────────────────────────────────────────────

  /**
   * Whether `<dir>/.ptah/specs/<id>/task.md` exists in one of `dirs`.
   * `unknown`: no dir had it and at least one check threw.
   */
  private async taskPresence(
    dirs: ReadonlyArray<string | null>,
    taskId: string,
  ): Promise<TaskPresence> {
    if (!TASK_ID_PATTERN.test(taskId)) return 'absent';
    let failed = false;
    for (const dir of new Set(dirs)) {
      if (dir === null || dir.trim().length === 0) continue;
      const key = `${dir}\u0000${taskId}`;
      if (this.existingTasks.has(key)) return 'present';
      const file = path.join(dir, '.ptah', 'specs', taskId, CARRIER_FILE);
      let exists = false;
      try {
        exists = await this.fs.exists(file);
      } catch (error: unknown) {
        failed = true;
        this.log(`autoLink existence check failed for ${taskId}: ${describe(error)}`);
      }
      if (exists) {
        this.rememberTask(key);
        return 'present';
      }
    }
    return failed ? 'unknown' : 'absent';
  }

  private rememberTask(key: string): void {
    if (this.existingTasks.size >= MAX_EXISTENCE_CACHE) {
      const oldest = this.existingTasks.values().next().value;
      if (oldest !== undefined) this.existingTasks.delete(oldest);
    }
    this.existingTasks.add(key);
  }

  /** A task folder changed: its cached existence may be stale. */
  private forgetTask(taskId: string): void {
    const suffix = `\u0000${taskId}`;
    for (const key of [...this.existingTasks]) {
      if (key.endsWith(suffix)) this.existingTasks.delete(key);
    }
  }

  // ── plumbing ───────────────────────────────────────────────────────────────

  /** Run an async handler detached; a failure is one log line. */
  private detach(
    trigger: string,
    sessionId: string,
    body: () => Promise<void>,
  ): void {
    void body().catch((error: unknown) => {
      this.log(`autoLink ${trigger} failed for ${sessionId}: ${describe(error)}`);
    });
  }

  private releaseAll(): void {
    const disposers = this.disposers;
    this.disposers = [];
    for (const release of disposers) {
      try {
        release();
      } catch (error: unknown) {
        this.log(`releasing an auto-link subscription failed: ${describe(error)}`);
      }
    }
  }

  private log(message: string): void {
    this.output.appendLine(`${LOG_PREFIX} ${message}`);
  }
}

/** The session already holds an automatic link of `taskId` by `rule`. */
function holdsAutoRule(
  organization: StoredOrganization,
  taskId: string,
  rule: StoredTaskLink['autoRule'],
): boolean {
  return organization.tasks.some(
    (link) => link.taskId === taskId && link.autoRule === rule,
  );
}

/** Explicit and directly observed primaries are evidence for a worktree peer. */
function isPeerEvidence(link: StoredTaskLink): boolean {
  return link.autoRule === 'R3' || link.autoRule === 'R8' ||
    (!isAutoRule(link.autoRule) && isProtectedSource(link.source));
}

function disposerOf(disposable: IDisposable): () => void {
  return () => disposable.dispose();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
