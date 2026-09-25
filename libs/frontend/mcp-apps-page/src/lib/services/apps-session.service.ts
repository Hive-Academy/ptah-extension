import {
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  ClaudeRpcService,
  EffortStateService,
  ModelStateService,
} from '@ptah-extension/core';
import {
  ConversationRegistry,
  SessionLivenessRegistry,
  SurfaceId,
  TabId,
  TabManagerService,
  TabSessionBinding,
  type ClaudeSessionId,
} from '@ptah-extension/chat-state';
import {
  StreamRouter,
  StreamingSurfaceRegistry,
  SurfaceUpdateInbox,
  WorkflowSessionClaimService,
} from '@ptah-extension/chat-routing';
import type { StreamingState } from '@ptah-extension/chat-types';
import { APPS_SYSTEM_PROMPT } from '../apps-system-prompt';
import {
  updateSurfaceOverlays,
  type AppsSurfaceState,
} from '../state/apps-surface-reducer';
import type { AppsOperationOverlays } from '../state/apps-operation-overlays';
import {
  AppsSurfaceSync,
  type AppsSurfaceReadReason,
  type AppsSurfaceStore,
} from './apps-surface-sync';
import {
  appsSliceKey,
  appsWorkspacePath,
  createAppsWorkspaceSlice,
  findAppsSliceKey,
  isAppsSliceOf,
  patchAppsSlice,
  readAppsSlice,
  removeAppsSlice,
  startAppsSlice,
  type AppsConversation,
  type AppsUserBubble,
  type AppsWorkspaceSlice,
} from './apps-workspace-slice';

/** The session name shown in the session sidebar (plan D3). */
export const APPS_SESSION_NAME = 'Apps';

const LOG_PREFIX = '[AppsSessionService]';

function failureText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : fallback;
}

/**
 * `AppsSessionService` — the root facade of the Apps page conversation
 * (implementation-plan.md D1 :142-158, D3 :174-214, Component 4 :387-403).
 *
 * Root-provided, defined in the lazy Apps lib: the routed page holds no
 * state, so leaving the tab and returning shows the same conversation and
 * surfaces (Req 2.4). State is partitioned by workspace path
 * (`tribunal-state.service.ts:144-168`): the public signals read the ACTIVE
 * slice, so a workspace switch shows that workspace's own slice (Req 2.6),
 * and a removed workspace's slice is torn down.
 *
 * The conversation follows the harness path
 * (`harness-workflow.service.ts:271-471`) with one addition: the page's
 * routing id is claimed on `SurfaceUpdateInbox` BEFORE `chat:start`, so no
 * push can arrive unclaimed. A failed start and `discard()` release, in
 * order: the inbox claim, the workflow claim, the streaming surface
 * (`StreamRouter.onSurfaceClosed`, which unregisters the adapter) and the
 * slice's `AppsSurfaceSync` (timers and the read in flight).
 *
 * It never mutates `TabManagerService` (Req 2.1): it only reads the active
 * workspace path and workspace removals. Public methods never throw.
 */
