import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule, LucideIconData } from 'lucide-angular';

/**
 * Action Button Component - Angular 20+ Modernized
 * - Signal-based APIs (input(), output())
 * - OnPush change detection
 * - Pure presentation component
 * - Stunning gradient button design
 */
@Component({
  selector: 'ptah-action-button',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      class="vscode-action-button"
      [class.vscode-action-button-primary]="variant() === 'primary'"
      [class.vscode-action-button-secondary]="variant() === 'secondary'"
      [disabled]="disabled()"
      [attr.aria-label]="ariaLabel()"
      [title]="ariaLabel()"
      (click)="buttonClick.emit()"
    >
      <lucide-angular
        [img]="icon()"
        class="vscode-action-button-icon"
      ></lucide-angular>
    </button>
  `,
  styles: [
    `
      .vscode-action-button {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 25px;
        height: 25px;
        min-width: 25px;
        min-height: 25px;
        border: none;
        border-radius: 12px;
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        background: linear-gradient(
          135deg,
          #6b7280 0%,
          #4b5563 50%,
          #374151 100%
        );
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
        color: #ffffff;
        overflow: hidden;
      }

      .vscode-action-button::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 12px;
        background: linear-gradient(
          135deg,
          rgba(255, 255, 255, 0.2) 0%,
          transparent 50%
        );
        opacity: 0;
        transition: opacity 0.2s ease;
      }

      .vscode-action-button:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15),
          0 2px 4px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.2);
      }

      .vscode-action-button:hover:not(:disabled)::before {
        opacity: 1;
      }

      .vscode-action-button:active:not(:disabled) {
        transform: translateY(0);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.08),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
      }

      .vscode-action-button:focus {
        outline: none;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06),
          inset 0 1px 0 rgba(255, 255, 255, 0.1),
          0 0 0 3px rgba(59, 130, 246, 0.5);
      }

      .vscode-action-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05),
          inset 0 1px 0 rgba(255, 255, 255, 0.05);
      }

      /* Primary Button - Stunning Green Gradient */
      .vscode-action-button-primary:not(:disabled) {
        background: linear-gradient(
          135deg,
          #10b981 0%,
          #059669 50%,
          #047857 100%
        );
        color: #ffffff;
        box-shadow: 0 3px 8px rgba(16, 185, 129, 0.3),
          0 1px 3px rgba(16, 185, 129, 0.2),
          inset 0 1px 0 rgba(255, 255, 255, 0.2);
      }

      .vscode-action-button-primary:not(:disabled)::before {
        background: linear-gradient(
          135deg,
          rgba(255, 255, 255, 0.3) 0%,
          transparent 50%
        );
      }

      .vscode-action-button-primary:hover:not(:disabled) {
        background: linear-gradient(
          135deg,
          #34d399 0%,
          #10b981 50%,
          #059669 100%
        );
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(16, 185, 129, 0.4),
          0 3px 8px rgba(16, 185, 129, 0.25),
          inset 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .vscode-action-button-primary:active:not(:disabled) {
        background: linear-gradient(
          135deg,
          #047857 0%,
          #065f46 50%,
          #064e3b 100%
        );
        transform: translateY(0);
        box-shadow: 0 2px 6px rgba(16, 185, 129, 0.2),
          0 1px 3px rgba(16, 185, 129, 0.15),
          inset 0 1px 0 rgba(255, 255, 255, 0.15);
      }

      .vscode-action-button-primary:focus {
        box-shadow: 0 3px 8px rgba(16, 185, 129, 0.3),
          0 1px 3px rgba(16, 185, 129, 0.2),
          inset 0 1px 0 rgba(255, 255, 255, 0.2),
          0 0 0 3px rgba(16, 185, 129, 0.5);
      }

      .vscode-action-button-icon {
        width: 13px;
        height: 13px;
        transition: transform 0.2s ease;
        display: flex;
        height: auto;
      }

      .vscode-action-button:hover:not(:disabled) .vscode-action-button-icon {
        transform: scale(1.1);
      }

      .vscode-action-button:active:not(:disabled) .vscode-action-button-icon {
        transform: scale(0.95);
      }

      /* High contrast mode */
      @media (prefers-contrast: high) {
        .vscode-action-button {
          border: 2px solid var(--vscode-contrastBorder);
        }

        .vscode-action-button-primary:not(:disabled) {
          border: 2px solid #10b981;
        }
      }

      /* Reduced motion */
      @media (prefers-reduced-motion: reduce) {
        .vscode-action-button {
          transition: none;
        }

        .vscode-action-button:hover:not(:disabled) {
          transform: none;
        }

        .vscode-action-button-icon {
          transition: none;
        }

        .vscode-action-button:hover:not(:disabled) .vscode-action-button-icon {
          transform: none;
        }
      }
    `,
  ],
})
export class ActionButtonComponent {
  // Signal-based inputs (Angular 20+)
  icon = input.required<LucideIconData>();
  variant = input<'primary' | 'secondary'>('secondary');
  disabled = input<boolean>(false);
  ariaLabel = input<string>('');

  // Signal-based output (Angular 20+)
  buttonClick = output<void>();
}
