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
  VSCodeService,
  ModelStateService,
  EffortStateService,
} from '@ptah-extension/core';
import {
  ConversationRegistry,
  SessionLivenessRegistry,
  SurfaceId,
  SurfaceSessionStatsRegistry,
  TabId,
  TabSessionBinding,
  type ClaudeSessionId,
  type SurfaceSessionStats,
} from '@ptah-extension/chat-state';
import {
  StreamRouter,
  WorkflowSessionClaimService,
} from '@ptah-extension/chat-routing';
import { PermissionHandlerService } from '@ptah-extension/chat-streaming';
import type { FlatStreamEventUnion } from '@ptah-extension/shared';
import { HarnessBuilderStateService } from './harness-builder-state.service';

export type HarnessWorkflowMode = 'new-project' | 'configure-harness';

/** One turn the user contributed, rendered right-aligned in the transcript. */
export interface HarnessUserBubble {
  text: string;
}

/**
 * `localStorage` key for the in-flight workflow. Versioned in the key itself
 * (same convention as `ptah.tasks.viewMode` / `ptah.tabs.ws.*`), so a shape
 * change becomes a new key rather than a parse guard, and the stale record is
 * simply never read again.
 */
export const HARNESS_WORKFLOW_STORAGE_KEY = 'ptah.harness.workflow.v1';

interface PersistedWorkflow {
  readonly mode: HarnessWorkflowMode;
  /** Resolved agent session; null until the backend reports one. */
  readonly sessionId: string | null;
  readonly workspaceRoot: string;
  readonly bubbles: readonly HarnessUserBubble[];
}

function isPersistedWorkflow(value: unknown): value is PersistedWorkflow {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (
    record['mode'] !== 'new-project' &&
    record['mode'] !== 'configure-harness'
  )
    return false;
  if (typeof record['workspaceRoot'] !== 'string') return false;
  if (record['sessionId'] !== null && typeof record['sessionId'] !== 'string')
    return false;
  const bubbles = record['bubbles'];
  if (!Array.isArray(bubbles)) return false;
  return bubbles.every(
    (bubble) =>
      typeof bubble === 'object' &&
      bubble !== null &&
      typeof (bubble as Record<string, unknown>)['text'] === 'string',
  );
}

/**
 * Owns the whole New Project / Configure Harness workflow: identity
 * (correlation + surface), the user-visible transcript, and the RPC calls that
 * drive it.
 *
 * Root-provided on purpose. The harness view is destroyed and re-created every
 * time the user navigates away and back; if the transcript or the surface
 * claim lived on the component, that round trip would drop a live agent run.
 * The view therefore never disposes this service — only an explicit
 * "Start over" does.
 *
 * A reload is survived through `localStorage`: the record holds the mode, the
 * resolved session, the workspace it belongs to, and the user's bubbles. On
 * rehydrate the service mints a FRESH correlation + surface (the old ids died
 * with the page), rebinds them to the persisted session, and replays the
 * session's history into the surface via `chat:resume` — which is history-load
 * only unless `activate` is set, so replaying cannot restart the agent.
 */
