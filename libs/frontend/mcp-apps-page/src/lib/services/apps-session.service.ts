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
  SessionLivenessRegistry,
  SurfaceId,
  TabId,
  TabManagerService,
  type ClaudeSessionId,
} from '@ptah-extension/chat-state';
import type { StreamingState } from '@ptah-extension/chat-types';
import type { SessionId } from '@ptah-extension/shared';
import { APPS_SYSTEM_PROMPT } from '../apps-system-prompt';
import { AppsConversationClaims } from './apps-conversation-claims';
import {
  abortAppsSession,
  abortUnownedAppsStart,
  failureText,
} from './apps-session-rpc';
import type { SurfaceViewState } from '@ptah-extension/declarative-dashboard';
import {
  activateSurface,
  setSurfaceViewState,
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
  APPS_IMPLICIT_WORKSPACE,
  appsSliceKey,
  appsWorkspacePath,
  createAppsWorkspaceSlice,
  findAppsSliceKey,
  isAppsSliceOf,
  isLiveAppsStatus,
  patchAppsSlice,
  readAppsSlice,
  recordAppsFocusKey,
  removeAppsSlice,
  settleAppsSlice,
  startAppsSlice,
  type AppsConversation,
  type AppsUserBubble,
  type AppsWorkspaceSlice,
} from './apps-workspace-slice';

/** The session name shown in the session sidebar (plan D3). */
export const APPS_SESSION_NAME = 'Apps';

/** First sentence of the notice a failed "New conversation" leaves. */
export const APPS_RESET_KEPT_NOTICE =
  'The agent could not be stopped, so this conversation was kept.';

