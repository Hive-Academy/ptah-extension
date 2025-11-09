import {
  Component,
  HostListener,
  input,
  output,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  Shield,
  CheckCircle,
  XCircle,
  AlertTriangle,
  X,
} from 'lucide-angular';

export interface PermissionRequest {
  id: string;
  tool: string;
  action: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
  timestamp: number;
}

export type PermissionResponse = 'allow' | 'always_allow' | 'deny';

/**
 * Permission Popup Component - Angular 20+ Modernized
 * - Signal-based APIs (input(), output(), computed())
 * - OnPush change detection
 * - Pure presentation component (no service dependencies)
 * - Accessible with keyboard navigation
 */
@Component({
  selector: 'ptah-permission-popup',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],

  template: `
    @if (isOpen() && permissionRequest()) {
    <!-- Backdrop -->
    <div
      class="vscode-backdrop"
      (click)="onBackdropClick()"
      [attr.aria-hidden]="true"
    ></div>

    <!-- Permission Modal -->
    <div
      class="vscode-permission-modal"
      role="dialog"
      [attr.aria-label]="'Permission request for ' + permissionRequest()!.tool"
      [attr.aria-modal]="true"
      [attr.data-risk]="permissionRequest()!.riskLevel"
    >
      <!-- Header -->
      <div class="vscode-modal-header">
        <div
          class="vscode-header-icon"
          [attr.data-risk]="permissionRequest()!.riskLevel"
        >
          <lucide-angular
            [img]="Shield"
            class="vscode-shield-icon"
          ></lucide-angular>
        </div>
        <div class="vscode-header-content">
          <h2 class="vscode-modal-title">Permission Required</h2>
          <p class="vscode-modal-subtitle">
            {{ permissionRequest()!.tool }} requests permission
          </p>
        </div>
        <button
          class="vscode-close-button"
          (click)="onResponse('deny')"
          [attr.aria-label]="'Close permission dialog'"
        >
          <lucide-angular [img]="X" class="vscode-icon"></lucide-angular>
        </button>
      </div>

      <!-- Content -->
      <div class="vscode-modal-content">
        <!-- Action Description -->
        <div class="vscode-action-section">
          <h3 class="vscode-section-title">Requested Action</h3>
          <div class="vscode-action-card">
            <div class="vscode-action-icon">
              <lucide-angular
                [img]="riskIcon()"
                [class]="
                  'vscode-risk-icon vscode-risk-' +
                  permissionRequest()!.riskLevel
                "
              ></lucide-angular>
            </div>
            <div class="vscode-action-details">
              <p class="vscode-action-name">
                {{ permissionRequest()!.action }}
              </p>
              <p class="vscode-action-description">
                {{ permissionRequest()!.description }}
              </p>
            </div>
          </div>
        </div>

        <!-- Risk Assessment -->
        <div class="vscode-risk-section">
          <div
            class="vscode-risk-badge"
            [attr.data-risk]="permissionRequest()!.riskLevel"
          >
            <lucide-angular
              [img]="AlertTriangle"
              class="vscode-risk-badge-icon"
            ></lucide-angular>
            <span class="vscode-risk-text">{{ riskLabel() }} Risk</span>
          </div>
          <p class="vscode-risk-explanation">{{ riskExplanation() }}</p>
        </div>

        <!-- Tool Information -->
        <div class="vscode-tool-section">
          <h3 class="vscode-section-title">Tool Information</h3>
          <div class="vscode-tool-info">
            <div class="vscode-tool-name">{{ permissionRequest()!.tool }}</div>
            <div class="vscode-tool-timestamp">
              Requested {{ formattedTimestamp() }}
            </div>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="vscode-modal-actions">
        <div class="vscode-action-group">
          <button
            class="vscode-action-button vscode-secondary"
            (click)="onResponse('deny')"
            [attr.aria-label]="'Deny permission'"
          >
            <lucide-angular
              [img]="XCircle"
              class="vscode-button-icon"
            ></lucide-angular>
            Deny
          </button>

          <button
            class="vscode-action-button vscode-primary"
            (click)="onResponse('allow')"
            [attr.aria-label]="'Allow permission once'"
          >
            <lucide-angular
              [img]="CheckCircle"
              class="vscode-button-icon"
            ></lucide-angular>
            Allow Once
          </button>

          <button
            class="vscode-action-button vscode-primary"
            (click)="onResponse('always_allow')"
            [attr.aria-label]="'Always allow for this tool'"
          >
            <lucide-angular
              [img]="Shield"
              class="vscode-button-icon"
            ></lucide-angular>
            Always Allow
          </button>
        </div>

        <div class="vscode-action-hint">
          <p>
            Tip: Use "Always Allow" to skip future permissions for
            {{ permissionRequest()!.tool }}
          </p>
        </div>
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
          var(--vscode-editor-background) 80%,
          transparent
        );
        backdrop-filter: blur(3px);
        z-index: 2000;
        animation: vscode-fade-in 0.25s ease-out;
      }

      .vscode-permission-modal {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: min(350px, 75vw);
        max-height: 75vh;
        background-color: var(--vscode-panel-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 8px;
        z-index: 2001;
        animation: vscode-modal-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        box-shadow: 0 8px 32px var(--vscode-widget-shadow);
        overflow: hidden;
      }

      .vscode-permission-modal[data-risk='high'] {
        border-color: var(--vscode-errorForeground);
        box-shadow: 0 8px 32px
          color-mix(
            in srgb,
            var(--vscode-errorForeground) 20%,
            var(--vscode-widget-shadow)
          );
      }

      .vscode-permission-modal[data-risk='medium'] {
        border-color: var(--vscode-notificationsWarningIcon-foreground);
      }

      .vscode-permission-modal[data-risk='low'] {
        border-color: var(--vscode-notificationsInfoIcon-foreground);
      }

      @keyframes vscode-fade-in {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      @keyframes vscode-modal-in {
        from {
          transform: translate(-50%, -60%);
          opacity: 0;
          scale: 0.96;
        }
        to {
          transform: translate(-50%, -50%);
          opacity: 1;
          scale: 1;
        }
      }

      .vscode-modal-header {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 20px;
        border-bottom: 1px solid var(--vscode-panel-border);
        background-color: var(--vscode-sideBar-background);
      }

      .vscode-header-icon {
        width: 38px;
        height: 38px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .vscode-header-icon[data-risk='high'] {
        background-color: color-mix(
          in srgb,
          var(--vscode-errorForeground) 15%,
          transparent
        );
      }

      .vscode-header-icon[data-risk='medium'] {
        background-color: color-mix(
          in srgb,
          var(--vscode-notificationsWarningIcon-foreground) 15%,
          transparent
        );
      }

      .vscode-header-icon[data-risk='low'] {
        background-color: color-mix(
          in srgb,
          var(--vscode-notificationsInfoIcon-foreground) 15%,
          transparent
        );
      }

      .vscode-shield-icon {
        width: 24px;
        height: 24px;
        color: var(--vscode-panelTitle-activeForeground);
      }

      .vscode-header-content {
        flex: 1;
        min-width: 0;
      }

      .vscode-modal-title {
        margin: 0 0 4px 0;
        font-size: 18px;
        font-weight: 600;
        color: var(--vscode-panelTitle-activeForeground);
        line-height: 1.2;
      }

      .vscode-modal-subtitle {
        margin: 0;
        font-size: 13px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.3;
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

      .vscode-modal-content {
        padding: 20px;
        max-height: 400px;
        overflow-y: auto;
      }

      .vscode-section-title {
        margin: 0 0 12px 0;
        font-size: 14px;
        font-weight: 600;
        color: var(--vscode-foreground);
      }

      .vscode-action-section {
        margin-bottom: 20px;
      }

      .vscode-action-card {
        display: flex;
        align-items: start;
        gap: 12px;
        padding: 16px;
        background-color: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        border-radius: 6px;
      }

      .vscode-action-icon {
        width: 32px;
        height: 32px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        background-color: var(--vscode-button-secondaryBackground);
      }

      .vscode-risk-icon {
        width: 16px;
        height: 16px;
      }

      .vscode-risk-icon.vscode-risk-high {
        color: var(--vscode-errorForeground);
      }

      .vscode-risk-icon.vscode-risk-medium {
        color: var(--vscode-notificationsWarningIcon-foreground);
      }

      .vscode-risk-icon.vscode-risk-low {
        color: var(--vscode-notificationsInfoIcon-foreground);
      }

      .vscode-action-details {
        flex: 1;
        min-width: 0;
      }

      .vscode-action-name {
        margin: 0 0 6px 0;
        font-size: 14px;
        font-weight: 500;
        color: var(--vscode-foreground);
      }

      .vscode-action-description {
        margin: 0;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.4;
      }

      .vscode-risk-section {
        margin-bottom: 20px;
      }

      .vscode-risk-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 8px;
      }

      .vscode-risk-badge[data-risk='high'] {
        background-color: color-mix(
          in srgb,
          var(--vscode-errorForeground) 15%,
          transparent
        );
        color: var(--vscode-errorForeground);
      }

      .vscode-risk-badge[data-risk='medium'] {
        background-color: color-mix(
          in srgb,
          var(--vscode-notificationsWarningIcon-foreground) 15%,
          transparent
        );
        color: var(--vscode-notificationsWarningIcon-foreground);
      }

      .vscode-risk-badge[data-risk='low'] {
        background-color: color-mix(
          in srgb,
          var(--vscode-notificationsInfoIcon-foreground) 15%,
          transparent
        );
        color: var(--vscode-notificationsInfoIcon-foreground);
      }

      .vscode-risk-badge-icon {
        width: 12px;
        height: 12px;
      }

      .vscode-risk-explanation {
        margin: 0;
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.4;
      }

      .vscode-tool-section {
        margin-bottom: 0;
      }

      .vscode-tool-info {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        background-color: var(--vscode-editor-background);
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
      }

      .vscode-tool-name {
        font-size: 13px;
        font-weight: 500;
        color: var(--vscode-foreground);
        font-family: var(--vscode-editor-font-family);
      }

      .vscode-tool-timestamp {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }

      .vscode-modal-actions {
        padding: 20px;
        border-top: 1px solid var(--vscode-panel-border);
        background-color: var(--vscode-sideBar-background);
      }

      .vscode-action-group {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        margin-bottom: 12px;
      }

      .vscode-action-button {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        border: none;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .vscode-action-button.vscode-primary {
        background-color: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }

      .vscode-action-button.vscode-primary:hover {
        background-color: var(--vscode-button-hoverBackground);
      }

      .vscode-action-button.vscode-secondary {
        background-color: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
      }

      .vscode-action-button.vscode-secondary:hover {
        background-color: var(--vscode-button-secondaryHoverBackground);
      }

      .vscode-button-icon {
        width: 14px;
        height: 14px;
      }

      .vscode-action-hint {
        text-align: center;
      }

      .vscode-action-hint p {
        margin: 0;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.3;
      }

      .vscode-modal-content::-webkit-scrollbar {
        width: 6px;
      }

      .vscode-modal-content::-webkit-scrollbar-track {
        background: var(--vscode-scrollbar-shadow);
      }

      .vscode-modal-content::-webkit-scrollbar-thumb {
        background: var(--vscode-scrollbarSlider-background);
        border-radius: 3px;
      }

      @media (max-width: 640px) {
        .vscode-permission-modal {
          width: 80vw;
          margin: 0 2.5vw;
        }

        .vscode-action-group {
          flex-direction: column-reverse;
        }
      }

      @media (prefers-contrast: high) {
        .vscode-permission-modal {
          border-width: 2px;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .vscode-backdrop,
        .vscode-permission-modal {
          animation: none;
        }
      }
    `,
  ],
})
export class PermissionPopupComponent {
  readonly Shield = Shield;
  readonly CheckCircle = CheckCircle;
  readonly XCircle = XCircle;
  readonly AlertTriangle = AlertTriangle;
  readonly X = X;

