import { Component, Input } from '@angular/core';

/**
 * Pure VS Code Loading Spinner Component
 * - Uses only VS Code CSS variables
 * - No Tailwind or Egyptian theming
 * - Simple, accessible, performant
 */
@Component({
  selector: 'vscode-loading-spinner',
  standalone: true,
  template: `
    <div class="vscode-spinner-container" [class.vscode-spinner-overlay]="overlay">
      <div class="vscode-spinner" [class]="'vscode-spinner-' + size">
        <div class="vscode-spinner-icon"></div>
      </div>
      @if (message) {
        <span class="vscode-spinner-message">{{ message }}</span>
      }
    </div>
  `,
  styles: [
    `
      .vscode-spinner-container {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }

      .vscode-spinner-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: var(--vscode-editor-background);
        opacity: 0.9;
        z-index: 1000;
      }

      .vscode-spinner {
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .vscode-spinner-icon {
        width: 16px;
        height: 16px;
        border: 2px solid var(--vscode-progressBar-background);
        border-top: 2px solid var(--vscode-button-background);
        border-radius: 50%;
        animation: vscode-spin 1s linear infinite;
      }

      .vscode-spinner-sm .vscode-spinner-icon {
        width: 12px;
        height: 12px;
        border-width: 1px;
      }

      .vscode-spinner-md .vscode-spinner-icon {
        width: 16px;
        height: 16px;
        border-width: 2px;
      }

      .vscode-spinner-lg .vscode-spinner-icon {
        width: 24px;
        height: 24px;
        border-width: 3px;
      }

      .vscode-spinner-message {
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-descriptionForeground);
        margin-left: 8px;
      }

      @keyframes vscode-spin {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }

      /* Respect reduced motion preferences */
      @media (prefers-reduced-motion: reduce) {
        .vscode-spinner-icon {
          animation: none;
          border-top-color: var(--vscode-progressBar-background);
        }

        .vscode-spinner-icon::after {
          content: '⏳';
          position: absolute;
          font-size: 12px;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
        }
      }
    `,
  ],
})
export class VSCodeLoadingSpinnerComponent {
  @Input() size: 'sm' | 'md' | 'lg' = 'md';
  @Input() message?: string;
  @Input() overlay: boolean = false;
}
