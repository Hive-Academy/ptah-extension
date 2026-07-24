import { Injectable, computed, inject, signal } from '@angular/core';
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
  TabId,
  TabSessionBinding,
  type ClaudeSessionId,
} from '@ptah-extension/chat-state';
import {
  StreamRouter,
  WorkflowSessionClaimService,
} from '@ptah-extension/chat-routing';
import { HarnessBuilderStateService } from './harness-builder-state.service';

export type HarnessWorkflowMode = 'new-project' | 'configure-harness';

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

  private readonly _correlationId = signal<TabId | null>(null);
  private readonly _surfaceId = signal<SurfaceId | null>(null);
  private readonly _mode = signal<HarnessWorkflowMode | null>(null);
  private readonly _started = signal(false);

  readonly mode = this._mode.asReadonly();
  readonly isActive = computed(() => this._correlationId() !== null);

  readonly isProcessing = computed(() => {
    const surfaceId = this._surfaceId();
    if (!surfaceId) return false;
    const sessionId = this.resolveSessionId();
    if (!sessionId) return this._started();
    const status = this.liveness.statuses().get(sessionId);
    return status === 'streaming' || status === 'awaiting-background';
  });

  async startWorkflow(
    mode: HarnessWorkflowMode,
    firstPrompt: string,
  ): Promise<void> {
    if (this.isActive()) return;

    const correlationId = TabId.create();
    const surfaceId = SurfaceId.create();
    this._correlationId.set(correlationId);
    this._surfaceId.set(surfaceId);
    this._mode.set(mode);
    this._started.set(true);
    // Pin the build: from here until dispose(), the state store must NOT reset
    // on an active-workspace switch, so `harness:apply` keeps targeting the
    // workspace this build started in.
    this.state.setBuildInProgress(true);

    this.claims.claim(correlationId as string, surfaceId);
    this.state.registerWorkflowSurface(surfaceId);
    this.streamRouter.onSurfaceCreated(surfaceId);

    const workspacePath = this.vscode.config().workspaceRoot;
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
        console.error(
          '[HarnessWorkflowService] chat:start failed:',
          result.data?.error ?? result.error,
        );
      }
    } catch (error: unknown) {
      console.error(
        '[HarnessWorkflowService] chat:start threw:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async sendMessage(text: string): Promise<void> {
    const correlationId = this._correlationId();
    if (!correlationId) return;
    const sessionId = this.resolveSessionId();
    if (!sessionId) {
      console.warn(
        '[HarnessWorkflowService] sendMessage with no resolved sessionId — dropping',
      );
      return;
    }

    this._started.set(true);
    try {
      const result = await this.rpc.call('chat:continue', {
        sessionId,
        tabId: correlationId as string,
        prompt: text,
        surfaceMode: true,
      });
      if (!result.success || result.data?.success === false) {
        console.error(
          '[HarnessWorkflowService] chat:continue failed:',
          result.data?.error ?? result.error,
        );
      }
    } catch (error: unknown) {
      console.error(
        '[HarnessWorkflowService] chat:continue threw:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async abort(): Promise<void> {
    const sessionId = this.resolveSessionId();
    if (!sessionId) return;
    try {
      await this.rpc.call('chat:abort', { sessionId });
    } catch (error: unknown) {
      console.warn(
        '[HarnessWorkflowService] chat:abort failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  dispose(): void {
    const correlationId = this._correlationId();
    const surfaceId = this._surfaceId();
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
    this.state.setBuildInProgress(false);
  }

  private resolveSessionId(): ClaudeSessionId | null {
    const surfaceId = this._surfaceId();
    if (!surfaceId) return null;
    const convId = this.tabSessionBinding.conversationForSurface(surfaceId);
    if (!convId) return null;
    const record = this.conversationRegistry.getRecord(convId);
    if (!record || record.sessions.length === 0) return null;
    return record.sessions[record.sessions.length - 1];
  }
}
