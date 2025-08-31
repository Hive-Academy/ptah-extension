import { CommonModule } from '@angular/common';
import {
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  ChangeDetectionStrategy,
  ViewChild,
} from '@angular/core';
import { filter, Subject, takeUntil } from 'rxjs';
import { LoggingService } from '../../core/services/logging.service';

// Core Services
import { AppStateManager } from '../../core/services/app-state.service';
import { EnhancedChatService } from '../../core/services/enhanced-chat.service';
import { MessageHandlerService } from '../../core/services/message-handler.service';
import { VSCodeService } from '../../core/services/vscode.service';
import { ChatStateManagerService } from '../../core/services/chat-state-manager.service';
import {
  StrictMessage,
  MessagePayloadMap,
  SessionId,
  StrictChatSession,
} from '@ptah-extension/shared';

// Decomposed Components
import {
  VSCodeChatHeaderComponent,
  VSCodeChatStatusBarComponent,
  VSCodeChatStreamingStatusComponent,
  VSCodeChatMessagesContainerComponent,
  VSCodeChatTokenUsageComponent,
  VSCodeChatInputAreaComponent,
  VSCodeCommandBottomSheetComponent,
  VSCodePermissionPopupComponent,
  SessionSelectorComponent,
  type TokenUsage,
  type ChatMessage as DumbChatMessage,
  type DropdownOption,
  type QuickCommand,
  type PermissionRequest,
  type PermissionResponse,
  type ProviderStatus,
  type ChatStatusMetrics,
} from '../../dumb-components';

// Smart Layout Components
import { ProviderManagerComponent } from '../providers/provider-manager.component';
import { ProcessedClaudeMessage } from '@ptah-extension/shared';

/**
 * Refactored Chat Component - Orchestrates Decomposed Components
 *
 * BEFORE: 1,127 lines, 70 methods, massive responsibilities
 * AFTER: Focused orchestration with single responsibility
 *
 * Key Improvements:
 * - Component decomposition following single responsibility principle
 * - Business logic extracted to ChatStateManagerService
 * - Message display logic encapsulated in ChatMessagesContainerComponent
 * - Status display extracted to dedicated components
 * - Clean separation of concerns
 */
@Component({
  selector: 'vscode-chat',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    VSCodeChatHeaderComponent,
    VSCodeChatStatusBarComponent,
    VSCodeChatStreamingStatusComponent,
    VSCodeChatMessagesContainerComponent,
    VSCodeChatTokenUsageComponent,
    VSCodeChatInputAreaComponent,
    VSCodeCommandBottomSheetComponent,
    VSCodePermissionPopupComponent,
    SessionSelectorComponent,
    ProviderManagerComponent,
  ],
  template: `
    <div class="vscode-chat-container">
      <!-- Header with Provider Settings -->
      <vscode-chat-header
        [providerStatus]="providerStatus()"
        (newSession)="chatState.createNewSession()"
        (analytics)="showAnalytics()"
        (providerSettings)="toggleProviderSettings()"
      >
      </vscode-chat-header>

      <!-- Session Management -->
      <div class="vscode-session-section">
        <vscode-session-selector
          [currentSession]="currentSession()"
          [sessions]="chatState.availableSessions()"
          [isLoading]="chatState.isSessionLoading()"
          [showSessionManager]="true"
          (sessionSelected)="chatState.switchToSession($event)"
          (sessionCreated)="chatState.createNewSession($event)"
          (sessionDeleted)="chatState.deleteSession($event)"
          (sessionManagerRequested)="chatState.openSessionManager()"
        >
        </vscode-session-selector>
      </div>

      <!-- Token Usage Progress -->
      <vscode-chat-token-usage [tokenUsage]="tokenUsage()"> </vscode-chat-token-usage>

      <!-- Messages Container with Unified Display Logic -->
      <vscode-chat-messages-container
        [hasAnyMessages]="hasAnyMessages()"
        [useEnhancedDisplay]="shouldUseEnhancedDisplay()"
        [enhancedMessages]="claudeMessages()"
        [legacyMessages]="chatMessages()"
        [sessionId]="currentSession()?.id || null"
        [isLoading]="isLoading()"
        (enhancedMessageClicked)="onEnhancedMessageClick($event)"
        (fileClicked)="handleFileClick($event)"
        (toolActionRequested)="handleToolAction($event)"
        (messageActioned)="handleMessageAction($event)"
        (scrolledToTop)="handleScrolledToTop()"
        (legacyMessageClicked)="onMessageClick($event)"
        (quickHelp)="startQuickHelp()"
        (orchestration)="startOrchestration()"
      >
      </vscode-chat-messages-container>

      <!-- Streaming Status Banner -->
      <vscode-chat-streaming-status
        [isVisible]="isStreaming()"
        [streamingMessage]="'Claude is responding...'"
        [canStop]="true"
        (stopStreaming)="stopStreaming()"
      >
      </vscode-chat-streaming-status>

      <!-- Input Area -->
      <vscode-chat-input-area
        [message]="chatState.currentMessage()"
        [selectedAgent]="chatState.selectedAgent()"
        [agentOptions]="chatState.agentOptions()"
        [disabled]="isStreaming()"
        [canSend]="chatState.canSendMessage()"
        [placeholder]="chatState.getInputPlaceholder()"
        (messageChange)="chatState.updateCurrentMessage($event)"
        (agentChange)="onAgentChange($event)"
        (sendMessage)="sendMessage()"
        (keyDown)="onKeyDown($event)"
        (commandsClick)="toggleCommandSheet()"
      >
      </vscode-chat-input-area>

      <!-- Status Bar -->
      <vscode-chat-status-bar [metrics]="statusMetrics()"> </vscode-chat-status-bar>

      <!-- Command Bottom Sheet -->
      <vscode-command-bottom-sheet
        [isOpen]="showCommandSheet()"
        (commandSelected)="onCommandSelected($event)"
        (close)="closeCommandSheet()"
      >
      </vscode-command-bottom-sheet>

      <!-- Permission Popup -->
      <vscode-permission-popup
        [isOpen]="showPermissionPopup()"
        [permissionRequest]="currentPermissionRequest()"
        [allowBackdropClose]="false"
        (permissionResponse)="onPermissionResponse($event)"
        (close)="closePermissionPopup()"
      >
      </vscode-permission-popup>

      <!-- Provider Settings Panel -->
      <app-provider-manager #providerManager />
    </div>
  `,
  styles: [
    `
      .vscode-chat-container {
        display: flex;
        flex-direction: column;
        height: 100vh;
        background-color: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        font-family: var(--vscode-font-family);
        overflow: hidden;
      }

      .vscode-session-section {
        flex-shrink: 0;
        padding: 8px 16px;
        background-color: var(--vscode-editor-background);
        border-bottom: 1px solid var(--vscode-panel-border);
      }

      vscode-chat-messages-container {
        flex: 1;
        min-height: 0;
      }

      vscode-chat-input-area,
      vscode-chat-token-usage,
      vscode-chat-header,
      vscode-chat-status-bar {
        flex-shrink: 0;
      }
    `,
  ],
})
export class VSCodeChatComponent implements OnInit, OnDestroy {
  // Injected Services
  private appState = inject(AppStateManager);
  private enhancedChat = inject(EnhancedChatService);
  private messageHandler = inject(MessageHandlerService);
  private vscode = inject(VSCodeService);
  protected chatState = inject(ChatStateManagerService);
  private logger = inject(LoggingService);