const LOG_PREFIX = '[AppsSessionService]';

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
 * push can arrive unclaimed. `AppsConversationClaims` owns that claim order
 * and the release a failed start, `discard()` or a removed workspace runs.
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
  private readonly liveness = inject(SessionLivenessRegistry);
  private readonly claims = inject(AppsConversationClaims);

  /** Workspace slice key → slice. */
  private readonly _slices = signal<ReadonlyMap<string, AppsWorkspaceSlice>>(
    new Map(),
  );

  /** Last `removedWorkspace$` seq handled, so each removal runs once. */
  private lastRemovedWorkspaceSeq = 0;
  private previousWorkspaceKey: string = APPS_IMPLICIT_WORKSPACE;

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
  public readonly notice = computed(() => this.activeSlice().notice);
  public readonly lastFocusKey = computed(
    () => this.activeSlice().lastFocusKey,
  );

  /**
   * The routing ids of every slice's conversation, active or not. A routing
   * id leaves the set when its conversation is discarded, fails to start or
   * its workspace is removed. Equal membership keeps the same set instance.
   */
  public readonly ownedRoutingIds = computed<ReadonlySet<string>>(
    () => {
      const owned = new Set<string>();
      for (const slice of this._slices().values()) {
        if (slice.conversation !== null)
          owned.add(slice.conversation.routingId);
      }
      return owned;
    },
    {
      equal: (a, b) => a.size === b.size && [...a].every((id) => b.has(id)),
    },
  );

  /** Head session of the active conversation, or null before one resolves. */
  public readonly sessionId = computed<ClaudeSessionId | null>(() => {
    const surfaceId = this.surfaceId();
    return surfaceId === null ? null : this.claims.sessionFor(surfaceId);
  });

  /**
   * True while a sent turn is unreported (`pendingTurn`, before AND after the
   * session id resolves, so no second turn can be sent before liveness
   * reports the first) or while the session is live.
   */
  public readonly isProcessing = computed(() => {
    const slice = this.activeSlice();
    if (slice.conversation === null) return false;
    if (slice.pendingTurn !== null) return true;
    const sessionId = this.sessionId();
    if (sessionId === null) return false;
    return isLiveAppsStatus(this.liveness.statuses().get(sessionId));
  });

  public constructor() {
    effect(() => {
      const key = this.workspaceKey();
      const previous = this.previousWorkspaceKey;
      this.previousWorkspaceKey = key;
      if (
        previous === APPS_IMPLICIT_WORKSPACE &&
        key !== APPS_IMPLICIT_WORKSPACE
      ) {
        untracked(() => this.dropSlice(APPS_IMPLICIT_WORKSPACE));
      }
    });
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
    // A pending turn ends once liveness reports its session changed from the
    // status it had at the send (see `AppsPendingTurn`); the started session
    // id gives way to the binding once it arrives (`settleAppsSlice`).
    effect(() => {
      const statuses = this.liveness.statuses();
      for (const [key, slice] of this._slices()) {
        const { conversation } = slice;
        if (conversation === null) continue;
        const bound = this.claims.sessionFor(conversation.surfaceId);
        if (settleAppsSlice(slice, bound, statuses) === slice) continue;
        untracked(() =>
          this.patchOwned(key, conversation.routingId, (current) =>
            settleAppsSlice(current, bound, statuses),
          ),
        );
      }
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
      } else {
        const started =
          result.data?.sessionId ?? (conversation.routingId as SessionId);
        const owner = conversation.routingId;
        if (!isAppsSliceOf(readAppsSlice(this._slices(), key), owner)) {
          await abortUnownedAppsStart(this.rpc, started);
        } else if (this.claims.sessionFor(conversation.surfaceId) === null) {
          // Until the binding arrives, Stop and "New conversation" abort this.
          this.patchOwned(key, owner, (slice) => ({
            ...slice,
            startedSessionId: started,
          }));
        }
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
    const sessionId = this.claims.sessionFor(conversation.surfaceId);
    if (sessionId === null) {
      console.warn(`${LOG_PREFIX} send before the session resolved`);
      this.patchOwned(key, conversation.routingId, (current) => ({
        ...current,
        error: 'The Apps session is still starting. Try again in a moment.',
      }));
      return;
    }

    const livenessAtSend = this.liveness.statuses().get(sessionId);
    this.patchOwned(key, conversation.routingId, (current) => ({
      ...current,
      pendingTurn: { livenessAtSend },
      error: null,
      notice: null,
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
   * conversation, its surfaces and every claim. Before the session binding
   * arrives it stops the session `chat:start` returned. Marks the session
   * idle only when the abort succeeded (`harness-workflow.service.ts:405-443`).
   */
  public async abort(): Promise<void> {
    const key = this.workspaceKey();
    const slice = readAppsSlice(this._slices(), key);
    const conversation = slice.conversation;
    if (conversation === null) return;
    const sessionId =
      this.claims.sessionFor(conversation.surfaceId) ?? slice.startedSessionId;
    if (sessionId === null) return;
    const failure = await abortAppsSession(this.rpc, sessionId);
    if (failure !== null) {
      this.failTurn(key, conversation.routingId, 'chat:abort', failure);
      return;
    }
    this.patchOwned(key, conversation.routingId, (current) => ({
      ...current,
      pendingTurn: null,
      startedSessionId: null,
    }));
    this.liveness.markIdle(sessionId, conversation.workspacePath ?? undefined);
  }

  /**
   * "New conversation" (Req 2.5): stop the running agent of the shown
   * conversation, then discard it. The workspace and the conversation are
   * captured BEFORE the abort is awaited and are the only ones ever touched:
   * a workspace switch, or a conversation replaced meanwhile, is left alone.
   * A failed abort discards nothing; the conversation stays with a `notice`.
   * Resolves true when the conversation was discarded. Never throws.
   */
  public async resetConversation(): Promise<boolean> {
    const key = this.workspaceKey();
    const slice = readAppsSlice(this._slices(), key);
    const conversation = slice.conversation;
    const sessionId = this.runningSessionOf(slice);
    if (conversation !== null && sessionId !== null) {
      const failure = await abortAppsSession(this.rpc, sessionId);
      if (failure !== null) {
        console.warn(`${LOG_PREFIX} chat:abort failed; conversation kept`);
        this.patchOwned(key, conversation.routingId, (current) => ({
          ...current,
          notice: `${APPS_RESET_KEPT_NOTICE} Reason: ${failure}`,
        }));
        return false;
      }
      this.liveness.markIdle(
        sessionId,
        conversation.workspacePath ?? undefined,
      );
      const current = readAppsSlice(this._slices(), key);
      if (!isAppsSliceOf(current, conversation.routingId)) return false;
    }
    this.discardSlice(key);
    return true;
  }

  /**
   * Tear down the active workspace's conversation and forget its state
   * (Req 2.5). Does not abort a running agent; "New conversation" goes
   * through `resetConversation()`, which does.
   */
  public discard(): void {
    this.discardSlice(this.workspaceKey());
  }

  /** Remember focus only in the workspace currently shown by the page. */
  public recordFocusKey(key: string | null): void {
    try {
      const workspaceKey = this.workspaceKey();
      if (!this._slices().has(workspaceKey)) return;
      this.patch(workspaceKey, (slice) => recordAppsFocusKey(slice, key));
    } catch (error: unknown) {
      console.warn(
        `${LOG_PREFIX} focus key could not be recorded: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
    }
  }

  /** Dismiss the active slice's error. */
  public clearError(): void {
    this.patch(this.workspaceKey(), (slice) =>
      slice.error === null ? slice : { ...slice, error: null },
    );
  }

  /** Dismiss the active slice's notice. */
  public clearNotice(): void {
    this.patch(this.workspaceKey(), (slice) =>
      slice.notice === null ? slice : { ...slice, notice: null },
    );
  }

  /**
   * Store the renderer's emitted view state of `surfaceId` in the shown
   * conversation, verbatim and synchronously: the renderer receives this
   * exact object next, so a draft is never rolled back by an older state
   * (the page holds no copy of its own; Req 2.4).
   */
  public setSurfaceViewState(
    surfaceId: string,
    viewState: SurfaceViewState,
  ): void {
    this.patchActiveSurfaces(
      (surfaces) => setSurfaceViewState(surfaces, surfaceId, viewState),
      'view state',
    );
  }

  /** The user picked `surfaceId` in the surface switcher of the shown slice. */
  public activateSurface(surfaceId: string): void {
    this.patchActiveSurfaces(
      (surfaces) => activateSurface(surfaces, surfaceId),
      'active surface',
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
      this.claims.claim(conversation, sync, {
        read: () => readAppsSlice(this._slices(), key).streamingState,
        write: (next) =>
          this.patchOwned(key, conversation.routingId, (slice) => ({
            ...slice,
            streamingState: next,
          })),
      });
    } catch (error: unknown) {
      // `claim` already undid its partial claim.
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

  /**
   * The session "New conversation" must stop first, or null when nothing
   * runs: the bound head session while a turn is pending or its status is
   * live; before the binding, always the one `chat:start` returned (it is
   * cleared once its turn is known to have ended, and the host's
   * `chat:abort` succeeds for an idle or unknown session).
   */
  private runningSessionOf(slice: AppsWorkspaceSlice): SessionId | null {
    if (slice.conversation === null) return null;
    const bound = this.claims.sessionFor(slice.conversation.surfaceId);
    if (bound === null) return slice.startedSessionId;
    const live = isLiveAppsStatus(this.liveness.statuses().get(bound));
    return slice.pendingTurn !== null || live ? bound : null;
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
      pendingTurn: null,
      error: message,
    }));
  }

  /** Release the conversation (if any) held by `slice`. Never throws. */
  private teardown(slice: AppsWorkspaceSlice): void {
    if (slice.conversation !== null) {
      this.claims.release(slice.conversation, slice.sync);
    } else {
      slice.sync?.dispose();
    }
  }

  /** Release `key`'s conversation and reset its slice to empty. */
  private discardSlice(key: string): void {
    try {
      if (!this._slices().has(key)) return;
      this.teardown(readAppsSlice(this._slices(), key));
      this.patch(key, () => createAppsWorkspaceSlice());
    } catch (error: unknown) {
      console.warn(
        `${LOG_PREFIX} discard failed: ${failureText(error, 'unknown error')}`,
      );
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

  /** Patch the surfaces of the shown conversation, if any. Never throws. */
  private patchActiveSurfaces(
    update: (surfaces: AppsSurfaceState) => AppsSurfaceState,
    what: string,
  ): void {
    try {
      const key = this.workspaceKey();
      const routingId = readAppsSlice(this._slices(), key).conversation
        ?.routingId;
      if (routingId === undefined) return;
      this.patchOwned(key, routingId, (slice) => {
        const surfaces = update(slice.surfaces);
        return surfaces === slice.surfaces ? slice : { ...slice, surfaces };
      });
    } catch (error: unknown) {
      console.warn(
        `${LOG_PREFIX} ${what} not stored: ${failureText(error, 'unknown error')}`,
      );
    }
  }

  private syncFor(routingId: string): AppsSurfaceSync | null {
    const key = findAppsSliceKey(this._slices(), routingId);
    return key === null ? null : readAppsSlice(this._slices(), key).sync;
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
