import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  X,
  Zap,
  Code,
  FileText,
  Settings,
  GitBranch,
  TestTube,
  type LucideIconData,
} from 'lucide-angular';

export interface QuickCommand {
  id: string;
  label: string;
  description: string;
  prompt: string;
  icon: LucideIconData;
  category: 'code' | 'text' | 'analysis' | 'tools';
}

/**
 * Command Bottom Sheet Component - Angular 20+ Modernized
 * - Signal-based APIs (input(), output())
 * - OnPush change detection
 * - Pure presentation component (no service dependencies)
 * - Accessible with keyboard navigation
 */
@Component({
  selector: 'ptah-command-bottom-sheet',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isOpen()) {
    <!-- Backdrop -->
    <div
      class="vscode-backdrop"
      (click)="closeSheet.emit()"
      [attr.aria-hidden]="true"
    ></div>

    <!-- Bottom Sheet -->
    <div
      class="vscode-bottom-sheet"
      role="dialog"
      [attr.aria-label]="'Quick commands'"
      [attr.aria-modal]="true"
    >
      <!-- Header -->
      <div class="vscode-sheet-header">
        <h2 class="vscode-sheet-title">Quick Commands</h2>
        <button
          class="vscode-close-button"
          (click)="closeSheet.emit()"
          [attr.aria-label]="'Close commands'"
        >
          <lucide-angular [img]="X" class="vscode-icon"></lucide-angular>
        </button>
      </div>

      <!-- Commands Grid -->
      <div class="vscode-commands-grid">
        @for (command of quickCommands(); track command.id) {
        <button
          class="vscode-command-card"
          (click)="onCommandSelect(command)"
          [attr.aria-label]="command.label + ': ' + command.description"
        >
          <div class="vscode-command-icon">
            <lucide-angular
              [img]="command.icon"
              class="vscode-icon"
            ></lucide-angular>
          </div>
          <div class="vscode-command-content">
            <h3 class="vscode-command-label">{{ command.label }}</h3>
            <p class="vscode-command-description">{{ command.description }}</p>
          </div>
        </button>
        }
      </div>

      <!-- Footer -->
      <div class="vscode-sheet-footer">
        <p class="vscode-footer-text">
          Or type <strong>/help</strong> in chat for more commands
        </p>
      </div>
    </div>
    }
  `,
  styles: [
    `
      .vscode-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: color-mix(
          in srgb,
          var(--vscode-editor-background) 60%,
          transparent
        );
        backdrop-filter: blur(2px);
        z-index: 1000;
        animation: vscode-fade-in 0.2s ease-out;
      }

      .vscode-bottom-sheet {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        background-color: var(--vscode-panel-background);
        border-top: 1px solid var(--vscode-panel-border);
        border-radius: 8px 8px 0 0;
        max-height: 60vh;
        max-width: 320px;
        margin: auto;
        z-index: 1001;
        animation: vscode-slide-up 0.3s ease-out;
        box-shadow: 0 -4px 12px var(--vscode-widget-shadow);
      }

      @keyframes vscode-fade-in {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      @keyframes vscode-slide-up {
        from {
          transform: translateY(100%);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }

      .vscode-sheet-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid var(--vscode-panel-border);
      }

      .vscode-sheet-title {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        color: var(--vscode-panelTitle-activeForeground);
      }

      .vscode-close-button {
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: none;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        color: var(--vscode-foreground);
      }

      .vscode-close-button:hover {
        background-color: var(--vscode-list-hoverBackground);
      }

      .vscode-icon {
        width: 16px;
        height: 16px;
      }

      .vscode-commands-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 12px;
        padding: 10px;
        max-height: 400px;
        overflow-y: auto;
      }

      .vscode-command-card {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        background-color: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
        cursor: pointer;
        text-align: left;
        transition: all 0.15s ease;
      }

      .vscode-command-card:hover {
        background-color: var(--vscode-list-hoverBackground);
        border-color: var(--vscode-focusBorder);
      }

      .vscode-command-card:focus {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 2px;
      }

      .vscode-command-icon {
        width: 36px;
        height: 36px;
        background-color: var(--vscode-button-secondaryBackground);
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .vscode-command-icon .vscode-icon {
        width: 18px;
        height: 18px;
        color: var(--vscode-button-secondaryForeground);
      }

      .vscode-command-content {
        flex: 1;
        min-width: 0;
      }

      .vscode-command-label {
        margin: 0 0 4px 0;
        font-size: 13px;
        font-weight: 500;
        color: var(--vscode-foreground);
      }

      .vscode-command-description {
        margin: 0;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.3;
      }

      .vscode-sheet-footer {
        padding: 12px 20px;
        border-top: 1px solid var(--vscode-panel-border);
        text-align: center;
        background-color: var(--vscode-sideBar-background);
      }

      .vscode-footer-text {
        margin: 0;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }

      .vscode-footer-text strong {
        color: var(--vscode-textPreformat-foreground);
        font-weight: 600;
      }

      .vscode-commands-grid::-webkit-scrollbar {
        width: 6px;
      }

      .vscode-commands-grid::-webkit-scrollbar-track {
        background: var(--vscode-scrollbar-shadow);
      }

      .vscode-commands-grid::-webkit-scrollbar-thumb {
        background: var(--vscode-scrollbarSlider-background);
        border-radius: 3px;
      }

      @media (max-width: 640px) {
        .vscode-commands-grid {
          grid-template-columns: 1fr;
          padding: 16px;
        }

        .vscode-sheet-header {
          padding: 12px 16px;
        }

        .vscode-sheet-footer {
          padding: 10px 16px;
        }
      }

      @media (prefers-contrast: high) {
        .vscode-bottom-sheet {
          border-top-width: 2px;
        }

        .vscode-command-card {
          border-width: 2px;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .vscode-backdrop,
        .vscode-bottom-sheet {
          animation: none;
        }
      }
    `,
  ],
})
export class CommandBottomSheetComponent {
  readonly X = X;

  // Predefined quick commands as input signal (Angular 20+)
  quickCommands = input<QuickCommand[]>([
    {
      id: 'code-review',
      label: 'Code Review',
      description: 'Review code for best practices and improvements',
      prompt:
        '/review Please review my code for best practices, potential bugs, and improvements',
      icon: Code,
      category: 'code',
    },
    {
      id: 'explain-code',
      label: 'Explain Code',
      description: 'Get detailed explanation of code functionality',
      prompt: 'Please explain how this code works and what it does',
      icon: FileText,
      category: 'code',
    },
    {
      id: 'optimize-code',
      label: 'Optimize Code',
      description: 'Suggest performance and efficiency improvements',
      prompt:
        'Help me optimize this code for better performance and readability',
      icon: Zap,
      category: 'code',
    },
    {
      id: 'write-tests',
      label: 'Write Tests',
      description: 'Generate unit tests for your code',
      prompt: 'Write comprehensive unit tests for this code',
      icon: TestTube,
      category: 'code',
    },
    {
      id: 'refactor-code',
      label: 'Refactor Code',
      description: 'Improve code structure and maintainability',
      prompt:
        'Help me refactor this code to improve its structure and maintainability',
      icon: GitBranch,
      category: 'code',
    },
    {
      id: 'config-help',
      label: 'Configuration Help',
      description: 'Get help with configuration files',
      prompt: 'Help me configure this properly',
      icon: Settings,
      category: 'tools',
    },
  ]);

  // Signal-based inputs (Angular 20+)
  isOpen = input<boolean>(false);

  // Signal-based outputs (Angular 20+)
  commandSelected = output<QuickCommand>();
  closeSheet = output<void>();

  @HostListener('document:keydown.escape', ['$event'])
  onEscapeKey(event: Event): void {
    if (this.isOpen()) {
      event.preventDefault();
      this.closeSheet.emit();
    }
  }

  onCommandSelect(command: QuickCommand): void {
    this.commandSelected.emit(command);
    this.closeSheet.emit();
  }
}