  // Component State
  private destroy$ = new Subject<void>();
  @ViewChild('providerManager') providerManager?: ProviderManagerComponent;

  // UI State Signals
  private _showCommandSheet = computed(() => false);
  private _showPermissionPopup = computed(() => false);
  private _currentPermissionRequest = computed<PermissionRequest | null>(() => null);

  // Readonly computed properties from services
  readonly messages = this.enhancedChat.messages;
  readonly claudeMessages = this.enhancedChat.claudeMessages;
  readonly isStreaming = this.enhancedChat.isStreaming;
  readonly currentSession = this.enhancedChat.currentSession;
  readonly streamConsumptionState = this.enhancedChat.streamConsumptionState;
  readonly isLoading = this.appState.isLoading;

  // Computed UI Properties
  readonly tokenUsage = computed((): TokenUsage | null => {
    const session = this.currentSession();
    if (!session?.tokenUsage) return null;

    return {
      used: session.tokenUsage.input + session.tokenUsage.output,
      total: session.tokenUsage.total,
      percentage: session.tokenUsage.percentage,
    };
  });

  readonly chatMessages = computed((): DumbChatMessage[] => {
    return this.messages().map((msg) => ({
      id: msg.id || crypto.randomUUID(),
      role: msg.type as 'user' | 'assistant',
      content: msg.content,
      timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
      isStreaming: msg.streaming || false,
      agent: msg.type === 'assistant' ? this.chatState.selectedAgent() : undefined,
    }));
  });

  readonly hasAnyMessages = computed(() => {
    const enhanced = this.claudeMessages().length;
    const legacy = this.messages().length;
    return enhanced > 0 || legacy > 0;
  });

  readonly shouldUseEnhancedDisplay = computed(() => {
    const enhancedCount = this.claudeMessages().length;
    // Always prefer enhanced display when available
    return enhancedCount > 0;
  });

  readonly providerStatus = computed((): ProviderStatus => {
    const state = this.streamConsumptionState();
    return {
      name: 'Claude', // TODO: Get from provider service
      status: state.isConnected ? 'online' : 'offline',
    };
  });

