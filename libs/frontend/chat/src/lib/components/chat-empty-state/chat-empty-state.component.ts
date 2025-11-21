import { Component, output, inject, input, computed } from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';
import {
  LucideAngularModule,
  MessageSquareIcon,
  WorkflowIcon,
  ClockIcon,
  MessageCircleIcon,
} from 'lucide-angular';
import { VSCodeService } from '@ptah-extension/core';
import { SessionSummary } from '@ptah-extension/shared';

/**
 * Chat Empty State Component - Welcome Screen with Sessions List
 *
 * **Purpose**: Welcome message with action cards and recent sessions
 *
 * **Modernizations**:
 * - `@Output()` → `output<void>()` for all events (quickHelp, orchestration, sessionSelected)
 * - `@Input()` → `input<SessionSummary[]>()` for sessions list
 * - Already has OnPush change detection ✅
 * - Already has modern control flow (no structural directives) ✅
 * - Selector: vscode-chat-empty-state → ptah-chat-empty-state
 * - Dependency: VSCodeService from core library (for icon URI)
 *
 * **Architecture**:
 * - Pure presentation component (minimal business logic)
 * - VS Code theme integration with CSS custom properties
 * - Accessibility: Proper ARIA labels, keyboard navigation
 * - Responsive: High contrast and reduced motion support
 *
 * **Features**:
 * - Welcome message with Ptah branding
 * - Quick Help action card
 * - Code Orchestration action card
 * - Recent sessions list (if available)
 * - Feature highlights section
 *
 * @example
 * ```html
 * <ptah-chat-empty-state
 *   [sessions]="chatService.sessions()"
 *   (quickHelp)="handleQuickHelp()"
 *   (orchestration)="handleOrchestration()"
 *   (sessionSelected)="handleSessionSelected($event)"
 * />
 * ```
 */
