import { CommonModule } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';

// Core Services (from core library)
import {
  AppStateManager,
  ChatService,
  LoggingService,
  VSCodeService,
  WebviewNavigationService,
} from '@ptah-extension/core';

// Chat-specific services (from this library)
import { ChatStateManagerService, ChatStoreService } from '../../services';

// Shared types
import type { DropdownOption } from '@ptah-extension/shared';
import { SessionId } from '@ptah-extension/shared';

// Core types (ProcessedClaudeMessage from core has richer type information)
import type { ProcessedClaudeMessage } from '@ptah-extension/core';

// Chat Components (from same library)
import {
  AgentStatusBadgeComponent,
  AgentTimelineComponent,
  AgentTreeComponent,
  ChatHeaderComponent,
  ChatInputAreaComponent,
  ChatMessagesContainerComponent,
  ChatStatusBarComponent,
  ChatStreamingStatusComponent,
  ChatTokenUsageComponent,
} from '../../components';

// Event Relay UI Components (TASK_2025_006 - Batch 4)
import { AgentActivityTimelineComponent } from '../../components/agent-activity-timeline/agent-activity-timeline.component';
import { PermissionDialogComponent } from '../../components/permission-dialog/permission-dialog.component';
import { ThinkingDisplayComponent } from '../../components/thinking-display/thinking-display.component';
import { ToolTimelineComponent } from '../../components/tool-timeline/tool-timeline.component';

// Component-specific types (imported from individual components)
import type { ProviderStatus } from '../../components/chat-header/chat-header.component';
import type { ChatStatusMetrics } from '../../components/chat-status-bar/chat-status-bar.component';
import type { TokenUsage } from '../../components/chat-token-usage/chat-token-usage.component';

// Provider Components

/**
 * Chat Container Component - Orchestrates Chat Feature
 *
 * Simplified version focusing on core chat functionality:
 * - Message display and input
 * - Session management
 * - Token usage tracking
 * - Provider status
 */
