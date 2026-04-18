import {
  Component,
  ChangeDetectionStrategy,
  inject,
  OnInit,
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
import { MarkdownModule } from 'ngx-markdown';
import { WebviewNavigationService } from '@ptah-extension/core';
import {
  ExecutionNodeComponent,
  ExecutionTreeBuilderService,
} from '@ptah-extension/chat';
import { HarnessBuilderStateService } from '../services/harness-builder-state.service';
import { HarnessRpcService } from '../services/harness-rpc.service';
import { HarnessStreamingService } from '../services/harness-streaming.service';
import { HarnessConfigPreviewComponent } from './harness-config-preview.component';

@Component({
  selector: 'ptah-harness-builder-view',
  standalone: true,
  imports: [
    LucideAngularModule,
    FormsModule,
    MarkdownModule,
    ExecutionNodeComponent,
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
      }
    `,
  ],
  template: `
    <!-- Loading state -->
    @if (isInitializing()) {
      <div class="flex items-center justify-center h-full">
        <div class="text-center">
          <lucide-angular
            [img]="Loader2Icon"
            class="w-8 h-8 animate-spin text-primary mx-auto"
            aria-hidden="true"
          />
          <p class="mt-3 text-sm text-base-content/60">
            Initializing Harness Builder...
          </p>
        </div>
      </div>
    }

    <!-- Error state -->
    @else if (initError()) {
      <div class="flex items-center justify-center h-full">
        <div class="alert alert-error max-w-md">
          <span>{{ initError() }}</span>
          <button class="btn btn-sm" (click)="initializeBuilder()">
            Retry
          </button>
        </div>
      </div>
    }

    <!-- Main conversational UI -->
    @else {
      <!-- Header -->
      <header
        class="flex items-center justify-between px-4 py-3 border-b border-base-300 bg-base-100 shrink-0"
      >
        <div class="flex items-center gap-2">
          <h1 class="text-base font-bold text-base-content">Harness Builder</h1>
          @if (state.configSummary() !== 'No configuration yet') {
            <span class="text-xs text-base-content/40 hidden sm:inline">
              {{ state.configSummary() }}
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
            (click)="close()"
            aria-label="Close harness builder"
          >
            <lucide-angular [img]="XIcon" class="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      <!-- Body: split layout -->
      <div class="flex flex-1 min-h-0 overflow-hidden">
        <!-- LEFT: Conversation area -->
        <div class="flex flex-col flex-1 min-w-0 border-r border-base-300">
          <!-- Scrollable transcript -->
          <div
            #scrollContainer
            class="flex-1 overflow-y-auto p-4 space-y-4"
            role="log"
            aria-label="Conversation transcript"
          >
            <!-- Welcome message when no conversation yet -->
            @if (state.conversationMessages().length === 0 && !isProcessing()) {
              <div
                class="flex flex-col items-center justify-center h-full text-center px-4"
              >
                <lucide-angular
                  [img]="SparklesIcon"
                  class="w-10 h-10 text-primary/40 mb-4"
                  aria-hidden="true"
                />
                <h2 class="text-lg font-semibold text-base-content mb-2">
                  Describe your harness
                </h2>
                <p class="text-sm text-base-content/50 max-w-md">
                  Tell me what you're building and I'll configure the agents,
                  skills, prompts, and MCP servers for your workspace.
                </p>
              </div>
            }

            <!-- Conversation messages -->
            @for (msg of state.conversationMessages(); track $index) {
              @if (msg.role === 'user') {
                <div class="flex justify-end">
                  <div
                    class="max-w-[85%] px-4 py-3 rounded-2xl rounded-br-md bg-primary text-primary-content text-sm whitespace-pre-wrap"
                  >
                    {{ msg.content }}
                  </div>
                </div>
              } @else {
                <div class="flex justify-start w-full">
                  <div
                    class="max-w-[90%] px-4 py-3 rounded-2xl rounded-bl-md bg-base-200 text-base-content text-sm leading-relaxed"
                  >
                    <markdown
                      [data]="msg.content"
                      class="prose prose-sm prose-invert max-w-none"
                    />
                  </div>
                </div>
              }
            }

            <!-- Processing indicator (no streaming events yet) -->
            @if (isProcessing() && !streaming.isStreaming()) {
              <div class="flex justify-start">
                <div class="px-4 py-3 rounded-2xl rounded-bl-md bg-base-200">
                  <span
                    class="loading loading-dots loading-sm text-base-content/50"
                  ></span>
                </div>
              </div>
            }

            <!-- Inline execution nodes -->
            @if (executionNodes().length > 0) {
              <div class="space-y-1">
                @for (node of executionNodes(); track node.id) {
                  <ptah-execution-node
                    [node]="node"
                    [isStreaming]="streaming.isStreaming()"
                  />
                }
              </div>
            }
          </div>

          <!-- Input bar -->
          <div class="px-4 py-3 border-t border-base-300 bg-base-100 shrink-0">
            <!-- Config complete banner -->
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

        <!-- RIGHT: Side panel (config) -->
        @if (showSidePanel()) {
          <aside class="flex flex-col w-[420px] bg-base-100 shrink-0 min-h-0">
            <!-- Panel header -->
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

            <!-- Config content -->
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
    }
  `,
})
export class HarnessBuilderViewComponent implements OnInit {
  protected readonly state = inject(HarnessBuilderStateService);
  private readonly rpc = inject(HarnessRpcService);
  private readonly navigation = inject(WebviewNavigationService);
  protected readonly streaming = inject(HarnessStreamingService);
  private readonly treeBuilder = inject(ExecutionTreeBuilderService);

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
  readonly isProcessing = signal(false);
  readonly isApplying = signal(false);
  readonly showSidePanel = signal(true);

  protected messageText = '';

  protected readonly executionNodes = computed(() => {
    const streamState = this.state.streamingState();
    if (streamState.events.size === 0) return [];
    const operationId = this.state.currentOperationId() ?? 'harness-converse';
    return this.treeBuilder.buildTree(streamState, operationId);
  });

  protected readonly canSend = computed(
    () => this.messageText.trim().length > 0 && !this.isProcessing(),
  );

  protected readonly hasAnyConfig = computed(() => {
    const cfg = this.state.config();
    return !!(cfg.persona || cfg.agents || cfg.skills || cfg.prompt || cfg.mcp);
  });

  constructor() {
    effect(() => {
      this.state.conversationMessages();
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
          : 'Failed to initialize harness builder',
      );
    } finally {
      this.isInitializing.set(false);
    }
  }

  public close(): void {
    const cfg = this.state.config();
    const hasConfig =
      cfg.persona || cfg.agents || cfg.skills || cfg.prompt || cfg.mcp;
    if (hasConfig) {
      if (
        !confirm('You have unsaved changes. Are you sure you want to close?')
      ) {
        return;
      }
    }
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
    this.isProcessing.set(true);
    this.streaming.reset();

    this.state.addConversationMessage({ role: 'user', content: text });

    try {
      const response = await this.rpc.converse({
        message: text,
        history: this.state.conversationMessages().slice(0, -1),
        config: this.state.config(),
        workspaceContext: this.state.workspaceContext() ?? undefined,
      });

      if (response.configUpdates) {
        this.state.applyConfigUpdates(response.configUpdates);
      }

      if (response.isConfigComplete) {
        this.state.setConfigComplete(true);
      }

      this.state.addConversationMessage({
        role: 'assistant',
        content: response.reply,
      });
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : 'Something went wrong';
      this.state.addConversationMessage({
        role: 'assistant',
        content: `I encountered an error: ${errorMsg}. Please try again.`,
      });
    } finally {
      this.isProcessing.set(false);
    }
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
      await this.rpc.apply({
        config: fullConfig,
        outputFormat: 'claude-md',
      });
      this.state.addConversationMessage({
        role: 'assistant',
        content: 'Configuration has been applied to your workspace.',
      });
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : 'Failed to apply configuration';
      this.state.addConversationMessage({
        role: 'assistant',
        content: `Failed to apply: ${errorMsg}`,
      });
    } finally {
      this.isApplying.set(false);
    }
  }
}