  // Signal-based inputs (Angular 20+)
  isOpen = input<boolean>(false);
  permissionRequest = input<PermissionRequest | null>(null);
  allowBackdropClose = input<boolean>(false);

  // Signal-based outputs (Angular 20+)
  permissionResponse = output<PermissionResponse>();
  closePopup = output<void>();

  // Computed signals for reactive rendering (Angular 20+)
  riskIcon = computed(() => {
    const level = this.permissionRequest()?.riskLevel;
    switch (level) {
      case 'high':
        return XCircle;
      case 'medium':
        return AlertTriangle;
      case 'low':
        return CheckCircle;
      default:
        return Shield;
    }
  });

  riskLabel = computed(() => {
    const level = this.permissionRequest()?.riskLevel;
    return level ? level.charAt(0).toUpperCase() + level.slice(1) : 'Unknown';
  });

  riskExplanation = computed(() => {
    const level = this.permissionRequest()?.riskLevel;
    switch (level) {
      case 'high':
        return 'This action may modify system files or access sensitive data. Review carefully before allowing.';
      case 'medium':
        return 'This action may make changes to your project files. Make sure you understand what will be modified.';
      case 'low':
        return 'This action is generally safe and will only read or create standard project files.';
      default:
        return 'Please review this permission request carefully.';
    }
  });

  formattedTimestamp = computed(() => {
    const timestamp = this.permissionRequest()?.timestamp;
    if (!timestamp) return 'just now';

    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;

    return new Date(timestamp).toLocaleDateString();
  });

  @HostListener('document:keydown.escape', ['$event'])
  onEscapeKey(event: Event): void {
    if (this.isOpen()) {
      event.preventDefault();
      this.onResponse('deny');
    }
  }

  @HostListener('document:keydown.enter', ['$event'])
  onEnterKey(event: Event): void {
    if (this.isOpen() && (event.target as HTMLElement)?.tagName !== 'BUTTON') {
      event.preventDefault();
      this.onResponse('allow');
    }
  }

  onBackdropClick(): void {
    if (this.allowBackdropClose()) {
      this.onResponse('deny');
    }
  }

  onResponse(response: PermissionResponse): void {
    this.permissionResponse.emit(response);
    this.closePopup.emit();
  }
}