@Component({
  selector: 'ptah-chat-empty-state',
  standalone: true,

  imports: [CommonModule, LucideAngularModule, NgOptimizedImage],
  template: `
    <div class="empty-state">
      <!-- Welcome Section -->
      <div class="welcome-section">
        <div class="welcome-icon">
          <img
            [ngSrc]="ptahIconUri"
            alt="Ptah"
            class="ptah-icon"
            width="120"
            height="120"
          />
        </div>
        <div class="welcome-content">
          <h3 class="welcome-title">Welcome to Claude Code</h3>
          <p class="welcome-description">
            Intelligent code assistance powered by
            <span class="highlight">Claude</span> to craft, refine, and perfect
            your projects.
          </p>
        </div>
      </div>

      <!-- Action Cards -->
      <div class="action-cards">
        <!-- Quick Help Card -->
        <button
          class="action-card action-card-primary"
          (click)="quickHelp.emit()"
          type="button"
          [attr.aria-label]="'Start quick help session'"
        >
          <div class="card-icon-container card-icon-primary">
            <lucide-angular [img]="MessageSquareIcon" class="card-icon" />
          </div>
          <h4 class="card-title card-title-primary">Quick Help</h4>
          <p class="card-description">
            Get immediate assistance for simple coding tasks and questions
          </p>
        </button>

        <!-- Orchestrate Card -->
        <button
          class="action-card action-card-secondary"
          (click)="orchestration.emit()"
          type="button"
          [attr.aria-label]="'Start orchestration workflow'"
        >
          <div class="card-icon-container card-icon-secondary">
            <lucide-angular [img]="WorkflowIcon" class="card-icon" />
          </div>
          <h4 class="card-title card-title-secondary">Code Orchestration</h4>
          <p class="card-description">
            Coordinate multiple agents to architect comprehensive solutions
          </p>
        </button>
      </div>

      <!-- Recent Sessions -->
      @if (hasSessions()) {
      <div class="sessions-section">
        <h4 class="sessions-title">Recent Sessions</h4>
        <div class="sessions-list">
          @for (session of sessions(); track session.id) {
          <button
            class="session-item"
            (click)="sessionSelected.emit(session.id)"
            type="button"
            [attr.aria-label]="'Open session ' + session.name"
          >
            <div class="session-icon">
              <lucide-angular [img]="MessageCircleIcon" class="icon" />
            </div>
            <div class="session-info">
              <p class="session-name">{{ session.name }}</p>
              <div class="session-meta">
                <span class="meta-item">
                  {{ session.messageCount }} message{{
                    session.messageCount === 1 ? '' : 's'
                  }}
                </span>
                <span class="meta-separator">•</span>
                <span class="meta-item">
                  <lucide-angular [img]="ClockIcon" class="meta-icon" />
                  {{ getRelativeTime(session.lastActiveAt) }}
                </span>
              </div>
            </div>
          </button>
          }
        </div>
      </div>
      }

      <!-- Feature Highlights -->
      <div class="feature-highlights">
        <div class="feature-item">
          <div class="feature-icon">📜</div>
          <div class="feature-content">
            <p class="feature-title">Sacred Scripts:</p>
            <p class="feature-text">
              Each scribe channels unique wisdom through dedicated models
            </p>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        text-align: center;
        padding: 24px;
        gap: 24px;
      }

      .welcome-section {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
      }

      .welcome-icon {
        margin-bottom: 8px;
      }

      .ptah-icon {
        width: 120px;
        height: 120px;
      }

      .welcome-content {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .welcome-title {
        margin: 0;
        font-size: 16px;
        font-weight: 500;
        color: var(--vscode-foreground);
      }

      .welcome-description {
        margin: 0;
        color: var(--vscode-descriptionForeground);
        font-size: 13px;
        max-width: 400px;
        line-height: 1.4;
      }

      .highlight {
        color: var(--vscode-textPreformat-foreground);
        font-weight: 500;
      }

      .action-cards {
        display: flex;
        gap: 16px;
        justify-content: center;
        flex-wrap: wrap;
      }

      .action-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 180px;
        padding: 16px;
        background-color: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.15s ease;
        text-align: center;
      }

      .action-card:hover {
        background-color: var(--vscode-list-hoverBackground);
        border-color: var(--vscode-focusBorder);
      }

      .action-card:focus {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 2px;
      }

      .action-card:active {
        transform: translateY(1px);
      }

      .card-icon-container {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 12px;
      }

      .card-icon-primary {
        background-color: var(--vscode-button-background);
      }

      .card-icon-secondary {
        background-color: var(--vscode-button-secondaryBackground);
      }

      .card-icon {
        width: 24px;
        height: 24px;
      }

      .card-title {
        margin: 0 0 4px 0;
        font-size: 12px;
        font-weight: 600;
      }

      .card-title-primary {
        color: var(--vscode-button-foreground);
      }

      .card-title-secondary {
        color: var(--vscode-button-secondaryForeground);
      }

      .card-description {
        margin: 0;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.3;
      }

      .sessions-section {
        display: flex;
        flex-direction: column;
        gap: 12px;
        width: 100%;
        max-width: 500px;
      }

      .sessions-title {
        margin: 0;
        font-size: 13px;
        font-weight: 600;
        color: var(--vscode-foreground);
        text-align: left;
      }

      .sessions-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .session-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        background-color: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.15s ease;
        text-align: left;
        width: 100%;
      }

      .session-item:hover {
        background-color: var(--vscode-list-hoverBackground);
        border-color: var(--vscode-focusBorder);
      }

      .session-item:focus {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 2px;
      }

      .session-item:active {
        transform: translateY(1px);
      }

      .session-icon {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background-color: var(--vscode-button-secondaryBackground);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .session-icon .icon {
        width: 18px;
        height: 18px;
        color: var(--vscode-button-secondaryForeground);
      }

      .session-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 4px;
        overflow: hidden;
      }

      .session-name {
        margin: 0;
        font-size: 13px;
        font-weight: 500;
        color: var(--vscode-foreground);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .session-meta {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }

      .meta-item {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .meta-icon {
        width: 12px;
        height: 12px;
      }

      .meta-separator {
        color: var(--vscode-descriptionForeground);
        opacity: 0.5;
      }

      .feature-highlights {
        display: flex;
        flex-direction: column;
        gap: 16px;
        max-width: 400px;
      }

      .feature-item {
        display: flex;
        align-items: center;
        gap: 12px;
        text-align: left;
      }

      .feature-icon {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background-color: var(--vscode-sideBar-background);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        font-size: 16px;
      }

      .feature-content {
        flex: 1;
      }

      .feature-title {
        margin: 0;
        color: var(--vscode-button-foreground);
        font-size: 12px;
        font-weight: 500;
      }

      .feature-text {
        margin: 0;
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        line-height: 1.3;
      }

      /* High Contrast Mode */
      @media (prefers-contrast: high) {
        .action-card,
        .session-item {
          border-width: 2px;
        }
      }

      /* Reduced Motion */
      @media (prefers-reduced-motion: reduce) {
        .action-card,
        .session-item {
          transition: none;
        }

        .action-card:active,
        .session-item:active {
          transform: none;
        }
      }
    `,
  ],
})
export class ChatEmptyStateComponent {
  /**
   * VS Code service for webview utilities
   */
  private readonly vscode = inject(VSCodeService);

  /**
   * Proper webview URI for the Ptah icon
   */
  readonly ptahIconUri = this.vscode.getPtahIconUri();

  /**
   * Input signal: List of recent sessions to display
   */
  readonly sessions = input<SessionSummary[]>([]);

  /**
   * Computed signal: Whether there are sessions to display
   */
  readonly hasSessions = computed(() => this.sessions().length > 0);

  /**
   * Emitted when Quick Help action card is clicked
   */
  readonly quickHelp = output<void>();

  /**
   * Emitted when Code Orchestration action card is clicked
   */
  readonly orchestration = output<void>();

  /**
   * Emitted when a session is selected from the list
   */
  readonly sessionSelected = output<string>();

  /**
   * Lucide icons for action cards and sessions
   */
  readonly MessageSquareIcon = MessageSquareIcon;
  readonly WorkflowIcon = WorkflowIcon;
  readonly MessageCircleIcon = MessageCircleIcon;
  readonly ClockIcon = ClockIcon;

  /**
   * Get relative time string from timestamp (e.g., "2 hours ago")
   *
   * @param timestamp - Unix epoch milliseconds
   * @returns Human-readable relative time
   */
  getRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  }
}