@Component({
  selector: 'ptah-chat',
  standalone: true,

  imports: [
    CommonModule,
    ChatHeaderComponent,
    ChatStatusBarComponent,
    ChatStreamingStatusComponent,
    ChatMessagesContainerComponent,
    ChatTokenUsageComponent,
    AgentTreeComponent,
    AgentTimelineComponent,
    AgentStatusBadgeComponent,
    ChatInputAreaComponent,
    ThinkingDisplayComponent,
    ToolTimelineComponent,
    PermissionDialogComponent,
    AgentActivityTimelineComponent,
  ],
  template: `
    <div class="vscode-chat-container">
      <!-- Header with Provider Settings and Agent Status Badge -->
      <div class="vscode-header-section">
        <ptah-chat-header
          [providerStatus]="providerStatus()"
          (newSession)="onNewSession()"
          (analytics)="showAnalytics()"
          (providerSettings)="toggleProviderSettings()"
        />
        <ptah-agent-status-badge
          [activeAgents]="chatService.activeAgents()"
          (togglePanel)="onToggleAgentPanel()"
        />
      </div>

      <!-- Token Usage Progress -->
      <ptah-chat-token-usage [tokenUsage]="tokenUsage()" />

      <!-- Main Content Area with Agent Panel -->
      <div class="vscode-main-content">
        <!-- Messages Container -->
        <ptah-chat-messages-container
          [hasMessages]="hasMessages()"
          [messages]="claudeMessages()"
          [sessionId]="currentSession()?.id || null"
          [loading]="isLoading()"
          (messageClicked)="onMessageClick($event)"
          (fileClicked)="handleFileClick($event)"
          (toolActionRequested)="handleToolAction($event)"
          (messageActioned)="handleMessageAction($event)"
          (scrolledToTop)="handleScrolledToTop()"
          (quickHelp)="startQuickHelp()"
          (orchestration)="startOrchestration()"
        />

        <!-- Event Relay Visualizations (TASK_2025_006 - Batch 4) -->
        <ptah-thinking-display [thinking]="chatService.currentThinking()" />
        <ptah-tool-timeline [executions]="chatService.toolExecutions()" />
        <ptah-agent-activity-timeline [agents]="agentActivitiesForDisplay()" />

        <!-- Agent Panel (Collapsible) -->
        @if (agentPanelVisible()) {
        <div class="agent-panel">
          <div class="agent-panel-header">
            <h3>Agent Execution</h3>
            <button
              class="close-button"
              (click)="onToggleAgentPanel()"
              aria-label="Close agent panel"
            >
              ✕
            </button>
          </div>
          <div class="agent-panel-content">
            <ptah-agent-tree [agents]="chatService.agents()" />
            <ptah-agent-timeline [agents]="chatService.agents()" />
          </div>
        </div>
        }
      </div>

      <!-- Streaming Status Banner -->
      <ptah-chat-streaming-status
        [isVisible]="isStreaming()"
        [streamingMessage]="'Claude is responding...'"
        [canStop]="true"
        (stopStreaming)="stopStreaming()"
      />

      <!-- Input Area -->
      <ptah-chat-input-area
        [message]="chatState.currentMessage()"
        [selectedAgent]="chatState.selectedAgent()"
        [agentOptions]="agentOptions()"
        [disabled]="isStreaming()"
        [canSend]="chatState.canSendMessage()"
        [placeholder]="chatState.getInputPlaceholder()"
        (messageChange)="chatState.updateCurrentMessage($event)"
        (agentChange)="onAgentChange($event)"
        (sendMessage)="sendMessage()"
        (keyDown)="onKeyDown($event)"
        (commandsClick)="onCommandsClick()"
      />

      <!-- Status Bar -->
      <ptah-chat-status-bar [metrics]="statusMetrics()" />

      <!-- Permission Dialog (Overlay) - TASK_2025_006 Batch 4 -->
      @if (chatService.pendingPermissions().length > 0) {
      <ptah-permission-dialog
        [permission]="chatService.pendingPermissions()[0]"
        (approve)="handlePermissionApproval($event)"
        (deny)="handlePermissionDenial($event)"
      />
      }
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

      .vscode-header-section {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 16px;
        background-color: var(--vscode-editor-background);
        border-bottom: 1px solid var(--vscode-panel-border);
      }

      .vscode-header-section ptah-chat-header {
        flex: 1;
      }

      .vscode-main-content {
        flex: 1;
        min-height: 0;
        display: flex;
        position: relative;
      }

      ptah-chat-messages-container {
        flex: 1;
        min-width: 0;
      }

      /* Agent Panel Styles */
      .agent-panel {
        width: 350px;
        flex-shrink: 0;
        background-color: var(--vscode-sideBar-background);
        border-left: 1px solid var(--vscode-panel-border);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        animation: slideIn 250ms ease-out;
      }

      @keyframes slideIn {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }

      .agent-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        background-color: var(--vscode-sideBarSectionHeader-background);
        border-bottom: 1px solid var(--vscode-panel-border);
      }

      .agent-panel-header h3 {
        margin: 0;
        font-size: 13px;
        font-weight: 600;
        color: var(--vscode-sideBarSectionHeader-foreground);
      }

      .close-button {
        background: transparent;
        border: none;
        color: var(--vscode-icon-foreground);
        font-size: 16px;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
        transition: background-color 150ms;
      }

      .close-button:hover {
        background-color: var(--vscode-toolbar-hoverBackground);
      }

      .close-button:focus {
        outline: 2px solid var(--vscode-focusBorder);
        outline-offset: 2px;
      }

      .agent-panel-content {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      /* Responsive: Overlay on narrow viewports */
      @media (max-width: 800px) {
        .agent-panel {
          position: absolute;
          top: 0;
          right: 0;
          bottom: 0;
          width: 100%;
          max-width: 400px;
          z-index: 10;
          box-shadow: -4px 0 12px rgba(0, 0, 0, 0.3);
        }
      }

      ptah-chat-input-area,
      ptah-chat-token-usage,
      ptah-chat-status-bar {
        flex-shrink: 0;
      }
    `,
  ],
})
export class ChatComponent implements OnInit {
  // Injected Services
  private readonly appState = inject(AppStateManager);
  private readonly chat = inject(ChatService);
  private readonly chatStore = inject(ChatStoreService); // TASK_2025_021: RPC Migration
  private readonly vscode = inject(VSCodeService);
  readonly chatService = inject(ChatService); // Public for template access
  protected readonly chatState = inject(ChatStateManagerService);
  private readonly logger = inject(LoggingService);
  private readonly navigation = inject(WebviewNavigationService);
  private readonly destroyRef = inject(DestroyRef);

