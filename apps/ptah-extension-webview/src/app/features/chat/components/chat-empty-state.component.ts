import { Component, Output, EventEmitter, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, MessageSquareIcon, WorkflowIcon } from 'lucide-angular';
import { VSCodeService } from '../../core/services/vscode.service';

/**
 * VS Code Chat Empty State - Pure Presentation Component
 * - Welcome message and action cards
 * - No business logic or state management
 * - Pure VS Code styling - NO Tailwind classes
 * - Accessible action cards with proper ARIA labels
 */
@Component({
  selector: 'vscode-chat-empty-state',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],

  template: `
    <div class="vscode-empty-state">
      <!-- Welcome Section -->
      <div class="vscode-welcome-section">
        <div class="vscode-welcome-icon">
          <img [src]="ptahIconUri" alt="Ptah" class="vscode-ptah-icon" />
        </div>
        <div class="vscode-welcome-content">
          <h3 class="vscode-welcome-title">Welcome to Claude Code</h3>
          <p class="vscode-welcome-description">
            Intelligent code assistance powered by <span class="vscode-highlight">Claude</span> to
            craft, refine, and perfect your projects.
          </p>
        </div>
      </div>

      <!-- Action Cards -->
      <div class="vscode-action-cards">
        <!-- Quick Help Card -->
        <button
          class="vscode-action-card vscode-action-card-primary"
          (click)="quickHelp.emit()"
          [attr.aria-label]="'Start quick help session'"
        >
          <div class="vscode-card-icon-container vscode-card-icon-primary">
            <lucide-angular [img]="MessageSquareIcon" class="vscode-card-icon"></lucide-angular>
          </div>
          <h4 class="vscode-card-title vscode-card-title-primary">Quick Help</h4>
          <p class="vscode-card-description">
            Get immediate assistance for simple coding tasks and questions
          </p>
        </button>

        <!-- Orchestrate Card -->
        <button
          class="vscode-action-card vscode-action-card-secondary"
          (click)="orchestration.emit()"
          [attr.aria-label]="'Start orchestration workflow'"
        >
          <div class="vscode-card-icon-container vscode-card-icon-secondary">
            <lucide-angular [img]="WorkflowIcon" class="vscode-card-icon"></lucide-angular>
          </div>
          <h4 class="vscode-card-title vscode-card-title-secondary">Code Orchestration</h4>
          <p class="vscode-card-description">
            Coordinate multiple agents to architect comprehensive solutions
          </p>
        </button>
      </div>

      <!-- Feature Highlights -->
      <div class="vscode-feature-highlights">
        <div class="vscode-feature-item">
          <div class="vscode-feature-icon">📜</div>
          <div class="vscode-feature-content">
            <p class="vscode-feature-title">Sacred Scripts:</p>
            <p class="vscode-feature-text">
              Each scribe channels unique wisdom through dedicated models
            </p>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .vscode-empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        text-align: center;
        padding: 24px;
        gap: 24px;
      }

      .vscode-welcome-section {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
      }

      .vscode-welcome-icon {
        margin-bottom: 8px;
      }

      .vscode-ptah-icon {
        width: 120px;
        height: 120px;
      }

      .vscode-welcome-content {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .vscode-welcome-title {
        margin: 0;
        font-size: 16px;
        font-weight: 500;
        color: var(--vscode-foreground);
      }

      .vscode-welcome-description {
        margin: 0;
        color: var(--vscode-descriptionForeground);
        font-size: 13px;
        max-width: 400px;
        line-height: 1.4;
      }

      .vscode-highlight {
        color: var(--vscode-textPreformat-foreground);
        font-weight: 500;
      }

      .vscode-action-cards {
        display: flex;
        gap: 16px;
        justify-content: center;
      }

      .vscode-action-card {
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

      .vscode-action-card:hover {
        background-color: var(--vscode-list-hoverBackground);
        border-color: var(--vscode-focusBorder);
      }

      .vscode-action-card:focus {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 2px;
      }

      .vscode-card-icon-container {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 12px;
      }

      .vscode-card-icon-primary {
        background-color: var(--vscode-button-background);
      }

      .vscode-card-icon-secondary {
        background-color: var(--vscode-button-secondaryBackground);
      }

      .vscode-card-icon {
        width: 24px;
        height: 24px;
      }

      .vscode-card-title {
        margin: 0 0 4px 0;
        font-size: 12px;
        font-weight: 600;
      }

      .vscode-card-title-primary {
        color: var(--vscode-button-foreground);
      }

      .vscode-card-title-secondary {
        color: var(--vscode-button-secondaryForeground);
      }

      .vscode-card-description {
        margin: 0;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.3;
      }

      .vscode-feature-highlights {
        display: flex;
        flex-direction: column;
        gap: 16px;
        max-width: 400px;
      }

      .vscode-feature-item {
        display: flex;
        align-items: center;
        gap: 12px;
        text-align: left;
      }

      .vscode-feature-icon {
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

      .vscode-feature-content {
        flex: 1;
      }

      .vscode-feature-title {
        margin: 0;
        color: var(--vscode-button-foreground);
        font-size: 12px;
        font-weight: 500;
      }

      .vscode-feature-text {
        margin: 0;
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        line-height: 1.3;
      }


      /* High Contrast Mode */
      @media (prefers-contrast: high) {
        .vscode-action-card {
          border-width: 2px;
        }
      }

      /* Reduced Motion */
      @media (prefers-reduced-motion: reduce) {
        .vscode-action-card {
          transition: none;
        }
      }
    `,
  ],
})
export class VSCodeChatEmptyStateComponent {
  // Services
  readonly vscode = inject(VSCodeService);

  // Get proper webview URI for the Ptah icon
  readonly ptahIconUri = this.vscode.getPtahIconUri();

  @Output() quickHelp = new EventEmitter<void>();
  @Output() orchestration = new EventEmitter<void>();

  readonly MessageSquareIcon = MessageSquareIcon;
  readonly WorkflowIcon = WorkflowIcon;
}