@Injectable({ providedIn: 'root' })
export class HarnessWorkflowService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly vscode = inject(VSCodeService);
  private readonly modelState = inject(ModelStateService);
  private readonly effortState = inject(EffortStateService);
  private readonly claims = inject(WorkflowSessionClaimService);
  private readonly streamRouter = inject(StreamRouter);
  private readonly state = inject(HarnessBuilderStateService);
  private readonly conversationRegistry = inject(ConversationRegistry);
  private readonly tabSessionBinding = inject(TabSessionBinding);
  private readonly liveness = inject(SessionLivenessRegistry);
  private readonly surfaceStats = inject(SurfaceSessionStatsRegistry);
  private readonly permissionHandler = inject(PermissionHandlerService);

  private readonly _correlationId = signal<TabId | null>(null);
  private readonly _surfaceId = signal<SurfaceId | null>(null);
  private readonly _mode = signal<HarnessWorkflowMode | null>(null);
  private readonly _started = signal(false);
  private readonly _userBubbles = signal<readonly HarnessUserBubble[]>([]);
  private readonly _viewMode = signal<HarnessWorkflowMode>('configure-harness');
  private readonly _resumedFromReload = signal(false);
  private readonly _error = signal<string | null>(null);

  /**
   * Workspace root PINNED at the moment the workflow started (or was
   * rehydrated), not the live one.
   *
   * The persisted record is keyed on the workspace it belongs to, and
   * `rehydrate` refuses a record whose root doesn't match. Writing the LIVE
   * root here meant that switching the active workspace mid-run silently
   * re-keyed the record to a workspace the run never belonged to — after which
   * a reload resumed a New Project session into the wrong workspace, and the
   * original workspace lost its record entirely.
   */
  private readonly _workspaceRoot = signal<string | null>(null);

  /** Guards the one-shot rehydrate so a workspace-root change can't re-run it. */
  private rehydrateStarted = false;

  readonly mode = this._mode.asReadonly();
  /**
   * Mode the view should render as, whether or not a workflow has started.
   * Survives navigation because it lives here rather than on the component.
   */
  readonly viewMode = this._viewMode.asReadonly();
  readonly userBubbles = this._userBubbles.asReadonly();
  /** True when this transcript came back from `localStorage` after a reload. */
  readonly resumedFromReload = this._resumedFromReload.asReadonly();
  readonly isActive = computed(() => this._correlationId() !== null);
  /**
   * Last user-visible failure, or null. Rendered as a dismissible alert by the
   * builder view — an RPC that fails silently is indistinguishable from an
   * agent that is merely slow, which is how a dead workflow used to look.
   */
  readonly error = this._error.asReadonly();
  /** Workspace this workflow is pinned to, or null when none is running. */
  readonly workspaceRoot = this._workspaceRoot.asReadonly();

  /** Head session of the bound conversation, or null before one resolves. */
  readonly sessionId = computed<ClaudeSessionId | null>(() => {
    const surfaceId = this._surfaceId();
    if (!surfaceId) return null;
    const convId = this.tabSessionBinding.conversationForSurface(surfaceId);
    if (!convId) return null;
    const record = this.conversationRegistry.getRecord(convId);
    if (!record || record.sessions.length === 0) return null;
    return record.sessions[record.sessions.length - 1];
  });

  /**
   * Cost / token / context-fill totals for this workflow's session, or null
   * before the first turn completes.
   *
   * Session-keyed rather than surface-keyed on purpose: a reload mints a fresh
   * `SurfaceId` but rebinds the SAME session, so a surface-keyed record would
   * reset the totals every time the user reloaded mid-run.
   */
  readonly sessionStats = computed<SurfaceSessionStats | null>(() => {
    const sessionId = this.sessionId();
    if (!sessionId) return null;
    return this.surfaceStats.stats(sessionId as string)();
  });

  readonly isProcessing = computed(() => {
    const surfaceId = this._surfaceId();
    if (!surfaceId) return false;
    const sessionId = this.sessionId();
    if (!sessionId) return this._started();
    const status = this.liveness.statuses().get(sessionId);
    return status === 'streaming' || status === 'awaiting-background';
  });

  constructor() {
    // Mirror the live workflow into storage. Only writes while a workflow is
    // active, so an idle boot (or the window between construction and
    // rehydration) can never overwrite a good record with an empty one.
    effect(() => {
      if (!this.isActive()) return;
      // The PINNED root, never `vscode.config().workspaceRoot` — see the field
      // doc on `_workspaceRoot`.
      const workspaceRoot = this._workspaceRoot();
      if (!workspaceRoot) return;
      const snapshot: PersistedWorkflow = {
        mode: this._viewMode(),
        sessionId: this.sessionId(),
        workspaceRoot,
        bubbles: this._userBubbles(),
      };
      untracked(() => this.writeStorage(snapshot));
    });

    // Rehydrate once, as soon as the workspace root is known — the record is
    // workspace-scoped, so comparing against an empty root would discard it.
    effect(() => {
      const workspaceRoot = this.vscode.config().workspaceRoot;
      if (!workspaceRoot || this.rehydrateStarted) return;
      this.rehydrateStarted = true;
      untracked(() => {
        void this.rehydrate(workspaceRoot);
      });
    });
  }

  /** Set the mode the view renders in before any workflow has started. */
  setViewMode(mode: HarnessWorkflowMode): void {
    this._viewMode.set(mode);
  }

  /**
   * Surface a failure the user needs to know about. Public so the message
   * handler can report a dropped open-workflow request — dropping one silently
   * is what made a cross-mode start look like a dead button.
   */
  setError(message: string): void {
    this._error.set(message);
  }

  /** Dismiss the current error alert. */
  clearError(): void {
    this._error.set(null);
  }

  /** Append a user turn to the transcript. */
  addUserBubble(text: string): void {
    this._userBubbles.update((bubbles) => [...bubbles, { text }]);
  }

  /** Replace the transcript, e.g. with the intake summary as the first turn. */
  setUserBubbles(bubbles: readonly HarnessUserBubble[]): void {
    this._userBubbles.set([...bubbles]);
  }

  async startWorkflow(
    mode: HarnessWorkflowMode,
    firstPrompt: string,
  ): Promise<void> {
    if (this.isActive()) return;

    const correlationId = TabId.create();
    const surfaceId = SurfaceId.create();
    const workspacePath = this.vscode.config().workspaceRoot;

    this._correlationId.set(correlationId);
    this._surfaceId.set(surfaceId);
    this._mode.set(mode);
    this._viewMode.set(mode);
    this._started.set(true);
    this._resumedFromReload.set(false);
    this._error.set(null);
    this._workspaceRoot.set(workspacePath || null);
    // Pin the build: from here until dispose(), the state store must NOT reset
    // on an active-workspace switch, so `harness:apply` keeps targeting the
    // workspace this build started in.
    this.state.setBuildInProgress(true);

    this.claims.claim(correlationId as string, surfaceId);
    this.state.registerWorkflowSurface(surfaceId);
    this.streamRouter.onSurfaceCreated(surfaceId);

    const effectiveModel = this.modelState.currentModel();
    const effectiveEffort = this.effortState.currentEffort();
    const name =
      mode === 'new-project' ? 'New Project Setup' : 'Harness Configuration';

    try {
      const result = await this.rpc.call('chat:start', {
        prompt: firstPrompt,
        tabId: correlationId as string,
        name,
        ...(workspacePath ? { workspacePath } : {}),
        surfaceMode: true,
        options: {
          ...(effectiveModel ? { model: effectiveModel } : {}),
          ...(effectiveEffort ? { effort: effectiveEffort } : {}),
        },
      });
      if (!result.success || result.data?.success === false) {
        this.rollBackFailedStart(
          correlationId,
          surfaceId,
          result.data?.error ?? result.error ?? 'Failed to start the workflow.',
        );
      }
    } catch (error: unknown) {
      this.rollBackFailedStart(
        correlationId,
        surfaceId,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Undo everything `startWorkflow` did before the RPC failed.
   *
   * A half-started workflow is worse than none: the claim and the surface stay
   * held, `isActive()` reports true, and the Setup Hub card offers "Resume" for
   * a session that was never created — with no way back to "Start". So release
   * the claim, close the surface, drop the identity, unpin the build and delete
   * the persisted record, then report the failure.
   */
  private rollBackFailedStart(
    correlationId: TabId,
    surfaceId: SurfaceId,
    message: string,
  ): void {
    console.error('[HarnessWorkflowService] chat:start failed:', message);
    this.claims.release(correlationId as string);
    this.streamRouter.onSurfaceClosed(surfaceId);
    this._correlationId.set(null);
    this._surfaceId.set(null);
    this._mode.set(null);
    this._started.set(false);
    this._workspaceRoot.set(null);
    this.state.setBuildInProgress(false);
    this.clearStorage();
    this._error.set(message);
  }

  async sendMessage(text: string): Promise<void> {
    const correlationId = this._correlationId();
    if (!correlationId) return;
    const sessionId = this.sessionId();
    if (!sessionId) {
      console.warn(
        '[HarnessWorkflowService] sendMessage with no resolved sessionId — dropping',
      );
      return;
    }

    this._started.set(true);
    this._error.set(null);
    try {
      const result = await this.rpc.call('chat:continue', {
        sessionId,
        tabId: correlationId as string,
        prompt: text,
        surfaceMode: true,
      });
      if (!result.success || result.data?.success === false) {
        this.failTurn(
          'chat:continue',
          result.data?.error ?? result.error ?? 'Failed to send the message.',
        );
      }
    } catch (error: unknown) {
      this.failTurn(
        'chat:continue',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * An RPC that never reached the agent. The workflow itself survives (the
   * session and transcript are still good), but `_started` must come back down
   * or `isProcessing()` would report a spinner forever on a session that has
   * no liveness entry yet.
   */
  private failTurn(method: string, message: string): void {
    console.error(`[HarnessWorkflowService] ${method} failed:`, message);
    this._started.set(false);
    this._error.set(message);
  }

  /**
   * Stop the running agent, keeping the transcript, the surface and the claim.
   * This is the "Stop" button; "Start over" calls it and then {@link dispose}.
   *
   * Marking the session idle locally is not belt-and-braces — it is the ONLY
   * thing that ends the spinner. `isProcessing()` reads
   * `SessionLivenessRegistry` once a session id has resolved, and the registry
   * is driven by `session:turnEnded`, which the SDK raises from its Stop hook.
   * An interrupt tears the query down before that hook runs, so a successful
   * abort emitted no turn-end at all: the backend stopped, the button stayed
   * "Stop", and the composer stayed disabled forever. The chat path has always
   * done the same thing by hand (`ConversationService.abortCurrentMessage`
   * calls `tabManager.markTabIdle`) — this is the surface's equivalent.
   *
   * Only marked idle when the abort actually succeeded. A failed abort means
   * the agent is very likely still running, and claiming otherwise would hand
   * the user a composer that silently interleaves with a live turn.
   */
  async abort(): Promise<void> {
    const sessionId = this.sessionId();
    if (!sessionId) return;
    try {
      const result = await this.rpc.call('chat:abort', { sessionId });
      if (!result.success || result.data?.success === false) {
        this.failTurn(
          'chat:abort',
          result.data?.error ?? result.error ?? 'Failed to stop the workflow.',
        );
        return;
      }
      this._started.set(false);
      this.liveness.markIdle(sessionId, this._workspaceRoot() ?? undefined);
    } catch (error: unknown) {
      this.failTurn(
        'chat:abort',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Tear the workflow down and forget it. Called only by an explicit user
   * action ("Start over" / "Close") — never from a component's `ngOnDestroy`,
   * which is what navigating away triggers.
   *
   * Does NOT abort the backend session on its own: callers that mean to stop a
   * running agent call {@link abort} first. Disposing alone would orphan the
   * run — the surface it streams to is gone, but the agent keeps burning tokens
   * with nothing listening.
   */
  dispose(): void {
    const correlationId = this._correlationId();
    const surfaceId = this._surfaceId();
    // Read the session BEFORE the surface unbinds — `sessionId()` resolves
    // through that binding, so after `onSurfaceClosed` there is nothing left to
    // key the stats record by and it would leak for the app's lifetime.
    const sessionId = this.sessionId();
    if (sessionId) {
      this.surfaceStats.clear(sessionId as string);
    }
    if (correlationId) {
      this.claims.release(correlationId as string);
    }
    if (surfaceId) {
      this.streamRouter.onSurfaceClosed(surfaceId);
    }
    this._correlationId.set(null);
    this._surfaceId.set(null);
    this._mode.set(null);
    this._started.set(false);
    this._userBubbles.set([]);
    this._resumedFromReload.set(false);
    this._workspaceRoot.set(null);
    this._error.set(null);
    this.state.setBuildInProgress(false);
    this.clearStorage();
  }

  /**
   * Stop the agent if one is running, then tear the workflow down. The single
   * entry point for "this workflow must go away" — "Start over" and a
   * cross-mode replacement both use it.
   */
  async abortAndDispose(): Promise<void> {
    if (this.isProcessing()) {
      await this.abort();
    }
    this.dispose();
  }

  // ==========================================================================
  // PERSISTENCE
  // ==========================================================================

  private writeStorage(snapshot: PersistedWorkflow): void {
    try {
      globalThis.localStorage?.setItem(
        HARNESS_WORKFLOW_STORAGE_KEY,
        JSON.stringify(snapshot),
      );
    } catch (error: unknown) {
      console.warn(
        '[HarnessWorkflowService] Failed to persist workflow:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private clearStorage(): void {
    try {
      globalThis.localStorage?.removeItem(HARNESS_WORKFLOW_STORAGE_KEY);
    } catch (error: unknown) {
      console.warn(
        '[HarnessWorkflowService] Failed to clear persisted workflow:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private readStorage(): PersistedWorkflow | null {
    try {
      const raw = globalThis.localStorage?.getItem(
        HARNESS_WORKFLOW_STORAGE_KEY,
      );
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      return isPersistedWorkflow(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  /**
   * Restore a workflow persisted by a previous page load.
   *
   * The old correlation and surface ids died with the page, so fresh ones are
   * minted and bound to the PERSISTED session — that binding is what makes
   * `sendMessage` (`chat:continue`) target the right conversation. Assistant
   * output is replayed from the session's own history rather than persisted.
   */
  private async rehydrate(workspaceRoot: string): Promise<void> {
    if (this.isActive()) return;
    const record = this.readStorage();
    if (!record) return;
    if (record.workspaceRoot !== workspaceRoot) {
      // The record belongs to a different workspace — it can never be resumed
      // here, and keeping it would resurrect it on the next switch back.
      this.clearStorage();
      return;
    }

    const correlationId = TabId.create();
    const surfaceId = SurfaceId.create();
    const sessionId = record.sessionId as ClaudeSessionId | null;

    this._correlationId.set(correlationId);
    this._surfaceId.set(surfaceId);
    this._mode.set(record.mode);
    this._viewMode.set(record.mode);
    this._userBubbles.set([...record.bubbles]);
    this._started.set(false);
    this._resumedFromReload.set(true);
    this._error.set(null);
    // Pin the root this record belongs to, which `rehydrate` has just proved
    // is the active one. Re-reading the live root later would let a workspace
    // switch re-key the record out from under the run.
    this._workspaceRoot.set(workspaceRoot);
    this.state.setBuildInProgress(true);

    this.claims.claim(correlationId as string, surfaceId);
    this.state.registerWorkflowSurface(surfaceId);
    this.streamRouter.onSurfaceCreated(surfaceId, sessionId ?? undefined);

    if (sessionId) {
      await this.replaySessionHistory(sessionId, correlationId, workspaceRoot);
      await this.restorePendingQuestions(sessionId);
    }
  }

  /**
   * Re-show any AskUserQuestion the agent is still blocked on.
   *
   * The question lives on the backend as an unresolved promise; the card that
   * would answer it died with the page. Without this, a reload left the agent
   * waiting on a question nobody could see until the 5-minute idle timeout
   * auto-picked option #1 — which is exactly the "it answers itself" behaviour
   * this flow kept exhibiting.
   *
   * Runs AFTER the surface is bound to the session, because
   * `routeQuestionPrompt` resolves the question's render targets from that
   * binding — before it, every question would resolve to zero targets and stay
   * invisible.
   */
  private async restorePendingQuestions(
    sessionId: ClaudeSessionId,
  ): Promise<void> {
    try {
      const result = await this.rpc.call('chat:pending-questions', {
        sessionId,
      });
      if (!result.isSuccess() || result.data.success === false) {
        console.warn(
          '[HarnessWorkflowService] chat:pending-questions failed:',
          result.data?.error ?? result.error,
        );
        return;
      }
      for (const question of result.data.questions) {
        // The same pair `ChatMessageHandler.handleAskUserQuestion` dispatches:
        // register the request, then route it to its render targets.
        this.permissionHandler.handleQuestionRequest(question);
        this.streamRouter.routeQuestionPrompt(question);
      }
    } catch (error: unknown) {
      console.warn(
        '[HarnessWorkflowService] chat:pending-questions threw:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Replay a session's recorded events onto the workflow surface.
   *
   * `chat:resume` without `activate` is a pure history read — it returns the
   * flat events and starts nothing — so feeding them through the canonical
   * router rebuilds the execution tree exactly as it looked before the reload.
   */
  private async replaySessionHistory(
    sessionId: ClaudeSessionId,
    correlationId: TabId,
    workspacePath: string,
  ): Promise<void> {
    try {
      const result = await this.rpc.call('chat:resume', {
        sessionId,
        tabId: correlationId as string,
        workspacePath,
      });
      if (!result.isSuccess() || result.data.success === false) {
        console.warn(
          '[HarnessWorkflowService] chat:resume replay failed:',
          result.data?.error ?? result.error,
        );
        return;
      }
      const events: readonly FlatStreamEventUnion[] = result.data.events ?? [];
      const surfaceId = this._surfaceId();
      if (!surfaceId) return;
      for (const event of events) {
        this.streamRouter.routeStreamEventForSurface(event, surfaceId);
      }
    } catch (error: unknown) {
      console.warn(
        '[HarnessWorkflowService] chat:resume replay threw:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