  // Agent Panel State (TASK_2025_004)
  readonly agentPanelVisible = signal(false);

  // TASK_2025_021: Signal-based state from ChatStoreService
  readonly sessions = this.chatStore.sessions;
  readonly storeCurrentSession = this.chatStore.currentSession;
  readonly storeMessages = this.chatStore.messages;
  readonly storeIsLoading = this.chatStore.isLoading;
  readonly storeError = this.chatStore.error;

  // Readonly computed properties from services (legacy - to be migrated)
  readonly claudeMessages = this.chat.claudeMessages;
  readonly isStreaming = this.chat.isStreaming;
  readonly currentSession = this.chat.currentSession;
  readonly streamConsumptionState = this.chat.streamConsumptionState;
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

  readonly hasMessages = computed(() => {
    return this.claudeMessages().length > 0;
  });

  readonly providerStatus = computed((): ProviderStatus => {
    const state = this.streamConsumptionState();
    return {
      name: 'Claude',
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

  readonly agentOptions = computed(() => {
    // Convert readonly array to mutable for compatibility
    return [...this.chatState.agentOptions()];
  });

  // Transform agent activities for display (TASK_2025_006 - Batch 4)
  readonly agentActivitiesForDisplay = computed(() => {
    const agents = this.chatService.agents();
    return agents.map((node) => ({
      agentId: node.agent.agentId,
      name: node.agent.subagentType,
      status:
        node.status === 'complete'
          ? ('completed' as const)
          : ('running' as const),
      startTime: node.agent.timestamp ?? Date.now(),
      endTime:
        node.status === 'complete'
          ? (node.agent.timestamp ?? Date.now()) + (node.duration ?? 0)
          : undefined,
      activity:
        node.activities.length > 0
          ? `Used ${node.activities.length} tools`
          : undefined,
      result: node.status === 'complete' ? 'Task completed' : undefined,
    }));
  });

  public ngOnInit(): void {
    this.logger.debug('ChatComponent initializing', 'ChatComponent', {
      hasSession: !!this.currentSession(),
      messageCount: this.chat.messages().length,
      hasMessages: this.hasMessages(),
    });

    this.chatState.initialize();

    // TASK_2025_021: Load sessions via RPC
    void this.chatStore.loadSessions();

    // Refresh sessions list (backup/refresh mechanism if INITIAL_DATA is stale)
    // TASK_SESSION_MANAGEMENT - Batch 5 Fix
    void this.chatService.refreshSessions();
  }

  // Agent Panel Toggle (TASK_2025_004)
  public onToggleAgentPanel(): void {
    this.agentPanelVisible.update((visible) => !visible);
    this.logger.debug('Agent panel toggled', 'ChatComponent', {
      visible: this.agentPanelVisible(),
    });
  }
  // Message Handling
  public sendMessage(): void {
    const content = this.chatState.currentMessage().trim();
    if (!this.chatState.canSendMessage() || !content) {
      this.logger.debug(
        'Cannot send message - invalid state',
        'ChatComponent',
        {
          canSend: this.chatState.canSendMessage(),
          hasContent: !!content,
        }
      );
      return;
    }

    // Clear message IMMEDIATELY to prevent double-send
    this.chatState.clearCurrentMessage();

    const agent = this.chatState.selectedAgent();
    this.logger.debug('Sending message', 'ChatComponent', {
      agent,
      contentLength: content.length,
    });
    this.chat.sendMessage(content, agent);
  }

  // Event Handlers
  public onNewSession(): void {
    this.logger.debug('Creating new session', 'ChatComponent');
    // TASK_2025_021: Use ChatStoreService for session creation
    void this.chatStore.createNewSession('New Session').then((sessionId) => {
      if (sessionId) {
        void this.chatStore.switchSession(sessionId);
      }
    });
  }

  public onSessionCreated(name: string | undefined): void {
    this.logger.debug('Session created', 'ChatComponent', { name });
    // TASK_2025_021: Use ChatStoreService for session creation
    void this.chatStore.createNewSession(name || 'New Session').then((sessionId) => {
      if (sessionId) {
        void this.chatStore.switchSession(sessionId);
      }
    });
  }

  public onSessionSelected(sessionId: string): void {
    this.logger.debug('Session selected from empty state', 'ChatComponent', {
      sessionId,
    });
    // TASK_2025_021: Use ChatStoreService for session switching
    void this.chatStore.switchSession(SessionId.from(sessionId));
  }

  public onAgentChange(option: DropdownOption): void {
    if (option.value !== this.chatState.selectedAgent()) {
      this.chatState.updateSelectedAgent(option.value);
    }
  }

  public onKeyDown(event: KeyboardEvent): void {
    // REMOVED: Ctrl+Enter is now handled directly in ChatInputAreaComponent
    // to prevent double event handling. This method is kept for future
    // keyboard shortcuts if needed (e.g., Escape to cancel, etc.)
    this.logger.debug('Key pressed in chat', 'ChatComponent', {
      key: event.key,
      ctrl: event.ctrlKey,
      meta: event.metaKey,
    });
  }

  public onMessageClick(message: ProcessedClaudeMessage): void {
    this.logger.debug('Message clicked', 'ChatComponent', {
      messageId: message.id,
    });
  }

  public handleFileClick(filePath: string): void {
    // TODO: Implement file opening - add 'file:open' to MessagePayloadMap
    this.logger.debug('File click requested', 'ChatComponent', { filePath });
  }

  public handleToolAction(action: {
    tool: string;
    action: string;
    data?: unknown;
  }): void {
    // TODO: Implement tool actions - add 'tool:action' to MessagePayloadMap
    this.logger.debug('Tool action requested', 'ChatComponent', { action });
  }

  public handleMessageAction(action: {
    action: string;
    message: ProcessedClaudeMessage;
  }): void {
    this.logger.debug('Message action requested', 'ChatComponent', {
      action: action.action,
    });
  }

  public handleScrolledToTop(): void {
    // Handle infinite scroll or load more messages
  }

  public startQuickHelp(): void {
    const helpMessage =
      'How can I help you today? I can assist with code, architecture, research, and general questions.';
    this.chatState.updateCurrentMessage(helpMessage);
  }

  public startOrchestration(): void {
    const orchestrationMessage = '/orchestrate ';
    this.chatState.updateCurrentMessage(orchestrationMessage);
  }

  public stopStreaming(): void {
    this.chat.stopStreaming();
  }

  public onCommandsClick(): void {
    // TODO: Implement command sheet toggle
    this.logger.debug('Commands clicked', 'ChatComponent');
  }

  // UI Actions
  public showAnalytics(): void {
    this.logger.debug('Navigating to analytics', 'ChatComponent');
    void this.navigation.navigateToView('analytics');
  }

  public toggleProviderSettings(): void {
    this.logger.debug('Navigating to settings', 'ChatComponent');
    void this.navigation.navigateToView('settings');
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
        ? Math.round(
            latencyHistory.reduce((a: number, b: number) => a + b, 0) /
              latencyHistory.length
          )
        : 0;
    return `${avgLatency}ms`;
  }

  private getMemoryUsage(): string {
    const state = this.streamConsumptionState();
    const memoryMB = Math.round(
      state.performanceMetrics.totalBytesProcessed / (1024 * 1024)
    );
    return `${memoryMB}MB`;
  }

  private getSuccessRate(): string {
    const state = this.streamConsumptionState();
    const total = state.performanceMetrics.totalMessagesProcessed;
    const errors = state.streamErrors.length;
    const successRate =
      total > 0 ? Math.round(((total - errors) / total) * 100) : 100;
    return `${successRate}%`;
  }

  // Permission handlers (TASK_2025_006 - Batch 4)
  public handlePermissionApproval(requestId: string): void {
    this.logger.info('Permission approved', 'ChatComponent', { requestId });
    // this.chatService.approvePermission(requestId); // TODO: Phase 2 RPC - restore permission handling
  }

  public handlePermissionDenial(requestId: string): void {
    this.logger.info('Permission denied', 'ChatComponent', { requestId });
    // this.chatService.denyPermission(requestId); // TODO: Phase 2 RPC - restore permission handling
  }
}