  readonly statusMetrics = computed((): ChatStatusMetrics => {
    const state = this.streamConsumptionState();
    return {
      systemStatus: this.getSystemStatus(),
      responseTime: this.getResponseTime(),
      memoryUsage: this.getMemoryUsage(),
      successRate: this.getSuccessRate(),
      isConnected: state.isConnected,
    };
  });

  readonly showCommandSheet = this._showCommandSheet;
  readonly showPermissionPopup = this._showPermissionPopup;
  readonly currentPermissionRequest = this._currentPermissionRequest;

  ngOnInit(): void {
    this.initializeChat();
    this.chatState.initialize();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.chatState.destroy();
  }

  // Message Handling
  sendMessage(): void {
    const content = this.chatState.currentMessage().trim();
    if (!this.chatState.canSendMessage() || !content) return;

    const agent = this.chatState.selectedAgent();
    this.enhancedChat.sendMessage(content, agent);
    this.chatState.clearCurrentMessage();
  }

  // Event Handlers
  onAgentChange(option: DropdownOption): void {
    if (option.value !== this.chatState.selectedAgent()) {
      this.chatState.updateSelectedAgent(option.value);
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      if (event.ctrlKey || event.metaKey) {
        this.sendMessage();
      }
    }
  }

  onMessageClick(message: DumbChatMessage): void {
    // Handle legacy message click
  }

  onEnhancedMessageClick(message: ProcessedClaudeMessage): void {
    // Handle enhanced message click
  }

  handleFileClick(filePath: string): void {
    this.vscode.postMessage({
      type: 'openFile',
      data: { filePath },
    });
  }

  handleToolAction(action: { tool: string; action: string; data?: any }): void {
    this.vscode.postMessage({
      type: 'toolAction',
      data: action,
    });
  }

  handleMessageAction(action: { action: string; message: ProcessedClaudeMessage }): void {
    // Handle message actions (copy, retry, etc.)
  }

  handleScrolledToTop(): void {
    // Handle infinite scroll or load more messages
  }

  startQuickHelp(): void {
    const helpMessage =
      'How can I help you today? I can assist with code, architecture, research, and general questions.';
    this.chatState.updateCurrentMessage(helpMessage);
  }

  startOrchestration(): void {
    const orchestrationMessage = '/orchestrate ';
    this.chatState.updateCurrentMessage(orchestrationMessage);
  }

  stopStreaming(): void {
    this.enhancedChat.stopStreaming();
  }

  // UI Actions
  showAnalytics(): void {
    this.vscode.postMessage({
      type: 'navigation:showAnalytics',
      data: {},
    });
  }

  toggleProviderSettings(): void {
    this.providerManager?.toggle();
  }

  toggleCommandSheet(): void {
    // TODO: Implement command sheet toggle
  }

  closeCommandSheet(): void {
    // TODO: Implement command sheet close
  }

  onCommandSelected(command: QuickCommand): void {
    this.chatState.updateCurrentMessage(command.template);
    this.closeCommandSheet();
  }

  onPermissionResponse(response: PermissionResponse): void {
    // Handle permission response
  }

  closePermissionPopup(): void {
    // TODO: Implement permission popup close
  }

  // Private Methods
  private initializeChat(): void {
    this.setupMessageHandling();
  }

  private setupMessageHandling(): void {
    // Permission handling
    this.vscode
      .onMessageType('permission:request')
      .pipe(takeUntil(this.destroy$))
      .subscribe((request) => {
        // TODO: Handle permission requests
      });

    // Error handling
    this.vscode
      .onMessageType('error')
      .pipe(
        filter((msg) => msg.data?.source === 'chat'),
        takeUntil(this.destroy$),
      )
      .subscribe((error) => {
        this.logger.error('Chat error received from backend', 'VSCodeChatComponent', error);
      });
  }

  // Status calculation methods
  private getSystemStatus(): ChatStatusMetrics['systemStatus'] {
    const state = this.streamConsumptionState();
    if (state.streamErrors.length > 0) return 'error';
    if (!state.isConnected) return 'disconnected';
    return 'operational';
  }

  private getResponseTime(): string {
    const state = this.streamConsumptionState();
    const latencyHistory = state.performanceMetrics.messageLatencyHistory;
    const avgLatency =
      latencyHistory.length > 0
        ? Math.round(latencyHistory.reduce((a, b) => a + b, 0) / latencyHistory.length)
        : 0;
    return `${avgLatency}ms`;
  }

  private getMemoryUsage(): string {
    const state = this.streamConsumptionState();
    const memoryMB = Math.round(state.performanceMetrics.totalBytesProcessed / (1024 * 1024));
    return `${memoryMB}MB`;
  }

  private getSuccessRate(): string {
    const state = this.streamConsumptionState();
    const total = state.performanceMetrics.totalMessagesProcessed;
    const errors = state.streamErrors.length;
    const successRate = total > 0 ? Math.round(((total - errors) / total) * 100) : 100;
    return `${successRate}%`;
  }
}