@Injectable({ providedIn: 'root' })
export class AppsSessionService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly modelState = inject(ModelStateService);
  private readonly effortState = inject(EffortStateService);
  private readonly tabManager = inject(TabManagerService);
  private readonly conversationRegistry = inject(ConversationRegistry);
  private readonly tabSessionBinding = inject(TabSessionBinding);
  private readonly liveness = inject(SessionLivenessRegistry);
  private readonly streamRouter = inject(StreamRouter);
  private readonly surfaceRegistry = inject(StreamingSurfaceRegistry);
  private readonly workflowClaims = inject(WorkflowSessionClaimService);
  private readonly inbox = inject(SurfaceUpdateInbox);

  /** Workspace slice key → slice. */
  private readonly _slices = signal<ReadonlyMap<string, AppsWorkspaceSlice>>(
    new Map(),
  );

  /** Last `removedWorkspace$` seq handled, so each removal runs once. */
  private lastRemovedWorkspaceSeq = 0;

  /** The key of the workspace the page currently shows. */
  public readonly workspaceKey = computed(() =>
    appsSliceKey(this.tabManager.activeWorkspacePath$()),
  );

  private readonly activeSlice = computed(() =>
    readAppsSlice(this._slices(), this.workspaceKey()),
  );

  public readonly isActive = computed(
    () => this.activeSlice().conversation !== null,
  );
  public readonly routingId = computed(
    () => this.activeSlice().conversation?.routingId ?? null,
  );
  public readonly surfaceId = computed<SurfaceId | null>(
    () => this.activeSlice().conversation?.surfaceId ?? null,
  );
  public readonly userBubbles = computed<readonly AppsUserBubble[]>(
    () => this.activeSlice().userBubbles,
  );
  public readonly streamingState = computed<StreamingState>(
    () => this.activeSlice().streamingState,
  );
  /** The reducer-held surfaces of the active slice. */
  public readonly surfaces = computed<AppsSurfaceState>(
    () => this.activeSlice().surfaces,
  );
  public readonly syncNotice = computed(() => this.activeSlice().syncNotice);
  public readonly error = computed(() => this.activeSlice().error);

  /** Head session of the active conversation, or null before one resolves. */
  public readonly sessionId = computed<ClaudeSessionId | null>(() => {
    const surfaceId = this.surfaceId();
    return surfaceId === null ? null : this.sessionFor(surfaceId);
  });

  public readonly isProcessing = computed(() => {
    const slice = this.activeSlice();
    if (slice.conversation === null) return false;
    const sessionId = this.sessionId();
    if (sessionId === null) return slice.turnPending;
    const status = this.liveness.statuses().get(sessionId);
    return status === 'streaming' || status === 'awaiting-background';
  });

  public constructor() {
    // A removed workspace's conversation is dead: release its claims, its
    // surface and its sync, then drop the slice. `removedWorkspace$` is
    // append-only, so the own seq cursor acts on each removal exactly once.
    effect(() => {
      const removed = this.tabManager.removedWorkspace$();
      if (removed === null || removed.seq <= this.lastRemovedWorkspaceSeq)
        return;
      this.lastRemovedWorkspaceSeq = removed.seq;
      untracked(() => this.dropSlice(appsSliceKey(removed.path)));
    });
  }

  /**
   * Start the page-owned conversation in the active workspace with its first
   * prompt. A no-op when the active slice already has a conversation.
   */
  public async start(prompt: string): Promise<void> {
    const key = this.workspaceKey();
    if (readAppsSlice(this._slices(), key).conversation !== null) return;

    let conversation: AppsConversation | null = null;
    try {
      conversation = this.claimConversation(key, prompt);
      const model = this.modelState.currentModel();
      const effort = this.effortState.currentEffort();
      const result = await this.rpc.call('chat:start', {
        prompt,
        tabId: conversation.routingId,
        name: APPS_SESSION_NAME,
        ...(conversation.workspacePath !== null
          ? { workspacePath: conversation.workspacePath }
          : {}),
        surfaceMode: true,
        options: {
          ...(model ? { model } : {}),
          ...(effort ? { effort } : {}),
          systemPrompt: APPS_SYSTEM_PROMPT,
        },
      });
      if (!result.success || result.data?.success === false) {
        this.rollBackFailedStart(
          key,
          conversation,
          result.data?.error ??
            result.error ??
            'Failed to start the Apps session.',
        );
      }
    } catch (error: unknown) {
      if (conversation !== null) {
        this.rollBackFailedStart(
          key,
          conversation,
          failureText(error, 'Failed to start the Apps session.'),
        );
      } else {
        console.warn(`${LOG_PREFIX} start failed before chat:start`);
        this.patch(key, (slice) => ({
          ...slice,
          error: 'Failed to start the Apps session.',
        }));
      }
    }
  }

  /**
   * Send a user turn: starts the conversation when there is none, otherwise
   * continues it with `chat:continue`. A failed continue only sets `error`.
   */
  public async send(prompt: string): Promise<void> {
    const key = this.workspaceKey();
    const slice = readAppsSlice(this._slices(), key);
    const conversation = slice.conversation;
    if (conversation === null) {
      await this.start(prompt);
      return;
    }
    const sessionId = this.sessionFor(conversation.surfaceId);
    if (sessionId === null) {
      console.warn(`${LOG_PREFIX} send before the session resolved`);
      this.patchOwned(key, conversation.routingId, (current) => ({
        ...current,
        error: 'The Apps session is still starting. Try again in a moment.',
      }));
      return;
    }

    this.patchOwned(key, conversation.routingId, (current) => ({
      ...current,
      turnPending: true,
      error: null,
      userBubbles: [...current.userBubbles, { text: prompt, at: Date.now() }],
    }));
    try {
      const result = await this.rpc.call('chat:continue', {
        sessionId,
        tabId: conversation.routingId,
        prompt,
        surfaceMode: true,
      });
      if (!result.success || result.data?.success === false) {
        this.failTurn(
          key,
          conversation.routingId,
          'chat:continue',
          result.data?.error ?? result.error ?? 'Failed to send the message.',
        );
      }
    } catch (error: unknown) {
      this.failTurn(
        key,
        conversation.routingId,
        'chat:continue',
        failureText(error, 'Failed to send the message.'),
      );
    }
  }

  /**
   * Stop the running agent of the active conversation, keeping the
   * conversation, its surfaces and every claim. Marks the session idle only
   * when the abort succeeded (`harness-workflow.service.ts:405-443`).
   */
  public async abort(): Promise<void> {
    const key = this.workspaceKey();
    const conversation = readAppsSlice(this._slices(), key).conversation;
    if (conversation === null) return;
    const sessionId = this.sessionFor(conversation.surfaceId);
    if (sessionId === null) return;
    try {
      const result = await this.rpc.call('chat:abort', { sessionId });
      if (!result.success || result.data?.success === false) {
        this.failTurn(
          key,
          conversation.routingId,
          'chat:abort',
          result.data?.error ?? result.error ?? 'Failed to stop the agent.',
        );
        return;
      }
      this.patchOwned(key, conversation.routingId, (slice) => ({
        ...slice,
        turnPending: false,
      }));
      this.liveness.markIdle(
        sessionId,
        conversation.workspacePath ?? undefined,
      );
    } catch (error: unknown) {
      this.failTurn(
        key,
        conversation.routingId,
        'chat:abort',
        failureText(error, 'Failed to stop the agent.'),
      );
    }
  }

  /**
   * Tear down the active workspace's conversation and forget its state
   * (Req 2.5). Does not abort a running agent; callers that mean to stop it
   * call `abort()` first.
   */
  public discard(): void {
    try {
      const key = this.workspaceKey();
      this.teardown(readAppsSlice(this._slices(), key));
      this.patch(key, () => createAppsWorkspaceSlice());
    } catch (error: unknown) {
      console.warn(
        `${LOG_PREFIX} discard failed: ${failureText(error, 'unknown error')}`,
      );
    }
  }

  /** Dismiss the active slice's error. */
  public clearError(): void {
    this.patch(this.workspaceKey(), (slice) =>
      slice.error === null ? slice : { ...slice, error: null },
    );
  }

  /**
   * Request a `surface:read` for the conversation of `routingId` (a
   * `stale-revision` or `not-found` result, plan :553, :560). Coalesced by
   * the slice's `AppsSurfaceSync`. Unknown routing ids are ignored.
   */
  public requestSurfaceRead(
    routingId: string,
    reason: AppsSurfaceReadReason,
  ): void {
    this.syncFor(routingId)?.requestRead(reason);
  }

  /**
   * Rule 1 → Rule 3: an operation on `surfaceId` settled `applied` at
   * `revision`. Raises the expected revision and arms the grace timer; never
   * touches the materialized revision.
   */
  public expectSurfaceRevision(
    routingId: string,
    surfaceId: string,
    revision: number,
  ): void {
    this.syncFor(routingId)?.expectRevision(surfaceId, revision);
  }

  /**
   * Rule 4: add, settle or retire overlays of one held surface of the
   * conversation of `routingId`. Never touches a materialized revision.
   */
  public updateOverlays(
    routingId: string,
    surfaceId: string,
    update: (overlays: AppsOperationOverlays) => AppsOperationOverlays,
  ): void {
    try {
      const key = findAppsSliceKey(this._slices(), routingId);
      if (key === null) return;
      this.patchOwned(key, routingId, (slice) => {
        const surfaces = updateSurfaceOverlays(
          slice.surfaces,
          surfaceId,
          update,
        );
        return surfaces === slice.surfaces ? slice : { ...slice, surfaces };
      });
    } catch (error: unknown) {
      console.warn(
        `${LOG_PREFIX} overlays not updated: ${failureText(error, 'unknown error')}`,
      );
    }
  }

  /**
   * Mint the ids and claim everything a conversation needs, in the order the
   * plan fixes: the inbox claim FIRST, so no push can arrive unclaimed, then
   * the workflow claim, the interactive surface and its conversation binding.
   */
  private claimConversation(key: string, prompt: string): AppsConversation {
    const conversation: AppsConversation = {
      routingId: TabId.create() as string,
      surfaceId: SurfaceId.create(),
      workspacePath: appsWorkspacePath(key),
    };
    const sync = new AppsSurfaceSync(
      this.rpc,
      conversation.routingId,
      this.surfaceStore(key, conversation.routingId),
    );
    // The slice holds the conversation before the claim, so the first push
    // already finds the slice it writes to.
    this.patch(key, () =>
      startAppsSlice(conversation, sync, { text: prompt, at: Date.now() }),
    );
    try {
      this.inbox.claim(conversation.routingId, (raw) => sync.onPush(raw));
      this.workflowClaims.claim(conversation.routingId, conversation.surfaceId);
      this.surfaceRegistry.register(
        conversation.surfaceId,
        () => readAppsSlice(this._slices(), key).streamingState,
        (next) =>
          this.patchOwned(key, conversation.routingId, (slice) => ({
            ...slice,
            streamingState: next,
          })),
        { interactive: true },
      );
      this.streamRouter.onSurfaceCreated(conversation.surfaceId);
    } catch (error: unknown) {
      // Undo the partial claim so no half-started conversation stays held.
      this.releaseConversation(conversation, sync);
      this.patch(key, () => createAppsWorkspaceSlice());
      throw error;
    }
    return conversation;
  }

  /**
   * Undo everything `claimConversation` did, then report the failure. Only
   * when the slice still belongs to this conversation: a `discard()` during
   * the await already released it.
   */
  private rollBackFailedStart(
    key: string,
    conversation: AppsConversation,
    message: string,
  ): void {
    console.warn(`${LOG_PREFIX} chat:start failed; rolling back`);
    const slice = readAppsSlice(this._slices(), key);
    // `discard()` or a workspace removal during the await already released
    // this conversation; a newer conversation in the slice is not ours.
    if (!isAppsSliceOf(slice, conversation.routingId)) return;
    this.teardown(slice);
    this.patch(key, () => ({ ...createAppsWorkspaceSlice(), error: message }));
  }

  private failTurn(
    key: string,
    routingId: string,
    method: string,
    message: string,
  ): void {
    console.warn(`${LOG_PREFIX} ${method} failed`);
    this.patchOwned(key, routingId, (slice) => ({
      ...slice,
      turnPending: false,
      error: message,
    }));
  }

  /** Release the conversation (if any) held by `slice`. Never throws. */
  private teardown(slice: AppsWorkspaceSlice): void {
    if (slice.conversation !== null) {
      this.releaseConversation(slice.conversation, slice.sync);
    } else {
      slice.sync?.dispose();
    }
  }

  private releaseConversation(
    conversation: AppsConversation,
    sync: AppsSurfaceSync | null,
  ): void {
    const steps: readonly (() => void)[] = [
      () => this.inbox.release(conversation.routingId),
      () => this.workflowClaims.release(conversation.routingId),
      () => this.streamRouter.onSurfaceClosed(conversation.surfaceId),
      () => sync?.dispose(),
    ];
    for (const step of steps) {
      try {
        step();
      } catch (error: unknown) {
        // One failing release must not keep the others from running.
        console.warn(
          `${LOG_PREFIX} release step failed: ${failureText(error, 'unknown error')}`,
        );
      }
    }
  }

  private dropSlice(key: string): void {
    try {
      this.teardown(readAppsSlice(this._slices(), key));
      this._slices.update((slices) => removeAppsSlice(slices, key));
    } catch (error: unknown) {
      console.warn(
        `${LOG_PREFIX} workspace slice not dropped: ${failureText(error, 'unknown error')}`,
      );
    }
  }

  /** The store `AppsSurfaceSync` writes through, bound to one conversation. */
  private surfaceStore(key: string, routingId: string): AppsSurfaceStore {
    return {
      surfaces: () => readAppsSlice(this._slices(), key).surfaces,
      setSurfaces: (next) =>
        this.patchOwned(key, routingId, (slice) => ({
          ...slice,
          surfaces: next,
        })),
      setSyncNotice: (notice) =>
        this.patchOwned(key, routingId, (slice) =>
          slice.syncNotice === notice
            ? slice
            : { ...slice, syncNotice: notice },
        ),
    };
  }

  private syncFor(routingId: string): AppsSurfaceSync | null {
    const key = findAppsSliceKey(this._slices(), routingId);
    return key === null ? null : readAppsSlice(this._slices(), key).sync;
  }

  private sessionFor(surfaceId: SurfaceId): ClaudeSessionId | null {
    const convId = this.tabSessionBinding.conversationForSurface(surfaceId);
    if (!convId) return null;
    const record = this.conversationRegistry.getRecord(convId);
    if (!record || record.sessions.length === 0) return null;
    return record.sessions[record.sessions.length - 1];
  }

  private patch(
    key: string,
    update: (slice: AppsWorkspaceSlice) => AppsWorkspaceSlice,
  ): void {
    this._slices.update((slices) => patchAppsSlice(slices, key, update));
  }

  /** Patch `key`'s slice only while it still belongs to `routingId`. */
  private patchOwned(
    key: string,
    routingId: string,
    update: (slice: AppsWorkspaceSlice) => AppsWorkspaceSlice,
  ): void {
    this.patch(key, (slice) =>
      isAppsSliceOf(slice, routingId) ? update(slice) : slice,
    );
  }
}
