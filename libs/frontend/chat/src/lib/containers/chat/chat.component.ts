import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit } from '@angular/core';
import { Subject } from 'rxjs';

// Core Services (from core library)
import {
  AppStateManager,
  ChatService,
  VSCodeService,
  ChatStateManagerService,
  LoggingService,
} from '@ptah-extension/core';

// Shared types
import type { DropdownOption } from '@ptah-extension/shared';

// Core types (ProcessedClaudeMessage from core has richer type information)
import type { ProcessedClaudeMessage } from '@ptah-extension/core';

// Chat Components (from same library)
import {
  ChatHeaderComponent,
  ChatStatusBarComponent,
  ChatStreamingStatusComponent,
  ChatMessagesContainerComponent,
  ChatTokenUsageComponent,
  ChatInputAreaComponent,
} from '../../components';

// Component-specific types (imported from individual components)
import type { TokenUsage } from '../../components/chat-token-usage/chat-token-usage.component';
import type { ProviderStatus } from '../../components/chat-header/chat-header.component';
import type { ChatStatusMetrics } from '../../components/chat-status-bar/chat-status-bar.component';

// Session Components
import { SessionSelectorComponent } from '@ptah-extension/session';

// Provider Components
import { ProviderManagerComponent } from '@ptah-extension/providers';

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
    ChatInputAreaComponent,
    SessionSelectorComponent,
    ProviderManagerComponent,
  ],
  template: `
    <div class="vscode-chat-container">
      <!-- Header with Provider Settings -->
      <ptah-chat-header
        [providerStatus]="providerStatus()"
        (newSession)="onNewSession()"
        (analytics)="showAnalytics()"
        (providerSettings)="toggleProviderSettings()"
      />

      <!-- Session Management -->
      <div class="vscode-session-section">
        <ptah-session-selector
          [currentSession]="currentSession()"
          [sessions]="chatState.availableSessions()"
          [isLoading]="chatState.isSessionLoading()"
          [showSessionManager]="true"
          (sessionSelected)="chatState.switchToSession($event)"
          (sessionCreated)="onSessionCreated($event)"
          (sessionDeleted)="chatState.deleteSession($event)"
          (sessionManagerRequested)="chatState.openSessionManager()"
        />
      </div>

      <!-- Token Usage Progress -->
      <ptah-chat-token-usage [tokenUsage]="tokenUsage()" />

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

      <!-- Provider Settings Panel -->
      <ptah-provider-manager />
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

      ptah-chat-messages-container {
        flex: 1;
        min-height: 0;
      }

      ptah-chat-input-area,
      ptah-chat-token-usage,
      ptah-chat-header,
      ptah-chat-status-bar {
        flex-shrink: 0;
      }
    `,
  ],
})
export class ChatComponent implements OnInit, OnDestroy {
  // Injected Services
  private readonly appState = inject(AppStateManager);
  private readonly chat = inject(ChatService);
  private readonly vscode = inject(VSCodeService);
  protected readonly chatState = inject(ChatStateManagerService);
  private readonly logger = inject(LoggingService);

  // Component State
  private readonly destroy$ = new Subject<void>();

  // Readonly computed properties from services
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

  public ngOnInit(): void {
    console.log('=== ChatComponent ngOnInit ===');
    console.log('Current session:', this.currentSession());
    console.log('Messages:', this.chat.messages());
    console.log('Claude messages:', this.claudeMessages());
    console.log('Has messages:', this.hasMessages());

    this.chatState.initialize();

    // Log whenever session or messages change
    setTimeout(() => {
      console.log('=== After initialization (1s delay) ===');
      console.log('Current session:', this.currentSession());
      console.log('Messages count:', this.chat.messages().length);
      console.log('Claude messages count:', this.claudeMessages().length);
      console.log('Has messages:', this.hasMessages());
    }, 1000);
  }

  public ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Message Handling
  public sendMessage(): void {
    console.log('=== ChatComponent.sendMessage() called ===');
    console.log('Current message:', this.chatState.currentMessage());
    console.log('Can send:', this.chatState.canSendMessage());

    const content = this.chatState.currentMessage().trim();
    if (!this.chatState.canSendMessage() || !content) {
      console.log('Cannot send - returning early');
      return;
    }

    const agent = this.chatState.selectedAgent();
    console.log('Sending message with agent:', agent);
    this.chat.sendMessage(content, agent);
    this.chatState.clearCurrentMessage();
  }

  // Event Handlers
  public onNewSession(): void {
    console.log('=== ChatComponent.onNewSession() called ===');
    this.chatState.createNewSession('New Session');
  }

  public onSessionCreated(name: string | undefined): void {
    console.log('=== ChatComponent.onSessionCreated() called ===', name);
    this.chatState.createNewSession(name || 'New Session');
  }

  public onAgentChange(option: DropdownOption): void {
    if (option.value !== this.chatState.selectedAgent()) {
      this.chatState.updateSelectedAgent(option.value);
    }
  }

  public onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      if (event.ctrlKey || event.metaKey) {
        this.sendMessage();
      }
    }
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
    console.log('=== ChatComponent.onCommandsClick() called ===');
    console.log('Command button was clicked - Zone.js is working!');
    // TODO: Implement command sheet toggle
    this.logger.debug('Commands clicked', 'ChatComponent');
  }

  // UI Actions
  public showAnalytics(): void {
    this.vscode.postStrictMessage('navigate', {
      route: '/analytics',
      previousRoute: '/chat',
    });
  }

  public toggleProviderSettings(): void {
    // TODO: Access provider manager via viewChild when needed
    this.logger.debug('Toggle provider settings', 'ChatComponent');
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
}
