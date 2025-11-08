import {
  Component,
  output,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';
import {
  LucideAngularModule,
  MessageSquareIcon,
  WorkflowIcon,
} from 'lucide-angular';
import { VSCodeService } from '@ptah-extension/core';

/**
 * Chat Empty State Component - Welcome Screen
 *
 * **Purpose**: Welcome message with action cards for new sessions
 *
 * **Modernizations**:
 * - `@Output()` → `output<void>()` for all events (quickHelp, orchestration)
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
 * - Feature highlights section
 *
 * @example
 * ```html
 * <ptah-chat-empty-state
 *   (quickHelp)="handleQuickHelp()"
 *   (orchestration)="handleOrchestration()"
 * />
 * ```
 */
@Component({
  selector: 'ptah-chat-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
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
        .action-card {
          border-width: 2px;
        }
      }

      /* Reduced Motion */
      @media (prefers-reduced-motion: reduce) {
        .action-card {
          transition: none;
        }

        .action-card:active {
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
   * Emitted when Quick Help action card is clicked
   */
  readonly quickHelp = output<void>();

  /**
   * Emitted when Code Orchestration action card is clicked
   */
  readonly orchestration = output<void>();

  /**
   * Lucide icons for action cards
   */
  readonly MessageSquareIcon = MessageSquareIcon;
  readonly WorkflowIcon = WorkflowIcon;
}
