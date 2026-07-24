import {
  Component,
  ChangeDetectionStrategy,
  inject,
  OnInit,
  OnDestroy,
  signal,
  computed,
  viewChild,
  ElementRef,
  effect,
} from '@angular/core';
import {
  LucideAngularModule,
  X,
  Send,
  Settings,
  Loader2,
  CheckCircle,
  Sparkles,
  PanelRightClose,
} from 'lucide-angular';
import { FormsModule } from '@angular/forms';
import {
  ExecutionNodeComponent,
  PermissionRequestCardComponent,
  QuestionCardComponent,
} from '@ptah-extension/chat';
import { ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';
import { PermissionHandlerService } from '@ptah-extension/chat-streaming';
import {
  WebviewNavigationService,
  AppStateManager,
} from '@ptah-extension/core';
import type {
  PermissionResponse,
  AskUserQuestionResponse,
} from '@ptah-extension/shared';
import { HarnessBuilderStateService } from '../services/harness-builder-state.service';
import { HarnessRpcService } from '../services/harness-rpc.service';
import {
  HarnessWorkflowService,
  type HarnessWorkflowMode,
} from '../services/harness-workflow.service';
import { HarnessConfigPreviewComponent } from './harness-config-preview.component';

interface UserBubble {
  text: string;
}

@Component({
  selector: 'ptah-harness-builder-view',
  standalone: true,
  imports: [
    LucideAngularModule,
    FormsModule,
    ExecutionNodeComponent,
    PermissionRequestCardComponent,
    QuestionCardComponent,
    HarnessConfigPreviewComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        position: relative;
      }
    `,
  ],
  template: `
    @if (showInitializing()) {
      <div class="flex items-center justify-center h-full">
        <div class="text-center">
          <lucide-angular
            [img]="Loader2Icon"
            class="w-8 h-8 animate-spin text-primary mx-auto"
            aria-hidden="true"
          />
          <p class="mt-3 text-sm text-base-content/60">
            Initializing AI Team Builder...
          </p>
        </div>
      </div>
    } @else if (displayInitError()) {
      <div class="flex items-center justify-center h-full">
        <div class="alert alert-error max-w-md">
          <span>{{ displayInitError() }}</span>
          <button class="btn btn-sm" (click)="initializeBuilder()">
            Retry
          </button>
        </div>
      </div>
    } @else {
      <header
        class="flex items-center justify-between px-4 py-3 border-b border-base-300 bg-base-100 shrink-0"
      >
        <div class="flex items-center gap-2">
          <h1 class="text-base font-bold text-base-content">
            {{ headerTitle() }}
          </h1>
          @if (state.configSummary() !== 'No configuration yet') {
            <span class="text-xs text-base-content/40 hidden sm:inline">
              {{ state.configSummary() }}
            </span>
          }
          @if (state.workspaceSwitchedDuringBuild()) {
            <span
              class="badge badge-warning badge-sm gap-1"
              role="status"
              title="You switched workspaces mid-build. This configuration will still be applied to the workspace this build started in."
            >
              Targeting {{ pinnedWorkspaceName() }}
            </span>
          }
        </div>
        <div class="flex items-center gap-1">
          <button
            class="btn btn-ghost btn-sm"
            (click)="toggleSidePanel()"
            aria-label="Toggle side panel"
            [class.btn-active]="showSidePanel()"
          >
            <lucide-angular
              [img]="PanelRightCloseIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            <span class="hidden sm:inline text-xs">
              {{ showSidePanel() ? 'Hide panel' : 'Show panel' }}
            </span>
          </button>
          <button
            class="btn btn-ghost btn-sm btn-circle"
            (click)="requestClose()"
            aria-label="Close AI Team Builder"
          >
            <lucide-angular [img]="XIcon" class="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div class="flex flex-1 min-h-0 overflow-hidden">
        <div class="flex flex-col flex-1 min-w-0 border-r border-base-300">
          <div
            #scrollContainer
            class="flex-1 overflow-y-auto p-4 space-y-4"
            role="log"
            aria-label="Conversation transcript"
          >
            @if (
              userBubbles().length === 0 &&
              executionNodes().length === 0 &&
              !isProcessing()
            ) {
              <div
                class="flex flex-col items-center justify-center h-full text-center px-4"
              >
                <lucide-angular
                  [img]="SparklesIcon"
                  class="w-10 h-10 text-primary/40 mb-4"
                  aria-hidden="true"
                />
                <h2 class="text-lg font-semibold text-base-content mb-2">
                  Describe your AI team
                </h2>
                <p class="text-sm text-base-content/50 max-w-md">
                  Tell me what you're building and I'll plan it with you, then
                  configure the agents, skills, prompts, and MCP servers for
                  your workspace.
                </p>
              </div>
            }

            @for (bubble of userBubbles(); track $index) {
              <div class="flex justify-end">
                <div
                  class="max-w-[85%] px-4 py-3 rounded-2xl rounded-br-md bg-primary text-primary-content text-sm whitespace-pre-wrap"
                >
                  {{ bubble.text }}
                </div>
              </div>
            }

            @if (executionNodes().length > 0) {
              <div class="space-y-1">
                @for (node of executionNodes(); track node.id) {
                  <ptah-execution-node
                    [node]="node"
                    [isStreaming]="isProcessing()"
                  />
                }
              </div>
            }

            @if (isProcessing() && executionNodes().length === 0) {
              <div class="flex justify-start">
                <div class="px-4 py-3 rounded-2xl rounded-bl-md bg-base-200">
                  <span
                    class="loading loading-dots loading-sm text-base-content/50"
                  ></span>
                </div>
              </div>
            }

            @for (perm of surfacePermissions(); track perm.id) {
              <div class="px-1 py-1">
                <ptah-permission-request-card
                  [request]="perm"
                  (responded)="onPermissionResponse($event)"
                />
              </div>
            }

            @for (question of surfaceQuestions(); track question.id) {
              <div class="px-1 py-1">
                <ptah-question-card
                  [request]="question"
                  (answered)="onQuestionResponse($event)"
                />
              </div>
            }
          </div>

          <div class="px-4 py-3 border-t border-base-300 bg-base-100 shrink-0">
            @if (state.isConfigComplete() && !isProcessing()) {
              <div
                class="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-success/10 border border-success/20"
              >
                <lucide-angular
                  [img]="CheckCircleIcon"
                  class="w-4 h-4 text-success shrink-0"
                  aria-hidden="true"
                />
                <span class="text-sm text-success flex-1">
                  Configuration looks ready to apply.
                </span>
                <button
                  class="btn btn-success btn-sm"
                  (click)="applyConfig()"
                  [disabled]="isApplying()"
                >
                  @if (isApplying()) {
                    <span class="loading loading-spinner loading-xs"></span>
                  }
                  Apply to Workspace
                </button>
              </div>
            }

            <div class="flex items-end gap-2">
              <textarea
                #messageInput
                class="textarea textarea-bordered flex-1 min-h-[44px] max-h-40 resize-none text-sm leading-relaxed"
                placeholder="Describe what you want to build..."
                [(ngModel)]="messageText"
                (keydown)="onKeydown($event)"
                [disabled]="isProcessing()"
                rows="1"
              ></textarea>
              <button
                class="btn btn-primary btn-sm h-[44px] w-[44px] p-0"
                (click)="sendMessage()"
                [disabled]="!canSend()"
                aria-label="Send message"
              >
                @if (isProcessing()) {
                  <span class="loading loading-spinner loading-xs"></span>
                } @else {
                  <lucide-angular
                    [img]="SendIcon"
                    class="w-4 h-4"
                    aria-hidden="true"
                  />
                }
              </button>
            </div>
          </div>
        </div>

        @if (showSidePanel()) {
          <aside class="flex flex-col w-[420px] bg-base-100 shrink-0 min-h-0">
            <div
              class="flex items-center gap-2 px-3 py-2 border-b border-base-300 bg-base-200/40 shrink-0"
            >
              <lucide-angular
                [img]="SettingsIcon"
                class="w-3.5 h-3.5"
                aria-hidden="true"
              />
              <span class="text-xs font-medium">Config</span>
            </div>

            <div class="flex-1 min-h-0 overflow-y-auto p-3">
              <ptah-harness-config-preview />

              @if (hasAnyConfig()) {
                <div class="mt-4 pt-3 border-t border-base-300">
                  <button
                    class="btn btn-primary btn-sm w-full"
                    (click)="applyConfig()"
                    [disabled]="isApplying() || isProcessing()"
                  >
                    @if (isApplying()) {
                      <span class="loading loading-spinner loading-xs"></span>
                    }
                    Apply to Workspace
                  </button>
                </div>
              }
            </div>
          </aside>
        }
      </div>

      @if (showCloseConfirmation()) {
        <div
          class="absolute inset-0 z-50 flex items-center justify-center bg-base-300/60"
          role="dialog"
          aria-modal="true"
          aria-labelledby="harness-close-title"
        >
          <div
            class="bg-base-100 border border-base-300 rounded-lg shadow-xl p-5 max-w-sm w-[90%]"
          >
            <h2
              id="harness-close-title"
              class="text-base font-semibold text-base-content mb-2"
            >
              Discard unsaved changes?
            </h2>
            <p class="text-sm text-base-content/70 mb-4">
              You have an in-progress AI team configuration. Closing now will
              reset it.
            </p>
            <div class="flex justify-end gap-2">
              <button
                class="btn btn-ghost btn-sm"
                (click)="cancelClose()"
                type="button"
              >
                Keep editing
              </button>
              <button
                class="btn btn-error btn-sm"
                (click)="confirmClose()"
                type="button"
              >
                Discard and close
              </button>
            </div>
          </div>
        </div>
      }
    }
  `,
})
export class HarnessBuilderViewComponent implements OnInit, OnDestroy {
  protected readonly state = inject(HarnessBuilderStateService);
  private readonly rpc = inject(HarnessRpcService);
  private readonly workflow = inject(HarnessWorkflowService);
  private readonly navigation = inject(WebviewNavigationService);
  private readonly appState = inject(AppStateManager);
  private readonly treeBuilder = inject(ExecutionTreeBuilderService);
  private readonly permissionHandler = inject(PermissionHandlerService);

  protected readonly XIcon = X;
  protected readonly SendIcon = Send;
  protected readonly SettingsIcon = Settings;
  protected readonly Loader2Icon = Loader2;
  protected readonly CheckCircleIcon = CheckCircle;
  protected readonly SparklesIcon = Sparkles;
  protected readonly PanelRightCloseIcon = PanelRightClose;

  private readonly scrollContainer =
    viewChild<ElementRef<HTMLDivElement>>('scrollContainer');

  readonly isInitializing = signal(true);
  readonly initError = signal<string | null>(null);
  readonly isApplying = signal(false);
  readonly showSidePanel = signal(true);
  readonly showCloseConfirmation = signal(false);

  private readonly _viewMode = signal<HarnessWorkflowMode>('configure-harness');
  private readonly _userBubbles = signal<UserBubble[]>([]);
  readonly userBubbles = this._userBubbles.asReadonly();

  protected messageText = '';

  protected readonly isProcessing = computed(() =>
    this.workflow.isProcessing(),
  );

  /**
   * Show the initializing spinner for the component's own initial load AND
   * while the state service re-initializes after an idle workspace switch, so
   * the view is never left silently empty during a follow-the-workspace
   * re-init (review Issue 1).
   */
  protected readonly showInitializing = computed(
    () => this.isInitializing() || this.state.isLoading(),
  );

  /**
   * Surface either the component's own init error OR a service-level re-init
   * failure so the Retry button appears in both cases. Retry calls
   * `initializeBuilder()`, which clears both on success.
   */
  protected readonly displayInitError = computed(
    () => this.initError() ?? this.state.error(),
  );

  protected readonly headerTitle = computed(() =>
    this._viewMode() === 'new-project'
      ? 'New Project Setup'
      : 'AI Team Builder',
  );

  /** Name of the pinned (original) workspace, shown in the switch badge. */
  protected readonly pinnedWorkspaceName = computed(
    () => this.state.workspaceContext()?.projectName ?? 'original workspace',
  );

  protected readonly executionNodes = computed(() => {
    const streamState = this.state.streamingState();
    if (streamState.events.size === 0) return [];
    return this.treeBuilder.buildTree(streamState, 'harness-workflow');
  });

  protected readonly canSend = computed(
    () => this.messageText.trim().length > 0 && !this.isProcessing(),
  );

  protected readonly hasAnyConfig = computed(() => {
    const cfg = this.state.config();
    return !!(cfg.persona || cfg.agents || cfg.skills || cfg.prompt || cfg.mcp);
  });

  protected readonly surfacePermissions = computed(() =>
    this.permissionHandler
      .permissionRequests()
      .filter((p) => this.permissionHandler.hasSurfaceTargets(p.id)),
  );

  protected readonly surfaceQuestions = computed(() =>
    this.permissionHandler
      .questionRequests()
      .filter((q) => this.permissionHandler.hasSurfaceTargets(q.id)),
  );

  constructor() {
    effect(() => {
      this._userBubbles();
      this.state.streamingState();
      const container = this.scrollContainer()?.nativeElement;
      if (container) {
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight;
        });
      }
    });
  }

  protected toggleSidePanel(): void {
    this.showSidePanel.set(!this.showSidePanel());
  }

  public ngOnInit(): void {
    this.initializeBuilder();

    const request = this.appState.consumeHarnessWorkflowRequest();
    if (request) {
      this._viewMode.set(request.mode);
      if (request.mode === 'new-project' && request.seedPrompt) {
        this._userBubbles.set([{ text: request.seedPrompt }]);
        this.workflow
          .startWorkflow('new-project', request.seedPrompt)
          .catch((error: unknown) => {
            console.error(
              '[HarnessBuilderView] startWorkflow failed:',
              error instanceof Error ? error.message : String(error),
            );
          });
      }
    }
  }

  public ngOnDestroy(): void {
    this.workflow.dispose();
  }

  public async initializeBuilder(): Promise<void> {
    this.isInitializing.set(true);
    this.initError.set(null);

    try {
      const response = await this.rpc.initialize();
      this.state.initialize(response);
    } catch (err) {
      this.initError.set(
        err instanceof Error
          ? err.message
          : 'Failed to initialize AI Team Builder',
      );
    } finally {
      this.isInitializing.set(false);
    }
  }

  public requestClose(): void {
    if (this.hasAnyConfig()) {
      this.showCloseConfirmation.set(true);
      return;
    }
    this.performClose();
  }

  protected cancelClose(): void {
    this.showCloseConfirmation.set(false);
  }

  protected confirmClose(): void {
    this.showCloseConfirmation.set(false);
    this.performClose();
  }

  private performClose(): void {
    this.workflow.dispose();
    this.state.reset();
    this.navigation.navigateToView('chat');
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  protected async sendMessage(): Promise<void> {
    const text = this.messageText.trim();
    if (!text || this.isProcessing()) return;

    this.messageText = '';
    this._userBubbles.update((bubbles) => [...bubbles, { text }]);

    if (!this.workflow.isActive()) {
      if (this._viewMode() === 'configure-harness') {
        try {
          const composed = await this.rpc.workflowPrompt({
            mode: 'configure-harness',
            intent: text,
          });
          await this.workflow.startWorkflow(
            'configure-harness',
            composed.prompt,
          );
        } catch (error: unknown) {
          console.error(
            '[HarnessBuilderView] configure-harness start failed:',
            error instanceof Error ? error.message : String(error),
          );
        }
        return;
      }
      await this.workflow.startWorkflow(this._viewMode(), text);
      return;
    }

    await this.workflow.sendMessage(text);
  }

  protected async applyConfig(): Promise<void> {
    this.isApplying.set(true);

    try {
      const now = new Date().toISOString();
      const partial = this.state.config();
      const workspaceName =
        this.state.workspaceContext()?.projectName ?? 'harness';
      const fullConfig = {
        name:
          partial.name && partial.name.trim().length > 0
            ? partial.name
            : workspaceName,
        persona: partial.persona ?? { label: '', description: '', goals: [] },
        agents: {
          enabledAgents: partial.agents?.enabledAgents ?? {},
          harnessSubagents: partial.agents?.harnessSubagents ?? [],
        },
        skills: {
          selectedSkills: partial.skills?.selectedSkills ?? [],
          createdSkills: partial.skills?.createdSkills ?? [],
        },
        prompt: {
          systemPrompt: partial.prompt?.systemPrompt ?? '',
          enhancedSections: partial.prompt?.enhancedSections ?? {},
        },
        mcp: {
          servers: partial.mcp?.servers ?? [],
          enabledTools: partial.mcp?.enabledTools ?? {},
        },
        claudeMd: {
          generateProjectClaudeMd:
            partial.claudeMd?.generateProjectClaudeMd ?? true,
          customSections: partial.claudeMd?.customSections ?? {},
          previewContent: partial.claudeMd?.previewContent ?? '',
        },
        createdAt: partial.createdAt ?? now,
        updatedAt: now,
      };
      const pinnedRoot = this.state.pinnedWorkspaceRoot();
      await this.rpc.apply({
        config: fullConfig,
        outputFormat: 'claude-md',
        ...(pinnedRoot ? { workspaceRoot: pinnedRoot } : {}),
      });
    } catch (err) {
      this.initError.set(
        err instanceof Error ? err.message : 'Failed to apply configuration',
      );
    } finally {
      this.isApplying.set(false);
    }
  }

  protected onPermissionResponse(response: PermissionResponse): void {
    this.permissionHandler.handlePermissionResponse(response);
  }

  protected onQuestionResponse(response: AskUserQuestionResponse): void {
    this.permissionHandler.handleQuestionResponse(response);
  }
}
